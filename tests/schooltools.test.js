/* Tests for school-tools.html (Operations): import, promotion, reversals, instalments, clearance, staff, billing, support. */
const { ok, tick, summary, openPage } = require('./lib');

const S = (o) => ({ id: 's-1', admission_no: '1001', full_name: 'Amani Wanjiru', class_name: 'Grade 4', guardian_phone: '0712345678', active: true, total_due: 40000, paid: 10000, balance: 30000, credit: 0, ...o });
const base = (staff_role, extra = {}) => ({
  wait: 600,
  tables: {
    profiles: [{ id: 'u-1', role: 'school_admin', school_id: 'sc-1', full_name: 'Boss', staff_role }],
    schools: [{ id: 'sc-1', name: 'Don Bosco', paybill: '174379', plan: 'Trial', trial_ends_at: new Date(Date.now() + 10 * 864e5).toISOString() }],
    student_balances: [S({}), S({ id: 's-2', admission_no: '1002', full_name: 'Baraka O', class_name: 'Grade 6', balance: 0, paid: 40000 }), S({ id: 's-3', admission_no: '1003', full_name: 'Chloe K', class_name: 'Form 4', balance: 0 })],
    payments: [{ id: 'p-1', student_id: 's-1', amount: 5000, method: 'mpesa', mpesa_receipt: 'QWE123', completed_at: new Date().toISOString(), status: 'completed' }],
    payment_reversals: [], instalment_plans: [], clearance_certificates: [], subscription_invoices: [], support_tickets: [],
    ...extra
  },
  rpc: {
    import_students: async (a) => ({ data: { inserted: a.p_rows.length, updated: 0, errors: [] }, error: null }),
    promote_students: async () => ({ data: { moved: 2, left: 1, arrears_carried: 1 }, error: null }),
    list_staff: async () => ({ data: [{ user_id: 'u-1', invite_id: null, full_name: 'Boss', email: 'b@x.ke', staff_role: 'owner', since: '2026-01-01', pending: false }, { user_id: null, invite_id: 'i-1', full_name: null, email: 'new@x.ke', staff_role: 'bursar', since: null, pending: true }], error: null }),
    request_payment_reversal: async () => ({ data: 'r-1', error: null }),
    issue_clearance: async () => ({ data: { serial: 'CLR-2026-0001', issued_at: new Date().toISOString() }, error: null }),
    create_instalment_plan: async () => ({ data: 'pl-1', error: null }),
    open_ticket: async () => ({ data: 't-1', error: null }),
    invite_staff: async () => ({ data: 'i-2', error: null })
  }
});
const rpcs = (p, fn) => p.calls(c => c.kind === 'rpc' && c.fn === fn);

(async () => {
  // access
  for (const role of ['super_admin', 'parent']) {
    const p = await openPage('school-tools.html', { tables: { profiles: [{ id: 'u-1', role }] } });
    ok(p.d.getElementById('ffApp').style.display !== 'flex', `${role} cannot open Operations`);
  }

  // pure helpers
  let p = await openPage('school-tools.html', base('owner'));
  ok(p.errors.length === 0, 'page loads without script errors', p.errors.join('|'));
  const ST = p.w.ST;
  const g = ST.parseCsv('Adm;Name\r\n1;"Doe; J"\r\n\r\n2;"Say ""hi"""\r\n');
  ok(g.length === 3 && g[1][1] === 'Doe; J' && g[2][1] === 'Say "hi"', 'CSV: semicolon delimiter, quotes, blank lines');
  const m = ST.mapRows(ST.parseCsv('Admission No,Pupil Name,Grade,Sex,Parent Phone\n7,Ann,Grade 1,F,0711111111'));
  ok(m.missing.length === 0 && m.rows[0].full_name === 'Ann' && m.rows[0].class_name === 'Grade 1' && m.rows[0].guardian_phone === '0711111111', 'CSV: header aliases mapped');
  ok(ST.mapRows(ST.parseCsv('Name,Class\nA,B')).missing.includes('admission_no'), 'CSV: missing admission column reported');
  const nx = (c) => ST.nextClass(ST.baseOf(c));
  ok(nx('Grade 4A') === 'Grade 5' && nx('PP1') === 'PP2' && nx('PP2') === 'Grade 1' && nx('Form 4') === '' && nx('Form 2') === 'Form 3' && nx('Grade 12') === '' && nx('Class 4') === 'Grade 5' && nx('Weird') === null, 'promotion: CBC / 8-4-4 next class');

  // import flow
  p.set('csvText', 'Admission No,Name,Class\n2001,New Kid,Grade 1\n1001,Amani W,Grade 4');
  ST.previewImport(); await tick();
  ok(/2 rows found/.test(p.text('importPreview')) && /1 new/.test(p.text('importPreview')) && /1 to update/.test(p.text('importPreview')), 'import preview counts new/updates');
  await ST.runImport(); await tick();
  const imp = rpcs(p, 'import_students');
  ok(imp.length === 1 && imp[0].args.p_rows.length === 2 && imp[0].args.p_rows[0].admission_no === '2001', 'import sends rows to import_students');
  ok(/2<\/strong> added|2 added/.test(p.d.getElementById('importPreview').innerHTML), 'import result shown');

  // promotion
  await ST.go('promote'); await tick();
  const sel = Array.from(p.d.querySelectorAll('#view-promote select[data-from]'));
  const val = (n) => sel.find(s => s.getAttribute('data-from') === n).value;
  ok(val('Grade 4') === 'Grade 5' && val('Grade 6') === 'Grade 7' && val('Form 4') === '', 'promotion table defaults');
  await ST.runPromotion(); await tick();
  const pr = rpcs(p, 'promote_students').pop();
  ok(pr && pr.args.p_carry === true && pr.args.p_moves.length === 3 && pr.args.p_moves.some(x => x.from === 'Form 4' && x.to === ''), 'promotion RPC payload');

  // reversals
  await ST.go('reversals'); await tick();
  ok(/Request reversal/.test(p.text('view-reversals')), 'owner sees request reversal');
  ST.askReverse('p-1'); p.set('revReason', 'x'); await p.d.getElementById('opOk').onclick(); await tick();
  ok(rpcs(p, 'request_payment_reversal').length === 0, 'short reason rejected client-side');
  p.set('revReason', 'Recorded against the wrong pupil'); await p.d.getElementById('opOk').onclick(); await tick();
  ok(rpcs(p, 'request_payment_reversal')[0].args.p_payment === 'p-1', 'reversal request RPC');

  // instalments
  await ST.go('instalments'); await tick();
  ST.newPlan(); await tick();
  p.set('plParts', '3'); p.set('plFirst', '2026-12-01'); p.set('plGap', '30');
  await p.d.getElementById('opOk').onclick(); await tick();
  const pl = rpcs(p, 'create_instalment_plan')[0];
  ok(pl && pl.args.p_student === 's-1' && pl.args.p_parts === 3 && pl.args.p_gap_days === 30, 'instalment RPC payload');

  // clearance: only cleared pupils get a button
  await ST.go('clearance'); await tick();
  p.set('clrSearch', 'baraka'); ST.clrFind();
  ok(/Issue certificate/.test(p.text('clrResults')), 'cleared pupil can get certificate');
  p.set('clrSearch', 'amani'); ST.clrFind();
  ok(!/Issue certificate/.test(p.text('clrResults')) && /owes/.test(p.text('clrResults')), 'owing pupil cannot');
  p.w.prompt = () => 'Transfer';
  await ST.issueClearance('s-2'); await tick();
  ok(rpcs(p, 'issue_clearance')[0].args.p_label === 'Transfer' && /CLR-2026-0001/.test(p.w.__printed || ''), 'clearance issued and printed');

  // staff
  await ST.go('staff'); await tick();
  ok(/new@x\.ke/.test(p.text('view-staff')) && /invited/.test(p.text('view-staff')), 'staff list shows pending invite');
  ST.inviteStaff(); p.set('invEmail', 'sec@x.ke'); p.set('invRole', 'secretary'); await p.d.getElementById('opOk').onclick(); await tick();
  const iv = rpcs(p, 'invite_staff')[0];
  ok(iv && iv.args.p_email === 'sec@x.ke' && iv.args.p_role === 'secretary', 'invite RPC payload');

  // billing + support
  await ST.go('billing'); await tick();
  ok(/Trial/.test(p.text('view-billing')) && /No invoices/.test(p.text('view-billing')), 'billing view');
  await ST.go('support'); await tick();
  ST.newTicket(); p.set('tkSubject', 'Help me'); p.set('tkBody', 'It broke'); await p.d.getElementById('opOk').onclick(); await tick();
  ok(rpcs(p, 'open_ticket')[0].args.p_subject === 'Help me', 'ticket RPC payload');

  // WhatsApp link
  ok(p.w.FFUI.waLink('0712345678', 'Hi there') === 'https://wa.me/254712345678?text=Hi%20there' && p.w.FFUI.waLink('abc', 'x') === null, 'waLink builds wa.me URL and rejects bad numbers');

  // role gating
  p = await openPage('school-tools.html', base('secretary'));
  await p.w.ST.go('promote'); await tick();
  ok(/cannot promote/.test(p.text('view-promote')) && p.d.querySelector('#view-promote select[data-from]').disabled, 'secretary cannot promote');
  await p.w.ST.go('staff'); await tick();
  ok(/cannot manage staff/.test(p.text('view-staff')) && !/Invite staff/.test(p.text('view-staff')), 'secretary cannot manage staff');
  p = await openPage('school-tools.html', base('bursar'));
  await p.w.ST.go('reversals'); await tick();
  ok(/Request reversal/.test(p.text('view-reversals')), 'bursar can request reversal');
  p = await openPage('school-tools.html', base('head'));
  await p.w.ST.go('reversals'); await tick();
  ok(!/Request reversal/.test(p.text('view-reversals')), 'head cannot request reversal (only owner/bursar)');

  summary();
})();
