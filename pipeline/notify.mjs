// Phone alerts via ntfy (https://ntfy.sh) — free, no account; subscribe to your topic in the ntfy app.
// Alerts never leak spoilers: only 'safe'-graded items include their (spoiler-free) summary; everything
// else becomes a generic "something new — open the app" ping.
import { fetchText, clip } from './lib/util.mjs';

const LABEL = { secret: 'secret', collectible: 'collectible', special: 'special event' };
export const ALERT_KINDS = Object.keys(LABEL);

export function buildAlerts(newItems, { appUrl = '', max = 5 } = {}) {
  const alertable = newItems.filter((i) => ALERT_KINDS.includes(i.kind));
  const msgs = alertable.slice(0, max).map((i) => ({
    title: `New GTA VI ${LABEL[i.kind]}`,
    body: i.spoiler === 'safe' ? clip(i.summary || i.title, 140) : `A new ${LABEL[i.kind]} was reported. Open the app (spoiler-protected).`,
    tags: i.kind === 'special' ? 'alarm_clock' : i.kind === 'collectible' ? 'gem' : 'mag',
    click: appUrl,
  }));
  if (alertable.length > max) {
    msgs.push({ title: 'More GTA VI updates', body: `${alertable.length - max} more secrets/collectibles/specials. Open the app.`, tags: 'bell', click: appUrl });
  }
  return msgs;
}

export async function sendAlerts(msgs, { topic = process.env.NTFY_TOPIC, server = process.env.NTFY_SERVER || 'https://ntfy.sh' } = {}) {
  if (!topic || !msgs.length) return { sent: 0 };
  let sent = 0;
  for (const m of msgs) {
    const headers = { Title: m.title, Tags: m.tags };
    if (m.click) headers.Click = m.click;
    await fetchText(`${server}/${encodeURIComponent(topic)}`, { method: 'POST', body: m.body, headers, retries: 1 });
    sent++;
  }
  return { sent };
}
