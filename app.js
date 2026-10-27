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
  let mode = state.view === 'ta' ? state.ta.examFor : (state.mode || 'midterm');
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
    s.view = s.view === 'ta' ? 'ta' : 'exam';
    const taDef = { list: [], seq: 0, examFor: 'midterm', seed: 1, result: {}, cfg: {
      midterm: { perRoom: 1, offDays: 1, duties: null, roomTAs: {}, requests: [] },
      final: { perRoom: 1, offDays: 3, duties: null, roomTAs: {}, requests: [] } } };
    s.ta = Object.assign(taDef, s.ta || {});
    for (const m of ['midterm', 'final']) s.ta.cfg[m] = Object.assign(clone(taDef.cfg[m]), (s.ta.cfg || {})[m] || {});
    s.ta.result = s.ta.result || {};
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
    saveFile('exam-scheduler-settings.json', JSON.stringify({ cfg: state.cfg, extra: state.extra, order: state.order, ta: { list: state.ta.list, seq: state.ta.seq, cfg: state.ta.cfg } }, null, 2), 'application/json', $('cfgMsg'));
  };
  $('importCfg').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (Array.isArray(j.extra)) state.extra = j.extra;
      if (Array.isArray(j.order)) state.order = j.order;
      if (j.ta && Array.isArray(j.ta.list)) { state.ta.list = j.ta.list; state.ta.seq = Math.max(state.ta.seq, j.ta.seq || 0); for (const m of ['midterm', 'final']) if (j.ta.cfg && j.ta.cfg[m]) state.ta.cfg[m] = Object.assign(state.ta.cfg[m], j.ta.cfg[m]); }
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
    if (state.view === 'ta') { state.ta.cfg[mode] = { perRoom: 1, offDays: mode === 'final' ? 3 : 1, duties: null, roomTAs: {}, requests: [] }; delete state.ta.result[mode]; }
    else { state.cfg[mode] = clone(DEFAULTS[mode]); delete state.results[mode]; }
    typingRows.clear(); save(); renderAll();
  };

  // ---------------- tabs ----------------
  $('tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.view === 'ta') { state.view = 'ta'; mode = state.ta.examFor; }
    else { state.view = 'exam'; mode = state.mode = b.dataset.mode; }
    save();
    typingRows.clear();
    showWarnings([], []); $('runMsg').textContent = '';
    renderAll();
  });

  // ---------------- section order and folding ----------------
  // ---------------- section order and folding ----------------
  const inView = x => (state.view === 'ta' ? x.classList.contains('ta-only') : !x.classList.contains('ta-only'));
  function applyOrder() {
    const main = $('main'), secs = [...main.querySelectorAll('section.sec')];
    const keys = secs.map(x => x.dataset.sec);
    const order = state.order.filter(k => keys.includes(k)).concat(keys.filter(k => !state.order.includes(k)));
    const footer = main.querySelector('.muted-card');
    order.forEach(k => main.insertBefore(secs.find(x => x.dataset.sec === k), footer));
    document.body.classList.toggle('view-ta', state.view === 'ta');
    const vis = [...main.querySelectorAll('section.sec')].filter(inView);
    vis.forEach((x, i) => {
      x.querySelector('.num').textContent = i + 1;
      x.querySelector('.mv-up').disabled = i === 0;
      x.querySelector('.mv-down').disabled = i === vis.length - 1;
    });
    main.querySelectorAll('section.sec').forEach(x => {
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
      const all = [...$('main').querySelectorAll('section.sec')], keys = all.map(x => x.dataset.sec);
      const vis = all.filter(inView), vi = vis.indexOf(sec), vj = mv.classList.contains('mv-up') ? vi - 1 : vi + 1;
      if (vj < 0 || vj >= vis.length) return;
      const i = keys.indexOf(sec.dataset.sec), j = keys.indexOf(vis[vj].dataset.sec);
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
  $('foldAll').onclick = () => { [...document.querySelectorAll('section.sec')].filter(inView).forEach(x => (state.folded[x.dataset.sec] = true)); save(); applyOrder(); };
  $('openAll').onclick = () => { [...document.querySelectorAll('section.sec')].filter(inView).forEach(x => delete state.folded[x.dataset.sec]); save(); applyOrder(); };
  $('resetOrder').onclick = () => { state.order = []; save(); location.reload(); };

  // ======================= TAs (invigilation) =======================
  const taCfg = () => state.ta.cfg[mode];
  const taList = () => state.ta.list.filter(x => String(x.name || '').trim());
  const taById = uid => state.ta.list.find(x => x.uid === uid);
  const optNum = v => (v === '' || v == null || isNaN(+v) ? null : Math.max(0, Math.round(+v)));
  const examName = () => tabName(mode);
  function addTAs(names, replace) {
    if (replace) { state.ta.list = []; }
    const key = n => String(n).toLowerCase().replace(/[–—−-]/g, '-').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
    const have = new Set(state.ta.list.map(x => key(x.name)));
    let n = 0;
    for (const raw of names) {
      const name = String(raw).replace(/\s+/g, ' ').trim();
      if (!name || have.has(key(name))) continue;
      have.add(key(name));
      state.ta.list.push({ uid: 'ta' + (++state.ta.seq), name, offDays: null, duties: null }); n++;
    }
    save(); renderTA();
    return n;
  }

  // read names from a Word file (last cell of each table row), Excel/CSV (Name column or first column) or plain text
  const HEADER_WORDS = /^(name|names|ta|tas|الاسم|اسم|الأسماء|الملاحظ|التاريخ|الفترة|اسم المعيد|المعيد)$/i;
  const HEADER_CELL = /الفترة|الملاحظ|التاريخ|\d{1,2}\s*(am|pm)\b|Σ/i;
  async function namesFromFile(f) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (/\.docx$/i.test(f.name)) {
      const zip = XLSX.CFB.read(buf, { type: 'array' });
      const entry = XLSX.CFB.find(zip, 'word/document.xml') || XLSX.CFB.find(zip, '/word/document.xml');
      if (!entry) return [];
      const xml = new TextDecoder('utf-8').decode(entry.content);
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const out = [];
      for (const tr of doc.getElementsByTagNameNS(W, 'tr')) {
        const cells = [...tr.getElementsByTagNameNS(W, 'tc')];
        if (cells.length < 3) continue;
        // the name sits in the first or last cell (Arabic tables put it last)
        const text = c => [...c.getElementsByTagNameNS(W, 't')].map(x => x.textContent).join('').replace(/\s+/g, ' ').trim();
        let name = text(cells[cells.length - 1]);
        if (!/[A-Za-z؀-ۿ]{2}/.test(name) || HEADER_WORDS.test(name)) name = text(cells[0]);
        if (!name || HEADER_WORDS.test(name) || HEADER_CELL.test(name) || !/[A-Za-z؀-ۿ]{2}/.test(name) || /^[Σ\d\s]+$/.test(name)) continue;
        out.push(name);
      }
      return out;
    }
    if (/\.txt$/i.test(f.name)) return new TextDecoder('utf-8').decode(buf).split(/\r?\n/);
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    if (!rows.length) return [];
    let col = rows[0].findIndex(h => /name|الاسم|اسم/i.test(String(h)));
    const start = col >= 0 ? 1 : (HEADER_WORDS.test(String(rows[0][0]).trim()) ? 1 : 0);
    if (col < 0) col = 0;
    return rows.slice(start).map(r => r[col]).filter(v => String(v).trim());
  }
  $('taFile').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const names = await namesFromFile(f);
      if (!names.length) { $('taListMsg').textContent = t('ta.fileNoNames', { file: f.name }); }
      else { const n = addTAs(names, false); $('taListMsg').textContent = t('ta.filesRead', { n: names.length, file: f.name }) + ' ' + t('ta.added', { n }); }
    } catch (err) { $('taListMsg').innerHTML = `<span class="err">${esc(t('enroll.readErr', { msg: err.message }))}</span>`; }
    ev.target.value = '';
  });
  $('taPasteAdd').onclick = () => { const n = addTAs($('taPaste').value.split('\n'), false); $('taListMsg').textContent = t('ta.added', { n }); $('taPaste').value = ''; };
  $('taPasteReplace').onclick = () => { const n = addTAs($('taPaste').value.split('\n'), true); $('taListMsg').textContent = t('ta.added', { n }); $('taPaste').value = ''; };
  $('taAddOne').onclick = () => {
    state.ta.list.push({ uid: 'ta' + (++state.ta.seq), name: '', offDays: null, duties: null }); save(); renderTA();
    const ins = $('taTbl').querySelectorAll('input[data-k=name]'); ins[ins.length - 1].focus();
  };
  $('taTbl').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'); if (!tr || !ev.target.dataset.k) return;
    const x = taById(tr.dataset.uid), k = ev.target.dataset.k;
    x[k] = k === 'name' ? ev.target.value.trim() : optNum(ev.target.value);
    save(); renderTA();
  });
  $('taTbl').addEventListener('click', ev => {
    const uid = ev.target.dataset.del; if (!uid) return;
    state.ta.list = state.ta.list.filter(x => x.uid !== uid);
    for (const m of ['midterm', 'final']) state.ta.cfg[m].requests = state.ta.cfg[m].requests.filter(q => q.uid !== uid);
    save(); renderTA();
  });

  // rules
  $('taExam').addEventListener('change', ev => { state.ta.examFor = mode = ev.target.value; save(); renderTA(); });
  ['taPerRoom', 'taOffDays', 'taDuties'].forEach(id => $(id).addEventListener('change', () => {
    const c = taCfg();
    if (id === 'taPerRoom') c.perRoom = optNum($(id).value) ?? 1;
    if (id === 'taOffDays') c.offDays = optNum($(id).value) ?? 0;
    if (id === 'taDuties') c.duties = optNum($(id).value) || null;
    save(); renderTA();
  }));
  $('taSpread').addEventListener('change', ev => { taCfg().spread = ev.target.value; save(); renderTA(); });
  $('taPosts').addEventListener('change', ev => { taCfg().posts = ev.target.value.split('\n').map(x => x.trim()).filter(Boolean); save(); renderTA(); });
  $('taRoomTbl').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'); if (!tr) return;
    const v = optNum(ev.target.value), name = tr.dataset.room;
    if (v == null) delete taCfg().roomTAs[name]; else taCfg().roomTAs[name] = v;
    save(); renderTA();
  });

  // requested days off / own exams
  $('taAddReq').onclick = () => {
    const days = examDays(cfg());
    taCfg().requests.push({ uid: '', date: days[0] ? days[0].date : '', slot: -1, kind: 'off', note: '' }); save(); renderTA();
  };
  $('taReqTbl').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'); if (!tr || !ev.target.dataset.k) return;
    const q = taCfg().requests[+tr.dataset.i], k = ev.target.dataset.k;
    q[k] = k === 'slot' ? +ev.target.value : ev.target.value;
    if (k === 'slot') q.kind = +ev.target.value >= 0 ? (q.kind === 'off' ? 'exam' : q.kind) : 'off';
    save(); renderTA();
  });
  $('taReqTbl').addEventListener('click', ev => {
    const d = ev.target.dataset.del; if (d == null) return;
    taCfg().requests.splice(+d, 1); save(); renderTA();
  });

  const roomNeed = name => { const v = taCfg().roomTAs[name]; return v != null ? v : taCfg().perRoom; };

  // exam times with the posts that need TAs (rooms from the room plan, plus extra posts)
  function taDemand() {
    const cr = currentResult(); if (!cr) return null;
    const { r } = cr, e = enr(), S = r.slots.length;
    const { plan } = allocateRooms(r, e);
    const posts = taCfg().posts || [];
    const times = [];
    r.days.forEach((d, di) => r.slots.forEach((sl, s) => {
      const rooms = plan[di * S + s]; if (!rooms || !rooms.length) return;
      const need = rooms.map(rm => ({ post: rm.name, n: roomNeed(rm.name), courses: rm.parts.map(p => p.code) }))
        .concat(posts.map(p => ({ post: p, n: 1, courses: [] }))).filter(x => x.n > 0);
      times.push({ d: di, s, need, total: need.reduce((a, b) => a + b.n, 0) });
    }));
    return { r, times, total: times.reduce((a, b) => a + b.total, 0) };
  }

  function taSignature() {
    const r = state.results[mode];
    return JSON.stringify([r && r.generatedAt, r && r.edited, state.ta.list, taCfg(), cfg().rooms]);
  }

  // The generator. Hard rules: requested days off and own exams; one place per TA per exam time.
  // Then: give each TA their days off on the quietest days, and fill places by who is furthest below their target.
  function generateTA(seed) {
    const tas = taList();
    if (!state.results[mode]) return { error: t('ta.errNoSchedule', { exam: examName() }) };
    if (!tas.length) return { error: t('ta.errNoTAs') };
    if (!cfg().rooms.length) return { error: t('ta.errNoRooms', { exam: examName() }) };
    const dem = taDemand(); if (!dem) return { error: t('ta.errNoSchedule', { exam: examName() }) };
    const { r, times, total } = dem, S = r.slots.length, D = r.days.length, c = taCfg();
    let rs = (seed * 2654435761) >>> 0 || 1;
    const rand = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
    const dayIdx = new Map(r.days.map((x, i) => [x.date, i]));
    const st = new Map(tas.map(x => [x.uid, { blockedDay: new Map(), blockedSlot: new Map(), autoOff: new Set(), duties: 0, perDay: {}, rooms: {}, target: 0, lost: 0 }]));
    for (const q of c.requests) {
      const s0 = st.get(q.uid), d = dayIdx.get(q.date);
      if (!s0 || d == null) continue;
      if (q.slot >= 0 && q.slot < S) s0.blockedSlot.set(d * S + q.slot, q.kind || 'exam');
      else s0.blockedDay.set(d, q.kind || 'off');
    }
    // days off: requested whole days count; the rest go on the days with the most spare TAs
    const peak = new Array(D).fill(0);
    times.forEach(x => (peak[x.d] = Math.max(peak[x.d], x.total)));
    const avail = new Array(D).fill(0);
    for (const x of tas) for (let d = 0; d < D; d++) if (!st.get(x.uid).blockedDay.has(d)) avail[d]++;
    const order = tas.slice().sort(() => rand() - 0.5);
    for (const x of order) {
      const s0 = st.get(x.uid);
      let need = Math.max(0, (x.offDays != null ? x.offDays : c.offDays) - s0.blockedDay.size);
      while (need-- > 0) {
        let best = -1, bestV = -Infinity;
        for (let d = 0; d < D; d++) {
          if (!peak[d] || s0.blockedDay.has(d) || s0.autoOff.has(d)) continue;
          const v = avail[d] - peak[d] + rand() * 0.5;
          if (v > bestV) { bestV = v; best = d; }
        }
        if (best < 0) break;
        s0.autoOff.add(best); avail[best]--;
      }
    }
    // targets: a TA's own number, the rule's number, or an equal share of what is left
    const fixedT = tas.filter(x => x.duties != null || c.duties != null);
    const autoT = tas.filter(x => x.duties == null && c.duties == null);
    const fixedSum = fixedT.reduce((a, x) => a + (x.duties != null ? x.duties : c.duties), 0);
    const share = autoT.length ? Math.ceil(Math.max(0, total - fixedSum) / autoT.length) : 0;
    tas.forEach(x => (st.get(x.uid).target = x.duties != null ? x.duties : c.duties != null ? c.duties : share));

    const assign = [], shortages = [];
    const spread = (c.spread || 'spread') === 'spread';
    for (const tm of times) {
      const g = tm.d * S + tm.s, used = new Set();
      const seats = [];
      tm.need.forEach(p => { for (let k = 0; k < p.n; k++) seats.push(p); });
      for (const p of seats) {
        let pick = null;
        for (let level = 0; level < 3 && !pick; level++) {
          let bestKey = null;
          for (const x of tas) {
            const s0 = st.get(x.uid);
            if (used.has(x.uid) || s0.blockedDay.has(tm.d) || s0.blockedSlot.has(g)) continue;
            if (level < 2 && s0.autoOff.has(tm.d)) continue;
            if (level === 0 && s0.duties >= s0.target) continue;
            const today = s0.perDay[tm.d] || 0;
            const key = [s0.duties - s0.target, spread ? today : -today, s0.rooms[p.post] || 0, rand()];
            if (!bestKey || cmpKey(key, bestKey) < 0) { bestKey = key; pick = x; }
          }
        }
        if (!pick) { const sh = shortages.find(z => z.g === g && z.post === p.post); if (sh) sh.n++; else shortages.push({ g, d: tm.d, s: tm.s, post: p.post, n: 1 }); continue; }
        const s0 = st.get(pick.uid);
        if (s0.autoOff.has(tm.d)) { s0.autoOff.delete(tm.d); s0.lost++; }
        used.add(pick.uid); s0.duties++; s0.perDay[tm.d] = (s0.perDay[tm.d] || 0) + 1; s0.rooms[p.post] = (s0.rooms[p.post] || 0) + 1;
        assign.push({ g, d: tm.d, s: tm.s, post: p.post, courses: p.courses, uid: pick.uid });
      }
    }
    const per = {};
    for (const x of tas) {
      const s0 = st.get(x.uid);
      per[x.uid] = { duties: s0.duties, target: s0.target, lost: s0.lost,
        offReq: [...s0.blockedDay.entries()], offAuto: [...s0.autoOff], slotBlocks: [...s0.blockedSlot.entries()] };
    }
    const result = { generatedAt: new Date().toISOString(), seed, days: r.days, slots: r.slots, assign, shortages, per, total, sig: taSignature() };
    equalizeTA(result, rand);
    return { result };
  }
  function cmpKey(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }

  // Everyone ends with the same number of exam times: TAs below the highest count get reserve (standby)
  // duties at exam times when they are free. A TA with their own number gets exactly that number.
  const RESERVE = '__reserve__';
  const postLabel = p => (p === RESERVE ? t('ta.reserve') : p);
  function equalizeTA(res, rand) {
    rand = rand || Math.random;
    const S = res.slots.length, c = taCfg(), spread = (c.spread || 'spread') === 'spread';
    res.assign = res.assign.filter(a => !a.reserve);
    const count = uid => res.assign.filter(a => a.uid === uid).length;
    const tas = taList().filter(x => res.per[x.uid]);
    tas.forEach(x => (res.per[x.uid].duties = count(x.uid)));
    const balanced = tas.filter(x => x.duties == null);
    const top = balanced.length ? Math.max(...balanced.map(x => res.per[x.uid].duties)) : 0;
    // exam times that have exams, with how busy they are
    const places = {};
    res.assign.forEach(a => (places[a.g] = (places[a.g] || 0) + 1));
    res.shortages.forEach(z => (places[z.g] = (places[z.g] || 0) + z.n));
    const times = Object.keys(places).map(Number);
    const reservesAt = {};
    res.unequal = [];
    const order = tas.slice().sort((a, b) => res.per[a.uid].duties - res.per[b.uid].duties || rand() - 0.5);
    for (const x of order) {
      const p = res.per[x.uid];
      const want = x.duties != null ? x.duties : top;
      let need = want - p.duties;
      const req = new Map(p.offReq), slotB = new Map(p.slotBlocks), off = new Set(p.offAuto);
      while (need > 0) {
        const mine = new Set(res.assign.filter(a => a.uid === x.uid).map(a => a.g));
        // first choice: a missing place this TA can cover
        const gap = res.shortages.find(z => z.n > 0 && !mine.has(z.g) && !slotB.has(z.g) && !req.has(Math.floor(z.g / S)) && !off.has(Math.floor(z.g / S)));
        if (gap) {
          res.assign.push({ g: gap.g, d: gap.d, s: gap.s, post: gap.post, courses: [], uid: x.uid });
          gap.n--; need--; continue;
        }
        let best = null, bestKey = null;
        for (const g of times) {
          const d = Math.floor(g / S);
          if (mine.has(g) || slotB.has(g) || req.has(d) || off.has(d)) continue;
          const today = res.assign.filter(a => a.uid === x.uid && a.d === d).length;
          const key = [spread ? today : -today, reservesAt[g] || 0, -places[g], rand()];
          if (!bestKey || cmpKey(key, bestKey) < 0) { bestKey = key; best = g; }
        }
        if (best == null) break;
        res.assign.push({ g: best, d: Math.floor(best / S), s: best % S, post: RESERVE, courses: [], uid: x.uid, reserve: true });
        reservesAt[best] = (reservesAt[best] || 0) + 1;
        need--;
      }
      p.duties = count(x.uid);
      if (p.duties < want) res.unequal.push({ uid: x.uid, have: p.duties, want });
    }
    res.shortages = res.shortages.filter(z => z.n > 0);
    res.reserves = res.assign.filter(a => a.reserve).length;
  }

  function runTA(newSeed) {
    if (newSeed) state.ta.seed = (state.ta.seed || 1) + 1;
    const out = generateTA(state.ta.seed || 1);
    if (out.error) { $('taWarn').innerHTML = `<div class="err">${esc(out.error)}</div>`; return; }
    state.ta.result[mode] = out.result; taUndo = []; closeTAEditor(); save();
    $('taMsg').textContent = t('ta.done');
    renderTA();
  }
  $('taRun').onclick = () => runTA(false);
  $('taAgain').onclick = () => runTA(true);

  // weeks start on Saturday
  const weekOf = date => Math.floor((parseISO(date) / 864e5 - 2) / 7);

  // the timetable like the paper sheet: one row per TA, one column per exam time
  function taMatrix(res) {
    const S = res.slots.length;
    const cols = [];
    res.days.forEach((d, di) => res.slots.forEach((sl, s) => cols.push({ d: di, s, g: di * S + s, date: d.date, slot: sl })));
    const weeks = [...new Set(res.days.map(d => weekOf(d.date)))];
    const at = {};
    res.assign.forEach(a => (at[a.uid + '|' + a.g] = postLabel(a.post)));
    const rows = taList().filter(x => res.per[x.uid]).map(x => {
      const p = res.per[x.uid];
      const offDay = new Map(p.offReq.concat(p.offAuto.map(d => [d, 'off'])));
      const slotB = new Map(p.slotBlocks);
      const cells = cols.map(cc => at[x.uid + '|' + cc.g] || (slotB.has(cc.g) ? (slotB.get(cc.g) === 'off' ? t('ta.cellOff') : t('ta.cellExam'))
        : offDay.has(cc.d) ? (offDay.get(cc.d) === 'exam' ? t('ta.cellExam') : t('ta.cellOff')) : ''));
      const perWeek = weeks.map(w => res.assign.filter(a => a.uid === x.uid && weekOf(res.days[a.d].date) === w).length);
      return { ta: x, cells, perWeek, total: p.duties, target: p.target };
    });
    // people typed by hand (not in the TA list)
    [...new Set(res.assign.map(a => a.uid).filter(u => u.startsWith('ext:')))].forEach(u => {
      const mine = res.assign.filter(a => a.uid === u);
      rows.push({ ta: { uid: u, name: taName(u) }, cells: cols.map(cc => at[u + '|' + cc.g] || ''),
        perWeek: weeks.map(w => mine.filter(a => weekOf(res.days[a.d].date) === w).length), total: mine.length, target: 0 });
    });
    return { cols, weeks, rows };
  }

  function renderTA() {
    if (state.view !== 'ta') return;
    const c = taCfg(), list = state.ta.list;
    // list
    $('taTbl').querySelector('tbody').innerHTML = list.map((x, i) => `<tr data-uid="${x.uid}">
      <td>${i + 1}</td>
      <td><input value="${esc(x.name)}" data-k="name" placeholder="${esc(t('ta.namePh'))}" style="width:100%;min-width:180px"></td>
      <td><input type="number" min="0" value="${x.offDays != null ? x.offDays : ''}" data-k="offDays" placeholder="${c.offDays}" class="seats"></td>
      <td><input type="number" min="0" value="${x.duties != null ? x.duties : ''}" data-k="duties" placeholder="${c.duties != null ? c.duties : esc(t('ta.auto'))}" class="seats"></td>
      <td><button class="icon-btn" data-del="${x.uid}" title="${esc(t('btn.remove'))}">×</button></td></tr>`).join('') ||
      `<tr><td colspan="5" class="muted">${esc(t('ta.none'))}</td></tr>`;
    if (!$('taListMsg').textContent && list.length) $('taListMsg').textContent = t('ta.count', { n: list.length });
    // rules
    const days = examDays(cfg()), dem = state.results[mode] ? taDemand() : null;
    $('taExam').value = mode;
    $('taPerRoom').value = c.perRoom; $('taOffDays').value = c.offDays; $('taDuties').value = c.duties != null ? c.duties : '';
    $('taSpread').value = c.spread || 'spread'; $('taPosts').value = (c.posts || []).join('\n');
    $('taOffD').textContent = t('ta.offD', { n: days.length });
    const nTA = taList().length;
    $('taDutiesD').textContent = t('ta.dutiesD', { n: dem && nTA ? Math.ceil(dem.total / nTA) : '—' });
    $('taRoomTbl').querySelector('tbody').innerHTML = cfg().rooms.map(rm => `<tr data-room="${esc(rm.name)}"><td>${esc(rm.name)}</td><td>${esc(rm.seats)}</td>
      <td><input type="number" min="0" class="seats" value="${c.roomTAs[rm.name] != null ? c.roomTAs[rm.name] : ''}" placeholder="${c.perRoom}"></td></tr>`).join('') ||
      `<tr><td colspan="3" class="muted">${esc(t('rooms.empty'))}</td></tr>`;
    // requests
    const taOpts = cur => `<option value="">${esc(t('ta.pickTA'))}</option>` + taList().map(x => `<option value="${x.uid}" ${x.uid === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    $('taReqTbl').querySelector('tbody').innerHTML = c.requests.map((q, i) => `<tr data-i="${i}">
      <td><select data-k="uid">${taOpts(q.uid)}</select></td>
      <td><select data-k="date">${days.map(d => `<option value="${d.date}" ${d.date === q.date ? 'selected' : ''}>${esc(wdName(d.date))} ${fmtDate(d.date)}</option>`).join('')}</select></td>
      <td><select data-k="slot"><option value="-1">${esc(t('ta.allDay'))}</option>${cfg().slots.map((sl, si) => `<option value="${si}" ${si === q.slot ? 'selected' : ''}>${esc(sl)}</option>`).join('')}</select></td>
      <td><select data-k="kind"><option value="off" ${q.kind !== 'exam' ? 'selected' : ''}>${esc(t('ta.kindOff'))}</option><option value="exam" ${q.kind === 'exam' ? 'selected' : ''}>${esc(t('ta.kindExam'))}</option></select></td>
      <td><input value="${esc(q.note || '')}" data-k="note" placeholder="${esc(t('ta.notePh'))}"></td>
      <td><button class="icon-btn" data-del="${i}" title="${esc(t('btn.remove'))}">×</button></td></tr>`).join('') ||
      `<tr><td colspan="6" class="muted">—</td></tr>`;
    renderTAResult();
  }

  function renderTAResult() {
    const res = state.ta.result[mode];
    $('taOut').classList.toggle('hidden', !res);
    const warn = [];
    if (!state.results[mode]) warn.push(`<div class="warn">${esc(t('ta.errNoSchedule', { exam: examName() }))}</div>`);
    if (!res) { $('taWarn').innerHTML = warn.join(''); return; }
    if (res.sig !== taSignature()) warn.push(`<div class="warn">${esc(t('ta.stale'))}</div>`);
    const S = res.slots.length, timeLabel = (d, s) => `${wdName(res.days[d].date)} ${fmtDate(res.days[d].date)}, ${res.slots[s]}`;
    const shortBy = {};
    res.shortages.forEach(z => (shortBy[z.g] = shortBy[z.g] || { d: z.d, s: z.s, n: 0, posts: [] }, shortBy[z.g].n += z.n, shortBy[z.g].posts.push(z.n > 1 ? `${z.post} ×${z.n}` : z.post)));
    Object.entries(shortBy).forEach(([g, z]) => warn.push(`<div class="err msg-row"><div><b>${esc(timeLabel(z.d, z.s))}</b> — ${esc(t('ta.shortage', { n: z.n, room: z.posts.join(state.lang === 'ar' ? '، ' : ', ') }))}</div><button class="btn small" data-fixg="${g}">${esc(t('ta.fix'))}</button></div>`));
    (res.unequal || []).forEach(u => warn.push(`<div class="warn">${esc(t('ta.unequal', { name: taName(u.uid), have: u.have, want: u.want }))}</div>`));
    const lost = Object.values(res.per).filter(p => p.lost).length;
    if (lost) warn.push(`<div class="warn">${esc(t('ta.lostOff', { n: lost }))}</div>`);
    if (res.edited) warn.push(`<div class="muted">${esc(t('ta.editedNote'))}</div>`);
    $('taWarn').innerHTML = warn.join('');
    $('taUndo').hidden = !taUndo.length;
    const missing = res.shortages.reduce((a, z) => a + z.n, 0);
    const counts = Object.values(res.per).map(p => p.duties);
    $('taSummary').innerHTML = [
      [res.total, t('ta.sNeeded'), ''], [res.assign.filter(a => !a.reserve).length, t('ta.sFilled'), 'good'], [missing, t('ta.sMissing'), missing ? 'bad' : 'good'],
      [counts.length, t('ta.sTAs'), ''], [counts.length ? (Math.min(...counts) === Math.max(...counts) ? String(counts[0]) : Math.min(...counts) + '–' + Math.max(...counts)) : '—', t('ta.sRange'), counts.length && Math.min(...counts) === Math.max(...counts) ? 'good' : 'mid'],
      [res.reserves || 0, t('ta.sReserve'), '']
    ].map(([v, l, k]) => `<div class="stat ${k}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
    // timetable
    const mx = taMatrix(res), q = $('taFilter').value.trim().toLowerCase();
    const head1 = `<tr><th rowspan="2">#</th><th rowspan="2">${esc(t('ta.thName'))}</th>` +
      res.days.map(d => `<th colspan="${S}" class="mx-day">${esc(wdName(d.date))}<br><small>${fmtDate(d.date)}</small></th>`).join('') +
      mx.weeks.map((w, i) => `<th rowspan="2">${esc(t('ta.week', { n: i + 1 }))}</th>`).join('') + `<th rowspan="2">${esc(t('ta.total'))}</th></tr>`;
    const head2 = '<tr>' + res.days.map(() => res.slots.map(sl => `<th class="mx-slot" dir="ltr">${esc(sl)}</th>`).join('')).join('') + '</tr>';
    const body = mx.rows.filter(x => !q || x.ta.name.toLowerCase().includes(q)).map((x, i) => `<tr data-uid="${esc(x.ta.uid)}"><td>${i + 1}</td><td class="mx-name">${esc(x.ta.name)}</td>` +
      x.cells.map((v, k) => `<td data-g="${mx.cols[k].g}" class="mx-cell ${v === t('ta.cellOff') ? 'mx-off' : v === t('ta.cellExam') ? 'mx-exam' : v === t('ta.reserve') ? 'mx-res' : v ? 'mx-on' : ''}">${esc(v)}</td>`).join('') +
      x.perWeek.map(n => `<td class="mx-sum">${n}</td>`).join('') + `<td class="mx-sum"><b>${x.total}</b></td></tr>`).join('');
    $('taMatrix').innerHTML = `<thead>${head1}${head2}</thead><tbody>${body}</tbody>`;
    // by exam time
    let html = '';
    res.days.forEach((d, di) => res.slots.forEach((sl, s) => {
      const g = di * S + s;
      const seats = res.assign.map((a, i) => [a, i]).filter(([a]) => a.g === g);
      const short = res.shortages.map((z, i) => [z, i]).filter(([z]) => z.g === g && z.n > 0);
      if (!seats.length && !short.length) return;
      html += `<div class="room-cell" data-g="${g}"><div class="room-head"><b>${esc(wdName(d.date))} ${fmtDate(d.date)}</b> · <span dir="ltr">${esc(sl)}</span></div><div class="room-list">` +
        seats.filter(([a]) => !a.reserve).map(([a, i]) => `<button type="button" class="room seat" data-ai="${i}"><b>${esc(a.post)}</b> ${esc(taName(a.uid))}</button>`).join('') +
        (seats.some(([a]) => a.reserve) ? `<span class="room reserve" title="${esc(t('ta.reserveTip'))}"><b>${esc(t('ta.reserve'))}</b> ${seats.filter(([a]) => a.reserve).map(([a]) => esc(taName(a.uid))).join('، ')}</span>` : '') +
        short.map(([z, i]) => `<button type="button" class="room seat bad-room" data-si="${i}"><b>${esc(z.post)}</b> ${esc(t('ta.missing'))} ×${z.n}</button>`).join('') + '</div></div>';
    }));
    $('taPlan').innerHTML = html;
    if (taEditSeat) openTAEditor(taEditSeat, null, true);
  }
  $('taFilter').addEventListener('input', renderTAResult);

  // ---- change who covers a place by hand ----
  const taName = uid => (String(uid).startsWith('ext:') ? uid.slice(4) : ((taById(uid) || {}).name || '?'));
  let taUndo = [], taEditSeat = null;
  // who could cover place at time g, best first
  // who could cover a place at time g, grouped by what happens if you pick them, best first
  const CAND_GROUPS = { free: 'ta.gFree', reserve: 'ta.gReserve', moveKeep: 'ta.gMoveKeep', dayOff: 'ta.gDayOff', moveEmpty: 'ta.gMoveEmpty', swap: 'ta.gSwap', req: 'ta.gReq' };
  function taCandidates(res, g, currentUid, emptySeat) {
    const S = res.slots.length, d = Math.floor(g / S);
    const busy = new Map(res.assign.filter(a => a.g === g && !a.reserve).map(a => [a.uid, a.post]));
    const onReserve = new Set(res.assign.filter(a => a.g === g && a.reserve).map(a => a.uid));
    const inPost = {};
    res.assign.filter(a => a.g === g && !a.reserve).forEach(a => (inPost[a.post] = (inPost[a.post] || 0) + 1));
    const order = emptySeat ? ['free', 'reserve', 'moveKeep', 'dayOff', 'moveEmpty', 'req'] : ['free', 'reserve', 'swap', 'dayOff', 'req'];
    const out = [];
    for (const x of taList()) {
      if (x.uid === currentUid) continue;
      const p = res.per[x.uid] || { offReq: [], offAuto: [], slotBlocks: [], duties: 0, target: 0 };
      const req = new Map(p.offReq), slotB = new Map(p.slotBlocks);
      const today = res.assign.filter(a => a.uid === x.uid && a.d === d && !a.reserve).length;
      let group, label = x.name, post = '', keeps = 0;
      if (slotB.has(g) || req.has(d)) { group = 'req'; label += ' · ' + t((slotB.get(g) || req.get(d)) === 'exam' ? 'ta.oExam' : 'ta.oReq'); }
      else if (busy.has(x.uid)) {
        post = busy.get(x.uid); keeps = inPost[post] - 1;
        group = !emptySeat ? 'swap' : keeps > 0 ? 'moveKeep' : 'moveEmpty';
        label += ' · ' + t(group === 'moveKeep' ? 'ta.oInKeep' : 'ta.oIn', { post, n: keeps });
      }
      else if (p.offAuto.includes(d)) group = 'dayOff';
      else if (onReserve.has(x.uid)) group = 'reserve';
      else { group = 'free'; if (today) label += ' · ' + t('ta.oToday', { n: today }); }
      out.push({ uid: x.uid, name: x.name, group, label, post, keeps, sortKey: [order.indexOf(group), (p.duties || 0) - (p.target || 0), today] });
    }
    return { order, list: out.sort((a, b) => cmpKey(a.sortKey, b.sortKey)) };
  }
  function adviceFor(best, dayLabel) {
    if (!best) return null;
    const k = { free: 'ta.bFree', reserve: 'ta.bReserve', moveKeep: 'ta.bMoveKeep', dayOff: 'ta.bDayOff', swap: 'ta.bSwap', moveEmpty: 'ta.bMoveEmpty', req: 'ta.bReq' }[best.group];
    return t(k, { name: best.name, post: best.post, n: best.keeps, day: dayLabel });
  }
  function openTAEditor(seat, anchor, keepPlace) {
    const res = state.ta.result[mode]; if (!res) return;
    const a = seat.ai != null ? res.assign[seat.ai] : null, z = seat.si != null ? res.shortages[seat.si] : null;
    if (!a && !(z && z.n > 0)) { closeTAEditor(); return; }
    taEditSeat = seat;
    const g = a ? a.g : z.g, post = a ? a.post : z.post, S = res.slots.length, d = Math.floor(g / S);
    const dayLabel = `${wdName(res.days[d].date)} ${fmtDate(res.days[d].date)}`;
    const { order, list } = taCandidates(res, g, a ? a.uid : null, !a);
    const opts = order.map(gk => {
      const l = list.filter(c => c.group === gk);
      return l.length ? `<optgroup label="${esc(t(CAND_GROUPS[gk]))}">${l.map(c => `<option value="${esc(c.uid)}" ${seat.pre === c.uid ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    // suggest someone only when the choice really helps (never empties another room or breaks a request)
    const best = list.find(c => ['free', 'reserve', 'moveKeep', 'dayOff'].includes(c.group) || (a && c.group === 'swap'));
    const advice = adviceFor(best, dayLabel) || t(a ? 'ta.noFreeFilled' : 'ta.noFree');
    let box = $('taEditor');
    if (!box) { box = document.createElement('div'); box.id = 'taEditor'; box.className = 'ta-editor'; }
    box.innerHTML = `<div class="ed-title">${esc(t('ta.edTitle', { post }))} <span class="muted">${esc(dayLabel)} · <span dir="ltr">${esc(res.slots[g % S])}</span></span></div>
      <div class="muted">${esc(a ? t('ta.now', { name: taName(a.uid) }) : t('ta.nowEmpty'))}</div>
      <div class="${best ? 'ok' : 'warn'}">${esc(advice)}</div>
      <div class="row wrap">
        <select id="taEdSel"><option value="">${esc(t('ta.choose'))}</option>${opts}<optgroup label="${esc(t('ta.gOther'))}"><option value="__other__">${esc(t('ta.other'))}</option>${a ? `<option value="__empty__">${esc(t('ta.empty'))}</option>` : ''}</optgroup></select>
        <input id="taEdOther" placeholder="${esc(t('ta.otherPh'))}" hidden>
        <button class="btn primary small" id="taEdApply">${esc(t('ta.apply'))}</button>
        <button class="btn small" id="taEdClose">${esc(t('ta.close'))}</button>
      </div>
      <div class="muted" id="taEdEffect"></div>`;
    if (!keepPlace || !box.isConnected) {
      const place = anchor || $('taPlan').querySelector(`.room-cell[data-g="${g}"]`) || $('taWarn');
      place.after(box);
    }
    if (!seat.pre && best) $('taEdSel').value = best.uid;
    // say what will happen for the person currently selected
    const showEffect = () => {
      const v = $('taEdSel').value, c = list.find(x => x.uid === v);
      $('taEdOther').hidden = v !== '__other__';
      $('taEdEffect').textContent = c ? (best && c.uid === best.uid ? '' : adviceFor(c, dayLabel).replace(/^[^:：]*[:：]\s*/, '')) : v === '__other__' ? t('ta.eOther') : v === '__empty__' ? t('ta.eEmpty') : '';
    };
    $('taEdSel').onchange = () => { showEffect(); if (!$('taEdOther').hidden) $('taEdOther').focus(); };
    showEffect();
    $('taEdClose').onclick = closeTAEditor;
    $('taEdApply').onclick = () => {
      let v = $('taEdSel').value;
      if (v === '__other__') { const nm = $('taEdOther').value.trim(); if (!nm) { $('taEdOther').focus(); return; } v = 'ext:' + nm; }
      if (!v) return;
      applyTAEdit(seat, v);
    };
    if (!keepPlace) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function closeTAEditor() { taEditSeat = null; const b = $('taEditor'); if (b) b.remove(); }
  function applyTAEdit(seat, newUid) {
    const res = state.ta.result[mode];
    taUndo.push(JSON.stringify({ assign: res.assign, shortages: res.shortages, per: res.per, edited: res.edited }));
    if (taUndo.length > 30) taUndo.shift();
    const S = res.slots.length;
    const a = seat.ai != null ? res.assign[seat.ai] : null, z = seat.si != null ? res.shortages[seat.si] : null;
    const g = a ? a.g : z.g, d = Math.floor(g / S), post = a ? a.post : z.post, courses = a ? a.courses : [];
    const oldUid = a ? a.uid : null;
    const addShort = () => { const ex = res.shortages.find(x => x.g === g && x.post === post); if (ex) ex.n++; else res.shortages.push({ g, d, s: g % S, post, n: 1 }); };
    if (newUid === '__empty__') { res.assign.splice(seat.ai, 1); addShort(); }
    else {
      // if the new person is busy elsewhere at this time, swap them
      res.assign = res.assign.filter(x => !(x.reserve && x.g === g && x.uid === newUid));
      const other = res.assign.find(x => x.g === g && x.uid === newUid && !x.reserve);
      if (other) {
        if (oldUid) other.uid = oldUid;
        else { res.assign.splice(res.assign.indexOf(other), 1); res.shortages.push({ g, d, s: g % S, post: other.post, n: 1 }); }
      }
      if (a) a.uid = newUid;
      else { res.assign.push({ g, d, s: g % S, post, courses, uid: newUid }); z.n--; }
      const p = res.per[newUid];
      if (p && p.offAuto.includes(d)) { p.offAuto = p.offAuto.filter(x => x !== d); p.lost = (p.lost || 0) + 1; }
    }
    res.shortages = res.shortages.filter(x => x.n > 0);
    // merge shortages for the same place
    const m = {}; res.shortages.forEach(x => { const k = x.g + '|' + x.post; if (m[k]) m[k].n += x.n; else m[k] = x; }); res.shortages = Object.values(m);
    equalizeTA(res);
    res.edited = true; save();
    closeTAEditor(); renderTAResult();
  }
  $('taUndo').onclick = () => {
    const res = state.ta.result[mode]; if (!res || !taUndo.length) return;
    Object.assign(res, JSON.parse(taUndo.pop())); save(); closeTAEditor(); renderTAResult();
  };
  $('taPlan').addEventListener('click', ev => {
    const b = ev.target.closest('.seat'); if (!b) return;
    openTAEditor(b.dataset.ai != null ? { ai: +b.dataset.ai } : { si: +b.dataset.si }, b.closest('.room-cell'));
  });
  $('taWarn').addEventListener('click', ev => {
    const g = ev.target.dataset.fixg; if (g == null) return;
    const res = state.ta.result[mode], si = res.shortages.findIndex(z => z.g === +g && z.n > 0);
    if (si >= 0) openTAEditor({ si }, ev.target.closest('div'));
  });
  $('taMatrix').addEventListener('click', ev => {
    const td = ev.target.closest('td.mx-cell'); if (!td) return;
    const res = state.ta.result[mode], g = +td.dataset.g, uid = td.parentNode.dataset.uid;
    const ai = res.assign.findIndex(a => a.g === g && a.uid === uid && !a.reserve);
    if (ai >= 0) return openTAEditor({ ai }, $('taMatrix').parentNode);
    // empty cell: offer this TA for a missing place at that time
    const si = res.shortages.findIndex(z => z.g === g && z.n > 0);
    if (si >= 0) openTAEditor({ si, pre: uid }, $('taMatrix').parentNode);
  });

  // downloads
  document.querySelector('[data-sec=taResult] .downloads').addEventListener('click', ev => {
    const kind = ev.target.dataset && ev.target.dataset.tadl; if (!kind) return;
    const res = state.ta.result[mode]; if (!res) return;
    const X = k => t('x.' + k), S = res.slots.length;
    const wb = XLSX.utils.book_new();
    if (state.lang === 'ar') wb.Workbook = { Views: [{ RTL: true }] };
    const add = (ws, name) => XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    const mx = taMatrix(res);
    const matrixSheet = () => {
      const h1 = ['#', X('TA')], h2 = ['', ''];
      res.days.forEach(d => res.slots.forEach((sl, s) => { h1.push(s === 0 ? `${wdName(d.date)} – ${fmtDate(d.date)}` : ''); h2.push(sl); }));
      mx.weeks.forEach((w, i) => { h1.push(t('ta.week', { n: i + 1 })); h2.push(''); });
      h1.push(t('ta.total')); h2.push('');
      const aoa = [h1, h2].concat(mx.rows.map((x, i) => [i + 1, x.ta.name, ...x.cells, ...x.perWeek, x.total]));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = res.days.map((d, di) => ({ s: { r: 0, c: 2 + di * S }, e: { r: 0, c: 2 + di * S + S - 1 } })).filter(m => S > 1);
      ws['!cols'] = [{ wch: 4 }, { wch: 26 }].concat(new Array(res.days.length * S).fill({ wch: 12 }));
      return ws;
    };
    const byRoom = res.assign.slice().sort((a, b) => a.g - b.g || String(a.post).localeCompare(String(b.post))).map(a => ({
      [X('Day')]: wdName(res.days[a.d].date), [X('Date')]: fmtDate(res.days[a.d].date), [X('Time')]: res.slots[a.s], [X('Post')]: postLabel(a.post),
      [X('Courses')]: a.courses.join(', '), [X('TA')]: taName(a.uid) }))
      .concat(res.shortages.map(z => ({ [X('Day')]: wdName(res.days[z.d].date), [X('Date')]: fmtDate(res.days[z.d].date), [X('Time')]: res.slots[z.s], [X('Post')]: z.post, [X('Courses')]: '', [X('TA')]: t('ta.missing') + ' ×' + z.n })));
    const offRows = [];
    taList().forEach(x => {
      const p = res.per[x.uid]; if (!p) return;
      const notes = taCfg().requests.filter(q => q.uid === x.uid);
      p.offReq.forEach(([d, kind]) => offRows.push({ [X('TA')]: x.name, [X('Day')]: wdName(res.days[d].date), [X('Date')]: fmtDate(res.days[d].date), [X('Time')]: t('ta.allDay'), [X('Type')]: X('Requested') + ' · ' + t(kind === 'exam' ? 'ta.kindExam' : 'ta.kindOff'), [X('Note')]: (notes.find(q => q.date === res.days[d].date && q.slot < 0) || {}).note || '' }));
      p.slotBlocks.forEach(([g, kind]) => offRows.push({ [X('TA')]: x.name, [X('Day')]: wdName(res.days[Math.floor(g / S)].date), [X('Date')]: fmtDate(res.days[Math.floor(g / S)].date), [X('Time')]: res.slots[g % S], [X('Type')]: X('Requested') + ' · ' + t(kind === 'off' ? 'ta.kindOff' : 'ta.kindExam'), [X('Note')]: (notes.find(q => q.date === res.days[Math.floor(g / S)].date && q.slot === g % S) || {}).note || '' }));
      p.offAuto.forEach(d => offRows.push({ [X('TA')]: x.name, [X('Day')]: wdName(res.days[d].date), [X('Date')]: fmtDate(res.days[d].date), [X('Time')]: t('ta.allDay'), [X('Type')]: X('Given'), [X('Note')]: '' }));
    });
    const sheet = rows => XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': t('x.none') }]);
    const kinds = kind === 'all' ? ['matrix', 'byRoom', 'off'] : [kind];
    if (kinds.includes('matrix')) add(matrixSheet(), t('sh.taMatrix'));
    if (kinds.includes('byRoom')) add(sheet(byRoom), t('sh.taSchedule'));
    if (kinds.includes('off')) add(sheet(offRows), t('sh.taOff'));
    const label = mode === 'final' ? 'Final' : 'Midterm';
    const base = { all: 'TA_invigilation', matrix: 'TA_timetable', byRoom: 'TA_schedule_by_room', off: 'TA_days_off' }[kind];
    saveFile(`${label}_${base}.xlsx`, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $('taDlMsg'));
  });

  function renderAll() {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', state.view === 'ta' ? x.dataset.view === 'ta' : x.dataset.mode === mode));
    applyOrder(); renderEnrInfo(); renderExtra(); renderRooms(); renderForm(); renderFixed(); renderResults(); renderTA();
  }
  applyTheme();
  applyLang();
  renderAll();
})();
