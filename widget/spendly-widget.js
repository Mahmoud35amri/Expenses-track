// Spendly widget for the Scriptable iOS app: small, medium, large and Lock Screen sizes.
// Setup: run this script once inside Scriptable and paste the link from Spendly's
// Settings → "Copy link for another device". The widget only reads your synced expenses.

const API = 'https://spendly-m35a.pages.dev/api/sync';
const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const LINK_STORE = 'spendly.widget.link';
const CACHE_FILE = 'spendly-widget-cache.json';
const REFRESH_MIN = 15;
const RECENT_ROWS = 5; // 4 when a monthly budget bar takes room in the large widget
const TIERS = { essential: 'Essential', lifestyle: 'Lifestyle', luxury: 'Luxury' };
// The server only stores categories that were added or edited, so the built-ins live here.
// Keep in sync with DEFAULT_CATEGORIES and DEFAULT_FIXED in app.js.
// Monthly bills (rent, subscriptions...) count in the month total but not in "Today".
const DEFAULT_FIXED = new Set(['rent', 'subs', 'bills']);
const DEFAULT_CATEGORIES = {
  groceries: ['Groceries', 'essential'], rent: ['Housing', 'essential'], bills: ['Bills', 'essential'],
  transport: ['Transport', 'essential'], fuel: ['Fuel', 'essential'], health: ['Health', 'essential'],
  food: ['Dining', 'lifestyle'], coffee: ['Coffee', 'lifestyle'], shopping: ['Shopping', 'lifestyle'],
  fun: ['Entertainment', 'lifestyle'], subs: ['Subscriptions', 'lifestyle'], travel: ['Travel', 'luxury'],
  tech: ['Electronics', 'luxury'], gifts: ['Gifts', 'luxury'], other: ['Other', 'lifestyle'],
};

// Same light/dark palette as styles.css.
const dyn = (light, dark, alpha = 1) => Color.dynamic(new Color(light, alpha), new Color(dark, alpha));
const C = {
  bg: dyn('#ffffff', '#1a1a1c'),
  text: dyn('#141414', '#f2f2f0'),
  text2: dyn('#5e5e5b', '#a6a6a2'),
  fill: Color.dynamic(new Color('#111111', 0.07), new Color('#ffffff', 0.1)),
  line: Color.dynamic(new Color('#111111', 0.08), new Color('#ffffff', 0.08)),
  onPrimary: dyn('#ffffff', '#111111'),
  danger: dyn('#c4372f', '#ef6b62'),
  good: dyn('#2f7d5b', '#5bbf8f'),
  essential: dyn('#2f7d6d', '#4fb39f'),
  lifestyle: dyn('#3c64c8', '#7b9cf0'),
  luxury: dyn('#b97a14', '#dda54a'),
};

// ---------- Data ----------
function parseLink(text) {
  const m = String(text || '').trim().match(/^(https:\/\/[^#\s]+)#link=([A-Za-z0-9_%-]+)$/);
  if (!m) return null;
  const key = decodeURIComponent(m[2]);
  return KEY_RE.test(key) ? { appUrl: m[1], key } : null;
}

// shortcut: downloads the full history on every refresh; keep a cursor in the cache if it ever gets slow.
async function pull(key) {
  const records = [];
  let since = 0;
  for (let page = 0; page < 100; page++) {
    const req = new Request(API);
    req.method = 'POST';
    req.timeoutInterval = 20;
    req.headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
    req.body = JSON.stringify({ since, changes: [] });
    const body = await req.loadJSON();
    if (req.response.statusCode !== 200) throw new Error(body && body.error ? body.error : 'Server error ' + req.response.statusCode);
    records.push(...body.records);
    since = body.cursor;
    if (!body.more) break;
  }
  return records;
}

async function loadRecords(key) {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.cacheDirectory(), CACHE_FILE);
  try {
    const records = await pull(key);
    fm.writeString(path, JSON.stringify(records));
    return { records, offline: false };
  } catch (e) {
    // Offline or server down: show the last good data instead of an error.
    if (fm.fileExists(path)) return { records: JSON.parse(fm.readString(path)), offline: true };
    throw e;
  }
}

// Same rule as allowanceFor in app.js: the month's own allowance, else the latest earlier month's, else the default budget.
function allowance(set, now) {
  const map = set.monthAllowances && typeof set.monthAllowances === 'object' ? set.monthAllowances : {};
  const k = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const own = Object.keys(map).filter((x) => /^\d{4}-\d{2}$/.test(x) && x <= k).sort().pop();
  return Number(own ? map[own] : set.monthlyBudget) || 0;
}

// The month bar's state, judged like the app's month analysis: over the allowance, or on pace to go over
// (bills paid + last month's bills not paid yet + day-to-day spending so far, stretched over the month).
function pace(s, now) {
  if (s.month > s.budget) return 'over';
  if (now.getDate() < 5) return 'ok'; // the app waits 5 days before forecasting
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return s.bills + s.upcoming + ((s.month - s.bills) / now.getDate()) * days > s.budget ? 'ahead' : 'ok';
}

function summarize(records, now) {
  const cats = {};
  for (const [id, [name, tier]] of Object.entries(DEFAULT_CATEGORIES)) cats[id] = { name, tier, fixed: DEFAULT_FIXED.has(id) };
  let cur = 'TND';
  let set = {};
  const expenses = [];
  for (const r of records) {
    const d = r.data || {};
    if (r.kind === 'category') {
      if (r.deleted) delete cats[r.id];
      else cats[r.id] = { name: String(d.name || 'Category'), tier: TIERS[d.tier] ? d.tier : 'lifestyle', fixed: d.fixed === undefined ? DEFAULT_FIXED.has(r.id) : !!d.fixed };
    } else if (r.kind === 'settings' && !r.deleted) {
      cur = d.currency && d.currency !== '$' ? String(d.currency) : 'TND';
      set = d;
    } else if (r.kind === 'expense' && !r.deleted) {
      const ts = new Date(d.ts);
      if (!isNaN(ts)) expenses.push({ amount: Number(d.amount) || 0, catId: String(d.catId || ''), ts, note: String(d.note || '') });
    }
  }
  const items = expenses.map((e) => ({ ...e, ...(cats[e.catId] || { name: 'Uncategorized', tier: 'lifestyle' }) }));
  const s = { cur, budget: allowance(set, now), today: 0, month: 0, bills: 0, upcoming: 0, tiers: { essential: 0, lifestyle: 0, luxury: 0 } };
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastBills = {}; // last month's bills by category: expected again this month until paid
  const paidCats = new Set();
  for (const e of items) {
    if (e.fixed && e.ts.getFullYear() === prev.getFullYear() && e.ts.getMonth() === prev.getMonth()) lastBills[e.catId] = (lastBills[e.catId] || 0) + e.amount;
    if (e.ts.getFullYear() !== now.getFullYear() || e.ts.getMonth() !== now.getMonth()) continue;
    s.month += e.amount;
    s.tiers[e.tier] += e.amount;
    if (e.fixed) { s.bills += e.amount; paidCats.add(e.catId); }
    if (e.ts.getDate() === now.getDate() && !e.fixed) s.today += e.amount;
  }
  for (const [id, v] of Object.entries(lastBills)) if (!paidCats.has(id)) s.upcoming += v;
  s.recent = items.sort((a, b) => b.ts - a.ts).slice(0, RECENT_ROWS);
  return s;
}

// Currency: TND uses 3 decimals (millimes) and multi-letter units go after the amount, as in the app.
function fmt(n, cur, compact) {
  const dec = /^(TND|DT|د\.ت)$/i.test(cur) ? 3 : 2;
  const v = Math.round(Math.abs(Number(n) || 0) * 10 ** dec) / 10 ** dec;
  const min = compact && Number.isInteger(v) ? 0 : dec;
  return (n < 0 ? '-' : '') + v.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: dec });
}
function money(n, cur, compact) { return cur.length > 1 ? `${fmt(n, cur, compact)} ${cur}` : cur + fmt(n, cur, compact); }

// ---------- Drawing ----------
function addText(stack, str, font, color, scale) {
  const t = stack.addText(str);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  if (scale) t.minimumScaleFactor = scale;
  return t;
}
function dot(stack, color, size = 8) {
  const d = stack.addStack();
  d.size = new Size(size, size);
  d.cornerRadius = size / 2;
  d.backgroundColor = color;
}
// Horizontal bar made of stacks (not an image) so its colors follow light/dark mode.
function bar(stack, parts, total, width, height) {
  const row = stack.addStack();
  row.size = new Size(width, height);
  row.cornerRadius = height / 2;
  row.backgroundColor = C.fill;
  for (const [value, color] of parts) {
    const w = total > 0 ? Math.floor((width * Math.min(value, total)) / total) : 0;
    if (w < 1) continue;
    const seg = row.addStack();
    seg.size = new Size(w, height);
    seg.backgroundColor = color;
  }
  row.addSpacer();
}

// Scripts can't read the widget's size, so estimate it from the screen width, rounding down so nothing clips.
function contentWidth(family) {
  const screen = Device.screenSize();
  return Math.floor(Math.min(screen.width, screen.height) * (family === 'small' ? 0.38 : 0.82)) - 28;
}

// Amounts below the big number skip the currency, which it already shows.
function totalsColumn(parent, s, now, offline, width, flexible) {
  const col = parent.addStack();
  col.layoutVertically();
  addText(col, offline ? 'Today · offline' : 'Today', Font.semiboldSystemFont(12), C.text2);
  col.addSpacer(2);
  const big = col.addStack();
  big.bottomAlignContent();
  big.spacing = 3;
  addText(big, s.cur.length > 1 ? fmt(s.today, s.cur) : money(s.today, s.cur), Font.boldRoundedSystemFont(28), C.text, 0.5);
  if (s.cur.length > 1) addText(big, s.cur, Font.semiboldSystemFont(13), C.text2);
  if (flexible) col.addSpacer(); else col.addSpacer(10);
  const month = now.toLocaleDateString(undefined, { month: 'long' });
  if (!(s.budget > 0)) {
    addText(col, month, Font.semiboldSystemFont(12), C.text2);
    col.addSpacer(1);
    addText(col, money(s.month, s.cur), Font.semiboldRoundedSystemFont(17), C.text, 0.6);
    return;
  }
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1; // counts today, as in the app
  addText(col, `${month} · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`, Font.semiboldSystemFont(12), C.text2, 0.7);
  col.addSpacer(5);
  const state = pace(s, now);
  bar(col, [[s.month, { over: C.danger, ahead: C.luxury, ok: C.good }[state]]], s.budget, width, 6); // C.luxury is the app's warning amber
  col.addSpacer(4);
  const left = state === 'over' ? 'Over by ' + fmt(s.month - s.budget, s.cur, true) : `${fmt(s.budget - s.month, s.cur, true)} left of ${fmt(s.budget, s.cur, true)}`;
  addText(col, left, Font.mediumSystemFont(13), state === 'over' ? C.danger : C.text, 0.7);
}

function tiersColumn(parent, s, appUrl, width) {
  const col = parent.addStack();
  col.layoutVertically();
  const head = col.addStack();
  head.centerAlignContent();
  head.size = new Size(width, 0);
  addText(head, 'By tier', Font.semiboldSystemFont(12), C.text2);
  head.addSpacer();
  const add = head.addStack();
  add.url = appUrl + '#add';
  add.backgroundColor = C.text;
  add.cornerRadius = 9;
  add.setPadding(3, 9, 3, 9);
  addText(add, '+ Add', Font.semiboldSystemFont(11), C.onPrimary);
  col.addSpacer(10);
  const keys = Object.keys(TIERS);
  bar(col, keys.map((k) => [s.tiers[k], C[k]]), s.month, width, 8);
  for (const k of keys) {
    col.addSpacer(7);
    const row = col.addStack();
    row.centerAlignContent();
    row.size = new Size(width, 0);
    dot(row, C[k]);
    row.addSpacer(6);
    addText(row, TIERS[k], Font.mediumSystemFont(13), C.text);
    row.addSpacer();
    addText(row, fmt(s.tiers[k], s.cur, true), Font.semiboldRoundedSystemFont(13), C.text, 0.7);
  }
}

function recentList(w, s, width) {
  w.addSpacer(12);
  const line = w.addStack();
  line.size = new Size(width, 1);
  line.backgroundColor = C.line;
  w.addSpacer(10);
  if (!s.recent.length) addText(w, 'No expenses yet', Font.mediumSystemFont(13), C.text2);
  const now = new Date();
  for (const e of s.recent.slice(0, s.budget > 0 ? RECENT_ROWS - 1 : RECENT_ROWS)) {
    const row = w.addStack();
    row.centerAlignContent();
    row.size = new Size(width, 0);
    dot(row, C[e.tier]);
    row.addSpacer(8);
    const mid = row.addStack();
    mid.layoutVertically();
    addText(mid, e.name, Font.semiboldSystemFont(13), C.text);
    const time = e.ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const when = e.ts.toDateString() === now.toDateString() ? time : e.ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + time;
    addText(mid, e.note ? `${when} · ${e.note}` : when, Font.systemFont(11), C.text2);
    row.addSpacer();
    addText(row, money(e.amount, s.cur), Font.semiboldRoundedSystemFont(13), C.text, 0.7);
    w.addSpacer(5);
  }
}

function accessory(w, family, s) {
  if (family === 'accessoryInline') {
    w.addText('Today ' + money(s.today, s.cur));
  } else if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText('Today');
    t.font = Font.mediumSystemFont(10);
    t.centerAlignText();
    const v = w.addText(fmt(s.today, s.cur, true));
    v.font = Font.boldRoundedSystemFont(14);
    v.minimumScaleFactor = 0.4;
    v.lineLimit = 1;
    v.centerAlignText();
  } else {
    const lines = [['Today ' + money(s.today, s.cur), Font.boldRoundedSystemFont(15)], ['Month ' + money(s.month, s.cur), Font.mediumSystemFont(13)]];
    if (s.budget > 0) lines.push([s.month > s.budget ? 'Over budget' : money(s.budget - s.month, s.cur, true) + ' left', Font.systemFont(12)]);
    for (const [str, font] of lines) {
      const t = w.addText(str);
      t.font = font;
      t.lineLimit = 1;
      t.minimumScaleFactor = 0.6;
    }
  }
  return w;
}

function message(w, str) {
  w.backgroundColor = C.bg;
  addText(w, 'Spendly', Font.boldRoundedSystemFont(15), C.text);
  w.addSpacer(4);
  const t = addText(w, str, Font.systemFont(12), C.text2);
  t.lineLimit = 4;
  return w;
}

async function buildWidget(family, link, now = new Date()) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60000);
  if (!link) return message(w, 'Open Scriptable and run this script to link it to Spendly.');
  w.url = link.appUrl;
  let data;
  try { data = await loadRecords(link.key); } catch (e) { return message(w, 'Could not load expenses: ' + e.message); }
  const s = summarize(data.records, now);
  if (family.startsWith('accessory')) return accessory(w, family, s);

  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);
  const width = contentWidth(family);
  if (family === 'small') {
    const wrap = w.addStack();
    totalsColumn(wrap, s, now, data.offline, width, true);
    wrap.addSpacer();
    return w;
  }
  const gap = 16;
  const left = Math.floor((width - gap) * 0.44);
  const top = w.addStack();
  totalsColumn(top, s, now, data.offline, left, family === 'medium');
  top.addSpacer(gap);
  tiersColumn(top, s, link.appUrl, width - gap - left);
  if (family !== 'medium') { recentList(w, s, width); w.addSpacer(); }
  return w;
}

// ---------- Setup inside the Scriptable app ----------
function readLink() {
  try { return Keychain.contains(LINK_STORE) ? JSON.parse(Keychain.get(LINK_STORE)) : null; } catch (_) { return null; }
}
async function askLink() {
  const a = new Alert();
  a.title = 'Link Spendly';
  a.message = 'In Spendly, open Settings and tap "Copy link for another device", then paste the link here.';
  a.addTextField('https://…#link=…');
  a.addAction('Save');
  a.addCancelAction('Cancel');
  if ((await a.presentAlert()) === -1) return null;
  const link = parseLink(a.textFieldValue(0));
  if (!link) {
    const err = new Alert();
    err.title = 'That link is not valid';
    err.message = 'Copy it again from Spendly → Settings → "Copy link for another device".';
    err.addAction('OK');
    await err.presentAlert();
    return null;
  }
  Keychain.set(LINK_STORE, JSON.stringify(link));
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), CACHE_FILE);
  if (fm.fileExists(cache)) fm.remove(cache); // cached data belongs to the previous link
  return link;
}
async function appMenu(link) {
  link = link || (await askLink());
  if (!link) return;
  const sizes = { small: 'presentSmall', medium: 'presentMedium', large: 'presentLarge' };
  const a = new Alert();
  a.title = 'Spendly widget';
  a.message = 'Linked to ' + link.appUrl + '\nLong-press your Home Screen, tap Edit → Add Widget → Scriptable, then choose this script.';
  Object.keys(sizes).forEach((f) => a.addAction('Preview ' + f));
  a.addAction('Change device link');
  a.addCancelAction('Done');
  const i = await a.presentSheet();
  const family = Object.keys(sizes)[i];
  if (family) await (await buildWidget(family, link))[sizes[family]]();
  else if (i !== -1) await askLink();
}

const link = readLink();
if (config.runsInWidget) Script.setWidget(await buildWidget(config.widgetFamily || 'small', link));
else if (config.runsInApp) await appMenu(link);
Script.complete();
