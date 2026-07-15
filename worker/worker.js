/* NoofGains sync worker — Dylan's personal Cloudflare Worker.
   One user, one phone. Everything bearer-token-gated (AUTH secret binding).

   Bindings: KV (kv namespace), AUTH, VAPID_PUBLIC, VAPID_PRIVATE (secrets).

   Bindings (Withings): WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET (secrets).

   Routes (all require Authorization: Bearer <AUTH>):
     POST   /state      {date, missing:[...]} — app reports which DATA items are
                        still unanswered for the day (weigh-in/sleep/food/steps)
     POST   /steps      {date?, steps} — iOS Shortcuts posts the day's step count
     GET    /pull       → {steps:{date:count}, weights:{date:{lb,fat}}}, app
                        applies on open; freshens from Withings first
     POST   /subscribe  body = PushSubscription JSON from the app
     DELETE /subscribe
     GET    /status     → debug/UI: {sub, state, steps, withings} for today
     POST   /test-push  → send the 9pm-style push right now (e2e testing)
     POST   /withings/disconnect → drop stored Withings tokens

   Public routes (browser redirects — no bearer possible):
     GET /withings/connect?t=<AUTH>  → 302 to Withings authorize (state nonce in KV)
     GET /withings/callback          → code→token exchange, backfill pull, HTML "✓"

   Cron (0 1,2 * * *): both UTC candidates for 9pm America/New_York; the
   handler no-ops unless NY local hour is 21 (DST-proof). Pushes IF AND ONLY
   IF data is still missing: last /state ping minus steps already posted.
   No ping all day = everything missing. Train pressure never triggers a push
   (behavior, not data — per Dylan's spec). */
'use strict';

const DATA_ITEMS = ['weigh-in', 'sleep', 'food', 'steps'];
const ALLOWED_ORIGINS = ['https://dylantheman4800.github.io', 'http://localhost:8123', 'http://127.0.0.1:8123'];

/* ---------- small utils ---------- */

const enc = new TextEncoder();

function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64u(buf) {
  const b = new Uint8Array(buf);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function nyParts(now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now); // YYYY-MM-DD
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now), 10) % 24;
  return { date, hour };
}

function cors(origin) {
  const o = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (obj, status, hdrs) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', ...hdrs } });

/* ---------- Web Push: VAPID JWT (ES256) + RFC 8291 aes128gcm ---------- */

async function vapidJwt(endpoint, env) {
  const pub = b64uToBytes(env.VAPID_PUBLIC); // 0x04 || x || y
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:phaneuf.dylan@davidprotein.com',
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `${head}.${claims}.${bytesToB64u(sig)}`;
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

async function encryptPayload(sub, payload) {
  const uaPub = b64uToBytes(sub.keys.p256dh);        // 65B
  const authSecret = b64uToBytes(sub.keys.auth);     // 16B
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65B
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 0x02 = last-record pad delimiter
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plain));

  // aes128gcm body header: salt(16) | rs(4) | idlen(1) | keyid(=as public, 65)
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
}

async function sendPush(env, payloadObj) {
  const raw = await env.KV.get('sub');
  if (!raw) return { ok: false, reason: 'no-subscription' };
  const sub = JSON.parse(raw);
  const body = await encryptPayload(sub, JSON.stringify(payloadObj));
  const jwt = await vapidJwt(sub.endpoint, env);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
    },
    body,
  });
  if (res.status === 404 || res.status === 410) {
    await env.KV.delete('sub'); // phone unsubscribed / install gone
    return { ok: false, reason: `gone-${res.status}` };
  }
  return { ok: res.ok, status: res.status, detail: res.ok ? undefined : (await res.text()).slice(0, 300) };
}

/* ---------- Withings scale (OAuth2 + weight pull) ---------- */

const WITHINGS_AUTHORIZE = 'https://account.withings.com/oauth2_user/authorize2';
const WITHINGS_API = 'https://wbsapi.withings.net';

/* Withings wraps everything in {status, body}; status 0 = ok. */
async function withingsPost(path, params, accessToken) {
  const res = await fetch(WITHINGS_API + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => null);
  if (!data || data.status !== 0) throw new Error(`withings-${data ? data.status : res.status}`);
  return data.body;
}

async function saveTokens(env, b) {
  await env.KV.put('withings:tokens', JSON.stringify({
    access: b.access_token,
    refresh: b.refresh_token,
    exp: Math.floor(Date.now() / 1000) + (b.expires_in || 10800) - 120,
  }));
}

/* Withings rotates the refresh token on every use — always persist the new pair. */
async function withingsAccess(env) {
  const raw = await env.KV.get('withings:tokens');
  if (!raw) return null;
  const t = JSON.parse(raw);
  if (Math.floor(Date.now() / 1000) < t.exp) return t.access;
  try {
    const b = await withingsPost('/v2/oauth2', {
      action: 'requesttoken', grant_type: 'refresh_token',
      client_id: env.WITHINGS_CLIENT_ID, client_secret: env.WITHINGS_CLIENT_SECRET,
      refresh_token: t.refresh,
    });
    await saveTokens(env, b);
    return b.access_token;
  } catch (e) {
    // Dead refresh token = disconnected; clear so /status shows it honestly.
    if (/withings-(100|101|102|200|401)/.test(String(e.message))) await env.KV.delete('withings:tokens');
    throw e;
  }
}

/* Pull new weigh-ins since the last sync. First reading of the day wins
   (morning fasted beats a late-day re-weigh); fat % rides along when sent.
   meastype 1 = weight (kg), 6 = fat ratio (%). Real value = value*10^unit. */
async function fetchWeights(env) {
  const access = await withingsAccess(env);
  if (!access) return { connected: false };
  const since = (await env.KV.get('withings:lastupdate')) || '0';
  const b = await withingsPost('/measure', {
    action: 'getmeas', meastypes: '1,6', category: '1', lastupdate: since,
  }, access);
  let applied = 0;
  for (const g of (b.measuregrps || []).slice().sort((x, y) => x.date - y.date)) {
    const vals = {};
    for (const m of g.measures || []) vals[m.type] = m.value * Math.pow(10, m.unit);
    if (vals[1] == null) continue;
    const date = nyParts(new Date(g.date * 1000)).date;
    const key = `weight:${date}`;
    const prev = JSON.parse((await env.KV.get(key)) || 'null');
    if (prev && prev.t <= g.date) continue; // keep the earlier (morning) reading
    const entry = { lb: Math.round(vals[1] * 2.2046226218 * 10) / 10, t: g.date };
    if (vals[6] != null) entry.fat = Math.round(vals[6] * 10) / 10;
    else if (prev && prev.fat != null) entry.fat = prev.fat;
    await env.KV.put(key, JSON.stringify(entry), { expirationTtl: 60 * 86400 });
    applied++;
  }
  if (b.updatetime) await env.KV.put('withings:lastupdate', String(b.updatetime));
  return { connected: true, applied };
}

/* ---------- the 9pm decision ---------- */

async function missingNow(env, date) {
  const stateRaw = await env.KV.get(`state:${date}`);
  let missing = stateRaw ? JSON.parse(stateRaw) : DATA_ITEMS.slice(); // silent day = everything outstanding
  const steps = await env.KV.get(`steps:${date}`);
  if (steps != null) missing = missing.filter((m) => m !== 'steps'); // count arrived — data exists
  const weight = await env.KV.get(`weight:${date}`);
  if (weight != null) missing = missing.filter((m) => m !== 'weigh-in'); // scale reading = weighed in
  return missing;
}

async function nightlyCheck(env, force) {
  const { date, hour } = nyParts();
  if (!force && hour !== 21) return { skipped: `NY hour ${hour}` };
  await fetchWeights(env).catch(() => {}); // freshen so a scale weigh-in never draws a false push
  const missing = await missingNow(env, date);
  if (!missing.length) return { push: false, missing };
  const result = await sendPush(env, {
    title: 'NoofGains',
    body: missing.length === DATA_ITEMS.length
      ? 'Nothing logged today. The plan is blind without you.'
      : `Still open today: ${missing.join(', ')}.`,
  });
  return { push: true, missing, result };
}

/* ---------- router ---------- */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const ch = cors(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });

    // Withings OAuth — public routes by necessity (browser navigation/redirect,
    // no bearer header possible). Connect is gated by ?t=AUTH, callback by the
    // single-use state nonce.
    if (url.pathname === '/withings/connect') {
      if (url.searchParams.get('t') !== env.AUTH) return json({ error: 'unauthorized' }, 401, ch);
      const nonce = bytesToB64u(crypto.getRandomValues(new Uint8Array(16)));
      await env.KV.put('withings:nonce', nonce, { expirationTtl: 600 });
      const p = new URLSearchParams({
        response_type: 'code', client_id: env.WITHINGS_CLIENT_ID, scope: 'user.metrics',
        redirect_uri: `${url.origin}/withings/callback`, state: nonce,
      });
      return Response.redirect(`${WITHINGS_AUTHORIZE}?${p}`, 302);
    }

    if (url.pathname === '/withings/callback') {
      const page = (body) => new Response(
        `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,system-ui,sans-serif;background:#08090a;color:#f7f8f8;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;padding:24px;max-width:340px">${body}</div>`,
        { headers: { 'content-type': 'text/html;charset=utf-8' } });
      const code = url.searchParams.get('code');
      if (!code) return page('NoofGains: Withings callback ready.'); // dev-portal URL test / stray visit
      const nonce = await env.KV.get('withings:nonce');
      if (!nonce || url.searchParams.get('state') !== nonce) {
        return page('<h2 style="margin:0 0 8px">Stale link</h2><p style="color:#8a8f98">Start again from NoofGains → More → Link scale.</p>');
      }
      await env.KV.delete('withings:nonce'); // single use
      try {
        const b = await withingsPost('/v2/oauth2', {
          action: 'requesttoken', grant_type: 'authorization_code',
          client_id: env.WITHINGS_CLIENT_ID, client_secret: env.WITHINGS_CLIENT_SECRET,
          code, redirect_uri: `${url.origin}/withings/callback`,
        });
        await saveTokens(env, b);
        const r = await fetchWeights(env).catch(() => null);
        return page(`<h2 style="color:#ccff00;margin:0 0 8px">Scale connected ✓</h2><p style="color:#8a8f98">${r && r.applied ? `${r.applied} weigh-in${r.applied === 1 ? '' : 's'} pulled.` : 'Weigh-ins will sync automatically.'}<br>Close this and open NoofGains.</p>`);
      } catch (e) {
        return page(`<h2 style="margin:0 0 8px">Connection failed</h2><p style="color:#8a8f98">${String(e.message)} — try again from NoofGains.</p>`);
      }
    }

    const auth = req.headers.get('Authorization') || '';
    if (auth !== `Bearer ${env.AUTH}`) return json({ error: 'unauthorized' }, 401, ch);

    const { date: today } = nyParts();

    if (req.method === 'POST' && url.pathname === '/state') {
      const b = await req.json().catch(() => null);
      if (!b || !b.date || !Array.isArray(b.missing)) return json({ error: 'bad-body' }, 400, ch);
      await env.KV.put(`state:${b.date}`, JSON.stringify(b.missing.slice(0, 8)), { expirationTtl: 7 * 86400 });
      return json({ ok: true }, 200, ch);
    }

    if (req.method === 'POST' && url.pathname === '/steps') {
      const b = await req.json().catch(() => null);
      // Tolerant of Shortcuts quirks: capitalized key, string numbers, decimals.
      const rawSteps = b && (b.steps != null ? b.steps : b.Steps);
      const n = Math.round(parseFloat(rawSteps));
      if (!isFinite(n) || n < 0 || n > 200000) return json({ error: 'bad-steps' }, 400, ch);
      const date = b.date || today;
      await env.KV.put(`steps:${date}`, String(n), { expirationTtl: 7 * 86400 });
      return json({ ok: true, date, steps: n }, 200, ch);
    }

    if (req.method === 'GET' && url.pathname === '/pull') {
      await fetchWeights(env).catch(() => {}); // best-effort freshen; stale beats broken
      const out = {};
      const list = await env.KV.list({ prefix: 'steps:' });
      for (const k of list.keys) {
        const v = await env.KV.get(k.name);
        if (v != null) out[k.name.slice(6)] = parseInt(v, 10);
      }
      const weights = {};
      const wlist = await env.KV.list({ prefix: 'weight:' });
      for (const k of wlist.keys) {
        const v = JSON.parse((await env.KV.get(k.name)) || 'null');
        if (v && isFinite(v.lb)) weights[k.name.slice(7)] = { lb: v.lb, fat: v.fat != null ? v.fat : null };
      }
      return json({ steps: out, weights }, 200, ch);
    }

    if (req.method === 'POST' && url.pathname === '/subscribe') {
      const b = await req.json().catch(() => null);
      if (!b || !b.endpoint || !b.keys) return json({ error: 'bad-subscription' }, 400, ch);
      await env.KV.put('sub', JSON.stringify(b));
      return json({ ok: true }, 200, ch);
    }

    if (req.method === 'DELETE' && url.pathname === '/subscribe') {
      await env.KV.delete('sub');
      return json({ ok: true }, 200, ch);
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      return json({
        sub: !!(await env.KV.get('sub')),
        date: today,
        state: JSON.parse((await env.KV.get(`state:${today}`)) || 'null'),
        steps: await env.KV.get(`steps:${today}`),
        withings: !!(await env.KV.get('withings:tokens')),
        weightToday: JSON.parse((await env.KV.get(`weight:${today}`)) || 'null'),
        wouldPushFor: await missingNow(env, today),
      }, 200, ch);
    }

    if (req.method === 'POST' && url.pathname === '/withings/disconnect') {
      await env.KV.delete('withings:tokens');
      await env.KV.delete('withings:lastupdate');
      return json({ ok: true }, 200, ch);
    }

    if (req.method === 'POST' && url.pathname === '/test-push') {
      return json(await nightlyCheck(env, true), 200, ch);
    }

    return json({ error: 'not-found' }, 404, ch);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(nightlyCheck(env, false));
  },
};
