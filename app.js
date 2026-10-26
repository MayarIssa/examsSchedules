/* NMU Exam Scheduler — UI logic. Everything runs in the browser; data is kept in localStorage. */
(function () {
  'use strict';
  const STORE = 'nmu-exam-scheduler-v1';
  const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normCode = s => String(s == null ? '' : s).toUpperCase().replace(/[\s_\-–]+/g, '');

  const DEFAULTS = {
    midterm: {
      start: '2026-11-07', end: '2026-11-12', weekdays: [6, 0, 1, 2, 3, 4], holidays: [], extraDays: ['2026-11-14'],
      slots: ['10:00-11:00', '11:30-12:30', '13:00-14:00', '14:30-15:30'],
      capacity: 0, maxPerDay: 4, adjPen: 0, pen2: 2, pen3: 100, pen4: 3000, extraPen: 20, excluded: '',
      iterations: 1000000, restarts: 4, balance: 0.05,
      fixed: [
        // University requirements (from the university schedule, 20-10-2026)
        { code: 'MGT101', date: '2026-11-07', slot: 2 }, { code: 'GEO217', date: '2026-11-07', slot: 3 },
        { code: 'LAN011', date: '2026-11-08', slot: 3 }, { code: 'LAN112', date: '2026-11-09', slot: 2 },
        { code: 'MGT102', date: '2026-11-09', slot: 3 }, { code: 'ALD123', date: '2026-11-10', slot: 2 },
        { code: 'LAN114', date: '2026-11-10', slot: 3 }, { code: 'PSC101', date: '2026-11-11', slot: 3 },
        { code: 'ECO205', date: '2026-11-12', slot: 2 }, { code: 'MGT301', date: '2026-11-12', slot: 3 },
        { code: 'SOC216', date: '2026-11-12', slot: 3 },
        // Shared with the Faculty of Engineering
        { code: 'MEC011', date: '2026-11-07', slot: 0 }, { code: 'ELE211', date: '2026-11-10', slot: 1 },
        { code: 'ELE212', date: '2026-11-09', slot: 1 }
      ]
    },
    final: {
      start: '2027-01-02', end: '2027-01-21', weekdays: [6, 0, 1, 2, 3, 4], holidays: ['2027-01-07'], extraDays: [],
      slots: ['10:00-12:00', '13:00-15:00'],
      capacity: 0, maxPerDay: 2, adjPen: 3, pen2: 1000, pen3: 1000000, pen4: 1000000, extraPen: 20, excluded: '',
      iterations: 300000, restarts: 4, balance: 0.05, fixed: []
    }
  };

  // ---------------- state ----------------
  let state = load();
  let mode = state.mode || 'midterm';
  let worker = null;

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE)); } catch (e) { /* ignore */ }
    s = s || {};
    s.cfg = s.cfg || {};
    for (const m of ['midterm', 'final']) s.cfg[m] = Object.assign(clone(DEFAULTS[m]), s.cfg[m] || {});
    s.results = s.results || {};
    return s;
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); }
    catch (e) {
      // enrollment may be too large for storage; keep settings at least
      try { const lite = Object.assign({}, state, { enr: null }); localStorage.setItem(STORE, JSON.stringify(lite)); } catch (e2) { /* ignore */ }
    }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  const cfg = () => state.cfg[mode];

  // ---------------- dates ----------------
  const parseISO = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const wdName = s => WD[new Date(parseISO(s)).getUTCDay()];
  const fmtDate = s => { const [y, m, d] = s.split('-'); return `${+d}/${+m}/${y}`; };
  function parseAnyDate(s) {
    s = String(s).trim();
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return iso(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if ((m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/.exec(s))) {
      let y = m[3] ? +m[3] : +cfg().start.slice(0, 4);
      if (y < 100) y += 2000;
      return iso(Date.UTC(y, +m[2] - 1, +m[1]));
    }
    return null;
  }
  const lines = s => String(s || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);

  function examDays(c) {
    const out = [];
    const a = parseISO(c.start), b = parseISO(c.end);
    const hol = new Set(c.holidays.map(parseAnyDate).filter(Boolean));
    if (!isNaN(a) && !isNaN(b) && b >= a && b - a < 400 * 864e5) {
      for (let t = a; t <= b; t += 864e5) {
        const d = iso(t);
        if (c.weekdays.includes(new Date(t).getUTCDay()) && !hol.has(d)) out.push({ date: d, extra: false });
      }
    }
    for (const e of c.extraDays) {
      const d = parseAnyDate(e);
      if (d && !out.some(x => x.date === d)) out.push({ date: d, extra: true });
    }
    return out.sort((x, y) => (x.date < y.date ? -1 : 1));
  }

  // ---------------- enrollment ----------------
  const COLS = {
    id: [/academic\s*id/i, /student\s*id/i, /^id$/i, /رقم/],
    code: [/course\s*code/i, /subject\s*code/i, /^code$/i, /^subject$/i, /كود/],
    title: [/course\s*title/i, /course\s*name/i, /subject\s*name/i, /title/i],
    name: [/student\s*name/i, /^name/i, /الاسم/, /name/i],
    program: [/program/i, /major/i, /department/i],
    level: [/level/i, /year/i]
  };
  let pendingRows = null;

  $('enrFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    $('enrInfo').textContent = 'Reading…';
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) throw new Error('The first sheet is empty.');
      pendingRows = { rows, fileName: f.name };
      showColMap(Object.keys(rows[0]));
    } catch (err) {
      $('enrInfo').innerHTML = `<span class="err">Could not read file: ${esc(err.message)}</span>`;
    }
    e.target.value = '';
  });

  function guess(headers, pats) {
    for (const p of pats) { const h = headers.find(h => p.test(h)); if (h) return h; }
    return '';
  }
  function showColMap(headers) {
    const box = $('colMap');
    const labels = { id: 'Student ID *', code: 'Course code *', title: 'Course title', name: 'Student name', program: 'Program', level: 'Level' };
    box.innerHTML = Object.keys(labels).map(k => {
      const g = guess(headers, COLS[k]);
      return `<label>${labels[k]}<select data-col="${k}"><option value="">—</option>${headers.map(h => `<option ${h === g ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`;
    }).join('') + '<button class="btn primary" id="useCols">Use this file</button>';
    box.classList.remove('hidden');
    $('enrInfo').textContent = `${pendingRows.fileName}: ${pendingRows.rows.length} rows. Check the columns, then press “Use this file”.`;
    $('useCols').onclick = () => {
      const map = {};
      box.querySelectorAll('select').forEach(s => (map[s.dataset.col] = s.value));
      if (!map.id || !map.code) { alert('Please choose the Student ID and Course code columns.'); return; }
      buildEnrollment(pendingRows.rows, map, pendingRows.fileName);
      box.classList.add('hidden');
    };
  }

  function buildEnrollment(rows, map, fileName) {
    const subType = Object.keys(rows[0]).find(h => /sub\s*type/i.test(h)); // old PUA format: keep lectures only
    const students = [], sIdx = new Map(), courses = {};
    let used = 0;
    for (const r of rows) {
      if (subType && String(r[subType]).trim() && String(r[subType]).trim().toUpperCase() !== 'LECT') continue;
      const id = String(r[map.id]).trim(), code = normCode(r[map.code]);
      if (!id || !code) continue;
      if (!sIdx.has(id)) {
        sIdx.set(id, students.length);
        students.push({ id, name: map.name ? String(r[map.name]).trim() : '', program: map.program ? String(r[map.program]).trim() : '', level: map.level ? String(r[map.level]).trim() : '' });
      }
      const c = courses[code] || (courses[code] = { title: '', students: [] });
      if (!c.title && map.title) c.title = String(r[map.title]).trim();
      const si = sIdx.get(id);
      if (!c.students.includes(si)) { c.students.push(si); used++; }
    }
    state.enr = { fileName, students, courses, loadedAt: new Date().toISOString() };
    state.results = {};
    save();
    renderAll();
  }

  function renderEnrInfo() {
    const e = state.enr;
    if (!e) { $('enrInfo').textContent = 'No file loaded.'; return; }
    const n = Object.keys(e.courses).length;
    $('enrInfo').innerHTML = `<b>${esc(e.fileName)}</b> — ${e.students.length} students, ${n} courses <span class="muted">(loaded ${new Date(e.loadedAt).toLocaleString()})</span>`;
    let dl = document.getElementById('codeList');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'codeList'; document.body.appendChild(dl); }
    dl.innerHTML = Object.keys(e.courses).sort().map(c => `<option value="${esc(c)}">${esc(e.courses[c].title)}</option>`).join('');
  }

  // ---------------- settings form ----------------
  const NUM_FIELDS = ['capacity', 'maxPerDay', 'adjPen', 'pen2', 'pen3', 'pen4', 'extraPen', 'iterations', 'restarts', 'balance'];
  function renderForm() {
    const c = cfg();
    $('start').value = c.start; $('end').value = c.end;
    $('holidays').value = c.holidays.join('\n');
    $('extraDays').value = c.extraDays.join('\n');
    $('slots').value = c.slots.join('\n');
    $('excluded').value = c.excluded;
    NUM_FIELDS.forEach(k => ($(k).value = c[k]));
    $('weekdays').innerHTML = [6, 0, 1, 2, 3, 4, 5].map(d =>
      `<label class="wd"><input type="checkbox" value="${d}" ${c.weekdays.includes(d) ? 'checked' : ''}>${WD[d].slice(0, 3)}</label>`).join('');
    renderDays();
  }
  function readForm() {
    const c = cfg();
    c.start = $('start').value; c.end = $('end').value;
    c.holidays = lines($('holidays').value);
    c.extraDays = lines($('extraDays').value);
    c.slots = $('slots').value.split('\n').map(s => s.trim()).filter(Boolean);
    c.excluded = $('excluded').value;
    NUM_FIELDS.forEach(k => { const v = parseFloat($(k).value); c[k] = isNaN(v) ? DEFAULTS[mode][k] : v; });
    c.weekdays = [...$('weekdays').querySelectorAll('input:checked')].map(i => +i.value);
    save();
  }
  function renderDays() {
    const days = examDays(cfg());
    $('dayList').innerHTML = days.length
      ? `<span class="muted" style="background:none">${days.length} exam days:</span>` + days.map(d => `<span class="${d.extra ? 'extra' : ''}">${WD[new Date(parseISO(d.date)).getUTCDay()].slice(0, 3)} ${fmtDate(d.date)}${d.extra ? ' (extra)' : ''}</span>`).join('')
      : '<span class="err">No exam days — check the dates.</span>';
  }
  document.querySelectorAll('section.card input, section.card textarea, section.card select').forEach(el => {
    if (el.closest('#fixedTbl') || el.closest('#results') || el.closest('#colMap') || el.type === 'file' || el.id === 'pasteFixed') return;
    el.addEventListener('change', () => { readForm(); renderDays(); renderFixed(); });
  });
  $('weekdays').addEventListener('change', () => { readForm(); renderDays(); renderFixed(); });

  // ---------------- fixed exams ----------------
  function slotLabel(i) { return cfg().slots[i] || `Slot ${i + 1}`; }
  function renderFixed() {
    const c = cfg(), days = examDays(c), e = state.enr;
    const tb = $('fixedTbl').querySelector('tbody');
    tb.innerHTML = c.fixed.map((f, i) => {
      const course = e && e.courses[normCode(f.code)];
      const inDays = days.some(d => d.date === f.date);
      const dayOpts = (inDays ? '' : `<option value="${esc(f.date)}" selected>${f.date ? fmtDate(f.date) + ' (not an exam day!)' : '— choose —'}</option>`) +
        days.map(d => `<option value="${d.date}" ${d.date === f.date ? 'selected' : ''}>${wdName(d.date)} ${fmtDate(d.date)}</option>`).join('');
      const slotOpts = c.slots.map((s, si) => `<option value="${si}" ${si === f.slot ? 'selected' : ''}>${esc(s)}</option>`).join('');
      const info = !f.code ? '' : course ? esc(course.title) : (e ? '<span class="muted">not in enrollment file — shown only</span>' : '');
      return `<tr data-i="${i}">
        <td class="code"><input list="codeList" value="${esc(f.code)}" data-k="code" placeholder="CODE"></td>
        <td>${info}</td><td>${course ? course.students.length : ''}</td>
        <td><select data-k="date">${dayOpts}</select></td>
        <td><select data-k="slot">${slotOpts}</select></td>
        <td><button class="icon-btn" data-del="${i}" title="Remove">×</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No fixed exams yet.</td></tr>';
  }
  $('fixedTbl').addEventListener('change', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const f = cfg().fixed[+tr.dataset.i], k = e.target.dataset.k;
    if (k === 'code') f.code = normCode(e.target.value);
    else if (k === 'date') f.date = e.target.value;
    else if (k === 'slot') f.slot = +e.target.value;
    save(); renderFixed();
  });
  $('fixedTbl').addEventListener('click', e => {
    const d = e.target.dataset.del; if (d == null) return;
    cfg().fixed.splice(+d, 1); save(); renderFixed();
  });
  $('addFixed').onclick = () => {
    const days = examDays(cfg());
    cfg().fixed.push({ code: '', date: days[0] ? days[0].date : '', slot: 0 });
    save(); renderFixed();
    const ins = $('fixedTbl').querySelectorAll('td.code input'); ins[ins.length - 1].focus();
  };
  $('pasteBtn').onclick = () => {
    const c = cfg(); let ok = 0; const bad = [];
    for (const raw of $('pasteFixed').value.split('\n')) {
      const line = raw.trim(); if (!line) continue;
      const parts = line.split(/[\s,;\t]+/).filter(Boolean);
      const dateTok = parts.find(p => parseAnyDate(p) && /[\/\-.]/.test(p));
      const timeTok = parts.find(p => /^\d{1,2}[:.]\d{2}/.test(p) && p !== dateTok);
      const codeParts = parts.slice(0, parts.indexOf(dateTok) >= 0 ? Math.min(parts.indexOf(dateTok), 2) : 2).filter(p => p !== timeTok);
      const code = normCode(codeParts.join(''));
      const slot = timeTok != null ? matchSlot(timeTok) : -1;
      if (!code || !dateTok || slot < 0) { bad.push(line); continue; }
      const date = parseAnyDate(dateTok);
      const ex = c.fixed.find(f => f.code === code);
      if (ex) { ex.date = date; ex.slot = slot; } else c.fixed.push({ code, date, slot });
      ok++;
    }
    save(); renderFixed();
    $('pasteMsg').innerHTML = `${ok} added.` + (bad.length ? ` <span class="err">Could not read: ${bad.map(esc).join(' | ')}</span>` : '');
    if (!bad.length) $('pasteFixed').value = '';
  };
  function matchSlot(t) {
    const m = /^(\d{1,2})[:.](\d{2})/.exec(t); if (!m) return -1;
    const mins = h => +h.split(':')[0] * 60 + +h.split(':')[1];
    const starts = cfg().slots.map(s => mins(s.split('-')[0].trim()));
    for (const h of [+m[1], +m[1] + 12]) { const i = starts.indexOf(h * 60 + +m[2]); if (i >= 0) return i; }
    return -1;
  }

  // ---------------- build solver input ----------------
  function buildInput() {
    const c = cfg(), e = state.enr, days = examDays(c);
    const errors = [], warnings = [];
    if (!e) errors.push('Upload the enrollment Excel file first.');
    if (!days.length) errors.push('There are no exam days. Check the first/last day and weekdays.');
    if (!c.slots.length) errors.push('Add at least one exam time.');
    if (errors.length) return { errors, warnings };
    const excluded = new Set(lines(c.excluded).map(normCode));
    const codes = Object.keys(e.courses).filter(k => !excluded.has(k)).sort();
    const courses = codes.map(code => ({ code, students: e.courses[code].students }));
    const fixed = {}, external = [];
    for (const f of c.fixed) {
      if (!f.code) continue;
      const d = days.findIndex(x => x.date === f.date);
      if (d < 0) { errors.push(`Fixed exam ${f.code}: ${f.date ? fmtDate(f.date) : 'no date'} is not one of the exam days.`); continue; }
      if (f.slot >= c.slots.length) { errors.push(`Fixed exam ${f.code}: time slot no longer exists.`); continue; }
      if (fixed[f.code]) warnings.push(`${f.code} is listed twice in fixed exams; the last one is used.`);
      if (e.courses[f.code] && !excluded.has(f.code)) fixed[f.code] = [d, f.slot];
      else external.push({ code: f.code, d, s: f.slot });
    }
    if (external.length) warnings.push(`Not in the enrollment file (shown on the grid but no students): ${external.map(x => x.code).join(', ')}`);
    const totalSlots = days.length * c.slots.length;
    if (courses.length > totalSlots * 20) warnings.push('Very few slots for the number of courses.');
    const dayPen = [0, 0, c.pen2, c.pen3, c.pen4];
    return {
      errors, warnings, external,
      input: {
        courses, nStudents: e.students.length, days, nSlots: c.slots.length, fixed,
        config: { capacity: c.capacity, dayPen, maxPerDay: Math.max(1, c.maxPerDay), adjPen: c.adjPen, extraPen: c.extraPen, balance: c.balance, iterations: c.iterations, restarts: Math.max(1, Math.min(10, c.restarts | 0)) }
      }
    };
  }

  // ---------------- run ----------------
  $('run').onclick = () => {
    readForm();
    const b = buildInput();
    showWarnings(b.errors, b.warnings);
    if (b.errors.length) return;
    if (worker) worker.terminate();
    worker = new Worker('solver.js');
    $('run').disabled = true; $('progress').classList.remove('hidden');
    $('runMsg').textContent = 'Working…';
    const t0 = Date.now();
    worker.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'progress') { $('progress').firstElementChild.style.width = Math.round(m.p * 100) + '%'; }
      else if (m.type === 'done') {
        finishRun();
        state.results[mode] = {
          assignment: m.result.assignment, generatedAt: new Date().toISOString(),
          days: b.input.days, slots: cfg().slots.slice(), external: b.external
        };
        save();
        $('runMsg').textContent = `Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`;
        renderResults();
        $('results').scrollIntoView({ behavior: 'smooth' });
      } else if (m.type === 'error') { finishRun(); $('runMsg').innerHTML = `<span class="err">${esc(m.message)}</span>`; }
    };
    worker.postMessage(b.input);
  };
  function finishRun() { $('run').disabled = false; $('progress').classList.add('hidden'); $('progress').firstElementChild.style.width = '0'; }
  function showWarnings(errs, warns) {
    $('warnings').innerHTML = errs.map(x => `<div class="err">${esc(x)}</div>`).join('') + warns.map(x => `<div class="warn">${esc(x)}</div>`).join('');
  }

  // ---------------- results ----------------
  function currentResult() {
    const r = state.results[mode];
    if (!r || !state.enr) return null;
    // stats are recomputed against the saved days/slots of this result
    const e = state.enr;
    const courses = Object.keys(r.assignment).filter(c => e.courses[c]).map(code => ({ code, students: e.courses[code].students }));
    const input = { courses, nStudents: e.students.length, days: r.days, nSlots: r.slots.length, config: { capacity: cfg().capacity } };
    return { r, input, stats: Solver.evaluate(input, r.assignment) };
  }

  function renderResults() {
    const cr = currentResult();
    if (!cr) { $('results').classList.add('hidden'); return; }
    $('results').classList.remove('hidden');
    const { r, input, stats } = cr, e = state.enr, S = r.slots.length;
    const fixedSet = new Set(cfg().fixed.map(f => f.code));
    $('genAt').textContent = 'Generated ' + new Date(r.generatedAt).toLocaleString() + (r.edited ? ' · edited by hand' : '');

    // summary
    const h = stats.hist, n2 = h[2] || 0, n3 = h[3] || 0, n4 = h[4] || 0;
    let n5 = 0; for (const k in h) if (+k >= 5) n5 += h[k];
    const usedExtra = r.days.filter((d, i) => d.extra && Object.values(r.assignment).some(a => a[0] === i));
    const isFinal = mode === 'final';
    const cards = [
      [Object.keys(r.assignment).length, 'courses scheduled', ''],
      [stats.clashes.length, 'same-time clashes', stats.clashes.length ? 'bad' : 'good'],
      [n2, 'students with 2 exams in a day', isFinal ? (n2 ? 'mid' : 'good') : ''],
      ...(isFinal ? [[stats.consecutive.length, 'exams on back-to-back days', '']] : [
        [n3, 'students with 3 exams in a day', n3 ? 'mid' : 'good'],
        [n4 + n5, 'students with 4+ exams in a day', n4 + n5 ? 'bad' : 'good']]),
      [stats.overCap.length, 'slots over seat limit', stats.overCap.length ? 'bad' : 'good'],
      ...(r.days.some(d => d.extra) ? [[usedExtra.length ? usedExtra.map(d => fmtDate(d.date)).join(', ') : 'No', 'extra day used', usedExtra.length ? 'mid' : 'good']] : [])
    ];
    $('summary').innerHTML = cards.map(([v, l, c]) => `<div class="stat ${c}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('') +
      (isFinal && n2 ? `<div class="warn" style="grid-column:1/-1">Some students have 2 finals on one day. This happens when there are more courses sharing students than exam days (see the list below). Add exam days or accept these cases.</div>` : '');

    // grid
    const cellCourses = {};
    for (const [code, [d, s]] of Object.entries(r.assignment)) (cellCourses[d * S + s] = cellCourses[d * S + s] || []).push({ code, n: e.courses[code] ? e.courses[code].students.length : 0, fixed: fixedSet.has(code) });
    for (const x of r.external || []) (cellCourses[x.d * S + x.s] = cellCourses[x.d * S + x.s] || []).push({ code: x.code, n: 0, ext: true });
    const cap = cfg().capacity;
    let html = `<tr><th></th>${r.slots.map(s => `<th>${esc(s)}</th>`).join('')}</tr>`;
    r.days.forEach((d, di) => {
      html += `<tr><th class="day">${wdName(d.date)}<small>${fmtDate(d.date)}${d.extra ? ' · extra' : ''}</small></th>`;
      for (let s = 0; s < S; s++) {
        const list = (cellCourses[di * S + s] || []).sort((a, b) => b.n - a.n);
        const ld = stats.load[di * S + s];
        html += `<td class="${d.extra ? 'extra' : ''}">${list.length ? `<div class="cell-load ${cap && ld > cap ? 'over' : ''}">${ld} students${cap ? ' / ' + cap : ''}</div>` : ''}` +
          list.map(c => `<span class="chip ${c.fixed ? 'fixed' : ''} ${c.ext ? 'ext' : ''}" title="${esc(e.courses[c.code] ? e.courses[c.code].title : 'external')}">${c.fixed || c.ext ? '🔒 ' : ''}${esc(c.code)} <small>${c.ext ? '' : c.n}</small></span>`).join('') + '</td>';
      }
      html += '</tr>';
    });
    $('gridTbl').innerHTML = html;

    renderCourseTable(cr, fixedSet);

    // heavy days
    const minHeavy = isFinal ? 2 : 3;
    const heavy = stats.heavy.filter(x => x.n >= minHeavy).sort((a, b) => b.n - a.n || a.d - b.d);
    $('heavyTitle').textContent = isFinal ? `Students with 2 finals on one day (${heavy.length})` : `Students with 3 or more exams on one day (${heavy.length})`;
    $('heavyTbl').innerHTML = heavy.length
      ? `<thead><tr><th>Student ID</th><th>Name</th><th>Day</th><th>Exams</th><th>Courses</th></tr></thead><tbody>` +
        heavy.map(x => { const st = e.students[x.student]; return `<tr><td>${esc(st.id)}</td><td>${esc(st.name)}</td><td>${wdName(r.days[x.d].date)} ${fmtDate(r.days[x.d].date)}</td><td><span class="badge b${Math.min(x.n, 4)}">${x.n}</span></td><td>${x.codes.map(esc).join(', ')}</td></tr>`; }).join('') + '</tbody>'
      : '<tbody><tr><td class="ok">None 🎉</td></tr></tbody>';
    if (stats.clashes.length) $('heavyTbl').innerHTML += `<tbody>${stats.clashes.map(x => `<tr><td colspan="5" class="err">Clash: student ${esc(e.students[x.student].id)} has ${x.codes.join(' and ')} at the same time (${fmtDate(r.days[x.d].date)} ${esc(r.slots[x.s])})</td></tr>`).join('')}</tbody>`;
    renderStudent();
  }

  function renderCourseTable(cr, fixedSet) {
    const { r } = cr, e = state.enr, q = $('courseFilter').value.trim().toUpperCase();
    const rows = Object.entries(r.assignment)
      .filter(([code]) => !q || code.includes(q) || (e.courses[code] && e.courses[code].title.toUpperCase().includes(q)))
      .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[0].localeCompare(b[0]));
    $('courseTbl').innerHTML = `<thead><tr><th>🔒</th><th>Code</th><th>Course</th><th>Students</th><th>Day</th><th>Time</th></tr></thead><tbody>` +
      rows.map(([code, [d, s]]) => `<tr data-code="${esc(code)}">
        <td><input type="checkbox" data-k="lock" ${fixedSet.has(code) ? 'checked' : ''} title="Keep fixed"></td>
        <td><b>${esc(code)}</b></td><td>${esc(e.courses[code] ? e.courses[code].title : '')}</td>
        <td>${e.courses[code] ? e.courses[code].students.length : ''}</td>
        <td><select data-k="d">${r.days.map((x, i) => `<option value="${i}" ${i === d ? 'selected' : ''}>${wdName(x.date).slice(0, 3)} ${fmtDate(x.date)}</option>`).join('')}</select></td>
        <td><select data-k="s">${r.slots.map((x, i) => `<option value="${i}" ${i === s ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td></tr>`).join('') + '</tbody>';
  }
  $('courseFilter').addEventListener('input', () => { const cr = currentResult(); if (cr) renderCourseTable(cr, new Set(cfg().fixed.map(f => f.code))); });
  $('courseTbl').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'), code = tr.dataset.code, r = state.results[mode], k = ev.target.dataset.k;
    const a = r.assignment[code];
    const c = cfg();
    if (k === 'd') a[0] = +ev.target.value;
    if (k === 's') a[1] = +ev.target.value;
    if (k === 'd' || k === 's') {
      r.edited = true;
      const f = c.fixed.find(f => f.code === code);
      if (f) { f.date = r.days[a[0]].date; f.slot = a[1]; }
    }
    if (k === 'lock') {
      if (ev.target.checked) { if (!c.fixed.some(f => f.code === code)) c.fixed.push({ code, date: r.days[a[0]].date, slot: a[1] }); }
      else c.fixed = c.fixed.filter(f => f.code !== code);
    }
    save(); renderFixed(); renderResults();
  });

  function renderStudent() {
    const q = $('studentSearch').value.trim().toLowerCase(), cr = currentResult(), out = $('studentOut');
    if (!q || !cr) { out.innerHTML = ''; return; }
    const e = state.enr, r = cr.r;
    const matches = e.students.map((s, i) => [s, i]).filter(([s]) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 10);
    out.innerHTML = matches.map(([s, i]) => {
      const ex = Object.entries(r.assignment).filter(([c]) => e.courses[c] && e.courses[c].students.includes(i)).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
      return `<div class="student-card"><b>${esc(s.id)}</b> ${esc(s.name)} <span class="muted">${esc(s.program)} ${esc(s.level)}</span>
        <table class="tbl">${ex.map(([c, [d, sl]]) => `<tr><td>${wdName(r.days[d].date)} ${fmtDate(r.days[d].date)}</td><td>${esc(r.slots[sl])}</td><td><b>${esc(c)}</b></td><td>${esc(e.courses[c].title)}</td></tr>`).join('')}</table></div>`;
    }).join('') || '<p class="muted">No student found.</p>';
  }
  $('studentSearch').addEventListener('input', renderStudent);

  // ---------------- export ----------------
  $('exportXlsx').onclick = () => {
    const cr = currentResult(); if (!cr) return;
    const { r, stats } = cr, e = state.enr, S = r.slots.length;
    const fixedSet = new Set(cfg().fixed.map(f => f.code));
    const label = mode === 'final' ? 'Final' : 'Midterm';
    const sched = Object.entries(r.assignment).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[0].localeCompare(b[0]))
      .map(([c, [d, s]]) => ({ Day: wdName(r.days[d].date), Date: fmtDate(r.days[d].date), Time: r.slots[s], 'Course Code': c, 'Course Title': e.courses[c] ? e.courses[c].title : '', Students: e.courses[c] ? e.courses[c].students.length : 0, Fixed: fixedSet.has(c) ? 'Yes' : '' }));
    for (const x of r.external || []) sched.push({ Day: wdName(r.days[x.d].date), Date: fmtDate(r.days[x.d].date), Time: r.slots[x.s], 'Course Code': x.code, 'Course Title': '(not in enrollment)', Students: 0, Fixed: 'Yes' });
    const grid = r.days.map((d, di) => {
      const row = { Day: wdName(d.date), Date: fmtDate(d.date) };
      r.slots.forEach((sl, s) => { row[sl] = Object.entries(r.assignment).filter(([, a]) => a[0] === di && a[1] === s).map(([c]) => c).join(', '); });
      return row;
    });
    const stud = [];
    e.students.forEach((st, i) => {
      Object.entries(r.assignment).filter(([c]) => e.courses[c] && e.courses[c].students.includes(i)).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1])
        .forEach(([c, [d, s]]) => stud.push({ 'Student ID': st.id, Name: st.name, Program: st.program, Level: st.level, 'Course Code': c, 'Course Title': e.courses[c].title, Day: wdName(r.days[d].date), Date: fmtDate(r.days[d].date), Time: r.slots[s] }));
    });
    const heavy = stats.heavy.sort((a, b) => b.n - a.n).map(x => ({ 'Student ID': e.students[x.student].id, Name: e.students[x.student].name, Date: fmtDate(r.days[x.d].date), Exams: x.n, Courses: x.codes.join(', ') }));
    const loads = [];
    r.days.forEach((d, di) => r.slots.forEach((sl, s) => loads.push({ Day: wdName(d.date), Date: fmtDate(d.date), Time: sl, Students: stats.load[di * S + s] })));
    const wb = XLSX.utils.book_new();
    const add = (rows, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'none' }]), name);
    add(sched, 'Schedule'); add(grid, 'By Day'); add(stud, 'Student Timetable'); add(heavy, 'Students 2+ per day'); add(loads, 'Slot Loads');
    XLSX.writeFile(wb, `${label}_Exam_Schedule.xlsx`);
  };
  $('printBtn').onclick = () => window.print();

  // ---------------- settings file ----------------
  $('exportCfg').onclick = () => {
    const blob = new Blob([JSON.stringify({ cfg: state.cfg }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'exam-scheduler-settings.json'; a.click();
  };
  $('importCfg').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      for (const m of ['midterm', 'final']) if (j.cfg && j.cfg[m]) state.cfg[m] = Object.assign(clone(DEFAULTS[m]), j.cfg[m]);
      save(); renderAll();
    } catch (err) { alert('Could not read settings file: ' + err.message); }
    ev.target.value = '';
  });
  $('resetCfg').onclick = () => {
    if (!confirm(`Reset all ${mode} settings and fixed exams to the defaults?`)) return;
    state.cfg[mode] = clone(DEFAULTS[mode]); delete state.results[mode]; save(); renderAll();
  };

  // ---------------- tabs ----------------
  $('tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    mode = state.mode = b.dataset.mode; save();
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
    showWarnings([], []); $('runMsg').textContent = '';
    renderAll();
  });

  function renderAll() {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x.dataset.mode === mode));
    renderEnrInfo(); renderForm(); renderFixed(); renderResults();
  }
  renderAll();
})();
