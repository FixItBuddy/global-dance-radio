#!/usr/bin/env node
// Orchestrates one ingestion run: fetch sources → merge → relevance filter → enrich → trend → prune → write JSON → alert.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeItem, mentionsGta, stricter } from './lib/schema.mjs';
import { sha, safeUrl } from './lib/util.mjs';
import { trendScore } from './lib/trend.mjs';
import { classify } from './enrich/heuristics.mjs';
import { enrichItems } from './enrich/claude.mjs';
import { fetchYouTube } from './sources/youtube.mjs';
import { fetchReddit } from './sources/reddit.mjs';
import { fetchNews } from './sources/news.mjs';
import { fetchTikTok } from './sources/tiktok.mjs';
import { fetchSites } from './sources/sites.mjs';
import { buildAlerts, sendAlerts } from './notify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const writeJson = async (f, v) => { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, JSON.stringify(v, null, 1) + '\n'); };

/** Merge fresh items into existing ones: refresh stats, keep AI enrichment, never lower a spoiler floor. */
export function mergeItems(existing, fresh, nowIso) {
  const byId = new Map(existing.map((i) => [i.id, i]));
  const seenUrls = new Set(existing.map((i) => i.url));
  const added = [];
  for (const raw of fresh) {
    const url = safeUrl(raw.url);
    if (!url || !raw.id) continue;
    const prev = byId.get(raw.id);
    if (prev) {
      prev.stats = { ...prev.stats, ...raw.stats };
      if (raw.thumbnail) prev.thumbnail = raw.thumbnail;
      if (raw.spoilerFloor) prev.spoilerFloor = raw.spoilerFloor;
    } else if (!seenUrls.has(url)) {
      const item = makeItem({ ...raw, url, fetchedAt: nowIso, publishedAt: raw.publishedAt || nowIso });
      byId.set(item.id, item);
      seenUrls.add(url);
      added.push(item);
    }
  }
  return { items: [...byId.values()], added };
}

export function applyEnrichment(item, res) {
  Object.assign(item, {
    kind: res.kind,
    spoiler: stricter(res.spoiler, item.spoilerFloor || 'safe'),
    spoilerWhy: res.spoilerWhy,
    summary: res.summary || item.summary,
    area: res.area,
    tags: res.tags,
    availability: res.availability,
    enriched: res.enriched,
  });
}

export function prune(items, { maxAgeDays = 120, maxItems = 2500 } = {}, now = Date.now()) {
  const kept = items.filter((i) => now - Date.parse(i.publishedAt || i.fetchedAt) < maxAgeDays * 864e5 || (i.availability?.until && Date.parse(i.availability.until) > now));
  return kept.sort((a, b) => b.trend - a.trend).slice(0, maxItems);
}

/** Merge site-extracted collectibles into the tracker file (add/update; never delete — user progress is keyed by id). */
export function mergeCollectibles(file, extracted, nowIso) {
  const cats = new Map((file.categories || []).map((c) => [c.id, c]));
  const added = [];
  for (const c of extracted) {
    let cat = cats.get(c.categoryId);
    if (!cat) { cat = { id: c.categoryId, name: c.category, items: [] }; cats.set(cat.id, cat); }
    const id = sha(`${c.categoryId}|${c.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`);
    const prev = cat.items.find((x) => x.id === id);
    const entry = { id, name: c.name, area: c.area, description: c.description, spoiler: c.spoiler, availableUntil: c.availableUntil, source: c.source };
    if (prev) Object.assign(prev, entry);
    else { const n = { ...entry, addedAt: nowIso }; cat.items.push(n); added.push({ ...n, category: cat.name }); }
  }
  return { file: { categories: [...cats.values()] }, added };
}

export async function run({ root = ROOT, now = Date.now(), env = process.env, log = console.log, enrichBudget = 150 } = {}) {
  const nowIso = new Date(now).toISOString();
  const cfg = await readJson(path.join(root, 'config/sources.json'), {});
  const dataDir = path.join(root, 'data');
  const prevItems = (await readJson(path.join(dataDir, 'items.json'), { items: [] })).items;
  const prevColl = await readJson(path.join(dataDir, 'collectibles.json'), { categories: [] });
  const prevMeta = await readJson(path.join(dataDir, 'meta.json'), {});

  // 1. fetch every source independently — one failing source never blocks the rest
  const jobs = {
    youtube: () => fetchYouTube(cfg.youtube, { now, apiKey: env.YOUTUBE_API_KEY }),
    reddit: () => fetchReddit(cfg.reddit, { clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET }),
    news: () => fetchNews(cfg.news),
    tiktok: () => fetchTikTok(cfg.tiktok, { apifyToken: env.APIFY_TOKEN }),
    sites: () => fetchSites(cfg.sites, { now: nowIso, log, apiKey: env.ANTHROPIC_API_KEY }),
  };
  const sourceStatus = {};
  const fresh = [];
  const siteResult = { items: [], collectibles: [] };
  await Promise.all(Object.entries(jobs).map(async ([name, job]) => {
    try {
      const r = await job();
      sourceStatus[name] = { ok: !r.errors.length || r.items.length > 0, count: r.items.length, errors: r.errors.slice(0, 5), at: nowIso };
      if (name === 'sites') { siteResult.items = r.items; siteResult.collectibles = r.collectibles; } else fresh.push(...r.items);
    } catch (e) {
      sourceStatus[name] = { ok: false, count: 0, errors: [e.message], at: nowIso };
    }
  }));
  for (const [name, s] of Object.entries(sourceStatus)) {
    const prevOk = prevMeta.sourceStatus?.[name]?.lastOkAt;
    s.lastOkAt = s.ok && s.count ? nowIso : prevOk || null;
    log(`${name}: ${s.count} items${s.errors.length ? ` (${s.errors.length} issues: ${s.errors[0]})` : ''}`);
  }

  // 2. relevance gate (untrusted sources must mention GTA VI), then merge
  const relevant = fresh.filter((r) => r.trusted || mentionsGta(`${r.title} ${r.description}`));
  const { items: merged, added } = mergeItems(prevItems, relevant, nowIso);
  const siteMerge = mergeItems(merged, siteResult.items, nowIso);
  let items = siteMerge.items;
  const newItems = [...added, ...siteMerge.added];

  // 3. enrichment — only items that have never been graded by Claude; heuristics as the always-available floor
  const apiKey = env.ANTHROPIC_API_KEY;
  const todo = items.filter((i) => i.enriched !== 'claude').sort((a, b) => (b.enriched ? 0 : 1) - (a.enriched ? 0 : 1)).slice(0, apiKey ? enrichBudget : 0);
  const aiResults = apiKey ? await enrichItems(todo, { apiKey, log }) : new Map();
  const dropped = new Set();
  for (const it of items) {
    const ai = aiResults.get(it.id);
    if (ai) {
      if (!ai.relevant && !it.trusted) { dropped.add(it.id); continue; }
      applyEnrichment(it, ai);
    } else if (!it.enriched) {
      applyEnrichment(it, classify(it));
    }
    if (it.spoilerFloor) it.spoiler = stricter(it.spoiler, it.spoilerFloor);
  }
  items = items.filter((i) => !dropped.has(i.id));

  // 4. trend + prune
  items.forEach((i) => { i.trend = trendScore(i, now); });
  items = prune(items, cfg.retention, now);
  const keptIds = new Set(items.map((i) => i.id));
  const alertItems = newItems.filter((i) => keptIds.has(i.id));

  // 5. collectibles
  const coll = mergeCollectibles(prevColl, siteResult.collectibles, nowIso);

  // 6. write
  const counts = Object.fromEntries(['youtube', 'tiktok', 'reddit', 'news', 'site'].map((s) => [s, items.filter((i) => i.source === s).length]));
  await writeJson(path.join(dataDir, 'items.json'), { generatedAt: nowIso, items });
  await writeJson(path.join(dataDir, 'collectibles.json'), coll.file);
  await writeJson(path.join(dataDir, 'meta.json'), {
    generatedAt: nowIso,
    aiEnrichment: !!apiKey,
    sourceStatus,
    counts,
    totals: { items: items.length, collectibles: coll.file.categories.reduce((n, c) => n + c.items.length, 0) },
  });

  // 7. alerts for brand-new secrets / collectibles / specials (not on the very first run, which would be a flood)
  let alerts = { sent: 0 };
  if (prevItems.length) {
    const extra = coll.added.map((c) => makeItem({ id: `c:${c.id}`, kind: 'collectible', spoiler: c.spoiler, summary: `New in ${c.category}: ${c.name}`, title: c.name }));
    try { alerts = await sendAlerts(buildAlerts([...alertItems, ...extra], { appUrl: env.APP_URL || '' }), { topic: env.NTFY_TOPIC, server: env.NTFY_SERVER }); }
    catch (e) { log(`alerts failed: ${e.message}`); }
  }
  log(`done: ${items.length} items (${added.length + siteMerge.added.length} new), ${alerts.sent} alerts, AI=${!!apiKey}`);
  return { items, newItems: alertItems, sourceStatus };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
