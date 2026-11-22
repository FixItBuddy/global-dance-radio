// Shared data model for feed items.
export const KINDS = ['tip', 'walkthrough', 'secret', 'collectible', 'special', 'news', 'other'];
// safe = no story info; mild = minor reveals (mission names, locations); major = plot/ending/character fates.
// unknown = could not be judged; the app treats it exactly like major.
export const SPOILER_LEVELS = ['safe', 'mild', 'major', 'unknown'];
export const SOURCES = ['youtube', 'tiktok', 'reddit', 'news', 'site'];

const GTA_RE = /\b(gta\s*-?\s*(6|vi)|gtavi|gta6|grand\s+theft\s+auto\s*:?\s*(6|vi)|leonida)\b/i;
export const mentionsGta = (text) => GTA_RE.test(String(text ?? ''));

export const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

/** Fill defaults so every stored item has the same shape. */
export function makeItem(o) {
  return {
    id: o.id,
    source: oneOf(o.source, SOURCES, 'news'),
    url: o.url,
    title: o.title || '(untitled)',
    description: o.description || '',
    author: o.author || '',
    publishedAt: o.publishedAt || null,
    fetchedAt: o.fetchedAt || new Date().toISOString(),
    thumbnail: o.thumbnail || null,
    stats: o.stats || {},
    // Source-asserted spoiler flag (e.g. Reddit's own spoiler tag); enrichment may only raise, never lower it.
    spoilerFloor: o.spoilerFloor || null,
    trusted: !!o.trusted, // trusted sources (dedicated subreddit/channel) skip the "mentions GTA VI" filter
    kind: oneOf(o.kind, KINDS, 'other'),
    spoiler: oneOf(o.spoiler, SPOILER_LEVELS, 'unknown'),
    spoilerWhy: o.spoilerWhy || '',
    summary: o.summary || '',
    area: o.area || '',
    tags: o.tags || [],
    availability: o.availability || null, // {from, until, note} — ISO dates, either may be null
    enriched: o.enriched || null, // 'claude' | 'heuristic'
    trend: o.trend || 0,
  };
}

const RANK = { safe: 0, mild: 1, major: 2, unknown: 3 };
/** Returns the more restrictive of two spoiler levels. */
export const stricter = (a, b) => (RANK[a] ?? 3) >= (RANK[b] ?? 3) ? a : b;
