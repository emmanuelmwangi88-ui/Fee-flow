/* ==========================================================================
   FeeFlow shared UI kit — icons, toasts, formatting helpers, school levels.
   Load order: vendor/supabase-*.js -> config.js -> ff-client.js -> ff-ui.js
   Nothing here talks to the database: it is presentation only.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------- icons --- */
  const P = {
    school: '<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/>',
    dashboard: '<rect x="3" y="3" width="7" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M22 20v-2a4 4 0 0 0-3-3.85M16.5 4.2a3.2 3.2 0 0 1 0 5.6"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="3.5"/>',
    student: '<path d="M12 4 2 9l10 5 10-5-10-5Z"/><path d="M6 11.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5"/><path d="M22 9v5"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
    receipt: '<path d="M5 3h14v18l-2.3-1.5L14.4 21l-2.4-1.5L9.6 21 7.3 19.5 5 21V3Z"/><path d="M9 8h6M9 12h6"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v0c.27.6.86 1 1.51 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    times: '<path d="M6 6l12 12M18 6 6 18"/>',
    timesCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 17h10v4H7z"/>',
    download: '<path d="M12 3v12m0 0 4.5-4.5M12 15 7.5 10.5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 21V9m0 0 4.5 4.5M12 9 7.5 13.5"/><path d="M4 4h16"/>',
    send: '<path d="M21 3 11 13"/><path d="M21 3l-7 18-3.5-7.5L3 10l18-7Z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    phone: '<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2.5 2.5 0 0 1-2.7 2.5C10.5 19.4 4.6 13.5 4 5.7A2.5 2.5 0 0 1 6.5 3Z"/>',
    mail: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3 7 9 6 9-6"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4.5M12 17.6h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    logout: '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    bank: '<path d="M3 10 12 4l9 6"/><path d="M5 10v9h14v-9"/><path d="M9 19v-5h6v5M3 21h18"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v6M18 9v6"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5 17.5 9.5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5"/>',
    link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 13 4.5a4 4 0 0 1 5.7 5.7l-2 2"/><path d="M13 17.5l-2 2A4 4 0 0 1 5.3 13.8l2-2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
    refresh: '<path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
    shield: '<path d="M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    mobile: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    chevronLeft: '<path d="m15 5-7 7 7 7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    arrowRight: '<path d="M4 12h15m0 0-5.5-5.5M19 12l-5.5 5.5"/>',
    arrowLeft: '<path d="M20 12H5m0 0 5.5-5.5M5 12l5.5 5.5"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5Z"/>',
    wand: '<path d="M15 4V2M15 22v-2M8.5 8.5 7 7M22 15h-2M4 15H2M8.5 21.5 7 23"/><path d="m14.5 12.5 5 5"/><path d="M12.5 9.5 9 13l2 2 3.5-3.5-2-2Z"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V2.5h6V4"/><path d="M9 10h6M9 14h4"/>',
    swap: '<path d="M8 4 4 8l4 4"/><path d="M4 8h13a4 4 0 0 1 0 8h-3"/><path d="m16 20 4-4-4-4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 3 3-3 3-2-2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17"/><path d="M12 3c2.5 2.5 2.5 15 0 18M12 3C9.5 5.5 9.5 18.5 12 21"/>'
  };

  function ico(name, cls) {
    const path = P[name] || P.info;
    return '<svg class="ff-ico ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  function paint(root) {
    const scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('i[data-ico]').forEach(function (el) {
      if (el.dataset.ffDone) return;
      const size = el.getAttribute('data-size') || '';
      const cls = 'ff-ico ' + size;
      const wrap = document.createElement('span');
      wrap.innerHTML = ico(el.getAttribute('data-ico'), cls);
      const svg = wrap.firstChild;
      svg.setAttribute('data-ico', el.getAttribute('data-ico'));   // survive the swap
      if (el.className) svg.setAttribute('class', 'ff-ico ' + size + ' ' + el.className);
      if (el.getAttribute('style')) svg.setAttribute('style', el.getAttribute('style'));
      el.replaceWith(svg);
    });
  }

  /* --------------------------------------------------------- formatting -- */
  const money = (n) => 'KES ' + (Number(n) || 0).toLocaleString('en-KE');
  const num = (n) => (Number(n) || 0).toLocaleString('en-KE');
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const initials = (name) => String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (v) => v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  function timeAgo(iso) {
    if (!iso) return '—';
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'Just now';
    const m = Math.floor(s / 60); if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60); if (h < 24) return h + ' hour' + (h > 1 ? 's' : '') + ' ago';
    const d = Math.floor(h / 24); if (d < 7) return d + ' day' + (d > 1 ? 's' : '') + ' ago';
    return fmtDate(iso);
  }
  const PALETTE = ['#1a6dcc', '#059669', '#7c3aed', '#d97706', '#dc2626', '#0891b2', '#4f46e5', '#db2777'];
  function colorFor(id) {
    let h = 0; const s = String(id == null ? 'x' : id);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const c = PALETTE[h % PALETTE.length];
    return 'linear-gradient(135deg,' + c + ',#0c2d57)';
  }
  function normalizeKePhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (/^254[17]\d{8}$/.test(d)) return d;
    if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1);
    if (/^[17]\d{8}$/.test(d)) return '254' + d;
    return null;
  }

  /* ------------------------------------------------------------- toasts -- */
  const TOAST_ICON = { info: 'info', success: 'checkCircle', error: 'timesCircle', warning: 'alert' };
  const TOAST_COLOR = { info: 'var(--ff-blue)', success: 'var(--ff-green)', error: 'var(--ff-red)', warning: 'var(--ff-amber)' };
  function toast(message, type) {
    type = type || 'info';
    let box = document.getElementById('toastContainer');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastContainer';
      box.className = 'ff-toasts';
      // A live region has to exist in the DOM BEFORE its content is inserted, or screen
      // readers never announce it. The container is the stable element, so it carries the
      // region; the individual toasts stay plain so they are not announced twice.
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      box.setAttribute('aria-atomic', 'false');
      document.body.appendChild(box);
    } else if (!box.getAttribute('aria-live')) {
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      box.setAttribute('aria-atomic', 'false');
    }
    const el = document.createElement('div');
    el.className = 'toast ff-toast ' + type;
    const i = document.createElement('i');
    i.innerHTML = ico(TOAST_ICON[type] || 'info');
    i.firstChild.style.color = TOAST_COLOR[type] || TOAST_COLOR.info;
    el.appendChild(i.firstChild);
    el.appendChild(document.createTextNode(' ' + message));   // never innerHTML: text is data
    box.appendChild(el);
    const kill = () => { el.style.opacity = '0'; el.style.transform = 'translateX(14px)'; setTimeout(() => el.remove(), 320); };
    setTimeout(kill, type === 'error' ? 6500 : 3600);
    while (box.children.length > 4) box.firstChild.remove();
  }

  /* ------------------------------------------------------------- modals -- */
  function openModal(id) { const m = document.getElementById('modal-' + id); if (m) m.classList.add('open'); }
  function closeModal(id) { const m = document.getElementById('modal-' + id); if (m) m.classList.remove('open'); }
  function wireModals() {
    document.querySelectorAll('.ff-modal').forEach(function (m) {
      if (m.dataset.wired) return;
      m.dataset.wired = '1';
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') document.querySelectorAll('.ff-modal.open').forEach(m => m.classList.remove('open'));
    });
  }

  /* ---------------------------------------------- sidebar: minimise / hide --- */
  /* Two remembered desktop states: "collapsed" (icon rail) and "hidden" (no sidebar).
     Both live on <body> so every page shares them, and are stored per browser. */
  var NAV_KEY = 'ff.nav';
  function readNav() { try { return JSON.parse(localStorage.getItem(NAV_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setNavState(which, on) {
    document.body.classList.toggle('ff-nav-' + which, !!on);
    var st = readNav(); st[which] = !!on;
    try { localStorage.setItem(NAV_KEY, JSON.stringify(st)); } catch (e) { /* private mode: fine */ }
    syncNavButtons();
  }
  function applyNavState() {
    var st = readNav();
    document.body.classList.toggle('ff-nav-collapsed', !!st.collapsed);
    document.body.classList.toggle('ff-nav-hidden', !!st.hidden);
  }
  function syncNavButtons() {
    var collapsed = document.body.classList.contains('ff-nav-collapsed');
    document.querySelectorAll('.ff-collapse-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
      b.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Minimise sidebar');
      b.title = collapsed ? 'Expand sidebar' : 'Minimise sidebar';
    });
  }
  /* Adds the minimise button and hover labels. Runs again whenever markup is added,
     because parent.html builds its whole shell after loading. */
  function decorateNav(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.ff-brand').forEach(function (brand) {
      if (!brand.closest('.ff-sidebar') || brand.querySelector('.ff-collapse-btn')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ff-collapse-btn';
      b.innerHTML = ico('chevronLeft', 'ff-ico-sm');
      brand.appendChild(b);
    });
    scope.querySelectorAll('.ff-nav-item').forEach(function (it) {
      if (!it.title) it.title = (it.textContent || '').replace(/\s+/g, ' ').trim().replace(/\s\d+$/, '');
    });
    syncNavButtons();
  }

  var decorateTimer = null;
  function scheduleDecorate() {
    if (decorateTimer) return;               // one pass per burst of DOM changes, never one per node
    decorateTimer = setTimeout(function () { decorateTimer = null; decorateNav(document); }, 60);
  }

  /* -------------------------------------------------------- navigation --- */
  var navWired = false;
  function wireNav() {
    if (navWired) return;
    navWired = true;

    /* The hamburger is found by DELEGATION, not by attaching a listener to the button.
       parent.html builds its whole shell (document.getElementById('app').innerHTML = ...)
       only after an async load finishes, which throws away every listener attached to the
       original markup — so the button that ends up on screen had no handler and the drawer
       never opened. Listening on document and walking up with closest() means the handler
       lives for the life of the page and works for any button, present or future. */
    document.addEventListener('click', function (e) {
      const t = e.target;
      if (!t || !t.closest) return;

      const toggle = t.closest('[data-ff-nav-toggle]');
      if (toggle) {
        // phones and tablets: slide-in drawer. Desktop: hide / show the whole sidebar.
        if (window.innerWidth <= 980) document.body.classList.toggle('ff-nav-open');
        else setNavState('hidden', !document.body.classList.contains('ff-nav-hidden'));
        return;
      }
      const mini = t.closest('.ff-collapse-btn');
      if (mini) { setNavState('collapsed', !document.body.classList.contains('ff-nav-collapsed')); return; }
      // tapping a nav item closes the drawer on a phone
      if (!document.body.classList.contains('ff-nav-open')) return;
      const item = t.closest('.ff-nav-item');
      if (item && window.innerWidth <= 980) document.body.classList.remove('ff-nav-open');
    });

    let bd = document.getElementById('ffBackdrop');
    if (!bd) { bd = document.createElement('div'); bd.id = 'ffBackdrop'; bd.className = 'ff-backdrop'; document.body.appendChild(bd); }
    bd.addEventListener('click', function () { document.body.classList.remove('ff-nav-open'); });
  }

  /* -------------------------------------------------------------- theme -- */
  function setTheme(mode) {
    try { localStorage.setItem('ffTheme', mode); } catch (e) { /* private mode */ }
    const dark = mode === 'dark' || (mode === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const sel = document.getElementById('themeSelect');
    if (sel && document.activeElement !== sel) sel.value = mode || 'light';
  }
  function loadTheme() {
    let mode = 'light';
    try { mode = localStorage.getItem('ffTheme') || 'light'; } catch (e) { /* ignore */ }
    setTheme(mode);
    return mode;
  }

  /* ------------------------------------------------- school level logic -- */
  /* A school's level decides which grades exist. This is the single source
     of truth used by registration, the school admin dashboard and the fee
     structure manager, so a primary school never sees Form 1 and a secondary
     school never sees PP1.                                                   */
  function levelFlags(level) {
    const v = String(level || '').toLowerCase();
    const primary = /primary|pre-?school/.test(v);
    const secondary = /secondary|high school|college/.test(v);
    if (!primary && !secondary) return { primary: true, secondary: true, known: false };
    return { primary, secondary, known: true };
  }
  function levelLabel(level) {
    const f = levelFlags(level);
    if (f.primary && f.secondary) return 'Primary & secondary school';
    return f.primary ? 'Primary school' : 'Secondary school';
  }
  function levelKind(level) {
    const f = levelFlags(level);
    if (f.primary && f.secondary) return 'both';
    return f.primary ? 'primary' : 'secondary';
  }
  const GRADE_SETS = {
    cbcPrimary: ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'],
    cbcJunior: ['Grade 7', 'Grade 8', 'Grade 9'],
    cbcSenior: ['Grade 10', 'Grade 11', 'Grade 12'],
    p844Primary: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8'],
    p844Secondary: ['Form 1', 'Form 2', 'Form 3', 'Form 4']
  };
  /** Builds the level/grade skeleton for a school. */
  function structureFor(level, curriculum) {
    const f = levelFlags(level);
    const cbc = curriculum !== '844';
    const levels = [];
    if (f.primary) levels.push({ name: 'Primary', grades: (cbc ? GRADE_SETS.cbcPrimary : GRADE_SETS.p844Primary).map(mkGrade) });
    if (f.secondary) {
      if (cbc) {
        levels.push({ name: 'Junior School', grades: GRADE_SETS.cbcJunior.map(mkGrade) });
        levels.push({ name: 'Senior School', grades: GRADE_SETS.cbcSenior.map(mkGrade) });
      } else {
        levels.push({ name: 'Secondary', grades: GRADE_SETS.p844Secondary.map(mkGrade) });
      }
    }
    if (!levels.length) levels.push({ name: 'Primary', grades: GRADE_SETS.cbcPrimary.map(mkGrade) });
    return levels;
  }
  function mkGrade(name) { return { name: name, fees: [] }; }
  function curriculumOf(school) {
    const s = (school && school.settings) || {};
    return s.curriculum === '844' ? '844' : 'cbc';
  }

  /* Typical Kenyan school fee items, offered as a starting point only. */
  const FEE_TEMPLATE = [
    { name: 'Tuition', category: 'Tuition', boarderOnly: false },
    { name: 'Lunch / Meals', category: 'Lunch / Meals', boarderOnly: false },
    { name: 'Activity & Co-curricular', category: 'Activity & Co-curricular', boarderOnly: false },
    { name: 'Assessment & Exams', category: 'Assessment & Exams', boarderOnly: false },
    { name: 'Repair & Maintenance', category: 'Repair & Maintenance', boarderOnly: false },
    { name: 'Boarding & Accommodation', category: 'Boarding', boarderOnly: true },
    { name: 'Transport', category: 'Transport', boarderOnly: false }
  ];
  const CATEGORIES = ['Tuition', 'Boarding', 'Lunch / Meals', 'Activity & Co-curricular', 'Assessment & Exams', 'Transport', 'Repair & Maintenance', 'Uniform & Books', 'Insurance', 'Other'];

  /* --------------------------------------------------------------- tab bar -- */
  /* On a phone the sidebar becomes a drawer, which is slow to reach. So we mirror
     the navigation into a bottom tab bar — the pattern every phone app uses.
     Built from the page's own .ff-nav-item list, so it needs no per-page markup
     and stays correct wherever the nav changes.                                       */
  var TABBAR_MAX = 5;
  var navWatch = null;
  function watchForNav() {
    if (navWatch || typeof MutationObserver !== 'function') return;
    navWatch = new MutationObserver(function () {
      if (document.querySelector('.ff-sidebar .ff-nav')) { stopWatching(); buildTabbar(); }
    });
    navWatch.observe(document.body, { childList: true, subtree: true });
  }
  function stopWatching() { if (navWatch) { navWatch.disconnect(); navWatch = null; } }
  function buildTabbar() {
    var old = document.getElementById('ffTabbar');
    if (old) old.remove();
    document.body.classList.remove('ff-has-tabbar');
    if (window.innerWidth > 760) return;
    var nav = document.querySelector('.ff-sidebar .ff-nav');
    if (!nav) { watchForNav(); return; }          // the page has not rendered its shell yet
    stopWatching();
    var items = Array.prototype.slice.call(nav.querySelectorAll('.ff-nav-item'));
    if (items.length < 2) return;
    var chosen = items.slice(0, TABBAR_MAX);
    var bar = document.createElement('nav');
    bar.className = 'ff-tabbar';
    bar.id = 'ffTabbar';
    bar.setAttribute('aria-label', 'Main');
    chosen.forEach(function (item, i) {
      var label = (item.dataset.short || item.getAttribute('title') || item.textContent.replace(/\s+/g, ' ').trim());
      var badge = item.querySelector('.ff-badge, .ff-nav-badge');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ff-tabbar-item' + (item.classList.contains('active') ? ' active' : '');
      btn.setAttribute('aria-current', item.classList.contains('active') ? 'page' : 'false');
      btn.dataset.index = String(i);
      var ic = item.querySelector('[data-ico]');
      btn.innerHTML = '<span class="ff-tabbar-ico"><i data-ico="' + (ic ? ic.getAttribute('data-ico') : 'circle') + '"></i></span>' +
                      '<span class="ff-tabbar-label">' + label + '</span>' +
                      (badge && /\S/.test(badge.textContent) ? '<span class="ff-tabbar-dot"></span>' : '');
      btn.title = label;
      btn.addEventListener('click', function () {
        document.body.classList.remove('ff-nav-open');
        item.click();
        paint(bar);
      });
      bar.appendChild(btn);
    });
    document.body.appendChild(bar);
    paint(bar);
    document.body.classList.add('ff-has-tabbar');
  }
  function syncTabbar() {
    var bar = document.getElementById('ffTabbar');
    if (!bar) return;
    var nav = document.querySelector('.ff-sidebar .ff-nav');
    if (!nav) return;
    var items = Array.prototype.slice.call(nav.querySelectorAll('.ff-nav-item')).slice(0, TABBAR_MAX);
    Array.prototype.slice.call(bar.querySelectorAll('.ff-tabbar-item')).forEach(function (btn, i) {
      var on = items[i] && items[i].classList.contains('active');
      btn.classList.toggle('active', !!on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }
  var tabbarTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(tabbarTimer);
    tabbarTimer = setTimeout(buildTabbar, 150);
  });

  /* --------------------------------------------------------------- boot -- */
  function boot() {
    applyNavState();
    paint(document);
    decorateNav(document);
    buildTabbar();
    wireModals();
    wireNav();
    loadTheme();
    if (typeof MutationObserver === 'function') {
      var navObserver = new MutationObserver(function () { syncTabbar(); });
      var navEl = document.querySelector('.ff-sidebar .ff-nav');
      if (navEl) navObserver.observe(navEl, { subtree: true, attributes: true, attributeFilter: ['class'] });
      new MutationObserver(function (muts) {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1) { paint(n); scheduleDecorate(); if (n.matches && n.matches('.ff-modal')) wireModals(); }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.FFUI = {
    ico: ico, paint: paint, money: money, num: num, cap: cap, initials: initials,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, timeAgo: timeAgo, colorFor: colorFor,
    normalizeKePhone: normalizeKePhone, toast: toast, openModal: openModal, closeModal: closeModal,
    wireNav: wireNav, setNavState: setNavState, decorateNav: decorateNav, wireModals: wireModals, setTheme: setTheme, loadTheme: loadTheme, buildTabbar: buildTabbar, syncTabbar: syncTabbar,
    levelFlags: levelFlags, levelLabel: levelLabel, levelKind: levelKind,
    structureFor: structureFor, mkGrade: mkGrade, curriculumOf: curriculumOf,
    FEE_TEMPLATE: FEE_TEMPLATE, CATEGORIES: CATEGORIES, GRADE_SETS: GRADE_SETS
  };
})();
