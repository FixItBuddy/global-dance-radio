// Keyword fallback classifier used when no Claude key is available (or the model call fails).
// Deliberately conservative: an item is only 'safe' when it is clearly tips/news-shaped AND has no spoiler terms.
import { clip } from '../lib/util.mjs';

const RX = {
  spoiler: /\b(ending|endings|final boss|spoilers?|plot|twist|dies|death of|killed|betray|full (game|story)|story (mode|missions?)|campaign|part\s*\d+|mission\s*\d+|chapter\s*\d+|all missions|100%|let'?s play|playthrough|walkthrough|no commentary|cutscenes?|leaked? (story|plot|ending))\b/i,
  walkthrough: /\b(walkthrough|playthrough|let'?s play|full game|part\s*\d+|mission\s*\d+|chapter\s*\d+|100%|no commentary)\b/i,
  secret: /\b(secrets?|easter eggs?|hidden|unlock(s|able)?|glitch(es)?|exploit|rare|undiscovered)\b/i,
  collectible: /\b(collectibles?|collectables?|all locations|location guide|packages?|hidden items?|treasure|trophy guide|achievements?)\b/i,
  special: /\b(events?|limited[- ]time|weekly|daily|bonus|double (rp|xp|money)|update|patch|dlc|season|free reward|promo)\b/i,
  tip: /\b(tips?|tricks?|how to|best way|beginner'?s?|guide|fast(est)?|make money|money|cheats?|things (to|you)|dont|don't|mistakes|settings|controls?|secrets? (to|for))\b/i,
  news: /\b(trailer|release date|delay(ed)?|announce(d|ment)?|report|rumou?rs?|leak|news|preorder|pre-order|price|rockstar (says|confirms))\b/i,
};

export function classify(item) {
  const text = `${item.title} ${item.description}`.slice(0, 1500);
  const hit = (k) => RX[k].test(text);

  let kind = 'other';
  if (hit('walkthrough')) kind = 'walkthrough';
  else if (hit('collectible')) kind = 'collectible';
  else if (hit('secret')) kind = 'secret';
  else if (hit('special')) kind = 'special';
  else if (hit('tip')) kind = 'tip';
  else if (hit('news') || item.source === 'news') kind = 'news';

  let spoiler = 'unknown';
  let why = 'keyword classifier could not confirm it is spoiler-free';
  if (kind === 'walkthrough' || hit('spoiler')) {
    spoiler = 'major';
    why = 'mentions story/mission progress terms';
  } else if (['tip', 'secret', 'collectible', 'special', 'news'].includes(kind)) {
    spoiler = 'safe';
    why = 'tips/news-style content with no story terms (unverified by AI)';
  }
  if (item.spoilerFloor === 'major') spoiler = 'major';

  return {
    kind,
    spoiler,
    spoilerWhy: why,
    summary: clip(item.description, 160),
    tags: [],
    area: '',
    availability: null,
    enriched: 'heuristic',
  };
}
