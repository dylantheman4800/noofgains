/* NoofGains — sync client for Dylan's personal Cloudflare Worker.
   Inert until the sync token is pasted in More. Three jobs:
   1. Report which DATA items are still unanswered today (worker pushes at
      9pm ET iff something is missing — train pressure never triggers it).
   2. Pull step counts posted by the iPhone Shortcut and auto-answer.
   3. Pull Withings scale weigh-ins and log them (scale beats manual).
   4. Manage the Web Push subscription.
   Only booleans, dates, step counts, and scale readings ever leave the phone. */
'use strict';

const Sync = (() => {
  const WORKER_URL = 'https://noofgains.noofgains-dylan.workers.dev';
  const VAPID_PUBLIC = 'BIH6FIoOLOk-huawBHV5iubGwn1FdXc9Z2X6X1-ZEEmfGTdC3mhiiNy-5Qj_WMSMyszcZUIC51FoMJOIVDjhdlo';
  const LABELS = { weigh: 'weigh-in', sleep: 'sleep', food: 'food', steps: 'steps' };

  const token = () => Store.get().settings.syncToken || '';
  const enabled = () => !!token();

  async function api(path, opts = {}) {
    const res = await fetch(WORKER_URL + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token()}`, 'content-type': 'application/json', ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`sync-${res.status}`);
    return res.json();
  }

  /* ---------- daily state ping (debounced, deduped) ---------- */

  let stateTimer = null;
  let lastSent = '';

  function dataMissing() {
    return Plan.todayItems()
      .map((it) => LABELS[it.id])
      .filter(Boolean);
  }

  function scheduleStatePing() {
    if (!enabled()) return;
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      const payload = JSON.stringify({ date: Store.todayStr(), missing: dataMissing() });
      if (payload === lastSent) return;
      lastSent = payload;
      api('/state', { method: 'POST', body: payload }).catch(() => { lastSent = ''; }); // retry on next change
    }, 1500);
  }

  /* ---------- pull (Shortcut steps + Withings weigh-ins → here) ---------- */

  /* Ground truth wins: a posted count overwrites a from-memory yes/no, and a
     scale reading overwrites a hand-typed weight. Today's under-target step
     count stays an open question until 9pm — a late walk can still flip it.
     Past days resolve immediately. */
  async function pull() {
    if (!enabled()) return null;
    const today = Store.todayStr();
    const { steps, weights } = await api('/pull');
    let stepsApplied = null;
    let stepsDays = 0; // past-day backfills count too — the app announces them
    for (const [date, n] of Object.entries(steps || {})) {
      if (date > today || !isFinite(n)) continue;
      const c = Store.checkinOn(date) || {};
      if (c.steps === n) continue; // already applied
      Store.setCheckin(date, 'steps', n);
      stepsDays++;
      const hit = n >= Plan.stepsTarget;
      if (date < today || hit || new Date().getHours() >= 21) {
        Store.setCheckin(date, 'hitSteps', hit);
      }
      if (date === today) stepsApplied = n;
    }
    let weightApplied = null;
    let weightDays = 0;
    for (const [date, w] of Object.entries(weights || {})) {
      if (date > today || !w || !isFinite(w.lb)) continue;
      const cur = Store.get().bodyweight.find((b) => b.date === date);
      const fat = w.fat != null ? w.fat : (cur ? cur.bodyFat : undefined); // never erase a known fat%
      if (cur && cur.weight === w.lb && (cur.bodyFat != null ? cur.bodyFat : null) === (fat != null ? fat : null)) continue;
      Store.setBodyweight(date, w.lb, fat);
      weightDays++;
      if (date === today) weightApplied = w.lb;
    }
    return { steps: stepsApplied, weight: weightApplied, stepsDays, weightDays };
  }

  /* ---------- push subscription ---------- */

  function b64uToUint8(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  }

  async function subscription() {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function enablePush() {
    if (!('Notification' in window) || !('PushManager' in window)) throw new Error('This install can’t do push — open the home-screen app.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications denied — allow them in Settings.');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToUint8(VAPID_PUBLIC) });
    await api('/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    return sub;
  }

  async function disablePush() {
    const sub = await subscription();
    if (sub) await sub.unsubscribe();
    await api('/subscribe', { method: 'DELETE' });
  }

  const status = () => api('/status');
  const testPush = () => api('/test-push', { method: 'POST' });
  const withingsConnectUrl = () => `${WORKER_URL}/withings/connect?t=${encodeURIComponent(token())}`;

  return { enabled, scheduleStatePing, pull, subscription, enablePush, disablePush, status, testPush, withingsConnectUrl, workerUrl: WORKER_URL };
})();
