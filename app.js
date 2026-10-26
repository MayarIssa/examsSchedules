/* NMU Exam Scheduler — UI logic. Everything runs in the browser; data is kept in localStorage. */
(function () {
  'use strict';
  const STORE = 'nmu-exam-scheduler-v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normCode = s => String(s == null ? '' : s).toUpperCase().replace(/[\s_\-–]+/g, '');

  const DEFAULTS = {
    midterm: {
      start: '2026-11-07', end: '2026-11-12', weekdays: [6, 0, 1, 2, 3, 4], holidays: [], extraDays: ['2026-11-14'],
      slots: ['10:00-11:00', '11:30-12:30', '13:00-14:00', '14:30-15:30'],
      capacity: 0, maxPerDay: 4, adjPen: 0, pen2: 2, pen3: 100, pen4: 3000, extraPen: 20, excluded: '',
      iterations: 1000000, restarts: 4, balance: 0.05, rooms: defaultRooms(30, 25),
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
      start: '2027-01-02', end: '2027-01-21', weekdays: [6, 0, 1, 2, 3, 4], holidays: [], extraDays: [],
      slots: ['10:00-12:00', '13:00-15:00'],
      capacity: 0, maxPerDay: 2, adjPen: 20, pen2: 3000, pen3: 3000, pen4: 3000, extraPen: 20, excluded: '',
      iterations: 300000, restarts: 4, balance: 0.05, rooms: defaultRooms(30, 25), fixed: []
    }
  };

  // ---------------- state ----------------
  let state = load();
  let mode = state.mode || 'midterm';
  let worker = null;
  const typingRows = new Set(); // fixed-exam rows where the code is being typed instead of picked

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE)); } catch (e) { /* ignore */ }
    s = s || {};
    s.cfg = s.cfg || {};
    if (Array.isArray(s.rooms)) { for (const m of ['midterm', 'final']) if (s.cfg[m] && !s.cfg[m].rooms) s.cfg[m].rooms = clone(s.rooms); delete s.rooms; }
    for (const m of ['midterm', 'final']) s.cfg[m] = Object.assign(clone(DEFAULTS[m]), s.cfg[m] || {});
    s.results = s.results || {};
    s.extra = s.extra || [];
    s.order = Array.isArray(s.order) ? s.order : [];
    s.folded = s.folded || {};
    s.lang = s.lang === 'ar' ? 'ar' : 'en';
    s.theme = ['light', 'dark'].includes(s.theme) ? s.theme : 'auto';
    return s;
  }
  function defaultRooms(n, seats, name) { return Array.from({ length: n }, (_, i) => ({ name: (name || 'Room {n}').replace('{n}', i + 1), seats })); }
  const roomSeats = () => cfg().rooms.reduce((t, r) => t + (Math.max(0, +r.seats) || 0), 0);
  // seats per exam time = all rooms together (no rooms = no limit)
  const seatLimit = () => (cfg().rooms.length ? roomSeats() : 0);

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); }
    catch (e) {
      // enrollment may be too large for storage; keep settings at least
      try { const lite = Object.assign({}, state, { enr: null }); localStorage.setItem(STORE, JSON.stringify(lite)); } catch (e2) { /* ignore */ }
    }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  const cfg = () => state.cfg[mode];

  // ---------------- language ----------------
  function t(key, vars) {
    const d = window.I18N[state.lang], v = d[key] != null ? d[key] : window.I18N.en[key];
    if (typeof v !== 'string') return v == null ? key : v;
    return vars ? v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : v;
  }
  const examsLabel = n => (n === 1 ? t('exams.1') : n === 2 && state.lang === 'ar' ? t('exams.2') : t('exams.n', { n }));
  const tabName = m => t(m === 'final' ? 'tab.final' : 'tab.midterm');
  const locale = () => (state.lang === 'ar' ? 'ar-EG' : 'en-GB');
  function applyLang() {
    const html = document.documentElement;
    html.lang = state.lang; html.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(el => (el.textContent = t(el.dataset.i18n)));
    document.querySelectorAll('[data-i18n-html]').forEach(el => (el.innerHTML = t(el.dataset.i18nHtml)));
    document.querySelectorAll('[data-i18n-ph]').forEach(el => (el.placeholder = t(el.dataset.i18nPh)));
    $('langBtn').textContent = t('lang.switch'); $('langBtn').title = t('lang.label');
    document.querySelectorAll('.mv-up').forEach(b => { b.title = t('mv.up'); b.setAttribute('aria-label', t('mv.up')); });
    document.querySelectorAll('.mv-down').forEach(b => { b.title = t('mv.down'); b.setAttribute('aria-label', t('mv.down')); });
    document.querySelectorAll('.fold-btn').forEach(b => { b.title = t('fold'); b.setAttribute('aria-label', t('fold')); });
    // option lists that carry words
    $('maxPerDay').innerHTML = [1, 2, 3, 4, 5].map(n => `<option value="${n}">${examsLabel(n)}</option>`).join('');
    document.querySelectorAll('select.lvl').forEach(sel => (sel.innerHTML = [0, 2, 20, 100, 3000].map(v => `<option value="${v}">${t('lvl.' + v)}</option>`).join('')));
    $('adjPen').innerHTML = [[0, 'lvl.0'], [3, 'lvl.2'], [20, 'lvl.20'], [50, 'lvl.100']].map(([v, k]) => `<option value="${v}">${t(k)}</option>`).join('');
    $('extraPen').innerHTML = [0, 20, 100].map(v => `<option value="${v}">${t('ext.' + v)}</option>`).join('');
    renderThemeBtn();
  }
  $('langBtn').onclick = () => { state.lang = state.lang === 'ar' ? 'en' : 'ar'; save(); applyLang(); renderAll(); };

  // ---------------- theme ----------------
  let themeSetByPage = false;
  function applyTheme() {
    const root = document.documentElement;
    if (state.theme === 'auto') { if (themeSetByPage) root.removeAttribute('data-theme'); themeSetByPage = false; }
    else { root.setAttribute('data-theme', state.theme); themeSetByPage = true; }
    renderThemeBtn();
  }
  function renderThemeBtn() {
    const icon = { auto: '◐', light: '☀', dark: '☾' }[state.theme];
    $('themeBtn').textContent = icon + ' ' + t('theme.' + state.theme);
    $('themeBtn').title = t('theme.label');
  }
  $('themeBtn').onclick = () => {
    state.theme = { auto: 'light', light: 'dark', dark: 'auto' }[state.theme]; save(); applyTheme();
  };

  // ---------------- dates ----------------
  const parseISO = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const iso = x => new Date(x).toISOString().slice(0, 10);
  const wdIdx = s => new Date(parseISO(s)).getUTCDay();
  const wdName = s => t('wd')[wdIdx(s)];
  const wdShort = s => t('wdShort')[wdIdx(s)];
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
      for (let x = a; x <= b; x += 864e5) {
        const d = iso(x);
        if (c.weekdays.includes(new Date(x).getUTCDay()) && !hol.has(d)) out.push({ date: d, extra: false });
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
    $('enrInfo').textContent = t('enroll.reading');
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) throw new Error(t('enroll.empty'));
      pendingRows = { rows, fileName: f.name };
      showColMap(Object.keys(rows[0]));
    } catch (err) {
      $('enrInfo').innerHTML = `<span class="err">${esc(t('enroll.readErr', { msg: err.message }))}</span>`;
    }
    e.target.value = '';
  });

  function guess(headers, pats) {
    for (const p of pats) { const h = headers.find(h => p.test(h)); if (h) return h; }
    return '';
  }
  function showColMap(headers) {
    const box = $('colMap');
    const keys = ['id', 'code', 'title', 'name', 'program', 'level'];
    box.innerHTML = keys.map(k => {
      const g = guess(headers, COLS[k]);
      return `<label>${esc(t('col.' + k))}<select data-col="${k}"><option value="">—</option>${headers.map(h => `<option ${h === g ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`;
    }).join('') + `<button class="btn primary" id="useCols">${esc(t('enroll.use'))}</button>`;
    box.classList.remove('hidden');
    $('enrInfo').textContent = t('enroll.check', { file: pendingRows.fileName, n: pendingRows.rows.length });
    $('useCols').onclick = () => {
      const map = {};
      box.querySelectorAll('select').forEach(s => (map[s.dataset.col] = s.value));
      if (!map.id || !map.code) { $('enrInfo').innerHTML = `<span class="err">${esc(t('enroll.needCols'))}</span>`; return; }
      buildEnrollment(pendingRows.rows, map, pendingRows.fileName);
      box.classList.add('hidden');
    };
  }

  function buildEnrollment(rows, map, fileName) {
    const subType = Object.keys(rows[0]).find(h => /sub\s*type/i.test(h)); // old PUA format: keep lectures only
    const students = [], sIdx = new Map(), courses = {};
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
      if (!c.students.includes(si)) c.students.push(si);
    }
    state.enr = { fileName, students, courses, loadedAt: new Date().toISOString() };
    state.results = {};
    save();
    renderAll();
  }

  // Enrollment plus courses added by hand and fixed courses missing from the file (0 students)
  function enr() {
    const base = state.enr || { students: [], courses: {} };
    const students = base.students.slice(), courses = Object.assign({}, base.courses);
    const idx = new Map(students.map((s, i) => [s.id, i]));
    for (const x of state.extra) {
      const code = normCode(x.code); if (!code) continue;
      const ids = String(x.ids || '').split(/[\s,;]+/).map(v => v.trim()).filter(Boolean);
      const list = courses[code] ? courses[code].students.slice() : [];
      for (const id of ids) {
        if (!idx.has(id)) { idx.set(id, students.length); students.push({ id, name: '', program: '', level: '' }); }
        if (!list.includes(idx.get(id))) list.push(idx.get(id));
      }
      courses[code] = { title: x.title || (courses[code] && courses[code].title) || '', students: list, manual: true };
    }
    for (const f of cfg().fixed) {
      const code = normCode(f.code);
      if (code && !courses[code]) courses[code] = { title: '', students: [], manual: true };
    }
    return { students, courses, fileName: base.fileName, loadedAt: base.loadedAt };
  }

  function renderEnrInfo() {
    const e = state.enr;
    if (!e) { $('enrInfo').textContent = t('enroll.none'); return; }
    $('enrInfo').innerHTML = t('enroll.info', { file: esc(e.fileName), s: e.students.length, c: Object.keys(e.courses).length, when: esc(new Date(e.loadedAt).toLocaleString(locale())) });
  }

  // ---------------- courses not in the file ----------------
  function renderExtra() {
    const tb = $('extraTbl').querySelector('tbody');
    tb.innerHTML = state.extra.map((x, i) => {
      const n = String(x.ids || '').split(/[\s,;]+/).filter(Boolean).length;
      const inFile = state.enr && state.enr.courses[normCode(x.code)];
      return `<tr data-i="${i}"><td class="code"><input value="${esc(x.code)}" data-k="code" placeholder="${esc(t('ph.code'))}" dir="ltr"></td>
        <td><input value="${esc(x.title)}" data-k="title" placeholder="${esc(t('ph.cname'))}" style="width:100%"></td>
        <td><textarea data-k="ids" rows="1" placeholder="${esc(t('ph.ids'))}" style="width:100%" dir="ltr">${esc(x.ids)}</textarea>
          <span class="muted">${esc(t('extra.count', { n }))}${inFile ? esc(t('extra.added', { n: inFile.students.length })) : ''}</span></td>
        <td><button class="icon-btn" data-del="${i}" title="${esc(t('btn.remove'))}">×</button></td></tr>`;
    }).join('') || `<tr><td colspan="4" class="muted">${esc(t('extra.none'))}</td></tr>`;
  }
  $('extraTbl').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'); if (!tr || !ev.target.dataset.k) return;
    const x = state.extra[+tr.dataset.i], k = ev.target.dataset.k;
    x[k] = k === 'code' ? normCode(ev.target.value) : ev.target.value;
    save(); renderExtra(); renderFixed();
  });
  $('extraTbl').addEventListener('click', ev => {
    const d = ev.target.dataset.del; if (d == null) return;
    state.extra.splice(+d, 1); save(); renderExtra(); renderFixed();
  });
  $('addExtra').onclick = () => {
    state.extra.push({ code: '', title: '', ids: '' }); save(); renderExtra();
    const ins = $('extraTbl').querySelectorAll('td.code input'); ins[ins.length - 1].focus();
  };

  // ---------------- rooms board ----------------
  function renderRooms() {
    const n = cfg().rooms.length, total = roomSeats();
    const other = mode === 'final' ? 'midterm' : 'final';
    $('roomsHint').innerHTML = t('rooms.hint', { tab: esc(t(mode === 'final' ? 'rooms.forFinal' : 'rooms.forMid')) });
    $('copyRooms').textContent = t('rooms.copy', { tab: tabName(other) });
    $('roomTotal').innerHTML = n ? t('rooms.total', { n, s: total }) : `<span class="warn">${esc(t('rooms.noneWarn'))}</span>`;
    $('seatInfo').textContent = n ? t('seat.info', { n: total }) : t('seat.none');
    $('roomTbl').querySelector('tbody').innerHTML = cfg().rooms.map((r, i) => `<tr data-i="${i}">
      <td><input value="${esc(r.name)}" data-k="name" aria-label="${esc(t('th.room'))}"></td>
      <td><input type="number" min="0" value="${esc(r.seats)}" data-k="seats" class="seats" aria-label="${esc(t('th.seats'))}"></td>
      <td><button class="icon-btn" data-del="${i}" title="${esc(t('btn.remove'))}">×</button></td></tr>`).join('') ||
      `<tr><td colspan="3" class="muted">${esc(t('rooms.empty'))}</td></tr>`;
  }
  $('roomTbl').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'); if (!tr || !ev.target.dataset.k) return;
    const r = cfg().rooms[+tr.dataset.i];
    if (ev.target.dataset.k === 'seats') r.seats = Math.max(0, parseInt(ev.target.value, 10) || 0);
    else r.name = ev.target.value.trim() || r.name;
    save(); renderRooms(); renderResults();
  });
  $('roomTbl').addEventListener('click', ev => {
    const d = ev.target.dataset.del; if (d == null) return;
    cfg().rooms.splice(+d, 1); save(); renderRooms(); renderResults();
  });
  $('addRoom').onclick = () => {
    const seats = parseInt($('roomSeats').value, 10) || 25;
    cfg().rooms.push({ name: t('rooms.name', { n: cfg().rooms.length + 1 }), seats }); save(); renderRooms(); renderResults();
  };
  $('makeRooms').onclick = () => {
    const btn = $('makeRooms');
    if (cfg().rooms.length && !btn.dataset.armed) {
      btn.dataset.armed = '1'; btn.textContent = t('rooms.setConfirm');
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = t('rooms.set'); }, 4000);
      return;
    }
    delete btn.dataset.armed; btn.textContent = t('rooms.set');
    const n = Math.max(0, Math.min(500, parseInt($('roomCount').value, 10) || 0));
    cfg().rooms = defaultRooms(n, Math.max(1, parseInt($('roomSeats').value, 10) || 25), t('rooms.name'));
    save(); renderRooms(); renderResults();
  };
  $('copyRooms').onclick = () => {
    const other = mode === 'final' ? 'midterm' : 'final';
    cfg().rooms = clone(state.cfg[other].rooms || []); save(); renderRooms(); renderResults();
  };
  $('allSeats').onclick = () => {
    const seats = Math.max(1, parseInt($('roomSeats').value, 10) || 25);
    cfg().rooms.forEach(r => (r.seats = seats)); save(); renderRooms(); renderResults();
  };

  // Fill rooms in order for each exam time: biggest course first, each room up to its seats.
  // Students of a course are split across rooms in ID order. A room can hold more than one course.
  function allocateRooms(r, e) {
    const S = r.slots.length, plan = {}, studentRoom = {}, overflow = {};
    const byCell = {};
    for (const [code, [d, s]] of Object.entries(r.assignment)) (byCell[d * S + s] = byCell[d * S + s] || []).push(code);
    for (const g in byCell) {
      const codes = byCell[g].filter(c => e.courses[c] && e.courses[c].students.length)
        .sort((a, b) => e.courses[b].students.length - e.courses[a].students.length);
      const rooms = cfg().rooms.map(x => ({ name: x.name, left: Math.max(0, +x.seats || 0), parts: [] }));
      let ri = 0;
      for (const code of codes) {
        const sts = e.courses[code].students.slice().sort((a, b) => (e.students[a].id < e.students[b].id ? -1 : 1));
        let k = 0;
        while (k < sts.length) {
          while (ri < rooms.length && rooms[ri].left <= 0) ri++;
          if (ri >= rooms.length) { overflow[g] = (overflow[g] || 0) + (sts.length - k); for (; k < sts.length; k++) studentRoom[code + '|' + sts[k]] = t('noRoom'); break; }
          const take = Math.min(rooms[ri].left, sts.length - k);
          const part = { code, count: take, from: e.students[sts[k]].id, to: e.students[sts[k + take - 1]].id };
          for (let j = 0; j < take; j++) studentRoom[code + '|' + sts[k + j]] = rooms[ri].name;
          rooms[ri].parts.push(part); rooms[ri].left -= take; k += take;
        }
      }
      plan[g] = rooms.filter(x => x.parts.length);
    }
    return { plan, studentRoom, overflow };
  }

  function renderRoomPlan(cr) {
    const { r } = cr, e = enr(), S = r.slots.length;
    if (!cfg().rooms.length) { $('roomPlan').innerHTML = `<p class="muted">${esc(t('roomplan.none'))}</p>`; return; }
    const { plan, overflow } = allocateRooms(r, e);
    let html = '';
    r.days.forEach((d, di) => r.slots.forEach((sl, s) => {
      const g = di * S + s, rooms = plan[g]; if (!rooms) return;
      html += `<div class="room-cell"><div class="room-head"><b>${esc(wdName(d.date))} ${fmtDate(d.date)}</b> · <span dir="ltr">${esc(sl)}</span> · ${esc(t('roomplan.rooms', { n: rooms.length }))}` +
        (overflow[g] ? ` <span class="badge b4">${esc(t('roomplan.over', { n: overflow[g] }))}</span>` : '') + '</div><div class="room-list">' +
        rooms.map(x => `<span class="room"><b>${esc(x.name)}</b> ${x.parts.map(p => `${esc(p.code)} <small>(${p.count})</small>`).join(' + ')}</span>`).join('') + '</div></div>';
    }));
    $('roomPlan').innerHTML = html;
  }

  // ---------------- settings form ----------------
  // show the stored value even if it is not one of the listed choices
  function setSelect(sel, v) {
    [...sel.querySelectorAll('option.custom')].forEach(o => o.remove());
    if (![...sel.options].some(o => +o.value === +v)) sel.insertAdjacentHTML('beforeend', `<option class="custom" value="${v}">${esc(t('custom', { v }))}</option>`);
    sel.value = String(+v);
  }
  function showRuleRows() {
    const max = +$('maxPerDay').value;
    document.querySelectorAll('.rule[data-n]').forEach(r => (r.hidden = +r.dataset.n > max));
  }
  const NUM_FIELDS = ['maxPerDay', 'adjPen', 'pen2', 'pen3', 'pen4', 'extraPen', 'iterations', 'restarts', 'balance'];
  function renderForm() {
    const c = cfg();
    $('start').value = c.start; $('end').value = c.end;
    $('holidays').value = c.holidays.join('\n');
    $('extraDays').value = c.extraDays.join('\n');
    $('slots').value = c.slots.join('\n');
    $('excluded').value = c.excluded;
    NUM_FIELDS.forEach(k => { const el = $(k); if (el.tagName === 'SELECT') setSelect(el, c[k]); else el.value = c[k]; });
    showRuleRows();
    $('weekdays').innerHTML = [6, 0, 1, 2, 3, 4, 5].map(d =>
      `<label class="wd"><input type="checkbox" value="${d}" ${c.weekdays.includes(d) ? 'checked' : ''}>${esc(t('wdShort')[d])}</label>`).join('');
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
    const xmas = days.filter(d => !d.extra && d.date.slice(5) === '01-07').map(d => d.date);
    $('holidayTip').innerHTML = xmas.map(d => `<div class="warn">${esc(t('period.xmas', { day: wdName(d) + ' ' + fmtDate(d) }))} <button class="btn small" data-hol="${d}">${esc(t('period.makeHoliday'))}</button></div>`).join('');
    $('dayList').innerHTML = days.length
      ? `<span class="muted" style="background:none">${esc(t('period.count', { n: days.length }))}</span>` + days.map(d => `<span class="${d.extra ? 'extra' : ''}">${esc(wdShort(d.date))} ${fmtDate(d.date)}${d.extra ? esc(t('period.extraTag')) : ''}</span>`).join('')
      : `<span class="err">${esc(t('period.noDays'))}</span>`;
  }
  document.querySelectorAll('section.card input, section.card textarea, section.card select').forEach(el => {
    if (el.closest('#fixedTbl') || el.closest('#results') || el.closest('#colMap') || el.closest('#extraTbl') || el.closest('#roomTbl') ||
      el.type === 'file' || ['pasteFixed', 'roomCount', 'roomSeats'].includes(el.id)) return;
    el.addEventListener('change', () => { readForm(); renderDays(); renderFixed(); showRuleRows(); });
  });
  $('holidayTip').addEventListener('click', ev => {
    const d = ev.target.dataset.hol; if (!d) return;
    ev.preventDefault();
    cfg().holidays.push(d); save(); renderForm(); renderFixed();
  });
  $('weekdays').addEventListener('change', () => { readForm(); renderDays(); renderFixed(); });

  // ---------------- fixed exams ----------------
  // course list for the picker: enrollment file, then courses added by hand, then any other fixed codes
  function courseSelect(cur) {
    const fileC = state.enr ? state.enr.courses : {};
    const all = enr().courses;
    const fixedCodes = new Set(cfg().fixed.map(f => f.code));
    const fileCodes = Object.keys(fileC).sort();
    const handCodes = [...new Set(state.extra.map(x => normCode(x.code)).filter(c => c && !fileC[c]))].sort();
    const known = new Set([...fileCodes, ...handCodes]);
    const otherCodes = [...fixedCodes].filter(c => c && !known.has(c)).sort();
    const opt = c => {
      const x = all[c], n = x ? x.students.length : 0;
      const tail = (x && x.title ? ' — ' + x.title : '') + ` (${n})` + (c !== cur && fixedCodes.has(c) ? ' · ' + t('fixed.already') : '');
      return `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(c + tail)}</option>`;
    };
    const grp = (label, codes) => (codes.length ? `<optgroup label="${esc(label)}">${codes.map(opt).join('')}</optgroup>` : '');
    return `<select data-k="code" class="course-pick"><option value="" ${cur ? '' : 'selected'}>${esc(t('fixed.pick'))}</option>` +
      grp(t('fixed.grpFile'), fileCodes) + grp(t('fixed.grpHand'), handCodes) + grp(t('fixed.grpOther'), otherCodes) +
      `<option value="__type__">${esc(t('fixed.typeOther'))}</option></select>`;
  }
  function renderFixed() {
    const c = cfg(), days = examDays(c), e = state.enr || state.extra.length ? enr() : null;
    const hasList = !!(state.enr || state.extra.length);
    const tb = $('fixedTbl').querySelector('tbody');
    tb.innerHTML = c.fixed.map((f, i) => {
      const course = e && e.courses[normCode(f.code)];
      const inDays = days.some(d => d.date === f.date);
      const dayOpts = (inDays ? '' : `<option value="${esc(f.date)}" selected>${esc(f.date ? fmtDate(f.date) + t('fixed.notDay') : t('fixed.chooseDay'))}</option>`) +
        days.map(d => `<option value="${d.date}" ${d.date === f.date ? 'selected' : ''}>${esc(wdName(d.date))} ${fmtDate(d.date)}</option>`).join('');
      const slotOpts = c.slots.map((s, si) => `<option value="${si}" ${si === f.slot ? 'selected' : ''}>${esc(s)}</option>`).join('');
      const info = !f.code ? '' : course && !course.manual ? esc(course.title)
        : course && course.title ? esc(course.title) + ` <span class="muted">${esc(t('fixed.byHand'))}</span>`
        : (e ? `<span class="muted">${esc(t('fixed.notInFile'))}</span>` : '');
      const codeCell = hasList && !typingRows.has(i) ? courseSelect(f.code)
        : `<input value="${esc(f.code)}" data-k="code" placeholder="${esc(t('ph.code'))}" dir="ltr">` +
          (hasList ? ` <button class="link-btn" data-list="${i}">${esc(t('fixed.backToList'))}</button>` : '');
      return `<tr data-i="${i}">
        <td class="code">${codeCell}</td>
        <td>${info}</td><td>${course ? course.students.length : ''}</td>
        <td><select data-k="date">${dayOpts}</select></td>
        <td><select data-k="slot">${slotOpts}</select></td>
        <td><button class="icon-btn" data-del="${i}" title="${esc(t('btn.remove'))}">×</button></td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">${esc(t('fixed.none'))}</td></tr>`;
  }
  $('fixedTbl').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'); if (!tr) return;
    const i = +tr.dataset.i, f = cfg().fixed[i], k = ev.target.dataset.k;
    if (k === 'code') {
      if (ev.target.value === '__type__') { typingRows.add(i); renderFixed(); const inp = $('fixedTbl').querySelector(`tr[data-i="${i}"] input`); if (inp) inp.focus(); return; }
      f.code = normCode(ev.target.value); typingRows.delete(i);
    } else if (k === 'date') f.date = ev.target.value;
    else if (k === 'slot') f.slot = +ev.target.value;
    save(); renderFixed();
  });
  $('fixedTbl').addEventListener('click', ev => {
    const l = ev.target.dataset.list;
    if (l != null) { typingRows.delete(+l); renderFixed(); return; }
    const d = ev.target.dataset.del; if (d == null) return;
    cfg().fixed.splice(+d, 1); typingRows.clear(); save(); renderFixed();
  });
  $('addFixed').onclick = () => {
    const days = examDays(cfg());
    cfg().fixed.push({ code: '', date: days[0] ? days[0].date : '', slot: 0 });
    save(); renderFixed();
    const rows = $('fixedTbl').querySelectorAll('td.code');
    const last = rows[rows.length - 1].querySelector('select, input'); if (last) last.focus();
  };
  $('pasteBtn').onclick = () => {
    const c = cfg(); let ok = 0; const bad = [];
    for (const raw of $('pasteFixed').value.split('\n')) {
      const line = raw.trim(); if (!line) continue;
      const parts = line.split(/[\s,;\t،]+/).filter(Boolean);
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
    $('pasteMsg').innerHTML = esc(t('paste.done', { n: ok })) + (bad.length ? ` <span class="err">${esc(t('paste.bad', { x: bad.join(' | ') }))}</span>` : '');
    if (!bad.length) $('pasteFixed').value = '';
  };
  function matchSlot(x) {
    const m = /^(\d{1,2})[:.](\d{2})/.exec(x); if (!m) return -1;
    const mins = h => +h.split(':')[0] * 60 + +h.split(':')[1];
    const starts = cfg().slots.map(s => mins(s.split('-')[0].trim()));
    for (const h of [+m[1], +m[1] + 12]) { const i = starts.indexOf(h * 60 + +m[2]); if (i >= 0) return i; }
    return -1;
  }

  // ---------------- build solver input ----------------
  function buildInput() {
    const c = cfg(), e = state.enr || state.extra.length ? enr() : null, days = examDays(c);
    const errors = [], warnings = [];
    if (!e) errors.push(t('err.noEnr'));
    if (!days.length) errors.push(t('err.noDays'));
    if (!c.slots.length) errors.push(t('err.noSlots'));
    if (errors.length) return { errors, warnings };
    const excluded = new Set(lines(c.excluded).map(normCode));
    const codes = Object.keys(e.courses).filter(k => !excluded.has(k)).sort();
    const courses = codes.map(code => ({ code, students: e.courses[code].students }));
    const fixed = {};
    for (const f of c.fixed) {
      if (!f.code) continue;
      const d = days.findIndex(x => x.date === f.date);
      if (d < 0) { errors.push(t('err.fixedDay', { c: f.code, d: f.date ? fmtDate(f.date) : t('err.noDate') })); continue; }
      if (f.slot >= c.slots.length) { errors.push(t('err.fixedSlot', { c: f.code })); continue; }
      if (fixed[f.code]) warnings.push(t('warn.twice', { c: f.code }));
      if (!excluded.has(f.code)) fixed[f.code] = [d, f.slot];
    }
    const zero = codes.filter(k => !e.courses[k].students.length);
    if (zero.length) warnings.push(t('warn.zero', { list: zero.join(', ') }));
    if (courses.length > days.length * c.slots.length * 20) warnings.push(t('warn.few'));
    const dayPen = [0, 0, c.pen2, c.pen3, c.pen4];
    return {
      errors, warnings,
      input: {
        courses, nStudents: e.students.length, days, nSlots: c.slots.length, fixed,
        config: { capacity: seatLimit(), dayPen, maxPerDay: Math.max(1, c.maxPerDay), adjPen: c.adjPen, extraPen: c.extraPen, balance: c.balance, iterations: c.iterations, restarts: Math.max(1, Math.min(10, c.restarts | 0)) }
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
    try { worker = new Worker('solver.js'); }
    catch (err) { worker = mainThreadWorker(); }
    $('run').disabled = true; $('progress').classList.remove('hidden');
    $('runMsg').textContent = t('run.working');
    const t0 = Date.now(), runMode = mode;
    worker.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'progress') { $('progress').firstElementChild.style.width = Math.round(m.p * 100) + '%'; }
      else if (m.type === 'done') {
        finishRun();
        state.results[runMode] = { assignment: m.result.assignment, generatedAt: new Date().toISOString(), days: b.input.days, slots: state.cfg[runMode].slots.slice() };
        save();
        $('runMsg').textContent = t('run.done', { s: ((Date.now() - t0) / 1000).toFixed(1) });
        if (state.folded.results) { state.folded.results = false; save(); applyOrder(); }
        renderResults();
        $('results').scrollIntoView({ behavior: 'smooth' });
      } else if (m.type === 'error') { finishRun(); $('runMsg').innerHTML = `<span class="err">${esc(m.message)}</span>`; }
    };
    worker.onerror = () => { const h = worker.onmessage; worker = mainThreadWorker(); worker.onmessage = h; worker.postMessage(b.input); };
    worker.postMessage(b.input);
  };
  // Fallback when Web Workers are not allowed: run the solver on the page (it freezes briefly)
  function mainThreadWorker() {
    const w = { onmessage: null, terminate() {} };
    w.postMessage = data => setTimeout(() => {
      try {
        const n = Math.max(1, data.config.restarts || 1); let best = null;
        for (let r = 0; r < n; r++) {
          const res = Solver.solve(Object.assign({}, data, { config: Object.assign({}, data.config, { seed: 12345 + r * 7919 }) }));
          if (!best || res.cost < best.cost) best = res;
        }
        w.onmessage({ data: { type: 'done', result: best } });
      } catch (err) { w.onmessage({ data: { type: 'error', message: String(err) } }); }
    }, 50);
    return w;
  }
  function finishRun() { $('run').disabled = false; $('progress').classList.add('hidden'); $('progress').firstElementChild.style.width = '0'; }
  function showWarnings(errs, warns) {
    $('warnings').innerHTML = errs.map(x => `<div class="err">${esc(x)}</div>`).join('') + warns.map(x => `<div class="warn">${esc(x)}</div>`).join('');
  }

  // ---------------- results ----------------
  function currentResult() {
    const r = state.results[mode];
    if (!r || !(state.enr || state.extra.length)) return null;
    // stats are recomputed against the saved days/slots of this result
    const e = enr();
    const courses = Object.keys(r.assignment).filter(c => e.courses[c]).map(code => ({ code, students: e.courses[code].students }));
    const input = { courses, nStudents: e.students.length, days: r.days, nSlots: r.slots.length, config: { capacity: seatLimit() } };
    return { r, input, stats: Solver.evaluate(input, r.assignment) };
  }

  function renderResults() {
    const cr = currentResult();
    if (!cr) { $('results').classList.add('hidden'); return; }
    $('results').classList.remove('hidden');
    const { r, stats } = cr, e = enr(), S = r.slots.length;
    const fixedSet = new Set(cfg().fixed.map(f => f.code));
    $('genAt').textContent = t('gen.at', { when: new Date(r.generatedAt).toLocaleString(locale()) }) + (r.edited ? t('gen.edited') : '');

    // summary
    const h = stats.hist, n2 = h[2] || 0, n3 = h[3] || 0, n4 = h[4] || 0;
    let n5 = 0; for (const k in h) if (+k >= 5) n5 += h[k];
    const usedExtra = r.days.filter((d, i) => d.extra && Object.values(r.assignment).some(a => a[0] === i));
    const isFinal = mode === 'final';
    const cards = [
      [Object.keys(r.assignment).length, t('stat.courses'), ''],
      [stats.clashes.length, t('stat.clashes'), stats.clashes.length ? 'bad' : 'good'],
      [n2, t('stat.n2'), isFinal ? (n2 ? 'mid' : 'good') : ''],
      ...(isFinal ? [[stats.consecutive.length, t('stat.consec'), '']] : [
        [n3, t('stat.n3'), n3 ? 'mid' : 'good'],
        [n4 + n5, t('stat.n4'), n4 + n5 ? 'bad' : 'good']]),
      [stats.overCap.length, t('stat.over'), stats.overCap.length ? 'bad' : 'good'],
      ...(r.days.some(d => d.extra) ? [[usedExtra.length ? usedExtra.map(d => fmtDate(d.date)).join(', ') : t('stat.no'), t('stat.extra'), usedExtra.length ? 'mid' : 'good']] : [])
    ];
    $('summary').innerHTML = cards.map(([v, l, c]) => `<div class="stat ${c}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('') +
      (isFinal && n2 ? `<div class="warn" style="grid-column:1/-1">${esc(t('final.warn'))}</div>` : '');

    // grid
    const cellCourses = {};
    for (const [code, [d, s]] of Object.entries(r.assignment)) (cellCourses[d * S + s] = cellCourses[d * S + s] || []).push({ code, n: e.courses[code] ? e.courses[code].students.length : 0, fixed: fixedSet.has(code) });
    const cap = seatLimit();
    let html = `<tr><th></th>${r.slots.map(s => `<th dir="ltr">${esc(s)}</th>`).join('')}</tr>`;
    r.days.forEach((d, di) => {
      html += `<tr><th class="day">${esc(wdName(d.date))}<small>${fmtDate(d.date)}${d.extra ? esc(t('grid.extra')) : ''}</small></th>`;
      for (let s = 0; s < S; s++) {
        const list = (cellCourses[di * S + s] || []).sort((a, b) => b.n - a.n);
        const ld = stats.load[di * S + s];
        html += `<td class="${d.extra ? 'extra' : ''}">${list.length ? `<div class="cell-load ${cap && ld > cap ? 'over' : ''}">${esc(t('grid.students', { n: ld + (cap ? ' / ' + cap : '') }))}</div>` : ''}` +
          list.map(c => `<span class="chip ${c.fixed ? 'fixed' : ''}" title="${esc(e.courses[c.code] ? e.courses[c.code].title : '')}">${c.fixed ? '🔒 ' : ''}${esc(c.code)} <small>${c.n}</small></span>`).join('') + '</td>';
      }
      html += '</tr>';
    });
    $('gridTbl').innerHTML = html;

    renderCourseTable(cr, fixedSet);
    renderRoomPlan(cr);

    // heavy days
    const minHeavy = isFinal ? 2 : 3;
    const heavy = stats.heavy.filter(x => x.n >= minHeavy).sort((a, b) => b.n - a.n || a.d - b.d);
    $('dlHeavy').textContent = t(isFinal ? 'dl.heavy2' : 'dl.heavy3');
    $('heavyTitle').textContent = t(isFinal ? 'heavy.t2' : 'heavy.t3', { n: heavy.length });
    $('heavyTbl').innerHTML = heavy.length
      ? `<thead><tr><th>${esc(t('th.sid'))}</th><th>${esc(t('th.name'))}</th><th>${esc(t('th.day'))}</th><th>${esc(t('th.exams'))}</th><th>${esc(t('th.courses'))}</th></tr></thead><tbody>` +
        heavy.map(x => { const st = e.students[x.student]; return `<tr><td>${esc(st.id)}</td><td>${esc(st.name)}</td><td>${esc(wdName(r.days[x.d].date))} ${fmtDate(r.days[x.d].date)}</td><td><span class="badge b${Math.min(x.n, 4)}">${x.n}</span></td><td>${x.codes.map(esc).join(', ')}</td></tr>`; }).join('') + '</tbody>'
      : `<tbody><tr><td class="ok">${esc(t('heavy.none'))}</td></tr></tbody>`;
    if (stats.clashes.length) $('heavyTbl').innerHTML += `<tbody>${stats.clashes.map(x => `<tr><td colspan="5" class="err">${esc(t('clash', { s: e.students[x.student].id, a: x.codes[0], b: x.codes[1], when: fmtDate(r.days[x.d].date) + ' ' + r.slots[x.s] }))}</td></tr>`).join('')}</tbody>`;
    renderStudent();
  }

  function renderCourseTable(cr, fixedSet) {
    const { r } = cr, e = enr(), q = $('courseFilter').value.trim().toUpperCase();
    const rows = Object.entries(r.assignment)
      .filter(([code]) => !q || code.includes(q) || (e.courses[code] && e.courses[code].title.toUpperCase().includes(q)))
      .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[0].localeCompare(b[0]));
    $('courseTbl').innerHTML = `<thead><tr><th>🔒</th><th>${esc(t('th.codeShort'))}</th><th>${esc(t('th.course'))}</th><th>${esc(t('th.students'))}</th><th>${esc(t('th.day'))}</th><th>${esc(t('th.time'))}</th></tr></thead><tbody>` +
      rows.map(([code, [d, s]]) => `<tr data-code="${esc(code)}">
        <td><input type="checkbox" data-k="lock" ${fixedSet.has(code) ? 'checked' : ''} title="${esc(t('keep'))}"></td>
        <td><b>${esc(code)}</b></td><td>${esc(e.courses[code] ? e.courses[code].title : '')}</td>
        <td>${e.courses[code] ? e.courses[code].students.length : ''}</td>
        <td><select data-k="d">${r.days.map((x, i) => `<option value="${i}" ${i === d ? 'selected' : ''}>${esc(wdShort(x.date))} ${fmtDate(x.date)}</option>`).join('')}</select></td>
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
    const e = enr(), r = cr.r;
    const rooms = cfg().rooms.length ? allocateRooms(r, e).studentRoom : {};
    const matches = e.students.map((s, i) => [s, i]).filter(([s]) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 10);
    out.innerHTML = matches.map(([s, i]) => {
      const ex = Object.entries(r.assignment).filter(([c]) => e.courses[c] && e.courses[c].students.includes(i)).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
      return `<div class="student-card"><b>${esc(s.id)}</b> ${esc(s.name)} <span class="muted">${esc(s.program)} ${esc(s.level)}</span>
        <table class="tbl">${ex.map(([c, [d, sl]]) => `<tr><td>${esc(wdName(r.days[d].date))} ${fmtDate(r.days[d].date)}</td><td dir="ltr">${esc(r.slots[sl])}</td><td><b>${esc(c)}</b></td><td>${esc(e.courses[c].title)}</td><td>${esc(rooms[c + '|' + i] || '')}</td></tr>`).join('')}</table></div>`;
    }).join('') || `<p class="muted">${esc(t('lookup.none'))}</p>`;
  }
  $('studentSearch').addEventListener('input', renderStudent);

  // ---------------- export ----------------
  // Build the export tables (same files as the old Python scripts, plus rooms). Headings follow the page language.
  function buildExports() {
    const cr = currentResult(); if (!cr) return null;
    const { r, stats } = cr, e = enr(), S = r.slots.length;
    const fixedSet = new Set(cfg().fixed.map(f => f.code));
    const byTime = (a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[0].localeCompare(b[0]);
    const alloc = cfg().rooms.length ? allocateRooms(r, e) : { plan: {}, studentRoom: {} };
    const day = d => wdName(r.days[d].date), date = d => fmtDate(r.days[d].date);
    const X = k => t('x.' + k);
    const detailed = Object.entries(r.assignment).sort(byTime).map(([c, [d, s]]) => ({
      [X('Day')]: day(d), [X('Date')]: date(d), [X('Period')]: s + 1, [X('Time')]: r.slots[s], [X('Code')]: c, [X('Title')]: e.courses[c] ? e.courses[c].title : '',
      [X('Students')]: e.courses[c] ? e.courses[c].students.length : 0, [X('Fixed')]: fixedSet.has(c) ? X('Yes') : '' }));
    const byday = [];
    r.days.forEach((x, di) => r.slots.forEach((sl, s) => byday.push({ [X('Day')]: day(di), [X('Date')]: date(di), [X('Period')]: s + 1, [X('Time')]: sl,
      [X('Courses')]: Object.entries(r.assignment).filter(([, a]) => a[0] === di && a[1] === s).map(([c]) => c).sort().join(', '), [X('Students')]: stats.load[di * S + s] })));
    const student = [];
    e.students.forEach((st, i) => {
      Object.entries(r.assignment).filter(([c]) => e.courses[c] && e.courses[c].students.includes(i)).sort(byTime)
        .forEach(([c, [d, s]]) => student.push({ [X('SID')]: st.id, [X('Name')]: st.name, [X('Program')]: st.program, [X('Level')]: st.level, [X('Code')]: c, [X('Title')]: e.courses[c].title, [X('Day')]: day(d), [X('Date')]: date(d), [X('Period')]: s + 1, [X('Time')]: r.slots[s], [X('Room')]: alloc.studentRoom[c + '|' + i] || '' }));
    });
    const rooms = [];
    r.days.forEach((x, di) => r.slots.forEach((sl, s) => (alloc.plan[di * S + s] || []).forEach(rm => rm.parts.forEach(p =>
      rooms.push({ [X('Day')]: day(di), [X('Date')]: date(di), [X('Time')]: sl, [X('Room')]: rm.name, [X('Code')]: p.code, [X('Students')]: p.count, [X('From')]: p.from, [X('To')]: p.to })))));
    const minHeavy = mode === 'final' ? 2 : 3;
    const heavy = stats.heavy.filter(x => x.n >= minHeavy).sort((a, b) => b.n - a.n || a.d - b.d).map(x => {
      const row = { [X('SID')]: e.students[x.student].id, [X('Name')]: e.students[x.student].name, [X('Day')]: day(x.d), [X('Date')]: date(x.d), [X('Exams')]: x.n };
      x.codes.forEach((c, k) => (row[t('x.ExamN', { n: k + 1 })] = c));
      return row;
    });
    const label = mode === 'final' ? 'Final' : 'Midterm';
    return { label, minHeavy, sheets: { detailed, student, byday, heavy, rooms } };
  }
  const FILE_NAMES = { detailed: 'detailed_schedule', student: 'student_exam_timetable', byday: 'courses_by_day', rooms: 'room_plan' };
  document.querySelector('.downloads').addEventListener('click', ev => {
    const kind = ev.target.dataset && ev.target.dataset.dl; if (!kind) return;
    const x = buildExports(); if (!x) return;
    const wb = XLSX.utils.book_new();
    if (state.lang === 'ar') wb.Workbook = { Views: [{ RTL: true }] };
    const add = (rows, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': t('x.none') }]), name.slice(0, 31));
    const kinds = kind === 'all' ? ['byday', 'detailed', 'student', 'rooms', 'heavy'] : [kind];
    kinds.forEach(k => add(x.sheets[k], t('sh.' + k)));
    const base = kind === 'heavy' ? (x.minHeavy === 2 ? 'students_with_2_exams_a_day' : 'students_with_3_exams_a_day') : FILE_NAMES[kind];
    const name = kind === 'all' ? `${x.label}_exam_schedule.xlsx` : `${x.label}_${base}.xlsx`;
    saveFile(name, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $('dlMsg'));
  });

  // Save a file: inside the claude.ai preview use its save prompt, elsewhere a normal download
  async function saveFile(name, data, mime, msgEl) {
    const say = h => { if (msgEl) msgEl.innerHTML = h; };
    if (window.claude && typeof window.claude.use === 'function') {
      let dl = null;
      try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
      if (dl) {
        try { await dl.save({ filename: name, data: data instanceof ArrayBuffer ? new Blob([data]) : data }); say(esc(t('dl.saved', { f: name }))); }
        catch (e) { if (e && e.code !== 'declined') say(`<span class="err">${esc(t('dl.err', { c: e && e.code }))}</span>`); }
        return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: mime }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  $('printBtn').onclick = () => window.print();
  const EMBEDDED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  if (EMBEDDED) $('printBtn').hidden = true;

  // ---------------- settings file ----------------
  $('exportCfg').onclick = () => {
    saveFile('exam-scheduler-settings.json', JSON.stringify({ cfg: state.cfg, extra: state.extra, order: state.order }, null, 2), 'application/json', $('cfgMsg'));
  };
  $('importCfg').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (Array.isArray(j.extra)) state.extra = j.extra;
      if (Array.isArray(j.order)) state.order = j.order;
      if (Array.isArray(j.rooms)) for (const m of ['midterm', 'final']) if (j.cfg && j.cfg[m] && !j.cfg[m].rooms) j.cfg[m].rooms = clone(j.rooms);
      for (const m of ['midterm', 'final']) if (j.cfg && j.cfg[m]) state.cfg[m] = Object.assign(clone(DEFAULTS[m]), j.cfg[m]);
      typingRows.clear(); save(); renderAll();
    } catch (err) { $('cfgMsg').innerHTML = `<span class="err">${esc(t('cfg.loadErr', { m: err.message }))}</span>`; }
    ev.target.value = '';
  });
  $('resetCfg').onclick = () => {
    const btn = $('resetCfg');
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1'; btn.textContent = t('cfg.resetConfirm', { tab: tabName(mode) });
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = t('cfg.reset'); }, 4000);
      return;
    }
    delete btn.dataset.armed; btn.textContent = t('cfg.reset');
    state.cfg[mode] = clone(DEFAULTS[mode]); delete state.results[mode]; typingRows.clear(); save(); renderAll();
  };

  // ---------------- tabs ----------------
  $('tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    mode = state.mode = b.dataset.mode; save();
    typingRows.clear();
    showWarnings([], []); $('runMsg').textContent = '';
    renderAll();
  });

  // ---------------- section order and folding ----------------
  function applyOrder() {
    const main = $('main'), secs = [...main.querySelectorAll('section.sec')];
    const keys = secs.map(x => x.dataset.sec);
    const order = state.order.filter(k => keys.includes(k)).concat(keys.filter(k => !state.order.includes(k)));
    const footer = main.querySelector('.muted-card');
    order.forEach(k => main.insertBefore(secs.find(x => x.dataset.sec === k), footer));
    main.querySelectorAll('section.sec').forEach((x, i, all) => {
      x.querySelector('.num').textContent = i + 1;
      x.querySelector('.mv-up').disabled = i === 0;
      x.querySelector('.mv-down').disabled = i === all.length - 1;
      const folded = !!state.folded[x.dataset.sec];
      x.classList.toggle('folded', folded);
      x.querySelector('.fold-btn').setAttribute('aria-expanded', String(!folded));
    });
  }
  document.querySelectorAll('section.sec > h2').forEach(h => {
    h.insertAdjacentHTML('afterbegin', '<button class="icon-btn fold-btn" type="button">▾</button>');
    h.insertAdjacentHTML('beforeend', '<span class="mover"><button class="icon-btn mv-up" type="button">▲</button><button class="icon-btn mv-down" type="button">▼</button></span>');
  });
  $('main').addEventListener('click', ev => {
    const sec = ev.target.closest('section.sec'); if (!sec) return;
    const mv = ev.target.closest('.mv-up, .mv-down');
    if (mv) {
      const keys = [...$('main').querySelectorAll('section.sec')].map(x => x.dataset.sec);
      const i = keys.indexOf(sec.dataset.sec), j = mv.classList.contains('mv-up') ? i - 1 : i + 1;
      if (j < 0 || j >= keys.length) return;
      [keys[i], keys[j]] = [keys[j], keys[i]];
      state.order = keys; save(); applyOrder();
      sec.scrollIntoView({ block: 'nearest' });
      return;
    }
    // fold with the arrow or by clicking the section title
    if (ev.target.closest('.fold-btn') || (ev.target.closest('h2') && ev.target.closest('h2').parentNode === sec)) {
      state.folded[sec.dataset.sec] = !state.folded[sec.dataset.sec]; save(); applyOrder();
    }
  });
  $('foldAll').onclick = () => { document.querySelectorAll('section.sec').forEach(x => (state.folded[x.dataset.sec] = true)); save(); applyOrder(); };
  $('openAll').onclick = () => { state.folded = {}; save(); applyOrder(); };
  $('resetOrder').onclick = () => { state.order = []; save(); location.reload(); };

  function renderAll() {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x.dataset.mode === mode));
    applyOrder(); renderEnrInfo(); renderExtra(); renderRooms(); renderForm(); renderFixed(); renderResults();
  }
  applyTheme();
  applyLang();
  renderAll();
})();
