/* NoofGains — Fuel engine.
   Deterministic, offline meal planning around Dylan's real week:
   office breakfast daily; catered lunch Mon/Wed/Fri; Tue/Thu bought lunch
   (Cava / Sweetgreen / Just Salad / Chipotle near 345 Hudson); no-cook dinners.
   Macros are honest estimates, labeled as such in the UI. */
'use strict';

const Fuel = (() => {
  /* ---------- macro targets ---------- */

  function age(birthdate, onDate) {
    const b = new Date(birthdate + 'T12:00:00');
    const d = new Date(onDate + 'T12:00:00');
    let a = d.getFullYear() - b.getFullYear();
    const m = d.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && d.getDate() < b.getDate())) a--;
    return a;
  }

  /* Mifflin-St Jeor from 7-day avg weight (falls back to last entry). */
  function targets(date = Store.todayStr()) {
    const p = Store.get().settings.profile;
    const last = Store.lastWeight();
    const lb = Store.rolling7Avg(date) || (last ? last.weight : 165);
    const kg = lb * 0.4536;
    const cm = p.heightIn * 2.54;
    const bmr = 10 * kg + 6.25 * cm - 5 * age(p.birthdate, date) + 5; // male
    const tdee = bmr * 1.5; // office job + ~5 sessions/wk
    const mode = Store.currentMode(date);
    let kcal = mode === 'cut' ? Math.max(tdee - 500, 1900) : tdee + 300;
    // Plan engine's weekly calibration nudges calories ±100 at a time when
    // the work was done but the line was missed. Hard caps always win:
    // cut stays ≥1,900 and keeps a real deficit; bulk never dips below TDEE.
    if (typeof Plan !== 'undefined' && Plan.goal()) {
      kcal += Plan.kcalAdjustment(date);
      if (mode === 'cut') kcal = Math.min(Math.max(kcal, 1900), Math.max(tdee - 300, 1900));
      else kcal = Math.max(kcal, tdee);
    }
    kcal = Math.round(kcal / 10) * 10;
    const protein = Math.round(lb);            // 1 g/lb
    const fat = Math.round(lb * (mode === 'cut' ? 0.36 : 0.42));
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, protein, fat, carbs, mode, weightUsed: Math.round(lb * 10) / 10, tdee: Math.round(tdee) };
  }

  /* ---------- meal library ----------
     m: [kcal, protein, fat, carbs]; mode: 'cut' | 'bulk' | 'both' */

  const LIB = {
    officeBreakfast: [
      { food: '3 scrambled eggs + fruit', m: [330, 20, 21, 14], mode: 'both', note: 'Skip the bagel tray.' },
      { food: '0% Greek yogurt + granola + berries', m: [330, 22, 8, 42], mode: 'both' },
      { food: '2 eggs + oatmeal cup + banana', m: [400, 17, 13, 52], mode: 'both' },
      { food: 'Egg + turkey sausage + fruit', m: [360, 26, 22, 12], mode: 'cut' },
      { food: 'Eggs + avocado toast + yogurt', m: [560, 28, 28, 48], mode: 'bulk', note: 'Add the toast on a bulk.' },
    ],
    chainLunch: [
      { food: 'Chipotle — chicken bowl, double chicken, light white rice, black beans, fajita veg, pico + lettuce, no cheese/sour cream', m: [650, 68, 17, 55], mode: 'cut' },
      { food: 'Chipotle — double chicken bowl, full rice, beans, cheese + guac', m: [980, 72, 40, 92], mode: 'bulk' },
      { food: 'Sweetgreen — Harvest Bowl, double chicken, no cheese, half dressing', m: [640, 56, 20, 58], mode: 'cut' },
      { food: 'Sweetgreen — Harvest Bowl, double chicken + extra rice', m: [860, 60, 28, 88], mode: 'bulk' },
      { food: 'Cava — greens + half grains, double chicken, hummus, tomato-cucumber, light tahini', m: [620, 54, 22, 48], mode: 'cut' },
      { food: 'Cava — full grains, chicken + meatballs, hummus, tzatziki + pita', m: [950, 62, 34, 90], mode: 'bulk' },
      { food: 'Just Salad — romaine, double grilled chicken, egg, tomato, cucumber, light balsamic', m: [480, 52, 20, 22], mode: 'cut' },
      { food: 'Just Salad — warm bowl, chicken, quinoa, avocado', m: [800, 48, 30, 78], mode: 'bulk' },
    ],
    cateredLunch: [
      { food: 'Catered lunch — protein first: two palm-size servings of the protein, one scoop of the starch, pile the vegetables', m: [620, 45, 22, 55], mode: 'both', note: 'Estimate. Protein before anything else.' },
      { food: 'Catered lunch — build around the lean protein; skip creamy sides, one dessert max', m: [650, 42, 25, 58], mode: 'both', note: 'Estimate.' },
    ],
    leftoversDinner: [
      { food: 'Office leftovers — protein double-scoop + veg; add a Greek yogurt if lunch ran light', m: [550, 40, 20, 45], mode: 'both', note: 'Estimate.' },
      { food: 'Office leftovers + microwave rice cup if you lifted today', m: [650, 42, 20, 65], mode: 'both', note: 'Estimate.' },
    ],
    noCookDinner: [
      { food: 'Rotisserie chicken (half) + microwave rice cup + bagged salad', m: [700, 60, 26, 52], mode: 'both' },
      { food: '2 cans tuna + rice cup + olive-oil drizzle + spinach', m: [560, 56, 16, 48], mode: 'both' },
      { food: '2 chicken sausages + microwave sweet potato + greens', m: [520, 34, 22, 46], mode: 'both' },
      { food: 'TJ’s grilled chicken strips + frozen jasmine rice + broccoli', m: [560, 45, 12, 62], mode: 'both' },
      { food: '2 salmon-avocado rolls + edamame', m: [700, 36, 22, 82], mode: 'both' },
      { food: 'Deli double-turkey sandwich + apple', m: [540, 38, 12, 68], mode: 'cut' },
      { food: 'Halal cart — chicken over rice, light white sauce', m: [900, 55, 34, 88], mode: 'bulk' },
    ],
    flexDinner: [
      { food: 'Social dinner — order protein-first (steak, fish, or chicken main), skip the bread basket, ~2 drinks max', m: [800, 45, 35, 55], mode: 'both', note: 'Budget estimate — enjoy it.' },
    ],
    snack: [
      { food: '0% Greek yogurt + berries', m: [160, 18, 0, 20], mode: 'both' },
      { food: 'Whey shake (water)', m: [130, 25, 2, 3], mode: 'both' },
      { food: 'Beef jerky bag', m: [140, 22, 2, 8], mode: 'both' },
      { food: 'Cottage cheese cup', m: [180, 22, 5, 8], mode: 'both' },
      { food: '2 hard-boiled eggs', m: [140, 12, 10, 1], mode: 'both' },
      { food: 'Apple + 2 string cheese', m: [260, 16, 12, 26], mode: 'both' },
      { food: 'Whole-milk whey shake + banana', m: [420, 33, 10, 48], mode: 'bulk' },
      { food: 'PB + banana toast', m: [380, 12, 16, 48], mode: 'bulk' },
      { food: 'Greek yogurt + granola + honey', m: [380, 22, 9, 55], mode: 'bulk' },
      { food: 'Trail mix, big handful', m: [330, 10, 22, 26], mode: 'bulk' },
    ],
    preGym: [
      { food: 'Banana + black coffee', m: [110, 1, 0, 27], mode: 'both' },
      { food: '2 rice cakes + honey', m: [150, 1, 0, 35], mode: 'both' },
    ],
    postGym: [
      { food: 'Whey shake (water)', m: [130, 25, 2, 3], mode: 'both' },
    ],
  };

  /* ---------- day templates ---------- */

  const DAY_KINDS = {
    1: { label: 'Catered-lunch day', lunch: 'cateredLunch', dinner: 'leftoversDinner' }, // Mon
    2: { label: 'Buy-lunch day',     lunch: 'chainLunch',   dinner: 'noCookDinner' },    // Tue
    3: { label: 'Catered-lunch day', lunch: 'cateredLunch', dinner: 'leftoversDinner' }, // Wed
    4: { label: 'Buy-lunch day',     lunch: 'chainLunch',   dinner: 'noCookDinner' },    // Thu
    5: { label: 'Catered-lunch day', lunch: 'cateredLunch', dinner: 'flexDinner' },      // Fri
    6: { label: 'Weekend',           lunch: 'noCookDinner', dinner: 'noCookDinner' },    // Sat
    0: { label: 'Weekend',           lunch: 'noCookDinner', dinner: 'noCookDinner' },    // Sun
  };

  function dayNum(date) {
    return Math.floor(new Date(date + 'T12:00:00').getTime() / 86400000);
  }

  function pick(list, date, slotId, mode) {
    const pool = list.filter((x) => x.mode === 'both' || x.mode === mode);
    if (!pool.length) return null;
    const swaps = Store.get().fuel.swaps || {};
    const offset = swaps[date + '|' + slotId] || 0;
    // Deterministic per-day rotation, salted per slot so two slots drawing from
    // the same pool on the same day (weekend lunch + dinner) don't collide.
    const salt = [...slotId].reduce((a, c) => a + c.charCodeAt(0), 0);
    const idx = (dayNum(date) + salt + offset) % pool.length;
    return pool[idx];
  }

  /* Workout slot for the day: 'am' | 'pm' | 'off'. */
  function slotChoice(date) {
    const stored = (Store.get().fuel.slotChoice || {})[date];
    if (stored) return stored;
    const dow = new Date(date + 'T12:00:00').getDay();
    return dow === 0 || dow === 6 ? 'off' : 'pm';
  }

  function setSlotChoice(date, v) {
    Store.update((s) => { s.fuel.slotChoice[date] = v; });
  }

  function swap(date, slotId) {
    Store.update((s) => {
      const k = date + '|' + slotId;
      s.fuel.swaps[k] = (s.fuel.swaps[k] || 0) + 1;
    });
  }

  /* Build the day's timeline. */
  function plan(date = Store.todayStr()) {
    const t = targets(date);
    const dow = new Date(date + 'T12:00:00').getDay();
    const kind = DAY_KINDS[dow];
    const slot = slotChoice(date);
    const weekend = dow === 0 || dow === 6;
    const meals = [];

    if (slot === 'am') meals.push({ time: '6:40a', slotId: 'pre', name: 'Pre-lift', ...pick(LIB.preGym, date, 'pre', t.mode), locked: false });

    const bfast = pick(LIB.officeBreakfast, date, 'bfast', t.mode);
    meals.push({
      time: weekend ? '9:30a' : '8:30a',
      slotId: 'bfast',
      name: weekend ? 'Breakfast' : 'Office breakfast',
      ...bfast,
      note: slot === 'am' ? 'Post-lift — add a whey shake (+130 cal / 25g P).' : bfast.note,
      extraM: slot === 'am' ? [130, 25, 2, 3] : null,
    });

    meals.push({ time: weekend ? '1:00p' : '12:30p', slotId: 'lunch', name: 'Lunch', ...pick(LIB[kind.lunch], date, 'lunch', t.mode) });

    if (slot === 'pm') {
      meals.push({ time: '4:30p', slotId: 'pregym', name: 'Pre-gym snack', ...pick(LIB.snack, date, 'pregym', t.mode) });
    } else {
      meals.push({ time: '3:30p', slotId: 'snack', name: 'Snack', ...pick(LIB.snack, date, 'snack', t.mode) });
    }

    const dinner = pick(LIB[kind.dinner], date, 'dinner', t.mode);
    meals.push({
      time: slot === 'pm' ? '8:30p' : '7:30p',
      slotId: 'dinner',
      name: slot === 'pm' ? 'Post-lift dinner' : 'Dinner',
      ...dinner,
      note: slot === 'pm' ? 'Post-workout — don’t skimp the carbs here.' : dinner.note,
    });

    // Top-up loop: fill protein and calorie gaps with snacks until the day
    // lands within tolerance (≤20g protein short, ≤12% kcal short), max 3 adds.
    let totals = sum(meals);
    const proteinSnacks = LIB.snack.filter((x) => x.m[1] >= 18);
    const times = ['9:30p', '10:00p', '10:30p', '11:00p'];
    for (let i = 0; i < 4; i++) {
      const pShort = t.protein - totals[1];
      const kShort = t.kcal - totals[0];
      if (pShort <= 20 && kShort <= t.kcal * 0.12) break;
      const pool = pShort > 20 ? proteinSnacks : LIB.snack;
      meals.push({ time: times[i], slotId: 'topup' + i, name: i === 0 ? 'Top-up' : 'Top-up ' + (i + 1), ...pick(pool, date, 'topup' + i, t.mode) });
      totals = sum(meals);
    }

    return {
      date, targets: t, slot, weekend,
      kindLabel: weekend ? 'Weekend' : kind.label,
      meals,
      totals: { kcal: totals[0], protein: totals[1], fat: totals[2], carbs: totals[3] },
    };
  }

  function sum(meals) {
    return meals.reduce((acc, m) => {
      const v = m.m || [0, 0, 0, 0];
      const e = m.extraM || [0, 0, 0, 0];
      return [acc[0] + v[0] + e[0], acc[1] + v[1] + e[1], acc[2] + v[2] + e[2], acc[3] + v[3] + e[3]];
    }, [0, 0, 0, 0]);
  }

  return { targets, plan, swap, slotChoice, setSlotChoice };
})();
