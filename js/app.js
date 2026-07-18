/* NoofGains — views + interactions. */
'use strict';

(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPE_COLORS = { push: 'var(--c-push)', pull: 'var(--c-pull)', legs: 'var(--c-legs)', cardio: 'var(--c-cardio)', recovery: 'var(--c-recovery)' };
  const typeColor = (id) => TYPE_COLORS[id] || 'var(--ink-3)';

  const buzz = (ms = 12) => { if (navigator.vibrate) navigator.vibrate(ms); };

  /* Prefilled stepper inputs (goal target, weigh-in, steps): focusing selects the
     value so typing replaces it — appending to "158.0" silently kept the default. */
  document.addEventListener('focusin', (e) => {
    if (e.target.matches('.stepper input.val')) e.target.select();
  });

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
  function hideToast() {
    const t = $('#toast');
    t.classList.remove('show');
    // Disarm: a faded toast must not keep intercepting taps or holding a stale undo.
    t.style.pointerEvents = 'none';
    t.onclick = null;
  }

  /* Destructive buttons: first tap arms, second tap within 2.6s confirms. */
  function armToConfirm(btn, armedLabel, fn) {
    let timer = null;
    const orig = btn.textContent;
    btn.addEventListener('click', () => {
      if (btn.dataset.armed) { clearTimeout(timer); delete btn.dataset.armed; fn(); return; }
      btn.dataset.armed = '1';
      btn.textContent = armedLabel;
      buzz(8);
      timer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = orig; }, 2600);
    });
  }

  /* ---------- bottom sheet ---------- */
  function openSheet(html) {
    $('#sheet').innerHTML = '<div class="grab"></div><button class="sheet-x pressable" aria-label="Close">✕</button>' + html;
    $('#sheet .sheet-x').addEventListener('click', () => { buzz(6); closeSheet(); });
    $('#sheet').classList.add('open');
    $('#sheet-backdrop').classList.add('open');
  }
  function closeSheet() {
    $('#sheet').classList.remove('open');
    $('#sheet-backdrop').classList.remove('open');
  }
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

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

  const partOfDay = () => { const h = new Date().getHours(); return h < 5 ? 'evening' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };

  /* ================= TODAY ================= */

  renderers.today = () => {
    const s = Store.get();
    const today = Store.todayStr();
    const now = new Date();
    const name = (s.settings.profile && s.settings.profile.name) || 'Noof';
    const greet = { morning: `Morning, ${name}`, afternoon: `Afternoon, ${name}`, evening: `Evening, ${name}` }[partOfDay()];
    const bday = today.slice(5) === ((s.settings.profile && s.settings.profile.birthdate) || '2000-09-23').slice(5);
    $('#today-greeting').textContent = bday ? `Happy birthday, ${name} 🎂` : greet;
    $('#today-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const nextId = Store.nextUpTypeId();
    const nextType = Store.typeById(nextId);
    const doneToday = Store.sessionsOn(today);
    const week = Store.weekStats();
    const flag = Coach.recoveryFlag();

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

    /* blunt-coach nudge — one line, only when something is slipping */
    const ndg = Coach.nudge();
    const nudgeCard = ndg
      ? `<div class="card nudge-card${ndg.go ? ' pressable' : ''}" ${ndg.go ? `data-nudge-go="${ndg.go}"` : ''}>
          <div class="card-label">Coach</div>
          <p>${esc(ndg.line)}</p>
        </div>`
      : '';

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

    /* ----- Today's plan: outstanding items only — answered → gone -----
       The weigh-in row is renderer-filtered, not engine-removed (July 2026,
       Dylan: "that comes from the Withings app"): the scale auto-logs it, so
       the page never asks — but todayItems still reports it, so the 9pm push
       still chases a day he forgot to step on. Manual fallback lives in the
       day sheet (Edit today). */
    const gl = Plan.goal();
    const pc = gl && Plan.modeOk() ? Plan.pace() : null;
    const items = Plan.todayItems(today).filter((it) => it.id !== 'weigh');

    const last = Store.lastWeight();
    const avg = Store.rolling7Avg(today);

    const rows = items.map((it) => {
      if (it.id === 'goal') return `
        <button class="plan-item pressable" data-goal-setup>
          <span class="pi-dot"></span>
          <div class="pi-body"><div class="pi-label">Set your goal</div><div class="pi-sub">Pick the target — I’ll build the week-by-week plan</div></div>
          <span class="pi-chev">›</span>
        </button>`;
      if (it.id === 'train') return `
        <div class="plan-item needed">
          <span class="pi-dot"></span>
          <div class="pi-body"><div class="pi-label">Train — ${esc(nextType.name)}</div><div class="pi-sub">${it.remaining} to go, ${it.daysLeft} day${it.daysLeft === 1 ? '' : 's'} left — today counts</div></div>
        </div>`;
      if (it.id === 'photo') return `
        <div class="plan-item">
          <span class="pi-dot"></span>
          <div class="pi-body"><div class="pi-label">Photo check-in</div><div class="pi-sub">3 shots, 60 sec, encrypted · <button class="cu-link" data-photo-skip>skip this round</button></div></div>
          <button class="btn-ghost small pressable" data-photo-start>Camera</button>
        </div>`;
      return '';
    }).join('');

    const loggedToday = s.bodyweight.find((b) => b.date === today);
    const cToday = Store.checkinOn(today) || {};
    const caughtUp = `
      <div class="caught-up">
        <div class="cu-check"><svg viewBox="0 0 24 24" fill="none" stroke="var(--volt)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 10 18.5 20 6"/></svg></div>
        <div>
          <div class="cu-title">All caught up</div>
          <div class="cu-sub">${loggedToday ? `<button class="cu-link" data-edit-weight>Weight ${loggedToday.weight.toFixed(1)} lb</button> · ` : ''}<button class="cu-link" data-edit-today>Edit today</button></div>
        </div>
      </div>`;

    /* goal strip — the fat-loss glance: bf% trend, avg vs goal, pace */
    const bwBf = s.bodyweight.filter((b) => b.bodyFat != null);
    const bfLast = bwBf.length ? bwBf[bwBf.length - 1] : null;
    let bfDelta = null;
    if (bfLast) {
      const cutoff = Store.todayStr(new Date(new Date(bfLast.date + 'T12:00:00').getTime() - 10 * 86400000));
      const ref = [...bwBf].reverse().find((b) => b.date <= cutoff);
      if (ref) bfDelta = { d: bfLast.bodyFat - ref.bodyFat, days: Math.round((new Date(bfLast.date + 'T12:00:00') - new Date(ref.date + 'T12:00:00')) / 86400000) };
    }
    const wNow = avg != null ? avg : (last ? last.weight : null);
    const gsStats = [`<div class="gs-stat">
        <div class="gs-label">Body fat</div>
        <div class="gs-num">${bfLast ? `${bfLast.bodyFat.toFixed(1)}<span>%</span>` : '—'}</div>
        <div class="gs-delta${bfDelta ? (bfDelta.d <= -0.05 ? ' good' : bfDelta.d >= 0.05 ? ' bad' : '') : ''}">${bfDelta ? `${bfDelta.d < -0.05 ? '▼' : bfDelta.d > 0.05 ? '▲' : '·'} ${Math.abs(bfDelta.d).toFixed(1)} pts in ${bfDelta.days}d` : bfLast ? 'no trend yet' : 'scale sends it'}</div>
      </div>`,
      `<div class="gs-stat">
        <div class="gs-label">7-day avg</div>
        <div class="gs-num">${wNow != null ? `${wNow.toFixed(1)}<span>lb</span>` : '—'}</div>
        <div class="gs-delta">${pc ? `${pc.toGo.toFixed(1)} lb to ${pc.target.toFixed(0)}` : 'no goal set'}</div>
      </div>`];
    if (pc) gsStats.push(`<div class="gs-stat">
        <div class="gs-label">Pace</div>
        <div class="gs-num small${pc.behindLb <= 0.05 ? ' good' : ' bad'}">${Math.abs(pc.behindLb) < 0.05 ? 'On plan' : `${Math.abs(pc.behindLb).toFixed(1)} lb ${pc.behindLb < 0 ? 'ahead' : 'behind'}`}</div>
        <div class="gs-delta">${pc.projDate ? `→ ${Plan.fmtD(pc.projDate)}` : pc.stalled ? 'trend stalled' : `plan: ${Plan.fmtD(pc.planDate)}`}</div>
      </div>`);
    const goalStrip = last
      ? `<div class="card goal-strip pressable" data-strip-go>${gsStats.join('<div class="gs-div"></div>')}</div>`
      : '';

    /* today's numbers — passive readouts, never questions: steps fill in from
       the phone via Withings; fuel is the day's prescription (weekday-aware) */
    const fp = Fuel.plan(today);
    const stepsN = cToday.steps;
    const stepsFrac = stepsN != null ? Math.min(stepsN / Plan.stepsTarget, 1) : 0;
    const todayLine = `<div class="card today-line">
        <div class="card-label">Today’s numbers</div>
        <div class="tl-row">
          <span class="tl-k">Steps</span>
          <span class="tl-v">${stepsN != null
            ? `${stepsN.toLocaleString()} <span class="tl-sub">/ ${Plan.stepsTarget / 1000}k</span>`
            : cToday.hitSteps === true ? 'target hit' : '<span class="tl-sub">sync from your phone</span>'}</span>
        </div>
        ${stepsN != null ? `<div class="tl-track"><div class="tl-fill${stepsN >= Plan.stepsTarget ? ' hit' : ''}" style="width:${Math.round(stepsFrac * 100)}%"></div></div>` : ''}
        <div class="tl-row pressable" data-fuel-go>
          <span class="tl-k">Fuel</span>
          <span class="tl-v">~${fp.targets.kcal.toLocaleString()} kcal · ${fp.targets.protein}g P <span class="tl-sub">· ${esc(fp.shape.label)} ›</span></span>
        </div>
      </div>`;

    /* pace chip retired from the plan head — the goal strip above owns pace now */
    const planCard = `<div class="card">
        <div class="plan-head"><div class="card-label" style="margin:0">Today’s plan</div></div>
        <div class="plan-items">${rows || caughtUp}</div>
      </div>`;

    $('#today-cards').innerHTML = [hero, nudgeCard, flagCard, goalStrip, todayLine, planCard, ring].join('');

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
    const stripGo = $('#today-cards [data-strip-go]');
    if (stripGo) stripGo.addEventListener('click', () => { buzz(6); show('trends'); }); // full milestone story lives in Trends
    const fuelGo = $('#today-cards [data-fuel-go]');
    if (fuelGo) fuelGo.addEventListener('click', () => { buzz(6); show('fuel'); });
    const nudgeGo = $('#today-cards [data-nudge-go]');
    if (nudgeGo) nudgeGo.addEventListener('click', () => { buzz(6); show(nudgeGo.dataset.nudgeGo); });
    const dismiss = $('#today-cards [data-dismiss-flag]');
    if (dismiss) dismiss.addEventListener('click', () => { Store.update((st) => { st.coach.dismissedFlagOn = today; }); render(); });
    const gsBtn = $('#today-cards [data-goal-setup]');
    if (gsBtn) gsBtn.addEventListener('click', () => openGoalSheet());
    const editT = $('#today-cards [data-edit-today]');
    if (editT) editT.addEventListener('click', () => openDaySheet(today));
    const editW = $('#today-cards [data-edit-weight]');
    if (editW) editW.addEventListener('click', () => openWeightSheet(today));
    const phStart = $('#today-cards [data-photo-start]');
    if (phStart) phStart.addEventListener('click', () => { buzz(8); Photos.openCheckin(() => render()); });
    const phSkip = $('#today-cards [data-photo-skip]');
    if (phSkip) phSkip.addEventListener('click', () => {
      const start = Store.weekBounds().start;
      Photos.skipWeek(today);
      buzz(8);
      render();
      toast('Skipped — back in 2 weeks', () => Store.update((st) => { st.photos.skips = st.photos.skips.filter((x) => x !== start); }));
    });
  };

  /* ================= FUEL ================= */

  renderers.fuel = () => {
    const today = Store.todayStr();
    const plan = Fuel.plan(today);
    const t = plan.targets;
    const dow = new Date().toLocaleDateString('en-US', { weekday: 'short' });

    $('#fuel-daytag').innerHTML = `<b>${t.kcal.toLocaleString()}</b> kcal · ${t.protein}g P`;
    $('#fuel-sub').textContent = `${dow} — ${plan.shape.label} · ${plan.kindLabel} · ${t.mode === 'cut' ? 'Cut' : 'Bulk'} targets from ${t.weightUsed} lb${t.bfUsed != null ? ` / ${t.bfUsed.toFixed(1)}%` : ''}`;

    const totals = plan.totals;
    const pct = (v, target) => Math.min((v / target) * 100, 100);
    const shapeChips = Object.entries(Fuel.SHAPES)
      .map(([id, sh]) => `<button class="shape-chip pressable ${plan.shapeId === id ? 'active' : ''}" data-shape="${id}">${sh.chip}</button>`)
      .join('');

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
      <div class="shape-strip" aria-label="Today’s training shape">${shapeChips}</div>
      <div class="card">
        <div class="card-label">Planned menu vs today's targets</div>
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
        <div class="card-label">Tomorrow — ${tPlan.shape.label} · ${tPlan.kindLabel}</div>
        <p class="muted">${esc(tPlan.meals.map((m) => m.name).join(' · '))}</p>
      </div>`;

    $$('#fuel-body [data-shape]').forEach((b) => b.addEventListener('click', () => { Fuel.setShape(today, b.dataset.shape); buzz(8); render(); }));
    $$('#fuel-body [data-swap]').forEach((b) => b.addEventListener('click', () => { Fuel.swap(today, b.dataset.swap); buzz(8); render(); }));
  };

  /* ================= FOOD ================= */

  /* In-flight parse + draft text live OUTSIDE the render cycle so re-renders
     (sync pulls, tab hops) never eat a half-dictated recap. */
  let foodLive = false;    // a parse is running
  let foodEditing = false; // today's card is in textarea mode despite a saved log
  let foodDraft = '';      // textarea contents across renders
  let foodExpanded = null; // date expanded in the history list

  const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

  const macroBar = (totals, t) => {
    const pct = (v) => Math.min((v / t.kcal) * 100, 100);
    return `<div class="macro-bar" style="margin-top:4px">
        <div class="track">
          <i class="p" style="width:${pct(totals.protein_g * 4)}%"></i>
          <i class="f" style="width:${pct(totals.fat_g * 9)}%"></i>
          <i class="c" style="width:${pct(totals.carbs_g * 4)}%"></i>
        </div>
        <div class="macro-nums">
          <span><b>${totals.kcal.toLocaleString()}</b> / ${t.kcal.toLocaleString()} cal</span>
          <span style="color:var(--volt)"><b>${totals.protein_g}</b> / ${t.protein}g protein</span>
        </div>
        <div class="macro-nums"><span>${totals.fat_g}g fat</span><span>${totals.carbs_g}g carbs</span></div>
      </div>`;
  };

  /* Item rows. Editable rows are buttons (tap → edit sheet); read-only rows are divs. */
  const foodItems = (rec, editable) => rec.items.map((x, i) => editable
    ? `<button class="food-item pressable" data-fi="${i}" data-fdate="${rec.date}">
        <div class="n">${esc(x.name)}<small>${esc(x.portion)}</small></div>
        <div class="m">${x.kcal} cal · <b>${x.protein_g}g P</b></div>
        <span class="pi-chev">›</span>
      </button>`
    : `<div class="food-item">
        <div class="n">${esc(x.name)}<small>${esc(x.portion)}</small></div>
        <div class="m">${x.kcal} cal · <b>${x.protein_g}g P</b></div>
      </div>`).join('');

  /* Healthy chip shows the CURRENT answer (checkin wins over the parse).
     Hand-built days start unjudged (null) — neutral chip until he calls it. */
  const healthyNow = (rec) => {
    const c = Store.checkinOn(rec.date) || {};
    if (c.ateHealthy != null) return c.ateHealthy;
    return rec.healthy != null ? rec.healthy : null;
  };
  const hChip = (rec, tap) => {
    const h = healthyNow(rec);
    if (h == null && !tap) return '';
    const cls = h == null ? '' : h ? 'yes' : 'no';
    const label = h == null ? 'Healthy?' : h ? 'Healthy day' : 'Off plan';
    return tap
      ? `<button class="h-chip ${cls} pressable" data-hflip="${rec.date}">${label}</button>`
      : `<span class="h-chip ${cls}">${label}</span>`; // span — history rows are <button>s, no nesting
  };

  renderers.food = () => {
    const s = Store.get();
    const today = Store.todayStr();

    if (!s.settings.anthropicKey) {
      $('#food-body').innerHTML = `
        <div class="card">
          <div class="card-label">Food log · Claude</div>
          <p class="muted">Say what you ate once a day — Claude turns it into calories, protein, and a healthy-day verdict the coach can use. Runs on your own API key, costs about a cent a day.</p>
          <button class="btn-volt pressable mt12" id="food-gokey">Add API key in More</button>
        </div>`;
      $('#food-gokey').addEventListener('click', () => show('more'));
      return;
    }

    const rec = Store.foodOn(today);
    const t = Fuel.targets(today);

    /* --- today card --- */
    let todayCard;
    if (rec && !foodEditing && !foodLive) {
      todayCard = `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <div class="card-label" style="margin:0">Today</div>
            ${hChip(rec, true)}
          </div>
          ${macroBar(rec.totals, t)}
          <div class="divider" style="margin:12px 0 2px"></div>
          ${foodItems(rec, true)}
          <div class="food-add">
            <input type="search" id="food-search" placeholder="Add a food — search or type it" autocomplete="off" autocorrect="off">
            <div id="food-results"></div>
          </div>
          ${rec.note ? `<div class="food-note">${esc(rec.note)}</div>` : ''}
          <div class="pill-row">
            <button class="btn-ghost small pressable" id="food-edit">Re-dictate</button>
            <button class="btn-ghost small pressable" style="color:var(--bad);flex:0 0 auto" id="food-del">Remove</button>
          </div>
          <p class="tiny mt8">Estimates for habit coaching — your scale calibrates the real calorie math.${rec.costUsd != null ? ` · $${rec.costUsd.toFixed(2)}` : ''}</p>
        </div>`;
    } else {
      todayCard = `
        <div class="card">
          <div class="card-label">Today</div>
          <textarea class="food-ta" id="food-in" placeholder="Eggs and bacon at the office, Cava bowl with chicken for lunch, a David bar, leftover salmon for dinner…" ${foodLive ? 'disabled' : ''}>${esc(foodDraft || (foodEditing && rec ? rec.raw : ''))}</textarea>
          <div class="food-mic-hint">${MIC_SVG} Tap the box, hit the mic on your keyboard, and just talk.</div>
          <button class="btn-volt pressable mt12" id="food-log" ${foodLive ? 'disabled' : ''}>
            ${foodLive ? '<span class="spin"></span> Estimating…' : 'Log it'}
          </button>
          ${foodEditing && rec && !foodLive ? '<button class="btn-ghost pressable mt8" style="width:100%" id="food-cancel">Keep what I had</button>' : ''}
          ${!rec && !foodLive ? '<div class="pill-row" style="justify-content:center"><button class="cu-link" id="food-manual">or build the list by hand →</button></div>' : ''}
        </div>`;
    }

    /* --- history --- */
    const past = s.food.days.filter((f) => f.date < today).reverse();
    const historyCard = `
      <div class="card">
        <div class="card-label">Logged days</div>
        ${past.length ? past.map((f) => {
          const open = foodExpanded === f.date;
          const nice = new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return `
            <button class="food-day pressable" data-fd="${f.date}">
              <span class="d">${nice}</span>
              <span class="sum">${f.totals.kcal.toLocaleString()} cal · <b style="color:var(--volt)">${f.totals.protein_g}g P</b><small>${f.items.length} item${f.items.length === 1 ? '' : 's'}</small></span>
              ${hChip(f, false)}
              <span class="pi-chev">${open ? '−' : '›'}</span>
            </button>
            ${open ? `<div class="food-day-detail">${foodItems(f, true)}${f.note ? `<div class="food-note">${esc(f.note)}</div>` : ''}<div class="pill-row"><button class="cu-link" data-fdel="${f.date}">delete this day</button></div></div>` : ''}`;
        }).join('') : '<p class="muted">Past days land here — calories, protein, and what you actually ate.</p>'}
      </div>`;

    $('#food-body').innerHTML = todayCard + historyCard;

    /* --- wire --- */
    const ta = $('#food-in');
    if (ta) ta.addEventListener('input', () => { foodDraft = ta.value; });

    const logBtn = $('#food-log');
    if (logBtn) logBtn.addEventListener('click', async () => {
      const text = (ta.value || '').trim();
      if (!text) { toast('Say what you ate first'); return; }
      if (foodLive) return;
      foodLive = true;
      foodDraft = text;
      render();
      try {
        const saved = await Food.log(today, text);
        foodLive = false; foodEditing = false; foodDraft = '';
        buzz(18);
        render();
        toast(saved.healthy ? 'Logged — healthy day ✓' : 'Logged — off plan today');
      } catch (e) {
        foodLive = false; foodEditing = true; // draft survives in foodDraft
        render();
        toast(e.message === 'bad-key' ? 'API key rejected — check it in More' : e.message);
      }
    });

    const editBtn = $('#food-edit');
    if (editBtn) editBtn.addEventListener('click', () => { foodEditing = true; foodDraft = rec.raw; render(); });

    /* Hand-built day: empty record, unjudged — the ateHealthy question stays open. */
    const manualBtn = $('#food-manual');
    if (manualBtn) manualBtn.addEventListener('click', () => {
      Store.setFood(today, { date: today, raw: '', items: [], totals: Food.totalsOf([]), healthy: null, note: '', loggedAt: new Date().toISOString() });
      foodEditing = false; foodDraft = '';
      buzz(10);
      render();
      const fs2 = $('#food-search');
      if (fs2) fs2.focus();
    });

    /* Tap an item (today or a past day) → edit sheet. */
    $$('#food-body [data-fi]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openFoodItemSheet(b.dataset.fdate, parseInt(b.dataset.fi, 10));
    }));

    /* Add-food search: local DOM only per keystroke — a full render() would eat the keyboard. */
    const fs = $('#food-search');
    if (fs) {
      const box = $('#food-results');
      fs.addEventListener('input', () => {
        const q = fs.value.trim();
        if (!q) { box.innerHTML = ''; return; }
        const hits = Food.search(q);
        box.innerHTML = hits.map((h, i) => `
          <button class="food-hit pressable" data-hit="${i}">
            <span class="n">${esc(h.name)}<small>${esc(h.portion)}</small></span>
            <span class="m">${h.kcal} cal · <b>${h.protein_g}g P</b></span>
          </button>`).join('') +
          `<button class="food-hit manual pressable" data-hit-manual>Add “${esc(q)}” with your own numbers →</button>`;
        box.querySelectorAll('[data-hit]').forEach((hb) => hb.addEventListener('click', () => {
          const it = hits[parseInt(hb.dataset.hit, 10)];
          Store.update((st) => {
            const f = st.food.days.find((x) => x.date === today);
            if (!f) return;
            f.items.push({ ...it });
            f.totals = Food.totalsOf(f.items);
          });
          buzz(12);
          render();
          toast(`${it.name} added`);
        }));
        box.querySelector('[data-hit-manual]').addEventListener('click', () => openFoodItemSheet(today, null, q));
      });
    }
    const cancelBtn = $('#food-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { foodEditing = false; foodDraft = ''; render(); });
    const delBtn = $('#food-del');
    if (delBtn) delBtn.addEventListener('click', () => {
      const old = rec;
      Store.deleteFood(today);
      Store.setCheckin(today, 'ateHealthy', null); // question reopens
      foodEditing = false; foodDraft = '';
      render();
      toast('Log removed', () => { Store.setFood(old.date, old); Store.setCheckin(old.date, 'ateHealthy', old.healthy); });
    });

    $$('#food-body [data-hflip]').forEach((b) => b.addEventListener('click', () => {
      const d = b.dataset.hflip;
      const cur = healthyNow(Store.foodOn(d));
      Store.update((st) => { const f = st.food.days.find((x) => x.date === d); if (f) f.healthy = !cur; });
      Store.setCheckin(d, 'ateHealthy', !cur);
      buzz(10);
      render();
      toast(!cur ? 'Marked healthy' : 'Marked off plan');
    }));

    $$('#food-body [data-fd]').forEach((b) => b.addEventListener('click', () => {
      foodExpanded = foodExpanded === b.dataset.fd ? null : b.dataset.fd;
      buzz(6);
      render();
    }));
    $$('#food-body [data-fdel]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = b.dataset.fdel;
      const old = Store.foodOn(d);
      Store.deleteFood(d);
      foodExpanded = null;
      render();
      toast('Day deleted', () => Store.setFood(old.date, old));
    }));
  };

  /* Edit/add one food item by hand. idx null = new item (name prefilled from the search box). */
  function openFoodItemSheet(date, idx, prefillName) {
    const rec = Store.foodOn(date);
    if (!rec) return;
    const adding = idx == null;
    const it = adding
      ? { name: prefillName || '', portion: '', kcal: '', protein_g: '', fat_g: '', carbs_g: '' }
      : rec.items[idx];
    if (!it) return;
    openSheet(`
      <h3>${adding ? 'Add food' : 'Edit food'}</h3>
      <div class="set-li"><span>Food</span><input type="text" id="fi-name" value="${esc(it.name)}" placeholder="Chicken bowl"></div>
      <div class="set-li"><span>Portion</span><input type="text" id="fi-portion" value="${esc(it.portion)}" placeholder="1 bowl"></div>
      <div class="set-li"><span>Calories</span><input type="number" inputmode="numeric" id="fi-kcal" value="${it.kcal}" placeholder="—"></div>
      <div class="set-li"><span>Protein (g)</span><input type="number" inputmode="numeric" id="fi-p" value="${it.protein_g}" placeholder="—"></div>
      <div class="set-li"><span>Fat (g)</span><input type="number" inputmode="numeric" id="fi-f" value="${it.fat_g}" placeholder="—"></div>
      <div class="set-li"><span>Carbs (g)</span><input type="number" inputmode="numeric" id="fi-c" value="${it.carbs_g}" placeholder="—"></div>
      <button class="btn-volt pressable mt16" id="fi-save">${adding ? 'Add it' : 'Save'}</button>
      ${adding ? '' : '<button class="btn-ghost pressable mt8" style="width:100%;color:var(--bad)" id="fi-del">Remove this item</button>'}
    `);
    const clamp = (id, max) => Math.max(0, Math.min(Math.round(parseFloat($(id).value) || 0), max));
    $('#fi-save').addEventListener('click', () => {
      const name = $('#fi-name').value.trim().slice(0, 80);
      if (!name) { toast('Name the food first'); return; }
      const next = {
        name,
        portion: $('#fi-portion').value.trim().slice(0, 80),
        kcal: clamp('#fi-kcal', 5000),
        protein_g: clamp('#fi-p', 400),
        fat_g: clamp('#fi-f', 400),
        carbs_g: clamp('#fi-c', 800),
      };
      Store.update((st) => {
        const f = st.food.days.find((x) => x.date === date);
        if (!f) return;
        if (adding) f.items.push(next); else f.items[idx] = next;
        f.totals = Food.totalsOf(f.items);
      });
      buzz(14);
      closeSheet(); render();
      toast(adding ? `${next.name} added` : 'Updated');
    });
    const del = $('#fi-del');
    if (del) del.addEventListener('click', () => {
      const wasLast = rec.items.length === 1;
      const removed = rec.items[idx];
      if (wasLast) {
        /* Last item gone = day gone; the ateHealthy question reopens (mirrors Remove). */
        const old = rec;
        Store.deleteFood(date);
        Store.setCheckin(date, 'ateHealthy', null);
        closeSheet(); render();
        toast('Log removed', () => { Store.setFood(old.date, old); Store.setCheckin(old.date, 'ateHealthy', old.healthy); render(); });
      } else {
        Store.update((st) => {
          const f = st.food.days.find((x) => x.date === date);
          if (!f) return;
          f.items.splice(idx, 1);
          f.totals = Food.totalsOf(f.items);
        });
        closeSheet(); render();
        toast(`${removed.name} removed`, () => {
          Store.update((st) => {
            const f = st.food.days.find((x) => x.date === date);
            if (!f) return;
            f.items.splice(idx, 0, removed);
            f.totals = Food.totalsOf(f.items);
          });
          render();
        });
      }
      buzz(10);
    });
  }

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
    const bw = s.bodyweight.find((b) => b.date === date);
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
      <div class="set-li"><span>Steps count <span class="sub" style="display:inline">(optional)</span></span><input type="number" inputmode="numeric" id="ds-steps" value="${c.steps != null ? c.steps : ''}" placeholder="—"></div>
      <div class="divider"></div>
      <div class="set-li"><span>Weight (lb)</span><input type="number" step="0.1" inputmode="decimal" id="ds-w" value="${bw ? bw.weight : ''}" placeholder="—"></div>
      <div class="set-li"><span>Body fat %</span><input type="number" step="0.1" inputmode="decimal" id="ds-bf" value="${bw && bw.bodyFat != null ? bw.bodyFat : ''}" placeholder="—"></div>
      <button class="btn-volt pressable mt16" data-close-sheet>Done</button>
    `);

    $$('#sheet [data-add]').forEach((b) => b.addEventListener('click', () => { Store.logSession(b.dataset.add, date); buzz(14); openDaySheet(date); render(); }));
    $$('#sheet [data-rm]').forEach((b) => b.addEventListener('click', () => { Store.removeSession(b.dataset.rm); buzz(10); openDaySheet(date); render(); }));
    $$('#sheet [data-sci]').forEach((b) => b.addEventListener('click', () => {
      const field = b.dataset.sci, v = b.dataset.v === '1';
      const cur = (Store.checkinOn(date) || {})[field];
      Store.setCheckin(date, field, cur === v ? null : v); // tap again to clear
      if (field === 'hitSteps') Store.setCheckin(date, 'steps', null); // plain yes/no overrides any count
      openDaySheet(date); render();
    }));
    $('#sheet [data-close-sheet]').addEventListener('click', () => {
      const raw = $('#ds-steps').value.trim();
      const stored = (Store.checkinOn(date) || {}).steps;
      if (raw === '' && stored != null) {
        Store.setCheckin(date, 'steps', null); // count removed; the yes/no stands
      } else if (raw !== '') {
        const n = parseInt(raw, 10);
        if (isFinite(n) && n >= 0 && n <= 200000 && n !== stored) {
          Store.setCheckin(date, 'steps', n);
          Store.setCheckin(date, 'hitSteps', n >= Plan.stepsTarget);
        }
      }
      const wRaw = $('#ds-w').value.trim();
      const bw0 = Store.get().bodyweight.find((b) => b.date === date);
      if (wRaw === '') {
        if (bw0) Store.removeBodyweight(date); // field cleared — entry goes
      } else {
        const w = parseFloat(wRaw);
        const bf = parseFloat($('#ds-bf').value);
        if (isFinite(w) && w >= 60 && w <= 500) Store.setBodyweight(date, w, isFinite(bf) ? bf : undefined);
        else toast('That’s not a body weight, Noof');
      }
      closeSheet(); render();
    });
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
          <div class="rx"><span class="k">Daily target — calories · protein</span><span class="v">${t.kcal.toLocaleString()} · ${t.protein}g</span></div>
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
      <div class="card" id="photos-card"></div>
      <div class="card"><div class="card-label">Signals</div>${insights}</div>
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
    Photos.renderGallery($('#photos-card'), render);
    $$('#trends-body [data-goal-open]').forEach((b) => b.addEventListener('click', () => openGoalSheet()));
    const gEnd = $('#trends-body [data-goal-end]');
    if (gEnd) armToConfirm(gEnd, 'Sure? Tap again to end', () => { Plan.clearGoal(); buzz(10); render(); toast('Plan ended'); });
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
  };

  /* ================= COACH ================= */

  /* In-flight reply lives OUTSIDE the render cycle — re-renders (tab hops,
     sync pulls) repaint mid-stream without losing the live bubble. */
  let chatLive = null; // { thinking: bool, text: string } while a reply streams
  let readLive = null; // same, for the weekly read

  const CHAT_SUGGESTIONS = ['What should I focus on today?', 'Why am I stalling?', 'Plan my training week'];

  renderers.coach = () => {
    const s = Store.get();
    const key = s.settings.anthropicKey;

    if (!key) {
      $('#coach-body').innerHTML = `
        <div class="card">
          <div class="card-label">Coach · Claude</div>
          <p class="muted">The coach reads your last 90 days — training (and which days you train), sleep, food, steps, weight, plan, photos — spots what's slipping, and answers your questions. It runs on your own API key, stored only on this phone. Costs pennies per question.</p>
          <button class="btn-volt pressable mt12" id="coach-gokey">Add API key in More</button>
        </div>`;
      $('#coach-gokey').addEventListener('click', () => show('more'));
      return;
    }

    const li = s.coach.lastInsight;
    const staleDays = li ? Math.round((Date.now() - new Date(li.date + 'T12:00:00').getTime()) / 86400000) : null;
    const thread = Coach.chatThread();

    const readBody = readLive
      ? `<div class="coach-out" id="read-live">${readLive.text ? esc(readLive.text) : ''}</div>${readLive.thinking && !readLive.text ? '<div class="chat-dots" style="padding:6px 0"><i></i><i></i><i></i></div>' : ''}`
      : li
        ? `<div class="coach-out">${esc(li.text)}</div><div class="coach-meta">${li.date}${li.costUsd != null ? ` · $${li.costUsd.toFixed(2)}` : ''}${staleDays > 7 ? ' · getting stale' : ''}</div>`
        : '<p class="muted">The full top-down read: what’s working, what’s slipping, one order for the week.</p>';

    const readCard = `
      <div class="card">
        <div class="card-label">Weekly read</div>
        ${readBody}
        ${readLive ? '' : `<button class="btn-${li && staleDays <= 7 ? 'ghost' : 'volt'} pressable mt12" style="width:100%" id="coach-run">${li ? 'Run it again' : 'Run weekly read'}</button>`}
      </div>`;

    const bubbles = thread.map((m) => m.role === 'user'
      ? `<div class="chat-b me">${esc(m.text)}</div>`
      : `<div class="chat-b coach">${esc(m.text)}${m.costUsd != null ? `<div class="chat-cost">$${m.costUsd.toFixed(2)}</div>` : ''}</div>`
    ).join('');

    const liveBubble = chatLive
      ? `<div class="chat-b coach" id="chat-live">${chatLive.text ? esc(chatLive.text) : '<div class="chat-dots"><i></i><i></i><i></i></div>'}</div>`
      : '';

    const suggestions = !thread.length && !chatLive
      ? `<div class="chat-sugg">${CHAT_SUGGESTIONS.map((q) => `<button class="pressable" data-sugg="${esc(q)}">${esc(q)}</button>`).join('')}</div>`
      : '';

    $('#coach-body').innerHTML = `
      ${readCard}
      <div class="card" style="padding-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div class="card-label">Ask the coach</div>
          ${thread.length ? '<button class="cu-link" id="chat-clear">clear</button>' : ''}
        </div>
        <div class="chat-thread" id="chat-thread">${bubbles + liveBubble || ''}</div>
        ${suggestions}
        <div class="chat-inrow">
          <input type="text" id="chat-in" placeholder="Ask anything about your data…" autocomplete="off" ${chatLive ? 'disabled' : ''}>
          <button class="btn-volt pressable" id="chat-send" style="width:52px;min-height:44px;flex-shrink:0" ${chatLive ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>
          </button>
        </div>
      </div>`;

    const scrollThread = () => { const t = $('#chat-thread'); if (t) t.scrollTop = t.scrollHeight; };
    scrollThread();

    const run = $('#coach-run');
    if (run) run.addEventListener('click', async () => {
      readLive = { thinking: true, text: '' };
      render();
      try {
        await Coach.analyze((ev) => {
          if (readLive) {
            readLive = { thinking: ev.thinking, text: ev.text };
            const el = $('#read-live');
            if (el && ev.text) el.textContent = ev.text;
            else if (ev.thinking && !ev.text) render();
          }
        });
        readLive = null;
        render();
      } catch (e) {
        readLive = null;
        render();
        toast(e.message === 'bad-key' ? 'API key rejected — check it in More' : 'Coach unavailable: ' + e.message);
      }
    });

    const doSend = async (text) => {
      if (!text || chatLive) return;
      chatLive = { thinking: true, text: '' };
      try {
        const p = Coach.chat(text, (ev) => {
          if (!chatLive) return;
          chatLive = { thinking: ev.thinking, text: ev.text };
          const el = $('#chat-live');
          if (el && ev.text) { el.textContent = ev.text; scrollThread(); }
        });
        render(); // user bubble is in the store now; live bubble from chatLive
        await p;
        chatLive = null;
        render();
      } catch (e) {
        chatLive = null;
        render();
        const inEl = $('#chat-in');
        if (inEl) { inEl.value = text; inEl.focus(); } // nothing lost — one tap to retry
        toast(e.message === 'bad-key' ? 'API key rejected — check it in More' : e.message);
      }
    };

    const input = $('#chat-in'), send = $('#chat-send');
    send.addEventListener('click', () => doSend(input.value.trim()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(input.value.trim()); });
    $$('#coach-body [data-sugg]').forEach((b) => b.addEventListener('click', () => { buzz(8); doSend(b.dataset.sugg); }));

    const clear = $('#chat-clear');
    if (clear) clear.addEventListener('click', () => { Coach.clearChat(); render(); toast('Chat cleared'); });
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
    let mode = Store.currentMode(); // local until save — browsing modes records no phase
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
      if (mode === 'cut' && t >= curAvg - 0.4) return `Cutting — target must be below your ${curAvg.toFixed(1)} lb average. Gaining? Switch to Bulk above`;
      if (mode === 'bulk' && t <= curAvg + 0.4) return `Bulking — target must be above your ${curAvg.toFixed(1)} lb average. Losing? Switch to Cut above`;
      return null;
    };

    function paint(val) {
      openSheet(`
        <h3>${editing ? 'Edit goal' : 'Set your goal'}</h3>
        <div class="mode-seg" style="margin-bottom:10px">
          <button class="pressable ${mode === 'cut' ? 'active' : ''}" data-gmode="cut">Cut — lose</button>
          <button class="pressable ${mode === 'bulk' ? 'active' : ''}" data-gmode="bulk">Bulk — gain</button>
        </div>
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
      $$('#sheet [data-gmode]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.gmode === mode) return;
        mode = b.dataset.gmode;
        buzz(8);
        paint(g0 && g0.mode === mode && g0.type === type ? g0.target : defFor(type));
      }));
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
        if (mode !== Store.currentMode()) Store.setMode(mode); // setGoal stamps the goal with currentMode
        Plan.setGoal(type, Math.round(v * 10) / 10);
        buzz(18);
        closeSheet();
        render();
        toast(editing ? 'Plan reset — the line restarts today' : 'Plan set — milestones live in Trends');
      });
      const end = $('#g-end');
      if (end) armToConfirm(end, 'Sure? Tap again to end', () => { Plan.clearGoal(); closeSheet(); render(); toast('Plan ended'); });
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
        <div class="card-label">Sync · smart reminders</div>
        <p class="muted">Your private worker: a 9pm push only when the day still has unanswered data, steps that log themselves, and scale weigh-ins that fill in on their own.</p>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="password" id="sync-token" style="flex:1" placeholder="sync token" value="${esc(s.settings.syncToken || '')}">
          <button class="btn-ghost pressable" id="sync-save">Save</button>
        </div>
        ${s.settings.syncToken ? `
        <p class="tiny mt8" id="sync-status">Checking connection…</p>
        <div class="pill-row">
          <button class="btn-ghost pressable" id="push-toggle" disabled>…</button>
          <button class="btn-ghost pressable" id="push-test">Test push</button>
          <button class="btn-ghost pressable" id="withings-link">Link scale</button>
        </div>` : ''}
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
        <p class="muted" style="margin-bottom:10px">One file: your log data plus progress photos. Photos stay encrypted in the file — same PIN opens them after a restore.</p>
        <div class="pill-row" style="margin-top:0">
          <button class="btn-ghost pressable" id="do-export">Export</button>
          <button class="btn-ghost pressable" id="do-import">Import</button>
        </div>
        ${nudge}
        <input type="file" id="import-file" accept="application/json" class="hidden">
      </div>
      <div class="card">
        <div class="card-label">Danger zone</div>
        <p class="muted">Erase everything on this phone — sessions, weigh-ins, food, photos, settings. Export a backup first; there is no undo.</p>
        <div class="pill-row">
          <button class="btn-ghost pressable" style="color:var(--bad)" id="wipe-all">Erase all data</button>
        </div>
      </div>
      <div class="card">
        <div class="card-label">About</div>
        <p class="muted">NoofGains v1 — built for exactly one user. LFG.</p>
        <p class="tiny mt8" id="build-tag">Build: checking…</p>
      </div>`;

    /* Build tag = the ?v= on the active service worker's script URL — the one
       source of truth for which release this install is actually running. */
    const bt = $('#build-tag');
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const m = navigator.serviceWorker.controller.scriptURL.match(/[?&]v=(\w+)/);
      bt.textContent = `Build: ${m ? 'v' + m[1] : 'pre-v29 (update pending)'}`;
    } else {
      bt.textContent = 'Build: no service worker (browser tab?)';
    }

    $('#more-goal').addEventListener('click', () => openGoalSheet());
    $('#sync-save').addEventListener('click', () => {
      Store.update((st) => { st.settings.syncToken = $('#sync-token').value.trim(); });
      render();
      toast('Sync token saved');
    });
    if (s.settings.syncToken) {
      const stEl = $('#sync-status'), tog = $('#push-toggle'), wLink = $('#withings-link');
      (async () => {
        try {
          const [st, sub] = await Promise.all([Sync.status(), Sync.subscription()]);
          stEl.textContent = `Connected · notifications ${sub ? 'on' : 'off'} · scale ${st.withings ? 'linked ✓' : 'not linked'}`;
          tog.textContent = sub ? 'Disable notifications' : 'Enable notifications';
          tog.dataset.on = sub ? '1' : '';
          tog.disabled = false;
          if (st.withings) wLink.textContent = 'Re-link scale';
        } catch {
          stEl.textContent = 'Can’t reach the worker — check the token.';
        }
      })();
      wLink.addEventListener('click', () => { window.open(Sync.withingsConnectUrl(), '_blank'); });
      tog.addEventListener('click', async () => {
        tog.disabled = true;
        try {
          if (tog.dataset.on) { await Sync.disablePush(); toast('Notifications off'); }
          else { await Sync.enablePush(); toast('Notifications on — 9pm, only when needed'); }
        } catch (e) { toast(e.message); }
        render();
      });
      $('#push-test').addEventListener('click', async () => {
        try {
          const r = await Sync.testPush();
          toast(!r.push ? 'Nothing missing today — no push needed'
            : r.result && r.result.ok ? 'Push sent — check your phone'
            : `No delivery: ${(r.result && r.result.reason) || 'failed'}`);
        } catch { toast('Test failed — check the token'); }
      });
    }
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
      // Photos ride along still-encrypted — the backup is only as open as the PIN.
      const vault = await Photos.exportVault().catch(() => null);
      const json = vault
        ? JSON.stringify({ app: JSON.parse(Store.exportJSON()), photosVault: vault })
        : Store.exportJSON();
      const fname = `noofgains-backup-${Store.todayStr()}.json`;
      const file = new File([json], fname, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'NoofGains backup' });
          Store.markBackedUp();
          render();
          toast('Backup shared — stash it somewhere safe');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // canceled the share sheet — nothing was backed up
          /* share genuinely failed — fall through to a plain download */
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
      Store.markBackedUp();
      render();
      toast(`Saved ${fname}`);
    });
    armToConfirm($('#wipe-all'), 'Sure? Tap again to erase', () => {
      localStorage.removeItem('noofgains.v1');
      try { indexedDB.deleteDatabase('noofgains-photos'); } catch { /* no vault — fine */ }
      location.reload(); // boots fresh from seed()
    });
    $('#do-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const parsed = JSON.parse(text);
        if (parsed && parsed.app && parsed.photosVault) {
          Store.importJSON(JSON.stringify(parsed.app));
          await Photos.importVault(parsed.photosVault);
        } else {
          Store.importJSON(text);
        }
        render();
        toast('Backup restored');
      } catch {
        toast('Not a valid NoofGains backup');
      }
    });
  };

  /* ---------- boot ---------- */
  Store.subscribe(() => Sync.scheduleStatePing()); // every save re-reports what's still open
  show('today');
  Sync.scheduleStatePing();
  const pullSync = () => Sync.pull().then((r) => {
    if (!r || (!r.stepsDays && !r.weightDays)) return;
    render(); // past-day backfills must repaint too — post-midnight pulls used to apply silently
    if (r.weight != null && r.steps != null) toast(`Synced: ${r.weight.toFixed(1)} lb · ${r.steps.toLocaleString()} steps`);
    else if (r.weight != null) toast(`Scale synced: ${r.weight.toFixed(1)} lb`);
    else if (r.steps != null) toast(`Steps synced from your phone: ${r.steps.toLocaleString()}`);
    else {
      const bits = [];
      if (r.stepsDays) bits.push(`${r.stepsDays} day${r.stepsDays === 1 ? '' : 's'} of steps`);
      if (r.weightDays) bits.push(`${r.weightDays} weigh-in${r.weightDays === 1 ? '' : 's'}`);
      toast(`Caught up: ${bits.join(' + ')}`);
    }
  }).catch(() => {});
  pullSync();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    render(); // resume after hours away: greeting, date, and today-state must not be stale
    pullSync();
  });
})();
