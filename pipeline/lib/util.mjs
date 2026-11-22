// Small zero-dependency helpers shared by the ingestion pipeline.
import { createHash } from 'node:crypto';

export const UA = 'gta6-assistant/1.0 (personal game-guide aggregator)';

export const sha = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
};

/** fetch with timeout + retry on 429/5xx. Uses globalThis.fetch so tests can stub it. */
export async function fetchText(url, { headers = {}, timeout = 20000, retries = 2, method = 'GET', body } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await globalThis.fetch(url, {
        method,
        body,
        headers: { 'user-agent': UA, ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return await res.text();
      const err = new Error(`HTTP ${res.status} for ${redact(url)}`);
      err.status = res.status;
      if (res.status !== 429 && res.status < 500) throw err; // not retryable
      lastErr = err;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status !== 429 && e.status < 500) throw e;
    }
    if (attempt < retries) await sleep(800 * 2 ** attempt);
  }
  throw lastErr;
}

export const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, opts));

/** Keep API keys out of logs and the published status file. */
export function redact(url) {
  return String(url).replace(/([?&](?:key|token|api_key|apikey)=)[^&]+/gi, '$1***');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export const ageHours = (iso, now = Date.now()) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 24 * 365 : Math.max(0, (now - t) / 36e5);
};

export const toIso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Only http(s) URLs ever make it into published data. */
export const safeUrl = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch {
    return null;
  }
};

// ---------- minimal RSS / Atom parsing ----------
const unwrap = (s) => decodeEntities(String(s).replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unwrap(m[1]) : null;
}
function attr(block, name, a) {
  const m = block.match(new RegExp(`<${name}\\s[^>]*?${a}="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

/** Returns [{id,title,url,published,author,description,thumbnail,views}] for RSS 2.0 and Atom feeds. */
export function parseFeed(xml) {
  const atom = /<feed[\s>]/i.test(xml);
  const blocks = xml.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocks.map((b) => ({
    id: tag(b, 'yt:videoId') || tag(b, 'id') || tag(b, 'guid'),
    title: tag(b, 'title'),
    url: atom ? attr(b, 'link', 'href') : tag(b, 'link'),
    published: tag(b, 'published') || tag(b, 'pubDate') || tag(b, 'updated'),
    author: tag(b, 'name') || tag(b, 'source') || tag(b, 'dc:creator'),
    description: tag(b, 'media:description') || tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'),
    thumbnail: attr(b, 'media:thumbnail', 'url'),
    views: Number(attr(b, 'media:statistics', 'views')) || 0,
    likes: Number(attr(b, 'media:starRating', 'count')) || 0,
  }));
}
