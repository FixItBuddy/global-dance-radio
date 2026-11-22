// Trend score = engagement velocity: engagement / (age_hours + 2)^1.25. Newer + more engaged → higher.
import { ageHours } from './util.mjs';

export function engagement(it) {
  const s = it.stats || {};
  if (s.views) return s.views + 30 * (s.likes || 0) + 80 * (s.comments || 0);
  if (s.score || s.comments) return 40 * (s.score || 0) + 80 * (s.comments || 0);
  return it.source === 'news' || it.source === 'tiktok' ? 200 : 100; // no stats: rank mostly by recency
}

export function trendScore(it, now = Date.now()) {
  const h = Math.max(ageHours(it.publishedAt || it.fetchedAt, now), 1);
  return Math.round((engagement(it) / Math.pow(h + 2, 1.25)) * 100) / 100;
}
