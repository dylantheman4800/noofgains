/* NoofGains — photo body check-in.
   On-device visual record: front/side/back every 2 weeks, shot in-app with
   the previous photo ghosted over the camera for identical framing.
   Photos are AES-GCM-encrypted in IndexedDB behind a 4-digit PIN (PBKDF2,
   310k iters) — they never enter the camera roll, iCloud, localStorage, or
   the repo, and only ever leave the phone on an explicit Compare tap
   (Claude, his own key). Forgotten PIN = photos gone, by design. */
'use strict';

const Photos = (() => {
  const POSES = ['front', 'side', 'back'];
  const POSE_LABEL = { front: 'Front', side: 'Left side', back: 'Back' };
  const POSE_HINT = {
    front: 'Face the camera, arms relaxed at your sides',
    side: 'Turn 90° left, arms relaxed, look straight ahead',
    back: 'Turn away from the camera, arms relaxed',
  };
  const MAX_EDGE = 1280;      // long edge px — plenty for comparison, ~250KB/shot
  const JPEG_Q = 0.82;
  const PBKDF2_ITERS = 310000;
  const VERIFIER_TEXT = 'noofgains-vault-v1';

  /* ---------- IndexedDB ---------- */

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('noofgains-photos', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('shots');
          req.result.createObjectStore('meta');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function idbGet(store, key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(store, key, val) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(val, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbKeys(store) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(store).objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- crypto ---------- */

  let sessionKey = null; // AES key lives here after unlock — once per app session

  async function deriveKey(pin, salt) {
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function encrypt(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv, data };
  }

  async function decrypt(key, rec) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.data);
  }

  async function hasVault() {
    return !!(await idbGet('meta', 'salt'));
  }

  async function createVault(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pin, salt);
    const verifier = await encrypt(key, new TextEncoder().encode(VERIFIER_TEXT));
    await idbPut('meta', 'salt', salt);
    await idbPut('meta', 'verifier', verifier);
    await idbPut('meta', 'attempts', { fails: 0, lockUntil: 0 });
    sessionKey = key;
  }

  /* Wrong guesses back off hard: 3 free tries, then 30s doubling to 15 min.
     Stops in-app brute force cold; a 4-digit PIN is a snoop lock, not Fort Knox. */
  async function tryUnlock(pin) {
    const att = (await idbGet('meta', 'attempts')) || { fails: 0, lockUntil: 0 };
    if (att.lockUntil > Date.now()) return { ok: false, lockedFor: Math.ceil((att.lockUntil - Date.now()) / 1000) };
    const salt = await idbGet('meta', 'salt');
    const key = await deriveKey(pin, salt);
    try {
      const plain = await decrypt(key, await idbGet('meta', 'verifier'));
      if (new TextDecoder().decode(plain) !== VERIFIER_TEXT) throw new Error('bad');
      await idbPut('meta', 'attempts', { fails: 0, lockUntil: 0 });
      sessionKey = key;
      return { ok: true };
    } catch {
      const fails = att.fails + 1;
      const lockUntil = fails >= 3 ? Date.now() + Math.min(30000 * Math.pow(2, fails - 3), 900000) : 0;
      await idbPut('meta', 'attempts', { fails, lockUntil });
      return { ok: false, fails, lockedFor: lockUntil ? Math.ceil((lockUntil - Date.now()) / 1000) : 0 };
    }
  }

  /* ---------- shots ---------- */

  async function saveShot(date, pose, blob) {
    const rec = await encrypt(sessionKey, await blob.arrayBuffer());
    await idbPut('shots', `${date}:${pose}`, rec);
  }

  async function shotBlob(date, pose) {
    const rec = await idbGet('shots', `${date}:${pose}`);
    if (!rec || !sessionKey) return null;
    try {
      return new Blob([await decrypt(sessionKey, rec)], { type: 'image/jpeg' });
    } catch { return null; }
  }

  async function shotB64(date, pose) {
    const b = await shotBlob(date, pose);
    if (!b) return null;
    const bytes = new Uint8Array(await b.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const checkins = () => (Store.get().photos || { checkins: [] }).checkins;

  function skipWeek(date = Store.todayStr()) {
    const start = Store.weekBounds(new Date(date + 'T12:00:00')).start;
    Store.update((s) => { if (!s.photos.skips.includes(start)) s.photos.skips.push(start); });
  }

  /* ---------- backup (encrypted blobs travel as-is — same PIN opens them) ---------- */

  const b64 = (buf) => {
    const bytes = new Uint8Array(buf.buffer || buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function exportVault() {
    if (!(await hasVault())) return null;
    const salt = await idbGet('meta', 'salt');
    const verifier = await idbGet('meta', 'verifier');
    const shots = [];
    for (const key of await idbKeys('shots')) {
      const rec = await idbGet('shots', key);
      shots.push({ key, iv: b64(rec.iv), data: b64(rec.data) });
    }
    return { salt: b64(salt), verifier: { iv: b64(verifier.iv), data: b64(verifier.data) }, shots };
  }

  async function importVault(v) {
    await idbPut('meta', 'salt', unb64(v.salt));
    await idbPut('meta', 'verifier', { iv: unb64(v.verifier.iv), data: unb64(v.verifier.data).buffer });
    await idbPut('meta', 'attempts', { fails: 0, lockUntil: 0 });
    for (const s of v.shots) await idbPut('shots', s.key, { iv: unb64(s.iv), data: unb64(s.data).buffer });
    sessionKey = null; // re-derive from PIN on next unlock
  }

  /* ---------- overlay shell ---------- */

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const buzz = (ms = 12) => { if (navigator.vibrate) navigator.vibrate(ms); };

  let overlay = null;
  function openOverlay(html) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'photos-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = html;
    overlay.classList.add('open');
  }
  function closeOverlay() {
    stopCamera();
    if (overlay) { overlay.classList.remove('open'); overlay.innerHTML = ''; }
  }

  /* ---------- PIN pad ---------- */

  function pinPadHTML(title, sub) {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    return `
      <div class="ph-screen ph-pin">
        <button class="ph-close pressable" data-ph-close>✕</button>
        <div class="ph-pin-body">
          <div class="ph-pin-title">${title}</div>
          <div class="ph-pin-sub" id="ph-pin-sub">${sub}</div>
          <div class="ph-dots" id="ph-dots">${'<i></i>'.repeat(4)}</div>
          <div class="ph-pad">
            ${keys.map((k) => (k === '' ? '<span></span>'
              : `<button class="pressable" data-ph-key="${k}">${k}</button>`)).join('')}
          </div>
        </div>
      </div>`;
  }

  /* Gate: ensures a vault exists and is unlocked, then calls onOk. */
  function openGate(onOk) {
    if (sessionKey) { onOk(); return; }
    hasVault().then((exists) => (exists ? paintUnlock(onOk) : paintSetup(onOk)));
  }

  function wirePad(onDigit, onBack) {
    $$('#photos-overlay [data-ph-key]').forEach((b) => b.addEventListener('click', () => {
      buzz(8);
      if (b.dataset.phKey === '⌫') onBack();
      else onDigit(b.dataset.phKey);
    }));
    $('#photos-overlay [data-ph-close]').addEventListener('click', () => { buzz(6); closeOverlay(); });
  }

  function paintDots(n, cls = '') {
    const d = $('#ph-dots');
    d.className = 'ph-dots ' + cls;
    $$('#ph-dots i').forEach((el, i) => el.classList.toggle('on', i < n));
  }

  function paintSetup(onOk) {
    openOverlay(pinPadHTML('Set a PIN', 'Locks your photos on this phone. Forget it and they’re gone — no recovery.'));
    let first = null, cur = '';
    wirePad(async (k) => {
      if (cur.length >= 4) return;
      cur += k;
      paintDots(cur.length);
      if (cur.length < 4) return;
      if (first === null) {
        first = cur; cur = '';
        setTimeout(() => { $('#ph-pin-sub').textContent = 'Enter it again to confirm'; paintDots(0); }, 220);
      } else if (cur === first) {
        paintDots(4, 'ok');
        await createVault(cur);
        setTimeout(() => onOk(), 300);
      } else {
        paintDots(4, 'err');
        buzz(60);
        first = null; cur = '';
        setTimeout(() => { $('#ph-pin-sub').textContent = 'Didn’t match — start over'; paintDots(0); }, 450);
      }
    }, () => { cur = cur.slice(0, -1); paintDots(cur.length); });
  }

  function paintUnlock(onOk) {
    openOverlay(pinPadHTML('Photos locked', 'Enter your PIN'));
    let cur = '', busy = false;
    idbGet('meta', 'attempts').then((att) => {
      if (att && att.lockUntil > Date.now()) {
        $('#ph-pin-sub').textContent = `Too many tries — wait ${Math.ceil((att.lockUntil - Date.now()) / 1000)}s`;
      }
    });
    wirePad(async (k) => {
      if (busy || cur.length >= 4) return;
      cur += k;
      paintDots(cur.length);
      if (cur.length < 4) return;
      busy = true;
      const res = await tryUnlock(cur);
      if (res.ok) {
        paintDots(4, 'ok');
        setTimeout(() => onOk(), 300);
      } else {
        paintDots(4, 'err');
        buzz(60);
        cur = '';
        setTimeout(() => {
          $('#ph-pin-sub').textContent = res.lockedFor
            ? `Too many tries — wait ${res.lockedFor}s`
            : 'Wrong PIN';
          paintDots(0);
          busy = false;
        }, 450);
      }
    }, () => { if (!busy) { cur = cur.slice(0, -1); paintDots(cur.length); } });
  }

  /* ---------- camera ---------- */

  let stream = null;
  function stopCamera() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  /* Full check-in: 3 poses, ghost-aligned, countdown, review each shot. */
  function openCheckin(onDone) {
    openGate(() => runCheckin(onDone));
  }

  async function runCheckin(onDone) {
    const date = Store.todayStr();
    const prev = checkins().filter((c) => c.date < date).slice(-1)[0] || null;
    const captured = {}; // pose → blob
    let poseIdx = 0;

    openOverlay(`
      <div class="ph-screen ph-cam">
        <video id="ph-video" autoplay playsinline muted></video>
        <img id="ph-ghost" alt="" />
        <div class="ph-guides" id="ph-guides"><i class="h1"></i><i class="h2"></i><i class="v"></i></div>
        <div class="ph-cam-top">
          <button class="ph-close pressable" data-ph-close>✕</button>
          <div class="ph-pose"><b id="ph-pose-name"></b><span id="ph-pose-step"></span></div>
        </div>
        <div class="ph-count" id="ph-count"></div>
        <div class="ph-cam-bottom" id="ph-cam-bottom">
          <div class="ph-hint" id="ph-hint"></div>
          <button class="btn-volt pressable" id="ph-shoot">Start 10s timer</button>
        </div>
        <div class="ph-review" id="ph-review">
          <img id="ph-review-img" alt="" />
          <div class="ph-review-btns">
            <button class="btn-ghost pressable" id="ph-retake">Retake</button>
            <button class="btn-volt pressable" id="ph-use">Use photo</button>
          </div>
        </div>
      </div>`);
    $('#photos-overlay [data-ph-close]').addEventListener('click', () => { closeOverlay(); });

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch {
      $('#ph-cam-bottom').innerHTML = '<div class="ph-hint">Camera blocked. Allow camera access for this site in iOS Settings → Safari, then try again.</div>';
      return;
    }
    const video = $('#ph-video');
    video.srcObject = stream;

    const ghostUrls = [];
    async function paintPose() {
      const pose = POSES[poseIdx];
      $('#ph-pose-name').textContent = POSE_LABEL[pose];
      $('#ph-pose-step').textContent = `${poseIdx + 1} of ${POSES.length}`;
      $('#ph-hint').textContent = POSE_HINT[pose];
      const ghost = $('#ph-ghost');
      ghost.src = '';
      ghost.style.display = 'none';
      $('#ph-guides').style.display = 'block';
      if (prev) {
        const b = await shotBlob(prev.date, pose);
        if (b) {
          const url = URL.createObjectURL(b);
          ghostUrls.push(url);
          ghost.src = url;
          ghost.style.display = 'block';
          $('#ph-guides').style.display = 'none';
          $('#ph-hint').textContent = `Line yourself up with your ${Plan.fmtD(prev.date)} outline`;
        }
      }
    }
    await paintPose();

    function capture() {
      const w = video.videoWidth, h = video.videoHeight;
      const scale = Math.min(MAX_EDGE / Math.max(w, h), 1);
      const cw = Math.round(w * scale), ch = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      // Mirror to match the preview — every session mirrors the same way,
      // so comparisons stay true.
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, cw, ch);
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_Q));
    }

    let reviewUrl = null;
    function showReview(blob) {
      reviewUrl = URL.createObjectURL(blob);
      $('#ph-review-img').src = reviewUrl;
      $('#ph-review').classList.add('open');
    }
    function hideReview() {
      $('#ph-review').classList.remove('open');
      if (reviewUrl) { URL.revokeObjectURL(reviewUrl); reviewUrl = null; }
    }

    $('#ph-shoot').addEventListener('click', () => {
      const btn = $('#ph-shoot');
      btn.disabled = true;
      let n = 10;
      const cd = $('#ph-count');
      cd.textContent = n;
      cd.classList.add('on');
      const tick = setInterval(async () => {
        if (!document.contains(cd)) { clearInterval(tick); return; } // overlay closed mid-countdown
        n -= 1;
        if (n > 0) { cd.textContent = n; buzz(n <= 3 ? 30 : 8); return; }
        clearInterval(tick);
        cd.classList.remove('on');
        cd.textContent = '';
        buzz(80);
        const blob = await capture();
        btn.disabled = false;
        showReview(blob);
        $('#ph-use').onclick = async () => {
          captured[POSES[poseIdx]] = blob;
          hideReview();
          buzz(14);
          poseIdx += 1;
          if (poseIdx < POSES.length) { await paintPose(); return; }
          // all three in the can — encrypt + record
          stopCamera();
          for (const p of POSES) await saveShot(date, p, captured[p]);
          Store.update((s) => {
            s.photos.checkins = s.photos.checkins.filter((c) => c.date !== date);
            s.photos.checkins.push({ date, poses: [...POSES] });
            s.photos.checkins.sort((a, b) => a.date.localeCompare(b.date));
          });
          ghostUrls.forEach((u) => URL.revokeObjectURL(u));
          showDone(date, prev, onDone);
        };
        $('#ph-retake').onclick = () => { hideReview(); buzz(8); };
      }, 1000);
    });
  }

  /* Post-save screen: proof it worked + the Compare offer (his key, his tap). */
  async function showDone(date, prev, onDone) {
    const key = Store.get().settings.anthropicKey;
    const thumbs = [];
    for (const p of POSES) {
      const b = await shotBlob(date, p);
      thumbs.push(b ? URL.createObjectURL(b) : null);
    }
    const canCompare = key && prev;
    openOverlay(`
      <div class="ph-screen ph-done">
        <button class="ph-close pressable" data-ph-close>✕</button>
        <div class="ph-done-body">
          <div class="cu-check"><svg viewBox="0 0 24 24" fill="none" stroke="var(--volt)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 10 18.5 20 6"/></svg></div>
          <h3>Check-in saved</h3>
          <p class="muted">${prev ? `Encrypted on-device. Next one in 2 weeks.` : 'Baseline locked in — every future check-in gets compared against today.'}</p>
          <div class="ph-thumb-row">${thumbs.map((u, i) => `<div class="ph-thumb">${u ? `<img src="${u}" alt="">` : ''}<span>${POSE_LABEL[POSES[i]]}</span></div>`).join('')}</div>
          <div id="ph-verdict"></div>
          ${canCompare
            ? '<button class="btn-volt pressable mt16" id="ph-compare">Compare with Claude →</button>'
            : (key ? '' : (prev ? '<p class="tiny mt16">Add your API key in More and the coach can read these.</p>' : ''))}
          <button class="btn-ghost pressable mt8" style="width:100%" data-ph-finish>Done</button>
        </div>
      </div>`);
    const finish = () => {
      $$('#photos-overlay .ph-thumb img').forEach((im) => URL.revokeObjectURL(im.src));
      closeOverlay();
      onDone && onDone();
    };
    $('#photos-overlay [data-ph-close]').addEventListener('click', finish);
    $('#photos-overlay [data-ph-finish]').addEventListener('click', finish);
    const cmp = $('#ph-compare');
    if (cmp) cmp.addEventListener('click', async () => {
      cmp.disabled = true;
      cmp.innerHTML = '<span class="spin"></span> Looking you over…';
      try {
        const text = await Coach.analyzePhotos(date);
        $('#ph-verdict').innerHTML = `<div class="coach-out mt16" style="text-align:left">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`;
        cmp.remove();
      } catch (e) {
        cmp.disabled = false;
        cmp.textContent = 'Compare with Claude →';
        $('#ph-verdict').innerHTML = `<p class="tiny mt12" style="color:var(--bad)">${e.message === 'bad-key' ? 'API key rejected — check it in More' : 'Compare failed: ' + e.message}</p>`;
      }
    });
  }

  /* ---------- gallery (Trends card) ---------- */

  let galleryUrls = [];
  let comparePose = 'front';
  let compareA = null; // date on the left; right pane is always the latest

  async function renderGallery(el, rerender) {
    galleryUrls.forEach((u) => URL.revokeObjectURL(u));
    galleryUrls = [];
    const cs = checkins();
    const vault = await hasVault();

    if (!cs.length) {
      el.innerHTML = `
        <div class="card-label">Photos</div>
        <p class="muted">Progress photos the scale can’t argue with — encrypted on this phone, ghost-aligned so every shot matches. Every 2 weeks, 3 shots, 60 seconds.</p>
        <button class="btn-volt pressable mt12" data-ph-start>${vault ? 'Take photos' : 'First check-in'}</button>`;
      $('[data-ph-start]', el).addEventListener('click', () => openCheckin(rerender));
      return;
    }

    if (!sessionKey) {
      el.innerHTML = `
        <div class="card-label">Photos</div>
        <div class="ph-locked">
          <div class="ph-lock-ico">🔒</div>
          <div>
            <div style="font-weight:600">${cs.length} check-in${cs.length === 1 ? '' : 's'}, encrypted</div>
            <div class="tiny">PIN unlocks them for this session</div>
          </div>
        </div>
        <button class="btn-ghost pressable mt12" style="width:100%" data-ph-unlock>Unlock</button>`;
      $('[data-ph-unlock]', el).addEventListener('click', () => openGate(() => { closeOverlay(); rerender(); }));
      return;
    }

    const latest = cs[cs.length - 1];
    if (!compareA || !cs.some((c) => c.date === compareA) || compareA === latest.date) {
      compareA = cs.length > 1 ? cs[0].date : null;
    }

    const paneImg = async (date) => {
      const b = await shotBlob(date, comparePose);
      if (!b) return '';
      const u = URL.createObjectURL(b);
      galleryUrls.push(u);
      return u;
    };

    const single = cs.length === 1;
    const [urlA, urlB] = await Promise.all([compareA ? paneImg(compareA) : '', paneImg(latest.date)]);
    const verdictOwner = [...cs].reverse().find((c) => c.verdict);
    const key = Store.get().settings.anthropicKey;

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="card-label" style="margin:0">Photos</div>
        <div class="range-seg">${POSES.map((p) => `<button class="pressable ${comparePose === p ? 'active' : ''}" data-ph-pose="${p}">${POSE_LABEL[p]}</button>`).join('')}</div>
      </div>
      <div class="ph-compare${single ? ' single' : ''}">
        ${single ? '' : `<div class="ph-pane"><img src="${urlA}" alt=""><span>${Plan.fmtD(compareA)}</span></div>`}
        <div class="ph-pane"><img src="${urlB}" alt=""><span>${Plan.fmtD(latest.date)}${single ? ' · baseline' : ''}</span></div>
      </div>
      ${cs.length > 2 ? `<div class="ph-strip">${cs.slice(0, -1).map((c) => `<button class="pressable ${c.date === compareA ? 'active' : ''}" data-ph-vs="${c.date}">${Plan.fmtD(c.date)}</button>`).join('')}</div>` : ''}
      ${verdictOwner ? `<div class="rx-note mt12">${verdictOwner.verdict.text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}<div class="coach-meta">Claude · ${Plan.fmtD(verdictOwner.verdict.date)}</div></div>` : ''}
      <div class="pill-row">
        ${key && !single && !latest.verdict ? '<button class="btn-ghost pressable" data-ph-run>Compare with Claude</button>' : ''}
        <button class="btn-ghost pressable" data-ph-new>New check-in</button>
        <button class="btn-ghost pressable" data-ph-lock>Lock</button>
      </div>`;

    $$('[data-ph-pose]', el).forEach((b) => b.addEventListener('click', () => { comparePose = b.dataset.phPose; buzz(6); rerender(); }));
    $$('[data-ph-vs]', el).forEach((b) => b.addEventListener('click', () => { compareA = b.dataset.phVs; buzz(6); rerender(); }));
    $('[data-ph-new]', el).addEventListener('click', () => openCheckin(rerender));
    $('[data-ph-lock]', el).addEventListener('click', () => { sessionKey = null; buzz(8); rerender(); });
    const run = $('[data-ph-run]', el);
    if (run) run.addEventListener('click', async () => {
      run.disabled = true;
      run.innerHTML = '<span class="spin" style="border-color:rgba(255,255,255,.25);border-top-color:var(--ink)"></span> Comparing…';
      try { await Coach.analyzePhotos(latest.date); rerender(); }
      catch (e) { run.disabled = false; run.textContent = 'Compare with Claude'; }
    });
  }

  return {
    openCheckin, renderGallery, skipWeek, checkins,
    hasVault, exportVault, importVault, shotB64,
    unlocked: () => !!sessionKey,
    poses: POSES,
  };
})();
