/* FeeFlow — bursaries, waivers, discounts, arrears, late fees, transport & meal charges,
 * and fee-structure history.
 *
 * Every charge that is not a plain fee item lives in one table (fee_adjustments) and
 * students.adjustment is the sum of the active rows, kept right by a database trigger.
 * Nothing here recomputes a balance in the browser: the view does that.
 */
(function () {
  'use strict';

  const KINDS = [
    { id: 'scholarship', label: 'Scholarship', sign: -1, hint: 'Enter the amount OFF the bill, e.g. 5000.' },
    { id: 'discount_sibling', label: 'Sibling discount', sign: -1, hint: 'Enter the amount off, e.g. 2000.' },
    { id: 'discount_staff', label: 'Staff child discount', sign: -1, hint: 'Enter the amount off, e.g. 3000.' },
    { id: 'waiver', label: 'Waiver', sign: -1, hint: 'Enter the amount off, e.g. 1500.' },
    { id: 'arrears', label: 'Carried arrears', sign: 1, hint: 'Enter the amount brought forward, e.g. 8000.' },
    { id: 'late_fee', label: 'Late fee', sign: 1, hint: 'Enter the amount charged, e.g. 500.' },
    { id: 'transport', label: 'Transport', sign: 1, hint: 'Enter the route fee, e.g. 4000.' },
    { id: 'meals', label: 'Meals', sign: 1, hint: 'Enter the meal plan fee, e.g. 6000.' },
    { id: 'other', label: 'Other', sign: 1, hint: 'Enter the amount. Negative reduces the bill.' }
  ];
  const KIND_BY_ID = Object.fromEntries(KINDS.map(k => [k.id, k]));
  const LABELS = {
    scholarship: 'Scholarship', discount_sibling: 'Sibling discount', discount_staff: 'Staff child',
    waiver: 'Waiver', arrears: 'Arrears', late_fee: 'Late fee', transport: 'Transport',
    meals: 'Meals', other: 'Other'
  };
  const TABS = {
    discounts: 'Bursaries & Discounts', arrears: 'Arrears & Late Fees',
    services: 'Transport & Meals', history: 'Fee History'
  };

  let sb = null, schoolId = null, me = null;
  let students = [], adjustments = [], rules = null, terms = [];
  let routes = [], plans = [];
  let svcMode = null;   // 'route' | 'plan'
  let svcEditId = null;
  let termNames = ['Term 1', 'Term 2', 'Term 3'];

  const $ = id => document.getElementById(id);
  const esc = s => FF.escapeHtml(String(s == null ? '' : s));
  const money = n => FFUI.money(Number(n) || 0);
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const ico = FFUI.ico;
  const toast = FFUI.toast;

  function kindLabel(k) { return LABELS[k] || k; }
  function signed(kind, amount) {
    const k = KIND_BY_ID[kind] || KIND_BY_ID.other;
    const mag = Math.abs(num(amount));
    return k.sign < 0 ? -mag : mag;
  }

  /* ------------------------------------------------------------ data --------- */
  async function loadAll() {
    const [stuR, adjR, ruleR, termR, routeR, planR, feeR, histR] = await Promise.all([
      sb.from('student_balances').select('id, admission_no, full_name, class_name, boarding, active, verified, guardian_phone, transport_route_id, meal_plan_id, staff_child, scholar, total_due, paid, balance').order('full_name'),
      sb.from('fee_adjustments').select('*').order('created_at', { ascending: false }),
      sb.from('school_fee_rules').select('*').maybeSingle(),
      sb.from('terms').select('id, name, start_date, end_date, deadline, status').order('start_date', { ascending: false }),
      sb.from('transport_routes').select('*').order('name'),
      sb.from('meal_plans').select('*').order('name'),
      sb.from('fee_structure_published').select('published_at, data, term_names').eq('school_id', schoolId).maybeSingle(),
      sb.from('fee_structure_history').select('id, version, data, term_names, published_at, superseded_at').eq('school_id', schoolId).order('version', { ascending: false })
    ]);
    for (const r of [stuR, adjR, ruleR, termR, routeR, planR]) if (r.error) throw r.error;

    students = (stuR.data || []).map(r => ({
      id: r.id, adm: r.admission_no, name: r.full_name, klass: r.class_name,
      boarding: !!r.boarding, active: r.active !== false,
      due: num(r.total_due), paid: num(r.paid), balance: num(r.balance),
      guardianPhone: r.guardian_phone || '',
      route: r.transport_route_id || null,
      plan: r.meal_plan_id || null,
      staffChild: !!r.staff_child,
      scholar: !!r.scholar
    }));
    adjustments = adjR.data || [];
    rules = ruleR.data || null;
    terms = termR.data || [];
    routes = routeR.data || [];
    plans = planR.data || [];
    if (feeR.data && Array.isArray(feeR.data.term_names)) termNames = feeR.data.term_names;
    window.FA.history = histR.data || [];
    if (feeR.error && !/does not exist|PGRST116/.test(String(feeR.error.message))) throw feeR.error;
  }

  /* ------------------------------------------------------------ render ------- */
  function renderStats() {
    const off = adjustments.filter(a => a.active && num(a.amount) < 0);
    const on = adjustments.filter(a => a.active && num(a.amount) > 0);
    const sum = list => list.reduce((t, a) => t + Math.abs(num(a.amount)), 0);
    const kids = new Set(adjustments.filter(a => a.active).map(a => a.student_id)).size;
    const cards = [
      { label: 'Pupils with an adjustment', value: String(kids), ico: 'student', color: 'violet' },
      { label: 'Given off (bursaries, waivers)', value: money(sum(off)), ico: 'receipt', color: 'green' },
      { label: 'Added (arrears, transport, meals)', value: money(sum(on)), ico: 'alert', color: 'amber' }
    ];
    $('discountStats').innerHTML = cards.map(c => `
      <div class="ff-stat">
        <div class="ff-stat-head"><span>${esc(c.label)}</span><span class="ff-stat-ico" style="color:var(--ff-${c.color})">${ico(c.ico)}</span></div>
        <div class="ff-stat-value">${esc(c.value)}</div>
      </div>`).join('');
  }

  function renderAdjustments() {
    const q = ($('adjustSearch').value || '').trim().toLowerCase();
    const kind = $('adjustKindFilter').value;
    $('adjustKindFilter').dataset.keep = kind;
    const byId = Object.fromEntries(students.map(s => [s.id, s]));
    let rows = adjustments.filter(a => {
      if (kind && a.kind !== kind) return false;
      if (!q) return true;
      const s = byId[a.student_id] || {};
      return (s.name + ' ' + s.adm + ' ' + (a.reason || '')).toLowerCase().includes(q);
    });
    if (!rows.length) {
      $('adjustmentList').innerHTML = `<div class="ff-empty"><div class="ff-empty-icon">${ico('receipt')}</div>
        <p>No adjustments yet. Add a bursary, a waiver or a one-off correction.</p></div>`;
      return;
    }
    $('adjustmentList').innerHTML = `<div class="ff-table-wrap"><table class="ff-table">
      <thead><tr><th>Pupil</th><th>Kind</th><th>Amount</th><th>Reason</th><th>Term</th><th>Added</th><th></th></tr></thead>
      <tbody>${rows.map(a => {
        const s = byId[a.student_id] || {};
        const off = num(a.amount) < 0;
        return `<tr${a.active ? '' : ' style="opacity:.5"'}>
          <td><strong>${esc(s.name || 'Unknown pupil')}</strong><div class="ff-hint">${esc(s.adm || '')} · ${esc(s.klass || '')}</div></td>
          <td><span class="ff-badge ${off ? 'ff-badge-green' : 'ff-badge-amber'}">${esc(kindLabel(a.kind))}</span></td>
          <td class="ff-money ${off ? '' : 'ff-money-neg'}" style="font-weight:700">${a.active ? (off ? '−' : '+') : ''}${money(Math.abs(num(a.amount)))}</td>
          <td style="max-width:260px">${esc(a.reason)}</td>
          <td>${esc(a.term_name || '—')}${a.standing ? '<div class="ff-hint">standing</div>' : ''}</td>
          <td>${esc(FFUI.fmtDate(a.created_at))}</td>
          <td style="white-space:nowrap">
            ${a.active ? `<button class="ff-btn ff-btn-icon ff-btn-ghost" type="button" onclick="FA.toggleAdjustment('${a.id}',false)" title="Remove" aria-label="Remove">${ico('close')}</button>` : ''}
          </td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function renderArrears() {
    const carrying = students.filter(s => s.balance > 0);
    $('arrearsCount').value = `${carrying.length} of ${students.length} pupils`;
    const rows = carrying.slice(0, 25).map(s => `
      <div class="ff-reminder-row">
        <div class="ff-avatar" style="background:${FFUI.colorFor(s.id)}">${FFUI.initials(s.name)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${esc(s.name)}</div>
          <div class="ff-hint">${esc(s.adm)} · ${esc(s.klass)}</div>
        </div>
        <div style="text-align:right">
          <div class="ff-money ff-money-neg" style="font-weight:700">${money(s.balance)}</div>
          <div class="ff-hint">of ${money(s.due)}</div>
        </div>
      </div>`).join('');
    $('arrearsList').innerHTML = rows
      ? `<div class="ff-reminder-list">${rows}</div>`
      : `<div class="ff-empty"><p>Every pupil has cleared their balance.</p></div>`;
  }

  function renderServices() {
    const amountCells = (vals, prefix) => termNames.map((t, i) => `
      <div class="ff-field">
        <label class="ff-label" for="${prefix}${i}">${esc(t)}</label>
        <input class="ff-input" type="number" id="${prefix}${i}" min="0" step="0.01" value="${num((vals || [])[i])}">
      </div>`).join('');

    const row = (r, kind) => {
      const used = students.filter(s => kind === 'route' ? s.route === r.id : s.plan === r.id).length;
      return `<div class="ff-reminder-row">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${esc(r.name)}</div>
          <div class="ff-hint">${esc(r.vehicle || r.description || '—')}</div>
        </div>
        <div style="text-align:right">
          <div class="ff-money" style="font-weight:700">${money((r.amounts || [])[0])}</div>
          <div class="ff-hint">${used} pupil${used === 1 ? '' : 's'}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="ff-btn ff-btn-icon ff-btn-ghost" type="button" onclick="FA.editService('${kind}','${r.id}')" title="Edit" aria-label="Edit">${ico('edit')}</button>
          <button class="ff-btn ff-btn-icon ff-btn-ghost" type="button" onclick="FA.deleteService('${kind}','${r.id}')" title="Delete" aria-label="Delete">${ico('close')}</button>
        </div>
      </div>`;
    };
    $('routeList').innerHTML = routes.length
      ? `<div class="ff-reminder-list">${routes.map(r => row(r, 'route')).join('')}</div>`
      : `<div class="ff-empty"><p>No bus routes yet.</p></div>`;
    $('planList').innerHTML = plans.length
      ? `<div class="ff-reminder-list">${plans.map(p => row(p, 'plan')).join('')}</div>`
      : `<div class="ff-empty"><p>No meal plans yet.</p></div>`;

    $('svcAmounts').innerHTML = amountCells([], 'svcAmt');
    window.FA._svcAmounts = amountCells;
  }

  function renderAssignments() {
    const q = ($('assignSearch').value || '').trim().toLowerCase();
    let rows = students.filter(s => {
      if (!q) return true;
      return (s.name + ' ' + s.adm + ' ' + s.klass).toLowerCase().includes(q);
    });
    if (!rows.length) { $('assignmentList').innerHTML = `<div class="ff-empty"><p>No pupil matches that search.</p></div>`; return; }
    $('assignmentList').innerHTML = `<div class="ff-table-wrap"><table class="ff-table">
      <thead><tr><th>Pupil</th><th>Class</th><th>Bus route</th><th>Meal plan</th></tr></thead>
      <tbody>${rows.slice(0, 60).map(s => `
        <tr>
          <td><strong>${esc(s.name)}</strong><div class="ff-hint">${esc(s.adm)}</div></td>
          <td>${esc(s.klass)}</td>
          <td><select class="ff-select" onchange="FA.assign('${s.id}','route',this.value)">
            <option value="">— none —</option>
            ${routes.map(r => `<option value="${r.id}"${s.route === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}
          </select></td>
          <td><select class="ff-select" onchange="FA.assign('${s.id}','plan',this.value)">
            <option value="">— none —</option>
            ${plans.map(p => `<option value="${p.id}"${s.plan === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  function renderHistory() {
    const hist = window.FA.history || [];
    if (!hist.length) {
      $('historyList').innerHTML = `<div class="ff-empty"><div class="ff-empty-icon">${ico('book')}</div>
        <p>No published versions yet. Publish a fee structure and each version is kept here.</p></div>`;
      return;
    }
    $('historyList').innerHTML = `<div class="ff-reminder-list">${hist.map(h => `
      <div class="ff-reminder-row">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">Version ${h.version}${h.superseded_at ? '' : ' <span class="ff-badge ff-badge-green">current</span>'}</div>
          <div class="ff-hint">Published ${esc(FFUI.fmtDateTime(h.published_at))} · ${esc((h.term_names || []).join(', '))}</div>
        </div>
        <button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="FA.showHistory('${h.id}')">View</button>
      </div>`).join('')}</div>`;
  }

  function renderRules() {
    const r = rules || {};
    $('siblingCount').value = num(r.sibling_from_child || 2) || 2;
    $('siblingPercent').value = num(r.sibling_discount_percent);
    $('staffPercent').value = num(r.staff_discount_percent);
    $('scholarshipPercent').value = num(r.scholarship_percent);
    $('lateFeeEnabled').checked = !!r.late_fee_enabled;
    $('lateFeeKind').value = r.late_fee_kind || 'percent';
    $('lateFeeValue').value = num(r.late_fee_value);
    $('lateFeeGrace').value = r.late_fee_grace_days == null ? 14 : num(r.late_fee_grace_days);
    $('carryArrears').checked = r.carry_arrears !== false;
    const sel = $('arrearsTerm');
    sel.innerHTML = `<option value="">— not set —</option>` +
      terms.map(t => `<option value="${esc(t.name)}"${r.arrears_term_name === t.name ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    syncKindHint();
    $('lateFeeValueHint').textContent = $('lateFeeKind').value === 'percent'
      ? 'e.g. 5 means 5% of what is still owed.'
      : 'e.g. 500 charges KES 500 per pupil.';
  }

  function renderFilters() {
    // the kind filter is built from the same list the modal offers, so the two can never drift
    fillSelect($('adjustKindFilter'), KINDS.map(k => ({ id: k.id, label: k.label })), 'All kinds');
    const keep = $('adjustKindFilter').dataset.keep || '';
    $('adjustKindFilter').value = KINDS.some(k => k.id === keep) ? keep : '';
  }

  function renderAll() {
    renderFilters();
    renderStats(); renderAdjustments(); renderArrears();
    renderServices(); renderAssignments(); renderHistory(); renderRules();
  }

  /* ------------------------------------------------------------ actions ------ */
  async function go(tab, el) {
    document.querySelectorAll('.ff-nav-item').forEach(n => n.classList.remove('active'));
    if (el) el.classList.add('active');
    document.querySelectorAll('.ff-view').forEach(v => v.classList.remove('active'));
    const view = $('view-' + tab);
    if (view) view.classList.add('active');
    $('pageTitle').textContent = TABS[tab] || tab;
    if (window.innerWidth <= 760) document.body.classList.remove('ff-nav-open');
    if (window.FFUI && window.FFUI.syncTabbar) window.FFUI.syncTabbar();
    const c = document.querySelector('.ff-content');
    if (c) c.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch (e) { /* old browsers */ }
  }

  function fillSelect(el, list, placeholder) {
    el.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
      list.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
  }

  function syncLateFeeHint() {
    $('lateFeeValueHint').textContent = $('lateFeeKind').value === 'percent'
      ? 'e.g. 5 means 5% of what is still owed.'
      : 'e.g. 500 charges KES 500 per pupil.';
  }

  function syncKindHint() {
    const k = KIND_BY_ID[$('adjustKind').value] || KIND_BY_ID.other;
    $('adjustKindHint').textContent = k.hint;
  }

  function openAdjustment() {
    fillSelect($('adjustStudent'), students.map(s => ({ id: s.id, label: `${s.name} (${s.adm}) — ${s.klass}` })), 'Choose a pupil');
    fillSelect($('adjustKind'), KINDS.map(k => ({ id: k.id, label: k.label })), null);
    fillSelect($('adjustTerm'), terms.map(t => ({ id: t.name, label: t.name })), '— every term —');
    $('adjustAmount').value = '';
    $('adjustReason').value = '';
    $('adjustStanding').checked = false;
    syncKindHint();
    FFUI.openModal('adjust');
  }

  async function saveAdjustment() {
    const studentId = $('adjustStudent').value;
    const kind = $('adjustKind').value;
    const raw = $('adjustAmount').value.trim();
    const reason = $('adjustReason').value.trim();
    const amount = Number(raw);
    if (!studentId) { toast('Choose a pupil first.', 'error'); return; }
    if (!raw || !isFinite(amount) || amount === 0) { toast('Enter an amount that is not zero.', 'error'); return; }
    if (reason.length < 3) { toast('Say why — the reason is printed on the statement.', 'error'); return; }
    const { error } = await sb.from('fee_adjustments').insert({
      school_id: schoolId, student_id: studentId, kind,
      amount: signed(kind, amount), reason,
      term_name: $('adjustTerm').value || null,
      standing: $('adjustStanding').checked
    });
    if (error) { toast(FF.friendlyError(error), 'error'); return; }
    FFUI.closeModal('adjust');
    toast('Adjustment saved.');
    await reload();
  }

  async function toggleAdjustment(id, active) {
    const { error } = await sb.from('fee_adjustments').update({ active }).eq('id', id);
    if (error) { toast(FF.friendlyError(error), 'error'); return; }
    toast(active ? 'Adjustment restored.' : 'Adjustment removed. The balance updates at once.');
    await reload();
  }

  async function saveRules() {
    const payload = {
      school_id: schoolId,
      sibling_from_child: Math.max(2, num($('siblingCount').value) || 2),
      sibling_discount_percent: num($('siblingPercent').value),
      staff_discount_percent: num($('staffPercent').value),
      scholarship_percent: num($('scholarshipPercent').value),
      late_fee_enabled: $('lateFeeEnabled').checked,
      late_fee_kind: $('lateFeeKind').value,
      late_fee_value: num($('lateFeeValue').value),
      late_fee_grace_days: Math.max(0, Math.min(365, num($('lateFeeGrace').value))),
      carry_arrears: $('carryArrears').checked,
      arrears_term_name: $('arrearsTerm').value || null,
      updated_by: me && me.id
    };
    const { error } = await sb.from('school_fee_rules').upsert(payload);
    if (error) { toast(FF.friendlyError(error), 'error'); return; }
    toast('Rules saved.');
    await reload();
  }

  /* Applies sibling / staff / scholarship rules by writing adjustment rows.
     Standing rows are refreshed, not duplicated, so this is safe to run repeatedly. */
  async function applyRules() {
    const r = rules;
    if (!r) { toast('Save the rules first.', 'error'); return; }
    const sibPct = num(r.sibling_discount_percent);
    const staffPct = num(r.staff_discount_percent);
    const scholPct = num(r.scholarship_percent);
    const from = Math.max(2, num(r.sibling_from_child) || 2);
    if (!sibPct && !staffPct && !scholPct) { toast('Set at least one percentage above zero.', 'error'); return; }

    // group pupils by guardian phone: a shared guardian is what makes children siblings
    const byGuardian = {};
    for (const s of students) {
      const key = (s.guardianPhone || '').replace(/\D/g, '');
      if (!key) continue;
      (byGuardian[key] = byGuardian[key] || []).push(s);
    }

    const toWrite = [];
    for (const s of students) {
      if (!s.active) continue;
      const key = (s.guardianPhone || '').replace(/\D/g, '');
      const sibs = byGuardian[key] || [];
      const position = sibs.slice().sort((a, b) => String(a.adm).localeCompare(String(b.adm))).findIndex(x => x.id === s.id) + 1;
      const base = num(s.due) - Math.abs(num(s.due) * 0); // bill before discounts
      let pct = 0, label = '';
      if (key && position >= from && sibPct > 0) { pct = Math.max(pct, sibPct); label = `Sibling discount — child ${position} of ${sibs.length}`; }
      if (s.staffChild && staffPct > 0) { pct = Math.max(pct, staffPct); label = 'Staff child discount'; }
      if (s.scholar && scholPct > 0) { pct = Math.max(pct, scholPct); label = 'Scholarship'; }
      if (pct <= 0) continue;
      const amount = Math.round(base * pct / 100);
      if (amount <= 0) continue;
      toWrite.push({ student_id: s.id, amount: -amount, reason: `${label} (${pct}%)` });
    }

    if (!toWrite.length) { toast('No pupil qualifies for a discount under these rules.', 'error'); return; }

    // remove the standing rule-generated rows first, then insert the fresh set
    const kinds = ['discount_sibling', 'discount_staff', 'scholarship'];
    const { error: delErr } = await sb.from('fee_adjustments')
      .delete().eq('school_id', schoolId).in('kind', kinds).eq('standing', true);
    if (delErr) { toast(FF.friendlyError(delErr), 'error'); return; }
    const { error: insErr } = await sb.from('fee_adjustments').insert(
      toWrite.map(w => ({ school_id: schoolId, student_id: w.student_id, kind: 'discount_sibling',
        amount: w.amount, reason: w.reason, standing: true })));
    if (insErr) { toast(FF.friendlyError(insErr), 'error'); return; }
    toast(`${toWrite.length} discount${toWrite.length === 1 ? '' : 's'} applied.`);
    await reload();
  }

  async function applyLateFees() {
    const { data, error } = await sb.rpc('apply_late_fees', { p_school_id: schoolId });
    if (error) { toast(FF.friendlyError(error), 'error'); return; }
    const n = num(data);
    toast(n ? `${n} late fee${n === 1 ? '' : 's'} charged.` : 'No late fees are due yet, or the grace period is still running.', n ? 'success' : 'error');
    await reload();
  }

  function openRoute() { openService('route', null); }
  function openPlan() { openService('plan', null); }

  function openService(kind, row) {
    svcMode = kind; svcEditId = row ? row.id : null;
    $('svcTitle').innerHTML = `${ico(kind === 'route' ? 'mobile' : 'receipt')} ${kind === 'route' ? 'Bus route' : 'Meal plan'}`;
    $('svcNameLabel').textContent = kind === 'route' ? 'Route name' : 'Plan name';
    $('svcName').placeholder = kind === 'route' ? 'e.g. Kiambu Town — Gatundu' : 'e.g. Full board';
    $('svcExtra').previousElementSibling.textContent = kind === 'route'
      ? 'Driver / vehicle (optional)' : 'What is included (optional)';
    $('svcName').value = row ? row.name : '';
    $('svcExtra').value = row ? (row.vehicle || row.description || '') : '';
    $('svcAmounts').innerHTML = window.FA._svcAmounts(row ? row.amounts : [], 'svcAmt');
    FFUI.openModal('svc');
  }

  function editService(kind, id) {
    const row = (kind === 'route' ? routes : plans).find(r => r.id === id);
    if (row) openService(kind, row);
  }

  async function saveService() {
    const name = $('svcName').value.trim();
    if (name.length < 2) { toast('Give it a name.', 'error'); return; }
    const amounts = termNames.map((_, i) => Math.max(0, num($('svcAmt' + i).value)));
    const table = svcMode === 'route' ? 'transport_routes' : 'meal_plans';
    const row = { school_id: schoolId, name, amounts };
    if (svcMode === 'route') row.vehicle = $('svcExtra').value.trim() || null;
    else row.description = $('svcExtra').value.trim() || null;
    const q = svcEditId ? sb.from(table).update(row).eq('id', svcEditId) : sb.from(table).insert(row);
    const { error } = await q;
    if (error) { toast(FF.friendlyError(error), 'error'); return; }
    FFUI.closeModal('svc');
    toast(svcEditId ? 'Saved.' : 'Added.');
    await reload();
  }

  async function deleteService(kind, id) {
    if (!window.confirm('Delete this? Pupils assigned to it will no longer be charged for it.')) return;
    const table = kind === 'route' ? 'transport_routes' : 'meal_plans';
    const { error } = await sb.from(table).update({ active: false }).eq('id', id);
    if (error) { toast(FF.friendlyError(error), 'error'); return; }
    toast('Removed.');
    await reload();
  }

  async function assign(studentId, which, value) {
    const patch = which === 'route' ? { transport_route_id: value || null } : { meal_plan_id: value || null };
    const { error } = await sb.from('students').update(patch).eq('id', studentId);
    if (error) { toast(FF.friendlyError(error), 'error'); return; }
    toast(which === 'route' ? 'Bus route updated.' : 'Meal plan updated.');
    await reload();
  }

  function showHistory(id) {
    const h = (window.FA.history || []).find(x => String(x.id) === String(id));
    if (!h) return;
    $('historyDetailCard').hidden = false;
    $('historyDetailTitle').innerHTML = `Version ${h.version}${h.superseded_at ? '' : ' <span class="ff-badge ff-badge-green">current</span>'}`;
    $('historyDetailSub').textContent = `Published ${FFUI.fmtDateTime(h.published_at)} · ${(h.term_names || []).join(', ')}`;
    const levels = (h.data && h.data.levels) || [];
    $('historyDetailBody').innerHTML = levels.length
      ? levels.map(lv => `
          <h4 style="margin:0 0 8px">${esc(lv.name)}</h4>
          ${(lv.grades || []).map(g => `
            <div style="margin-bottom:10px">
              <div style="font-weight:600;font-size:13px">${esc(g.name)}</div>
              <div class="ff-hint">${(g.fees || []).map(f => `${esc(f.name)} ${money((f.amounts || [])[0])}`).join(' · ') || 'no fees'}</div>
            </div>`).join('')}`).join('')
      : `<div class="ff-empty"><p>This version has no levels recorded.</p></div>`;
  }

  async function reload() {
    await loadAll();
    renderAll();
  }

  /* ------------------------------------------------------------ boot --------- */
  async function init() {
    if (!window.FF) {
      $('unauthorizedPage').style.display = 'block';
      $('ffApp').style.display = 'none';
      return;
    }
    sb = FF.sb;
    // requireRole already redirected anyone without the right role; null means "not allowed"
    me = await FF.requireRole('school_admin');
    if (!me || !me.school_id) {
      $('unauthorizedPage').style.display = 'block';
      $('ffApp').style.display = 'none';
      return;
    }
    schoolId = me.school_id;
    $('unauthorizedPage').style.display = 'none';
    $('ffApp').style.display = 'flex';
    const school = await sb.from('schools').select('name, level').eq('id', schoolId).maybeSingle();
    $('schoolNameDisplay').querySelector('span').textContent = (school.data && school.data.name) || 'School';
    document.title = `FeeFlow — ${(school.data && school.data.name) || 'School'}`;

    try {
      await loadAll();
      renderAll();
    } catch (err) {
      const m = String((err && err.message) || err);
      $('levelBanner').style.display = 'flex';
      $('levelBannerText').innerHTML = /does not exist|PGRST106|schema cache/i.test(m)
        ? `The fee-adjustments tables are not in this database yet. Run migration
           <strong>20261031_0012_fee_adjustments_and_history.sql</strong> in the Supabase SQL Editor,
           then reload.`
        : `${FF.friendlyError(err)} <button class="ff-btn ff-btn-outline ff-btn-sm" style="margin-left:8px" onclick="FA.reload()">Try again</button>`;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    FFUI.loadTheme();
    const btn = $('themeBtn');
    if (btn) btn.addEventListener('click', () => FFUI.setTheme(FFUI.loadTheme() === 'dark' ? 'light' : 'dark'));
    if (window.FFUI && window.FFUI.wireModals) window.FFUI.wireModals();
  });

  window.FA = {
    KINDS, LABELS, TABS,
    get state() { return { students, adjustments, rules, terms, routes, plans, termNames }; },
    init, reload, go, renderAll,
    openAdjustment, saveAdjustment, toggleAdjustment,
    saveRules, applyRules, applyLateFees, syncKindHint, syncLateFeeHint,
    openRoute, openPlan, editService, saveService, deleteService, assign,
    renderAdjustments, renderAssignments, showHistory, renderFilters
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
