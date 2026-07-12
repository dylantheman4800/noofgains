/* NoofGains — Plan engine.
   Deterministic prescription: goal → fixed weekly milestone line → daily
   outstanding items. No AI, no network, no knobs.

   Evidence encoded (researched July 2026):
   - Cut −0.6% BW/wk. Trained lifters keep the most muscle at 0.5–1%/wk,
     low end best (Achieving an Optimal Fat Loss Phase, PMC8471721).
   - Bulk +0.25% BW/wk — lean-gain territory.
   - Sleep 7–9h drives recovery/MPS → "slept well" milestone is 5+/7 nights.
   - NEAT ~8k steps/day is the fat-loss sweet spot; returns flatten past 8k
     → cut-only daily binary "~8k steps?".
   - Calibration, not punishment: calories move ±100/wk ONLY when the work
     was done and the scale disagreed (MacroFactor-style weekly recalc),
     cumulative cap ±300. Behind + poor adherence = same plan, said plainly.
   - Hard caps always win: 1,900 kcal cut floor (Fuel), never faster than
     1% BW/wk, bulk never below maintenance. */
'use strict';

const Plan = (() => {
  const RATE_PCT = { cut: 0.006, bulk: 0.0025 }; // fraction of start BW per week
  const RATE_CAP_PCT = 0.01;
  const KCAL_STEP = 100;
  const KCAL_ADJ_MAX = 300;
  const HIT_TOL = 0.2; // lb of slack on a weekly checkpoint
  const STEPS_TARGET = 8000; // NEAT sweet spot — returns flatten past 8k
  const dayMs = 86400000;

  const s2d = (s) => new Date(s + 'T12:00:00');
  const addDays = (s, n) => Store.todayStr(new Date(s2d(s).getTime() + n * dayMs));
  const daysBetween = (a, b) => Math.round((s2d(b) - s2d(a)) / dayMs);
  const fmtD = (s) => s2d(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const r1 = (n) => Math.round(n * 10) / 10;

  /* ---------- goal ---------- */

  function goal() {
    const p = Store.get().plan;
    return p && p.goal ? p.goal : null;
  }

  function latestBf() {
    const bw = Store.get().bodyweight;
    for (let i = bw.length - 1; i >= 0; i--) if (bw[i].bodyFat != null) return bw[i].bodyFat;
    return null;
  }

  /* Setting (or re-setting) a goal snapshots today as the line's origin —
     editing IS the deliberate re-baseline. */
  function setGoal(type, target) {
    const today = Store.todayStr();
    const startWeight = Store.rolling7Avg(today) || (Store.lastWeight() || { weight: 165 }).weight;
    Store.update((s) => {
      s.plan.goal = {
        type, // 'weight' | 'bf'
        target,
        startDate: today,
        startWeight: r1(startWeight),
        startBf: latestBf(),
        mode: Store.currentMode(),
      };
    });
  }

  function clearGoal() {
    Store.update((s) => { s.plan.goal = null; });
  }

  /* A goal made on a cut is meaningless once he flips to bulk. */
  function modeOk() {
    const g = goal();
    return !!g && g.mode === Store.currentMode();
  }

  /* Target in lb. BF% goals assume lean mass holds (that's the whole point
     of the rate cap + protein target). */
  function targetWeight() {
    const g = goal();
    if (!g) return null;
    if (g.type === 'weight') return g.target;
    const lean = g.startWeight * (1 - g.startBf / 100);
    return r1(lean / (1 - g.target / 100));
  }

  /* Prescribed lb/week for a given start weight + mode (signed). */
  function rateFor(startWeight, mode) {
    const pct = Math.min(RATE_PCT[mode] || RATE_PCT.cut, RATE_CAP_PCT);
    return (mode === 'cut' ? -1 : 1) * startWeight * pct;
  }

  /* Signed lb/week along the plan line. */
  function weeklyRateLb() {
    const g = goal();
    return g ? rateFor(g.startWeight, g.mode) : 0;
  }

  /* The fixed line: where the 7-day avg should be on `date`. */
  function expectedAvg(date) {
    const g = goal();
    if (!g) return null;
    const t = targetWeight();
    const raw = g.startWeight + weeklyRateLb() * (daysBetween(g.startDate, date) / 7);
    return g.mode === 'cut' ? Math.max(raw, t) : Math.min(raw, t);
  }

  /* ---------- milestones ---------- */

  /* Monday-anchored weekly checkpoints from goal start until the line reaches
     the target. Past weeks get actual vs expected; the line never moves. */
  function milestones() {
    const g = goal();
    if (!g) return [];
    const t = targetWeight();
    const today = Store.todayStr();
    const out = [];
    let end = Store.weekBounds(s2d(g.startDate)).end;
    // A goal set late in the week gets no stub checkpoint — first milestone
    // needs real runway.
    if (daysBetween(g.startDate, end) < 3) end = addDays(end, 7);
    for (let i = 0; i < 52; i++) {
      const expected = expectedAvg(end);
      const completed = end < today;
      const actual = end <= today ? Store.rolling7Avg(end) : null;
      const reached = g.mode === 'cut' ? expected <= t + 0.001 : expected >= t - 0.001;
      const hit = !completed || actual == null ? null
        : g.mode === 'cut' ? actual <= expected + HIT_TOL : actual >= expected - HIT_TOL;
      out.push({
        n: i + 1, end, completed, hit,
        expected: r1(expected),
        actual: actual != null ? r1(actual) : null,
        current: today >= addDays(end, -6) && today <= end,
        goalWeek: reached,
      });
      if (reached) break;
      end = addDays(end, 7);
    }
    return out;
  }

  /* ---------- adherence (did he run the plan) ---------- */

  function adherence(weekEnd) {
    const start = addDays(weekEnd, -6);
    const s = Store.get();
    const wk = Store.weekStats(s2d(start));
    const inWk = s.checkins.filter((c) => c.date >= start && c.date <= weekEnd);
    const foodYes = inWk.filter((c) => c.ateHealthy === true).length;
    const sleepYes = inWk.filter((c) => c.sleptWell === true).length;
    const stepsYes = inWk.filter((c) => c.hitSteps === true).length;
    const sessionsOK = wk.ringCount >= wk.goal;
    // "Did the work" = sessions hit + food mostly clean. Missing answers count
    // against — no calibration without evidence.
    return { sessions: wk.ringCount, goal: wk.goal, foodYes, sleepYes, stepsYes, sessionsOK, adherent: sessionsOK && foodYes >= 4 };
  }

  /* ---------- weekly calibration (pure — recomputed, never stored) ----------
     Walk every completed week since goal start:
     - behind the line AND adherent → TDEE estimate is off → ∓100 kcal
     - moving too fast → ease calories back (muscle > speed)
     - behind + not adherent → no change; effort is the fix, not the math. */
  function kcalAdjustment(date = Store.todayStr()) {
    const g = goal();
    if (!g || !modeOk()) return 0;
    const rate = weeklyRateLb();
    const curWeekStart = Store.weekBounds(s2d(date)).start;
    let adj = 0;
    let prevAvg = g.startWeight;
    let prevDate = g.startDate;
    for (const m of milestones()) {
      if (!(m.end < curWeekStart)) break;
      const a = Store.rolling7Avg(m.end);
      if (a == null) continue; // no data — the window just extends to the next checkpoint
      const days = daysBetween(prevDate, m.end);
      if (days >= 5) { // shorter windows are scale noise, not signal
        const actualDelta = a - prevAvg;
        const plannedDelta = rate * (days / 7);
        const adh = adherence(m.end).adherent;
        if (g.mode === 'cut') {
          if (adh && actualDelta > plannedDelta + 0.3) adj -= KCAL_STEP;    // did the work, lost too slow
          else if (actualDelta < plannedDelta - 0.4) adj += KCAL_STEP;      // losing too fast — protect muscle
        } else {
          if (adh && actualDelta < plannedDelta - 0.25) adj += KCAL_STEP;   // did the work, gained too slow
          else if (actualDelta > plannedDelta + 0.4) adj -= KCAL_STEP;      // gaining too fast — cap the fat
        }
        adj = Math.max(-KCAL_ADJ_MAX, Math.min(KCAL_ADJ_MAX, adj));
      }
      prevAvg = a;
      prevDate = m.end;
    }
    return adj;
  }

  /* Classify the last completed week for the human-readable review. */
  function weekReview() {
    const g = goal();
    if (!g || !modeOk()) return null;
    const done = milestones().filter((m) => m.completed);
    if (!done.length) return null;
    const m = done[done.length - 1];
    if (m.actual == null) {
      return { type: 'nodata', msg: `No weigh-ins in week ${m.n} — the plan is blind without the scale.` };
    }
    const fast = g.mode === 'cut' ? m.actual < m.expected - 0.5 : m.actual > m.expected + 0.5;
    if (fast) {
      return { type: 'toofast', msg: `Week ${m.n} came in fast (${m.actual.toFixed(1)} vs ${m.expected.toFixed(1)}). Faster isn't better — calories eased up to protect muscle.` };
    }
    if (m.hit) {
      return { type: 'ontrack', msg: `Week ${m.n} milestone hit — ${m.actual.toFixed(1)} vs ${m.expected.toFixed(1)}. Same plan. Keep running it.` };
    }
    const adh = adherence(m.end);
    if (!adh.adherent) {
      return { type: 'adherence', msg: `Week ${m.n} missed (${m.actual.toFixed(1)} vs ${m.expected.toFixed(1)}) and execution slipped — ${adh.sessions}/${adh.goal} sessions, ${adh.foodYes}/7 clean days. Same plan; run it before we touch calories.` };
    }
    const adj = kcalAdjustment();
    return { type: 'calibration', msg: `Week ${m.n} missed (${m.actual.toFixed(1)} vs ${m.expected.toFixed(1)}) but you did the work — that's calibration, not effort. Calories tuned ${adj > 0 ? '+' : ''}${adj} from baseline.` };
  }

  /* ---------- where he stands ---------- */

  function pace() {
    const g = goal();
    if (!g) return null;
    const today = Store.todayStr();
    const cur = Store.rolling7Avg(today) || (Store.lastWeight() || { weight: g.startWeight }).weight;
    const t = targetWeight();
    const exp = expectedAvg(today);
    const dir = g.mode === 'cut' ? 1 : -1;
    const behindLb = (cur - exp) * dir; // >0 behind, <0 ahead
    const toGo = Math.max((cur - t) * dir, 0);
    const rateLb = weeklyRateLb();
    const planDate = addDays(g.startDate, Math.ceil(Math.abs((t - g.startWeight) / rateLb) * 7));
    // projected from his real trailing rate (Δ 7-day avg over 14 days)
    const avgThen = Store.rolling7Avg(addDays(today, -14));
    let trailing = null, projDate = null, stalled = false;
    if (avgThen != null && Store.get().bodyweight.length >= 4) {
      trailing = (cur - avgThen) / 2;
      const need = t - cur;
      if (toGo <= 0.05) projDate = today;
      else if (Math.abs(trailing) >= 0.08 && Math.sign(trailing) === Math.sign(need)) {
        const wks = need / trailing;
        if (wks <= 78) projDate = addDays(today, Math.ceil(wks * 7));
      } else {
        stalled = true;
      }
    }
    const total = (g.startWeight - t) * dir;
    const progress = total > 0 ? Math.min(Math.max(((g.startWeight - cur) * dir) / total, 0), 1) : 0;
    return { cur, target: t, exp, behindLb, toGo, rateLb, planDate, projDate, trailing, stalled, progress };
  }

  /* ---------- today's outstanding items ----------
     Each item is a question the app still needs answered today; answered →
     gone. Everything reads/writes existing data — nothing is double-tapped. */
  function todayItems(date = Store.todayStr()) {
    const s = Store.get();
    const c = Store.checkinOn(date) || {};
    const items = [];
    if (!goal()) items.push({ id: 'goal' });
    if (!s.bodyweight.some((b) => b.date === date)) items.push({ id: 'weigh' });
    // Train appears only when the weekly goal is at risk: remaining sessions
    // need every remaining day. Otherwise the hero is invitation enough.
    const wk = Store.weekStats(s2d(date));
    const daysLeft = 7 - ((s2d(date).getDay() + 6) % 7);
    const remaining = wk.goal - wk.ringCount;
    const trainedToday = Store.sessionsOn(date)
      .some((x) => ['lift', 'cardio'].includes((Store.typeById(x.typeId) || {}).kind));
    if (remaining > 0 && remaining >= daysLeft && !trainedToday) {
      items.push({ id: 'train', remaining, daysLeft });
    }
    if (c.sleptWell == null) items.push({ id: 'sleep', field: 'sleptWell' });
    if (c.ateHealthy == null) items.push({ id: 'food', field: 'ateHealthy' });
    if (Store.currentMode(date) === 'cut' && c.hitSteps == null) items.push({ id: 'steps', field: 'hitSteps' });
    return items;
  }

  return {
    goal, setGoal, clearGoal, modeOk, latestBf, targetWeight, rateFor, weeklyRateLb,
    expectedAvg, milestones, adherence, kcalAdjustment, weekReview, pace,
    todayItems, fmtD,
    stepsTarget: STEPS_TARGET,
  };
})();
