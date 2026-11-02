/* Spendly — local-first expense tracker (no build step, no server). */
(() => {
  'use strict';

  // ---------- Constants ----------
  const STORE_KEY = 'spendly.v1';
  const TIERS = {
    essential: { name: 'Essential', hint: 'Needs', color: 'var(--t-essential)' },
    lifestyle: { name: 'Lifestyle', hint: 'Wants', color: 'var(--t-lifestyle)' },
    luxury:    { name: 'Luxury',    hint: 'Splurges', color: 'var(--t-luxury)' },
  };
  const TIER_KEYS = Object.keys(TIERS);
  const DEFAULT_CATEGORIES = [
    ['groceries', '🛒', 'Groceries', 'essential'],
    ['bills', '💡', 'Bills', 'essential'],
    ['rent', '🏠', 'Rent', 'essential'],
    ['transport', '🚌', 'Transport', 'essential'],
    ['fuel', '⛽', 'Fuel', 'essential'],
    ['health', '💊', 'Health', 'essential'],
    ['food', '🍔', 'Eating out', 'lifestyle'],
    ['coffee', '☕', 'Coffee', 'lifestyle'],
    ['shopping', '🛍️', 'Shopping', 'lifestyle'],
    ['fun', '🎬', 'Entertainment', 'lifestyle'],
    ['subs', '📺', 'Subscriptions', 'lifestyle'],
    ['travel', '✈️', 'Travel', 'luxury'],
    ['tech', '📱', 'Gadgets', 'luxury'],
    ['gifts', '🎁', 'Gifts', 'luxury'],
    ['other', '📦', 'Other', 'lifestyle'],
  ].map(([id, emoji, name, tier]) => ({ id, emoji, name, tier }));

  // ---------- State ----------
  const state = load();
  let tab = 'today';
  let monthCursor = startOfMonth(new Date());
  let monthMode = 'tier';
  const draft = { id: null, amount: '0', catId: null };

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { /* ignore */ }
    s = s || {};
    return {
      expenses: Array.isArray(s.expenses) ? s.expenses : [],
      categories: Array.isArray(s.categories) && s.categories.length ? s.categories : DEFAULT_CATEGORIES.slice(),
      settings: Object.assign({ currency: '$', monthlyBudget: 0, tierBudgets: { essential: 0, lifestyle: 0, luxury: 0 }, lastCat: null }, s.settings || {}),
    };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('⚠️ Could not save — storage full?'); }
  }

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
  function money(n, opts = {}) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const s = v.toLocaleString(undefined, { minimumFractionDigits: opts.compact && Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
    return state.settings.currency + s;
  }
  function catById(id) { return state.categories.find((c) => c.id === id) || { id, emoji: '❔', name: 'Unknown', tier: 'lifestyle' }; }
  function tierColor(t) { return (TIERS[t] || TIERS.lifestyle).color; }
  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function dayLabel(d) {
    const today = new Date();
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function haptic() { if (navigator.vibrate) navigator.vibrate(8); }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function sum(list) { return list.reduce((a, e) => a + Number(e.amount || 0), 0); }
  function byTier(list) {
    const r = { essential: 0, lifestyle: 0, luxury: 0 };
    list.forEach((e) => { const t = catById(e.catId).tier; r[t] = (r[t] || 0) + Number(e.amount); });
    return r;
  }
  function expensesIn(pred) { return state.expenses.filter((e) => pred(new Date(e.ts))).sort((a, b) => new Date(b.ts) - new Date(a.ts)); }

  // ---------- Rendering ----------
  function render() {
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const view = $('#view');
    if (tab === 'today') { setTitle('Today', new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })); view.innerHTML = renderToday(); }
    if (tab === 'month') { setTitle('Month', ''); view.innerHTML = renderMonth(); }
    if (tab === 'settings') { setTitle('Settings', ''); view.innerHTML = renderSettings(); }
    $('#fab').style.display = tab === 'settings' ? 'none' : '';
  }
  function setTitle(t, s) { $('#viewTitle').textContent = t; $('#viewSub').textContent = s; }

  function tierBlock(totals, budgets) {
    const total = TIER_KEYS.reduce((a, k) => a + totals[k], 0);
    const bar = total
      ? TIER_KEYS.map((k) => `<span style="width:${(totals[k] / total) * 100}%;background:${tierColor(k)}"></span>`).join('')
      : '';
    const legend = TIER_KEYS.map((k) => {
      const b = budgets && Number(budgets[k]);
      const pct = b ? Math.min(100, (totals[k] / b) * 100) : 0;
      return `<div>
        <div class="t"><i class="dot" style="background:${tierColor(k)}"></i>${TIERS[k].name}</div>
        <div class="v num">${money(totals[k], { compact: true })}</div>
        ${b ? `<div class="progress"><i style="width:${pct}%;background:${totals[k] > b ? 'var(--danger)' : tierColor(k)}"></i></div>
               <div class="budget-line num">of ${money(b, { compact: true })}</div>` : `<div class="budget-line">${TIERS[k].hint}</div>`}
      </div>`;
    }).join('');
    return `<div class="tierbar">${bar}</div><div class="tier-legend">${legend}</div>`;
  }

  function expenseItem(e, showDate) {
    const c = catById(e.catId);
    const d = new Date(e.ts);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const sub = [TIERS[c.tier] ? TIERS[c.tier].name : '', showDate ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : time, e.note ? esc(e.note) : ''].filter(Boolean).join(' · ');
    return `<li><button class="item" data-edit="${esc(e.id)}">
      <span class="ico" style="background:color-mix(in srgb, ${tierColor(c.tier)} 16%, transparent)">${esc(c.emoji)}</span>
      <span class="mid"><div class="name">${esc(c.name)}</div><div class="sub">${sub}</div></span>
      <span class="amt">${money(e.amount)}</span>
    </button></li>`;
  }

  function renderToday() {
    const now = new Date();
    const today = expensesIn((d) => sameDay(d, now));
    const month = expensesIn((d) => sameMonth(d, now));
    const mTotal = sum(month);
    const dayOfMonth = now.getDate();
    const avg = mTotal / dayOfMonth;
    const budget = Number(state.settings.monthlyBudget) || 0;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const left = budget ? (budget - mTotal) / (daysInMonth - dayOfMonth + 1) : null;

    // Recent (last 7 days excluding today), grouped by day
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7); weekAgo.setHours(0, 0, 0, 0);
    const recent = expensesIn((d) => d >= weekAgo && !sameDay(d, now));
    const groups = {};
    recent.forEach((e) => { const d = new Date(e.ts); const k = d.toDateString(); (groups[k] = groups[k] || []).push(e); });

    return `
      <section class="card hero">
        <div class="label">Spent today</div>
        <div class="big num">${money(sum(today))}</div>
        <div class="row">
          <span class="pill num">Month ${money(mTotal, { compact: true })}</span>
          ${left !== null ? `<span class="pill num">${left >= 0 ? money(left, { compact: true }) + '/day left' : 'Over budget'}</span>` : `<span class="pill num">Avg ${money(avg, { compact: true })}/day</span>`}
        </div>
      </section>

      <section class="card">
        <h3>This month by tier</h3>
        ${tierBlock(byTier(month), state.settings.tierBudgets)}
      </section>

      <section class="card">
        <h3>Today</h3>
        ${today.length ? `<ul class="list">${today.map((e) => expenseItem(e)).join('')}</ul>`
          : `<div class="empty"><b>✨</b>No spending yet today.<br/>Tap + or double‑tap the back of your phone.</div>`}
      </section>

      ${recent.length ? `<section class="card"><h3>Earlier this week</h3>
        ${Object.keys(groups).map((k) => `<div class="day-head"><span>${dayLabel(new Date(k))}</span><span class="num">${money(sum(groups[k]))}</span></div>
          <ul class="list">${groups[k].map((e) => expenseItem(e)).join('')}</ul>`).join('')}
      </section>` : ''}
    `;
  }

  function renderMonth() {
    const m = monthCursor;
    const list = expensesIn((d) => sameMonth(d, m));
    const total = sum(list);
    const prev = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    const prevTotal = sum(expensesIn((d) => sameMonth(d, prev)));
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const isCurrent = sameMonth(m, new Date());
    const budget = Number(state.settings.monthlyBudget) || 0;

    // Daily stacked bars
    const perDay = Array.from({ length: days }, () => ({ essential: 0, lifestyle: 0, luxury: 0, t: 0 }));
    list.forEach((e) => { const d = new Date(e.ts).getDate() - 1; const t = catById(e.catId).tier; perDay[d][t] += Number(e.amount); perDay[d].t += Number(e.amount); });
    const max = Math.max(1, ...perDay.map((d) => d.t));
    const today = new Date().getDate();
    const bars = perDay.map((d, i) => `<div class="bar ${isCurrent && i + 1 === today ? 'today' : ''}" style="height:${Math.max(3, (d.t / max) * 100)}%" title="${i + 1}: ${money(d.t)}">
        ${d.t ? TIER_KEYS.map((k) => `<i style="display:block;height:${(d[k] / d.t) * 100}%;background:${tierColor(k)}"></i>`).join('') : ''}
      </div>`).join('');

    // Breakdown
    let breakdown = '';
    if (monthMode === 'tier') {
      const bt = byTier(list);
      breakdown = TIER_KEYS.map((k) => {
        const cats = {};
        list.filter((e) => catById(e.catId).tier === k).forEach((e) => { cats[e.catId] = (cats[e.catId] || 0) + Number(e.amount); });
        const rows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([id, v]) => catRow(catById(id), v, bt[k])).join('');
        return `<div class="day-head"><span><i class="dot" style="background:${tierColor(k)}"></i> ${TIERS[k].name} · ${TIERS[k].hint}</span><span class="num">${money(bt[k])} · ${total ? Math.round((bt[k] / total) * 100) : 0}%</span></div>${rows || '<div class="sub muted" style="font-size:13px;padding:6px 0">Nothing here</div>'}`;
      }).join('');
    } else if (monthMode === 'category') {
      const cats = {};
      list.forEach((e) => { cats[e.catId] = (cats[e.catId] || 0) + Number(e.amount); });
      breakdown = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([id, v]) => catRow(catById(id), v, total)).join('') || '<div class="empty">No expenses this month.</div>';
    } else {
      breakdown = list.length ? `<ul class="list">${list.map((e) => expenseItem(e, true)).join('')}</ul>` : '<div class="empty">No expenses this month.</div>';
    }

    const diff = prevTotal ? ((total - prevTotal) / prevTotal) * 100 : null;
    return `
      <div class="month-nav">
        <button data-month="-1" aria-label="Previous month">‹</button>
        <div class="m">${m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
        <button data-month="1" aria-label="Next month" ${isCurrent ? 'disabled style="opacity:.35"' : ''}>›</button>
      </div>
      <section class="card hero">
        <div class="label">Total spent</div>
        <div class="big num">${money(total)}</div>
        <div class="row">
          <span class="pill num">${list.length} expenses</span>
          <span class="pill num">Avg ${money(total / (isCurrent ? today : days), { compact: true })}/day</span>
          ${diff !== null ? `<span class="pill num">${diff >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(diff))}% vs last</span>` : ''}
        </div>
        ${budget ? `<div class="progress" style="background:rgba(255,255,255,.25);height:6px;margin-top:14px"><i style="width:${Math.min(100, (total / budget) * 100)}%;background:#fff"></i></div>
        <div class="label num" style="margin-top:6px;font-size:13px">${money(total, { compact: true })} of ${money(budget, { compact: true })} budget</div>` : ''}
      </section>
      <section class="card">
        <h3>Daily spending</h3>
        <div class="chart">${bars}</div>
        <div class="chart-x"><span>1</span><span>${Math.ceil(days / 2)}</span><span>${days}</span></div>
      </section>
      <section class="card">
        <h3>By tier</h3>
        ${tierBlock(byTier(list), state.settings.tierBudgets)}
      </section>
      <section class="card">
        <div class="seg">
          <button data-mode="tier" class="${monthMode === 'tier' ? 'on' : ''}">Tiers</button>
          <button data-mode="category" class="${monthMode === 'category' ? 'on' : ''}">Categories</button>
          <button data-mode="all" class="${monthMode === 'all' ? 'on' : ''}">All</button>
        </div>
        ${breakdown}
      </section>`;
  }
  function catRow(c, v, of) {
    const pct = of ? (v / of) * 100 : 0;
    return `<div class="cat-row">
      <span class="ico" style="background:color-mix(in srgb, ${tierColor(c.tier)} 16%, transparent)">${esc(c.emoji)}</span>
      <div class="mid"><div class="top"><span>${esc(c.name)}</span><span class="num">${money(v)}</span></div>
      <div class="progress"><i style="width:${pct}%;background:${tierColor(c.tier)}"></i></div></div>
    </div>`;
  }

  function renderSettings() {
    const s = state.settings;
    const quickUrl = location.origin + location.pathname + '#add';
    const catList = TIER_KEYS.map((k) => `
      <div class="day-head"><span><i class="dot" style="background:${tierColor(k)}"></i> ${TIERS[k].name}</span></div>
      ${state.categories.filter((c) => c.tier === k).map((c) => `
        <div class="cat-row">
          <span class="ico" style="background:color-mix(in srgb, ${tierColor(c.tier)} 16%, transparent)">${esc(c.emoji)}</span>
          <div class="mid">${esc(c.name)}</div>
          <select data-cat-tier="${esc(c.id)}" style="background:var(--card-2);border:0;border-radius:10px;padding:6px 8px">
            ${TIER_KEYS.map((t) => `<option value="${t}" ${t === c.tier ? 'selected' : ''}>${TIERS[t].name}</option>`).join('')}
          </select>
          <button class="chip-del" data-cat-del="${esc(c.id)}" aria-label="Delete ${esc(c.name)}">×</button>
        </div>`).join('')}`).join('');

    return `
      <section class="card">
        <h3>⚡ Double‑tap back to add</h3>
        <ol class="steps">
          <li>Open the <b>Shortcuts</b> app → <b>+</b> → add action <b>Open URLs</b>, paste this link and name it <b>Add Expense</b>:</li>
        </ol>
        <div class="code"><span id="quickUrl">${esc(quickUrl)}</span><button class="btn" data-copy>Copy</button></div>
        <ol class="steps" start="2">
          <li><b>Settings</b> → <b>Accessibility</b> → <b>Touch</b> → <b>Back Tap</b> → <b>Double Tap</b> → choose <b>Add Expense</b>.</li>
          <li>Double‑tap the back of your iPhone — the amount pad and categories pop up instantly.</li>
        </ol>
        <p class="muted" style="font-size:13px;margin:10px 0 0">Tip: Back Tap opens Safari, so use Spendly from Safari to keep one set of data. When adding it to your Home Screen, turn <b>Open as Web App</b> off (iOS 26+) so the icon also opens in Safari. Shortcut pro move: <span class="num">${esc(quickUrl)}?amount=4.5&amp;cat=coffee</span> saves instantly.</p>
      </section>

      <section class="card">
        <h3>General</h3>
        <label class="field"><span>Currency symbol</span><input id="setCurrency" value="${esc(s.currency)}" maxlength="4" /></label>
        <label class="field"><span>Monthly budget</span><input id="setBudget" type="number" inputmode="decimal" min="0" value="${s.monthlyBudget || ''}" placeholder="None" /></label>
        ${TIER_KEYS.map((k) => `<label class="field"><span><i class="dot" style="background:${tierColor(k)}"></i> ${TIERS[k].name} budget</span><input data-tier-budget="${k}" type="number" inputmode="decimal" min="0" value="${s.tierBudgets[k] || ''}" placeholder="None" /></label>`).join('')}
      </section>

      <section class="card">
        <h3>Categories</h3>
        ${catList}
        <div class="add-cat">
          <input id="newEmoji" placeholder="🙂" maxlength="4" style="text-align:center;font-size:20px" />
          <input id="newName" placeholder="New category name" maxlength="24" />
          <select id="newTier">${TIER_KEYS.map((t) => `<option value="${t}">${TIERS[t].name}</option>`).join('')}</select>
          <button class="btn primary" id="addCat">Add</button>
        </div>
      </section>

      <section class="card">
        <h3>Data</h3>
        <p class="muted" style="font-size:13px;margin:0 0 12px">Everything is stored privately on this device. Export a backup now and then.</p>
        <div class="btn-row">
          <button class="btn" id="exportCsv">Export CSV</button>
          <button class="btn" id="exportJson">Backup (JSON)</button>
          <label class="btn">Restore<input id="importJson" type="file" accept="application/json,.json" hidden /></label>
          <button class="btn danger" id="wipe">Erase all</button>
        </div>
      </section>
      <p class="muted" style="text-align:center;font-size:12px">Spendly · ${state.expenses.length} expenses stored</p>`;
  }

  // ---------- Quick-add sheet ----------
  function openSheet(expense, preset = {}) {
    draft.id = expense ? expense.id : null;
    draft.amount = expense ? String(expense.amount) : (preset.amount ? String(preset.amount) : '0');
    draft.catId = expense ? expense.catId : (preset.catId || state.settings.lastCat || null);
    if (draft.catId && !state.categories.some((c) => c.id === draft.catId)) draft.catId = null;
    $('#noteInput').value = expense ? (expense.note || '') : '';
    $('#dateInput').value = toLocalInput(expense ? new Date(expense.ts) : new Date());
    $('#sheetTitle').textContent = expense ? 'Edit expense' : 'New expense';
    $('#deleteBtn').hidden = !expense;
    $('#amountCur').textContent = state.settings.currency;
    renderCats();
    updateAmount();
    $('#sheet').classList.add('open');
    $('#sheet').setAttribute('aria-hidden', 'false');
    // Scroll selected category into view
    requestAnimationFrame(() => { const on = $('.cat-chip.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  }
  function closeSheet() {
    $('#sheet').classList.remove('open');
    $('#sheet').setAttribute('aria-hidden', 'true');
    document.activeElement && document.activeElement.blur();
    if (location.hash) history.replaceState(null, '', location.pathname);
  }
  function renderCats() {
    // Order: most used this month first, then by tier
    const counts = {};
    state.expenses.slice(-200).forEach((e) => { counts[e.catId] = (counts[e.catId] || 0) + 1; });
    const cats = state.categories.slice().sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || TIER_KEYS.indexOf(a.tier) - TIER_KEYS.indexOf(b.tier));
    $('#catGrid').innerHTML = cats.map((c) => `
      <button class="cat-chip ${c.id === draft.catId ? 'on' : ''}" data-cat="${esc(c.id)}">
        <span class="e">${esc(c.emoji)}</span><span class="n">${esc(c.name)}</span>
        <span class="tier-tag" style="background:${tierColor(c.tier)}"></span>
      </button>`).join('');
  }
  function updateAmount() {
    $('#amountVal').textContent = formatDraft(draft.amount);
    const c = draft.catId ? catById(draft.catId) : null;
    $('#selectedCat').innerHTML = c ? `${esc(c.emoji)} ${esc(c.name)} · <span style="color:${tierColor(c.tier)}">${TIERS[c.tier].name}</span>` : 'Pick a category';
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
    else {
      const dec = a.split('.')[1];
      if ((dec && dec.length >= 2) || a.replace('.', '').length >= 9) { shake(); return; }
      a = a === '0' ? k : a + k;
    }
    draft.amount = a; haptic(); updateAmount();
  }
  function shake() { const el = $('#amountDisplay'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  function saveDraft() {
    const amount = Math.round(parseFloat(draft.amount) * 100) / 100;
    if (!(amount > 0)) { shake(); return; }
    if (!draft.catId) { toast('Pick a category'); return; }
    const dateVal = $('#dateInput').value;
    const ts = (dateVal ? new Date(dateVal) : new Date()).toISOString();
    const note = $('#noteInput').value.trim();
    if (draft.id) {
      const e = state.expenses.find((x) => x.id === draft.id);
      if (e) Object.assign(e, { amount, catId: draft.catId, ts, note });
    } else {
      state.expenses.push({ id: uid(), amount, catId: draft.catId, ts, note });
    }
    state.settings.lastCat = draft.catId;
    save(); closeSheet(); render();
    toast(`${draft.id ? 'Updated' : 'Saved'} ${money(amount)} · ${catById(draft.catId).name}`);
  }
  function deleteDraft() {
    if (!draft.id || !confirm('Delete this expense?')) return;
    state.expenses = state.expenses.filter((e) => e.id !== draft.id);
    save(); closeSheet(); render(); toast('Deleted');
  }

  // ---------- URL routing (Back Tap / Shortcuts entry point) ----------
  function handleRoute() {
    const hash = location.hash || '';
    if (!hash.startsWith('#add')) return;
    const params = new URLSearchParams(hash.split('?')[1] || location.search);
    const amount = parseFloat(params.get('amount'));
    const catParam = (params.get('cat') || '').toLowerCase();
    const cat = state.categories.find((c) => c.id === catParam || c.name.toLowerCase() === catParam);
    if (amount > 0 && cat) {
      // Fully specified from a Shortcut: save immediately.
      state.expenses.push({ id: uid(), amount: Math.round(amount * 100) / 100, catId: cat.id, ts: new Date().toISOString(), note: params.get('note') || '' });
      state.settings.lastCat = cat.id;
      save(); history.replaceState(null, '', location.pathname); tab = 'today'; render();
      toast(`Saved ${money(amount)} · ${cat.name}`);
      return;
    }
    openSheet(null, { amount: amount > 0 ? amount : null, catId: cat && cat.id });
  }

  // ---------- Settings actions ----------
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportCsv() {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Amount', 'Category', 'Tier', 'Note']];
    state.expenses.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts)).forEach((e) => {
      const c = catById(e.catId);
      rows.push([new Date(e.ts).toLocaleString(), e.amount, c.name, TIERS[c.tier].name, e.note || '']);
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
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied'), () => prompt('Copy this link:', url));
      return;
    }
    if (t.dataset.catDel) {
      const id = t.dataset.catDel;
      const used = state.expenses.some((e) => e.catId === id);
      if (state.categories.length <= 1) return toast('Keep at least one category');
      if (!confirm(used ? 'This category has expenses. They will show as “Unknown”. Delete anyway?' : 'Delete this category?')) return;
      state.categories = state.categories.filter((c) => c.id !== id); save(); render(); return;
    }
    if (t.id === 'addCat') {
      const name = $('#newName').value.trim();
      if (!name) return toast('Enter a name');
      const emoji = $('#newEmoji').value.trim() || '🏷️';
      state.categories.push({ id: 'c' + uid(), emoji, name, tier: $('#newTier').value });
      save(); render(); toast('Category added'); return;
    }
    if (t.id === 'exportCsv') return exportCsv();
    if (t.id === 'exportJson') return download(`spendly-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
    if (t.id === 'wipe') {
      if (confirm('Erase ALL expenses? This cannot be undone.') && confirm('Really erase everything?')) { state.expenses = []; save(); render(); toast('All data erased'); }
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'setCurrency') { state.settings.currency = t.value.trim() || '$'; save(); toast('Saved'); }
    if (t.id === 'setBudget') { state.settings.monthlyBudget = Math.max(0, parseFloat(t.value) || 0); save(); toast('Saved'); }
    if (t.dataset.tierBudget) { state.settings.tierBudgets[t.dataset.tierBudget] = Math.max(0, parseFloat(t.value) || 0); save(); toast('Saved'); }
    if (t.dataset.catTier) { const c = state.categories.find((x) => x.id === t.dataset.catTier); if (c) { c.tier = t.value; save(); render(); } }
    if (t.id === 'importJson' && t.files[0]) {
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (!Array.isArray(d.expenses)) throw new Error('bad file');
          if (!confirm(`Replace current data with ${d.expenses.length} expenses from backup?`)) return;
          state.expenses = d.expenses;
          if (Array.isArray(d.categories) && d.categories.length) state.categories = d.categories;
          if (d.settings) state.settings = Object.assign(state.settings, d.settings);
          save(); render(); toast('Backup restored');
        } catch (_) { toast('Invalid backup file'); }
      };
      r.readAsText(t.files[0]);
    }
  });

  // Physical keyboard support on desktop
  document.addEventListener('keydown', (ev) => {
    if (!$('#sheet').classList.contains('open') || ev.target.tagName === 'INPUT') return;
    if (/^[0-9.]$/.test(ev.key)) pressKey(ev.key);
    else if (ev.key === 'Backspace') pressKey('back');
    else if (ev.key === 'Enter') saveDraft();
    else if (ev.key === 'Escape') closeSheet();
  });

  window.addEventListener('hashchange', handleRoute);
  // Re-check the route when iOS brings an already-open tab back to the front.
  window.addEventListener('pageshow', (e) => { if (e.persisted) handleRoute(); });
  // Keep views fresh if the date rolled over while the app was in the background.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#sheet').classList.contains('open')) render(); });

  // ---------- Boot ----------
  render();
  handleRoute();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
