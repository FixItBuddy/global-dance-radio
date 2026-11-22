// YouTube: (1) channel RSS feeds — free, no quota, include view counts; (2) Data API search + stats (needs YOUTUBE_API_KEY).
// Quota note: search.list costs 100 units; the default 10k/day allows ~100 searches, so keep queries few.
import { fetchText, fetchJson, parseFeed, toIso, clip } from '../lib/util.mjs';

const watch = (id) => `https://www.youtube.com/watch?v=${id}`;

export async function fetchYouTube(cfg = {}, { apiKey = process.env.YOUTUBE_API_KEY, now = Date.now() } = {}) {
  const items = [];
  const errors = [];

  // 1) Channel RSS
  for (const ch of cfg.channels || []) {
    try {
      const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(ch.id || ch)}`);
      for (const e of parseFeed(xml).slice(0, cfg.perChannel || 15)) {
        if (!e.id) continue;
        items.push({
          id: `youtube:${e.id}`,
          source: 'youtube',
          url: watch(e.id),
          title: e.title,
          description: clip(e.description, 600),
          author: e.author,
          publishedAt: toIso(e.published),
          thumbnail: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
          stats: { views: e.views, likes: e.likes },
          trusted: !!cfg.trustChannels,
        });
      }
    } catch (e) {
      errors.push(`channel ${ch.id || ch}: ${e.message}`);
    }
  }

  // 2) API search
  if (apiKey && (cfg.searchQueries || []).length) {
    const after = new Date(now - (cfg.publishedWithinDays || 30) * 864e5).toISOString();
    const ids = new Set();
    for (const q of cfg.searchQueries) {
      for (const order of cfg.orders || ['date', 'viewCount']) {
        try {
          const u = new URL('https://www.googleapis.com/youtube/v3/search');
          Object.entries({ part: 'id', type: 'video', q, order, maxResults: cfg.maxResultsPerQuery || 15, publishedAfter: after, relevanceLanguage: 'en', key: apiKey }).forEach(([k, v]) => u.searchParams.set(k, v));
          const data = await fetchJson(u.href);
          (data.items || []).forEach((it) => it.id?.videoId && ids.add(it.id.videoId));
        } catch (e) {
          errors.push(`search "${q}"/${order}: ${e.message}`);
        }
      }
    }
    const all = [...ids];
    for (let i = 0; i < all.length; i += 50) {
      try {
        const u = new URL('https://www.googleapis.com/youtube/v3/videos');
        Object.entries({ part: 'snippet,statistics,contentDetails', id: all.slice(i, i + 50).join(','), key: apiKey }).forEach(([k, v]) => u.searchParams.set(k, v));
        const data = await fetchJson(u.href);
        for (const v of data.items || []) {
          const th = v.snippet?.thumbnails || {};
          items.push({
            id: `youtube:${v.id}`,
            source: 'youtube',
            url: watch(v.id),
            title: v.snippet?.title,
            description: clip(v.snippet?.description, 600),
            author: v.snippet?.channelTitle,
            publishedAt: toIso(v.snippet?.publishedAt),
            thumbnail: (th.high || th.medium || th.default)?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            stats: { views: +v.statistics?.viewCount || 0, likes: +v.statistics?.likeCount || 0, comments: +v.statistics?.commentCount || 0 },
          });
        }
      } catch (e) {
        errors.push(`videos.list: ${e.message}`);
      }
    }
  } else if ((cfg.searchQueries || []).length) {
    errors.push('YOUTUBE_API_KEY not set — keyword search skipped (channel RSS still used)');
  }

  return { items, errors };
}
