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
      const rate = ((avgNow - avgThen) / 2).toFixed(1); // lb per week
      const mode = Store.currentMode();
      const dir = rate > 0 ? '+' : '';
      let verdict;
      if (mode === 'cut') {
        verdict = rate <= -0.5 ? 'On pace.' : rate < 0 ? 'Moving, but slowly — tighten the Tue/Thu dinners.' : 'Not a cut yet. The scale doesn’t negotiate.';
      } else {
        verdict = rate >= 0.25 ? 'Gaining on schedule.' : 'Bulk means eating — add the carbs.';
      }
      out.push({ text: `Trending <b>${dir}${rate} lb/week</b> (7-day avg). ${verdict}` });
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
      fuelTargets: typeof Fuel !== 'undefined' ? Fuel.targets() : null,
      sessions: s.sessions.filter((x) => x.date >= cutoff).map((x) => ({ date: x.date, type: (Store.typeById(x.typeId) || {}).name })),
      bodyweight: s.bodyweight.filter((b) => b.date >= cutoff),
      checkins: s.checkins.filter((c) => c.date >= cutoff),
    };
  }

  const SYSTEM =
    'You are the coach inside NoofGains, a personal fitness app used by exactly one person: Dylan ("Noof"). ' +
    'Voice: a coach who calls you out — warm but direct. Praise real consistency specifically; state misses plainly with numbers ("you skipped 2 of the last 3 Leg days"). No corporate wellness-speak, no lectures, no guilt-spirals — facts, one pattern, one concrete next action. ' +
    'You get his last ~90 days as JSON: binary workout log (no sets/weights by design — do not ask for them), body weight + body fat, binary sleep/food check-ins, bulk/cut phases, and his real-life context (gyms, office food rhythm). ' +
    'Look for cross-signal patterns (bad sleep → skipped sessions → stalled weight). Respect his logistics: never suggest a weekday-morning Domino trip if sleep is the problem; Tue/Thu are his self-catered risk days. ' +
    'Format: plain text, no markdown headers. 3 short paragraphs max: (1) what is working, (2) what is slipping — with numbers, (3) exactly one recommendation for the next 7 days.';

  async function analyze() {
    const key = Store.get().settings.anthropicKey;
    if (!key) throw new Error('no-key');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system: SYSTEM,
        messages: [{ role: 'user', content: 'My data:\n' + JSON.stringify(buildSummary()) + '\n\nCoach me.' }],
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body && body.error ? body.error.message : `HTTP ${res.status}`;
      throw new Error(res.status === 401 ? 'bad-key' : msg);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('Claude declined to answer — try again.');
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) throw new Error('Empty response — try again.');

    Store.update((s) => { s.coach.lastInsight = { date: Store.todayStr(), text }; });
    return text;
  }

  return { localInsights, recoveryFlag, analyze };
})();
