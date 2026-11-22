// Pure, DOM-free app logic (shared with the Node tests).

/** Spoiler modes. Anything unrecognised — including a corrupted saved setting — falls back to the safest mode. */
export const MODES = {
  none: { label: 'No spoilers', hint: 'Only content confirmed free of story information', allow: ['safe'] },
  light: { label: 'Light', hint: 'Also allows mild reveals (mission names, locations)', allow: ['safe', 'mild'] },
  all: { label: 'Everything', hint: 'Shows all content, including full walkthroughs and story details', allow: ['safe', 'mild', 'major', 'unknown'] },
};
export const normMode = (m) => (Object.hasOwn(MODES, m) ? m : 'none');

export function allowedBySpoiler(spoiler, mode) {
  const s = ['safe', 'mild', 'major'].includes(spoiler) ? spoiler : 'unknown'; // missing/odd value counts as unknown
  return MODES[normMode(mode)].allow.includes(s);
}

export const KIND_LABELS = { tip: 'Tip', walkthrough: 'Walkthrough', secret: 'Secret', collectible: 'Collectible', special: 'Special', news: 'News', other: 'Other' };
export const ALERT_KINDS = ['secret', 'collectible', 'special'];

const hay = (i) => [i.title, i.summary, i.description, i.author, i.area, ...(i.tags || [])].join(' ').toLowerCase();

export function parseMuted(text) {
  return [...new Set(String(text || '').split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean))];
}
export const isMuted = (item, words) => words.length > 0 && words.some((w) => hay(item).includes(w));

/**
 * Applies filters and the spoiler gate. `hidden` counts items that matched every other filter but were
 * withheld by the spoiler mode, so the UI can say so without revealing anything about them.
 */
export function filterItems(items, { mode = 'none', kind = 'all', source = 'all', query = '', muted = [], sort = 'trend' } = {}) {
  const q = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const pre = items.filter((i) => {
    if (kind !== 'all' && i.kind !== kind) return false;
    if (source !== 'all' && i.source !== source) return false;
    if (isMuted(i, muted)) return false;
    if (q.length) {
      const h = hay(i);
      if (!q.every((t) => h.includes(t))) return false;
    }
    return true;
  });
  const shown = pre.filter((i) => allowedBySpoiler(i.spoiler, mode));
  const key = sort === 'new' ? (i) => Date.parse(i.publishedAt || i.fetchedAt) || 0 : (i) => i.trend || 0;
  shown.sort((a, b) => key(b) - key(a));
  return { shown, hidden: pre.length - shown.length };
}

/** 'live' | 'upcoming' | 'expired' | null for time-limited items. */
export function availabilityStatus(item, now = Date.now()) {
  const a = item.availability;
  if (!a) return null;
  const from = a.from ? Date.parse(a.from) : null;
  const until = a.until ? Date.parse(a.until) : null;
  if (from == null && until == null) return null;
  if (from != null && from > now) return 'upcoming';
  if (until != null && until < now) return 'expired';
  return 'live';
}
export const expiringSoon = (item, now = Date.now(), withinHours = 72) => {
  const u = item.availability?.until ? Date.parse(item.availability.until) : null;
  return availabilityStatus(item, now) === 'live' && u != null && u - now < withinHours * 36e5;
};

export const isNew = (item, since) => since > 0 && Date.parse(item.fetchedAt) > since;

/** Items worth a notification: new secrets/collectibles/specials the user's spoiler mode permits. */
export function alertCandidates(items, { mode, since, muted = [] }) {
  return items.filter((i) => ALERT_KINDS.includes(i.kind) && isNew(i, since) && allowedBySpoiler(i.spoiler, mode) && !isMuted(i, muted));
}

/** Tracker categories restricted to what the spoiler mode allows, with progress counts. */
export function trackerView(categories, checked, { mode = 'none', hideDone = false, muted = [] } = {}) {
  return categories
    .map((c) => {
      const all = c.items.filter((e) => allowedBySpoiler(e.spoiler, mode) && !isMuted({ title: e.name, summary: e.description, area: e.area }, muted));
      const done = all.filter((e) => checked[e.id]).length;
      return { id: c.id, name: c.name, total: all.length, done, items: hideDone ? all.filter((e) => !checked[e.id]) : all, hiddenBySpoiler: c.items.length - all.length };
    })
    .filter((c) => c.total > 0 || c.hiddenBySpoiler > 0);
}

export function fmtAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 6e4));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
export function fmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Only http(s) links/images are ever rendered. */
export function safeHref(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch {
    return '';
  }
}
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
