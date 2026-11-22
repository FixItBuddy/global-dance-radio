import {
  MODES, normMode, KIND_LABELS, filterItems, availabilityStatus, expiringSoon, isNew, alertCandidates,
  trackerView, parseMuted, fmtAgo, fmtCount, safeHref, escapeHtml as e,
} from './logic.js';

// ---------- persistence (all wrapped: storage can be unavailable) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const state = {
  tab: 'feed',
  items: [], coll: { categories: [] }, meta: null, loadError: false,
  prefs: { mode: 'none', blur: true, muted: [], notify: false, ...store.get('gta6.prefs', {}) },
  checked: store.get('gta6.checked', {}),
  since: store.get('gta6.lastVisit', 0), // baseline for "NEW" badges, fixed for this session
  f: { kind: 'all', source: 'all', query: '', sort: 'trend', limit: 60 },
  hideDone: false,
};
state.prefs.mode = normMode(state.prefs.mode);

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const savePrefs = () => store.set('gta6.prefs', state.prefs);

// ---------- data ----------
async function getJson(path) {
  const r = await fetch(`${path}?t=${Math.floor(Date.now() / 6e4)}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function loadData() {
  try {
    const [items, coll, meta] = await Promise.all([getJson('data/items.json'), getJson('data/collectibles.json'), getJson('data/meta.json')]);
    state.items = items.items || [];
    state.coll = coll;
    state.meta = meta;
    state.loadError = false;
  } catch {
    state.loadError = true;
  }
  renderChrome();
  renderView();
}

// ---------- chrome: mode switch, freshness, banner ----------
function renderChrome() {
  $('#modeSeg').innerHTML = Object.entries(MODES)
    .map(([k, m]) => `<button role="radio" aria-checked="${state.prefs.mode === k}" data-mode="${k}" title="${e(m.hint)}">${e(m.label)}</button>`)
    .join('');
  const g = state.meta?.generatedAt;
  const age = g ? Date.now() - Date.parse(g) : null;
  const fresh = $('#fresh');
  fresh.textContent = g ? `Updated ${fmtAgo(g)}` : 'No data yet';
  fresh.classList.toggle('stale', age == null || age > 3 * 36e5);
  const b = $('#banner');
  let msg = '';
  if (state.loadError) msg = 'Could not load content. You may be offline — showing what was last available.';
  else if (!g) msg = 'No content has been collected yet. Run the ingestion job (see README) to start filling the feed.';
  else if (age > 6 * 36e5) msg = `The content feed hasn't refreshed for ${fmtAgo(g).replace(' ago', '')}. The scheduled job may be failing — check Settings → Sources.`;
  b.hidden = !msg;
  b.textContent = msg;
}

// ---------- feed ----------
const SOURCE_LABEL = { youtube: 'YouTube', tiktok: 'TikTok', reddit: 'Reddit', news: 'News', site: 'Guide' };

function card(it, hot) {
  const href = safeHref(it.url);
  const img = safeHref(it.thumbnail);
  const status = availabilityStatus(it);
  const blur = state.prefs.blur && state.prefs.mode !== 'all';
  const meta = [it.author, fmtAgo(it.publishedAt || it.fetchedAt), it.stats?.views ? `${fmtCount(it.stats.views)} views` : it.stats?.score ? `${fmtCount(it.stats.score)} pts` : ''].filter(Boolean).join(' · ');
  const spoilerLabel = { safe: 'Spoiler-free', mild: 'Mild spoilers', major: 'Spoilers', unknown: 'Unchecked' }[it.spoiler] || 'Unchecked';
  return `<article class="card${img ? '' : ' noimg'}">
    ${img ? `<a class="thumb${blur ? ' blur' : ''}" href="${e(href)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${e(it.title)}"><img src="${e(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="src">${e(SOURCE_LABEL[it.source] || it.source)}</span></a>` : ''}
    <div>
      <div class="pills">
        ${hot ? '<span class="pill hot">🔥 Trending</span>' : ''}
        ${isNew(it, state.since) ? '<span class="pill new">New</span>' : ''}
        <span class="pill">${e(KIND_LABELS[it.kind] || 'Other')}</span>
        <span class="pill ${e(it.spoiler)}">${e(spoilerLabel)}</span>
        ${status === 'live' ? `<span class="pill ${expiringSoon(it) ? 'soon' : 'live'}">${expiringSoon(it) ? 'Ending soon' : 'Live now'}</span>` : ''}
        ${status === 'upcoming' ? '<span class="pill up">Upcoming</span>' : ''}
      </div>
      <h3>${href ? `<a href="${e(href)}" target="_blank" rel="noopener noreferrer">${e(it.title)}</a>` : e(it.title)}</h3>
      ${it.summary ? `<p class="sum">${e(it.summary)}</p>` : ''}
      <div class="foot">${e(meta)}${it.area ? ` · 📍 ${e(it.area)}` : ''}</div>
    </div>
  </article>`;
}

function feedListHtml() {
  const { f, prefs } = state;
  const { shown, hidden } = filterItems(state.items, { mode: prefs.mode, kind: f.kind, source: f.source, query: f.query, muted: prefs.muted, sort: f.sort });
  const hotIds = new Set([...state.items].filter((i) => Date.now() - Date.parse(i.publishedAt || i.fetchedAt) < 48 * 36e5 && i.trend > 0).sort((a, b) => b.trend - a.trend).slice(0, 5).map((i) => i.id));
  const page = shown.slice(0, f.limit);
  let html = '';
  if (hidden > 0) html += `<p class="note">🛡️ ${hidden} item${hidden === 1 ? '' : 's'} hidden by <b>${e(MODES[prefs.mode].label)}</b> mode.</p>`;
  if (!shown.length) {
    html += state.items.length
      ? `<div class="empty"><b>Nothing to show.</b><br>Try another filter${hidden ? ', or loosen spoiler protection in the header' : ''}.</div>`
      : `<div class="empty"><b>The feed is empty.</b><br>Once the ingestion job has run, trending tips, secrets and guides appear here.</div>`;
  } else {
    html += page.map((i) => card(i, hotIds.has(i.id) && f.sort === 'trend')).join('');
    if (shown.length > page.length) html += `<p style="text-align:center"><button class="btn ghost" data-act="more">Show more (${shown.length - page.length})</button></p>`;
  }
  return html;
}

function renderFeed() {
  const { f } = state;
  const kinds = ['all', 'tip', 'secret', 'collectible', 'special', 'walkthrough', 'news'];
  view.innerHTML = `<div class="tools">
    <input type="search" id="q" placeholder="Search tips, secrets, guides…" value="${e(f.query)}" aria-label="Search">
    <div class="chips" role="group" aria-label="Type">${kinds.map((k) => `<button class="chip" data-kind="${k}" aria-pressed="${f.kind === k}">${k === 'all' ? 'All' : e(KIND_LABELS[k])}</button>`).join('')}</div>
    <div class="row">
      <select id="sort" aria-label="Sort"><option value="trend"${f.sort === 'trend' ? ' selected' : ''}>Trending</option><option value="new"${f.sort === 'new' ? ' selected' : ''}>Newest</option></select>
      <select id="source" aria-label="Source"><option value="all">All sources</option>${Object.entries(SOURCE_LABEL).map(([k, v]) => `<option value="${k}"${f.source === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    </div></div><div id="list">${feedListHtml()}</div>`;
}
const updateList = () => { const l = $('#list'); if (l) l.innerHTML = feedListHtml(); };

// ---------- live (time-limited) ----------
function renderLive() {
  const { mode, muted } = state.prefs;
  const { shown } = filterItems(state.items.filter((i) => i.availability), { mode, muted, sort: 'new' });
  const now = Date.now();
  const groups = { live: [], upcoming: [] };
  for (const i of shown) { const s = availabilityStatus(i, now); if (groups[s]) groups[s].push(i); }
  groups.live.sort((a, b) => (Date.parse(a.availability.until) || Infinity) - (Date.parse(b.availability.until) || Infinity));
  const row = (i) => `${card(i, false)}${i.availability.until ? `<p class="note" style="margin-top:-4px">Ends ${e(new Date(i.availability.until).toLocaleString())}${i.availability.note ? ` — ${e(i.availability.note)}` : ''}</p>` : i.availability.note ? `<p class="note" style="margin-top:-4px">${e(i.availability.note)}</p>` : ''}`;
  // time-limited tracker entries too
  const limited = trackerView(state.coll.categories || [], state.checked, { mode, muted })
    .flatMap((c) => c.items.filter((x) => x.availableUntil && Date.parse(x.availableUntil) > now && !state.checked[x.id]).map((x) => ({ ...x, cat: c.name })));
  view.innerHTML = `<h2 class="sec" style="margin-top:4px">Available now</h2>${groups.live.length ? groups.live.map(row).join('') : '<div class="empty">No time-limited secrets, collectibles or events are live right now.</div>'}
    ${limited.length ? `<h2 class="sec">Time-limited collectibles you haven't got</h2>${limited.map((x) => `<div class="panel"><b>${e(x.name)}</b> <span class="pill soon">Until ${e(new Date(x.availableUntil).toLocaleDateString())}</span><p>${e(x.cat)}${x.area ? ` · 📍 ${e(x.area)}` : ''}</p></div>`).join('')}` : ''}
    ${groups.upcoming.length ? `<h2 class="sec">Coming up</h2>${groups.upcoming.map(row).join('')}` : ''}`;
}

// ---------- tracker ----------
function renderTracker() {
  const cats = trackerView(state.coll.categories || [], state.checked, { mode: state.prefs.mode, hideDone: state.hideDone, muted: state.prefs.muted });
  const open = new Set(store.get('gta6.open', []));
  const total = cats.reduce((n, c) => n + c.total, 0), done = cats.reduce((n, c) => n + c.done, 0);
  const body = cats.length ? cats.map((c) => `<details class="cat" data-cat="${e(c.id)}"${open.has(c.id) ? ' open' : ''}>
      <summary><div class="name"><span>${e(c.name)}</span><span>${c.done}/${c.total}</span></div><div class="bar"><i style="width:${c.total ? Math.round((c.done / c.total) * 100) : 0}%"></i></div>
        ${c.hiddenBySpoiler ? `<span class="foot">🛡️ ${c.hiddenBySpoiler} hidden by spoiler mode</span>` : ''}</summary>
      ${c.items.map((x) => `<label class="entry${state.checked[x.id] ? ' done' : ''}"><input type="checkbox" data-id="${e(x.id)}"${state.checked[x.id] ? ' checked' : ''}><span><span class="t">${e(x.name)}</span>
        ${isNew(x, state.since) ? ' <span class="pill new">New</span>' : ''}${x.availableUntil ? ` <span class="pill soon">Until ${e(new Date(x.availableUntil).toLocaleDateString())}</span>` : ''}
        <span class="d" style="display:block">${x.area ? `📍 ${e(x.area)}${x.description ? ' · ' : ''}` : ''}${e(x.description)}</span></span></label>`).join('')}
    </details>`).join('')
    : `<div class="empty"><b>No collectibles tracked yet.</b><br>They're extracted from your seed guide sites (config/sources.json → sites) by the ingestion job.</div>`;
  view.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><b>${done} / ${total} collected</b>
    <label class="row" style="font-size:.85rem"><input type="checkbox" id="hideDone"${state.hideDone ? ' checked' : ''}> Hide collected</label></div>${body}`;
}

// ---------- settings ----------
function renderSettings() {
  const p = state.prefs, m = state.meta;
  const src = m?.sourceStatus || {};
  const notifState = 'Notification' in window ? Notification.permission : 'unsupported';
  view.innerHTML = `
  <div class="panel"><h3>Spoiler protection</h3>
    ${Object.entries(MODES).map(([k, v]) => `<label class="opt"><input type="radio" name="mode" value="${k}"${p.mode === k ? ' checked' : ''}><span><b>${e(v.label)}</b><small>${e(v.hint)}</small></span></label>`).join('')}
    <label class="opt"><input type="checkbox" id="blur"${p.blur ? ' checked' : ''}><span><b>Blur thumbnails until tapped</b><small>Video thumbnails can show story scenes even on spoiler-free items.</small></span></label>
    <p>Content is graded ${m?.aiEnrichment ? 'by AI' : 'by a keyword fallback (no AI key configured — stricter, so more gets hidden)'}. Anything that can't be confirmed spoiler-free is hidden in No&nbsp;spoilers mode.</p></div>
  <div class="panel"><h3>Mute words</h3><p>Hide anything mentioning these (character names, places, missions…). Comma-separated.</p>
    <textarea id="muted" rows="2" placeholder="e.g. ending, character name">${e(p.muted.join(', '))}</textarea></div>
  <div class="panel"><h3>Alerts</h3>
    <p>New secrets, collectibles and special events can notify you while the app is open. For phone alerts when it's closed, subscribe to your ntfy topic (see README) — those never contain spoilers.</p>
    <button class="btn" id="notif" ${notifState === 'unsupported' || notifState === 'denied' ? 'disabled' : ''}>${p.notify && notifState === 'granted' ? 'In-app alerts on ✓' : notifState === 'denied' ? 'Blocked in browser settings' : notifState === 'unsupported' ? 'Not supported here' : 'Enable in-app alerts'}</button></div>
  <div class="panel"><h3>Your progress</h3><p>Collectible progress is stored on this device only.</p>
    <div class="row"><button class="btn ghost" id="export">Export</button><button class="btn ghost" id="import">Import</button><input type="file" id="file" accept="application/json" hidden></div></div>
  <div class="panel"><h3>Sources</h3>
    ${m?.generatedAt ? `<p>Last run ${e(fmtAgo(m.generatedAt))} · ${m.totals?.items ?? 0} items · ${m.totals?.collectibles ?? 0} collectibles</p>
    <table class="src-t">${Object.entries(src).map(([k, s]) => `<tr><td><b>${e(k)}</b></td><td class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '●' : '✕'}</td><td>${s.count} items${s.lastOkAt ? ` · last good ${e(fmtAgo(s.lastOkAt))}` : ''}${(s.errors || []).map((x) => `<br><span class="foot">${e(x)}</span>`).join('')}</td></tr>`).join('')}</table>` : '<p>No ingestion run yet.</p>'}</div>`;
}

// ---------- rendering + events ----------
function renderView() {
  ({ feed: renderFeed, live: renderLive, tracker: renderTracker, settings: renderSettings })[state.tab]();
}
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => (b.getAttribute('data-tab') === t ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  renderView();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (ev) => {
  const t = ev.target;
  const tab = t.closest('[data-tab]'); if (tab) return setTab(tab.dataset.tab);
  const mode = t.closest('[data-mode]'); if (mode) { state.prefs.mode = normMode(mode.dataset.mode); savePrefs(); renderChrome(); return renderView(); }
  const thumb = t.closest('.thumb.blur'); if (thumb) { ev.preventDefault(); return thumb.classList.remove('blur'); }
  const kind = t.closest('[data-kind]'); if (kind) { state.f.kind = kind.dataset.kind; state.f.limit = 60; return renderFeed(); }
  if (t.closest('[data-act="more"]')) { state.f.limit += 60; return updateList(); }
  if (t.id === 'notif') return enableNotifications();
  if (t.id === 'export') return exportProgress();
  if (t.id === 'import') return $('#file').click();
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'q') { state.f.query = t.value; state.f.limit = 60; updateList(); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'sort') { state.f.sort = t.value; updateList(); }
  else if (t.id === 'source') { state.f.source = t.value; updateList(); }
  else if (t.name === 'mode') { state.prefs.mode = normMode(t.value); savePrefs(); renderChrome(); }
  else if (t.id === 'blur') { state.prefs.blur = t.checked; savePrefs(); }
  else if (t.id === 'muted') { state.prefs.muted = parseMuted(t.value); savePrefs(); }
  else if (t.id === 'hideDone') { state.hideDone = t.checked; renderTracker(); }
  else if (t.matches('.entry input')) {
    if (t.checked) state.checked[t.dataset.id] = true; else delete state.checked[t.dataset.id];
    store.set('gta6.checked', state.checked);
    const open = [...document.querySelectorAll('details.cat[open]')].map((d) => d.dataset.cat);
    store.set('gta6.open', open);
    renderTracker();
  } else if (t.id === 'file') importProgress(t.files[0]);
});
document.addEventListener('toggle', (ev) => {
  if (ev.target.matches?.('details.cat')) store.set('gta6.open', [...document.querySelectorAll('details.cat[open]')].map((d) => d.dataset.cat));
}, true);

function exportProgress() {
  const blob = new Blob([JSON.stringify({ checked: state.checked, prefs: state.prefs }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'gta6-progress.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importProgress(file) {
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (d.checked && typeof d.checked === 'object') { state.checked = Object.fromEntries(Object.entries(d.checked).filter(([, v]) => v === true)); store.set('gta6.checked', state.checked); }
    if (d.prefs?.mode) { state.prefs.mode = normMode(d.prefs.mode); savePrefs(); renderChrome(); }
    alert('Progress imported.');
  } catch { alert('That file could not be read.'); }
}

// ---------- notifications ----------
async function enableNotifications() {
  if (!('Notification' in window)) return;
  const r = await Notification.requestPermission();
  state.prefs.notify = r === 'granted';
  savePrefs();
  renderSettings();
}
async function notify(title, body) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { body, icon: 'icon-192.png', tag: 'gta6-' + title });
    new Notification(title, { body, icon: 'icon-192.png' });
  } catch { /* ignore */ }
}
function alertNew(prevItems) {
  if (!prevItems.length || !state.prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const known = new Set(prevItems.map((i) => i.id));
  const fresh = alertCandidates(state.items.filter((i) => !known.has(i.id)), { mode: state.prefs.mode, since: 1, muted: state.prefs.muted });
  fresh.slice(0, 3).forEach((i) => notify(`New GTA VI ${KIND_LABELS[i.kind].toLowerCase()}`, i.summary || i.title));
}

// ---------- boot ----------
async function poll() {
  try {
    const meta = await getJson('data/meta.json');
    if (meta.generatedAt && meta.generatedAt !== state.meta?.generatedAt) {
      const prev = state.items;
      await loadData();
      alertNew(prev);
    } else renderChrome();
  } catch { /* offline: keep what we have */ }
}

renderChrome();
renderView();
loadData();
setInterval(poll, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.set('gta6.lastVisit', Date.now());
  else poll();
});
addEventListener('pagehide', () => store.set('gta6.lastVisit', Date.now()));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
