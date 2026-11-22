// Reddit: uses OAuth app-only auth when REDDIT_CLIENT_ID/SECRET are set (recommended — unauthenticated
// requests from cloud IPs are frequently blocked), otherwise falls back to the public .json listings.
import { fetchJson, toIso, clip, safeUrl, UA } from '../lib/util.mjs';

async function getToken(id, secret) {
  const res = await fetchJson('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body: 'grant_type=client_credentials',
  });
  return res.access_token;
}

export async function fetchReddit(cfg = {}, { clientId = process.env.REDDIT_CLIENT_ID, clientSecret = process.env.REDDIT_CLIENT_SECRET } = {}) {
  const items = [];
  const errors = [];
  let token = null;
  if (clientId && clientSecret) {
    try { token = await getToken(clientId, clientSecret); } catch (e) { errors.push(`oauth: ${e.message} (falling back to public JSON)`); }
  }
  const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const headers = token ? { authorization: `bearer ${token}` } : {};

  for (const sub of cfg.subreddits || []) {
    for (const listing of cfg.listings || ['new', 'hot']) {
      try {
        const data = await fetchJson(`${base}/r/${encodeURIComponent(sub)}/${listing}.json?limit=${cfg.limit || 50}&raw_json=1`, { headers });
        for (const { data: p } of data?.data?.children || []) {
          if (p.stickied || p.over_18) continue;
          const thumb = safeUrl(p.preview?.images?.[0]?.source?.url) || safeUrl(p.thumbnail);
          const flair = p.link_flair_text || '';
          items.push({
            id: `reddit:${p.id}`,
            source: 'reddit',
            url: `https://www.reddit.com${p.permalink}`,
            title: p.title,
            description: clip(`${flair ? `[${flair}] ` : ''}${p.selftext || ''}`, 600),
            author: `r/${p.subreddit}`,
            publishedAt: toIso(p.created_utc),
            thumbnail: thumb,
            stats: { score: p.score || 0, comments: p.num_comments || 0 },
            // Respect the community's own spoiler marking — enrichment can only make this stricter.
            spoilerFloor: p.spoiler || /spoiler/i.test(flair) ? 'major' : null,
            trusted: !!cfg.trusted,
          });
        }
      } catch (e) {
        errors.push(`r/${sub}/${listing}: ${e.message}`);
      }
    }
  }
  return { items, errors };
}
