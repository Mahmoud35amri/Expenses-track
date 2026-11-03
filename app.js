/* Spendly — local-first expense tracker (no build step, no server). */
(() => {
  'use strict';
  const icon = window.icon;

  // ---------- Constants ----------
  const STORE_KEY = 'spendly.v1';
  const TIERS = {
    essential: { name: 'Essential', hint: 'Needs', color: 'var(--t-essential)' },
    lifestyle: { name: 'Lifestyle', hint: 'Wants', color: 'var(--t-lifestyle)' },
    luxury:    { name: 'Luxury',    hint: 'Extras', color: 'var(--t-luxury)' },
  };
  const TIER_KEYS = Object.keys(TIERS);
  // Categories paid once a month: counted in monthly totals, left out of daily spending.
  const DEFAULT_FIXED = new Set(['rent', 'subs', 'bills']);
  const ENTRY_ACCOUNTS = new Set(['balance', 'savings']);
  const ENTRY_TYPES = new Set(['add', 'transfer', 'set']); // transfer = moved from balance into savings
  const DEFAULT_CATEGORIES = [
    ['groceries', 'cart', 'Groceries', 'essential'],
    ['rent', 'home', 'Housing', 'essential'],
    ['bills', 'bolt', 'Bills', 'essential'],
    ['transport', 'bus', 'Transport', 'essential'],
    ['fuel', 'fuel', 'Fuel', 'essential'],
    ['health', 'health', 'Health', 'essential'],
    ['food', 'utensils', 'Dining', 'lifestyle'],
    ['coffee', 'coffee', 'Coffee', 'lifestyle'],
    ['shopping', 'bag', 'Shopping', 'lifestyle'],
    ['fun', 'film', 'Entertainment', 'lifestyle'],
    ['subs', 'repeat', 'Subscriptions', 'lifestyle'],
    ['travel', 'plane', 'Travel', 'luxury'],
    ['tech', 'phone', 'Electronics', 'luxury'],
    ['gifts', 'gift', 'Gifts', 'luxury'],
    ['other', 'box', 'Other', 'lifestyle'],
  ].map(([id, ic, name, tier]) => ({ id, icon: ic, name, tier, fixed: DEFAULT_FIXED.has(id) }));
  const LEGACY_ICON = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.icon]));

  // ---------- State ----------
  const state = load();
  let tab = 'today';
  let monthCursor = startOfMonth(new Date());
  let monthMode = 'tier';
  let budgetCursor = startOfMonth(new Date());
  const draft = { id: null, amount: '0', catId: null };
  const newCat = { name: '', icon: 'tag', tier: 'lifestyle', fixed: false };

  // Normalizes stored or imported data. Every record carries `updatedAt` (ms) for sync conflict resolution.
  function normalize(s) {
    const categories = (Array.isArray(s.categories) && s.categories.length ? s.categories : DEFAULT_CATEGORIES.map((c) => ({ ...c, updatedAt: 0 })))
      .filter((c) => c && c.id)
      .map((c) => {
        const out = { id: String(c.id), name: String(c.name || 'Category'), tier: TIERS[c.tier] ? c.tier : 'lifestyle', icon: c.icon || LEGACY_ICON[c.id] || 'tag', updatedAt: Number(c.updatedAt) || 0,
          fixed: c.fixed === undefined ? DEFAULT_FIXED.has(String(c.id)) : !!c.fixed };
        if (!window.ICONS[out.icon]) out.icon = 'tag';
        return out;
      });
    const settings = Object.assign({ currency: 'TND', monthlyBudget: 0, lastCat: null }, s.settings || {});
    if (!settings.currency || settings.currency === '$') settings.currency = 'TND';
    settings.tierBudgets = Object.assign({ essential: 0, lifestyle: 0, luxury: 0 }, settings.tierBudgets || {});
    settings.updatedAt = Number(settings.updatedAt) || 0;
    settings.monthAllowances = normAllowances(settings.monthAllowances);
    settings.balance = numOrNull(settings.balance);
    settings.balanceAt = Number(settings.balanceAt) || 0;
    settings.savings = numOrNull(settings.savings);
    settings.savingsAt = Number(settings.savingsAt) || 0;
    const expenses = (Array.isArray(s.expenses) ? s.expenses : []).filter((e) => e && e.id).map((e) => ({
      id: String(e.id), amount: Number(e.amount) || 0, catId: e.catId, ts: e.ts, note: e.note || '',
      updatedAt: Number(e.updatedAt) || Date.parse(e.ts) || 1,
    }));
    // Money log: additions to balance/savings, moves from balance to savings, and manual corrections.
    const entries = (Array.isArray(s.entries) ? s.entries : []).filter((x) => x && x.id && ENTRY_ACCOUNTS.has(x.account) && ENTRY_TYPES.has(x.type)).map((x) => ({
      id: String(x.id), account: x.account, type: x.type, amount: Number(x.amount) || 0, note: String(x.note || ''), ts: x.ts,
      updatedAt: Number(x.updatedAt) || Date.parse(x.ts) || 1,
    }));
    return { expenses, categories, settings, entries };
  }
  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { /* ignore */ }
    s = s || {};
    const st = normalize(s);
    if (s.sync && s.sync.key) {
      st.sync = Object.assign({ cursor: 0, dirty: {}, tomb: {}, lastSyncAt: null }, s.sync);
    } else {
      // First run with sync: queue everything already on this device for upload.
      const now = Date.now();
      st.sync = { key: genKey(), cursor: 0, dirty: {}, tomb: {}, lastSyncAt: null };
      st.expenses.forEach((e) => { st.sync.dirty['expense:' + e.id] = 1; });
      st.categories.forEach((c) => {
        const d = DEFAULT_CATEGORIES.find((x) => x.id === c.id);
        if (!d || d.name !== c.name || d.tier !== c.tier || d.icon !== c.icon || d.fixed !== c.fixed) { c.updatedAt = now; st.sync.dirty['category:' + c.id] = 1; }
      });
      if (Array.isArray(s.categories) && s.categories.length) {
        DEFAULT_CATEGORIES.forEach((d) => {
          if (!st.categories.some((c) => c.id === d.id)) { st.sync.tomb['category:' + d.id] = now; st.sync.dirty['category:' + d.id] = 1; }
        });
      }
      const set = st.settings;
      if (set.monthlyBudget || Object.values(set.tierBudgets).some(Number) || set.currency !== 'TND' || set.balance !== null || set.savings !== null) { set.updatedAt = now; st.sync.dirty['settings:main'] = 1; }
    }
    return st;
  }
  function numOrNull(v) { return v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v); }
  function normAllowances(m) {
    const out = {};
    if (m && typeof m === 'object') Object.keys(m).forEach((k) => { if (/^\d{4}-\d{2}$/.test(k) && Number(m[k]) >= 0) out[k] = Number(m[k]); });
    return out;
  }
  function genKey() {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function save(noSync) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save. Storage may be full.', 'alert'); return false; }
    if (!noSync) scheduleSync(800);
    updateSyncUI();
    return true;
  }

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
  // Currency: TND (Tunisian dinar) uses 3 decimals (millimes) and is written after the amount.
  const cur = () => state.settings.currency || 'TND';
  const decimals = () => (/^(TND|DT|د\.ت)$/i.test(cur()) ? 3 : 2);
  const suffixCur = () => cur().length > 1;
  const round = (v) => { const f = 10 ** decimals(); return Math.round(v * f) / f; };
  function fmt(n, compact) {
    const v = round(Number(n) || 0);
    const whole = compact && Number.isInteger(v);
    return v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : decimals(), maximumFractionDigits: decimals() });
  }
  function money(n, compact) {
    const v = Number(n) || 0;
    const body = fmt(Math.abs(v), compact);
    return (v < 0 ? '-' : '') + (suffixCur() ? `${body} ${cur()}` : cur() + body);
  }
  // Compact figure for the small stat tiles: the unit is already shown on the big total above.
  function statMoney(n) { if (!suffixCur()) return money(n, true); const v = Number(n) || 0; return (v < 0 ? '-' : '') + fmt(Math.abs(v), true); }
  function bigMoney(n) {
    return suffixCur() ? `${fmt(n)}<span class="cur suf">${esc(cur())}</span>` : `<span class="cur">${esc(cur())}</span>${fmt(n)}`;
  }
  function catById(id) { return state.categories.find((c) => c.id === id) || { id, icon: 'tag', name: 'Uncategorized', tier: 'lifestyle' }; }
  function tierColor(t) { return (TIERS[t] || TIERS.lifestyle).color; }
  function catIcon(c, cls = '') {
    return `<span class="ico ${cls}" style="background:color-mix(in srgb, ${tierColor(c.tier)} 13%, transparent);color:${tierColor(c.tier)}">${icon(c.icon)}</span>`;
  }
  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function timeStr(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function dayLabel(d) {
    const today = new Date();
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function haptic() { if (navigator.vibrate) navigator.vibrate(8); }
  let toastTimer;
  function toast(msg, ic = 'check') {
    const t = $('#toast');
    t.innerHTML = icon(ic) + `<span>${esc(msg)}</span>`;
    t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  }
  const sum = (list) => list.reduce((a, e) => a + Number(e.amount || 0), 0);
  function byTier(list) {
    const r = { essential: 0, lifestyle: 0, luxury: 0 };
    list.forEach((e) => { r[catById(e.catId).tier] += Number(e.amount); });
    return r;
  }
  const isFixed = (e) => !!catById(e.catId).fixed;
  const dailyOnly = (list) => list.filter((e) => !isFixed(e));
  // Splits a month into day-to-day spending and monthly bills. For the current or a future month, bills paid
  // last month that haven't been paid yet this month are estimated as still to come.
  function monthBills(m) {
    const list = expensesIn((d) => sameMonth(d, m));
    const fixedList = list.filter(isFixed);
    const paid = sum(fixedList);
    const out = { list, paid, daily: sum(list) - paid, upcoming: 0, upcomingCats: [] };
    if (m >= startOfMonth(new Date())) {
      const prev = new Date(m.getFullYear(), m.getMonth() - 1, 1);
      const prevByCat = {};
      expensesIn((d) => sameMonth(d, prev)).filter(isFixed).forEach((e) => { prevByCat[e.catId] = (prevByCat[e.catId] || 0) + Number(e.amount); });
      Object.entries(prevByCat).forEach(([id, v]) => {
        if (!fixedList.some((e) => e.catId === id)) { out.upcoming += v; out.upcomingCats.push([id, v]); }
      });
    }
    return out;
  }
  function expensesIn(pred) { return state.expenses.filter((e) => pred(new Date(e.ts))).sort((a, b) => new Date(b.ts) - new Date(a.ts)); }
  function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute('data-icon'); }); }

  // ---------- Rendering ----------
  function render() {
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const view = $('#view');
    if (tab === 'today') { setTitle('Today', new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })); view.innerHTML = renderToday(); }
    if (tab === 'month') { setTitle('Overview', ''); view.innerHTML = renderMonth(); }
    if (tab === 'budget') { setTitle('Budget', ''); view.innerHTML = renderBudget(); }
    if (tab === 'settings') { setTitle('Settings', ''); view.innerHTML = renderSettings(); }
    $('#fab').style.display = tab === 'settings' || tab === 'budget' ? 'none' : '';
    updateSyncUI();
  }
  // Don't redraw underneath the user while the add sheet is open or they are typing in a field.
  function canRerender() {
    const a = document.activeElement;
    return !document.querySelector('.sheet.open') && tab !== 'settings' && !(a && a.matches('#view input, #view select'));
  }
  function setTitle(t, s) { $('#viewTitle').textContent = t; $('#viewSub').textContent = s; }

  function tierBlock(totals, budgets) {
    const total = TIER_KEYS.reduce((a, k) => a + totals[k], 0);
    const bar = total
      ? `<div class="tierbar">${TIER_KEYS.filter((k) => totals[k] > 0).map((k) => `<span style="width:${(totals[k] / total) * 100}%;background:${tierColor(k)}"></span>`).join('')}</div>`
      : '<div class="tierbar empty"></div>';
    const rows = TIER_KEYS.map((k) => {
      const b = budgets ? Number(budgets[k]) : 0;
      const pct = total ? Math.round((totals[k] / total) * 100) : 0;
      const over = b && totals[k] > b;
      return `<div class="tier-row">
        <span class="sw" style="background:${tierColor(k)}"></span>
        <span class="n">${TIERS[k].name}<small>${TIERS[k].hint}</small></span>
        <span class="v num">${money(totals[k])}<small>${b ? `${over ? 'Over by ' + money(totals[k] - b, true) : money(b - totals[k], true) + ' left'}` : pct + '%'}</small></span>
        ${b ? `<span class="bud"><i style="width:${Math.min(100, (totals[k] / b) * 100)}%;background:${over ? 'var(--danger)' : tierColor(k)}"></i></span>` : ''}
      </div>`;
    }).join('');
    return bar + `<div class="tier-rows">${rows}</div>`;
  }

  function expenseItem(e, withDate) {
    const c = catById(e.catId);
    const d = new Date(e.ts);
    const when = withDate ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + timeStr(d) : timeStr(d);
    const meta = [when, c.fixed ? 'Monthly' : '', e.note ? esc(e.note) : c.fixed ? '' : TIERS[c.tier].name].filter(Boolean).join(' · ');
    return `<li><button class="item" data-edit="${esc(e.id)}">
      ${catIcon(c)}
      <span class="mid"><div class="name">${esc(c.name)}</div><div class="meta">${meta}</div></span>
      <span class="amt num">${money(e.amount)}</span>
    </button></li>`;
  }

  function emptyState(title, sub) {
    return `<div class="empty"><span class="ico">${icon('receipt')}</span>${title}<small>${sub}</small></div>`;
  }

  function renderToday() {
    const now = new Date();
    const today = expensesIn((d) => sameDay(d, now));
    const todayDaily = sum(dailyOnly(today));
    const todayBills = sum(today) - todayDaily;
    const mb = monthBills(now);
    const month = mb.list;
    const mTotal = sum(month);
    const budget = allowanceFor(now);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate() + 1;

    let stats;
    if (budget) {
      const left = budget - mTotal;
      const perDayLeft = Math.max(0, left - mb.upcoming) / daysLeft; // keep money aside for bills still to come
      stats = `<div class="stats" style="--cols:3">
        <div><div class="k">This month</div><div class="v num">${statMoney(mTotal)}</div></div>
        <div><div class="k">Budget left</div><div class="v num ${left < 0 ? 'over' : ''}">${statMoney(left)}</div></div>
        <div><div class="k">Per day</div><div class="v num ${left < 0 ? 'over' : ''}">${statMoney(perDayLeft)}</div></div>
      </div>`;
    } else {
      stats = `<div class="stats">
        <div><div class="k">This month</div><div class="v num">${statMoney(mTotal)}</div></div>
        <div><div class="k">Daily average</div><div class="v num">${statMoney(mb.daily / now.getDate())}</div></div>
      </div>`;
    }

    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6); weekAgo.setHours(0, 0, 0, 0);
    const recent = expensesIn((d) => d >= weekAgo && !sameDay(d, now) && d < now);
    const groups = new Map();
    recent.forEach((e) => { const k = new Date(e.ts).toDateString(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });

    return `
      <section class="card summary">
        <div class="label">Spent today</div>
        <div class="big num">${bigMoney(todayDaily)}</div>
        ${todayBills ? `<div class="bills-note">+ ${money(todayBills)} monthly bills today, counted in the month only</div>` : ''}
        ${budget ? `<div class="budget-track"><i class="${mTotal > budget ? 'over' : ''}" style="width:${Math.min(100, (mTotal / budget) * 100)}%"></i></div>` : ''}
        ${stats}
      </section>

      <section class="card">
        <div class="card-title">Today's expenses${today.length ? `<span class="aside">${today.length}</span>` : ''}</div>
        ${today.length ? `<ul class="list">${today.map((e) => expenseItem(e)).join('')}</ul>`
          : emptyState('No expenses today', 'Tap + or double-tap the back of your iPhone.')}
      </section>

      <section class="card">
        <div class="card-title">This month by tier</div>
        ${tierBlock(byTier(month), state.settings.tierBudgets)}
      </section>

      ${groups.size ? `<section class="card"><div class="card-title">Last 7 days</div>
        ${[...groups].map(([k, list]) => `<div class="day-head"><span>${dayLabel(new Date(k))}</span><span class="num">${money(sum(dailyOnly(list)))}</span></div>
          <ul class="list">${list.map((e) => expenseItem(e)).join('')}</ul>`).join('')}
      </section>` : ''}
    `;
  }

  function renderMonth() {
    const m = monthCursor;
    const now = new Date();
    const list = expensesIn((d) => sameMonth(d, m));
    const total = sum(list);
    const prev = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    const prevTotal = sum(expensesIn((d) => sameMonth(d, prev)));
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const isCurrent = sameMonth(m, now);
    const elapsed = isCurrent ? now.getDate() : days;
    const budget = allowanceFor(m);

    const perDay = Array.from({ length: days }, () => ({ essential: 0, lifestyle: 0, luxury: 0, t: 0 }));
    // The daily chart and average leave out monthly bills (rent, subscriptions...).
    dailyOnly(list).forEach((e) => { const d = new Date(e.ts).getDate() - 1; const t = catById(e.catId).tier; perDay[d][t] += Number(e.amount); perDay[d].t += Number(e.amount); });
    const max = Math.max(1, ...perDay.map((d) => d.t));
    const billsTotal = total - sum(dailyOnly(list));
    const avg = (total - billsTotal) / elapsed;
    const bars = perDay.map((d, i) => `<div class="bar ${d.t ? 'has' : ''} ${isCurrent && i + 1 === now.getDate() ? 'today' : ''}" style="height:${d.t ? Math.max(4, (d.t / max) * 100) : 2}%" title="${i + 1}: ${money(d.t)}">
        ${d.t ? TIER_KEYS.filter((k) => d[k] > 0).map((k) => `<i style="height:${(d[k] / d.t) * 100}%;background:${tierColor(k)}"></i>`).join('') : ''}
      </div>`).join('');

    let breakdown = '';
    if (monthMode === 'tier') {
      const bt = byTier(list);
      breakdown = TIER_KEYS.map((k) => {
        const cats = {};
        list.filter((e) => catById(e.catId).tier === k).forEach((e) => { cats[e.catId] = (cats[e.catId] || 0) + Number(e.amount); });
        const rows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([id, v]) => catRow(catById(id), v, bt[k])).join('');
        return `<div class="tier-head"><span><i class="dot" style="background:${tierColor(k)}"></i>${TIERS[k].name}</span><span class="num">${money(bt[k])}</span></div>${rows || '<div class="none">No expenses</div>'}`;
      }).join('');
    } else if (monthMode === 'category') {
      const cats = {};
      list.forEach((e) => { cats[e.catId] = (cats[e.catId] || 0) + Number(e.amount); });
      breakdown = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([id, v]) => catRow(catById(id), v, total)).join('') || emptyState('No expenses this month', 'Expenses you add will appear here.');
    } else {
      breakdown = list.length ? `<ul class="list">${list.map((e) => expenseItem(e, true)).join('')}</ul>` : emptyState('No expenses this month', 'Expenses you add will appear here.');
    }

    const diff = prevTotal ? ((total - prevTotal) / prevTotal) * 100 : null;
    const deltaHtml = diff === null ? '<span class="muted">—</span>'
      : `<span class="delta ${diff > 0 ? 'up' : 'down'}">${icon(diff > 0 ? 'up' : 'down')}${Math.abs(Math.round(diff))}%</span>`;

    return `
      <div class="month-nav">
        <button class="icon-btn" data-month="-1" aria-label="Previous month">${icon('left')}</button>
        <div class="m">${m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
        <button class="icon-btn" data-month="1" aria-label="Next month" ${isCurrent ? 'disabled' : ''}>${icon('right')}</button>
      </div>
      <section class="card summary">
        <div class="label">Total spent</div>
        <div class="big num">${bigMoney(total)}</div>
        ${budget ? `<div class="budget-track"><i class="${total > budget ? 'over' : ''}" style="width:${Math.min(100, (total / budget) * 100)}%"></i></div>` : ''}
        <div class="stats" style="--cols:3">
          <div><div class="k">${budget ? 'Budget' : 'Expenses'}</div><div class="v num">${budget ? statMoney(budget) : list.length}</div></div>
          <div><div class="k">Daily average</div><div class="v num">${statMoney(avg)}</div></div>
          <div><div class="k">vs last month</div><div class="v num">${deltaHtml}</div></div>
        </div>
      </section>
      <section class="card">
        <div class="card-title">Daily spending<span class="aside num">avg ${money(avg, true)}</span></div>
        <div class="chart">${avg ? `<div class="avg" style="bottom:${(avg / max) * 100}%"></div>` : ''}${bars}</div>
        <div class="chart-x"><span>1</span><span>${Math.ceil(days / 2)}</span><span>${days}</span></div>
        ${billsTotal ? `<div class="bills-note">Monthly bills of ${money(billsTotal)} are included in the total but not in this chart.</div>` : ''}
      </section>
      <section class="card">
        <div class="card-title">Tiers</div>
        ${tierBlock(byTier(list), state.settings.tierBudgets)}
      </section>
      <section class="card">
        <div class="seg" role="tablist">
          <button data-mode="tier" class="${monthMode === 'tier' ? 'on' : ''}">By tier</button>
          <button data-mode="category" class="${monthMode === 'category' ? 'on' : ''}">By category</button>
          <button data-mode="all" class="${monthMode === 'all' ? 'on' : ''}">All</button>
        </div>
        ${breakdown}
      </section>`;
  }
  function catRow(c, v, of) {
    const pct = of ? (v / of) * 100 : 0;
    return `<div class="cat-row">
      ${catIcon(c, 'sm')}
      <div class="mid"><div class="top"><span>${esc(c.name)}<small class="num">${Math.round(pct)}%</small></span><b class="num">${money(v)}</b></div>
      <div class="meter"><i style="width:${pct}%;background:${tierColor(c.tier)}"></i></div></div>
    </div>`;
  }

  function setFixed(id, on) {
    const c = state.categories.find((x) => x.id === id);
    if (!c) return;
    c.fixed = on;
    touch('category', c); save(); render();
    toast(on ? `${c.name} counts as a monthly bill` : `${c.name} counts as daily spending`, 'repeat');
  }

  // ---------- Budget ----------
  const ymKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const daysIn = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  // A month's allowance: its own value, else the most recent earlier month's, else the default (current/future months only).
  function allowanceFor(d) {
    const map = state.settings.monthAllowances || {};
    const k = ymKey(d);
    if (map[k] !== undefined) return Number(map[k]) || 0;
    const earlier = Object.keys(map).filter((x) => x < k).sort().pop();
    if (earlier) return Number(map[earlier]) || 0;
    return k >= ymKey(new Date()) ? Number(state.settings.monthlyBudget) || 0 : 0;
  }
  // Balance entered by the user, minus expenses dated after it was entered.
  // Entered balance + money added since − money moved to savings since − expenses since.
  const inWindow = (ts, after) => { const t = new Date(ts).getTime(); return t > after && t <= Date.now(); };
  function balanceInfo() {
    const st = state.settings;
    if (st.balance === null) return null;
    const spentSince = sum(state.expenses.filter((e) => inWindow(e.ts, st.balanceAt)));
    const addedSince = sum(state.entries.filter((x) => x.account === 'balance' && x.type === 'add' && inWindow(x.ts, st.balanceAt)));
    const movedSince = sum(state.entries.filter((x) => x.account === 'savings' && x.type === 'transfer' && inWindow(x.ts, st.balanceAt)));
    return { entered: st.balance, at: st.balanceAt, spentSince, addedSince, movedSince, now: st.balance + addedSince - movedSince - spentSince };
  }
  function savingsInfo() {
    const st = state.settings;
    if (st.savings === null) return null;
    const addedSince = sum(state.entries.filter((x) => x.account === 'savings' && x.type !== 'set' && inWindow(x.ts, st.savingsAt)));
    return { entered: st.savings, at: st.savingsAt, addedSince, now: st.savings + addedSince };
  }
  function logEntry(account, type, amount, note, ts) {
    const rec = { id: uid(), account, type, amount, note: note || '', ts: ts || new Date().toISOString() };
    state.entries.push(rec);
    touch('entry', rec);
    return rec;
  }
  let showAllActivity = false;
  function entryView(x) {
    const acc = x.account === 'balance' ? 'balance' : 'savings';
    if (x.type === 'set') return { ic: 'check', cls: '', title: acc === 'balance' ? 'Balance set' : 'Savings set', amt: '= ' + money(x.amount) };
    if (x.type === 'transfer') return { ic: 'vault', cls: '', title: 'Moved to savings', amt: money(x.amount), sub: 'From balance' };
    return { ic: acc === 'balance' ? 'wallet' : 'vault', cls: 'ok', title: acc === 'balance' ? 'Added to balance' : 'Added to savings', amt: '+' + money(x.amount) };
  }
  function activityLog() {
    const all = state.entries.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
    if (!all.length) return '';
    const shown = showAllActivity ? all : all.slice(0, 8);
    return `<div class="section-label">Activity</div>
      <div class="group">
        ${shown.map((x) => {
          const v = entryView(x);
          const d = new Date(x.ts);
          const when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + timeStr(d);
          return `<button class="row act" data-entry="${esc(x.id)}"><span class="ico sm neutral ${v.cls}">${icon(v.ic)}</span>
            <span class="grow">${v.title}<small class="sub-line">${[when, v.sub, x.note ? esc(x.note) : ''].filter(Boolean).join(' · ')}</small></span>
            <span class="amt num ${v.cls}">${v.amt}</span></button>`;
        }).join('')}
        ${all.length > 8 ? `<button class="row link" id="toggleActivity"><span class="grow">${showAllActivity ? 'Show less' : `Show all ${all.length}`}</span></button>` : ''}
      </div>
      <p class="help">Tap an entry to delete it if it was a mistake.</p>`;
  }

  const moneyDraft = { account: 'balance', type: 'add', dateTouched: false };
  function openMoney(account) {
    moneyDraft.account = account;
    moneyDraft.dateTouched = false;
    $('#moneyTitle').textContent = account === 'balance' ? 'Add to balance' : 'Add to savings';
    $('#moneySource').hidden = account !== 'savings';
    setMoneySource('add');
    $('#moneyAmount').value = '';
    $('#moneyNote').value = '';
    $('#moneyDate').value = toLocalInput(new Date());
    $('#moneyDateLabel').textContent = 'Now';
    $('#moneyCur').textContent = cur();
    $('#moneySheet').classList.add('open');
    $('#moneySheet').setAttribute('aria-hidden', 'false');
    $('#moneyAmount').focus(); // same tick as the tap, so iOS opens the keyboard
  }
  function setMoneySource(type) {
    moneyDraft.type = type;
    document.querySelectorAll('#moneySource button').forEach((b) => b.classList.toggle('on', b.dataset.src === type));
    $('#moneyHint').textContent = moneyDraft.account === 'balance'
      ? 'Salary, a gift, a refund… Your balance goes up by this amount.'
      : type === 'transfer' ? 'Your balance goes down and your savings go up by this amount.' : 'Money from outside your balance, added straight to savings.';
    $('#moneyNote').placeholder = moneyDraft.account === 'balance' ? 'Note, e.g. Salary' : 'Note (optional)';
  }
  function saveMoney() {
    const amount = round(parseFloat(String($('#moneyAmount').value).replace(',', '.')));
    if (!(amount > 0)) { $('#moneyAmount').focus(); return toast('Enter an amount', 'alert'); }
    const st = state.settings;
    if (moneyDraft.type === 'transfer' && st.balance === null) return toast('Set your current balance first', 'alert');
    let ts = new Date().toISOString();
    if (moneyDraft.dateTouched) { const d = new Date($('#moneyDate').value); if (!isNaN(d)) ts = d.toISOString(); }
    if (moneyDraft.account === 'savings' && st.savings === null) { st.savings = 0; st.savingsAt = 0; touch('settings', st); }
    logEntry(moneyDraft.account, moneyDraft.type, amount, $('#moneyNote').value.trim().slice(0, 60), ts);
    save(); closeSheet(); render();
    toast(moneyDraft.type === 'transfer' ? `Moved ${money(amount)} to savings` : `Added ${money(amount)} to ${moneyDraft.account}`, 'plus');
  }
  function deleteEntry(id) {
    const x = state.entries.find((y) => y.id === id);
    if (!x) return;
    const v = entryView(x);
    const msg = x.type === 'set'
      ? `Remove "${v.title}" from the log? Your current ${x.account} stays the same.`
      : `Delete "${v.title}" (${money(x.amount)})? Your ${x.type === 'transfer' ? 'balance and savings' : x.account} will be recalculated.`;
    if (!confirm(msg)) return;
    tombstone('entry', id);
    state.entries = state.entries.filter((y) => y.id !== id);
    save(); render(); toast('Entry deleted', 'trash');
  }

  function insight(ic, cls, html) { return `<li class="insight ${cls}"><span class="ii">${icon(ic)}</span><span>${html}</span></li>`; }

  function renderBudget() {
    const st = state.settings;
    const now = new Date();
    const m = budgetCursor;
    const isCurrent = sameMonth(m, now);
    const isPast = m < startOfMonth(now);
    const mb = monthBills(m);
    const list = mb.list;
    const spent = sum(list);
    const allowance = allowanceFor(m);
    const own = (st.monthAllowances || {})[ymKey(m)] !== undefined;
    const days = daysIn(m);
    const elapsed = isCurrent ? now.getDate() : isPast ? days : 0;
    const daysLeft = isCurrent ? days - now.getDate() + 1 : isPast ? 0 : days;
    const left = allowance - spent;
    // Day-to-day pace excludes monthly bills; the forecast adds bills paid plus bills still expected.
    const pace = elapsed ? mb.daily / elapsed : 0;
    const projected = isCurrent ? mb.paid + mb.upcoming + pace * days : spent;
    const perDayLeft = daysLeft ? Math.max(0, left - (isPast ? 0 : mb.upcoming)) / daysLeft : 0;
    const bal = balanceInfo();
    const sav = savingsInfo();
    const savings = sav ? sav.now : null;

    // Overall money
    const overall = `
      <section class="card summary">
        <div class="label">Overall · balance + savings</div>
        <div class="big num">${bigMoney((bal ? bal.now : 0) + (savings || 0))}</div>
        <div class="stats">
          <div><div class="k">Balance now</div><div class="v num ${bal && bal.now < 0 ? 'over' : ''}">${bal ? statMoney(bal.now) : '—'}</div></div>
          <div><div class="k">Savings</div><div class="v num">${savings !== null ? statMoney(savings) : '—'}</div></div>
        </div>
      </section>
      <div class="group">
        <label class="row">${'<span class="ico sm neutral">' + icon('wallet') + '</span>'}<span class="grow">Current balance<small class="sub-line">${bal
          ? [`Since ${new Date(bal.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, bal.addedSince ? '+' + money(bal.addedSince, true) + ' added' : '', bal.movedSince ? money(bal.movedSince, true) + ' to savings' : '', money(bal.spentSince, true) + ' spent'].filter(Boolean).join(' · ')
          : 'Money in your account and cash today'}</small></span>
          <input id="setBalance" type="number" inputmode="decimal" step="any" value="${bal ? round(bal.now) : ''}" placeholder="Not set" /></label>
        ${bal ? `<button class="row link add-money" data-money="balance">${icon('plus')}<span class="grow">Add money to balance</span></button>` : ''}
        <label class="row">${'<span class="ico sm neutral">' + icon('vault') + '</span>'}<span class="grow">Savings<small class="sub-line">${sav && sav.addedSince
          ? `Since ${sav.at ? new Date(sav.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'the start'} · +${money(sav.addedSince, true)} added`
          : 'Money you keep aside'}</small></span>
          <input id="setSavings" type="number" inputmode="decimal" step="any" value="${savings !== null ? round(savings) : ''}" placeholder="Not set" /></label>
        <button class="row link add-money" data-money="savings">${icon('plus')}<span class="grow">Add to savings</span></button>
      </div>
      <p class="help">Your balance goes down automatically as you add expenses and up when you add money. Type a new amount any time to match your bank. Every change is kept in the activity log below.</p>
      ${activityLog()}`;

    // Month allowance + analysis
    let analysis = '';
    if (allowance) {
      const label = isPast ? (left >= 0 ? 'Saved from allowance' : 'Over allowance') : left >= 0 ? 'Left to spend' : 'Over allowance';
      analysis = `
        <section class="card summary">
          <div class="label">${label}</div>
          <div class="big num ${left < 0 ? 'over' : ''}">${bigMoney(Math.abs(left))}</div>
          <div class="budget-track"><i class="${spent > allowance ? 'over' : ''}" style="width:${Math.min(100, (spent / allowance) * 100)}%"></i></div>
          <div class="stats" style="--cols:3">
            <div><div class="k">Spent</div><div class="v num">${statMoney(spent)}</div></div>
            <div><div class="k">Allowance</div><div class="v num">${statMoney(allowance)}</div></div>
            <div><div class="k">${isCurrent ? 'Per day left' : 'Daily average'}</div><div class="v num">${isCurrent ? statMoney(perDayLeft) : statMoney(isPast ? mb.daily / days : 0)}</div></div>
          </div>
        </section>`;
    }

    const tips = [];
    if (allowance && isCurrent && elapsed < 5) {
      tips.push(insight('today', '', `It's early in the month: <b>${money(spent)}</b> spent so far, <b>${money(Math.max(0, left))}</b> left. A spending forecast appears after the first 5 days.`));
    } else if (allowance && isCurrent) {
      const diff = projected - allowance;
      tips.push(insight(diff > 0 ? 'alert' : 'check', diff > 0 ? 'warn' : 'ok',
        `At your pace of <b>${money(pace)}</b> a day, you will spend about <b>${money(projected)}</b> this month, ${diff > 0 ? `<b>${money(diff)} over</b>` : `<b>${money(-diff)} under</b>`} your allowance.`));
      if (left > 0) tips.push(insight('today', '', `To stay on budget, keep day-to-day spending under <b>${money(perDayLeft)}</b> a day for the next ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`));
    }
    const monthEntries = state.entries.filter((x) => sameMonth(new Date(x.ts), m));
    const income = sum(monthEntries.filter((x) => x.account === 'balance' && x.type === 'add'));
    const saved = sum(monthEntries.filter((x) => x.account === 'savings' && x.type !== 'set'));
    if (income || saved) {
      tips.push(insight('plus', 'ok', [income ? `<b>${money(income)}</b> added to your balance` : '', saved ? `<b>${money(saved)}</b> put into savings` : ''].filter(Boolean).join(' and ') + ' this month.'));
    }
    if (mb.paid || mb.upcoming) {
      const names = mb.upcomingCats.map(([id]) => esc(catById(id).name)).join(', ');
      tips.push(insight('repeat', '', `Monthly bills: <b>${money(mb.paid)}</b> paid${mb.upcoming ? `, about <b>${money(mb.upcoming)}</b> still expected (${names}, based on last month)` : ''}. Day-to-day spending: <b>${money(mb.daily)}</b>.`));
    }
    if (allowance && isPast) {
      tips.push(insight(left >= 0 ? 'check' : 'alert', left >= 0 ? 'ok' : 'warn',
        `You spent <b>${money(spent)}</b> of <b>${money(allowance)}</b> (${Math.round((spent / allowance) * 100)}%). ${left >= 0 ? `You kept <b>${money(left)}</b> of your allowance.` : `You went <b>${money(-left)}</b> over.`}`));
    }
    if (isCurrent && bal && elapsed < 5 && allowance) {
      tips.push(insight('wallet', '', `If you spend exactly your allowance, your balance will be about <b>${money(bal.now - Math.max(0, left))}</b> at the end of the month.`));
    }
    if (isCurrent && bal && elapsed >= 5) {
      const endIfPace = bal.now - Math.max(0, projected - spent);
      const endIfBudget = allowance ? bal.now - Math.max(0, left) : null;
      tips.push(insight('wallet', endIfPace < 0 ? 'warn' : '',
        `Expected balance at month end: <b>${money(endIfPace)}</b> at your current pace${endIfBudget !== null ? `, or <b>${money(endIfBudget)}</b> if you spend exactly your allowance` : ''}.`));
    }
    const catTotals = {};
    list.forEach((e) => { catTotals[e.catId] = (catTotals[e.catId] || 0) + Number(e.amount); });
    const cats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    if (cats.length) {
      const [topId, topV] = cats[0];
      tips.push(insight(catById(topId).icon, '', `Biggest category: <b>${esc(catById(topId).name)}</b> with ${money(topV)} (${Math.round((topV / spent) * 100)}% of spending${allowance ? `, ${Math.round((topV / allowance) * 100)}% of your allowance` : ''}).`));
    }
    const prev = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    const prevSpent = sum(expensesIn((d) => sameMonth(d, prev)));
    if (prevSpent && spent && !isCurrent) {
      const ch = ((spent - prevSpent) / prevSpent) * 100;
      tips.push(insight(ch > 0 ? 'up' : 'down', ch > 0 ? 'warn' : 'ok', `${Math.abs(Math.round(ch))}% ${ch > 0 ? 'more' : 'less'} than ${prev.toLocaleDateString(undefined, { month: 'long' })} (${money(prevSpent)}).`));
    }
    TIER_KEYS.forEach((k) => {
      const lim = Number(st.tierBudgets[k]) || 0;
      const v = sum(list.filter((e) => catById(e.catId).tier === k));
      if (lim && v > lim) tips.push(insight('alert', 'warn', `${TIERS[k].name} spending is <b>${money(v - lim)}</b> over its ${money(lim)} limit.`));
    });

    // History: last 6 months that have an allowance or spending
    const hist = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const sp = sum(expensesIn((x) => sameMonth(x, d)));
      const al = allowanceFor(d);
      if (sp || al) hist.push({ d, sp, al });
    }
    const keys = Object.keys(st.monthAllowances || {});
    let totalSaved = 0;
    if (keys.length || st.monthlyBudget) {
      const first = state.expenses.reduce((a, e) => Math.min(a, new Date(e.ts).getTime()), Date.now());
      for (let d = startOfMonth(new Date(first)); d < startOfMonth(now); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const al = allowanceFor(d);
        if (al) totalSaved += al - sum(expensesIn((x) => sameMonth(x, d)));
      }
    }

    return `
      ${overall}

      <div class="month-nav" style="margin-top:22px">
        <button class="icon-btn" data-bmonth="-1" aria-label="Previous month">${icon('left')}</button>
        <div class="m">${m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
        <button class="icon-btn" data-bmonth="1" aria-label="Next month">${icon('right')}</button>
      </div>
      <div class="group" style="margin-bottom:12px">
        <label class="row"><span class="ico sm neutral">${icon('card')}</span><span class="grow">Allowance<small class="sub-line">${own ? 'Set for this month' : allowance ? 'Same as the previous month' : 'How much you can spend this month'}</small></span>
          <input id="setAllowance" data-ym="${ymKey(m)}" type="number" inputmode="decimal" min="0" step="any" value="${allowance || ''}" placeholder="Not set" /></label>
      </div>
      ${analysis}
      ${tips.length ? `<section class="card"><div class="card-title">Month analysis</div><ul class="insights">${tips.join('')}</ul></section>` : ''}

      <section class="card">
        <div class="card-title">Spending by category<span class="aside num">${money(spent)}</span></div>
        ${tierBlock(byTier(list), st.tierBudgets)}
        <div style="margin-top:14px">${cats.map(([id, v]) => catRow(catById(id), v, spent)).join('') || emptyState('No expenses this month', 'Expenses you add will appear here.')}</div>
      </section>

      <div class="section-label">Monthly bills</div>
      <div class="group">
        ${state.categories.filter((c) => c.fixed).map((c) => `<div class="row">${catIcon(c, 'sm')}<span class="grow">${esc(c.name)}<small class="sub-line num">${money(sum(list.filter((e) => e.catId === c.id)), true)} this month</small></span><button class="del" data-unfix="${esc(c.id)}" aria-label="Count ${esc(c.name)} as daily spending" title="Count as daily spending">${icon('close')}</button></div>`).join('') || '<div class="row muted" style="font-size:14px">No monthly bills yet</div>'}
        <label class="row"><span class="ico sm neutral">${icon('plus')}</span><span class="grow">Add a category</span>
          <select class="inline" id="addFixed"><option value="">Choose</option>${state.categories.filter((c) => !c.fixed).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <p class="help">Bills paid once a month, like rent and subscriptions, count in your monthly total but not in daily spending, the daily average or the spending forecast. Bills paid last month but not yet this month are kept aside when working out your per-day amount.</p>

      <div class="section-label">Tier limits (optional)</div>
      <div class="group">
        ${TIER_KEYS.map((k) => `<label class="row"><i class="dot" style="background:${tierColor(k)}"></i><span class="grow">${TIERS[k].name}<small class="sub-line">${TIERS[k].hint}</small></span><input data-tier-budget="${k}" type="number" inputmode="decimal" min="0" step="any" value="${st.tierBudgets[k] || ''}" placeholder="No limit" /></label>`).join('')}
      </div>

      ${hist.length ? `<div class="section-label">History</div>
      <div class="group">
        ${hist.map((h) => {
          const diff = h.al - h.sp;
          const current = sameMonth(h.d, now);
          const chip = !h.al ? '<span class="chip">No allowance</span>'
            : current ? `<span class="chip">${money(Math.max(0, diff), true)} left</span>`
            : diff >= 0 ? `<span class="chip ok">Saved ${money(diff, true)}</span>` : `<span class="chip over">Over ${money(-diff, true)}</span>`;
          return `<button class="row hist" data-bm="${ymKey(h.d)}"><span class="grow">${h.d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}<small class="sub-line num">${money(h.sp, true)}${h.al ? ' of ' + money(h.al, true) : ''}</small></span>${chip}${icon('right', 'chev')}</button>`;
        }).join('')}
      </div>
      ${totalSaved ? `<p class="help">Across past months you ${totalSaved >= 0 ? 'kept' : 'overspent'} <b>${money(Math.abs(totalSaved))}</b> ${totalSaved >= 0 ? 'of your allowances' : 'beyond your allowances'}.</p>` : ''}` : ''}
    `;
  }

  function renderSettings() {
    const s = state.settings;
    const quickUrl = location.origin + location.pathname.replace(/index\.html$/, '') + '#add';
    const catRows = TIER_KEYS.map((k) => {
      const cats = state.categories.filter((c) => c.tier === k);
      return `<div class="section-label" style="display:flex;align-items:center;gap:8px"><i class="dot" style="background:${tierColor(k)}"></i>${TIERS[k].name} · ${TIERS[k].hint}</div>
        <div class="group">${cats.length ? cats.map((c) => `
          <div class="row">
            ${catIcon(c, 'sm')}
            <span class="grow">${esc(c.name)}</span>
            <select class="inline" data-cat-tier="${esc(c.id)}" aria-label="Tier for ${esc(c.name)}">
              ${TIER_KEYS.map((t) => `<option value="${t}" ${t === c.tier ? 'selected' : ''}>${TIERS[t].name}</option>`).join('')}
            </select>
            <button class="del" data-cat-del="${esc(c.id)}" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button>
          </div>`).join('') : '<div class="row muted" style="font-size:14px">No categories</div>'}
        </div>`;
    }).join('');

    return `
      <div class="section-label">Quick add with Back Tap</div>
      <div class="group">
        <ol class="steps">
          <li>In the <b>Shortcuts</b> app, create a shortcut with the <b>Open URLs</b> action and this link. Name it <b>Add Expense</b>.
            <div class="copy-field"><code id="quickUrl">${esc(quickUrl)}</code><button class="btn" data-copy>${icon('copy')}Copy</button></div>
          </li>
          <li>Open <b>Settings → Accessibility → Touch → Back Tap → Double Tap</b> and choose <b>Add Expense</b>.</li>
          <li>Double-tap the back of your iPhone. The amount pad opens, ready to type.</li>
        </ol>
      </div>
      <p class="help">Back Tap opens links in Safari. A Home Screen icon with <b>Open as Web App</b> on keeps its own storage, separate from Safari. To see the same expenses in both, open Spendly in Safari, tap <b>Copy link for another device</b>, then in the Home Screen app tap <b>Paste a device link</b>.</p>

      <div class="section-label">Cloud sync</div>
      <div class="group">
        <div class="row" id="syncRow"><span class="sync-ico"></span><span class="grow"></span><button class="btn" id="syncNowBtn">${icon('refresh')}Sync</button></div>
        <button class="row link" id="linkBtn">${icon('link')}<span class="grow">Copy link for another device</span></button>
        <button class="row link" id="pasteLinkBtn">${icon('copy')}<span class="grow">Paste a device link</span></button>
      </div>
      <p class="help">Everything is saved on this phone first, so the app works without internet. When you are online, changes upload to your private cloud database automatically. Anyone with the device link can see your expenses, so only open it on your own devices.</p>

      <div class="section-label">Preferences</div>
      <div class="group">
        <label class="row"><span class="grow">Currency</span><input id="setCurrency" type="text" value="${esc(s.currency)}" maxlength="4" autocomplete="off" /></label>
      </div>

      ${catRows}

      <div class="section-label">New category</div>
      <div class="group">
        <div class="new-cat">
          <input id="newName" placeholder="Category name" maxlength="24" value="${esc(newCat.name)}" autocomplete="off" />
          <button class="btn" id="addCat">${icon('plus')}Add</button>
        </div>
        <div class="tier-pick">${TIER_KEYS.map((t) => `<button data-new-tier="${t}" class="${newCat.tier === t ? 'on' : ''}"><i class="dot" style="background:${tierColor(t)}"></i>${TIERS[t].name}</button>`).join('')}</div>
        <div class="tier-pick"><button id="newFixed" class="${newCat.fixed ? 'on' : ''}">${icon('repeat')}Paid once a month</button></div>
        <div class="icon-pick">${window.CATEGORY_ICONS.map((n) => `<button data-new-icon="${n}" class="${newCat.icon === n ? 'on' : ''}" aria-label="${n}">${icon(n)}</button>`).join('')}</div>
      </div>

      <div class="section-label">Data</div>
      <div class="group">
        <button class="row link" id="exportCsv">${icon('download')}<span class="grow">Export CSV</span></button>
        <button class="row link" id="exportJson">${icon('download')}<span class="grow">Back up data (JSON)</span></button>
        <label class="row link" style="cursor:pointer">${icon('upload')}<span class="grow">Restore from backup</span><input id="importJson" type="file" accept="application/json,.json" hidden /></label>
        <button class="row link danger" id="wipe">${icon('trash')}<span class="grow">Erase all expenses</span></button>
      </div>
      <p class="help">Backups are plain files you keep. They do not include your sync link.</p>
      <p class="foot">Spendly · ${state.expenses.length} expense${state.expenses.length === 1 ? '' : 's'} stored</p>`;
  }

  // ---------- Quick-add sheet ----------
  function openSheet(expense, preset = {}) {
    draft.id = expense ? expense.id : null;
    draft.amount = expense ? String(expense.amount) : (preset.amount ? String(preset.amount) : '0');
    draft.catId = expense ? expense.catId : (preset.catId || state.settings.lastCat || null);
    if (draft.catId && !state.categories.some((c) => c.id === draft.catId)) draft.catId = null;
    $('#noteInput').value = expense ? (expense.note || '') : '';
    $('#dateInput').value = toLocalInput(expense ? new Date(expense.ts) : new Date());
    updateDateLabel(!expense);
    draft.dateTouched = false;
    draft.origTs = expense ? expense.ts : null;
    $('#sheetTitle').textContent = expense ? 'Edit expense' : 'New expense';
    $('#deleteBtn').hidden = !expense;
    $('#amountCur').textContent = suffixCur() ? '' : cur();
    $('#amountSuf').textContent = suffixCur() ? cur() : '';
    renderCats();
    updateAmount();
    $('#sheet').classList.add('open');
    $('#sheet').setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { const on = $('.cat-chip.on'); if (on) on.scrollIntoView({ inline: 'nearest', block: 'nearest' }); });
  }
  function closeSheet() {
    document.querySelectorAll('.sheet.open').forEach((el) => { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); });
    if (document.activeElement) document.activeElement.blur();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }
  function updateDateLabel(isNow) {
    const v = $('#dateInput').value;
    const d = v ? new Date(v) : new Date();
    $('#dateLabel').textContent = isNow ? 'Now' : (sameDay(d, new Date()) ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ', ' + timeStr(d);
  }
  function renderCats() {
    const counts = {};
    state.expenses.slice(-300).forEach((e) => { counts[e.catId] = (counts[e.catId] || 0) + 1; });
    const cats = state.categories.slice().sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || TIER_KEYS.indexOf(a.tier) - TIER_KEYS.indexOf(b.tier));
    $('#catGrid').innerHTML = cats.map((c) => `
      <button class="cat-chip ${c.id === draft.catId ? 'on' : ''}" data-cat="${esc(c.id)}">
        ${catIcon(c)}<span class="n">${esc(c.name)}</span>
      </button>`).join('');
  }
  function updateAmount() {
    $('#amountVal').textContent = formatDraft(draft.amount);
    $('#amountDisplay').classList.toggle('zero', !(parseFloat(draft.amount) > 0));
    const c = draft.catId ? catById(draft.catId) : null;
    $('#selectedCat').innerHTML = c
      ? `<i class="dot" style="background:${tierColor(c.tier)}"></i>${esc(c.name)} · ${TIERS[c.tier].name}`
      : 'Choose a category';
    $('#saveBtn').disabled = !(parseFloat(draft.amount) > 0 && draft.catId);
  }
  function formatDraft(s) {
    const [i, d] = s.split('.');
    const int = Number(i).toLocaleString('en-US');
    return d !== undefined ? `${int}.${d}` : int;
  }
  function pressKey(k) {
    let a = draft.amount;
    if (k === 'back') a = a.length > 1 ? a.slice(0, -1) : '0';
    else if (k === '.') { if (!a.includes('.')) a += '.'; }
    else if (/^\d$/.test(k)) {
      const dec = a.split('.')[1];
      if ((dec && dec.length >= decimals()) || a.replace('.', '').length >= 10) { shake(); return; }
      a = a === '0' ? k : a + k;
    } else return;
    draft.amount = a; haptic(); updateAmount();
  }
  function shake() { const el = $('#amountDisplay'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  function saveDraft() {
    const amount = round(parseFloat(draft.amount));
    if (!(amount > 0)) { shake(); return; }
    if (!draft.catId) { toast('Choose a category', 'alert'); return; }
    // The date field has minute precision: only use it when the user changed it, so "Now" means the exact time.
    let ts;
    if (draft.dateTouched) {
      const d = new Date($('#dateInput').value);
      ts = (isNaN(d) ? new Date() : d).toISOString();
    } else {
      ts = draft.origTs || new Date().toISOString();
    }
    const note = $('#noteInput').value.trim();
    const editing = !!draft.id;
    if (editing) {
      const e = state.expenses.find((x) => x.id === draft.id);
      if (e) { Object.assign(e, { amount, catId: draft.catId, ts, note }); touch('expense', e); }
    } else {
      const rec = { id: uid(), amount, catId: draft.catId, ts, note };
      state.expenses.push(rec);
      touch('expense', rec);
    }
    state.settings.lastCat = draft.catId;
    if (!save()) return;
    closeSheet(); render();
    toast(`${editing ? 'Updated' : 'Saved'} ${money(amount)} · ${catById(draft.catId).name}`);
  }
  function deleteDraft() {
    if (!draft.id || !confirm('Delete this expense?')) return;
    tombstone('expense', draft.id);
    state.expenses = state.expenses.filter((e) => e.id !== draft.id);
    save(); closeSheet(); render(); toast('Expense deleted', 'trash');
  }

  // ---------- URL routing (Back Tap / Shortcuts entry point) ----------
  function handleRoute() {
    const hash = location.hash || '';
    if (hash.startsWith('#link=')) return linkDevice(decodeURIComponent(hash.slice(6)));
    if (!hash.startsWith('#add')) return;
    const params = new URLSearchParams(hash.split('?')[1] || location.search);
    const amount = parseFloat(params.get('amount'));
    const catParam = (params.get('cat') || '').toLowerCase().trim();
    const cat = catParam ? state.categories.find((c) => c.id === catParam || c.name.toLowerCase() === catParam) : null;
    if (amount > 0 && cat) {
      const rec = { id: uid(), amount: round(amount), catId: cat.id, ts: new Date().toISOString(), note: (params.get('note') || '').slice(0, 80) };
      state.expenses.push(rec);
      touch('expense', rec);
      state.settings.lastCat = cat.id;
      save(); history.replaceState(null, '', location.pathname); tab = 'today'; render();
      toast(`Saved ${money(amount)} · ${cat.name}`);
      return;
    }
    if (tab === 'settings') { tab = 'today'; render(); }
    openSheet(null, { amount: amount > 0 ? amount : null, catId: cat && cat.id });
  }

  // ---------- Cloud sync (offline-first) ----------
  // Every change is written to this device first and queued in state.sync.dirty. When online, the queue is
  // pushed to the server and newer changes from other devices are pulled. Conflicts: last write wins (updatedAt).
  const SYNC_API = window.SPENDLY_API || (location.hostname.endsWith('github.io') ? 'https://spendly-m35a.pages.dev/api' : '/api');
  const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
  const sync = { running: false, again: false, timer: null, status: navigator.onLine ? 'idle' : 'offline' };

  function touch(kind, rec) {
    rec.updatedAt = Date.now();
    state.sync.dirty[kind + ':' + (kind === 'settings' ? 'main' : rec.id)] = 1;
  }
  function tombstone(kind, id) {
    state.sync.tomb[kind + ':' + id] = Date.now();
    state.sync.dirty[kind + ':' + id] = 1;
  }
  const pendingCount = () => Object.keys(state.sync.dirty).length;
  function splitKey(key) { const i = key.indexOf(':'); return [key.slice(0, i), key.slice(i + 1)]; }

  function localVersion(kind, id) {
    const tomb = state.sync.tomb[kind + ':' + id];
    if (tomb) return tomb;
    if (kind === 'expense') { const e = state.expenses.find((x) => x.id === id); return e ? e.updatedAt || 0 : -1; }
    if (kind === 'category') { const c = state.categories.find((x) => x.id === id); return c ? c.updatedAt || 0 : -1; }
    if (kind === 'settings') return state.settings.updatedAt || 0;
    if (kind === 'entry') { const x = state.entries.find((y) => y.id === id); return x ? x.updatedAt || 0 : -1; }
    return -1;
  }
  function outgoing(key) {
    const [kind, id] = splitKey(key);
    if (state.sync.tomb[key]) return { kind, id, updatedAt: state.sync.tomb[key], deleted: true, data: null };
    if (kind === 'expense') {
      const e = state.expenses.find((x) => x.id === id);
      return e && { kind, id, updatedAt: e.updatedAt, deleted: false, data: { amount: e.amount, catId: e.catId, ts: e.ts, note: e.note || '' } };
    }
    if (kind === 'category') {
      const c = state.categories.find((x) => x.id === id);
      return c && { kind, id, updatedAt: c.updatedAt, deleted: false, data: { name: c.name, icon: c.icon, tier: c.tier, fixed: !!c.fixed } };
    }
    if (kind === 'entry') {
      const x = state.entries.find((y) => y.id === id);
      return x && { kind, id, updatedAt: x.updatedAt, deleted: false, data: { account: x.account, type: x.type, amount: x.amount, note: x.note, ts: x.ts } };
    }
    if (kind === 'settings') {
      const st = state.settings;
      return { kind, id: 'main', updatedAt: st.updatedAt || 0, deleted: false, data: {
        currency: st.currency, monthlyBudget: st.monthlyBudget, tierBudgets: st.tierBudgets,
        monthAllowances: st.monthAllowances, balance: st.balance, balanceAt: st.balanceAt, savings: st.savings, savingsAt: st.savingsAt,
      } };
    }
    return null;
  }
  function applyRemote(r) {
    if (localVersion(r.kind, r.id) >= r.updatedAt) return false; // local copy is the same or newer
    const key = r.kind + ':' + r.id;
    delete state.sync.dirty[key];
    delete state.sync.tomb[key];
    const d = r.data || {};
    if (r.kind === 'expense') {
      const i = state.expenses.findIndex((x) => x.id === r.id);
      if (r.deleted) { if (i >= 0) state.expenses.splice(i, 1); return true; }
      const rec = { id: r.id, amount: Number(d.amount) || 0, catId: String(d.catId || ''), ts: d.ts || new Date().toISOString(), note: String(d.note || ''), updatedAt: r.updatedAt };
      if (i >= 0) state.expenses[i] = rec; else state.expenses.push(rec);
    } else if (r.kind === 'category') {
      const i = state.categories.findIndex((x) => x.id === r.id);
      if (r.deleted) { if (i >= 0 && state.categories.length > 1) state.categories.splice(i, 1); return true; }
      const rec = { id: r.id, name: String(d.name || 'Category'), icon: window.ICONS[d.icon] ? d.icon : 'tag', tier: TIERS[d.tier] ? d.tier : 'lifestyle', updatedAt: r.updatedAt,
        fixed: d.fixed === undefined ? DEFAULT_FIXED.has(r.id) : !!d.fixed };
      if (i >= 0) state.categories[i] = rec; else state.categories.push(rec);
    } else if (r.kind === 'entry') {
      const i = state.entries.findIndex((x) => x.id === r.id);
      if (r.deleted) { if (i >= 0) state.entries.splice(i, 1); return true; }
      if (!ENTRY_ACCOUNTS.has(d.account) || !ENTRY_TYPES.has(d.type)) return false;
      const rec = { id: r.id, account: d.account, type: d.type, amount: Number(d.amount) || 0, note: String(d.note || ''), ts: d.ts || new Date().toISOString(), updatedAt: r.updatedAt };
      if (i >= 0) state.entries[i] = rec; else state.entries.push(rec);
    } else if (r.kind === 'settings' && !r.deleted) {
      Object.assign(state.settings, {
        currency: String(d.currency || 'TND'), monthlyBudget: Number(d.monthlyBudget) || 0,
        tierBudgets: Object.assign({ essential: 0, lifestyle: 0, luxury: 0 }, d.tierBudgets || {}), updatedAt: r.updatedAt,
        monthAllowances: normAllowances(d.monthAllowances), balance: numOrNull(d.balance), balanceAt: Number(d.balanceAt) || 0, savings: numOrNull(d.savings), savingsAt: Number(d.savingsAt) || 0,
      });
    }
    return true;
  }

  function scheduleSync(ms) { clearTimeout(sync.timer); sync.timer = setTimeout(() => syncNow(false), ms); }
  async function syncNow(manual) {
    if (sync.running) { sync.again = true; return; }
    if (!navigator.onLine) { setSyncStatus('offline'); if (manual) toast('Offline. Changes are saved on this phone.', 'cloudOff'); return; }
    sync.running = true;
    setSyncStatus('syncing');
    let changed = false;
    try {
      for (let pass = 0; pass < 50; pass++) {
        const keys = Object.keys(state.sync.dirty).slice(0, 200);
        const changes = [];
        keys.forEach((k) => { const r = outgoing(k); if (r) changes.push(r); else delete state.sync.dirty[k]; });
        const res = await fetch(SYNC_API + '/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.sync.key },
          body: JSON.stringify({ since: state.sync.cursor, changes }),
          cache: 'no-store',
        });
        if ([404, 405, 501].includes(res.status)) { const e = new Error('Sync server not set up'); e.code = 'nosetup'; throw e; }
        if (!res.ok) throw new Error('Server error ' + res.status);
        const body = await res.json();
        // Clear queued items the server now has, unless they were edited again while the request was in flight.
        changes.forEach((r) => {
          if (localVersion(r.kind, r.id) === r.updatedAt) { delete state.sync.dirty[r.kind + ':' + r.id]; delete state.sync.tomb[r.kind + ':' + r.id]; }
        });
        (body.records || []).forEach((r) => { if (applyRemote(r)) changed = true; });
        state.sync.cursor = Number(body.cursor) || 0;
        state.sync.lastSyncAt = Date.now();
        save(true);
        if (!body.more && !pendingCount()) break;
      }
      setSyncStatus('ok');
      if (manual) toast('Up to date', 'cloudCheck');
    } catch (e) {
      setSyncStatus(e.code === 'nosetup' ? 'nosetup' : navigator.onLine ? 'error' : 'offline');
      if (manual) toast(e.code === 'nosetup' ? 'Sync server is not set up yet' : 'Could not reach the sync server', 'cloudOff');
    } finally {
      sync.running = false;
      if (changed && canRerender()) render();
      else updateSyncUI();
      if (sync.again) { sync.again = false; scheduleSync(300); }
    }
  }
  function setSyncStatus(s) { sync.status = s; updateSyncUI(); }
  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function syncInfo() {
    const n = pendingCount();
    const waiting = n ? `${n} change${n === 1 ? '' : 's'} waiting to upload` : '';
    switch (sync.status) {
      case 'syncing': return { icon: 'refresh', cls: 'spin', text: 'Syncing…' };
      case 'offline': return { icon: 'cloudOff', cls: 'warn', text: 'Offline · ' + (waiting || 'everything is saved on this phone') };
      case 'nosetup': return { icon: 'cloudOff', cls: 'warn', text: 'Sync server not set up yet' + (n ? ' · ' + waiting : '') };
      case 'error': return { icon: 'cloudOff', cls: 'warn', text: 'Could not reach the sync server' + (n ? ' · ' + waiting : '') };
      default:
        if (n) return { icon: 'cloudUp', cls: '', text: waiting };
        return { icon: 'cloudCheck', cls: 'ok', text: state.sync.lastSyncAt ? 'Up to date · synced ' + ago(state.sync.lastSyncAt) : 'Not synced yet' };
    }
  }
  function updateSyncUI() {
    const info = syncInfo();
    const n = pendingCount();
    const badge = $('#syncBadge');
    if (badge) {
      badge.className = 'sync-badge ' + info.cls;
      badge.innerHTML = icon(info.icon) + (n && sync.status !== 'syncing' ? `<span class="num">${n}</span>` : '');
      badge.setAttribute('aria-label', info.text);
      badge.title = info.text;
    }
    const row = $('#syncRow');
    if (row) {
      row.querySelector('.sync-ico').className = 'sync-ico ' + info.cls;
      row.querySelector('.sync-ico').innerHTML = icon(info.icon);
      row.querySelector('.grow').textContent = info.text;
    }
  }
  function linkDevice(key) {
    history.replaceState(null, '', location.pathname);
    if (!KEY_RE.test(key)) return toast('That device link is not valid', 'alert');
    if (key === state.sync.key) return toast('This device is already linked', 'cloudCheck');
    if (!confirm('Link this device to your synced expenses? Expenses already on this device will be added to them.')) return;
    state.sync.key = key;
    state.sync.cursor = 0;
    state.sync.lastSyncAt = null;
    // Re-upload anything created on this device so it merges into the shared data.
    state.expenses.forEach((e) => { state.sync.dirty['expense:' + e.id] = 1; });
    state.categories.forEach((c) => { if (c.updatedAt) state.sync.dirty['category:' + c.id] = 1; });
    if (state.settings.updatedAt) state.sync.dirty['settings:main'] = 1;
    save(true);
    tab = 'today'; render();
    toast('Device linked', 'link');
    syncNow(false);
  }
  function deviceLink() { return location.origin + location.pathname.replace(/index\.html$/, '') + '#link=' + encodeURIComponent(state.sync.key); }

  // ---------- Data ----------
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  function exportCsv() {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Time', 'Amount', 'Category', 'Tier', 'Note']];
    state.expenses.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts)).forEach((e) => {
      const c = catById(e.catId); const d = new Date(e.ts);
      rows.push([toLocalInput(d).slice(0, 10), toLocalInput(d).slice(11), e.amount, c.name, TIERS[c.tier].name, e.note || '']);
    });
    download(`spendly-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
  }

  // ---------- Events ----------
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, [data-close]');
    if (!t) return;
    if (t.matches('[data-close]')) return closeSheet();
    if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
    if (t.id === 'fab') return openSheet(null);
    if (t.dataset.edit) { const e = state.expenses.find((x) => x.id === t.dataset.edit); if (e) openSheet(e); return; }
    if (t.dataset.month) { monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + Number(t.dataset.month), 1); render(); return; }
    if (t.dataset.mode) { monthMode = t.dataset.mode; render(); return; }
    if (t.dataset.bmonth) { budgetCursor = new Date(budgetCursor.getFullYear(), budgetCursor.getMonth() + Number(t.dataset.bmonth), 1); render(); return; }
    if (t.dataset.bm) { const [y, mo] = t.dataset.bm.split('-').map(Number); budgetCursor = new Date(y, mo - 1, 1); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (t.dataset.cat) { draft.catId = t.dataset.cat; haptic(); document.querySelectorAll('.cat-chip').forEach((c) => c.classList.toggle('on', c === t)); updateAmount(); return; }
    if (t.closest('#keypad')) return pressKey(t.dataset.key || t.textContent.trim());
    if (t.id === 'saveBtn') return saveDraft();
    if (t.id === 'deleteBtn') return deleteDraft();
    if (t.matches('[data-copy]')) {
      const url = $('#quickUrl').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied', 'copy'), () => prompt('Copy this link:', url));
      return;
    }
    if (t.dataset.newIcon) { newCat.icon = t.dataset.newIcon; document.querySelectorAll('[data-new-icon]').forEach((b) => b.classList.toggle('on', b === t)); return; }
    if (t.dataset.newTier) { newCat.tier = t.dataset.newTier; document.querySelectorAll('[data-new-tier]').forEach((b) => b.classList.toggle('on', b === t)); return; }
    if (t.dataset.money) return openMoney(t.dataset.money);
    if (t.dataset.src) return setMoneySource(t.dataset.src);
    if (t.id === 'moneySave') return saveMoney();
    if (t.dataset.entry) return deleteEntry(t.dataset.entry);
    if (t.id === 'toggleActivity') { showAllActivity = !showAllActivity; render(); return; }
    if (t.id === 'newFixed') { newCat.fixed = !newCat.fixed; t.classList.toggle('on', newCat.fixed); return; }
    if (t.dataset.unfix) { setFixed(t.dataset.unfix, false); return; }
    if (t.dataset.catDel) {
      const id = t.dataset.catDel;
      if (state.categories.length <= 1) return toast('Keep at least one category', 'alert');
      const used = state.expenses.filter((e) => e.catId === id).length;
      if (!confirm(used ? `${used} expense${used === 1 ? '' : 's'} use this category and will show as Uncategorized. Delete it?` : 'Delete this category?')) return;
      tombstone('category', id);
      state.categories = state.categories.filter((c) => c.id !== id); save(); render(); return;
    }
    if (t.id === 'addCat') {
      const name = $('#newName').value.trim();
      if (!name) { $('#newName').focus(); return toast('Enter a category name', 'alert'); }
      if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast('That category already exists', 'alert');
      const rec = { id: 'c' + uid(), icon: newCat.icon, name, tier: newCat.tier, fixed: newCat.fixed };
      state.categories.push(rec);
      touch('category', rec);
      newCat.name = ''; newCat.icon = 'tag'; newCat.fixed = false;
      save(); render(); toast(`Added ${name}`); return;
    }
    if (t.id === 'syncBadge') { tab = 'settings'; render(); window.scrollTo(0, 0); return; }
    if (t.id === 'syncNowBtn') return syncNow(true);
    if (t.id === 'linkBtn') {
      const url = deviceLink();
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Device link copied', 'link'), () => prompt('Open this link on your other device:', url));
      return;
    }
    if (t.id === 'pasteLinkBtn') {
      // A Home Screen web app has no address bar, so the link from the other copy is pasted here instead of opened.
      const v = prompt('Paste the device link from your other copy of Spendly:');
      if (v) linkDevice((v.match(/#link=([A-Za-z0-9_-]+)/) || [null, v.trim()])[1]);
      return;
    }
    if (t.id === 'exportCsv') return exportCsv();
    if (t.id === 'exportJson') return download(`spendly-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ expenses: state.expenses, categories: state.categories, settings: state.settings, entries: state.entries }, null, 2), 'application/json');
    if (t.id === 'wipe') {
      if (confirm('Erase all expenses? This cannot be undone.') && confirm('Are you sure? Consider backing up first.')) { state.expenses.forEach((e) => tombstone('expense', e.id)); state.expenses = []; save(); render(); toast('All expenses erased', 'trash'); }
    }
  });

  document.addEventListener('input', (ev) => { if (ev.target.id === 'newName') newCat.name = ev.target.value; });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'dateInput') { draft.dateTouched = true; updateDateLabel(false); }
    if (t.id === 'setCurrency') { state.settings.currency = t.value.trim().toUpperCase() || 'TND'; touch('settings', state.settings); save(); toast('Currency updated'); }
    if (t.id === 'addFixed' && t.value) { setFixed(t.value, true); return; }
    if (t.id === 'setBalance' || t.id === 'setSavings') {
      const account = t.id === 'setBalance' ? 'balance' : 'savings';
      const v = numOrNull(t.value);
      const now = Date.now();
      state.settings[account] = v;
      state.settings[account + 'At'] = now;
      touch('settings', state.settings);
      if (v !== null) logEntry(account, 'set', round(v), '', new Date(now).toISOString());
      save(); render(); toast(account === 'balance' ? 'Balance updated' : 'Savings updated');
    }
    if (t.id === 'moneyDate') { moneyDraft.dateTouched = true; const d = new Date(t.value); $('#moneyDateLabel').textContent = isNaN(d) ? 'Now' : (sameDay(d, new Date()) ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ', ' + timeStr(d); }
    if (t.id === 'setAllowance') {
      const ym = t.dataset.ym;
      const v = numOrNull(t.value);
      if (v === null) delete state.settings.monthAllowances[ym]; else state.settings.monthAllowances[ym] = Math.max(0, v);
      // The current month's allowance is also the default for months that don't have their own (used by the widget too).
      if (ym >= ymKey(new Date())) state.settings.monthlyBudget = v === null ? 0 : Math.max(0, v);
      touch('settings', state.settings); save(); render(); toast('Allowance updated');
    }
    if (t.dataset.tierBudget) { state.settings.tierBudgets[t.dataset.tierBudget] = Math.max(0, parseFloat(t.value) || 0); touch('settings', state.settings); save(); if (tab === 'budget') render(); toast('Limit updated'); }
    if (t.dataset.catTier) { const c = state.categories.find((x) => x.id === t.dataset.catTier); if (c) { c.tier = t.value; touch('category', c); save(); render(); toast(`${c.name} moved to ${TIERS[c.tier].name}`); } }
    if (t.id === 'importJson' && t.files[0]) {
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (!Array.isArray(d.expenses)) throw new Error('bad file');
          if (!confirm(`Replace current data with ${d.expenses.length} expenses from this backup?`)) return;
          const fresh = normalize(d);
          // Anything not in the backup is deleted everywhere; everything in it becomes the newest version.
          state.expenses.forEach((e) => { if (!fresh.expenses.some((x) => x.id === e.id)) tombstone('expense', e.id); });
          state.categories.forEach((c) => { if (!fresh.categories.some((x) => x.id === c.id)) tombstone('category', c.id); });
          if (Array.isArray(d.entries)) {
            state.entries.forEach((x) => { if (!fresh.entries.some((y) => y.id === x.id)) tombstone('entry', x.id); });
            state.entries = fresh.entries;
            state.entries.forEach((x) => touch('entry', x));
          }
          state.expenses = fresh.expenses; state.categories = fresh.categories;
          state.settings = Object.assign(fresh.settings, { lastCat: state.settings.lastCat });
          state.expenses.forEach((e) => touch('expense', e));
          state.categories.forEach((c) => touch('category', c));
          touch('settings', state.settings);
          save(); render(); toast('Backup restored');
        } catch (_) { toast('That file is not a valid backup', 'alert'); }
      };
      r.readAsText(t.files[0]);
      t.value = '';
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (!$('#sheet').classList.contains('open') || ev.target.tagName === 'INPUT') return;
    if (/^[0-9.]$/.test(ev.key)) pressKey(ev.key);
    else if (ev.key === 'Backspace') pressKey('back');
    else if (ev.key === 'Enter') saveDraft();
    else if (ev.key === 'Escape') closeSheet();
  });
  $('#noteInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.target.blur(); });
  ['#moneyAmount', '#moneyNote'].forEach((sel) => $(sel).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveMoney(); } }));

  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('online', () => syncNow(false));
  window.addEventListener('offline', () => setSyncStatus('offline'));
  setInterval(() => { if (!document.hidden) syncNow(false); }, 60000);
  window.addEventListener('pageshow', (e) => { if (e.persisted) handleRoute(); });
  document.addEventListener('visibilitychange', () => {
    // Upload right away when leaving (e.g. after a Back Tap add): iOS may freeze the page before the delayed sync runs.
    if (document.hidden) { if (pendingCount()) syncNow(false); return; }
    if (canRerender()) render();
    scheduleSync(300);
  });

  // ---------- Boot ----------
  hydrateIcons();
  save(true);
  render();
  handleRoute();
  scheduleSync(500);
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
