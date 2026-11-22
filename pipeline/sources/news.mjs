// News via RSS/Atom feeds listed in config/sources.json (Google News search feeds work well for "GTA VI").
import { fetchText, parseFeed, toIso, clip, sha, safeUrl } from '../lib/util.mjs';

export async function fetchNews(cfg = {}) {
  const items = [];
  const errors = [];
  for (const feed of cfg.feeds || []) {
    try {
      const xml = await fetchText(feed.url);
      for (const e of parseFeed(xml).slice(0, feed.limit || 30)) {
        const url = safeUrl(e.url);
        if (!url || !e.title) continue;
        items.push({
          id: `news:${sha(url)}`,
          source: 'news',
          url,
          title: e.title,
          description: clip(e.description?.replace(/<[^>]+>/g, ' '), 400),
          author: e.author || feed.name || '',
          publishedAt: toIso(e.published),
          stats: {},
          trusted: !!feed.trusted,
        });
      }
    } catch (err) {
      errors.push(`${feed.name || feed.url}: ${err.message}`);
    }
  }
  return { items, errors };
}
