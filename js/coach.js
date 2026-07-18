/* NoofGains — insights.
   Local stats always work (offline, free). The Claude-powered coach activates
   when Dylan pastes an Anthropic API key in More — the phone calls the
   Messages API directly (personal app, own key, stored only in localStorage). */
'use strict';

const Coach = (() => {
  const dayMs = 86400000;

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return Store.todayStr(d);
  }

  /* ---------- recovery flag ---------- */

  function recoveryFlag() {
    const s = Store.get();
    const today = Store.todayStr();
    if (s.coach.dismissedFlagOn === today) return null;
    if (Store.sessionsOn(today).some((x) => (Store.typeById(x.typeId) || {}).kind === 'recovery')) return null;

    const last3 = [0, 1, 2].map((n) => Store.checkinOn(daysAgo(n)));
    const roughNights = last3.filter((c) => c && c.sleptWell === false).length;
    const last5 = s.sessions.filter((x) => x.date >= daysAgo(4) && (Store.typeById(x.typeId) || {}).kind !== 'recovery').length;

    const dow = new Date().getDay();
    const weekend = dow === 0 || dow === 6;
    const place = weekend
      ? 'You have the time today — walk to Domino: sauna + plunge.'
      : 'Book Domino this weekend — don’t trade sleep for it on a weekday.';

    if (roughNights >= 2) {
      return { reason: `${roughNights} rough nights in the last 3.`, advice: `Recovery beats another grind session. ${place}` };
    }
    if (last5 >= 4) {
      return { reason: `${last5} sessions in the last 5 days.`, advice: `Your volume is there — bank some recovery. ${place}` };
    }
    return null;
  }

  /* ---------- blunt-coach nudge (Today header) ----------
     One line, highest-priority slip only, pure local rules — no API spend.
     Every rule self-clears when the behavior recovers, so the card never
     needs a dismiss. Absence of a nudge means nothing is slipping. */
  function nudge() {
    const s = Store.get();
    const today = Store.todayStr();
    const lastLift = s.sessions
      .filter((x) => (Store.typeById(x.typeId) || {}).kind !== 'recovery')
      .map((x) => x.date).sort().pop();
    if (lastLift) {
      const gap = Math.round((new Date(today + 'T12:00:00') - new Date(lastLift + 'T12:00:00')) / dayMs);
      if (gap >= 3) return { line: `${gap} days since your last lift. The week is slipping.` };
    }
    if (Plan.goal() && Plan.modeOk()) {
      const pc = Plan.pace();
      if (pc && pc.behindLb >= 0.8) return { line: `${pc.behindLb.toFixed(1)} lb behind the line. Tighten the next few days.`, go: 'trends' };
    }
    const week = [1, 2, 3, 4, 5, 6, 7].map((n) => Store.checkinOn(daysAgo(n))).filter(Boolean);
    const offDays = week.filter((c) => c.ateHealthy === false).length;
    if (offDays >= 3) return { line: `Ate off-plan ${offDays} of the last 7 days. The deficit doesn’t survive that.`, go: 'food' };
    const rough = [1, 2, 3, 4, 5].map((n) => Store.checkinOn(daysAgo(n))).filter((c) => c && c.sleptWell === false).length;
    if (rough >= 3) return { line: `${rough} rough nights in 5. Recovery is part of the plan.` };
    const y = Store.checkinOn(daysAgo(1));
    if (y && isFinite(y.steps) && y.steps > 0 && y.steps < Plan.stepsTarget) {
      return { line: `${(Plan.stepsTarget - y.steps).toLocaleString()} steps short yesterday. Walk it off today.` };
    }
    return null;
  }

  /* ---------- local insight cards ---------- */

  function localInsights() {
    const s = Store.get();
    const out = [];
    const today = Store.todayStr();

    // Weekly consistency trend (last 4 full-ish weeks)
    const weeks = [];
    for (let w = 0; w < 4; w++) {
      const ref = new Date();
      ref.setDate(ref.getDate() - w * 7);
      const st = Store.weekStats(ref);
      weeks.push(st.ringCount);
    }
    if (s.sessions.length) {
      const thisWk = Store.weekStats();
      out.push({ text: `<b>${thisWk.ringCount} of ${thisWk.goal}</b> this week — ${thisWk.lifts} lift${thisWk.lifts === 1 ? '' : 's'}${thisWk.cardio ? ` + ${thisWk.cardio} cardio` : ''}${thisWk.recovery ? `, ${thisWk.recovery} recovery` : ''}.` });
      const prev = weeks[1];
      if (prev != null && weeks[0] < prev && new Date().getDay() === 0) {
        out.push({ text: `Down vs last week (<b>${weeks[0]}</b> vs ${prev}). Say it plainly: you showed up less.` });
      }
    }

    // Weight rate of change vs mode
    const avgNow = Store.rolling7Avg(today);
    const avgThen = Store.rolling7Avg(daysAgo(14));
    if (avgNow != null && avgThen != null && s.bodyweight.length >= 4) {
      const rate = (avgNow - avgThen) / 2; // lb per week, signed
      const mode = Store.currentMode();
      const g = Plan.goal();
      // With an active plan, "on pace" means the PLAN's prescribed rate — one
      // verdict source, so this can never contradict the plan card in Trends.
      const planRate = g && g.mode === mode ? Plan.weeklyRateLb() : null;
      const dir = rate > 0 ? '+' : '';
      let verdict;
      if (mode === 'cut') {
        if (planRate != null) {
          verdict = rate <= planRate + 0.15 ? `On pace with your plan’s ${planRate.toFixed(1)} lb/wk.`
            : rate < 0 ? `Losing, but slower than your plan’s ${planRate.toFixed(1)} lb/wk.`
            : 'Not a cut yet. The scale doesn’t negotiate.';
        } else {
          verdict = rate <= -0.5 ? 'On pace.' : rate < 0 ? 'Moving, but slowly — tighten the Tue/Thu dinners.' : 'Not a cut yet. The scale doesn’t negotiate.';
        }
      } else if (planRate != null) {
        verdict = rate >= planRate - 0.1 ? `Gaining on your plan’s +${planRate.toFixed(1)} lb/wk.` : `Under your plan’s +${planRate.toFixed(1)} lb/wk — bulk means eating.`;
      } else {
        verdict = rate >= 0.25 ? 'Gaining on schedule.' : 'Bulk means eating — add the carbs.';
      }
      out.push({ text: `Trending <b>${dir}${rate.toFixed(1)} lb/week</b> (7-day avg). ${verdict}` });
    }

    // Sleep → training correlation
    const badNights = s.checkins.filter((c) => c.sleptWell === false);
    if (badNights.length >= 3) {
      const trainedAfterBad = badNights.filter((c) => {
        const next = Store.todayStr(new Date(new Date(c.date + 'T12:00:00').getTime() + dayMs));
        return s.sessions.some((x) => x.date === c.date || x.date === next);
      }).length;
      const pct = Math.round((trainedAfterBad / badNights.length) * 100);
      if (pct < 60) {
        out.push({ text: `After a bad night you train only <b>${pct}%</b> of the time. Sleep is your first workout.` });
      }
    }

    // Food → training correlation
    const badFood = s.checkins.filter((c) => c.ateHealthy === false);
    if (badFood.length >= 3) {
      const alsoSkipped = badFood.filter((c) => !s.sessions.some((x) => x.date === c.date)).length;
      const pct = Math.round((alsoSkipped / badFood.length) * 100);
      if (pct >= 50) {
        out.push({ text: `<b>${pct}%</b> of bad-eating days are also no-gym days. They travel together — break one, break both.` });
      }
    }

    if (!out.length) out.push({ text: 'Log a few days and the numbers start talking.' });
    return out;
  }

  /* ---------- Claude coach ---------- */

  function buildSummary() {
    const s = Store.get();
    const cutoff = daysAgo(90);
    return {
      today: Store.todayStr(),
      profile: { name: 'Dylan (Noof)', age: 25, heightIn: s.settings.profile.heightIn, sex: 'M' },
      context:
        'Lives in Williamsburg Brooklyn. Two Equinox options: Bedford Ave (close) and Domino (cold plunge + sauna, 15-min walk — realistic on weekends; weekday mornings there cost sleep). ' +
        'Office at 345 Hudson St Mon-Fri: breakfast provided daily; catered lunch Mon/Wed/Fri (healthy, leftovers often become dinner); buys lunch Tue/Thu (Cava/Sweetgreen/Just Salad/Chipotle); barely cooks weekdays. ' +
        'Lifts 7am or 7pm on weekdays, whenever on weekends. Rotation: Push/Pull/Legs, plus Cardio and Recovery (sauna/plunge) as standalone types. Weekly goal counts lifts+cardio.',
      mode: Store.currentMode(),
      modeHistory: s.modes,
      weeklyGoal: s.settings.weeklyGoal,
      plan: (typeof Plan !== 'undefined' && Plan.goal() && Plan.modeOk())
        ? { ...Plan.goal(), targetWeightLb: Plan.targetWeight(), weeklyRateLb: Math.round(Plan.weeklyRateLb() * 100) / 100, behindLb: Math.round(Plan.pace().behindLb * 10) / 10, kcalAdjustment: Plan.kcalAdjustment() }
        : null,
      fuelTargets: typeof Fuel !== 'undefined' ? Fuel.targets() : null,
      sessions: s.sessions.filter((x) => x.date >= cutoff).map((x) => ({
        date: x.date,
        dow: new Date(x.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }), // precomputed — day-of-week math from dates alone is error-prone
        type: (Store.typeById(x.typeId) || {}).name,
      })),
      bodyweight: s.bodyweight.filter((b) => b.date >= cutoff),
      checkins: s.checkins.filter((c) => c.date >= cutoff),
      food: (() => {
        const days = ((s.food && s.food.days) || []).filter((f) => f.date >= cutoff);
        if (!days.length) return null;
        const counts = {};
        days.forEach((f) => f.items.forEach((x) => { const k = x.name.toLowerCase(); counts[k] = (counts[k] || 0) + 1; }));
        return {
          daysLogged: days.length,
          avgKcal: Math.round(days.reduce((a, f) => a + f.totals.kcal, 0) / days.length),
          avgProteinG: Math.round(days.reduce((a, f) => a + f.totals.protein_g, 0) / days.length),
          healthyPct: Math.round((100 * days.filter((f) => f.healthy).length) / days.length),
          topFoods: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `${n} ×${c}`),
          recent: days.slice(-14).map((f) => ({ date: f.date, totals: f.totals, healthy: f.healthy, items: f.items.map((x) => x.name) })),
        };
      })(),
      photoVerdict: (() => {
        const pcs = (s.photos && s.photos.checkins) || [];
        for (let i = pcs.length - 1; i >= 0; i--) if (pcs[i].verdict) return { checkinDate: pcs[i].date, text: pcs[i].verdict.text };
        return null;
      })(),
    };
  }

  const SYSTEM =
    'You are the coach inside NoofGains, a personal fitness app used by exactly one person: Dylan ("Noof"). ' +
    'Voice: a coach who calls you out — warm but direct. Praise real consistency specifically; state misses plainly with numbers ("you skipped 2 of the last 3 Leg days"). No corporate wellness-speak, no lectures, no guilt-spirals — facts, one pattern, one concrete next action. ' +
    'You get his last ~90 days as JSON: binary workout log (no sets/weights by design — do not ask for them), body weight + body fat, binary sleep/food/steps check-ins (~8k steps is the cut-day target), bulk/cut phases, and his real-life context (gyms, office food rhythm). ' +
    'If a `food` object is present he voice-logs his days — items with estimated macros (treat as ±20% estimates) plus 90-day aggregates. Coach eating HABITS from it: protein consistency, repeat offenders in topFoods, weekday patterns. NEVER re-derive his calorie targets from those estimates — the plan calibrates calories from his scale trend, which is ground truth. Days without a log still carry the binary ateHealthy. ' +
    'If a `plan` object is present, the app already runs a deterministic goal plan (fixed weekly milestone line, auto calorie calibration) — coach WITHIN that plan; do not invent a competing one. ' +
    'Look for cross-signal patterns (bad sleep → skipped sessions → stalled weight). Respect his logistics: never suggest a weekday-morning Domino trip if sleep is the problem; Tue/Thu are his self-catered risk days. ' +
    'If `photoVerdict` is present it is your own most recent visual read of his physique from progress photos — trust it as ground truth about how he looks and weave it in where relevant. ' +
    'Format: plain text, no markdown headers. 3 short paragraphs max: (1) what is working, (2) what is slipping — with numbers, (3) exactly one recommendation for the next 7 days.';

  const CHAT_SYSTEM =
    'You are the coach inside NoofGains, a personal fitness app used by exactly one person: Dylan ("Noof"), chatting with him directly. ' +
    'Voice: a coach who calls you out — warm but direct, no flattery, no lectures. Short answers: 1–3 short paragraphs, plain text, no markdown. ' +
    'Every message includes his current data snapshot (last ~90 days): binary workout log with weekday per session (spot schedule patterns like "chest Mondays, runs weekends"), body weight + body fat, binary sleep/food/steps check-ins with step counts when posted (~8k steps is the cut-day target), bulk/cut phases, his goal plan, calorie/protein targets, real-life context (gyms, office food rhythm, 345 Hudson Mon–Fri), and — when present — photoVerdict, your own most recent visual read of his physique. ' +
    'Answer his questions grounded ONLY in that data and context; when numbers exist, use them. Workouts are binary by design — no sets/weights. When a `food` object is present he voice-logs what he eats: items + estimated macros (±20% estimates — coach habits and protein consistency from them, and NEVER re-derive his calorie targets from them; the plan calibrates calories from his scale trend). Unlogged days fall back to the binary ateHealthy. If he asks about something the app doesn’t track, say so plainly instead of guessing. ' +
    'If a `plan` object is present the app already runs a deterministic goal plan — coach within it, don’t invent a competing one. ' +
    'Look for cross-signal patterns when relevant (bad sleep → skipped sessions → stalled weight). When giving advice, end with exactly one concrete next action.';

  const PHOTO_SYSTEM =
    'You are the coach inside NoofGains, a personal fitness app used by exactly one person: Dylan ("Noof"), 25, male. ' +
    'He sends progress photos (relaxed front / left side / back, same framing via ghost-overlay alignment, mirrored consistently) from up to three check-ins: a baseline, the previous check-in, and today. ' +
    'You also get his scale data (weight lb, body fat %) for those dates and his current mode (cut/bulk). ' +
    'Compare like-to-like across dates — never rate a single photo in isolation, and never diagnose health conditions. ' +
    'Voice: a coach who calls you out — warm but direct, no flattery, no body-shaming, facts first. ' +
    'Format: plain text, no markdown. 3 short paragraphs max: (1) what visibly changed and where (waist, chest, delts, back — be specific), (2) does the visual agree with the scale trend — say so with the numbers, (3) exactly one focus for the next 2 weeks.';

  // USD per million tokens for claude-opus-4-8 ($5 in / $25 out; cache writes 1.25x, reads 0.1x)
  const PRICE = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };

  function costOf(usage) {
    if (!usage) return 0;
    return ((usage.input_tokens || 0) * PRICE.input
      + (usage.output_tokens || 0) * PRICE.output
      + (usage.cache_creation_input_tokens || 0) * PRICE.cacheWrite
      + (usage.cache_read_input_tokens || 0) * PRICE.cacheRead) / 1e6;
  }

  /* Streamed request (SSE). Non-streamed calls with adaptive thinking sit
     silent for 30–60s — iOS backgrounds Safari and the request dies with no
     error. Streaming puts words on screen in seconds and keeps the
     connection visibly alive. onEvent gets {thinking, text} as it arrives. */
  async function request(system, content, history, onEvent) {
    const key = Store.get().settings.anthropicKey;
    if (!key) throw new Error('no-key');

    const ctrl = new AbortController();
    const ceiling = setTimeout(() => ctrl.abort(), 180000); // hard stop — nothing should run this long
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 4000,
          stream: true,
          thinking: { type: 'adaptive' },
          system,
          messages: [...(history || []), { role: 'user', content }],
        }),
      });
    } catch (e) {
      clearTimeout(ceiling);
      throw new Error(e.name === 'AbortError' ? 'Timed out — try again' : 'No connection — check your network');
    }

    if (!res.ok) {
      clearTimeout(ceiling);
      const body = await res.json().catch(() => null);
      const msg = body && body.error ? body.error.message : `HTTP ${res.status}`;
      throw new Error(res.status === 401 ? 'bad-key' : msg);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', stop = null;
    const usage = {};
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop(); // keep the partial line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === 'message_start') {
            Object.assign(usage, ev.message.usage);
          } else if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') {
            if (onEvent) onEvent({ thinking: true, text });
          } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            text += ev.delta.text;
            if (onEvent) onEvent({ thinking: false, text });
          } else if (ev.type === 'message_delta') {
            if (ev.usage) Object.assign(usage, ev.usage);
            if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
          }
        }
      }
    } finally {
      clearTimeout(ceiling);
    }

    if (stop === 'refusal') throw new Error('Claude declined to answer — try rephrasing.');
    text = text.trim();
    if (!text) throw new Error('Empty response — try again.');
    return { text, cost: costOf(usage) };
  }

  function trackSpend(s, cost) {
    const sp = s.coach.spend || (s.coach.spend = { totalUsd: 0, calls: 0, byMonth: {} });
    sp.totalUsd += cost;
    sp.calls += 1;
    const mo = Store.todayStr().slice(0, 7);
    sp.byMonth[mo] = (sp.byMonth[mo] || 0) + cost;
  }

  async function analyze(onEvent) {
    const { text, cost } = await request(SYSTEM, 'My data:\n' + JSON.stringify(buildSummary()) + '\n\nCoach me.', null, onEvent);
    Store.update((s) => {
      s.coach.lastInsight = { date: Store.todayStr(), text, costUsd: cost };
      trackSpend(s, cost);
    });
    return text;
  }

  /* Ask-anything chat — fires ONLY when Dylan sends a message. His fresh
     data snapshot rides along in the system prompt every call, so answers
     always come from current numbers. Claude sees the last CHAT_CONTEXT
     thread messages; older ones stay visible in the app but age out. */
  const CHAT_CONTEXT = 16;

  const chatThread = () => Store.get().coach.chat || [];

  async function chat(text, onEvent) {
    const history = chatThread()
      .slice(-CHAT_CONTEXT)
      .map((m) => ({ role: m.role, content: m.text }));
    const system = CHAT_SYSTEM + '\n\nToday: ' + Store.todayStr() + '\nHis current data:\n' + JSON.stringify(buildSummary());
    Store.update((s) => {
      (s.coach.chat || (s.coach.chat = [])).push({ role: 'user', text, date: Store.todayStr() });
    });
    try {
      const { text: reply, cost } = await request(system, text, history, onEvent);
      Store.update((s) => {
        s.coach.chat.push({ role: 'assistant', text: reply, date: Store.todayStr(), costUsd: cost });
        trackSpend(s, cost);
      });
      return reply;
    } catch (e) {
      Store.update((s) => { s.coach.chat.pop(); }); // failed send doesn't pollute the thread
      throw e;
    }
  }

  function clearChat() {
    Store.update((s) => { s.coach.chat = []; });
  }

  /* Photo comparison — fires ONLY on an explicit Compare tap. Sends the
     baseline, previous, and given check-in's shots (decrypted just for the
     call) + scale data for those dates. Verdict lands on the check-in. */
  async function analyzePhotos(date) {
    const s = Store.get();
    const cs = (s.photos && s.photos.checkins) || [];
    const cur = cs.find((c) => c.date === date);
    if (!cur) throw new Error('No check-in for ' + date);
    const older = cs.filter((c) => c.date < date);
    const sets = [];
    if (older.length) sets.push({ label: 'baseline', ...older[0] });
    if (older.length > 1) sets.push({ label: 'previous check-in', ...older[older.length - 1] });
    sets.push({ label: 'today', ...cur });

    const weighNear = (d) => {
      const hit = s.bodyweight.filter((b) => b.date <= d).slice(-1)[0];
      return hit ? { weightLb: hit.weight, bodyFatPct: hit.bodyFat != null ? hit.bodyFat : null, weighDate: hit.date } : null;
    };

    const content = [{
      type: 'text',
      text: 'Progress photo comparison. Mode: ' + Store.currentMode() + '. Scale data per check-in:\n'
        + JSON.stringify(sets.map((x) => ({ date: x.date, label: x.label, scale: weighNear(x.date) }))),
    }];
    for (const set of sets) {
      content.push({ type: 'text', text: `--- ${set.label} · ${set.date} (front, left side, back) ---` });
      for (const pose of set.poses) {
        const b64 = await Photos.shotB64(set.date, pose);
        if (!b64) throw new Error('Photos are locked — unlock them first');
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
      }
    }
    content.push({ type: 'text', text: 'Compare the check-ins and coach me.' });

    const { text, cost } = await request(PHOTO_SYSTEM, content);
    Store.update((st) => {
      const c = st.photos.checkins.find((x) => x.date === date);
      if (c) c.verdict = { date: Store.todayStr(), text, costUsd: cost };
      trackSpend(st, cost);
    });
    return text;
  }

  return { localInsights, recoveryFlag, nudge, analyze, analyzePhotos, chat, chatThread, clearChat, costOf, trackSpend };
})();
