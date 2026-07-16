/* NoofGains — voice food log. One dictated recap per day → Claude turns it
   into items + macro estimates (structured output, guaranteed JSON) and a
   healthy verdict that auto-answers the ateHealthy binary.
   Macros are habit-coaching estimates — the scale-driven calorie calibration
   in Plan stays the calorie ground truth. */
'use strict';

const Food = (() => {
  /* Everything required + additionalProperties:false — structured outputs
     rejects anything else. No numeric min/max (unsupported); clamped below. */
  const FOOD_SCHEMA = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            portion: { type: 'string' },
            kcal: { type: 'integer' },
            protein_g: { type: 'integer' },
            fat_g: { type: 'integer' },
            carbs_g: { type: 'integer' },
          },
          required: ['name', 'portion', 'kcal', 'protein_g', 'fat_g', 'carbs_g'],
          additionalProperties: false,
        },
      },
      totals: {
        type: 'object',
        properties: {
          kcal: { type: 'integer' },
          protein_g: { type: 'integer' },
          fat_g: { type: 'integer' },
          carbs_g: { type: 'integer' },
        },
        required: ['kcal', 'protein_g', 'fat_g', 'carbs_g'],
        additionalProperties: false,
      },
      healthy: { type: 'boolean' },
      note: { type: 'string' },
    },
    required: ['items', 'totals', 'healthy', 'note'],
    additionalProperties: false,
  };

  const SYSTEM =
    'You are the nutrition estimator inside NoofGains, used by exactly one person: Dylan ("Noof"), 25, male, lifter. ' +
    'He dictates one end-of-day food recap; you receive the raw transcription (speech-to-text may garble food names — infer the obvious intended food). ' +
    'His real food world: David protein bars (~150 kcal, 28g protein each), office breakfast + catered lunch at 345 Hudson Mon/Wed/Fri, Cava/Sweetgreen/Just Salad/Chipotle on Tue/Thu, leftovers or takeout dinners, barely cooks. ' +
    'Estimate every item he names. Unstated portions: assume his typical (a bowl means a full bowl, a bar means one bar). Be honest and slightly conservative — when unsure round calories UP and protein DOWN. ' +
    'healthy: true when the day as a whole supports his current mode and targets (protein at or near target, calories not a blowout) — one treat inside an otherwise dialed day is still healthy; a clearly over-target or protein-starved day is not. ' +
    'note: ONE short sentence with your key portion assumption or the one flag worth knowing. All numbers are integers.';

  const clampInt = (v, max) => Math.max(0, Math.min(Math.round(Number(v) || 0), max));

  /* Totals are always re-derived from items — one rule for parses and hand edits. */
  const totalsOf = (items) => items.reduce((t, x) => ({
    kcal: t.kcal + x.kcal, protein_g: t.protein_g + x.protein_g,
    fat_g: t.fat_g + x.fat_g, carbs_g: t.carbs_g + x.carbs_g,
  }), { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 });

  /* ---------- add-food search: his own history first, staples as backfill ---------- */

  /* Seed catalog for Dylan's actual food world — history entries shadow these
     (same name = his logged macros win). Estimates, same as the parser's. */
  const STAPLES = [
    { name: 'David protein bar', portion: '1 bar', kcal: 150, protein_g: 28, fat_g: 2, carbs_g: 26 },
    { name: 'Fairlife protein shake', portion: '1 bottle', kcal: 150, protein_g: 30, fat_g: 3, carbs_g: 4 },
    { name: 'Protein yogurt', portion: '1 container (~150g)', kcal: 150, protein_g: 15, fat_g: 3, carbs_g: 9 },
    { name: 'Whey protein shake', portion: '1 scoop', kcal: 130, protein_g: 25, fat_g: 2, carbs_g: 3 },
    { name: 'Eggs', portion: '2 eggs', kcal: 140, protein_g: 12, fat_g: 10, carbs_g: 1 },
    { name: 'Chicken breast', portion: '6 oz cooked', kcal: 280, protein_g: 52, fat_g: 6, carbs_g: 0 },
    { name: 'Salmon', portion: '6 oz', kcal: 350, protein_g: 34, fat_g: 22, carbs_g: 0 },
    { name: 'Steak', portion: '6 oz', kcal: 400, protein_g: 46, fat_g: 22, carbs_g: 0 },
    { name: 'White rice', portion: '1 cup cooked', kcal: 205, protein_g: 4, fat_g: 0, carbs_g: 45 },
    { name: 'Banana', portion: '1 medium', kcal: 105, protein_g: 1, fat_g: 0, carbs_g: 27 },
    { name: 'Apple', portion: '1 medium', kcal: 95, protein_g: 0, fat_g: 0, carbs_g: 25 },
    { name: 'Cava bowl', portion: 'full bowl', kcal: 800, protein_g: 45, fat_g: 35, carbs_g: 70 },
    { name: 'Chipotle chicken bowl', portion: 'full bowl', kcal: 900, protein_g: 50, fat_g: 35, carbs_g: 85 },
    { name: 'Sweetgreen salad', portion: '1 salad', kcal: 550, protein_g: 30, fat_g: 30, carbs_g: 45 },
    { name: 'Just Salad bowl', portion: '1 bowl', kcal: 600, protein_g: 35, fat_g: 30, carbs_g: 50 },
  ];

  const bareItem = (x) => ({ name: x.name, portion: x.portion, kcal: x.kcal, protein_g: x.protein_g, fat_g: x.fat_g, carbs_g: x.carbs_g });

  function search(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    const seen = new Map(); // lower-cased name → {item, count, last}
    for (const d of Store.get().food.days) {
      for (const it of d.items || []) {
        const k = it.name.toLowerCase();
        const e = seen.get(k);
        if (e) { e.count++; if (d.date >= e.last) { e.last = d.date; e.item = it; } }
        else seen.set(k, { item: it, count: 1, last: d.date });
      }
    }
    const hits = [];
    for (const [k, e] of seen) if (k.includes(q)) hits.push(e);
    hits.sort((a, b) => (b.count - a.count) || b.last.localeCompare(a.last));
    const out = hits.map((e) => bareItem(e.item));
    for (const st of STAPLES) {
      if (st.name.toLowerCase().includes(q) && !seen.has(st.name.toLowerCase())) out.push(bareItem(st));
    }
    return out.slice(0, 6);
  }

  function sanitize(p) {
    const item = (x) => ({
      name: String(x.name || '').slice(0, 80),
      portion: String(x.portion || '').slice(0, 80),
      kcal: clampInt(x.kcal, 5000),
      protein_g: clampInt(x.protein_g, 400),
      fat_g: clampInt(x.fat_g, 400),
      carbs_g: clampInt(x.carbs_g, 800),
    });
    const items = (Array.isArray(p.items) ? p.items : []).slice(0, 30).map(item);
    if (!items.length) throw new Error('No food found in that — try again with what you ate.');
    // Totals re-derived from items — the model's own sum can drift.
    return { items, totals: totalsOf(items), healthy: !!p.healthy, note: String(p.note || '').slice(0, 200) };
  }

  /* One structured-output call. Non-streaming — no thinking, small response,
     back in seconds. Returns { parsed, cost }. */
  async function parse(date, raw) {
    const key = Store.get().settings.anthropicKey;
    if (!key) throw new Error('no-key');

    const t = Fuel.targets(date);
    const content =
      `Date: ${date} · Mode: ${t.mode} · Today's targets: ${t.kcal} kcal, ${t.protein}g protein.\n` +
      `His dictated recap of everything he ate:\n"""${raw}"""\n\nEstimate it.`;

    const ctrl = new AbortController();
    const ceiling = setTimeout(() => ctrl.abort(), 90000);
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
          max_tokens: 2500,
          system: SYSTEM,
          output_config: { format: { type: 'json_schema', schema: FOOD_SCHEMA } },
          messages: [{ role: 'user', content }],
        }),
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Timed out — try again' : 'No connection — check your network');
    } finally {
      clearTimeout(ceiling);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body && body.error ? body.error.message : `HTTP ${res.status}`;
      throw new Error(res.status === 401 ? 'bad-key' : msg);
    }

    const body = await res.json();
    if (body.stop_reason === 'refusal') throw new Error('Claude declined that one — try rewording.');
    if (body.stop_reason === 'max_tokens') throw new Error('That recap ran long — trim it and retry.');
    const block = (body.content || []).find((b) => b.type === 'text');
    if (!block) throw new Error('Empty response — try again.');
    return { parsed: sanitize(JSON.parse(block.text)), cost: Coach.costOf(body.usage) };
  }

  /* Full log flow: parse → store the day → auto-answer ateHealthy → spend. */
  async function log(date, raw) {
    const { parsed, cost } = await parse(date, raw);
    const rec = { date, raw, ...parsed, loggedAt: new Date().toISOString(), costUsd: cost };
    Store.update((s) => {
      Coach.trackSpend(s, cost);
    });
    Store.setFood(date, rec);
    Store.setCheckin(date, 'ateHealthy', rec.healthy); // auto-answer; manual taps afterward win
    return rec;
  }

  return { log, search, totalsOf };
})();
