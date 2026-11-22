import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedBySpoiler, normMode, filterItems, availabilityStatus, expiringSoon, isNew, alertCandidates,
  trackerView, parseMuted, fmtAgo, fmtCount, safeHref, escapeHtml,
} from '../app/logic.js';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const mk = (o) => ({ id: o.id || Math.random().toString(36), title: 't', summary: '', description: '', author: '', tags: [], kind: 'tip', source: 'youtube', spoiler: 'safe', trend: 1, publishedAt: '2026-11-22T00:00:00Z', fetchedAt: '2026-11-22T00:00:00Z', ...o });

test('No-spoilers mode only ever admits "safe"', () => {
  assert.ok(allowedBySpoiler('safe', 'none'));
  for (const s of ['mild', 'major', 'unknown', undefined, null, '', 'SAFE', 'bogus']) assert.ok(!allowedBySpoiler(s, 'none'), String(s));
});

test('Light mode admits safe+mild but not major/unknown', () => {
  assert.ok(allowedBySpoiler('mild', 'light'));
  assert.ok(!allowedBySpoiler('major', 'light'));
  assert.ok(!allowedBySpoiler('unknown', 'light'));
  assert.ok(!allowedBySpoiler(undefined, 'light'));
});

test('a corrupted saved mode falls back to the safest mode', () => {
  for (const m of ['hacked', undefined, null, '__proto__', 'toString', 'constructor']) {
    assert.equal(normMode(m), 'none', String(m));
    assert.ok(!allowedBySpoiler('major', m), String(m));
  }
});

test('filterItems: spoiler gate, hidden count, and filters compose', () => {
  const items = [mk({ id: 'a', title: 'Cash tips', spoiler: 'safe', trend: 5 }), mk({ id: 'b', title: 'Cash ending', spoiler: 'major', trend: 9 }), mk({ id: 'c', title: 'Unchecked cash', spoiler: 'unknown' }), mk({ id: 'd', kind: 'news', title: 'News', spoiler: 'safe' })];
  const r = filterItems(items, { mode: 'none', query: 'cash' });
  assert.deepEqual(r.shown.map((i) => i.id), ['a']);
  assert.equal(r.hidden, 2);
  assert.equal(filterItems(items, { mode: 'all', query: 'cash' }).shown.length, 3);
  assert.deepEqual(filterItems(items, { mode: 'all', kind: 'news' }).shown.map((i) => i.id), ['d']);
  assert.equal(filterItems(items, { mode: 'none', kind: 'news' }).hidden, 0, 'hidden only counts items matching other filters');
});

test('filterItems sorts by trend or recency', () => {
  const items = [mk({ id: 'old-hot', trend: 9, publishedAt: '2026-10-01T00:00:00Z' }), mk({ id: 'new-cold', trend: 1, publishedAt: '2026-11-22T00:00:00Z' })];
  assert.equal(filterItems(items, { mode: 'all', sort: 'trend' }).shown[0].id, 'old-hot');
  assert.equal(filterItems(items, { mode: 'all', sort: 'new' }).shown[0].id, 'new-cold');
});

test('muted words hide matches across title, summary, tags and author', () => {
  const muted = parseMuted('Lucia, ,boss fight\nLUCIA');
  assert.deepEqual(muted, ['lucia', 'boss fight']);
  const items = [mk({ id: 'a', title: 'About Lucia' }), mk({ id: 'b', tags: ['boss fight'] }), mk({ id: 'c', summary: 'clean' }), mk({ id: 'd', author: 'LuciaFan' })];
  assert.deepEqual(filterItems(items, { mode: 'all', muted }).shown.map((i) => i.id), ['c']);
});

test('availability windows', () => {
  const live = mk({ availability: { from: '2026-11-20T00:00:00Z', until: '2026-11-23T00:00:00Z' } });
  assert.equal(availabilityStatus(live, NOW), 'live');
  assert.ok(expiringSoon(live, NOW));
  assert.equal(availabilityStatus(mk({ availability: { from: '2026-12-01T00:00:00Z', until: null } }), NOW), 'upcoming');
  assert.equal(availabilityStatus(mk({ availability: { from: null, until: '2026-11-01T00:00:00Z' } }), NOW), 'expired');
  assert.equal(availabilityStatus(mk({ availability: { from: null, until: null } }), NOW), null);
  assert.equal(availabilityStatus(mk({}), NOW), null);
  assert.ok(!expiringSoon(mk({ availability: { from: null, until: '2026-12-30T00:00:00Z' } }), NOW));
});

test('alert candidates respect kind, newness, spoiler mode and muted words', () => {
  const since = Date.parse('2026-11-21T00:00:00Z');
  const items = [
    mk({ id: 'ok', kind: 'secret', spoiler: 'safe' }),
    mk({ id: 'spoiler', kind: 'secret', spoiler: 'major' }),
    mk({ id: 'tip', kind: 'tip' }),
    mk({ id: 'old', kind: 'secret', fetchedAt: '2026-11-01T00:00:00Z' }),
    mk({ id: 'muted', kind: 'special', title: 'lucia event' }),
  ];
  assert.deepEqual(alertCandidates(items, { mode: 'none', since, muted: ['lucia'] }).map((i) => i.id), ['ok']);
  assert.ok(!isNew(items[0], 0), 'no NEW badges on a first-ever visit');
});

test('trackerView applies the spoiler gate to entries and reports progress', () => {
  const cats = [{ id: 'c', name: 'Cat', items: [{ id: '1', name: 'a', spoiler: 'safe' }, { id: '2', name: 'b', spoiler: 'major' }, { id: '3', name: 'c', spoiler: 'safe' }] }];
  const v = trackerView(cats, { 1: true }, { mode: 'none' })[0];
  assert.equal(v.total, 2);
  assert.equal(v.done, 1);
  assert.equal(v.hiddenBySpoiler, 1);
  assert.equal(trackerView(cats, { 1: true }, { mode: 'none', hideDone: true })[0].items.length, 1);
  assert.equal(trackerView(cats, {}, { mode: 'all' })[0].total, 3);
});

test('formatting helpers', () => {
  assert.equal(fmtCount(950), '950');
  assert.equal(fmtCount(1500), '1.5K');
  assert.equal(fmtCount(25000), '25K');
  assert.equal(fmtCount(2_300_000), '2.3M');
  assert.equal(fmtAgo('2026-11-22T11:30:00Z', NOW), '30m ago');
  assert.equal(fmtAgo('2026-11-21T12:00:00Z', NOW), '24h ago');
  assert.equal(fmtAgo('2026-11-10T12:00:00Z', NOW), '12d ago');
  assert.equal(fmtAgo('2026-11-20T12:00:00Z', NOW), '2d ago');
});

test('output safety: only http(s) links, HTML escaped', () => {
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://a.test/x'), 'https://a.test/x');
  assert.equal(escapeHtml('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});
