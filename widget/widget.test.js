// Self-check for spendly-widget.js: runs it in Node against minimal fakes of the Scriptable API.
// The fakes only implement methods Scriptable really has, so a typo in a drawing call fails here.
// Run: node widget/widget.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'spendly-widget.js'), 'utf8');
const AsyncFunction = (async () => {}).constructor;

class Size { constructor(w, h) { Object.assign(this, { w, h }); } }
class Color { constructor(hex, alpha) { Object.assign(this, { hex, alpha }); } static dynamic(l, d) { return { l, d }; } }
const Font = Object.fromEntries(['systemFont', 'mediumSystemFont', 'semiboldSystemFont', 'boldRoundedSystemFont', 'semiboldRoundedSystemFont']
  .map((n) => [n, (size) => `${n}(${size})`]));
class WidgetText { constructor(text) { this.text = text; } leftAlignText() {} centerAlignText() {} rightAlignText() {} }
class WidgetStack {
  constructor() { this.children = []; }
  addText(t) { const x = new WidgetText(t); this.children.push(x); return x; }
  addStack() { const s = new WidgetStack(); this.children.push(s); return s; }
  addSpacer(n) { this.children.push({ spacer: n }); }
  layoutVertically() {} layoutHorizontally() {} topAlignContent() {} centerAlignContent() {} bottomAlignContent() {} setPadding() {}
}
class ListWidget extends WidgetStack { presentSmall() {} presentMedium() {} presentLarge() {} }
const texts = (node) => (node instanceof WidgetText ? [node.text] : (node.children || []).flatMap(texts));

function fakeFiles() {
  const files = {};
  return { local: () => ({
    cacheDirectory: () => '/cache', joinPath: (a, b) => a + '/' + b,
    writeString: (p, s) => { files[p] = s; }, readString: (p) => files[p], fileExists: (p) => p in files, remove: (p) => { delete files[p]; },
  }) };
}
// Each Request pops the next canned reply: { status, body } or an Error to simulate being offline.
function fakeRequest(replies, sent) {
  return class Request {
    constructor(url) { this.url = url; }
    async loadJSON() {
      sent.push({ url: this.url, method: this.method, headers: this.headers, body: JSON.parse(this.body) });
      const r = replies.shift();
      if (r instanceof Error) throw r;
      this.response = { statusCode: r.status || 200 };
      return r.body;
    }
  };
}

async function load({ replies = [], config = {}, screen = { width: 390, height: 844 }, keychain = {} } = {}) {
  const sent = [];
  const env = {
    config, Script: { setWidget: (w) => { env.widget = w; }, complete() {} },
    Keychain: { contains: (k) => k in keychain, get: (k) => keychain[k], set: (k, v) => { keychain[k] = v; } },
    Request: fakeRequest(replies, sent), FileManager: fakeFiles(), Device: { screenSize: () => screen },
    Size, Color, Font, ListWidget, Alert: class {},
  };
  const names = Object.keys(env).filter((k) => k !== 'widget');
  const run = new AsyncFunction(...names, SRC + '\nreturn { parseLink, pull, loadRecords, summarize, money, buildWidget };');
  const api = await run(...names.map((k) => env[k]));
  return { ...api, sent, env };
}

const KEY = 'abcdefghijklmnopqrstuvwxyz012345_-AB';
const LINK = { appUrl: 'https://mahmoud35amri.github.io/Expenses-track/', key: KEY };
const at = (d, h) => new Date(2026, 10, d, h).toISOString(); // November 2026, local time
const NOW = new Date(2026, 10, 3, 21);
const RECORDS = [
  { kind: 'expense', id: 'e1', deleted: false, data: { amount: 4.5, catId: 'coffee', ts: at(3, 9), note: '' } },
  { kind: 'expense', id: 'e2', deleted: false, data: { amount: 12.25, catId: 'groceries', ts: at(1, 10), note: '' } },
  { kind: 'expense', id: 'e3', deleted: false, data: { amount: 30, catId: 'chicha', ts: at(3, 20), note: 'cafe' } },
  { kind: 'expense', id: 'e4', deleted: false, data: { amount: 100, catId: 'travel', ts: new Date(2026, 9, 20).toISOString(), note: '' } },
  { kind: 'expense', id: 'e5', deleted: true, data: null },
  { kind: 'expense', id: 'e6', deleted: false, data: { amount: 1, catId: 'gone', ts: at(2, 8), note: '' } },
  { kind: 'category', id: 'chicha', deleted: false, data: { name: 'Chicha', icon: 'hookah', tier: 'lifestyle' } },
  { kind: 'category', id: 'fuel', deleted: true, data: null },
  { kind: 'settings', id: 'main', deleted: false, data: { currency: 'TND', monthlyBudget: 500 } },
];

(async () => {
  const w = await load();

  // Device link parsing
  assert.deepStrictEqual(w.parseLink(`  ${LINK.appUrl}#link=${KEY} `), LINK);
  assert.strictEqual(w.parseLink(`http://example.com/#link=${KEY}`), null, 'https only');
  assert.strictEqual(w.parseLink(`${LINK.appUrl}#link=short`), null, 'key too short');
  assert.strictEqual(w.parseLink(LINK.appUrl), null, 'no key');

  // Money formatting matches the app
  assert.strictEqual(w.money(1234.5, 'TND'), '1,234.500 TND');
  assert.strictEqual(w.money(3, 'TND', true), '3 TND');
  assert.strictEqual(w.money(3.5, '€'), '€3.50');

  // Totals: today, this month, tiers, budget, custom/deleted categories
  const s = w.summarize(RECORDS, NOW);
  assert.strictEqual(s.today, 34.5);
  assert.strictEqual(s.month, 47.75);
  assert.deepStrictEqual(s.tiers, { essential: 12.25, lifestyle: 35.5, luxury: 0 });
  assert.strictEqual(s.budget, 500);
  assert.deepStrictEqual(s.recent.map((e) => e.name), ['Chicha', 'Coffee', 'Uncategorized', 'Groceries', 'Travel']);

  // Monthly bills (rent by default, or any category marked fixed) count in the month but not in "Today"
  const today = NOW.toISOString();
  const withBills = [...RECORDS,
    { kind: 'expense', id: 'rent1', updatedAt: 9, data: { amount: 800, catId: 'rent', ts: today } },
    { kind: 'category', id: 'cGym', updatedAt: 9, data: { name: 'Gym', tier: 'lifestyle', icon: 'dumbbell', fixed: true } },
    { kind: 'expense', id: 'gym1', updatedAt: 9, data: { amount: 60, catId: 'cGym', ts: today } }];
  const sb = w.summarize(withBills, NOW);
  assert.strictEqual(sb.today, s.today, 'bills are not daily spending');
  assert.strictEqual(sb.month, s.month + 860, 'bills count in the month');

  // Pagination and auth header
  const p = await load({ replies: [{ body: { records: [RECORDS[0]], cursor: 7, more: true } }, { body: { records: [RECORDS[1]], cursor: 9, more: false } }] });
  assert.strictEqual((await p.pull(KEY)).length, 2);
  assert.deepStrictEqual(p.sent.map((r) => r.body), [{ since: 0, changes: [] }, { since: 7, changes: [] }]);
  assert.strictEqual(p.sent[0].headers.Authorization, 'Bearer ' + KEY);
  assert.strictEqual(p.sent[0].method, 'POST');
  const bad = await load({ replies: [{ status: 401, body: { error: 'unauthorized' } }] });
  await assert.rejects(bad.pull(KEY), /unauthorized/);

  // Offline: falls back to the last good data, errors only when there is none
  const off = await load({ replies: [{ body: { records: RECORDS, cursor: 1, more: false } }, new Error('offline'), new Error('offline')] });
  assert.strictEqual((await off.loadRecords(KEY)).offline, false);
  assert.deepStrictEqual(await off.loadRecords(KEY), { records: RECORDS, offline: true });
  await assert.rejects((await load({ replies: [new Error('offline')] })).loadRecords(KEY), /offline/);

  // Every size renders on a small and a large phone, with and without a budget
  const families = ['small', 'medium', 'large', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular'];
  const noBudget = RECORDS.filter((r) => r.kind !== 'settings');
  for (const screen of [{ width: 320, height: 568 }, { width: 440, height: 956 }]) {
    for (const records of [RECORDS, noBudget]) {
      for (const family of families) {
        const r = await load({ screen, replies: [{ body: { records, cursor: 1, more: false } }] });
        const widget = await r.buildWidget(family, LINK);
        const all = texts(widget).join(' | ');
        assert.match(all, /Today/, `${family} shows today`);
        if (family === 'large') assert.match(all, /Chicha/, 'large lists recent expenses');
        if (family === 'medium') assert.match(all, /Lifestyle/, 'medium shows tiers');
      }
    }
  }
  assert.match(texts(await w.buildWidget('small', null)).join(' '), /run this script/, 'asks for setup when not linked');

  // Running as a widget sets it; the link comes from the Keychain
  const live = await load({
    config: { runsInWidget: true, widgetFamily: 'medium' },
    keychain: { 'spendly.widget.link': JSON.stringify(LINK) },
    replies: [{ body: { records: RECORDS, cursor: 1, more: false } }],
  });
  assert.ok(live.env.widget instanceof ListWidget, 'Script.setWidget was called');
  assert.strictEqual(live.env.widget.url, LINK.appUrl);

  console.log('widget self-check passed');
})().catch((e) => { console.error(e); process.exit(1); });
