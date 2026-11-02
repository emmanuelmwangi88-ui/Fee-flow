/* FeeFlow — School operations: bulk import, class promotion, payment reversals, instalments,
   fee clearance, staff & roles, plan & billing, support.
   Every write goes through a database function that re-checks the caller's school and staff role;
   the role checks here only decide what to show. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => FF.escapeHtml(s);
  const money = n => FFUI.money(n);
  const num = n => Number(n) || 0;

  const ROLES = {
    owner: 'Owner', head: 'Head teacher', bursar: 'Bursar', secretary: 'Secretary'
  };
  const ROLE_HELP = {
    owner: 'Everything, including staff and approving reversals.',
    head: 'Imports, promotes classes, approves reversals, issues clearance, plans instalments.',
    bursar: 'Records payments, requests reversals, plans instalments, issues clearance.',
    secretary: 'Imports and maintains pupil records.'
  };
  /* what each role may DO here (mirrors the database; the database is the real gate) */
  const CAN = {
    import: ['owner', 'head', 'secretary'], promote: ['owner', 'head'],
    requestReversal: ['owner', 'bursar'], decideReversal: ['owner', 'head'],
    instalment: ['owner', 'head', 'bursar'], clearance: ['owner', 'head', 'bursar'], staff: ['owner']
  };
  const TABS = {
    import: 'Import pupils', promote: 'Promote classes', reversals: 'Payment reversals', instalments: 'Instalments',
    clearance: 'Fee clearance', staff: 'Staff & roles', billing: 'Plan & billing', support: 'Support'
  };

  let sb, me, schoolId, school = {}, role = 'owner', students = [], current = 'import';
  let importRows = [], tickets = [];
  const can = what => CAN[what].includes(role);

  function msg(e) {
    const m = String((e && e.message) || e || '');
    if ((e && e.code === '42501') && /staff|role|different|cannot/i.test(m)) return m;
    return FF.friendlyError(e);
  }
  const toast = (m, t) => FFUI.toast(m, t || 'success');
  const fail = e => FFUI.toast(msg(e), 'error');
  const empty = (icon, text) => `<div class="ff-empty"><div class="ff-empty-icon"><i data-ico="${icon}"></i></div><p>${text}</p></div>`;
  const locked = what => `<div class="ff-alert info" style="margin-bottom:14px"><i data-ico="lock"></i><div>Your role (<strong>${esc(ROLES[role])}</strong>) cannot ${what}. Ask the school owner if you need it.</div></div>`;
  const head = (icon, color, title, sub, extra) => `<div class="ff-page-head"><div><div class="ff-page-title"><i data-ico="${icon}" style="color:${color}"></i> ${title}</div><div class="ff-page-desc">${sub}</div></div>${extra || ''}</div>`;
  const badge = (cls, t) => `<span class="ff-badge ${cls}">${esc(t)}</span>`;
  function paint(el) { FFUI.paint(el || document); }

  /* ---------------------------------------------------------- CSV parsing ---- */
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = String(text || '').replace(/^﻿/, '');
    const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(x => x.trim() !== '')) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some(x => x.trim() !== '')) rows.push(row);
    return rows;
  }
  const HEADERS = {
    admission_no: ['admission_no', 'admission no', 'admission number', 'admno', 'adm no', 'adm', 'adm.', 'admission'],
    full_name: ['full_name', 'full name', 'name', 'pupil', 'pupil name', 'student', 'student name', 'learner', 'learner name'],
    class_name: ['class_name', 'class', 'grade', 'form', 'class name', 'stream'],
    gender: ['gender', 'sex'],
    boarding: ['boarding', 'boarder', 'boarding status', 'day/boarding'],
    guardian_name: ['guardian_name', 'guardian', 'guardian name', 'parent', 'parent name'],
    guardian_phone: ['guardian_phone', 'guardian phone', 'parent phone', 'phone', 'mobile', 'phone number', 'guardian contact', 'parent contact']
  };
  function mapRows(grid) {
    if (grid.length < 2) return { rows: [], missing: ['admission_no', 'full_name', 'class_name'] };
    const hdr = grid[0].map(h => h.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' '));
    const idx = {};
    for (const k in HEADERS) idx[k] = hdr.findIndex(h => HEADERS[k].map(x => x.replace(/_/g, ' ')).includes(h));
    const missing = ['admission_no', 'full_name', 'class_name'].filter(k => idx[k] < 0);
    const rows = grid.slice(1).map(r => {
      const o = {};
      for (const k in idx) o[k] = idx[k] >= 0 ? String(r[idx[k]] == null ? '' : r[idx[k]]).trim() : '';
      return o;
    });
    return { rows, missing };
  }

  /* ------------------------------------------------------------ data ---------- */
  async function loadStudents() {
    const r = await sb.from('student_balances')
      .select('id, admission_no, full_name, class_name, guardian_phone, active, total_due, paid, balance, credit').order('full_name');
    if (r.error) throw r.error;
    students = (r.data || []).map(s => ({ ...s, due: num(s.total_due), paid: num(s.paid), balance: num(s.balance), credit: num(s.credit) }));
  }

  /* ============================================================ IMPORT ===== */
  function renderImport() {
    $('view-import').innerHTML = head('upload', 'var(--ff-blue)', 'Import pupils',
      'Add a whole class or school at once from a spreadsheet saved as CSV. Existing admission numbers are updated, not duplicated.') +
      (can('import') ? '' : locked('import pupils')) + `
      <div class="ff-card"><div class="ff-card-body">
        <div class="ff-row">
          <div class="ff-field"><label class="ff-label" for="csvFile">CSV file</label>
            <input class="ff-input" type="file" id="csvFile" accept=".csv,text/csv" ${can('import') ? '' : 'disabled'}>
            <div class="ff-hint">In Excel or Google Sheets: File → Save as / Download → CSV.</div></div>
          <div class="ff-field"><label class="ff-label">Need a template?</label>
            <button class="ff-btn ff-btn-outline" type="button" onclick="ST.downloadTemplate()"><i data-ico="download" data-size="ff-ico-sm"></i> Download template</button>
            <div class="ff-hint">Columns: Admission No, Name, Class, Gender, Boarding, Guardian Name, Guardian Phone.</div></div>
        </div>
        <div class="ff-field"><label class="ff-label" for="csvText">…or paste rows here</label>
          <textarea class="ff-textarea" id="csvText" rows="4" placeholder="Admission No,Name,Class,Gender,Guardian Phone&#10;1001,Amani Wanjiru,Grade 4,F,0712345678" ${can('import') ? '' : 'disabled'}></textarea></div>
        <button class="ff-btn ff-btn-primary" type="button" id="previewBtn" onclick="ST.previewImport()" ${can('import') ? '' : 'disabled'}><i data-ico="eye" data-size="ff-ico-sm"></i> Preview</button>
      </div></div>
      <div id="importPreview" style="margin-top:18px"></div>`;
    paint($('view-import'));
    const f = $('csvFile');
    if (f) f.addEventListener('change', () => {
      const file = f.files && f.files[0]; if (!file) return;
      if (file.size > 3 * 1024 * 1024) { toast('That file is too large. Split it into smaller files.', 'error'); return; }
      const rd = new FileReader();
      rd.onload = () => { $('csvText').value = String(rd.result || ''); previewImport(); };
      rd.readAsText(file);
    });
  }
  function downloadTemplate() {
    const csv = 'Admission No,Name,Class,Gender,Boarding,Guardian Name,Guardian Phone\r\n1001,Amani Wanjiru,Grade 4,F,No,Jane Wanjiru,0712345678\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'feeflow-pupils-template.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function previewImport() {
    const { rows, missing } = mapRows(parseCsv($('csvText').value));
    const box = $('importPreview');
    if (missing.length) {
      importRows = [];
      box.innerHTML = `<div class="ff-alert warning"><i data-ico="alert"></i><div>These required columns were not found: <strong>${missing.map(m => ({ admission_no: 'Admission No', full_name: 'Name', class_name: 'Class' })[m]).join(', ')}</strong>. Check the first row of your file.</div></div>`;
      paint(box); return;
    }
    importRows = rows;
    const known = new Set(students.map(s => String(s.admission_no).trim().toUpperCase()));
    const seen = new Set(); let dupes = 0, news = 0, upd = 0, bad = 0;
    rows.forEach(r => {
      const k = r.admission_no.toUpperCase();
      if (!r.admission_no || !r.full_name || !r.class_name) bad++;
      else if (seen.has(k)) dupes++;
      else if (known.has(k)) upd++; else news++;
      seen.add(k);
    });
    box.innerHTML = `<div class="ff-card"><div class="ff-card-head"><div class="ff-card-title">${rows.length} row${rows.length === 1 ? '' : 's'} found</div>
      <div>${badge('green', news + ' new')} ${badge('blue', upd + ' to update')} ${bad ? badge('red', bad + ' incomplete') : ''} ${dupes ? badge('amber', dupes + ' repeated in file') : ''}</div></div>
      <div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Adm</th><th>Name</th><th>Class</th><th>Gender</th><th>Boarding</th><th>Guardian phone</th></tr></thead>
      <tbody>${rows.slice(0, 10).map(r => `<tr><td>${esc(r.admission_no)}</td><td>${esc(r.full_name)}</td><td>${esc(r.class_name)}</td><td>${esc(r.gender)}</td><td>${esc(r.boarding)}</td><td>${esc(r.guardian_phone)}</td></tr>`).join('')}</tbody></table></div>
      ${rows.length > 10 ? `<div class="ff-hint" style="padding:8px 18px">Showing the first 10 rows.</div>` : ''}
      <div class="ff-card-body"><button class="ff-btn ff-btn-primary" type="button" id="importBtn" onclick="ST.runImport()" ${rows.length && can('import') ? '' : 'disabled'}><i data-ico="check" data-size="ff-ico-sm"></i> Import ${rows.length} pupil${rows.length === 1 ? '' : 's'}</button></div></div>`;
    paint(box);
  }
  async function runImport() {
    if (!importRows.length) return;
    const btn = $('importBtn'); btn.disabled = true;
    let ins = 0, upd = 0; const errs = [];
    try {
      for (let i = 0; i < importRows.length; i += 500) {
        const chunk = importRows.slice(i, i + 500);
        const { data, error } = await sb.rpc('import_students', { p_rows: chunk });
        if (error) throw error;
        ins += num(data.inserted); upd += num(data.updated);
        (data.errors || []).forEach(e => errs.push({ ...e, row: num(e.row) + i + 1 }));
      }
    } catch (e) { fail(e); btn.disabled = false; return; }
    await loadStudents();
    $('importPreview').innerHTML = `<div class="ff-card"><div class="ff-card-head"><div class="ff-card-title"><i data-ico="checkCircle" style="color:var(--ff-green)"></i> Import finished</div></div>
      <div class="ff-card-body"><p><strong>${ins}</strong> added, <strong>${upd}</strong> updated, <strong>${errs.length}</strong> rejected.</p>
      ${errs.length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Row</th><th>Adm</th><th>Problem</th></tr></thead><tbody>${errs.map(e => `<tr><td>${e.row}</td><td>${esc(e.admission_no)}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="ff-hint" style="margin-top:10px">Fees are worked out from your published fee structure, so pupils whose class has no fees yet show nil until you publish it.</p></div></div>`;
    importRows = []; $('csvText').value = ''; paint($('importPreview'));
    toast(`${ins + upd} pupils saved.`);
  }

  /* ========================================================== PROMOTION ==== */
  const baseOf = c => String(c || '').trim().replace(/(\d)\s*[A-Z]$/, '$1').replace(/^Class\s+/i, 'Grade ').replace(/\s+/g, ' ');
  function nextClass(base) {
    let m;
    if ((m = /^Grade (\d+)$/i.exec(base))) { const n = +m[1]; return n >= 12 ? '' : 'Grade ' + (n + 1); }
    if (/^PP\s*1$/i.test(base)) return 'PP2';
    if (/^PP\s*2$/i.test(base)) return 'Grade 1';
    if ((m = /^Form (\d)$/i.exec(base))) { const n = +m[1]; return n >= 4 ? '' : 'Form ' + (n + 1); }
    if (/^(baby|nursery)/i.test(base)) return 'PP1';
    return null;     // unknown naming: the bursar chooses
  }
  const ORDER = c => { let m; if ((m = /^Grade (\d+)/i.exec(c))) return 100 + (+m[1]); if ((m = /^Form (\d)/i.exec(c))) return 200 + (+m[1]); if (/^PP/i.test(c)) return 50 + parseInt(c.replace(/\D/g, '') || 0, 10); return 999; };
  function renderPromote() {
    const groups = {};
    students.filter(s => s.active).forEach(s => {
      const b = baseOf(s.class_name); (groups[b] = groups[b] || { count: 0, owing: 0 });
      groups[b].count++; groups[b].owing += s.balance;
    });
    const names = Object.keys(groups).sort((a, b) => ORDER(a) - ORDER(b) || a.localeCompare(b));
    const targets = Array.from(new Set(['PP1', 'PP2'].concat(Array.from({ length: 12 }, (_, i) => 'Grade ' + (i + 1)), ['Form 1', 'Form 2', 'Form 3', 'Form 4']).concat(names)));
    $('view-promote').innerHTML = head('swap', 'var(--ff-violet)', 'Promote classes', 'Move pupils up at the end of the year. Unpaid balances are carried forward as arrears and this year\'s payments start fresh.') +
      (can('promote') ? '' : locked('promote classes')) +
      (names.length ? `<div class="ff-alert info" style="margin-bottom:14px"><i data-ico="info"></i><div>Suggested moves follow the CBC path: PP1 → PP2 → Grade 1 … Grade 12, and 8-4-4 Form 1 → Form 4. Grade 6, Grade 9 and Grade 12 are the CBC transitions to Junior, Senior and school-leaving, so check them before you go. <strong>Do this once per year.</strong></div></div>
      <div class="ff-card"><div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Class</th><th>Pupils</th><th>Owing</th><th>Move to</th></tr></thead><tbody>
      ${names.map((n, i) => { const nx = nextClass(n); return `<tr><td><strong>${esc(n)}</strong></td><td>${groups[n].count}</td><td>${money(groups[n].owing)}</td>
        <td><select class="ff-select" data-from="${esc(n)}" id="mv${i}" ${can('promote') ? '' : 'disabled'}>
          <option value="__skip"${nx === null ? ' selected' : ''}>— leave as is —</option>
          <option value=""${nx === '' ? ' selected' : ''}>Leaves the school</option>
          ${targets.filter(t => t !== n).map(t => `<option value="${esc(t)}"${nx === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        </select></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="ff-card-body"><label class="ff-check"><input type="checkbox" id="carryArrears" checked> Carry unpaid balances forward as arrears</label>
        <div class="ff-hint" style="margin:6px 0 14px">Overpayments are carried forward as credit. Last year's one-off waivers and late fees end; standing bursaries continue.</div>
        <button class="ff-btn ff-btn-primary" type="button" onclick="ST.runPromotion()" ${can('promote') ? '' : 'disabled'}><i data-ico="check" data-size="ff-ico-sm"></i> Promote selected classes</button></div></div>`
        : empty('student', 'There are no active pupils to promote yet.'));
    paint($('view-promote'));
  }
  async function runPromotion() {
    const moves = []; let total = 0;
    document.querySelectorAll('#view-promote select[data-from]').forEach(sel => {
      if (sel.value === '__skip') return;
      moves.push({ from: sel.getAttribute('data-from'), to: sel.value });
    });
    if (!moves.length) { toast('Choose where at least one class goes.', 'error'); return; }
    moves.forEach(m => { total += students.filter(s => s.active && baseOf(s.class_name) === m.from).length; });
    if (!confirm(`Move ${total} pupils across ${moves.length} classes?\n\nThis starts a new year for them and cannot be undone automatically.`)) return;
    const { data, error } = await sb.rpc('promote_students', { p_moves: moves, p_carry: $('carryArrears').checked });
    if (error) { fail(error); return; }
    toast(`${num(data.moved)} promoted, ${num(data.left)} left the school, ${num(data.arrears_carried)} balances carried forward.`);
    await loadStudents(); renderPromote();
  }

  /* ========================================================== REVERSALS ==== */
  async function renderReversals() {
    const v = $('view-reversals');
    v.innerHTML = head('refresh', 'var(--ff-amber)', 'Payment reversals', 'A payment recorded by mistake is reversed only after a second person approves it. Every step is logged.') + '<div class="ff-hint">Loading…</div>';
    const [pay, rev] = await Promise.all([
      sb.from('payments').select('id, student_id, amount, method, mpesa_receipt, receipt_no, completed_at, note').eq('status', 'completed').order('completed_at', { ascending: false }).limit(60),
      sb.from('payment_reversals').select('id, payment_id, reason, status, requested_by, requested_at, decided_at, decision_note').order('requested_at', { ascending: false }).limit(60)
    ]);
    if (pay.error || rev.error) { v.innerHTML += ''; fail(pay.error || rev.error); return; }
    const byId = Object.fromEntries(students.map(s => [s.id, s]));
    const payById = Object.fromEntries((pay.data || []).map(p => [p.id, p]));
    const pendingFor = new Set((rev.data || []).filter(r => r.status === 'pending').map(r => r.payment_id));
    const pend = (rev.data || []).filter(r => r.status === 'pending');
    v.innerHTML = head('refresh', 'var(--ff-amber)', 'Payment reversals', 'A payment recorded by mistake is reversed only after a second person approves it. Every step is logged.') + `
      <div class="ff-card" style="margin-bottom:18px"><div class="ff-card-head"><div class="ff-card-title">Waiting for a decision ${pend.length ? badge('amber', pend.length) : ''}</div></div>
      ${pend.length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Pupil</th><th>Amount</th><th>Reason</th><th>Requested</th><th></th></tr></thead><tbody>
      ${pend.map(r => { const p = payById[r.payment_id] || {}; const s = byId[p.student_id] || {}; return `<tr><td><strong>${esc(s.full_name || '—')}</strong><div class="ff-hint">${esc(s.admission_no || '')}</div></td><td>${money(p.amount)}</td><td>${esc(r.reason)}</td><td>${esc(FFUI.timeAgo(r.requested_at))}</td>
        <td>${can('decideReversal') ? `<button class="ff-btn ff-btn-primary ff-btn-sm" type="button" onclick="ST.decide('${r.id}',true)">Approve</button> <button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.decide('${r.id}',false)">Reject</button>` : '<span class="ff-hint">Owner or head teacher decides</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>` : `<div class="ff-card-body">${empty('checkCircle', 'Nothing is waiting.')}</div>`}</div>
      <div class="ff-card"><div class="ff-card-head"><div class="ff-card-title">Recent completed payments</div></div>
      ${(pay.data || []).length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Date</th><th>Pupil</th><th>Amount</th><th>Method</th><th>Receipt</th><th></th></tr></thead><tbody>
      ${(pay.data || []).map(p => { const s = byId[p.student_id] || {}; return `<tr><td>${esc(FFUI.fmtDateTime(p.completed_at))}</td><td><strong>${esc(s.full_name || '—')}</strong></td><td>${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.mpesa_receipt || p.receipt_no || '—')}</td>
        <td>${pendingFor.has(p.id) ? badge('amber', 'reversal pending') : (can('requestReversal') ? `<button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.askReverse('${p.id}')">Request reversal</button>` : '')}</td></tr>`; }).join('')}
      </tbody></table></div>` : `<div class="ff-card-body">${empty('money', 'No completed payments yet.')}</div>`}</div>
      ${(rev.data || []).some(r => r.status !== 'pending') ? `<div class="ff-card" style="margin-top:18px"><div class="ff-card-head"><div class="ff-card-title">Decided</div></div><div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Reason</th><th>Outcome</th><th>When</th><th>Note</th></tr></thead><tbody>
      ${(rev.data || []).filter(r => r.status !== 'pending').map(r => `<tr><td>${esc(r.reason)}</td><td>${badge(r.status === 'approved' ? 'green' : 'red', r.status)}</td><td>${esc(FFUI.fmtDate(r.decided_at))}</td><td>${esc(r.decision_note || '')}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`;
    paint(v);
  }
  function askReverse(paymentId) {
    openOp('Request a reversal', `<div class="ff-field"><label class="ff-label" for="revReason">Why must this payment be reversed?</label>
      <textarea class="ff-textarea" id="revReason" rows="3" placeholder="e.g. Recorded against the wrong pupil"></textarea>
      <div class="ff-hint">Another staff member must approve it before anything changes.</div></div>`, 'Request reversal', async () => {
      const reason = $('revReason').value.trim();
      if (reason.length < 5) { toast('Give a reason of at least 5 characters.', 'error'); return false; }
      const { error } = await sb.rpc('request_payment_reversal', { p_payment: paymentId, p_reason: reason });
      if (error) { fail(error); return false; }
      toast('Reversal requested. Waiting for approval.'); renderReversals(); return true;
    });
  }
  async function decide(id, approve) {
    const note = approve ? '' : (prompt('Reason for rejecting (optional):') || '');
    if (approve && !confirm('Approve this reversal? The payment is removed from the pupil\'s paid total.')) return;
    const { error } = await sb.rpc('decide_payment_reversal', { p_id: id, p_approve: !!approve, p_note: note });
    if (error) { fail(error); return; }
    toast(approve ? 'Reversal approved.' : 'Reversal rejected.');
    await loadStudents(); renderReversals();
  }

  /* ========================================================= INSTALMENTS === */
  async function renderInstalments() {
    const v = $('view-instalments');
    const r = await sb.from('instalment_plans').select('id, student_id, parts, balance_at_creation, paid_at_creation, created_at, instalment_items(seq, due_date, amount)').eq('active', true).order('created_at', { ascending: false });
    if (r.error) { fail(r.error); return; }
    const byId = Object.fromEntries(students.map(s => [s.id, s]));
    const today = new Date().toISOString().slice(0, 10);
    v.innerHTML = head('calendar', 'var(--ff-blue)', 'Instalment plans', 'Split what a pupil owes into 2–6 dated parts. Parents see the schedule; payments are matched as usual.',
      can('instalment') ? '<button class="ff-btn ff-btn-primary" type="button" onclick="ST.newPlan()"><i data-ico="plus" data-size="ff-ico-sm"></i> New plan</button>' : '') +
      (can('instalment') ? '' : locked('create instalment plans')) +
      ((r.data || []).length ? (r.data || []).map(p => {
        const s = byId[p.student_id] || {}; const items = (p.instalment_items || []).sort((a, b) => a.seq - b.seq);
        const paidSince = Math.max(0, num(s.paid) - num(p.paid_at_creation)); let cum = 0;
        const rows = items.map(it => { cum += num(it.amount); const done = paidSince >= cum - 0.005; const late = !done && it.due_date < today;
          return `<tr><td>${it.seq}</td><td>${esc(FFUI.fmtDate(it.due_date))}</td><td>${money(it.amount)}</td><td>${done ? badge('green', 'paid') : late ? badge('red', 'overdue') : badge('blue', 'upcoming')}</td></tr>`; }).join('');
        const next = items.find(it => { return paidSince < items.filter(x => x.seq <= it.seq).reduce((a, x) => a + num(x.amount), 0) - 0.005; });
        const wa = s.guardian_phone && next ? `<button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.shareWhatsApp('${p.student_id}')"><i data-ico="send" data-size="ff-ico-sm"></i> WhatsApp</button>` : '';
        return `<div class="ff-card" style="margin-bottom:14px"><div class="ff-card-head"><div><div class="ff-card-title">${esc(s.full_name || 'Pupil')} <span class="ff-hint">${esc(s.admission_no || '')} · ${esc(s.class_name || '')}</span></div>
          <div class="ff-hint">${p.parts} parts of a ${money(p.balance_at_creation)} balance · still owes ${money(s.balance)}</div></div>
          <div class="ff-row" style="gap:6px;display:flex">${wa}${can('instalment') ? `<button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.cancelPlan('${p.id}')">Cancel plan</button>` : ''}</div></div>
          <div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>`; }).join('')
        : `<div class="ff-card"><div class="ff-card-body">${empty('calendar', 'No active instalment plans.')}</div></div>`);
    paint(v);
  }
  function newPlan() {
    const owing = students.filter(s => s.active && s.balance > 0);
    if (!owing.length) { toast('No pupil owes anything right now.', 'error'); return; }
    const d = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    openOp('New instalment plan', `<div class="ff-field"><label class="ff-label" for="plStudent">Pupil</label>
      <select class="ff-select" id="plStudent">${owing.map(s => `<option value="${s.id}">${esc(s.full_name)} (${esc(s.admission_no)}) — owes ${money(s.balance)}</option>`).join('')}</select></div>
      <div class="ff-row"><div class="ff-field"><label class="ff-label" for="plParts">Number of parts</label><input class="ff-input" type="number" id="plParts" min="2" max="6" value="3"></div>
      <div class="ff-field"><label class="ff-label" for="plGap">Days between parts</label><input class="ff-input" type="number" id="plGap" min="7" max="120" value="30"></div></div>
      <div class="ff-field"><label class="ff-label" for="plFirst">First part due</label><input class="ff-input" type="date" id="plFirst" value="${d}"></div>`,
      'Create plan', async () => {
        const { error } = await sb.rpc('create_instalment_plan', { p_student: $('plStudent').value, p_parts: +$('plParts').value, p_first_due: $('plFirst').value, p_gap_days: +$('plGap').value });
        if (error) { fail(error); return false; }
        toast('Instalment plan created.'); renderInstalments(); return true;
      });
  }
  async function cancelPlan(id) {
    if (!confirm('Cancel this instalment plan?')) return;
    const { error } = await sb.rpc('cancel_instalment_plan', { p_plan: id });
    if (error) { fail(error); return; }
    toast('Plan cancelled.'); renderInstalments();
  }
  function shareWhatsApp(studentId) {
    const s = students.find(x => x.id === studentId); if (!s) return;
    const text = `Dear parent of ${s.full_name} (${s.admission_no}), ${school.name || 'the school'} reminds you that the fee balance is ${money(s.balance)}. Please pay via the school's M-Pesa paybill${school.paybill ? ' ' + school.paybill : ''}, account ${s.admission_no}. Thank you.`;
    const url = FFUI.waLink(s.guardian_phone, text);
    if (!url) { toast('This pupil has no valid guardian phone number.', 'error'); return; }
    window.open(url, '_blank', 'noopener');
  }

  /* ========================================================== CLEARANCE ==== */
  async function renderClearance() {
    const v = $('view-clearance');
    const r = await sb.from('clearance_certificates').select('id, student_id, serial, label, issued_at').order('issued_at', { ascending: false }).limit(50);
    if (r.error) { fail(r.error); return; }
    const byId = Object.fromEntries(students.map(s => [s.id, s]));
    v.innerHTML = head('checkCircle', 'var(--ff-green)', 'Fee clearance', 'A numbered certificate that a pupil owes nothing — for exams, transfers or leaving. It can only be issued at a nil balance.') +
      (can('clearance') ? '' : locked('issue clearance certificates')) + `
      <div class="ff-card" style="margin-bottom:18px"><div class="ff-card-body">
        <div class="ff-field"><label class="ff-label" for="clrSearch">Find a pupil</label>
        <input class="ff-input" id="clrSearch" placeholder="Name or admission number" oninput="ST.clrFind()" style="max-width:340px"></div>
        <div id="clrResults"></div></div></div>
      <div class="ff-card"><div class="ff-card-head"><div class="ff-card-title">Issued certificates</div></div>
      ${(r.data || []).length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Serial</th><th>Pupil</th><th>Issued</th><th>Purpose</th><th></th></tr></thead><tbody>
      ${(r.data || []).map(c => { const s = byId[c.student_id] || {}; return `<tr><td><strong>${esc(c.serial)}</strong></td><td>${esc(s.full_name || '—')}</td><td>${esc(FFUI.fmtDate(c.issued_at))}</td><td>${esc(c.label || '')}</td>
        <td><button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.printClearance('${c.student_id}','${esc(c.serial)}','${esc(c.issued_at)}','${esc(c.label || '')}')"><i data-ico="print" data-size="ff-ico-sm"></i> Print</button></td></tr>`; }).join('')}
      </tbody></table></div>` : `<div class="ff-card-body">${empty('file', 'No certificates issued yet.')}</div>`}</div>`;
    paint(v);
  }
  function clrFind() {
    const q = $('clrSearch').value.trim().toLowerCase(); const box = $('clrResults');
    if (q.length < 2) { box.innerHTML = ''; return; }
    const hits = students.filter(s => (s.full_name + ' ' + s.admission_no).toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = hits.length ? `<div class="ff-table-wrap"><table class="ff-table"><tbody>${hits.map(s => `<tr><td><strong>${esc(s.full_name)}</strong><div class="ff-hint">${esc(s.admission_no)} · ${esc(s.class_name)}</div></td>
      <td>${s.balance > 0 ? badge('red', 'owes ' + money(s.balance)) : badge('green', 'cleared')}</td>
      <td>${s.balance <= 0 && can('clearance') ? `<button class="ff-btn ff-btn-primary ff-btn-sm" type="button" onclick="ST.issueClearance('${s.id}')">Issue certificate</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="ff-hint">No match.</div>';
  }
  async function issueClearance(id) {
    const label = prompt('Purpose (optional), e.g. "End of Term 3" or "Transfer":') || '';
    const { data, error } = await sb.rpc('issue_clearance', { p_student: id, p_label: label });
    if (error) { fail(error); return; }
    toast('Certificate ' + data.serial + ' issued.');
    printClearance(id, data.serial, data.issued_at, label); renderClearance();
  }
  function printClearance(studentId, serial, issuedAt, label) {
    const s = students.find(x => x.id === studentId) || {};
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print the certificate.', 'error'); return; }
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fee clearance ${esc(serial)}</title>
      <style>body{font-family:Georgia,serif;max-width:680px;margin:50px auto;padding:30px;border:3px double #0c2d57;color:#111}h1{text-align:center;margin:0}h2{text-align:center;font-weight:400;margin:6px 0 28px;letter-spacing:.12em;text-transform:uppercase;font-size:15px}p{line-height:1.8;font-size:16px}.s{display:flex;justify-content:space-between;margin-top:70px;font-size:13px}.s div{border-top:1px solid #000;padding-top:6px;width:42%;text-align:center}.m{text-align:center;font-size:12px;color:#555;margin-top:30px}</style></head><body>
      <h1>${esc(school.name || 'School')}</h1><h2>Fee clearance certificate</h2>
      <p>This is to certify that <strong>${esc(s.full_name || '')}</strong>, admission number <strong>${esc(s.admission_no || '')}</strong>, of <strong>${esc(s.class_name || '')}</strong>, has paid all fees due to the school and owes <strong>nothing</strong> as at <strong>${esc(FFUI.fmtDate(issuedAt))}</strong>.</p>
      ${label ? `<p>Purpose: ${esc(label)}</p>` : ''}
      <div class="s"><div>Bursar</div><div>Head teacher &amp; school stamp</div></div>
      <p class="m">Certificate no. ${esc(serial)} · Issued through FeeFlow · Valid only with the school stamp</p>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  /* ============================================================== STAFF ===== */
  async function renderStaff() {
    const v = $('view-staff');
    const { data, error } = await sb.rpc('list_staff');
    if (error) { fail(error); return; }
    const owner = can('staff');
    v.innerHTML = head('users', 'var(--ff-blue)', 'Staff & roles', 'Give each person only what their job needs. Staff join by signing up with the invited email address.',
      owner ? '<button class="ff-btn ff-btn-primary" type="button" onclick="ST.inviteStaff()"><i data-ico="plus" data-size="ff-ico-sm"></i> Invite staff</button>' : '') +
      (owner ? '' : locked('manage staff')) + `
      <div class="ff-card" style="margin-bottom:18px"><div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Person</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
      ${(data || []).map(p => `<tr><td><strong>${esc(p.full_name || p.email)}</strong><div class="ff-hint">${esc(p.email || '')}</div></td>
        <td>${owner && !p.pending ? `<select class="ff-select" onchange="ST.setRole('${p.user_id}',this.value)">${Object.keys(ROLES).map(k => `<option value="${k}"${k === p.staff_role ? ' selected' : ''}>${ROLES[k]}</option>`).join('')}</select>` : esc(ROLES[p.staff_role] || p.staff_role)}</td>
        <td>${p.pending ? badge('amber', 'invited') : badge('green', 'active')}</td>
        <td>${owner ? (p.pending ? `<button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.cancelInvite('${p.invite_id}')">Cancel invite</button>` : (p.user_id !== me.id ? `<button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.removeStaff('${p.user_id}')">Remove</button>` : badge('', 'you'))) : ''}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="ff-card"><div class="ff-card-head"><div class="ff-card-title">What each role can do</div></div><div class="ff-card-body">
      ${Object.keys(ROLES).map(k => `<p style="margin-bottom:8px"><strong>${ROLES[k]}</strong> — ${ROLE_HELP[k]}</p>`).join('')}
      <p class="ff-hint">Roles control the actions on this page. Everyone on staff can still see the school's pupils and payments.</p></div></div>`;
    paint(v);
  }
  function inviteStaff() {
    openOp('Invite a staff member', `<div class="ff-field"><label class="ff-label" for="invEmail">Their email address</label><input class="ff-input" type="email" id="invEmail" placeholder="bursar@yourschool.ac.ke"></div>
      <div class="ff-field"><label class="ff-label" for="invRole">Role</label><select class="ff-select" id="invRole">${Object.keys(ROLES).filter(k => k !== 'owner').map(k => `<option value="${k}">${ROLES[k]}</option>`).join('')}<option value="owner">Owner</option></select>
      <div class="ff-hint">They go to FeeFlow, choose <strong>Staff</strong> on the sign-in page, and register with exactly this email.</div></div>`,
      'Send invite', async () => {
        const { error } = await sb.rpc('invite_staff', { p_email: $('invEmail').value, p_role: $('invRole').value });
        if (error) { fail(error); return false; }
        toast('Invitation saved. Ask them to register at FeeFlow with that email.'); renderStaff(); return true;
      });
  }
  async function setRole(user, r) { const { error } = await sb.rpc('set_staff_role', { p_user: user, p_role: r }); if (error) fail(error); else toast('Role updated.'); renderStaff(); }
  async function cancelInvite(id) { const { error } = await sb.rpc('cancel_staff_invite', { p_invite: id }); if (error) fail(error); else toast('Invitation cancelled.'); renderStaff(); }
  async function removeStaff(id) {
    if (!confirm('Remove this person from your staff? They lose access immediately.')) return;
    const { error } = await sb.rpc('remove_staff', { p_user: id }); if (error) fail(error); else toast('Removed.'); renderStaff();
  }

  /* ============================================================ BILLING ===== */
  async function renderBilling() {
    const v = $('view-billing');
    const [inv, sc] = await Promise.all([
      sb.from('subscription_invoices').select('id, number, description, amount, status, due_date, issued_at, paid_at, payment_ref').order('issued_at', { ascending: false }),
      sb.from('schools').select('plan, trial_ends_at, status').eq('id', schoolId).maybeSingle()
    ]);
    if (inv.error) { fail(inv.error); return; }
    const plan = (sc.data && sc.data.plan) || 'Trial'; const ends = sc.data && sc.data.trial_ends_at;
    const daysLeft = ends ? Math.ceil((new Date(ends) - Date.now()) / 864e5) : null;
    const unpaid = (inv.data || []).filter(i => i.status === 'unpaid');
    v.innerHTML = head('receipt', 'var(--ff-green)', 'Plan & billing', 'Your FeeFlow plan and any invoices from the platform.') + `
      <div class="ff-stats ff-stats-3" style="margin-bottom:18px">
        <div class="ff-stat"><div class="ff-stat-value">${esc(plan)}</div><div class="ff-stat-label">Current plan</div></div>
        <div class="ff-stat"><div class="ff-stat-value">${plan === 'Trial' && daysLeft != null ? (daysLeft > 0 ? daysLeft + ' days' : 'Ended') : '—'}</div><div class="ff-stat-label">${plan === 'Trial' ? 'Trial remaining' : 'Trial'}</div></div>
        <div class="ff-stat"><div class="ff-stat-value">${money(unpaid.reduce((a, i) => a + num(i.amount), 0))}</div><div class="ff-stat-label">Unpaid invoices</div></div>
      </div>
      <div class="ff-card"><div class="ff-card-head"><div class="ff-card-title">Invoices</div></div>
      ${(inv.data || []).length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Number</th><th>For</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>
      ${(inv.data || []).map(i => `<tr><td><strong>${esc(i.number)}</strong></td><td>${esc(i.description)}</td><td>${money(i.amount)}</td><td>${esc(FFUI.fmtDate(i.due_date))}</td>
        <td>${badge(i.status === 'paid' ? 'green' : i.status === 'void' ? '' : (i.due_date < new Date().toISOString().slice(0, 10) ? 'red' : 'amber'), i.status)}${i.payment_ref ? `<div class="ff-hint">${esc(i.payment_ref)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="ff-card-body">${empty('receipt', 'No invoices yet.')}</div>`}
      <div class="ff-card-body"><p class="ff-hint">To pay an invoice, contact FeeFlow support from the Support tab and quote the invoice number. Payment is recorded by the platform team once received; FeeFlow does not charge your account automatically.</p></div></div>`;
    paint(v);
  }

  /* ============================================================ SUPPORT ===== */
  async function renderSupport(openId) {
    const v = $('view-support');
    const r = await sb.from('support_tickets').select('id, subject, category, status, created_at, updated_at').order('updated_at', { ascending: false }).limit(50);
    if (r.error) { fail(r.error); return; }
    tickets = r.data || [];
    v.innerHTML = head('mail', 'var(--ff-blue)', 'Support', 'Ask the FeeFlow team for help. Do not include passwords or full card numbers.',
      '<button class="ff-btn ff-btn-primary" type="button" onclick="ST.newTicket()"><i data-ico="plus" data-size="ff-ico-sm"></i> New request</button>') + `
      <div class="ff-card"><div class="ff-card-head"><div class="ff-card-title">Your requests</div></div>
      ${tickets.length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Subject</th><th>Topic</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
      ${tickets.map(t => `<tr><td><strong>${esc(t.subject)}</strong></td><td>${esc(t.category)}</td><td>${badge(t.status === 'answered' ? 'green' : t.status === 'closed' ? '' : 'amber', t.status)}</td><td>${esc(FFUI.timeAgo(t.updated_at))}</td>
        <td><button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.openTicket('${t.id}')">Open</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="ff-card-body">${empty('mail', 'No requests yet.')}</div>`}</div><div id="thread" style="margin-top:18px"></div>`;
    paint(v);
    if (openId) openTicket(openId);
  }
  function newTicket() {
    openOp('New support request', `<div class="ff-field"><label class="ff-label" for="tkSubject">Subject</label><input class="ff-input" id="tkSubject" maxlength="120" placeholder="e.g. M-Pesa payments not matching"></div>
      <div class="ff-field"><label class="ff-label" for="tkCat">Topic</label><select class="ff-select" id="tkCat"><option value="general">General</option><option value="payments">Payments</option><option value="mpesa">M-Pesa setup</option><option value="data">My data</option><option value="billing">Billing</option><option value="bug">Something is broken</option></select></div>
      <div class="ff-field"><label class="ff-label" for="tkBody">What happened?</label><textarea class="ff-textarea" id="tkBody" rows="5"></textarea></div>`,
      'Send', async () => {
        const subject = $('tkSubject').value.trim(), body = $('tkBody').value.trim();
        if (subject.length < 3 || !body) { toast('Add a subject and a message.', 'error'); return false; }
        const { data, error } = await sb.rpc('open_ticket', { p_subject: subject, p_category: $('tkCat').value, p_body: body });
        if (error) { fail(error); return false; }
        toast('Request sent. We will reply here.'); renderSupport(data); return true;
      });
  }
  async function openTicket(id) {
    const t = tickets.find(x => x.id === id); const box = $('thread'); if (!t || !box) return;
    const r = await sb.from('support_messages').select('id, from_platform, body, created_at').eq('ticket_id', id).order('created_at');
    if (r.error) { fail(r.error); return; }
    box.innerHTML = `<div class="ff-card"><div class="ff-card-head"><div class="ff-card-title">${esc(t.subject)}</div>${t.status !== 'closed' ? `<button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="ST.closeTicket('${id}')">Close request</button>` : badge('', 'closed')}</div>
      <div class="ff-card-body">${(r.data || []).map(m => `<div style="margin-bottom:12px;padding:10px 12px;border-radius:10px;background:${m.from_platform ? 'var(--ff-green-50)' : 'var(--ff-surface-2)'}"><div class="ff-hint">${m.from_platform ? 'FeeFlow team' : 'You'} · ${esc(FFUI.fmtDateTime(m.created_at))}</div><div style="white-space:pre-wrap">${esc(m.body)}</div></div>`).join('')}
      ${t.status !== 'closed' ? `<div class="ff-field"><textarea class="ff-textarea" id="tkReply" rows="3" placeholder="Write a reply"></textarea></div><button class="ff-btn ff-btn-primary" type="button" onclick="ST.reply('${id}')">Send reply</button>` : ''}</div></div>`;
    paint(box); box.scrollIntoView && box.scrollIntoView({ behavior: 'smooth' });
  }
  async function reply(id) {
    const body = ($('tkReply').value || '').trim(); if (!body) return;
    const { error } = await sb.rpc('reply_ticket', { p_ticket: id, p_body: body });
    if (error) { fail(error); return; }
    await renderSupport(id);
  }
  async function closeTicket(id) { const { error } = await sb.rpc('close_ticket', { p_ticket: id }); if (error) fail(error); else toast('Request closed.'); renderSupport(id); }

  /* ================================================================ shell ===== */
  let opHandler = null;
  function openOp(title, html, okLabel, handler) {
    $('opTitle').textContent = title; $('opBody').innerHTML = html; $('opOk').textContent = okLabel; opHandler = handler;
    $('opOk').onclick = async () => { $('opOk').disabled = true; try { if (await opHandler()) FFUI.closeModal('op'); } finally { $('opOk').disabled = false; } };
    FFUI.openModal('op');
  }
  const RENDER = { import: renderImport, promote: renderPromote, reversals: renderReversals, instalments: renderInstalments, clearance: renderClearance, staff: renderStaff, billing: renderBilling, support: renderSupport };
  async function go(tab, el) {
    if (!TABS[tab]) return;
    current = tab;
    document.querySelectorAll('.ff-view').forEach(x => x.classList.toggle('active', x.id === 'view-' + tab));
    document.querySelectorAll('.ff-nav-item[data-tab]').forEach(x => x.classList.toggle('active', x.getAttribute('data-tab') === tab));
    $('pageTitle').textContent = TABS[tab];
    try { await RENDER[tab](); } catch (e) { fail(e); }
  }

  async function init() {
    sb = FF.sb;
    me = await FF.requireRole('school_admin');
    if (!me || !me.school_id) { $('unauthorizedPage').style.display = 'block'; $('ffApp').style.display = 'none'; return; }
    schoolId = me.school_id; role = me.staff_role || 'owner';
    $('unauthorizedPage').style.display = 'none'; $('ffApp').style.display = 'flex';
    const s = await sb.from('schools').select('name, paybill').eq('id', schoolId).maybeSingle();
    school = s.data || {};
    $('schoolNameDisplay').querySelector('span').textContent = school.name || 'School';
    $('roleChip').querySelector('span').textContent = ROLES[role] || role;
    document.title = 'FeeFlow — Operations — ' + (school.name || 'School');
    try { await loadStudents(); } catch (e) {
      $('banner').style.display = 'flex'; $('bannerText').innerHTML = esc(FF.friendlyError(e)) + ' <button class="ff-btn ff-btn-outline ff-btn-sm" onclick="location.reload()">Try again</button>';
    }
    const want = (location.hash || '').replace('#', '');
    await go(TABS[want] ? want : 'import');
  }

  document.addEventListener('DOMContentLoaded', function () {
    FFUI.loadTheme();
    const btn = $('themeBtn');
    if (btn) btn.addEventListener('click', () => FFUI.setTheme(FFUI.loadTheme() === 'dark' ? 'light' : 'dark'));
    FFUI.wireModals && FFUI.wireModals();
  });

  window.ST = { init, go, TABS, parseCsv, mapRows, nextClass, baseOf, downloadTemplate, previewImport, runImport, runPromotion,
    askReverse, decide, newPlan, cancelPlan, shareWhatsApp, clrFind, issueClearance, printClearance,
    inviteStaff, setRole, cancelInvite, removeStaff, newTicket, openTicket, reply, closeTicket,
    get state() { return { students, role }; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
