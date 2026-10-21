/* FeeFlow Fee Structure Manager: loads / saves the school's fee structure in Supabase.
 * Loaded AFTER the page's own script, which defines: state, TERMS, mkGrade, render, renderGradeRail, renderPreview ...
 *  - "Save Draft"  -> fee_structures (admin's working copy, never visible to parents)
 *  - "Publish"     -> fee_structure_published. The DATABASE then recalculates every student's total fee and
 *                     notifies parents (see supabase/migrations 0002), so totals can never be edited from a browser. */
(async () => {
  'use strict';
  if (!window.FF) { document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">FeeFlow could not load. Check your connection and refresh.</p>'; return; }
  const profile = await FF.requireRole('school_admin');
  if (!profile) return;                                         // sent to the login page
  const sb = FF.sb, schoolId = profile.school_id, esc = FF.escapeHtml;

  // ---------- load ----------
  const [schoolR, draftR, pubR] = await Promise.all([
    sb.from('schools').select('id, name, paybill').eq('id', schoolId).maybeSingle(),
    sb.from('fee_structures').select('draft, term_names, updated_at').eq('school_id', schoolId).maybeSingle(),
    sb.from('fee_structure_published').select('data, term_names, published_at').eq('school_id', schoolId).maybeSingle()
  ]);
  const loadError = schoolR.error || draftR.error || pubR.error;
  const school = schoolR.data || { id: schoolId, name: 'Your School', paybill: '' };
  let canSave = !loadError;                                     // NEVER autosave over a draft we failed to read

  function blankState() {
    return {
      schoolName: school.name, activeLevel: 0, activeGrade: {}, activeTerm: 0, mobileView: 'editor',
      levels: [
        { name: 'Primary', grades: ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'].map(name => ({ name, fees: [] })) },
        { name: 'Junior School', grades: ['Grade 7', 'Grade 8', 'Grade 9'].map(name => ({ name, fees: [] })) },
        { name: 'Secondary', grades: ['Form 1', 'Form 2', 'Form 3', 'Form 4'].map(name => ({ name, fees: [] })) }
      ]
    };
  }
  const hasLevels = (o) => o && Array.isArray(o.levels) && o.levels.length > 0;
  const draft = draftR.data && hasLevels(draftR.data.draft) ? draftR.data : null;
  const published = pubR.data && hasLevels(pubR.data.data) ? pubR.data : null;
  mkGrade = (name) => ({ name, fees: [] });                     // new grades start empty
  state = Object.assign(blankState(), draft ? draft.draft : published ? { levels: published.data.levels } : {});
  state.schoolName = school.name;
  const savedTerms = (draft && draft.term_names) || (published && published.term_names);
  if (Array.isArray(savedTerms) && savedTerms.length === 3) TERMS.splice(0, 3, ...savedTerms);

  const nameField = document.getElementById('schoolNameInput');
  if (nameField) { nameField.value = school.name; nameField.readOnly = true; nameField.title = 'School name is managed in School Admin settings'; }

  // ---------- top bar ----------
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';
  actions.innerHTML = '<button id="ffBack" class="level-tab" style="opacity:1;background:var(--paper);color:var(--ink)">⌂ Home / Back to Admin</button>'
    + '<button id="ffTerms" class="level-tab" style="opacity:1">Edit Term Names</button>'
    + '<button id="ffSave" class="level-tab active">Save Draft</button>'
    + '<button id="ffPublish" class="level-tab active">Publish to Parents</button>'
    + '<span id="ffStatus" style="font-size:12px;color:var(--gold-light)"></span>'
    + '<span id="ffPubInfo" style="font-size:11px;opacity:.75;color:var(--gold-light)"></span>';
  document.querySelector('header.topbar').appendChild(actions);
  const statusEl = document.getElementById('ffStatus');
  const setStatus = (msg, ms) => { statusEl.textContent = msg; if (ms) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, ms); };
  const showPubInfo = (iso) => { document.getElementById('ffPubInfo').textContent = iso ? 'Last published ' + new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not published yet'; };
  showPubInfo(published && published.published_at);

  if (loadError) {
    const banner = document.createElement('div');
    banner.id = 'ffBanner';
    banner.style.cssText = 'background:#fef2f2;color:#b91c1c;padding:10px 16px;font:600 13px system-ui,sans-serif;text-align:center';
    banner.textContent = FF.friendlyError(loadError) + ' Saving is switched off so your saved work is not overwritten. Refresh the page to try again.';
    document.body.prepend(banner);
  }
  document.getElementById('ffBack').onclick = () => { location.href = 'schooladmin.html'; };

  // ---------- clean copy of the structure (numbers, trimmed names) ----------
  const cleanFees = (fees) => (fees || []).map(f => ({
    name: String(f.name || '').trim(), category: f.category || 'Other', boarderOnly: !!f.boarderOnly,
    amounts: [0, 1, 2].map(i => { const n = Number(f.amounts && f.amounts[i]); return Number.isFinite(n) && n > 0 ? n : 0; })
  }));
  const cleanLevels = () => state.levels.map(l => ({ name: String(l.name || '').trim(), grades: l.grades.map(g => ({ name: String(g.name || '').trim(), fees: cleanFees(g.fees) })) }));
  const normGrade = (v) => String(v || '').replace(/[A-Z]$/, '').replace(/^Class /, 'Grade ').trim().toLowerCase();   // same rule the database uses

  function validate() {
    const problems = [], seen = new Map();
    const levels = cleanLevels();
    levels.forEach(l => {
      if (!l.grades.length) problems.push(`"${l.name}" has no grades.`);
      l.grades.forEach(g => {
        if (!g.name) { problems.push(`A grade in "${l.name}" has no name.`); return; }
        const key = normGrade(g.name);
        if (seen.has(key)) problems.push(`"${g.name}" and "${seen.get(key)}" are the same grade (names are matched ignoring "Class"/"Grade" and a trailing stream letter).`);
        else seen.set(key, g.name);
        g.fees.forEach(f => { if (!f.name) problems.push(`A fee item in ${g.name} has no name.`); });
      });
    });
    const total = levels.reduce((a, l) => a + l.grades.reduce((b, g) => b + g.fees.reduce((c, f) => c + f.amounts.reduce((d, x) => d + x, 0), 0), 0), 0);
    if (total <= 0) problems.push('Add at least one fee item with an amount before publishing.');
    for (const l of state.levels) for (const g of l.grades) for (const f of g.fees) for (const a of (f.amounts || [])) {
      if (a !== '' && a != null && (!Number.isFinite(Number(a)) || Number(a) < 0 || Number(a) > 10000000)) problems.push(`Check the amounts for "${f.name}" in ${g.name}: use numbers between 0 and 10,000,000.`);
    }
    return [...new Set(problems)];
  }

  // ---------- save draft ----------
  let dirty = false, saving = null, saveTimer = null;
  async function save(show = true) {
    if (!canSave) { if (show) setStatus('Not saved: ' + (loadError ? 'the page could not load your saved work.' : 'saving is off.'), 4000); return false; }
    if (saving) await saving;                                    // never run two saves at once
    const run = (async () => {
      const termNames = TERMS.map(t => String(t || '').trim());
      if (termNames.some(t => !t)) { setStatus('Term names cannot be empty', 3000); return false; }
      const snapshot = { ...state, schoolName: school.name, levels: cleanLevels() };
      const { error } = await sb.from('fee_structures').upsert({ school_id: schoolId, draft: snapshot, term_names: termNames, updated_by: profile.id }, { onConflict: 'school_id' });
      if (error) { setStatus('Could not save: ' + FF.friendlyError(error), 6000); return false; }
      dirty = false;
      if (show) setStatus('Draft saved', 1800);
      return true;
    })();
    saving = run; const r = await run; saving = null; return r;
  }
  const scheduleSave = () => { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(() => save(false), 800); };
  document.getElementById('ffSave').onclick = () => { clearTimeout(saveTimer); save(true); };
  document.addEventListener('input', scheduleSave, true);
  document.addEventListener('change', scheduleSave, true);
  document.addEventListener('click', e => { if (e.target.closest('.add-grade-btn,.add-fee-btn,.del-row-btn,.grade-del,.term-chip,.level-tab')) setTimeout(scheduleSave, 100); }, true);
  window.addEventListener('beforeunload', e => { if (dirty && canSave) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- term names ----------
  document.getElementById('ffTerms').onclick = () => {
    const next = TERMS.map((t, i) => prompt('Name for term ' + (i + 1) + ':', t));
    if (next.every(x => x && x.trim())) { TERMS.splice(0, 3, ...next.map(x => x.trim())); render(); save(false); }
  };

  // ---------- grade rail (rename / delete / add) ----------
  renderGradeRail = function () {
    const el = document.getElementById('gradeRail'), lvl = currentLevel(), gi = currentGradeIndex();
    el.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = lvl.name + ' levels'; el.appendChild(h);
    lvl.grades.forEach((g, idx) => {
      const item = document.createElement('div'); item.className = 'grade-item' + (idx === gi ? ' active' : ''); item.title = 'Open ' + g.name;
      item.onclick = () => { state.activeGrade[state.activeLevel] = idx; render(); };
      const label = document.createElement('span'); label.textContent = g.name; label.style.cssText = 'flex:1;cursor:pointer';
      const count = document.createElement('span'); count.className = 'count'; count.textContent = g.fees.length + ' fees';
      const edit = document.createElement('button'); edit.className = 'grade-del'; edit.textContent = '✎'; edit.title = 'Edit grade/form name'; edit.style.opacity = '.85';
      edit.onclick = e => { e.stopPropagation(); const name = prompt('Edit grade/form name:', g.name); if (name && name.trim()) { g.name = name.trim(); scheduleSave(); render(); } };
      const del = document.createElement('button'); del.className = 'grade-del'; del.textContent = '✕'; del.title = 'Delete grade/form';
      del.onclick = e => {
        e.stopPropagation();
        if (lvl.grades.length === 1) { alert('At least one grade/form must remain.'); return; }
        if (confirm('Delete ' + g.name + ' and all of its fee items?')) { lvl.grades.splice(idx, 1); state.activeGrade[state.activeLevel] = Math.max(0, Math.min(idx, lvl.grades.length - 1)); scheduleSave(); render(); }
      };
      const right = document.createElement('div'); right.style.cssText = 'display:flex;align-items:center;gap:6px'; right.append(count, edit, del);
      item.append(label, right); el.appendChild(item);
    });
    const add = document.createElement('button'); add.className = 'add-grade-btn'; add.textContent = '+ Add grade / form';
    add.onclick = () => {
      const name = prompt('Enter the new grade or form name:'); if (!name || !name.trim()) return;
      if (lvl.grades.some(g => g.name.toLowerCase() === name.trim().toLowerCase())) { alert('That grade or form already exists.'); return; }
      lvl.grades.push({ name: name.trim(), fees: [] }); state.activeGrade[state.activeLevel] = lvl.grades.length - 1; scheduleSave(); render();
    };
    el.appendChild(add);
  };

  // ---------- preview footer uses the school's real paybill ----------
  const originalRenderPreview = renderPreview;
  renderPreview = function () {
    originalRenderPreview();
    const footer = document.querySelector('.doc-footer');
    if (footer) footer.innerHTML = `Payment via <strong>M-Pesa Paybill</strong> — Business No. <strong>${esc(school.paybill || 'Not configured')}</strong>, Account: <strong>Learner admission number</strong>.<br>For queries, contact the school bursar's office.`;
  };

  // ---------- publish ----------
  async function fetchBilling() {
    const rows = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await sb.from('student_balances').select('class_name, total_fee, verified, active').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return rows.filter(r => r.verified && r.active);
  }
  document.getElementById('ffPublish').onclick = async () => {
    if (!canSave) { setStatus('Cannot publish: the page could not load your saved work. Refresh and try again.', 6000); return; }
    clearTimeout(saveTimer);
    const problems = validate();
    if (problems.length) { alert('Please fix these before publishing:\n\n• ' + problems.join('\n• ')); return; }
    if (!confirm('Publish this fee structure?\n\nParents will see it, every student\'s total fee will be recalculated from it, and parents will be notified.')) return;
    const btn = document.getElementById('ffPublish'); btn.disabled = true; setStatus('Publishing…');
    try {
      if (!(await save(false))) throw new Error('Your draft could not be saved, so nothing was published.');
      const publishedAt = new Date().toISOString();
      const { error } = await sb.from('fee_structure_published').upsert({
        school_id: schoolId, data: { schoolName: school.name, paybill: school.paybill || '', levels: cleanLevels() },
        term_names: TERMS.map(t => String(t).trim()), published_by: profile.id, published_at: publishedAt
      }, { onConflict: 'school_id' });
      if (error) throw error;
      showPubInfo(publishedAt);
      let billing = [];
      try { billing = await fetchBilling(); } catch (e) { /* the summary is optional */ }
      const unbilled = billing.filter(r => Number(r.total_fee) === 0);
      const classes = [...new Set(unbilled.map(r => r.class_name))].sort();
      setStatus(`Published. ${billing.length - unbilled.length} student(s) now have fees.`, 6000);
      if (unbilled.length) alert(`Published. ${billing.length - unbilled.length} student(s) now have fees assigned.\n\n${unbilled.length} student(s) have no fee because their class does not match a grade here: ${classes.join(', ')}.\n\nRename the grade (✎) or correct the students' class, then publish again.`);
    } catch (e) {
      setStatus('Publish failed: ' + FF.friendlyError(e), 8000);
    } finally { btn.disabled = false; }
  };

  render();
})();
