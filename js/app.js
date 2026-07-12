/* NoofGains — views + interactions. */
'use strict';

(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPE_COLORS = { push: 'var(--c-push)', pull: 'var(--c-pull)', legs: 'var(--c-legs)', cardio: 'var(--c-cardio)', recovery: 'var(--c-recovery)' };
  const typeColor = (id) => TYPE_COLORS[id] || 'var(--ink-3)';

  const buzz = (ms = 12) => { if (navigator.vibrate) navigator.vibrate(ms); };

  /* ---------- toast (with optional undo) ---------- */
  let toastTimer = null;
  function toast(msg, undoFn) {
    const t = $('#toast');
    t.textContent = msg + (undoFn ? '  ·  tap to undo' : '');
    t.classList.add('show');
    t.style.pointerEvents = undoFn ? 'auto' : 'none';
    t.onclick = undoFn ? () => { undoFn(); hideToast(); render(); } : null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undoFn ? 4200 : 2200);
  }
  function hideToast() { $('#toast').classList.remove('show'); }

  /* ---------- bottom sheet ---------- */
  function openSheet(html) {
    $('#sheet').innerHTML = '<div class="grab"></div>' + html;
    $('#sheet').classList.add('open');
    $('#sheet-backdrop').classList.add('open');
  }
  function closeSheet() {
    $('#sheet').classList.remove('open');
    $('#sheet-backdrop').classList.remove('open');
  }
  $('#sheet-backdrop').addEventListener('click', closeSheet);

  /* ---------- router ---------- */
  let current = 'today';
  const renderers = {};

  function show(view) {
    current = view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    render();
    window.scrollTo(0, 0);
  }
  function render() { renderers[current](); }
  $$('.tab').forEach((t) => t.addEventListener('click', () => { buzz(6); show(t.dataset.view); }));

  const partOfDay = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };

  /* ================= TODAY ================= */

  renderers.today = () => {
    const s = Store.get();
    const today = Store.todayStr();
    const now = new Date();
    const greet = { morning: 'Morning, Noof', afternoon: 'Afternoon, Noof', evening: 'Evening, Noof' }[partOfDay()];
    const bday = today.slice(5) === '09-23';
    $('#today-greeting').textContent = bday ? 'Happy birthday, Noof 🎂' : greet;
    $('#today-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const nextId = Store.nextUpTypeId();
    const nextType = Store.typeById(nextId);
    const doneToday = Store.sessionsOn(today);
    const week = Store.weekStats();
    const flag = Coach.recoveryFlag();
    const morning = partOfDay() === 'morning';

    /* hero */
    const others = s.types.filter((t) => t.id !== nextId);
    const hero = doneToday.length
      ? `<div class="hero">
          <div class="done-state">
            <div class="done-check"><svg viewBox="0 0 24 24" fill="none" stroke="var(--volt)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 10 18.5 20 6"/></svg></div>
            <div>
              <div style="font-weight:600;font-size:17px">${doneToday.map((x) => esc((Store.typeById(x.typeId) || {}).name)).join(' + ')} — done</div>
              <div class="muted">Next up: ${esc(nextType.name)}</div>
            </div>
          </div>
          <div class="pill-row">
            <button class="btn-ghost pressable" data-log="${nextId}">Also did ${esc(nextType.name)}</button>
            <button class="btn-ghost pressable" data-more-types>More</button>
          </div>
        </div>`
      : `<div class="hero">
          <div class="eyebrow">Next up</div>
          <div class="hero-name">${esc(nextType.name)}</div>
          <button class="btn-volt pressable" data-log="${nextId}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 10 18.5 20 6"/></svg>
            Done
          </button>
          <div class="pill-row">${others.map((t) => `<button class="btn-ghost pressable" data-log="${t.id}">${esc(t.name)}</button>`).join('')}</div>
        </div>`;

    /* recovery flag */
    const flagCard = flag
      ? `<div class="card flag-card">
          <div class="flag-title">Recovery day flag</div>
          <p><b style="color:var(--ink)">${esc(flag.reason)}</b> ${esc(flag.advice)}</p>
          <div class="pill-row" style="margin-top:0">
            <button class="btn-ghost pressable" data-log="recovery">Log recovery</button>
            <button class="btn-ghost pressable" data-dismiss-flag>Dismiss</button>
          </div>
        </div>`
      : '';

    /* ring */
    const R = 40, C = 2 * Math.PI * R;
    const frac = Math.min(week.ringCount / week.goal, 1);
    const ring = `<div class="card ring-card">
        <div class="ring-wrap">
          <svg width="92" height="92" viewBox="0 0 92 92">
            <circle class="ring-track" cx="46" cy="46" r="${R}" fill="none" stroke-width="8"/>
            <circle class="ring-fill" cx="46" cy="46" r="${R}" fill="none" stroke-width="8"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/>
          </svg>
          <div class="ring-num">${week.ringCount}<span>/${week.goal}</span></div>
        </div>
        <div class="ring-meta">
          <div class="big">${week.ringCount >= week.goal ? 'Week complete. Respect.' : `${week.goal - week.ringCount} to go this week`}</div>
          <div class="sub"><b>${week.lifts}</b> lift${week.lifts === 1 ? '' : 's'}${week.cardio ? ` + <b>${week.cardio}</b> cardio` : ''}${week.recovery ? ` · ${week.recovery} recovery` : ''}</div>
        </div>
      </div>`;

    /* ----- Today's plan: outstanding items only — answered → gone ----- */
    const gl = Plan.goal();
    const pc = gl && Plan.modeOk() ? Plan.pace() : null;
    const items = Plan.todayItems(today);
    const yesterday = new Date(now.getTime() - 86400000);
    const shortDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const last = Store.lastWeight();
    const startW = last ? last.weight : 165;
    const avg = Store.rolling7Avg(today);

    const qRow = (field, q, dayTag) => `
      <div class="plan-item">
        <span class="pi-dot"></span>
        <div class="pi-body"><div class="pi-label">${q}</div><div class="pi-sub">${dayTag}</div></div>
        <span class="yn pi-yn">
          <button class="pressable" data-ci="${field}" data-val="1">Yes</button>
          <button class="pressable" data-ci="${field}" data-val="0">No</button>
        </span>
      </div>`;

    const weighOpen = morning || items.length === 1; // sole item left: open it
    const weighExpand = `
      <div class="pi-expand${weighOpen ? ' open' : ''}" id="weigh-expand">
        <div class="weigh-row">
          <div class="stepper">
            <button class="pressable" data-step="-0.5">−</button>
            <input class="val" id="w-val" type="text" inputmode="decimal" value="${startW.toFixed(1)}">
            <button class="pressable" data-step="0.5">+</button>
          </div>
          <span class="unit-tag">lb</span>
        </div>
        <button class="bf-toggle" id="bf-toggle">+ body fat %</button>
        <div class="bf-row" id="bf-row">
          <div class="stepper">
            <button class="pressable" data-bfstep="-0.5">−</button>
            <input class="val" id="bf-val" type="text" inputmode="decimal" value="${(last && last.bodyFat != null ? last.bodyFat : 18).toFixed(1)}">
            <button class="pressable" data-bfstep="0.5">+</button>
          </div>
          <span class="unit-tag">%</span>
        </div>
        <button class="btn-ghost pressable mt12" style="width:100%" id="w-save">Save</button>
      </div>`;

    const rows = items.map((it) => {
      if (it.id === 'goal') return `
        <button class="plan-item pressable" data-goal-setup>
          <span class="pi-dot"></span>
          <div class="pi-body"><div class="pi-label">Set your goal</div><div class="pi-sub">Pick the target — I’ll build the week-by-week plan</div></div>
          <span class="pi-chev">›</span>
        </button>`;
      if (it.id === 'weigh') return `
        <button class="plan-item pressable" data-weigh-toggle>
          <span class="pi-dot"></span>
          <div class="pi-body"><div class="pi-label">Morning weigh-in</div><div class="pi-sub">${avg != null ? `7-day avg ${avg.toFixed(1)} lb` : 'First entry sets the baseline'}</div></div>
          <span class="pi-chev" id="weigh-chev">${weighOpen ? '−' : '›'}</span>
        </button>${weighExpand}`;
      if (it.id === 'train') return `
        <div class="plan-item needed">
          <span class="pi-dot"></span>
          <div class="pi-body"><div class="pi-label">Train — ${esc(nextType.name)}</div><div class="pi-sub">${it.remaining} to go, ${it.daysLeft} day${it.daysLeft === 1 ? '' : 's'} left — today counts</div></div>
        </div>`;
      if (it.id === 'sleep') return qRow('sleptWell', 'Sleep well last night?', `${yesterday.toLocaleDateString('en-US', { weekday: 'short' })} night · ${shortDate(yesterday)}`);
      if (it.id === 'food') return qRow('ateHealthy', 'Eat healthy today?', `Today · ${shortDate(now)}`);
      if (it.id === 'steps') return qRow('hitSteps', '~8k steps today?', 'Biggest non-gym lever on a cut');
      return '';
    }).join('');

    const loggedToday = s.bodyweight.find((b) => b.date === today);
    const caughtUp = `
      <div class="caught-up">
        <div class="cu-check"><svg viewBox="0 0 24 24" fill="none" stroke="var(--volt)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 10 18.5 20 6"/></svg></div>
        <div>
          <div class="cu-title">All caught up</div>
          <div class="cu-sub">${loggedToday ? `<button class="cu-link" data-edit-weight>Weight ${loggedToday.weight.toFixed(1)} lb</button> · ` : ''}<button class="cu-link" data-edit-today>Edit today</button></div>
        </div>
      </div>`;

    const paceChip = pc
      ? `<span class="plan-pace ${pc.behindLb <= 0.05 ? 'ahead' : 'behind'}">${Math.abs(pc.behindLb) < 0.05 ? 'on plan' : `${Math.abs(pc.behindLb).toFixed(1)} lb ${pc.behindLb < 0 ? 'ahead' : 'behind'}`}</span>`
      : '';
    const planCard = `<div class="card">
        <div class="plan-head"><div class="card-label" style="margin:0">Today’s plan</div>${paceChip}</div>
        <div class="plan-items">${rows || caughtUp}</div>
      </div>`;

    $('#today-cards').innerHTML = [hero, flagCard, planCard, ring].join('');

    /* wire */
    $$('#today-cards [data-log]').forEach((b) => b.addEventListener('click', () => {
      const typeId = b.dataset.log;
      Store.logSession(typeId);
      buzz(24);
      const sess = Store.get().sessions;
      const id = sess[sess.length - 1].id;
      const hero2 = $('#today-cards .hero');
      if (hero2) hero2.classList.add('volt-flash');
      setTimeout(() => { render(); toast(`${(Store.typeById(typeId) || {}).name} logged`, () => Store.removeSession(id)); }, 380);
    }));
    const moreBtn = $('#today-cards [data-more-types]');
    if (moreBtn) moreBtn.addEventListener('click', () => openDaySheet(today));
    const dismiss = $('#today-cards [data-dismiss-flag]');
    if (dismiss) dismiss.addEventListener('click', () => { Store.update((st) => { st.coach.dismissedFlagOn = today; }); render(); });
    const gsBtn = $('#today-cards [data-goal-setup]');
    if (gsBtn) gsBtn.addEventListener('click', () => openGoalSheet());
    const wtog = $('#today-cards [data-weigh-toggle]');
    if (wtog) wtog.addEventListener('click', () => {
      const ex = $('#weigh-expand');
      ex.classList.toggle('open');
      $('#weigh-chev').textContent = ex.classList.contains('open') ? '−' : '›';
      buzz(6);
    });
    $$('#today-cards [data-ci]').forEach((b) => b.addEventListener('click', () => {
      const field = b.dataset.ci, v = b.dataset.val === '1';
      Store.setCheckin(today, field, v);
      buzz(12);
      render();
      toast(v ? 'Yes — noted' : 'No — noted', () => Store.setCheckin(today, field, null));
    }));
    const wval = $('#w-val');
    if (wval) {
      $$('#today-cards [data-step]').forEach((b) => b.addEventListener('click', () => {
        wval.value = (parseFloat(wval.value || startW) + parseFloat(b.dataset.step)).toFixed(1);
        buzz(6);
      }));
      const bfval = $('#bf-val');
      $$('#today-cards [data-bfstep]').forEach((b) => b.addEventListener('click', () => {
        bfval.value = (parseFloat(bfval.value || 18) + parseFloat(b.dataset.bfstep)).toFixed(1);
        buzz(6);
      }));
      $('#bf-toggle').addEventListener('click', () => $('#bf-row').classList.toggle('open'));
      $('#w-save').addEventListener('click', () => {
        const w = parseFloat(wval.value);
        if (!isFinite(w) || w < 60 || w > 500) { toast('That’s not a body weight, Noof'); return; }
        const bfOpen = $('#bf-row').classList.contains('open');
        const bf = bfOpen ? parseFloat($('#bf-val').value) : undefined;
        Store.setBodyweight(today, w, isFinite(bf) ? bf : undefined);
        buzz(18);
        render();
        toast('Weight saved', () => Store.removeBodyweight(today));
      });
    }
    const editT = $('#today-cards [data-edit-today]');
    if (editT) editT.addEventListener('click', () => openDaySheet(today));
    const editW = $('#today-cards [data-edit-weight]');
    if (editW) editW.addEventListener('click', () => openWeightSheet(today));
  };

  /* ================= FUEL ================= */

  renderers.fuel = () => {
    const today = Store.todayStr();
    const plan = Fuel.plan(today);
    const t = plan.targets;
    const dow = new Date().toLocaleDateString('en-US', { weekday: 'short' });

    $('#fuel-daytag').innerHTML = `<b>${t.kcal.toLocaleString()}</b> kcal · ${t.protein}g P`;
    $('#fuel-sub').textContent = `${dow} — ${plan.kindLabel} · ${t.mode === 'cut' ? 'Cut' : 'Bulk'} targets from your ${t.weightUsed} lb average`;

    const totals = plan.totals;
    const pct = (v, target) => Math.min((v / target) * 100, 100);
    const slotBtn = (v, label) => `<button class="pressable ${plan.slot === v ? 'active' : ''}" data-slot="${v}">${label}</button>`;

    const meals = plan.meals.map((m) => `
      <div class="meal">
        <div class="t">${m.time}</div>
        <div class="body">
          <div class="slot-name">${esc(m.name)}</div>
          <div class="food">${esc(m.food)}</div>
          <div class="m">${m.m[0]}${m.extraM ? '+' + m.extraM[0] : ''} cal · <b>${m.m[1]}${m.extraM ? '+' + m.extraM[1] : ''}g P</b> · ${m.m[2]}g F · ${m.m[3]}g C</div>
          ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
        </div>
        <button class="btn-ghost small swap pressable" data-swap="${m.slotId}">Swap</button>
      </div>`).join('');

    const tomorrow = Store.todayStr(new Date(Date.now() + 86400000));
    const tPlan = Fuel.plan(tomorrow);

    $('#fuel-body').innerHTML = `
      <div class="slot-choice">
        ${slotBtn('am', '7am lift')}${slotBtn('pm', '7pm lift')}${slotBtn('off', 'Rest day')}
      </div>
      <div class="card">
        <div class="macro-bar">
          <div class="track">
            <i class="p" style="width:${pct(totals.protein * 4, t.kcal)}%"></i>
            <i class="f" style="width:${pct(totals.fat * 9, t.kcal)}%"></i>
            <i class="c" style="width:${pct(totals.carbs * 4, t.kcal)}%"></i>
          </div>
          <div class="macro-nums">
            <span><b>${totals.kcal.toLocaleString()}</b> / ${t.kcal.toLocaleString()} cal</span>
            <span style="color:var(--volt)"><b>${totals.protein}</b> / ${t.protein}g protein</span>
          </div>
          <div class="macro-nums"><span>${totals.fat} / ${t.fat}g fat</span><span>${totals.carbs} / ${t.carbs}g carbs</span></div>
        </div>
        <div class="divider"></div>
        ${meals}
        <p class="tiny mt8">Chain-order macros are honest estimates from published nutrition info.</p>
      </div>
      <div class="card">
        <div class="card-label">Tomorrow — ${tPlan.kindLabel}</div>
        <p class="muted">${esc(tPlan.meals.map((m) => m.name).join(' · '))}</p>
      </div>`;

    $$('#fuel-body [data-slot]').forEach((b) => b.addEventListener('click', () => { Fuel.setSlotChoice(today, b.dataset.slot); buzz(8); render(); }));
    $$('#fuel-body [data-swap]').forEach((b) => b.addEventListener('click', () => { Fuel.swap(today, b.dataset.swap); buzz(8); render(); }));
  };

  /* ================= HISTORY ================= */

  let calMonth = null; // Date anchored to 1st of shown month

  renderers.history = () => {
    if (!calMonth) { const n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); }
    const s = Store.get();
    const today = Store.todayStr();
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const monthName = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
    const daysIn = new Date(y, m + 1, 0).getDate();
    let cells = '<div class="dow">M</div><div class="dow">T</div><div class="dow">W</div><div class="dow">T</div><div class="dow">F</div><div class="dow">S</div><div class="dow">S</div>';
    for (let i = 0; i < firstDow; i++) cells += '<div></div>';
    for (let d = 1; d <= daysIn; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const sess = Store.sessionsOn(ds);
      const dots = sess.slice(0, 3).map((x) => `<i style="background:${typeColor(x.typeId)}"></i>`).join('');
      const cls = ['cal-cell', 'pressable', ds === today ? 'today' : '', sess.length ? 'has-lift' : '', ds > today ? 'other' : ''].join(' ');
      cells += `<div class="${cls}" data-day="${ds}">${d}${dots ? `<div class="dots">${dots}</div>` : ''}</div>`;
    }

    /* 8-week target strip */
    let weekbars = '';
    for (let w = 7; w >= 0; w--) {
      const ref = new Date(); ref.setDate(ref.getDate() - w * 7);
      const st = Store.weekStats(ref);
      const hit = st.ringCount >= st.goal;
      const hpct = Math.min(st.ringCount / st.goal, 1) * 100;
      const label = w === 0 ? 'now' : `-${w}w`;
      weekbars += `<div class="weekbar ${hit ? 'hit' : ''}"><div class="bar"><i style="height:${hpct}%"></i></div><div class="wl">${label}</div></div>`;
    }

    const legend = s.types.map((t) => `<span><i style="background:${typeColor(t.id)}"></i>${esc(t.name)}</span>`).join('');

    $('#history-body').innerHTML = `
      <div class="card">
        <div class="cal-head">
          <button class="btn-ghost small pressable" data-cal="-1">‹</button>
          <div class="month">${monthName}</div>
          <button class="btn-ghost small pressable" data-cal="1">›</button>
        </div>
        <div class="cal-grid">${cells}</div>
        <div class="legend">${legend}</div>
      </div>
      <div class="card">
        <div class="card-label">Weeks hitting ${s.settings.weeklyGoal}/week</div>
        <div class="weekbar-strip">${weekbars}</div>
      </div>`;

    $$('#history-body [data-cal]').forEach((b) => b.addEventListener('click', () => {
      calMonth = new Date(y, m + parseInt(b.dataset.cal, 10), 1);
      render();
    }));
    $$('#history-body [data-day]').forEach((c) => c.addEventListener('click', () => {
      if (c.dataset.day > today) return;
      openDaySheet(c.dataset.day);
    }));
  };

  /* day editor sheet (backfill / fix) */
  function openDaySheet(date) {
    const s = Store.get();
    const sess = Store.sessionsOn(date);
    const c = Store.checkinOn(date) || {};
    const nice = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const typeRows = s.types.map((t) => {
      const logged = sess.filter((x) => x.typeId === t.id);
      return `<div class="set-li">
        <span style="display:flex;align-items:center;gap:8px"><i style="width:8px;height:8px;border-radius:50%;background:${typeColor(t.id)}"></i>${esc(t.name)}${logged.length > 1 ? ` ×${logged.length}` : ''}</span>
        <span style="display:flex;gap:8px">
          ${logged.length ? `<button class="btn-ghost small pressable" data-rm="${logged[logged.length - 1].id}">−</button>` : ''}
          <button class="btn-ghost small pressable" data-add="${t.id}">${logged.length ? '+' : 'Log'}</button>
        </span>
      </div>`;
    }).join('');

    const ciRow = (field, label) => `
      <div class="set-li"><span>${label}</span>
        <span class="yn" style="width:150px">
          <button class="pressable ${c[field] === true ? 'sel-yes' : ''}" data-sci="${field}" data-v="1">Yes</button>
          <button class="pressable ${c[field] === false ? 'sel-no' : ''}" data-sci="${field}" data-v="0">No</button>
        </span>
      </div>`;

    openSheet(`
      <h3>${nice}</h3>
      ${typeRows}
      <div class="divider"></div>
      ${ciRow('sleptWell', 'Slept well')}
      ${ciRow('ateHealthy', 'Ate healthy')}
      ${ciRow('hitSteps', '~8k steps')}
      <button class="btn-volt pressable mt16" data-close-sheet>Done</button>
    `);

    $$('#sheet [data-add]').forEach((b) => b.addEventListener('click', () => { Store.logSession(b.dataset.add, date); buzz(14); openDaySheet(date); render(); }));
    $$('#sheet [data-rm]').forEach((b) => b.addEventListener('click', () => { Store.removeSession(b.dataset.rm); buzz(10); openDaySheet(date); render(); }));
    $$('#sheet [data-sci]').forEach((b) => b.addEventListener('click', () => {
      const field = b.dataset.sci, v = b.dataset.v === '1';
      const cur = (Store.checkinOn(date) || {})[field];
      Store.setCheckin(date, field, cur === v ? null : v); // tap again to clear
      openDaySheet(date); render();
    }));
    $('#sheet [data-close-sheet]').addEventListener('click', () => { closeSheet(); render(); });
  }

  /* ================= TRENDS ================= */

  let trendRange = 90;

  renderers.trends = () => {
    const s = Store.get();
    const mode = Store.currentMode();
    $('#trends-sub').textContent = mode === 'cut' ? 'Cutting — down and to the right.' : 'Bulking — feed the machine.';

    /* ----- Plan: where you stand, the milestone line, this week's orders ----- */
    const g = Plan.goal();
    let planSec = '';
    if (!g) {
      planSec = `<div class="card">
          <div class="card-label">Plan</div>
          <p class="muted">Give me the target and I’ll lay out the weekly milestones — and exactly what to do each day to hit them.</p>
          <button class="btn-volt pressable mt12" data-goal-open>Set your goal</button>
        </div>`;
    } else if (!Plan.modeOk()) {
      planSec = `<div class="card">
          <div class="card-label">Plan</div>
          <p class="muted">You switched to <b style="color:var(--ink)">${mode}</b> — the ${g.mode} goal (${g.type === 'weight' ? `${g.target.toFixed(1)} lb` : `${g.target.toFixed(1)}% BF`}) is stale. Set a fresh one for this phase.</p>
          <div class="pill-row">
            <button class="btn-ghost pressable" data-goal-open>New goal</button>
            <button class="btn-ghost pressable" style="color:var(--bad)" data-goal-end>End plan</button>
          </div>
        </div>`;
    } else {
      const pc = Plan.pace();
      const ms = Plan.milestones();
      const rv = Plan.weekReview();
      const t = Fuel.targets();
      const wkAdh = Plan.adherence(Store.weekBounds().end);
      const adj = Plan.kcalAdjustment();
      const chips = ms.map((m) => {
        const cls = ['mile', m.current ? 'cur' : '', m.completed ? (m.hit === true ? 'hit' : m.hit === false ? 'miss' : '') : ''].filter(Boolean).join(' ');
        return `<div class="${cls}"><div class="mw">${m.goalWeek ? 'GOAL' : 'W' + m.n}</div><div class="mv">${(m.completed && m.actual != null ? m.actual : m.expected).toFixed(1)}</div></div>`;
      }).join('');
      const goalLabel = g.type === 'weight' ? `${g.target.toFixed(1)} lb` : `${g.target.toFixed(1)}% body fat`;
      const standTone = pc.behindLb <= 0.05 ? 'var(--good)' : 'var(--bad)';
      const standText = Math.abs(pc.behindLb) < 0.05 ? 'on plan' : `${Math.abs(pc.behindLb).toFixed(1)} lb ${pc.behindLb < 0 ? 'ahead of plan' : 'behind plan'}`;
      planSec = `<div class="card">
          <div class="card-label">Plan — ${g.mode} to ${goalLabel}</div>
          <div class="plan-big">${pc.cur.toFixed(1)} <span class="arr">→</span> ${pc.target.toFixed(1)} <small>lb</small></div>
          <div class="goal-track"><i style="width:${(pc.progress * 100).toFixed(1)}%"></i></div>
          <div class="plan-stand">${pc.toGo.toFixed(1)} lb to go · <span style="color:${standTone};font-weight:600">${standText}</span></div>
          <div class="mile-strip" id="mile-strip">${chips}</div>
          <div class="plan-dates">${Math.abs(pc.rateLb).toFixed(1)} lb/wk · plan line lands <b style="color:var(--ink)">${Plan.fmtD(pc.planDate)}</b>${pc.projDate ? ` · your pace says ${Plan.fmtD(pc.projDate)}` : pc.stalled ? ' · your pace: stalled' : ''}</div>
          <div class="divider"></div>
          <div class="card-label">This week</div>
          <div class="rx"><span class="k">Sessions</span><span class="v${wkAdh.sessionsOK ? ' done' : ''}">${wkAdh.sessions} / ${wkAdh.goal}</span></div>
          <div class="rx"><span class="k">Calories · protein</span><span class="v">${t.kcal.toLocaleString()} · ${t.protein}g</span></div>
          <div class="rx"><span class="k">Slept well</span><span class="v${wkAdh.sleepYes >= 5 ? ' done' : ''}">${wkAdh.sleepYes} / 5+ nights</span></div>
          ${mode === 'cut' ? `<div class="rx"><span class="k">~8k steps</span><span class="v${wkAdh.stepsYes >= 5 ? ' done' : ''}">${wkAdh.stepsYes} / 5+ days</span></div>` : ''}
          ${adj ? `<div class="rx-note cal">Calories auto-tuned <b>${adj > 0 ? '+' : ''}${adj}</b> from baseline — weekly calibration against your real results.</div>` : ''}
          ${rv ? `<div class="rx-note">${rv.msg}</div>` : ''}
          <div class="pill-row"><button class="btn-ghost small pressable" data-goal-open>Edit goal</button></div>
        </div>`;
    }

    const insights = Coach.localInsights().map((i) => `<div class="insight"><div class="dot"></div><p>${i.text}</p></div>`).join('');
    const entries = [...s.bodyweight].reverse().slice(0, 7).map((b) => `
      <div class="entry-li" data-edit-day="${b.date}">
        <span class="d">${new Date(b.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span class="w">${b.weight.toFixed(1)} lb${b.bodyFat != null ? ` · ${b.bodyFat}%` : ''}</span>
      </div>`).join('');

    const key = s.settings.anthropicKey;
    const li = s.coach.lastInsight;
    const coachBody = key
      ? `${li ? `<div class="coach-out">${esc(li.text)}</div><div class="coach-meta">Last analyzed ${li.date}${li.costUsd != null ? ` · cost $${li.costUsd.toFixed(2)}` : ''}</div>` : '<p class="muted">Your data, read by an actual intelligence.</p>'}
         <button class="btn-volt pressable mt12" id="coach-run">Analyze my data</button>`
      : `<p class="muted">Add your Anthropic API key in <b>More</b> to unlock the coach — tailored reads on your training, sleep, food, and weight. Costs pennies.</p>`;

    $('#trends-body').innerHTML = `
      ${planSec}
      <div class="mode-seg">
        <button class="pressable ${mode === 'cut' ? 'active' : ''}" data-mode="cut">Cut</button>
        <button class="pressable ${mode === 'bulk' ? 'active' : ''}" data-mode="bulk">Bulk</button>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div class="card-label" style="margin:0">Body weight — 7-day avg</div>
          <div class="range-seg">
            ${[30, 90, 3650].map((r) => `<button class="pressable ${trendRange === r ? 'active' : ''}" data-range="${r}">${r === 3650 ? 'All' : r + 'd'}</button>`).join('')}
          </div>
        </div>
        <div id="chart-weight"></div>
      </div>
      <div class="card" id="bf-card" style="display:none">
        <div class="card-label">Body fat %</div>
        <div id="chart-bf"></div>
      </div>
      <div class="card"><div class="card-label">Signals</div>${insights}</div>
      <div class="card"><div class="card-label">Coach · Claude</div>${coachBody}</div>
      <div class="card"><div class="card-label">Recent entries — tap a day to edit</div>${entries || '<p class="muted">No entries yet.</p>'}</div>`;

    /* charts */
    const cutoff = Store.todayStr(new Date(Date.now() - trendRange * 86400000));
    const wEntries = s.bodyweight.filter((b) => b.date >= cutoff).map((b) => ({ date: b.date, value: b.weight }));
    const avgSeries = wEntries.map((e) => ({ date: e.date, value: Store.rolling7Avg(e.date) }));
    const phases = s.modes.map((mrec, i) => ({
      start: mrec.startDate < cutoff ? cutoff : mrec.startDate,
      end: s.modes[i + 1] ? s.modes[i + 1].startDate : null,
      mode: mrec.mode,
    }));
    Charts.line($('#chart-weight'), { entries: wEntries, avg: avgSeries, phases, unit: 'lb', decimals: 0 });

    const bfEntries = s.bodyweight.filter((b) => b.date >= cutoff && b.bodyFat != null).map((b) => ({ date: b.date, value: b.bodyFat }));
    if (bfEntries.length >= 2) {
      $('#bf-card').style.display = '';
      Charts.line($('#chart-bf'), { entries: bfEntries, avg: [], phases: [], unit: '%', height: 150, decimals: 1 });
    }

    /* wire */
    $$('#trends-body [data-goal-open]').forEach((b) => b.addEventListener('click', () => openGoalSheet()));
    const gEnd = $('#trends-body [data-goal-end]');
    if (gEnd) gEnd.addEventListener('click', () => { Plan.clearGoal(); buzz(10); render(); toast('Plan ended'); });
    const strip = $('#mile-strip');
    if (strip) {
      const cur = strip.querySelector('.mile.cur');
      if (cur) strip.scrollLeft = Math.max(cur.offsetLeft - strip.clientWidth / 2 + cur.clientWidth / 2, 0);
    }
    $$('#trends-body [data-mode]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.mode !== mode) { Store.setMode(b.dataset.mode); buzz(10); render(); toast(`${b.dataset.mode === 'cut' ? 'Cut' : 'Bulk'} mode — targets updated`); }
    }));
    $$('#trends-body [data-range]').forEach((b) => b.addEventListener('click', () => { trendRange = parseInt(b.dataset.range, 10); render(); }));
    $$('#trends-body [data-edit-day]').forEach((row) => row.addEventListener('click', () => openWeightSheet(row.dataset.editDay)));
    const run = $('#coach-run');
    if (run) run.addEventListener('click', async () => {
      run.innerHTML = '<span class="spin"></span> Reading your data…';
      run.disabled = true;
      try {
        await Coach.analyze();
        render();
      } catch (e) {
        run.disabled = false;
        run.textContent = 'Analyze my data';
        toast(e.message === 'bad-key' ? 'API key rejected — check it in More' : 'Coach unavailable: ' + e.message);
      }
    });
  };

  function openWeightSheet(date) {
    const entry = Store.get().bodyweight.find((b) => b.date === date);
    if (!entry) return;
    openSheet(`
      <h3>${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
      <div class="set-li"><span>Weight (lb)</span><input type="number" step="0.1" inputmode="decimal" id="ew" value="${entry.weight}"></div>
      <div class="set-li"><span>Body fat %</span><input type="number" step="0.1" inputmode="decimal" id="ebf" value="${entry.bodyFat != null ? entry.bodyFat : ''}" placeholder="—"></div>
      <button class="btn-volt pressable mt16" id="ew-save">Save</button>
      <button class="btn-ghost pressable mt8" style="width:100%;color:var(--bad)" id="ew-del">Delete entry</button>
    `);
    $('#ew-save').addEventListener('click', () => {
      const w = parseFloat($('#ew').value);
      const bf = parseFloat($('#ebf').value);
      if (isFinite(w)) Store.setBodyweight(date, w, isFinite(bf) ? bf : undefined);
      closeSheet(); render();
    });
    $('#ew-del').addEventListener('click', () => { Store.removeBodyweight(date); closeSheet(); render(); });
  }

  /* ---------- goal sheet (set / edit / end the plan) ---------- */
  function openGoalSheet() {
    const g0 = Plan.goal();
    const mode = Store.currentMode();
    const curAvg = Store.rolling7Avg(Store.todayStr()) || (Store.lastWeight() || { weight: 165 }).weight;
    const curBf = Plan.latestBf();
    const editing = !!g0;
    let type = g0 && g0.mode === mode ? g0.type : 'weight';
    if (type === 'bf' && curBf == null) type = 'weight';

    const defFor = (ty) => ty === 'weight'
      ? Math.round((mode === 'cut' ? curAvg - 7 : curAvg + 7) * 2) / 2
      : Math.round((mode === 'cut' ? Math.max(curBf - 3, 5) : curBf + 2) * 2) / 2;
    const targetLb = (ty, v) => ty === 'weight' ? v : Math.round(((curAvg * (1 - curBf / 100)) / (1 - v / 100)) * 10) / 10;

    const problem = (ty, v) => {
      if (!isFinite(v)) return 'Enter a number';
      if (ty === 'weight' && (v < 80 || v > 400)) return 'That’s not a target weight';
      if (ty === 'bf' && (v < 4 || v > 50)) return 'Keep body fat between 4 and 50%';
      const t = targetLb(ty, v);
      if (mode === 'cut' && t >= curAvg - 0.4) return `Cutting — target must be below your ${curAvg.toFixed(1)} lb average`;
      if (mode === 'bulk' && t <= curAvg + 0.4) return `Bulking — target must be above your ${curAvg.toFixed(1)} lb average`;
      return null;
    };

    function paint(val) {
      openSheet(`
        <h3>${editing ? 'Edit goal' : 'Set your goal'}</h3>
        <div class="mode-seg" style="margin-bottom:14px">
          <button class="pressable ${type === 'weight' ? 'active' : ''}" data-gt="weight">Target weight</button>
          <button class="pressable ${type === 'bf' ? 'active' : ''}" data-gt="bf" ${curBf == null ? 'disabled style="opacity:.4"' : ''}>Target body fat</button>
        </div>
        ${curBf == null ? '<p class="tiny" style="margin:-8px 0 12px">Body-fat goals unlock once you log a BF% with a weigh-in.</p>' : ''}
        <div class="weigh-row">
          <div class="stepper">
            <button class="pressable" data-gstep="-0.5">−</button>
            <input class="val" id="g-val" type="text" inputmode="decimal" value="${val.toFixed(1)}">
            <button class="pressable" data-gstep="0.5">+</button>
          </div>
          <span class="unit-tag">${type === 'weight' ? 'lb' : '% BF'}</span>
        </div>
        <p class="goal-preview" id="g-preview"></p>
        <button class="btn-volt pressable" id="g-save">${editing ? 'Save — restart the line from today' : 'Start plan'}</button>
        ${editing ? '<button class="btn-ghost pressable mt8" style="width:100%;color:var(--bad)" id="g-end">End plan</button>' : ''}
      `);
      const refresh = () => {
        const v = parseFloat($('#g-val').value);
        const bad = problem(type, v);
        if (bad) { $('#g-preview').innerHTML = `<span style="color:var(--bad)">${bad}</span>`; return; }
        const t = targetLb(type, v);
        const rate = Plan.rateFor(curAvg, mode);
        const wks = Math.abs((t - curAvg) / rate);
        const lands = new Date(Date.now() + wks * 7 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        $('#g-preview').innerHTML = `${rate > 0 ? '+' : '−'}${Math.abs(rate).toFixed(1)} lb/wk — my prescription · ~${Math.ceil(wks)} wk${Math.ceil(wks) === 1 ? '' : 's'} · lands <b style="color:var(--ink)">${lands}</b>${type === 'bf' ? ` · ≈${t.toFixed(1)} lb` : ''}`;
      };
      refresh();
      $$('#sheet [data-gt]').forEach((b) => b.addEventListener('click', () => {
        if (b.disabled || b.dataset.gt === type) return;
        type = b.dataset.gt;
        buzz(8);
        paint(g0 && g0.mode === mode && g0.type === type ? g0.target : defFor(type));
      }));
      $$('#sheet [data-gstep]').forEach((b) => b.addEventListener('click', () => {
        const el = $('#g-val');
        el.value = ((parseFloat(el.value) || defFor(type)) + parseFloat(b.dataset.gstep)).toFixed(1);
        buzz(6);
        refresh();
      }));
      $('#g-val').addEventListener('input', refresh);
      $('#g-save').addEventListener('click', () => {
        const v = parseFloat($('#g-val').value);
        const bad = problem(type, v);
        if (bad) { toast(bad); return; }
        Plan.setGoal(type, Math.round(v * 10) / 10);
        buzz(18);
        closeSheet();
        render();
        toast(editing ? 'Plan reset — the line restarts today' : 'Plan set — milestones live in Trends');
      });
      const end = $('#g-end');
      if (end) end.addEventListener('click', () => { Plan.clearGoal(); closeSheet(); render(); toast('Plan ended'); });
    }
    paint(g0 && g0.mode === mode ? g0.target : defFor(type));
  }

  /* ================= MORE ================= */

  renderers.more = () => {
    const s = Store.get();
    const rotationNames = s.rotation.order.map((id) => (Store.typeById(id) || {}).name).join(' → ');
    const backupAge = s.settings.lastBackupAt
      ? Math.round((Date.now() - new Date(s.settings.lastBackupAt + 'T12:00:00').getTime()) / 86400000)
      : null;
    const nudge = backupAge === null || backupAge > 30
      ? `<p class="muted mt8" style="color:var(--bad)">⚠ ${backupAge === null ? 'Never backed up.' : `Last backup ${backupAge} days ago.`} iOS can evict web-app data — export a backup.</p>`
      : `<p class="tiny mt8">Last backup: ${s.settings.lastBackupAt}</p>`;

    $('#more-body').innerHTML = `
      <div class="card">
        <div class="card-label">Rotation</div>
        <p style="font-size:16px;font-weight:500">${esc(rotationNames)} → repeat</p>
        <p class="muted mt8">Next up: <b style="color:var(--ink)">${esc((Store.typeById(Store.nextUpTypeId()) || {}).name)}</b></p>
        <div class="pill-row">
          <button class="btn-ghost small pressable" id="rot-skip">Skip ahead</button>
        </div>
      </div>
      <div class="card">
        <div class="card-label">Weekly goal</div>
        <div class="weigh-row">
          <div class="stepper">
            <button class="pressable" data-goal="-1">−</button>
            <div class="val">${s.settings.weeklyGoal}</div>
            <button class="pressable" data-goal="1">+</button>
          </div>
          <span class="unit-tag">sessions / week</span>
        </div>
      </div>
      <div class="card">
        <div class="card-label">Goal</div>
        ${Plan.goal()
          ? `<p style="font-size:16px;font-weight:500">${Plan.goal().mode === 'cut' ? 'Cut' : 'Bulk'} to ${Plan.goal().type === 'weight' ? `${Plan.goal().target.toFixed(1)} lb` : `${Plan.goal().target.toFixed(1)}% body fat`}</p>
             <p class="muted mt8">Line started ${Plan.fmtD(Plan.goal().startDate)} at ${Plan.goal().startWeight.toFixed(1)} lb · milestones live in Trends</p>`
          : '<p class="muted">No goal set — the plan engine is idle. Give it a target.</p>'}
        <div class="pill-row">
          <button class="btn-ghost small pressable" id="more-goal">${Plan.goal() ? 'Edit goal' : 'Set goal'}</button>
        </div>
      </div>
      <div class="card">
        <div class="card-label">Coach · Claude API key</div>
        <p class="muted">Get a key at console.anthropic.com → paste it here. Stored only on this phone.</p>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="password" id="api-key" style="flex:1" placeholder="sk-ant-…" value="${esc(s.settings.anthropicKey || '')}">
          <button class="btn-ghost pressable" id="key-save">Save</button>
        </div>
        ${s.coach.spend && s.coach.spend.calls
          ? `<p class="tiny mt8">AI spend: <b style="color:var(--ink)">$${(s.coach.spend.byMonth[Store.todayStr().slice(0, 7)] || 0).toFixed(2)}</b> this month · $${s.coach.spend.totalUsd.toFixed(2)} all-time · ${s.coach.spend.calls} ${s.coach.spend.calls === 1 ? 'analysis' : 'analyses'}</p>`
          : ''}
      </div>
      <div class="card">
        <div class="card-label">Backup</div>
        <div class="pill-row" style="margin-top:0">
          <button class="btn-ghost pressable" id="do-export">Export</button>
          <button class="btn-ghost pressable" id="do-import">Import</button>
        </div>
        ${nudge}
        <input type="file" id="import-file" accept="application/json" class="hidden">
      </div>
      <div class="card">
        <div class="card-label">About</div>
        <p class="muted">NoofGains v1 — built for exactly one user. LFG.</p>
      </div>`;

    $('#more-goal').addEventListener('click', () => openGoalSheet());
    $('#rot-skip').addEventListener('click', () => {
      Store.update((st) => { st.rotation.nextIndex = (st.rotation.nextIndex + 1) % st.rotation.order.length; });
      render();
      toast(`Next up: ${(Store.typeById(Store.nextUpTypeId()) || {}).name}`);
    });
    $$('#more-body [data-goal]').forEach((b) => b.addEventListener('click', () => {
      Store.update((st) => { st.settings.weeklyGoal = Math.max(1, Math.min(14, st.settings.weeklyGoal + parseInt(b.dataset.goal, 10))); });
      render();
    }));
    $('#key-save').addEventListener('click', () => {
      Store.update((st) => { st.settings.anthropicKey = $('#api-key').value.trim(); });
      toast('Key saved on-device');
    });
    $('#do-export').addEventListener('click', async () => {
      const json = Store.exportJSON();
      const fname = `noofgains-backup-${Store.todayStr()}.json`;
      const file = new File([json], fname, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'NoofGains backup' }); render(); return; } catch { /* fall through */ }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
      render();
    });
    $('#do-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        Store.importJSON(await f.text());
        render();
        toast('Backup restored');
      } catch {
        toast('Not a valid NoofGains backup');
      }
    });
  };

  /* ---------- boot ---------- */
  show('today');
})();
