/*
 * Exam timetable solver (runs in a Web Worker in the browser, or in Node for tests).
 *
 * Model: every course gets one (day, slot). Fixed courses never move.
 * Cost = hard-constraint penalties (very large) + soft penalties:
 *   - two exams of the same student in the same slot (hard)
 *   - slot capacity overflow (hard)
 *   - student exams per day: dayPen[count] (count above maxPerDay is hard)
 *   - student exams on two consecutive calendar days (adjPen)
 *   - using an "extra" day (extraPen per student sitting an exam there)
 *   - slot load balance (balance * load^2 / 1000)
 * Greedy construction followed by simulated annealing.
 */
(function (root) {
  const HARD = 1e6;

  function solve(input, onProgress) {
    const { courses, nStudents, days, nSlots, fixed } = input;
    const cfg = Object.assign(
      { capacity: 0, dayPen: [0, 0, 1], maxPerDay: 1, adjPen: 0, extraPen: 0, balance: 0, iterations: 200000, seed: 12345 },
      input.config || {}
    );
    const D = days.length, S = nSlots, G = D * S, C = courses.length;

    // random generator (deterministic per seed)
    let rs = cfg.seed >>> 0 || 1;
    const rand = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };

    const P = new Float64Array(64);
    for (let c = 0; c < 64; c++) {
      if (c > cfg.maxPerDay) P[c] = HARD * (c - cfg.maxPerDay) + (cfg.dayPen[cfg.dayPen.length - 1] || 0);
      else P[c] = c < cfg.dayPen.length ? cfg.dayPen[c] : cfg.dayPen[cfg.dayPen.length - 1];
    }
    const adjNext = new Uint8Array(D); // 1 if day d and d+1 are consecutive calendar days
    for (let d = 0; d + 1 < D; d++) {
      const a = Date.parse(days[d].date), b = Date.parse(days[d + 1].date);
      adjNext[d] = Math.round((b - a) / 86400000) === 1 ? 1 : 0;
    }
    const extra = days.map(d => (d.extra ? 1 : 0));
    const cap = cfg.capacity > 0 ? cfg.capacity : Infinity;

    const occ = new Uint8Array(nStudents * G);
    const cnt = new Uint8Array(nStudents * D);
    const load = new Float64Array(G);
    const where = new Int32Array(C).fill(-1);
    const isFixed = new Uint8Array(C);
    const size = courses.map(c => c.students.length);

    const capCost = l => (l > cap ? HARD * (l - cap) : 0) + (cfg.balance * l * l) / 1000;

    function adjAround(base, d1, d2) {
      // adjacency pairs (left day index) touching d1 or d2
      let s = 0; const seen = [];
      for (const L of [d1 - 1, d1, d2 - 1, d2]) {
        if (L < 0 || L + 1 >= D || !adjNext[L] || seen.includes(L)) continue;
        seen.push(L);
        if (cnt[base + L] > 0 && cnt[base + L + 1] > 0) s++;
      }
      return s;
    }

    // cost change for moving course ci from g1 to g2 (g1 = -1 means not placed)
    function delta(ci, g1, g2) {
      if (g1 === g2) return 0;
      const n = size[ci];
      const d1 = g1 >= 0 ? (g1 / S) | 0 : -1, d2 = (g2 / S) | 0;
      let dl = capCost(load[g2] + n) - capCost(load[g2]);
      if (g1 >= 0) dl += capCost(load[g1] - n) - capCost(load[g1]);
      dl += cfg.extraPen * n * (extra[d2] - (d1 >= 0 ? extra[d1] : 0));
      const st = courses[ci].students;
      const useAdj = cfg.adjPen > 0 && d1 !== d2;
      for (let k = 0; k < st.length; k++) {
        const s = st[k], ob = s * G;
        if (occ[ob + g2] >= 1) dl += HARD;
        if (g1 >= 0 && occ[ob + g1] >= 2) dl -= HARD;
        if (d1 === d2) continue;
        const cb = s * D;
        const c2 = cnt[cb + d2];
        dl += P[c2 + 1] - P[c2];
        let c1 = 0;
        if (d1 >= 0) { c1 = cnt[cb + d1]; dl += P[c1 - 1] - P[c1]; }
        if (useAdj && (c2 === 0 || c1 === 1)) {
          const before = adjAround(cb, d1 < 0 ? d2 : d1, d2);
          if (d1 >= 0) cnt[cb + d1]--; cnt[cb + d2]++;
          const after = adjAround(cb, d1 < 0 ? d2 : d1, d2);
          if (d1 >= 0) cnt[cb + d1]++; cnt[cb + d2]--;
          dl += cfg.adjPen * (after - before);
        }
      }
      return dl;
    }

    function apply(ci, g2) {
      const g1 = where[ci], n = size[ci];
      const d1 = g1 >= 0 ? (g1 / S) | 0 : -1, d2 = (g2 / S) | 0;
      if (g1 >= 0) load[g1] -= n;
      load[g2] += n;
      const st = courses[ci].students;
      for (let k = 0; k < st.length; k++) {
        const s = st[k];
        if (g1 >= 0) { occ[s * G + g1]--; cnt[s * D + d1]--; }
        occ[s * G + g2]++; cnt[s * D + d2]++;
      }
      where[ci] = g2;
    }

    // ---- place fixed ----
    for (let ci = 0; ci < C; ci++) {
      const f = fixed[courses[ci].code];
      if (f) { isFixed[ci] = 1; apply(ci, f[0] * S + f[1]); }
    }
    // ---- greedy: hardest courses first ----
    const deg = new Float64Array(C);
    {
      const byStudent = new Map();
      courses.forEach((c, ci) => c.students.forEach(s => { if (!byStudent.has(s)) byStudent.set(s, []); byStudent.get(s).push(ci); }));
      for (const list of byStudent.values()) for (const ci of list) deg[ci] += list.length - 1;
    }
    const order = [...Array(C).keys()].filter(ci => !isFixed[ci]).sort((a, b) => deg[b] + size[b] - (deg[a] + size[a]));
    for (const ci of order) {
      let best = -1, bestD = Infinity;
      for (let g = 0; g < G; g++) {
        const dl = delta(ci, -1, g) + rand() * 1e-6;
        if (dl < bestD) { bestD = dl; best = g; }
      }
      apply(ci, best);
    }

    // ---- simulated annealing ----
    const movable = order;
    let cur = totalCost();
    let bestCost = cur, bestWhere = Int32Array.from(where);
    const iters = movable.length && G > 1 ? cfg.iterations : 0;
    const T0 = cfg.T0 || 200, T1 = 0.05;
    for (let it = 0; it < iters; it++) {
      const T = T0 * Math.pow(T1 / T0, it / iters);
      const a = movable[(rand() * movable.length) | 0];
      if (rand() < 0.7 || movable.length < 2) {
        const g2 = (rand() * G) | 0, g1 = where[a];
        if (g2 === g1) continue;
        const dl = delta(a, g1, g2);
        if (dl <= 0 || rand() < Math.exp(-dl / T)) { apply(a, g2); cur += dl; }
      } else {
        const b = movable[(rand() * movable.length) | 0];
        const ga = where[a], gb = where[b];
        if (a === b || ga === gb) continue;
        const d1 = delta(a, ga, gb); apply(a, gb);
        const d2 = delta(b, gb, ga);
        const dl = d1 + d2;
        if (dl <= 0 || rand() < Math.exp(-dl / T)) { apply(b, ga); cur += dl; }
        else apply(a, ga);
      }
      if (cur < bestCost - 1e-9) { bestCost = cur; bestWhere = Int32Array.from(where); }
      if (onProgress && it % 20000 === 0) onProgress(it / iters, bestCost);
    }
    const assignment = {};
    courses.forEach((c, ci) => { const g = bestWhere[ci]; assignment[c.code] = [(g / S) | 0, g % S]; });
    return { assignment, cost: bestCost };

    function totalCost() {
      let t = 0;
      for (let g = 0; g < G; g++) t += capCost(load[g]);
      for (let ci = 0; ci < C; ci++) t += cfg.extraPen * size[ci] * extra[(where[ci] / S) | 0];
      for (let s = 0; s < nStudents; s++) {
        for (let g = 0; g < G; g++) if (occ[s * G + g] > 1) t += HARD * (occ[s * G + g] - 1);
        for (let d = 0; d < D; d++) {
          t += P[cnt[s * D + d]];
          if (cfg.adjPen && d + 1 < D && adjNext[d] && cnt[s * D + d] && cnt[s * D + d + 1]) t += cfg.adjPen;
        }
      }
      return t;
    }
  }

  // Statistics for any assignment (used after solving and after manual edits)
  function evaluate(input, assignment) {
    const { courses, nStudents, days, nSlots } = input;
    const cap = input.config && input.config.capacity > 0 ? input.config.capacity : Infinity;
    const D = days.length, S = nSlots;
    const perStudent = Array.from({ length: nStudents }, () => []);
    const load = new Array(D * S).fill(0);
    for (const c of courses) {
      const a = assignment[c.code];
      if (!a) continue;
      load[a[0] * S + a[1]] += c.students.length;
      for (const s of c.students) perStudent[s].push({ code: c.code, d: a[0], s: a[1] });
    }
    const clashes = [], heavy = [], consecutive = [];
    const hist = {};
    for (let st = 0; st < nStudents; st++) {
      const ex = perStudent[st];
      const byDay = {};
      for (const e of ex) (byDay[e.d] = byDay[e.d] || []).push(e);
      const seen = {};
      for (const e of ex) {
        const k = e.d * S + e.s;
        if (seen[k]) clashes.push({ student: st, d: e.d, s: e.s, codes: [seen[k], e.code] });
        else seen[k] = e.code;
      }
      for (const d in byDay) {
        const n = byDay[d].length;
        hist[n] = (hist[n] || 0) + 1;
        if (n >= 2) heavy.push({ student: st, d: +d, codes: byDay[d].sort((x, y) => x.s - y.s).map(e => e.code), n });
        const nd = +d + 1;
        if (byDay[nd] && Math.round((Date.parse(days[nd].date) - Date.parse(days[d].date)) / 86400000) === 1) consecutive.push({ student: st, d: +d });
      }
    }
    const overCap = [];
    load.forEach((l, g) => { if (l > cap) overCap.push({ d: (g / S) | 0, s: g % S, load: l }); });
    return { load, clashes, heavy, consecutive, hist, overCap };
  }

  const api = { solve, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Solver = api;

  // Web Worker entry
  if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof importScripts === 'function') {
    self.onmessage = e => {
      try {
        const n = Math.max(1, (e.data.config && e.data.config.restarts) || 1);
        let best = null;
        for (let r = 0; r < n; r++) {
          const inp = Object.assign({}, e.data, { config: Object.assign({}, e.data.config, { seed: 12345 + r * 7919 }) });
          const res = solve(inp, (p, cost) => self.postMessage({ type: 'progress', p: (r + p) / n, cost }));
          if (!best || res.cost < best.cost) best = res;
        }
        self.postMessage({ type: 'done', result: best, stats: evaluate(e.data, best.assignment) });
      } catch (err) {
        self.postMessage({ type: 'error', message: String(err && err.stack || err) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : this);
