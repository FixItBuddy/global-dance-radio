// TikTok has NO open public search API. Two best-effort routes are supported, both optional:
//  (a) "urls": videos you curate by hand, resolved through TikTok's official oEmbed endpoint (no key, no stats).
//  (b) APIFY_TOKEN: hashtag scraping through the Apify "tiktok-scraper" actor — a third-party service you
//      pay for and which may conflict with TikTok's ToS; it is OFF unless you set the token.
// Field names for (b) follow the actor's usual output and are mapped tolerantly; verify against a real run.
import { fetchJson, toIso, clip, safeUrl } from '../lib/util.mjs';

export async function fetchTikTok(cfg = {}, { apifyToken = process.env.APIFY_TOKEN } = {}) {
  const items = [];
  const errors = [];

  for (const url of cfg.urls || []) {
    try {
      const o = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
      const id = (url.match(/video\/(\d+)/) || [])[1] || url;
      items.push({
        id: `tiktok:${id}`,
        source: 'tiktok',
        url,
        title: clip(o.title, 140) || `TikTok by ${o.author_name}`,
        description: clip(o.title, 600),
        author: o.author_name ? `@${o.author_name}` : '',
        publishedAt: null, // oEmbed does not expose a date; fetchedAt is used as the age proxy
        thumbnail: safeUrl(o.thumbnail_url),
        stats: {},
      });
    } catch (e) {
      errors.push(`oembed ${url}: ${e.message}`);
    }
  }

  if (apifyToken && (cfg.hashtags || []).length) {
    try {
      const rows = await fetchJson(
        `https://api.apify.com/v2/acts/${cfg.actor || 'clockworks~tiktok-scraper'}/run-sync-get-dataset-items?token=${apifyToken}`,
        { method: 'POST', timeout: 180000, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hashtags: cfg.hashtags, resultsPerPage: cfg.perHashtag || 30 }) }
      );
      for (const r of rows || []) {
        const url = safeUrl(r.webVideoUrl);
        if (!url) continue;
        items.push({
          id: `tiktok:${r.id}`,
          source: 'tiktok',
          url,
          title: clip(r.text, 140),
          description: clip(r.text, 600),
          author: r.authorMeta?.name ? `@${r.authorMeta.name}` : '',
          publishedAt: toIso(r.createTimeISO || r.createTime),
          thumbnail: safeUrl(r.videoMeta?.coverUrl || r.covers?.[0]),
          stats: { views: r.playCount || 0, likes: r.diggCount || 0, comments: r.commentCount || 0 },
        });
      }
    } catch (e) {
      errors.push(`apify: ${e.message}`);
    }
  } else if ((cfg.hashtags || []).length) {
    errors.push('APIFY_TOKEN not set — TikTok hashtag search skipped (curated URLs still used)');
  }
  return { items, errors };
}
