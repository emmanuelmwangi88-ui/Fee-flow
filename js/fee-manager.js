/* FeeFlow Fee Structure Manager.
 *  Data format (read by the database to price every student, do not change):
 *    { levels: [ { name, grades: [ { name, fees: [ { name, category, boarderOnly, amounts:[t1,t2,t3] } ] } ] } ] }
 *  "Save draft" -> fee_structures (private working copy).  "Publish" -> fee_structure_published: the DATABASE recalculates
 *  every student's total and notifies parents, so a browser can never set a student's fee directly. */
(async () => {
  'use strict';
  if (!window.FF) { document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">FeeFlow could not load. Check your connection and refresh.</p>'; return; }
  const profile = await FF.requireRole('school_admin');
  if (!profile) return;
  const sb = FF.sb, schoolId = profile.school_id, esc = FF.escapeHtml, L = window.FFLevels;
  const $ = (id) => document.getElementById(id);

  // ---------- load ----------
  const [schoolR, draftR, pubR, classR] = await Promise.all([
    sb.from('schools').select('id, name, paybill, level, status').eq('id', schoolId).maybeSingle(),
    sb.from('fee_structures').select('draft, term_names, updated_at').eq('school_id', schoolId).maybeSingle(),
    sb.from('fee_structure_published').select('data, term_names, published_at').eq('school_id', schoolId).maybeSingle(),
    sb.from('student_balances').select('class_name, verified, active').limit(5000)
  ]);
  const loadError = schoolR.error || draftR.error || pubR.error;
  const school = schoolR.data || { id: schoolId, name: 'Your School', paybill: '', level: 'Primary & Secondary' };
  const type = L.typeOf(school.level);
  let canSave = !loadError;                                       // NEVER autosave over a draft we failed to read

  const hasLevels = (o) => o && Array.isArray(o.levels) && o.levels.length > 0;
  const draft = draftR.data && hasLevels(draftR.data.draft) ? draftR.data : null;
  const published = pubR.data && hasLevels(pubR.data.data) ? pubR.data : null;
  const TERMS = ['Term 1', 'Term 2', 'Term 3'];
  const savedTerms = (draft && draft.term_names) || (published && published.term_names);
  if (Array.isArray(savedTerms) && savedTerms.length === 3) TERMS.splice(0, 3, ...savedTerms);

  const fresh = !draft && !published;
  const state = { schoolName: school.name, activeLevel: 0, activeGrade: {}, levels: [] };
  if (draft) Object.assign(state, { levels: draft.draft.levels, activeLevel: 0 });
  else if (published) state.levels = published.data.levels;
  else state.levels = L.initialLevels(school.level, true);
  state.levels.forEach((l) => l.grades.forEach((g) => { g.fees = Array.isArray(g.fees) ? g.fees : []; }));
  window.FM = { state, TERMS, school, render: () => render() };

  // ---------- header ----------
  $('schoolTitle').textContent = school.name;
  $('schoolType').textContent = type.label + ' · ' + (school.paybill ? 'Paybill ' + school.paybill : 'No paybill set');
  const statusEl = $('ffStatus');
  const setStatus = (msg, ms) => { statusEl.textContent = msg; if (ms) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, ms); };
  const showPubInfo = (iso) => { $('ffPubInfo').textContent = iso ? 'Last published ' + new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not published yet'; };
  showPubInfo(published && published.published_at);
  $('ffBack').onclick = () => { location.href = 'schooladmin.html'; };
  const banner = (cls, text, id) => { const d = document.createElement('div'); d.className = 'ff-banner ' + cls; d.id = id; d.textContent = text; $('ffBannerBox').appendChild(d); };
  if (loadError) banner('error', FF.friendlyError(loadError) + ' Saving is switched off so your saved work is not overwritten. Refresh the page to try again.', 'ffBanner');
  if (school.status && school.status !== 'active') banner('warn', 'This school is not active yet, so parents cannot see a published fee structure until it is approved.', 'ffInactive');

  // ---------- helpers ----------
  const money = (n) => 'KES ' + (Number(n) || 0).toLocaleString('en-KE');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const level = () => state.levels[state.activeLevel] || state.levels[0];
  const gradeIdx = () => { const l = state.activeLevel; if (state.activeGrade[l] === undefined || state.activeGrade[l] >= level().grades.length) state.activeGrade[l] = 0; return state.activeGrade[l]; };
  const grade = () => level().grades[gradeIdx()];
  const termSum = (fees, i, boarder) => fees.reduce((a, f) => a + (f.boarderOnly && !boarder ? 0 : num(f.amounts && f.amounts[i])), 0);
  const annual = (fees, boarder) => [0, 1, 2].reduce((a, i) => a + termSum(fees, i, boarder), 0);
  const sectionKey = (lvl) => Object.keys(L.SECTIONS).find((k) => L.SECTIONS[k].name === lvl.name) || (/secondary|form|senior|junior/i.test(lvl.name) ? 'senior' : 'upper');
  const normGrade = (v) => String(v || '').replace(/[A-Z]$/, '').replace(/^Class /, 'Grade ').trim().toLowerCase();   // same rule as the database

  // classes students are actually in, for the "no matching grade" warning
  const studentClasses = [...new Set((classR.data || []).filter((r) => r.verified && r.active).map((r) => r.class_name).filter(Boolean))].sort();
  function renderClassWarning() {
    const known = new Set(state.levels.flatMap((l) => l.grades.map((g) => normGrade(g.name))));
    const missing = studentClasses.filter((c) => !known.has(normGrade(c)));
    let el = $('ffClassWarn');
    if (!missing.length) { if (el) el.remove(); return; }
    if (!el) { banner('warn', '', 'ffClassWarn'); el = $('ffClassWarn'); }
    el.textContent = 'Students are enrolled in ' + missing.join(', ') + ', which ' + (missing.length > 1 ? 'have' : 'has') + ' no matching grade here. Those students will have no fees until you add or rename a grade.';
  }

  // ---------- rendering ----------
  function renderSetup() {
    const box = $('setupBox');
    if (!fresh || draft || published || state.touched) { box.innerHTML = ''; return; }
    const sections = type.start.map((k) => L.SECTIONS[k].name + ' (' + L.SECTIONS[k].grades[0] + ' to ' + L.SECTIONS[k].grades.slice(-1)[0] + ')');
    box.innerHTML = `<div class="card setup"><h2><i class="fas fa-wand-magic-sparkles" style="color:var(--emerald)"></i> Let's set up fees for ${esc(school.name)}</h2>
      <p style="margin:0;color:var(--text-light)">Because you registered as a <b>${esc(type.label.toLowerCase())}</b>, we started you with the grades below and the fee items schools usually charge. Amounts are left at zero for you to fill in; nothing is guessed.</p>
      <ul>${sections.map((s) => '<li>' + esc(s) + '</li>').join('')}</ul>
      <p style="margin:0;font-size:13px;color:var(--text-light)">Tip: fill in one grade, then use <b>Copy to other grades</b> to save time. Boarding and other optional fees can be marked <b>boarders only</b>.</p></div>`;
  }
  function renderSections() {
    const el = $('sectionTabs'); el.innerHTML = '';
    state.levels.forEach((l, i) => {
      const b = document.createElement('button'); b.className = 'chip' + (i === state.activeLevel ? ' active' : ''); b.textContent = l.name;
      b.onclick = () => { state.activeLevel = i; render(); }; el.appendChild(b);
    });
    const have = new Set(state.levels.map((l) => l.name));
    type.optional.filter((k) => !have.has(L.SECTIONS[k].name)).forEach((k) => {
      const b = document.createElement('button'); b.className = 'chip add'; b.dataset.add = k; b.textContent = '+ ' + L.SECTIONS[k].name;
      b.onclick = () => { const s = L.buildSection(k, true); state.levels.push({ name: s.name, grades: s.grades }); state.activeLevel = state.levels.length - 1; touch(); render(); }; el.appendChild(b);
    });
    const custom = document.createElement('button'); custom.className = 'chip add'; custom.textContent = '+ Other section'; custom.dataset.custom = '1';
    custom.onclick = () => { const n = prompt('Name of the new section (e.g. Evening Classes):'); if (n && n.trim()) { state.levels.push({ name: n.trim(), grades: [{ name: 'Class 1', fees: [] }] }); state.activeLevel = state.levels.length - 1; touch(); render(); } };
    el.appendChild(custom);
  }
  function renderRail() {
    const el = $('gradeRail'), lvl = level(), gi = gradeIdx(); el.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = lvl.name; el.appendChild(h);
    lvl.grades.forEach((g, idx) => {
      const item = document.createElement('div'); item.className = 'grade-item' + (idx === gi ? ' active' : ''); item.dataset.grade = g.name;
      const empty = annual(g.fees, true) === 0;
      item.innerHTML = `<span>${esc(g.name)}</span><small class="${empty ? 'warn' : ''}">${empty ? 'no amounts' : money(annual(g.fees, false))}</small>`;
      item.onclick = () => { state.activeGrade[state.activeLevel] = idx; render(); }; el.appendChild(item);
    });
    const add = document.createElement('button'); add.className = 'btn btn-outline btn-sm'; add.id = 'addGradeBtn'; add.style.cssText = 'margin:8px 6px 2px;width:calc(100% - 12px);justify-content:center;';
    add.innerHTML = '<i class="fas fa-plus"></i> Add grade'; add.onclick = addGrade; el.appendChild(add);
  }
  function addGrade() {
    const name = (prompt('Name of the new grade or form (e.g. Grade 3, Form 2, PP1):') || '').trim(); if (!name) return;
    if (state.levels.some((l) => l.grades.some((g) => normGrade(g.name) === normGrade(name)))) { alert('That grade already exists.'); return; }
    level().grades.push({ name, fees: JSON.parse(JSON.stringify(grade() ? grade().fees : [])).map((f) => ({ ...f, amounts: [0, 0, 0] })) });
    state.activeGrade[state.activeLevel] = level().grades.length - 1; touch(); render();
  }
  function renderEditor() {
    const el = $('editorCol'), lvl = level(), g = grade();
    if (!g) { el.innerHTML = '<div class="empty">Add a grade to begin.</div>'; return; }
    const rows = g.fees.map((f, i) => `<tr data-fee="${i}">
        <td><input class="form-input" data-f="name" value="${esc(f.name)}" placeholder="Fee name" aria-label="Fee name"></td>
        <td><select class="form-input" data-f="category" aria-label="Category">${L.CATEGORIES.map((c) => `<option${c === f.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}${L.CATEGORIES.includes(f.category) ? '' : `<option selected>${esc(f.category || 'Other')}</option>`}</select></td>
        ${[0, 1, 2].map((t) => `<td><input class="form-input amt" data-f="amt" data-t="${t}" inputmode="numeric" value="${num(f.amounts && f.amounts[t]) || ''}" placeholder="0" aria-label="${esc(TERMS[t])} amount"></td>`).join('')}
        <td class="tot">${money(termSum([f], 0, true) + termSum([f], 1, true) + termSum([f], 2, true))}</td>
        <td><label class="board-flag"><input type="checkbox" data-f="board"${f.boarderOnly ? ' checked' : ''}> Boarders only</label></td>
        <td><button class="btn btn-danger btn-sm" data-del="${i}" aria-label="Remove ${esc(f.name)}"><i class="fas fa-trash"></i></button></td></tr>`).join('');
    const presets = L.itemsFor(sectionKey(lvl)).filter(([n]) => !g.fees.some((f) => f.name === n));
    const day = annual(g.fees, false), bd = annual(g.fees, true);
    el.innerHTML = `<div class="editor-head"><div><h2>${esc(g.name)}</h2><p>${esc(lvl.name)} · amounts are per term, in KES</p></div>
        <div class="tools"><button class="btn btn-outline btn-sm" id="copyBtn"><i class="fas fa-copy"></i> Copy to other grades</button>
        <button class="btn btn-outline btn-sm" id="pctBtn"><i class="fas fa-percent"></i> Adjust all by %</button>
        <button class="btn btn-outline btn-sm" id="renameBtn"><i class="fas fa-pen"></i> Rename</button>
        <button class="btn btn-danger btn-sm" id="delGradeBtn"><i class="fas fa-trash"></i> Delete grade</button></div></div>
      ${g.fees.length ? `<table class="fee-table"><thead><tr><th>Fee item</th><th>Category</th>${TERMS.map((t, i) => `<th><input data-term="${i}" value="${esc(t)}" aria-label="Term ${i + 1} name"></th>`).join('')}<th style="text-align:right">Year</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty"><i class="fas fa-receipt" style="font-size:28px;margin-bottom:8px"></i><p>No fee items for this grade yet.</p></div>'}
      <div class="add-row"><select class="form-input" id="presetSel" aria-label="Add a typical fee item"><option value="">+ Add a typical fee item…</option>${presets.map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join('')}</select>
        <button class="btn btn-outline" id="addCustomBtn"><i class="fas fa-plus"></i> Custom fee item</button></div>
      <div class="totals" id="totalsBox">${[0, 1, 2].map((t) => `<div class="tot-box"><span>${esc(TERMS[t])} (day scholar)</span><b>${money(termSum(g.fees, t, false))}</b></div>`).join('')}
        <div class="tot-box main"><span>Year, day scholar</span><b id="totDay">${money(day)}</b></div>
        <div class="tot-box main"><span>Year, boarder</span><b id="totBoard">${money(bd)}</b></div></div>`;
    el._presets = presets;
  }
  function renderPreview() {
    const el = $('previewCol'), g = grade(); if (!g) { el.innerHTML = ''; return; }
    const hasBoard = g.fees.some((f) => f.boarderOnly);
    el.innerHTML = `<h3>What parents will see</h3><div class="doc"><h4>${esc(school.name)}</h4><div class="sub">Fee structure · ${esc(g.name)}</div>
      <table><thead><tr><th>Item</th>${TERMS.map((t) => `<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>
      ${g.fees.filter((f) => annual([f], true) > 0).map((f) => `<tr><td>${esc(f.name)}${f.boarderOnly ? ' <small>(boarders)</small>' : ''}</td>${[0, 1, 2].map((t) => `<td>${num(f.amounts && f.amounts[t]).toLocaleString('en-KE')}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-light)">No amounts yet</td></tr>'}
      </tbody><tfoot><tr><td>Day scholar</td>${[0, 1, 2].map((t) => `<td>${termSum(g.fees, t, false).toLocaleString('en-KE')}</td>`).join('')}</tr>${hasBoard ? `<tr><td>Boarder</td>${[0, 1, 2].map((t) => `<td>${termSum(g.fees, t, true).toLocaleString('en-KE')}</td>`).join('')}</tr>` : ''}</tfoot></table>
      <div class="doc-footer">Payment via <strong>M-Pesa Paybill</strong>, Business No. <strong>${esc(school.paybill || 'Not configured')}</strong>, Account: <strong>Learner admission number</strong>.<br>For queries, contact the school bursar's office.</div></div>
      <button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="window.print()"><i class="fas fa-print"></i> Print / save as PDF</button>`;
  }
  function render() { renderSetup(); renderSections(); renderRail(); renderEditor(); renderPreview(); renderClassWarning(); }

  // ---------- editing (delegated; re-renders only the totals while typing so the cursor never jumps) ----------
  let dirty = false, saving = null, saveTimer = null;
  const touch = () => { state.touched = true; dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(() => save(false), 800); };
  function refreshNumbers() { renderRail(); renderPreview(); const g = grade(); if (!g) return;
    $('totalsBox').innerHTML = [0, 1, 2].map((t) => `<div class="tot-box"><span>${esc(TERMS[t])} (day scholar)</span><b>${money(termSum(g.fees, t, false))}</b></div>`).join('') + `<div class="tot-box main"><span>Year, day scholar</span><b id="totDay">${money(annual(g.fees, false))}</b></div><div class="tot-box main"><span>Year, boarder</span><b id="totBoard">${money(annual(g.fees, true))}</b></div>`;
    document.querySelectorAll('#editorCol tr[data-fee]').forEach((tr) => { const f = g.fees[Number(tr.dataset.fee)]; if (f) tr.querySelector('.tot').textContent = money(annual([f], true)); });
    renderClassWarning(); }
  $('editorCol').addEventListener('input', (e) => {
    const t = e.target, g = grade(); if (!g) return;
    if (t.dataset.term !== undefined) { TERMS[Number(t.dataset.term)] = t.value; touch(); renderPreview(); return; }
    const tr = t.closest('tr[data-fee]'); if (!tr) return; const f = g.fees[Number(tr.dataset.fee)]; if (!f) return;
    if (t.dataset.f === 'name') f.name = t.value;
    else if (t.dataset.f === 'amt') { f.amounts = Array.isArray(f.amounts) ? f.amounts.slice(0, 3) : [0, 0, 0]; while (f.amounts.length < 3) f.amounts.push(0); f.amounts[Number(t.dataset.t)] = t.value.replace(/[, ]/g, ''); }
    touch(); refreshNumbers();
  });
  $('editorCol').addEventListener('change', (e) => {
    const t = e.target, g = grade(); if (!g) return;
    if (t.id === 'presetSel') { const p = $('editorCol')._presets[Number(t.value)]; if (p) { g.fees.push({ name: p[0], category: p[1], boarderOnly: p[2], amounts: [0, 0, 0] }); touch(); render(); } return; }
    const tr = t.closest('tr[data-fee]'); if (!tr) return; const f = g.fees[Number(tr.dataset.fee)]; if (!f) return;
    if (t.dataset.f === 'category') f.category = t.value;
    if (t.dataset.f === 'board') { f.boarderOnly = t.checked; refreshNumbers(); }
    touch();
  });
  $('editorCol').addEventListener('click', (e) => {
    const g = grade(), b = e.target.closest('button'); if (!g || !b) return;
    if (b.dataset.del !== undefined) { const f = g.fees[Number(b.dataset.del)]; if (f && confirm('Remove "' + f.name + '" from ' + g.name + '?')) { g.fees.splice(Number(b.dataset.del), 1); touch(); render(); } }
    else if (b.id === 'addCustomBtn') { g.fees.push({ name: '', category: 'Other', boarderOnly: false, amounts: [0, 0, 0] }); touch(); render(); const rows = document.querySelectorAll('#editorCol tr[data-fee]'); rows[rows.length - 1].querySelector('input').focus(); }
    else if (b.id === 'renameBtn') { const n = (prompt('Rename this grade:', g.name) || '').trim(); if (n) { g.name = n; touch(); render(); } }
    else if (b.id === 'delGradeBtn') { const lvl = level(); if (lvl.grades.length === 1) { alert('A section needs at least one grade. Delete the section by adding another grade first.'); return; } if (confirm('Delete ' + g.name + ' and all of its fee items?')) { lvl.grades.splice(gradeIdx(), 1); state.activeGrade[state.activeLevel] = 0; touch(); render(); } }
    else if (b.id === 'pctBtn') adjustPercent(g);
    else if (b.id === 'copyBtn') copyDialog(g);
  });
  function adjustPercent(g) {
    const v = prompt('Increase (or decrease with a minus) every amount in ' + g.name + ' by what percent? e.g. 5 or -10', '5'); if (v === null) return;
    const pct = Number(v); if (!Number.isFinite(pct) || pct < -90 || pct > 300) { alert('Enter a percentage between -90 and 300.'); return; }
    g.fees.forEach((f) => { f.amounts = [0, 1, 2].map((i) => Math.round(num(f.amounts && f.amounts[i]) * (1 + pct / 100))); });
    touch(); render();
  }
  const dlg = $('dlg');
  function copyDialog(g) {
    const targets = state.levels.flatMap((l) => l.grades.filter((x) => x !== g).map((x) => ({ l, x })));
    dlg.innerHTML = `<h3>Copy fees from ${esc(g.name)}</h3><p style="margin:0;color:var(--text-light);font-size:14px">Replaces the fee items of the grades you tick with these. Boarding flags are copied too.</p>
      <div class="pick" id="copyPick">${targets.map((t, i) => `<label><input type="checkbox" value="${i}"> ${esc(t.x.name)} <small style="color:var(--text-light)">${esc(t.l.name)}</small></label>`).join('')}</div>
      <div class="dlg-actions"><button class="btn btn-outline" id="copyAll">Tick all</button><button class="btn btn-outline" id="copyCancel">Cancel</button><button class="btn btn-primary" id="copyGo">Copy</button></div>`;
    dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
    $('copyCancel').onclick = () => dlg.close();
    $('copyAll').onclick = () => document.querySelectorAll('#copyPick input').forEach((c) => { c.checked = true; });
    $('copyGo').onclick = () => {
      const picked = [...document.querySelectorAll('#copyPick input:checked')].map((c) => targets[Number(c.value)]);
      if (!picked.length) { alert('Tick at least one grade.'); return; }
      picked.forEach(({ x }) => { x.fees = JSON.parse(JSON.stringify(g.fees)); });
      dlg.close(); touch(); render(); setStatus('Copied to ' + picked.length + ' grade(s)', 2500);
    };
  }

  // ---------- clean copy, validate, save, publish ----------
  const cleanFees = (fees) => (fees || []).map((f) => ({ name: String(f.name || '').trim(), category: f.category || 'Other', boarderOnly: !!f.boarderOnly, amounts: [0, 1, 2].map((i) => num(f.amounts && f.amounts[i])) }));
  const cleanLevels = () => state.levels.map((l) => ({ name: String(l.name || '').trim(), grades: l.grades.map((g) => ({ name: String(g.name || '').trim(), fees: cleanFees(g.fees) })) }));
  function validate() {
    const problems = [], seen = new Map(), levels = cleanLevels();
    levels.forEach((l) => {
      if (!l.grades.length) problems.push(`"${l.name}" has no grades.`);
      l.grades.forEach((g) => {
        if (!g.name) { problems.push(`A grade in "${l.name}" has no name.`); return; }
        const key = normGrade(g.name);
        if (seen.has(key)) problems.push(`"${g.name}" and "${seen.get(key)}" are the same grade (names are matched ignoring "Class"/"Grade" and a trailing stream letter).`); else seen.set(key, g.name);
        g.fees.forEach((f) => { if (!f.name) problems.push(`A fee item in ${g.name} has no name.`); });
      });
    });
    if (levels.reduce((a, l) => a + l.grades.reduce((b, g) => b + annual(g.fees, true), 0), 0) <= 0) problems.push('Add at least one fee item with an amount before publishing.');
    for (const l of state.levels) for (const g of l.grades) for (const f of g.fees) for (const a of (f.amounts || [])) {
      if (a !== '' && a != null && (!Number.isFinite(Number(a)) || Number(a) < 0 || Number(a) > 10000000)) problems.push(`Check the amounts for "${f.name}" in ${g.name}: use numbers between 0 and 10,000,000.`);
    }
    if (TERMS.some((t) => !String(t).trim())) problems.push('Term names cannot be empty.');
    return [...new Set(problems)];
  }
  async function save(show = true) {
    if (!canSave) { if (show) setStatus('Not saved: ' + (loadError ? 'the page could not load your saved work.' : 'saving is off.'), 4000); return false; }
    if (saving) await saving;
    const run = (async () => {
      const termNames = TERMS.map((t) => String(t || '').trim());
      if (termNames.some((t) => !t)) { setStatus('Term names cannot be empty', 3000); return false; }
      const snapshot = { schoolName: school.name, activeLevel: state.activeLevel, activeGrade: state.activeGrade, levels: cleanLevels() };
      const { error } = await sb.from('fee_structures').upsert({ school_id: schoolId, draft: snapshot, term_names: termNames, updated_by: profile.id }, { onConflict: 'school_id' });
      if (error) { setStatus('Could not save: ' + FF.friendlyError(error), 6000); return false; }
      dirty = false; if (show) setStatus('Draft saved', 1800); return true;
    })();
    saving = run; const r = await run; saving = null; return r;
  }
  $('ffSave').onclick = () => { clearTimeout(saveTimer); save(true); };
  window.addEventListener('beforeunload', (e) => { if (dirty && canSave) { e.preventDefault(); e.returnValue = ''; } });

  async function fetchBilling() {
    const rows = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await sb.from('student_balances').select('class_name, total_fee, verified, active').range(from, from + 999);
      if (error) throw error; rows.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    return rows.filter((r) => r.verified && r.active);
  }
  $('ffPublish').onclick = async () => {
    if (!canSave) { setStatus('Cannot publish: the page could not load your saved work. Refresh and try again.', 6000); return; }
    clearTimeout(saveTimer);
    const problems = validate();
    if (problems.length) { alert('Please fix these before publishing:\n\n• ' + problems.join('\n• ')); return; }
    if (!confirm('Publish this fee structure?\n\nParents will see it, every student\'s total fee will be recalculated from it, and parents will be notified.')) return;
    const btn = $('ffPublish'); btn.disabled = true; setStatus('Publishing…');
    try {
      if (!(await save(false))) throw new Error('Your draft could not be saved, so nothing was published.');
      const publishedAt = new Date().toISOString();
      const { error } = await sb.from('fee_structure_published').upsert({
        school_id: schoolId, data: { schoolName: school.name, paybill: school.paybill || '', levels: cleanLevels() },
        term_names: TERMS.map((t) => String(t).trim()), published_by: profile.id, published_at: publishedAt
      }, { onConflict: 'school_id' });
      if (error) throw error;
      showPubInfo(publishedAt);
      let billing = []; try { billing = await fetchBilling(); } catch (e) { /* summary is optional */ }
      const unbilled = billing.filter((r) => Number(r.total_fee) === 0);
      const classes = [...new Set(unbilled.map((r) => r.class_name))].sort();
      setStatus(`Published. ${billing.length - unbilled.length} student(s) now have fees.`, 6000);
      if (unbilled.length) alert(`Published. ${billing.length - unbilled.length} student(s) now have fees assigned.\n\n${unbilled.length} student(s) have no fee because their class does not match a grade here: ${classes.join(', ')}.\n\nRename the grade, or correct the students' class, then publish again.`);
    } catch (e) { setStatus('Publish failed: ' + FF.friendlyError(e), 8000); }
    finally { btn.disabled = false; }
  };

  render();
})();
