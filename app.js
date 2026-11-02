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
  ].map(([id, ic, name, tier]) => ({ id, icon: ic, name, tier }));
  const LEGACY_ICON = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.icon]));

  // ---------- State ----------
  const state = load();
  let tab = 'today';
  let monthCursor = startOfMonth(new Date());
  let monthMode = 'tier';
  const draft = { id: null, amount: '0', catId: null };
  const newCat = { name: '', icon: 'tag', tier: 'lifestyle' };

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { /* ignore */ }
    s = s || {};
    const categories = (Array.isArray(s.categories) && s.categories.length ? s.categories : DEFAULT_CATEGORIES.map((c) => ({ ...c })))
      .map((c) => {
        const out = { id: c.id, name: c.name, tier: TIERS[c.tier] ? c.tier : 'lifestyle', icon: c.icon || LEGACY_ICON[c.id] || 'tag' };
        if (!window.ICONS[out.icon]) out.icon = 'tag';
        return out;
      });
    const settings = Object.assign({ currency: '$', monthlyBudget: 0, lastCat: null }, s.settings || {});
    settings.tierBudgets = Object.assign({ essential: 0, lifestyle: 0, luxury: 0 }, settings.tierBudgets || {});
    return { expenses: Array.isArray(s.expenses) ? s.expenses : [], categories, settings };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; }
    catch (e) { toast('Could not save. Storage may be full.', 'alert'); return false; }
  }

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
  function fmt(n, compact) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const whole = compact && Number.isInteger(v);
    return v.toLocaleString(undefined, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }
  function money(n, compact) { const v = Number(n) || 0; return (v < 0 ? '-' : '') + state.settings.currency + fmt(Math.abs(v), compact); }
  function bigMoney(n) { return `<span class="cur">${esc(state.settings.currency)}</span>${fmt(n)}`; }
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
  function expensesIn(pred) { return state.expenses.filter((e) => pred(new Date(e.ts))).sort((a, b) => new Date(b.ts) - new Date(a.ts)); }
  function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute('data-icon'); }); }

  // ---------- Rendering ----------
  function render() {
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const view = $('#view');
    if (tab === 'today') { setTitle('Today', new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })); view.innerHTML = renderToday(); }
    if (tab === 'month') { setTitle('Overview', ''); view.innerHTML = renderMonth(); }
    if (tab === 'settings') { setTitle('Settings', ''); view.innerHTML = renderSettings(); }
    $('#fab').style.display = tab === 'settings' ? 'none' : '';
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
    const meta = [when, e.note ? esc(e.note) : TIERS[c.tier].name].join(' · ');
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
    const month = expensesIn((d) => sameMonth(d, now));
    const mTotal = sum(month);
    const budget = Number(state.settings.monthlyBudget) || 0;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate() + 1;

    let stats;
    if (budget) {
      const left = budget - mTotal;
      stats = `<div class="stats" style="--cols:3">
        <div><div class="k">This month</div><div class="v num">${money(mTotal, true)}</div></div>
        <div><div class="k">Budget left</div><div class="v num ${left < 0 ? 'over' : ''}">${money(left, true)}</div></div>
        <div><div class="k">Per day</div><div class="v num ${left < 0 ? 'over' : ''}">${left > 0 ? money(left / daysLeft, true) : money(0, true)}</div></div>
      </div>`;
    } else {
      stats = `<div class="stats">
        <div><div class="k">This month</div><div class="v num">${money(mTotal, true)}</div></div>
        <div><div class="k">Daily average</div><div class="v num">${money(mTotal / now.getDate(), true)}</div></div>
      </div>`;
    }

    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6); weekAgo.setHours(0, 0, 0, 0);
    const recent = expensesIn((d) => d >= weekAgo && !sameDay(d, now) && d < now);
    const groups = new Map();
    recent.forEach((e) => { const k = new Date(e.ts).toDateString(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });

    return `
      <section class="card summary">
        <div class="label">Spent today</div>
        <div class="big num">${bigMoney(sum(today))}</div>
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
        ${[...groups].map(([k, list]) => `<div class="day-head"><span>${dayLabel(new Date(k))}</span><span class="num">${money(sum(list))}</span></div>
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
    const budget = Number(state.settings.monthlyBudget) || 0;

    const perDay = Array.from({ length: days }, () => ({ essential: 0, lifestyle: 0, luxury: 0, t: 0 }));
    list.forEach((e) => { const d = new Date(e.ts).getDate() - 1; const t = catById(e.catId).tier; perDay[d][t] += Number(e.amount); perDay[d].t += Number(e.amount); });
    const max = Math.max(1, ...perDay.map((d) => d.t));
    const avg = total / elapsed;
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
          <div><div class="k">${budget ? 'Budget' : 'Expenses'}</div><div class="v num">${budget ? money(budget, true) : list.length}</div></div>
          <div><div class="k">Daily average</div><div class="v num">${money(avg, true)}</div></div>
          <div><div class="k">vs last month</div><div class="v num">${deltaHtml}</div></div>
        </div>
      </section>
      <section class="card">
        <div class="card-title">Daily spending<span class="aside num">avg ${money(avg, true)}</span></div>
        <div class="chart">${total ? `<div class="avg" style="bottom:${(avg / max) * 100}%"></div>` : ''}${bars}</div>
        <div class="chart-x"><span>1</span><span>${Math.ceil(days / 2)}</span><span>${days}</span></div>
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
      <p class="help">Back Tap opens links in Safari. Use Spendly in Safari so all your expenses stay together. When adding it to the Home Screen, turn off <b>Open as Web App</b> so the icon opens in Safari too.</p>

      <div class="section-label">Budgets</div>
      <div class="group">
        <label class="row"><span class="grow">Monthly budget</span><input id="setBudget" type="number" inputmode="decimal" min="0" step="any" value="${s.monthlyBudget || ''}" placeholder="Not set" /></label>
        ${TIER_KEYS.map((k) => `<label class="row"><i class="dot" style="background:${tierColor(k)}"></i><span class="grow">${TIERS[k].name}</span><input data-tier-budget="${k}" type="number" inputmode="decimal" min="0" step="any" value="${s.tierBudgets[k] || ''}" placeholder="Not set" /></label>`).join('')}
      </div>

      <div class="section-label">Preferences</div>
      <div class="group">
        <label class="row"><span class="grow">Currency symbol</span><input id="setCurrency" type="text" value="${esc(s.currency)}" maxlength="4" autocomplete="off" /></label>
      </div>

      ${catRows}

      <div class="section-label">New category</div>
      <div class="group">
        <div class="new-cat">
          <input id="newName" placeholder="Category name" maxlength="24" value="${esc(newCat.name)}" autocomplete="off" />
          <button class="btn" id="addCat">${icon('plus')}Add</button>
        </div>
        <div class="tier-pick">${TIER_KEYS.map((t) => `<button data-new-tier="${t}" class="${newCat.tier === t ? 'on' : ''}"><i class="dot" style="background:${tierColor(t)}"></i>${TIERS[t].name}</button>`).join('')}</div>
        <div class="icon-pick">${window.CATEGORY_ICONS.map((n) => `<button data-new-icon="${n}" class="${newCat.icon === n ? 'on' : ''}" aria-label="${n}">${icon(n)}</button>`).join('')}</div>
      </div>

      <div class="section-label">Data</div>
      <div class="group">
        <button class="row link" id="exportCsv">${icon('download')}<span class="grow">Export CSV</span></button>
        <button class="row link" id="exportJson">${icon('download')}<span class="grow">Back up data (JSON)</span></button>
        <label class="row link" style="cursor:pointer">${icon('upload')}<span class="grow">Restore from backup</span><input id="importJson" type="file" accept="application/json,.json" hidden /></label>
        <button class="row link danger" id="wipe">${icon('trash')}<span class="grow">Erase all expenses</span></button>
      </div>
      <p class="help">Your data is stored only on this device. Back it up from time to time.</p>
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
    $('#sheetTitle').textContent = expense ? 'Edit expense' : 'New expense';
    $('#deleteBtn').hidden = !expense;
    $('#amountCur').textContent = state.settings.currency;
    renderCats();
    updateAmount();
    $('#sheet').classList.add('open');
    $('#sheet').setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { const on = $('.cat-chip.on'); if (on) on.scrollIntoView({ inline: 'nearest', block: 'nearest' }); });
  }
  function closeSheet() {
    $('#sheet').classList.remove('open');
    $('#sheet').setAttribute('aria-hidden', 'true');
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
    const int = Number(i).toLocaleString(undefined);
    return d !== undefined ? `${int}.${d}` : int;
  }
  function pressKey(k) {
    let a = draft.amount;
    if (k === 'back') a = a.length > 1 ? a.slice(0, -1) : '0';
    else if (k === '.') { if (!a.includes('.')) a += '.'; }
    else if (/^\d$/.test(k)) {
      const dec = a.split('.')[1];
      if ((dec && dec.length >= 2) || a.replace('.', '').length >= 9) { shake(); return; }
      a = a === '0' ? k : a + k;
    } else return;
    draft.amount = a; haptic(); updateAmount();
  }
  function shake() { const el = $('#amountDisplay'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  function saveDraft() {
    const amount = Math.round(parseFloat(draft.amount) * 100) / 100;
    if (!(amount > 0)) { shake(); return; }
    if (!draft.catId) { toast('Choose a category', 'alert'); return; }
    const dateVal = $('#dateInput').value;
    const d = dateVal ? new Date(dateVal) : new Date();
    const ts = (isNaN(d) ? new Date() : d).toISOString();
    const note = $('#noteInput').value.trim();
    const editing = !!draft.id;
    if (editing) {
      const e = state.expenses.find((x) => x.id === draft.id);
      if (e) Object.assign(e, { amount, catId: draft.catId, ts, note });
    } else {
      state.expenses.push({ id: uid(), amount, catId: draft.catId, ts, note });
    }
    state.settings.lastCat = draft.catId;
    if (!save()) return;
    closeSheet(); render();
    toast(`${editing ? 'Updated' : 'Saved'} ${money(amount)} · ${catById(draft.catId).name}`);
  }
  function deleteDraft() {
    if (!draft.id || !confirm('Delete this expense?')) return;
    state.expenses = state.expenses.filter((e) => e.id !== draft.id);
    save(); closeSheet(); render(); toast('Expense deleted', 'trash');
  }

  // ---------- URL routing (Back Tap / Shortcuts entry point) ----------
  function handleRoute() {
    const hash = location.hash || '';
    if (!hash.startsWith('#add')) return;
    const params = new URLSearchParams(hash.split('?')[1] || location.search);
    const amount = parseFloat(params.get('amount'));
    const catParam = (params.get('cat') || '').toLowerCase().trim();
    const cat = catParam ? state.categories.find((c) => c.id === catParam || c.name.toLowerCase() === catParam) : null;
    if (amount > 0 && cat) {
      state.expenses.push({ id: uid(), amount: Math.round(amount * 100) / 100, catId: cat.id, ts: new Date().toISOString(), note: (params.get('note') || '').slice(0, 80) });
      state.settings.lastCat = cat.id;
      save(); history.replaceState(null, '', location.pathname); tab = 'today'; render();
      toast(`Saved ${money(amount)} · ${cat.name}`);
      return;
    }
    if (tab === 'settings') { tab = 'today'; render(); }
    openSheet(null, { amount: amount > 0 ? amount : null, catId: cat && cat.id });
  }

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
    if (t.dataset.catDel) {
      const id = t.dataset.catDel;
      if (state.categories.length <= 1) return toast('Keep at least one category', 'alert');
      const used = state.expenses.filter((e) => e.catId === id).length;
      if (!confirm(used ? `${used} expense${used === 1 ? '' : 's'} use this category and will show as Uncategorized. Delete it?` : 'Delete this category?')) return;
      state.categories = state.categories.filter((c) => c.id !== id); save(); render(); return;
    }
    if (t.id === 'addCat') {
      const name = $('#newName').value.trim();
      if (!name) { $('#newName').focus(); return toast('Enter a category name', 'alert'); }
      if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast('That category already exists', 'alert');
      state.categories.push({ id: 'c' + uid(), icon: newCat.icon, name, tier: newCat.tier });
      newCat.name = ''; newCat.icon = 'tag';
      save(); render(); toast(`Added ${name}`); return;
    }
    if (t.id === 'exportCsv') return exportCsv();
    if (t.id === 'exportJson') return download(`spendly-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
    if (t.id === 'wipe') {
      if (confirm('Erase all expenses? This cannot be undone.') && confirm('Are you sure? Consider backing up first.')) { state.expenses = []; save(); render(); toast('All expenses erased', 'trash'); }
    }
  });

  document.addEventListener('input', (ev) => { if (ev.target.id === 'newName') newCat.name = ev.target.value; });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'dateInput') updateDateLabel(false);
    if (t.id === 'setCurrency') { state.settings.currency = t.value.trim() || '$'; save(); toast('Currency updated'); }
    if (t.id === 'setBudget') { state.settings.monthlyBudget = Math.max(0, parseFloat(t.value) || 0); save(); toast('Budget updated'); }
    if (t.dataset.tierBudget) { state.settings.tierBudgets[t.dataset.tierBudget] = Math.max(0, parseFloat(t.value) || 0); save(); toast('Budget updated'); }
    if (t.dataset.catTier) { const c = state.categories.find((x) => x.id === t.dataset.catTier); if (c) { c.tier = t.value; save(); render(); toast(`${c.name} moved to ${TIERS[c.tier].name}`); } }
    if (t.id === 'importJson' && t.files[0]) {
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (!Array.isArray(d.expenses)) throw new Error('bad file');
          if (!confirm(`Replace current data with ${d.expenses.length} expenses from this backup?`)) return;
          localStorage.setItem(STORE_KEY, JSON.stringify(d));
          const fresh = load();
          state.expenses = fresh.expenses; state.categories = fresh.categories; state.settings = fresh.settings;
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

  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('pageshow', (e) => { if (e.persisted) handleRoute(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#sheet').classList.contains('open') && tab !== 'settings') render(); });

  // ---------- Boot ----------
  hydrateIcons();
  save();
  render();
  handleRoute();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
