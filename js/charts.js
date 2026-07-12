/* NoofGains — hand-rolled SVG line chart.
   Mark specs: 2px line, recessive hairline grid, muted raw dots + volt 7-day
   average, subtle bulk/cut phase bands, tap targets larger than marks,
   value pill on tap. Text wears ink tokens, never series color. */
'use strict';

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  const fmtDay = (dstr) => {
    const d = new Date(dstr + 'T12:00:00');
    return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
  };

  /* opts: { entries:[{date,value}], avg:[{date,value}], phases:[{start,end,mode}],
             unit, height?, decimals? } */
  function line(container, opts) {
    container.innerHTML = '';
    const entries = opts.entries || [];
    if (entries.length === 0) {
      container.innerHTML = '<p class="muted" style="padding:24px 0;text-align:center">No entries yet.</p>';
      return;
    }

    const W = Math.max(container.clientWidth || 320, 280);
    const H = opts.height || 210;
    const pad = { t: 14, r: 12, b: 26, l: 38 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, style: 'display:block' }, container);

    const dates = entries.map((e) => e.date);
    const minT = new Date(dates[0] + 'T12:00:00').getTime();
    const maxT = new Date(dates[dates.length - 1] + 'T12:00:00').getTime();
    const spanT = Math.max(maxT - minT, 86400000);

    const vals = entries.map((e) => e.value).concat((opts.avg || []).map((a) => a.value));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const padV = Math.max((hi - lo) * 0.18, 1);
    lo -= padV; hi += padV;

    const x = (dstr) => pad.l + ((new Date(dstr + 'T12:00:00').getTime() - minT) / spanT) * iw;
    const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

    /* phase bands (subtle, labeled) */
    for (const ph of opts.phases || []) {
      const x1 = Math.max(x(ph.start), pad.l);
      const x2 = ph.end ? Math.min(x(ph.end), pad.l + iw) : pad.l + iw;
      if (x2 <= x1) continue;
      el('rect', {
        x: x1, y: pad.t, width: x2 - x1, height: ih,
        fill: ph.mode === 'bulk' ? 'rgba(47,134,194,0.07)' : 'rgba(126,160,0,0.07)',
      }, svg);
      const tx = el('text', {
        x: x1 + 6, y: pad.t + 12, fill: '#62666d',
        'font-size': '9.5', 'font-weight': '500', 'letter-spacing': '0.6',
      }, svg);
      tx.textContent = ph.mode.toUpperCase();
    }

    /* recessive grid: 3 horizontal hairlines + y labels in ink tokens */
    for (let i = 0; i <= 2; i++) {
      const v = lo + ((hi - lo) * i) / 2;
      const yy = y(v);
      el('line', { x1: pad.l, x2: pad.l + iw, y1: yy, y2: yy, stroke: '#1c1e21', 'stroke-width': 1 }, svg);
      const t = el('text', { x: pad.l - 7, y: yy + 3.5, fill: '#62666d', 'font-size': '10', 'text-anchor': 'end' }, svg);
      t.textContent = v.toFixed(opts.decimals != null ? opts.decimals : 0);
    }
    /* sparse x labels: first + last */
    const tx1 = el('text', { x: pad.l, y: H - 8, fill: '#62666d', 'font-size': '10' }, svg);
    tx1.textContent = fmtDay(dates[0]);
    const tx2 = el('text', { x: pad.l + iw, y: H - 8, fill: '#62666d', 'font-size': '10', 'text-anchor': 'end' }, svg);
    tx2.textContent = fmtDay(dates[dates.length - 1]);

    /* raw entries: muted dots connected by a whisper line */
    if (entries.length > 1) {
      el('path', {
        d: entries.map((e, i) => `${i ? 'L' : 'M'}${x(e.date).toFixed(1)},${y(e.value).toFixed(1)}`).join(''),
        fill: 'none', stroke: '#3a3d42', 'stroke-width': 1.2,
      }, svg);
    }
    entries.forEach((e) => el('circle', { cx: x(e.date), cy: y(e.value), r: 3, fill: '#8a8f98' }, svg));

    /* 7-day average: the hero line (volt), area fade beneath */
    const avg = (opts.avg || []).filter((a) => a.value != null);
    if (avg.length > 1) {
      const grad = el('linearGradient', { id: 'gfade' + H, x1: 0, y1: 0, x2: 0, y2: 1 }, el('defs', {}, svg));
      el('stop', { offset: '0%', 'stop-color': 'rgba(204,255,0,0.16)' }, grad);
      el('stop', { offset: '100%', 'stop-color': 'rgba(204,255,0,0)' }, grad);
      const lineD = avg.map((a, i) => `${i ? 'L' : 'M'}${x(a.date).toFixed(1)},${y(a.value).toFixed(1)}`).join('');
      el('path', {
        d: `${lineD}L${x(avg[avg.length - 1].date).toFixed(1)},${pad.t + ih}L${x(avg[0].date).toFixed(1)},${pad.t + ih}Z`,
        fill: `url(#gfade${H})`,
      }, svg);
      el('path', { d: lineD, fill: 'none', stroke: '#ccff00', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      /* glowing latest point */
      const lastA = avg[avg.length - 1];
      el('circle', { cx: x(lastA.date), cy: y(lastA.value), r: 8, fill: 'rgba(204,255,0,0.18)' }, svg);
      el('circle', { cx: x(lastA.date), cy: y(lastA.value), r: 4, fill: '#ccff00' }, svg);
    }

    /* tap layer: value pill on nearest entry (hit targets > marks) */
    const pill = el('g', { style: 'display:none;pointer-events:none' }, svg);
    const pillRect = el('rect', { rx: 7, height: 34, fill: '#18191a', stroke: '#34343a' }, pill);
    const pillT1 = el('text', { fill: '#f7f8f8', 'font-size': '12', 'font-weight': '600' }, pill);
    const pillT2 = el('text', { fill: '#8a8f98', 'font-size': '9.5' }, pill);
    const hitLine = el('line', { stroke: '#34343a', 'stroke-width': 1, style: 'display:none' }, svg);

    function showPill(e) {
      const px = x(e.date), py = y(e.value);
      const label = e.value.toFixed(1) + (opts.unit ? ' ' + opts.unit : '');
      const w = Math.max(label.length * 7 + 16, 58);
      let bx = px - w / 2;
      bx = Math.max(pad.l, Math.min(bx, pad.l + iw - w));
      const by = Math.max(2, py - 46);
      pillRect.setAttribute('x', bx); pillRect.setAttribute('y', by); pillRect.setAttribute('width', w);
      pillT1.setAttribute('x', bx + 8); pillT1.setAttribute('y', by + 15); pillT1.textContent = label;
      pillT2.setAttribute('x', bx + 8); pillT2.setAttribute('y', by + 27); pillT2.textContent = fmtDay(e.date);
      hitLine.setAttribute('x1', px); hitLine.setAttribute('x2', px);
      hitLine.setAttribute('y1', pad.t); hitLine.setAttribute('y2', pad.t + ih);
      hitLine.style.display = '';
      pill.style.display = '';
    }

    svg.addEventListener('pointerdown', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let best = null, bd = Infinity;
      for (const e of entries) {
        const d = Math.abs(x(e.date) - px);
        if (d < bd) { bd = d; best = e; }
      }
      if (best && bd < 40) showPill(best);
      else { pill.style.display = 'none'; hitLine.style.display = 'none'; }
    });
  }

  return { line };
})();
