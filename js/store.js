/* NoofGains — data layer. Single JSON doc in localStorage. */
'use strict';

const Store = (() => {
  const KEY = 'noofgains.v1';

  const todayStr = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const uid = () => 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function seed() {
    const today = todayStr();
    return {
      version: 1,
      settings: {
        units: 'lb',
        weeklyGoal: 5,
        lastBackupAt: null,
        anthropicKey: '',
        syncToken: '',
        profile: { name: 'Noof', sex: 'M', heightIn: 69, birthdate: '2000-09-23' },
      },
      types: [
        { id: 'push',     name: 'Push',     kind: 'lift',     inRotation: true },
        { id: 'pull',     name: 'Pull',     kind: 'lift',     inRotation: true },
        { id: 'legs',     name: 'Legs',     kind: 'lift',     inRotation: true },
        { id: 'cardio',   name: 'Cardio',   kind: 'cardio',   inRotation: false },
        { id: 'recovery', name: 'Recovery', kind: 'recovery', inRotation: false },
      ],
      rotation: { order: ['push', 'pull', 'legs'], nextIndex: 0 },
      sessions: [],                                   // { id, date, typeId, advanced }
      bodyweight: [{ date: today, weight: 165, bodyFat: 18 }],
      checkins: [],                                   // { date, sleptWell?, ateHealthy? }
      modes: [{ startDate: today, mode: 'cut' }],
      coach: { lastInsight: null, dismissedFlagOn: null },
      plan: { goal: null },                           // goal: { type:'weight'|'bf', target, startDate, startWeight, startBf, mode }
      fuel: { swaps: {}, slotChoice: {} },            // swaps: { 'date|slotId': n }, slotChoice: { date: 'am'|'pm'|'off' }
      photos: { checkins: [], skips: [] },            // checkins: { date, poses, verdict? } — metadata only; images live encrypted in IndexedDB
      food: { days: [] },                             // { date, raw, items, totals, healthy, note, loggedAt, costUsd } — one per date
    };
  }

  let state = load();
  const listeners = new Set();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed();
      const parsed = JSON.parse(raw);
      // Shallow-merge new top-level keys added in later versions onto old saves.
      const base = seed();
      for (const k of Object.keys(base)) if (!(k in parsed)) parsed[k] = base[k];
      for (const k of Object.keys(base.settings)) if (!(k in parsed.settings)) parsed.settings[k] = base.settings[k];
      return parsed;
    } catch {
      return seed();
    }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
    listeners.forEach((fn) => fn(state));
  }

  /* ---------- sessions & rotation ---------- */

  function typeById(id) {
    return state.types.find((t) => t.id === id) || null;
  }

  function nextUpTypeId() {
    const { order, nextIndex } = state.rotation;
    if (!order.length) return null;
    return order[nextIndex % order.length];
  }

  function logSession(typeId, date = todayStr()) {
    const advanced = typeId === nextUpTypeId();
    state.sessions.push({ id: uid(), date, typeId, advanced });
    if (advanced) {
      state.rotation.nextIndex = (state.rotation.nextIndex + 1) % state.rotation.order.length;
    }
    save();
  }

  function removeSession(id) {
    const i = state.sessions.findIndex((s) => s.id === id);
    if (i === -1) return;
    const [s] = state.sessions.splice(i, 1);
    if (s.advanced && state.rotation.order.length) {
      const len = state.rotation.order.length;
      state.rotation.nextIndex = (state.rotation.nextIndex - 1 + len) % len;
    }
    save();
  }

  function sessionsOn(date) {
    return state.sessions.filter((s) => s.date === date);
  }

  /* Monday-start week containing `date` */
  function weekBounds(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dow = (d.getDay() + 6) % 7; // Mon=0
    const start = new Date(d);
    start.setDate(d.getDate() - dow);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: todayStr(start), end: todayStr(end) };
  }

  function weekStats(date = new Date()) {
    const { start, end } = weekBounds(date);
    const inWeek = state.sessions.filter((s) => s.date >= start && s.date <= end);
    const lifts = inWeek.filter((s) => (typeById(s.typeId) || {}).kind === 'lift').length;
    const cardio = inWeek.filter((s) => (typeById(s.typeId) || {}).kind === 'cardio').length;
    const recovery = inWeek.filter((s) => (typeById(s.typeId) || {}).kind === 'recovery').length;
    return { lifts, cardio, recovery, ringCount: lifts + cardio, goal: state.settings.weeklyGoal, start, end };
  }

  /* ---------- bodyweight ---------- */

  function setBodyweight(date, weight, bodyFat) {
    const entry = state.bodyweight.find((b) => b.date === date);
    if (entry) {
      entry.weight = weight;
      if (bodyFat != null) entry.bodyFat = bodyFat; else delete entry.bodyFat;
    } else {
      const e = { date, weight };
      if (bodyFat != null) e.bodyFat = bodyFat;
      state.bodyweight.push(e);
      state.bodyweight.sort((a, b) => a.date.localeCompare(b.date));
    }
    save();
  }

  function removeBodyweight(date) {
    state.bodyweight = state.bodyweight.filter((b) => b.date !== date);
    save();
  }

  function lastWeight() {
    return state.bodyweight.length ? state.bodyweight[state.bodyweight.length - 1] : null;
  }

  /* Average of entries in the 7 days ending at `date` (inclusive). */
  function rolling7Avg(date = todayStr()) {
    const end = new Date(date + 'T12:00:00');
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    const s = todayStr(start);
    const entries = state.bodyweight.filter((b) => b.date >= s && b.date <= date);
    if (!entries.length) return null;
    return entries.reduce((a, b) => a + b.weight, 0) / entries.length;
  }

  /* ---------- check-ins ---------- */

  function checkinOn(date) {
    return state.checkins.find((c) => c.date === date) || null;
  }

  function setCheckin(date, field, value) {
    let c = checkinOn(date);
    if (!c) {
      c = { date };
      state.checkins.push(c);
      state.checkins.sort((a, b) => a.date.localeCompare(b.date));
    }
    if (value === null) delete c[field]; else c[field] = value;
    save();
  }

  /* ---------- food log ---------- */

  function foodOn(date) {
    return state.food.days.find((f) => f.date === date) || null;
  }

  function setFood(date, rec) {
    const i = state.food.days.findIndex((f) => f.date === date);
    if (i === -1) {
      state.food.days.push(rec);
      state.food.days.sort((a, b) => a.date.localeCompare(b.date));
    } else {
      state.food.days[i] = rec; // re-log replaces the day
    }
    save();
  }

  function deleteFood(date) {
    state.food.days = state.food.days.filter((f) => f.date !== date);
    save();
  }

  /* ---------- modes ---------- */

  function currentMode(date = todayStr()) {
    const past = state.modes.filter((m) => m.startDate <= date);
    return past.length ? past[past.length - 1].mode : 'cut';
  }

  function setMode(mode) {
    const today = todayStr();
    const last = state.modes[state.modes.length - 1];
    if (last && last.startDate === today) last.mode = mode;
    else state.modes.push({ startDate: today, mode });
    save();
  }

  /* ---------- backup ---------- */

  function exportJSON() {
    state.settings.lastBackupAt = todayStr();
    save();
    return JSON.stringify(state, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text); // throws on garbage
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) {
      throw new Error('Not a NoofGains backup file');
    }
    // Backups from older versions predate newer slices — same merge as load().
    const base = seed();
    for (const k of Object.keys(base)) if (!(k in parsed)) parsed[k] = base[k];
    for (const k of Object.keys(base.settings)) if (!(k in parsed.settings)) parsed.settings[k] = base.settings[k];
    state = parsed;
    save();
  }

  /* ---------- misc ---------- */

  function update(fn) { fn(state); save(); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return {
    get: () => state,
    todayStr, uid, typeById, nextUpTypeId, logSession, removeSession, sessionsOn,
    weekBounds, weekStats, setBodyweight, removeBodyweight, lastWeight, rolling7Avg,
    checkinOn, setCheckin, foodOn, setFood, deleteFood, currentMode, setMode, exportJSON, importJSON, update, subscribe,
  };
})();
