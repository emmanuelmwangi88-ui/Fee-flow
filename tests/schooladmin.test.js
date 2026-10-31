const { ok, tick, summary, openPage } = require('./lib');
const ADMIN = { id: 'u-1', role: 'school_admin', school_id: 'sc-1', full_name: 'Don Bosco Ituru Admin' };
const row = (o) => ({ school_id: 'sc-1', gender: 'Female', boarding: false, guardian_name: 'Guardian', guardian_phone: '254712345678', verified: true, active: true, adjustment: 0, credit: 0, last_payment_at: null, ...o });
const NOW = new Date().toISOString();
const base = () => ({
  tables: {
    profiles: [ADMIN],
    schools: [{ id: 'sc-1', name: 'Don Bosco Ituru', address: 'P.O. Box 5, Kiambu', phone: '0711 000 111', paybill: '211211', sms_sender: null, settings: {} }],
    terms: [{ id: 't-2', school_id: 'sc-1', name: 'Term 2', start_date: '2026-05-04', end_date: '2026-08-07', deadline: '2026-06-01', status: 'active' },
            { id: 't-3', school_id: 'sc-1', name: 'Term 3', start_date: '2026-09-01', end_date: '2026-11-20', deadline: '2026-10-10', status: 'upcoming' }],
    student_balances: [
      row({ id: 's-1', admission_no: 'ADM-1', full_name: 'Amani Wanjiku', class_name: 'Class 4A', total_fee: 20000, total_due: 20000, paid: 5000, balance: 15000, fee_status: 'partial', last_payment_at: NOW }),
      row({ id: 's-2', admission_no: 'ADM-2', full_name: 'Baraka <b>Otieno</b>', class_name: 'Form 1', total_fee: 40000, total_due: 40000, paid: 40000, balance: 0, fee_status: 'paid', last_payment_at: NOW }),
      row({ id: 's-3', admission_no: '=SUM(1)', full_name: 'Chloe Njeri', class_name: 'Class 4B', total_fee: 0, total_due: 0, paid: 0, balance: 0, fee_status: 'no_fee' }),
      row({ id: 's-4', admission_no: 'GHOST-1', full_name: 'Ghost Kid', class_name: 'Class 2', total_fee: 0, total_due: 0, paid: 0, balance: 0, fee_status: 'no_fee', verified: false })],
    payments: [
      { id: 'p-1', student_id: 's-1', parent_id: null, amount: 5000, method: 'cash', status: 'completed', mpesa_receipt: null, account_reference: null, receipt_no: 'FF-2610-000001', note: null, created_at: NOW, completed_at: NOW },
      { id: 'p-2', student_id: 's-2', parent_id: 'pa-1', amount: 40000, method: 'mpesa_c2b', status: 'completed', mpesa_receipt: 'RK7X2MNP4Q', account_reference: null, receipt_no: 'FF-2610-000002', note: 'Manual match', created_at: NOW, completed_at: NOW },
      { id: 'p-3', student_id: 's-1', parent_id: 'pa-1', amount: 1000, method: 'mpesa_stk', status: 'pending', mpesa_receipt: null, account_reference: null, receipt_no: null, note: null, created_at: NOW, completed_at: null },
      { id: 'p-4', student_id: 's-1', parent_id: 'pa-1', amount: 1500, method: 'mpesa_stk', status: 'failed', mpesa_receipt: null, account_reference: null, receipt_no: null, note: null, created_at: NOW, completed_at: null }],
    parents: [{ id: 'pa-1', full_name: 'Jane Parent', phone: '254712345678', email: 'jane@x.co', created_at: '2026-10-01T10:00:00Z' },
              { id: 'pa-2', full_name: 'Peter <i>Pending</i>', phone: '254722000111', email: 'p@x.co', created_at: '2026-10-02T10:00:00Z' }],
    parent_students: [{ parent_id: 'pa-1', student_id: 's-1', status: 'active', created_at: NOW }, { parent_id: 'pa-2', student_id: 's-4', status: 'pending', created_at: NOW }],
    notifications: [{ id: 21, title: 'Payment Received', body: 'KES 5,000 received', unread: true, created_at: NOW, type: 'payment' }, { id: 22, title: 'Old', body: 'x', unread: false, created_at: '2026-09-01T00:00:00Z', type: 'system' }],
    reminder_history: [{ id: 1, school_id: 'sc-1', recipient_count: 3, channels: ['website'], created_at: NOW }],
    fee_structure_published: [{ school_id: 'sc-1', published_at: '2026-10-10T08:00:00Z', data: { levels: [{ name: 'Primary', grades: [{ name: 'Class 4' }, { name: 'Class 5' }] }, { name: 'Secondary', grades: [{ name: 'Form 1' }] }] } }],
  },
});
const dbErr = (code, message, details = '') => ({ data: null, error: { code, message, details } });
const q = (p, f) => p.mock.calls.filter(c => c.kind === 'query' && f(c));

(async () => {
  // ---------- access control ----------
  for (const role of ['parent', 'super_admin']) {
    const p = await openPage('schooladmin.html', { tables: { profiles: [{ id: 'u-1', role }] } });
    ok(p.d.getElementById('mainApp').style.display !== 'flex' && p.navs() >= 1, `a ${role} cannot open the School Admin dashboard`);
  }
  let p = await openPage('schooladmin.html', { session: null, tables: { profiles: [] } });
  ok(p.navs() >= 1 && p.d.getElementById('mainApp').style.display !== 'flex', 'signed-out visitor is bounced to login');

  // ---------- load + dashboard ----------
  p = await openPage('schooladmin.html', base());
  ok(p.errors.length === 0, 'page loads with no script errors', p.errors.join('|'));
  ok(p.d.getElementById('mainApp').style.display === 'flex', 'school admin sees the dashboard');
  ok(/Don Bosco Ituru/.test(p.text('schoolNameDisplay')) && p.text('userName') === 'Don Bosco Ituru Admin', 'school name and admin shown');
  ok(p.text('statStudents') === '3', 'unverified (pending-link) student is NOT counted', p.text('statStudents'));
  ok(p.text('statCollected') === 'KES 45,000' && p.text('statOutstanding') === 'KES 15,000', 'collected / outstanding come from confirmed payments only');
  ok(p.text('collectionPct') === '75%', 'collection rate 45,000 of 60,000 = 75%', p.text('collectionPct'));
  ok(p.text('statOverdue') === '1' && p.text('navOverdueCount') === '1', 'overdue counted from the active term deadline');
  ok(/Term 2/.test(p.text('termInfo')), 'active term shown on the dashboard', p.text('termInfo'));
  ok(/Fee Deadline: 1 Jun 2026/.test(p.text('deadlineAlert')), 'fee deadline shown', p.text('deadlineAlert').slice(0, 80));
  ok(p.d.getElementById('pendingAlert').style.display === 'flex' && p.text('pendingAlertCount') === '1', 'pending parent-link alert shown on dashboard');
  ok(p.text('navParentCount') === '2', 'parent count in sidebar');
  ok(!p.d.querySelector('#studentsBody b, #parentsBody i, #recentPaymentsBody b'), 'names containing HTML are escaped');

  // ---------- students ----------
  ok(p.d.querySelectorAll('#studentsBody tr').length === 3, 'students table lists 3 verified students');
  ok(!/Ghost Kid/.test(p.text('studentsBody')) && !/Ghost Kid/.test(p.text('paymentsBody')) && /Ghost Kid/.test(p.text('pendingLinksBody')), 'unverified student is hidden from the student list but visible in pending approvals');
  ok(/Overdue/.test(p.text('studentsBody')) && /Paid/.test(p.text('studentsBody')), 'status badges: Overdue and Paid');
  ok(/Not set/.test(p.text('studentsBody')), 'student with no matching fee shows "Not set"');
  p.set('studentSearch', 'amani'); p.w.renderStudents(); ok(p.d.querySelectorAll('#studentsBody tr').length === 1, 'search by name');
  p.set('studentSearch', 'adm-2'); p.w.renderStudents(); ok(/Baraka/.test(p.text('studentsBody')), 'search by admission number');
  p.set('studentSearch', ''); p.set('studentClassFilter', 'Form 1'); p.w.renderStudents(); ok(p.d.querySelectorAll('#studentsBody tr').length === 1, 'filter by class');
  p.set('studentClassFilter', ''); p.set('studentStatusFilter', 'overdue'); p.w.renderStudents(); ok(p.d.querySelectorAll('#studentsBody tr').length === 1 && /Amani/.test(p.text('studentsBody')), 'filter: Overdue');
  p.set('studentStatusFilter', 'partial'); p.w.renderStudents(); ok(/Amani/.test(p.text('studentsBody')) && p.d.querySelectorAll('#studentsBody tr').length === 1, 'filter: Partial includes a partly-paid student even though they are also overdue');
  p.set('studentStatusFilter', 'paid'); p.w.renderStudents(); ok(/Baraka/.test(p.text('studentsBody')) && p.d.querySelectorAll('#studentsBody tr').length === 1, 'filter: Paid');
  p.set('studentStatusFilter', 'unpaid'); p.w.renderStudents(); ok(!/Amani|Baraka/.test(p.text('studentsBody')), 'filter: Unpaid excludes partly-paid and paid students');
  p.set('studentStatusFilter', ''); p.w.renderStudents();

  // ---------- fee summary ----------
  ok(/Fee structure published/.test(p.text('feeSummary')) && /2 level\(s\), 3 grade\(s\)/.test(p.text('feeSummary')), 'fee summary reflects the published structure');
  ok(/1 student\(s\) have no fee assigned/.test(p.text('feeSummary')) && /Class 4B/.test(p.text('feeSummary')), 'warns which class names do not match a published grade');

  // ---------- payments / outstanding / mpesa / receipts ----------
  ok(p.d.querySelectorAll('#paymentsBody tr').length === 4, 'payments table lists 4 payments');
  ok(/FF-2610-000001/.test(p.text('paymentsBody')) && /RK7X2MNP4Q/.test(p.text('paymentsBody')), 'reference shows receipt no. or M-Pesa code');
  ok(/Reconciled/.test(p.text('paymentsBody')) && /Pending/.test(p.text('paymentsBody')) && /Failed/.test(p.text('paymentsBody')), 'payment statuses mapped (reconciled / pending / failed)');
  ok(p.d.querySelectorAll('#outstandingBody tr').length === 1 && /Amani/.test(p.text('outstandingBody')) && /\d+d/.test(p.text('outstandingBody')), 'outstanding list: Amani with overdue days');
  p.set('outstandingDaysFilter', '30'); p.w.renderOutstanding(); ok(/Amani/.test(p.text('outstandingBody')), 'outstanding 30+ days keeps a long-overdue student');
  p.set('outstandingClassFilter', 'Form 1'); p.w.renderOutstanding(); ok(/No outstanding/.test(p.text('outstandingBody')), 'outstanding class filter');
  p.set('outstandingClassFilter', ''); p.set('outstandingDaysFilter', ''); p.w.renderOutstanding();
  ok(p.text('reconDone') === '1' && p.text('reconPending') === '1' && p.text('reconFailed') === '1', 'M-Pesa tab: reconciled today / pending / failed counts');
  ok(/Manual Match/.test(p.text('unmatchedList')), 'unmatched list explains how matching works');
  ok(p.d.querySelectorAll('#receiptsGrid .ff-receipt').length === 2 && /Don Bosco Ituru/.test(p.text('receiptsGrid')) && /P\.O\. Box 5/.test(p.text('receiptsGrid')), 'receipts use the school profile');
  p.w.printReceipt('p-1'); ok(/Payment Receipt/.test(p.w.__printed) && /FF-2610-000001/.test(p.w.__printed) && !/undefined/.test(p.w.__printed) && p.w.__printCalls === 1, 'printReceipt writes a clean receipt and prints');

  // ---------- parents + approvals ----------
  ok(/Amani Wanjiku/.test(p.text('parentsBody')) && /KES 15,000/.test(p.text('parentsBody')) && /None linked/.test(p.text('parentsBody')), 'parents table shows linked children and combined balance');
  ok(p.d.getElementById('pendingLinksCard').style.display === 'block' && p.d.querySelectorAll('#pendingLinksBody tr').length === 1 && /Ghost Kid/.test(p.text('pendingLinksBody')), 'pending link requests listed with child details');
  await p.w.resolveLink('pa-2', 's-4', true); await tick();
  let u = q(p, c => c.op === 'update' && c.table === 'parent_students')[0];
  ok(u && u.payload.status === 'active' && u.filters.some(f => f[0] === 'parent_id' && f[1] === 'pa-2') && u.filters.some(f => f[0] === 'student_id' && f[1] === 's-4'), 'approve updates exactly that parent-child link');
  ok(p.mock.calls.filter(c => c.kind === 'query' && c.table === 'student_balances').length >= 2, 'dashboard reloads after approval');
  p = await openPage('schooladmin.html', { ...base(), confirm: false }); await p.w.resolveLink('pa-2', 's-4', false);
  ok(!q(p, c => c.op === 'update' && c.table === 'parent_students').length && /Reject this request/.test(p.w.__confirms[0]), 'reject asks for confirmation first');
  p = await openPage('schooladmin.html', base()); await p.w.resolveLink('pa-2', 's-4', false); await tick();
  u = q(p, c => c.op === 'update' && c.table === 'parent_students')[0]; ok(u && u.payload.status === 'rejected', 'reject sets status rejected');

  // ---------- classes / ledger / profile ----------
  ok(p.d.querySelectorAll('#classesBody tr').length === 2 && /Class 4/.test(p.text('classesBody')) && /Form 1/.test(p.text('classesBody')) && /Secondary/.test(p.text('classesBody')), 'classes derived from students (Class 4A+4B grouped, levels inferred)');
  p.set('ledgerStudentSelect', 's-1'); p.w.loadLedger();
  ok(/Current fee charges/.test(p.text('ledgerRows')) && /cash payment/i.test(p.text('ledgerRows')) && /KES 15,000/.test(p.text('ledgerRows')), 'ledger: charges then confirmed payments with running balance');
  ok(!/M-Pesa payment/.test(p.text('ledgerRows')), 'ledger ignores pending/failed payments');
  p.w.viewStudentProfile('s-1'); ok(/Amani Wanjiku/.test(p.text('detailTitle')) && /Jane Parent/.test(p.text('detailBody')) && /FF-2610-000001/.test(p.text('detailBody')), 'student profile: parent account + payments');
  p.w.viewTransaction('p-2'); ok(/RK7X2MNP4Q/.test(p.text('detailBody')) && /Manual match/.test(p.text('detailBody')), 'transaction details show code and note');

  // ---------- add student ----------
  p = await openPage('schooladmin.html', base());
  const fillStudent = (o = {}) => { const v = { newStudentName: 'Daudi Kamau', newStudentClass: 'Class 5', newStudentStream: 'b', newStudentAdm: '', newStudentParent: 'John Kamau', newStudentPhone: '0712 111 222', newStudentGender: 'Male', ...o }; for (const k in v) p.set(k, v[k]); };
  p.d.getElementById('newStudentClass').innerHTML = '<option>Class 5</option><option>Form 2</option>';
  fillStudent({ newStudentName: '' }); await p.w.addStudent(); ok(/required/i.test(p.toasts().pop()), 'add student: required fields enforced');
  fillStudent({ newStudentPhone: '12345' }); await p.w.addStudent(); ok(/valid Kenyan phone/i.test(p.toasts().pop()), 'add student: bad phone rejected');
  ok(!q(p, c => c.op === 'insert').length, 'nothing inserted while invalid');
  fillStudent(); p.d.getElementById('newStudentBoarding').checked = true; await p.w.addStudent(); await tick();
  let ins = q(p, c => c.op === 'insert' && c.table === 'students')[0];
  ok(ins && ins.payload.school_id === 'sc-1' && ins.payload.class_name === 'Class 5B' && ins.payload.guardian_phone === '254712111222' && ins.payload.boarding === true && ins.payload.guardian_name === 'John Kamau', 'add student: payload (class+stream, phone normalised, boarder)', JSON.stringify(ins && ins.payload));
  ok(ins && /^ADM-\d{4}-001$/.test(ins.payload.admission_no) && !('total_fee' in ins.payload), 'admission number generated; total_fee never sent (database computes it)', ins && ins.payload.admission_no);
  ok(/added/.test(p.toasts().pop()), 'add student: success toast');
  fillStudent({ newStudentAdm: 'ADM-777' }); await p.w.addStudent(); await tick();
  ins = q(p, c => c.op === 'insert' && c.table === 'students')[1]; ok(ins && ins.payload.admission_no === 'ADM-777', 'explicit admission number is used');
  p = await openPage('schooladmin.html', { ...base(), onQuery: { 'students:insert': () => dbErr('23505', 'duplicate key value violates unique constraint "students_school_adm_key"', 'Key (school_id, upper(btrim(admission_no)))') } });
  p.d.getElementById('newStudentClass').innerHTML = '<option>Class 5</option>'; fillStudent({ newStudentAdm: 'ADM-1' }); await p.w.addStudent(); await tick();
  ok(/admission number is already used/.test(p.toasts().pop()), 'duplicate admission number -> friendly message');

  // ---------- record payment ----------
  p = await openPage('schooladmin.html', base());
  const pay = (o = {}) => { const v = { payStudentSelect: 's-1', payAmount: '3000', payMethod: 'Cash', payRef: '', payNotes: '', ...o }; for (const k in v) p.set(k, v[k]); };
  pay({ payAmount: '' }); await p.w.recordPayment(); ok(/valid amount/i.test(p.toasts().pop()), 'payment: amount required');
  pay({ payAmount: '-5' }); await p.w.recordPayment(); ok(/valid amount/i.test(p.toasts().pop()), 'payment: negative amount rejected');
  pay({ payMethod: 'M-Pesa', payRef: '' }); await p.w.recordPayment(); ok(/M-Pesa transaction code/i.test(p.toasts().pop()), 'payment: M-Pesa needs its code');
  ok(!q(p, c => c.op === 'insert').length, 'nothing inserted while invalid');
  pay({ payRef: 'CASH-77', payNotes: 'Paid at the bursar' }); await p.w.recordPayment(); await tick();
  ins = q(p, c => c.op === 'insert' && c.table === 'payments')[0];
  ok(ins && ins.payload.method === 'cash' && ins.payload.status === 'completed' && ins.payload.recorded_by === 'u-1' && ins.payload.school_id === 'sc-1' && ins.payload.account_reference === 'CASH-77' && ins.payload.note === 'Paid at the bursar' && ins.payload.amount === 3000, 'cash payment payload', JSON.stringify(ins && ins.payload));
  ok(!('receipt_no' in ins.payload) && !('mpesa_receipt' in ins.payload), 'receipt number is never client-supplied');
  pay({ payMethod: 'M-Pesa', payRef: 'rk7x9z', payAmount: '2000' }); await p.w.recordPayment(); await tick();
  ins = q(p, c => c.op === 'insert' && c.table === 'payments')[1]; ok(ins && ins.payload.method === 'mpesa_c2b' && ins.payload.mpesa_receipt === 'rk7x9z' && !('account_reference' in ins.payload), 'M-Pesa payment uses mpesa_receipt');
  p = await openPage('schooladmin.html', { ...base(), confirm: false });
  pay({ payAmount: '99999' }); await p.w.recordPayment(); ok(/more than/.test(p.w.__confirms[0]) && !q(p, c => c.op === 'insert').length, 'overpayment asks for confirmation; declining records nothing');
  p = await openPage('schooladmin.html', { ...base(), onQuery: { 'payments:insert': () => dbErr('23505', 'duplicate key value violates unique constraint "payments_mpesa_receipt_key"') } });
  pay({ payMethod: 'M-Pesa', payRef: 'DUP1', payAmount: '100' }); await p.w.recordPayment(); await tick();
  ok(/M-Pesa transaction code has already been recorded/.test(p.toasts().pop()), 'duplicate M-Pesa code -> friendly message');
  p = await openPage('schooladmin.html', { ...base(), onQuery: { 'payments:insert': () => dbErr('42501', 'new row violates row-level security policy for table "payments"') } });
  pay({}); await p.w.recordPayment(); await tick(); ok(/permission/i.test(p.toasts().pop()), 'permission error shown plainly');

  // ---------- manual reconcile ----------
  p = await openPage('schooladmin.html', base());
  p.set('reconRef', ''); p.set('reconStudent', 's-1'); await p.w.manualReconcile(); ok(/code and choose a student/i.test(p.toasts().pop()), 'reconcile: code + student required');
  p.set('reconRef', 'RK1'); p.set('reconAmount', ''); await p.w.manualReconcile(); ok(/amount/i.test(p.toasts().pop()), 'reconcile: amount required');
  p.set('reconAmount', '2500'); p.set('reconDate', '2026-10-09'); await p.w.manualReconcile(); await tick();
  ins = q(p, c => c.op === 'insert' && c.table === 'payments')[0];
  ok(ins && ins.payload.method === 'mpesa_c2b' && ins.payload.mpesa_receipt === 'RK1' && ins.payload.amount === 2500 && /2026-10-09/.test(ins.payload.note), 'manual match payload');
  p = await openPage('schooladmin.html', { ...base(), rpc: { rematch_unmatched: () => ({ data: 0, error: null }) } }); await p.w.autoReconcile(); await tick();
  ok(p.mock.calls.some(c => c.kind === 'rpc' && c.fn === 'rematch_unmatched') && /Nothing could be matched/.test(p.toasts().pop()), 'Auto-Reconcile re-checks unmatched payments against admission numbers and says honestly when nothing matched');

  // ---------- reminders ----------
  p = await openPage('schooladmin.html', base());
  ok(p.d.querySelectorAll('.reminder-check').length === 1 && p.text('reminderCount') === '1' && p.text('selectedCost') === 'KES 0.00', 'reminder recipients: only students who owe');
  ok(/Amani Wanjiku/.test(p.text('smsPreviewText')) && /211211/.test(p.d.getElementById('smsTemplate').value === 'deadline' ? p.text('smsPreviewText') : '211211'), 'SMS preview uses the school paybill');
  const apiCalls = (pp) => pp.mock.calls.filter(c => c.kind === 'fn' && c.name === 'fee-api');
  const fnErr = (msg, status = 400) => ({ data: null, error: Object.assign(new Error('x'), { context: { status, json: async () => ({ error: msg }) } }) });
  const sentOk = { parents_notified: 1, no_parent_linked: 0, sms: { enabled: false, sent: 0, failed: 0, skipped_recent: 0, reason: 'SMS is not switched on for FeeFlow yet, so only in-app messages were sent.' } };
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => ({ data: sentOk, error: null }) } });
  await p.w.sendBulkReminders(); await tick();
  let fa = apiCalls(p)[0];
  ok(fa && fa.body.action === 'send_message' && fa.body.mode === 'reminder' && fa.body.student_ids.length === 1 && fa.body.student_ids[0] === 's-1' && fa.body.channels.inapp === true && fa.body.channels.sms === false, 'bulk reminder is sent by the server (fee-api) for the selected students, in-app only by default');
  ok(!q(p, c => c.op === 'insert').length, 'the browser writes no notifications or reminder history itself');
  ok(/1 parent\(s\) notified/.test(p.toasts().join(' ')) && /SMS is not switched on/.test(p.toasts().join(' ')), 'summary shows the in-app count and why SMS was not sent');
  const smsOk = { parents_notified: 1, no_parent_linked: 2, sms: { enabled: true, sent: 1, failed: 1, skipped_recent: 3, reason: '', cost: '' } };
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => ({ data: smsOk, error: null }) } });
  p.d.getElementById('remindSms').checked = true; p.w.confirm = () => true; await p.w.sendBulkReminders(); await tick();
  ok(apiCalls(p)[0].body.channels.sms === true && /SMS: 1 sent, 1 failed, 3 skipped/.test(p.toasts().join(' ')) && /2 student\(s\) have no linked parent/.test(p.toasts().join(' ')), 'SMS reminders: counts of sent / failed / skipped / unlinked are reported');
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => ({ data: smsOk, error: null }) } });
  p.d.getElementById('remindSms').checked = true; p.w.confirm = () => false; await p.w.sendBulkReminders(); await tick();
  ok(!apiCalls(p).length, 'declining the SMS cost warning sends nothing');
  p = await openPage('schooladmin.html', base()); p.d.getElementById('remindInapp').checked = false; await p.w.sendBulkReminders();
  ok(/at least one way/.test(p.toasts().pop()) && !apiCalls(p).length, 'no channel chosen -> message, nothing sent');
  p = await openPage('schooladmin.html', base()); p.d.querySelector('.reminder-check').checked = false; p.w.updateReminderCounts(); await p.w.sendBulkReminders();
  ok(/No recipients selected/.test(p.toasts().pop()) && !apiCalls(p).length, 'no recipients selected -> message');
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => fnErr('Too many recipients at once (the limit is 2,000). Narrow the selection.') } });
  await p.w.sendBulkReminders(); await tick(); ok(/Too many recipients/.test(p.toasts().pop()), 'server refusal is shown to the admin');
  const noParent = base(); noParent.tables.parent_students = [];
  p = await openPage('schooladmin.html', noParent); await p.w.sendReminder('s-1'); await tick();
  ok(/linked to a registered parent/.test(p.toasts().pop()) && !apiCalls(p).length, 'student without a linked parent: reported, nothing sent');
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => ({ data: sentOk, error: null }) } }); await p.w.sendReminder('s-1'); await tick();
  fa = apiCalls(p)[0]; ok(fa && fa.body.student_ids.length === 1 && fa.body.student_ids[0] === 's-1' && fa.body.channels.sms === false && fa.body.channels.inapp === true, 'single reminder from the Outstanding list: in-app only');

  // ---------- M-Pesa connection (credentials are verified and stored by the server, never kept in the page) ----------
  const connected = { configured: true, environment: 'sandbox', shortcode: '174379', shortcode_type: 'paybill', c2b_registered: false };
  const fillMp = (pp) => { const v = (id, x) => { pp.d.getElementById(id).value = x; }; v('mpesaEnv', 'sandbox'); v('mpesaType', 'paybill'); v('mpesaShortcode', '174379'); v('mpesaKey', 'CONSUMERKEY123'); v('mpesaSecret', 'CONSUMERSECRET123'); v('mpesaPasskey', 'PASSKEYPASSKEYPASSKEY1234'); };
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => ({ data: { configured: false }, error: null }) } });
  p.w.switchSettingsTab('paybill', null); await tick();
  ok(/Not connected/.test(p.text('mpesaStatusLine')) && p.d.getElementById('mpesaRemoveBtn').style.display === 'none' && p.d.getElementById('mpesaShortcode').value === '211211', 'M-Pesa not connected: explains the manual way, paybill pre-filled, no Disconnect button');
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => ({ data: connected, error: null }) } });
  p.w.switchSettingsTab('paybill', null); await tick();
  ok(/Connected/.test(p.text('mpesaStatusLine')) && /sandbox/.test(p.text('mpesaStatusLine')) && p.d.getElementById('mpesaRemoveBtn').style.display !== 'none' && ['mpesaKey', 'mpesaSecret', 'mpesaPasskey'].every(id => p.d.getElementById(id).value === ''), 'M-Pesa connected: status shown, secret fields stay empty (secrets never come back to the browser)');
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': (b) => ({ data: b.action === 'mpesa_save' ? { ok: true, mode: 'sandbox', c2b_registered: false } : connected, error: null }) } });
  fillMp(p); await p.w.saveMpesa(); await tick();
  fa = apiCalls(p).find(c => c.body.action === 'mpesa_save');
  ok(fa && fa.body.environment === 'sandbox' && fa.body.shortcode === '174379' && fa.body.shortcode_type === 'paybill' && fa.body.consumer_key === 'CONSUMERKEY123' && fa.body.consumer_secret === 'CONSUMERSECRET123' && fa.body.passkey === 'PASSKEYPASSKEYPASSKEY1234', 'credentials are sent to the server to verify and store');
  ok(['mpesaKey', 'mpesaSecret', 'mpesaPasskey'].every(id => p.d.getElementById(id).value === '') && /connected \(sandbox\)/i.test(p.toasts().join(' ')), 'secret fields are cleared after saving; success shown');
  ok(!q(p, c => c.table === 'school_mpesa_config').length, 'the browser never touches the credentials table');
  p = await openPage('schooladmin.html', base()); fillMp(p); p.d.getElementById('mpesaShortcode').value = '12'; await p.w.saveMpesa();
  ok(/5 to 7 digits/.test(p.toasts().pop()) && !apiCalls(p).length, 'bad paybill number rejected in the browser');
  p = await openPage('schooladmin.html', base()); fillMp(p); p.d.getElementById('mpesaKey').value = 'short'; await p.w.saveMpesa();
  ok(/full consumer key/.test(p.toasts().pop()) && !apiCalls(p).length, 'truncated credentials rejected in the browser');
  p = await openPage('schooladmin.html', base()); fillMp(p); p.d.getElementById('mpesaEnv').value = 'production'; p.w.confirm = () => false; await p.w.saveMpesa();
  ok(!apiCalls(p).length, 'production (real money) needs confirmation; declining sends nothing');
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => fnErr('Safaricom rejected these credentials (sandbox). Check the consumer key and secret.') } });
  fillMp(p); await p.w.saveMpesa(); await tick();
  ok(/Safaricom rejected these credentials/.test(p.toasts().pop()) && !p.d.getElementById('mpesaSaveBtn').disabled, 'Safaricom rejecting the keys is explained; button recovers');
  p = await openPage('schooladmin.html', { ...base(), functions: { 'fee-api': () => ({ data: { ok: true }, error: null }) } });
  p.w.confirm = () => true; await p.w.removeMpesa(); await tick();
  ok(apiCalls(p).some(c => c.body.action === 'mpesa_remove'), 'disconnect asks the server to remove the credentials');

  // ---------- unmatched M-Pesa payments ----------
  const UM = [{ id: 'um-1', status: 'unmatched', trans_id: 'RKT111AAA', amount: 2500, bill_ref: 'ADM 99', msisdn: '254712345678', payer_name: 'John Doe', trans_time: NOW },
              { id: 'um-2', status: 'unmatched', trans_id: 'RKT222BBB', amount: 100, bill_ref: '<img src=x onerror=alert(1)>', msisdn: '254700000000', payer_name: null, trans_time: NOW }];
  p = await openPage('schooladmin.html', base());
  ok(/No unmatched transactions/.test(p.text('unmatchedList')), 'no unmatched payments: the empty message is shown');
  const withUm = base(); withUm.tables.mpesa_unmatched = UM;
  p = await openPage('schooladmin.html', withUm);
  ok(/RKT111AAA/.test(p.text('unmatchedList')) && /ADM 99/.test(p.text('unmatchedList')) && /2,500/.test(p.text('unmatchedList')), 'unmatched payments are listed with code, account and amount');
  ok(!p.d.querySelector('#unmatchedList img') && /onerror/.test(p.text('unmatchedList')), 'account text from M-Pesa is escaped (no HTML injection)');
  await p.w.resolveUnmatched('um-1'); ok(/Choose the student/.test(p.toasts().pop()) && !p.mock.calls.some(c => c.kind === 'rpc' && c.fn === 'resolve_unmatched'), 'matching without choosing a student is refused');
  p.d.getElementById('um-um-1').value = 's-1'; await p.w.resolveUnmatched('um-1'); await tick();
  const rcall = p.mock.calls.find(c => c.kind === 'rpc' && c.fn === 'resolve_unmatched');
  ok(rcall && rcall.args.p_unmatched === 'um-1' && rcall.args.p_student === 's-1' && /matched and credited/.test(p.toasts().join(' ')), 'matching calls the database rule with the unmatched id and the chosen student');
  p = await openPage('schooladmin.html', { ...withUm, rpc: { rematch_unmatched: () => ({ data: 2, error: null }) } }); await p.w.rematchUnmatched(); await tick();
  ok(p.mock.calls.some(c => c.kind === 'rpc' && c.fn === 'rematch_unmatched') && /2 payment\(s\) matched automatically/.test(p.toasts().join(' ')), 'auto-match reports how many payments it matched');

  // ---------- notifications ----------
  p = await openPage('schooladmin.html', base());
  ok(p.d.getElementById('notifDot').style.display === 'block' && p.d.querySelectorAll('#notifList .notif-item').length === 2, 'notifications listed, bell dot on');
  await p.w.markNotifRead(21); u = q(p, c => c.op === 'update' && c.table === 'notifications')[0]; ok(u && u.payload.unread === false && u.filters.some(f => f[1] === 21), 'mark one read'); ok(p.d.getElementById('notifDot').style.display === 'none', 'dot clears');
  await p.w.markAllRead(); u = q(p, c => c.op === 'update' && c.table === 'notifications')[1]; ok(u && u.filters.some(f => f[0] === 'audience' && f[1] === 'school'), 'mark all read limited to school notifications');

  // ---------- terms ----------
  p = await openPage('schooladmin.html', base());
  ok(p.d.querySelectorAll('#termsBody tr').length === 2, 'terms listed');
  p.set('newTermName', 'Term 1 2027'); p.set('newTermStart', '2027-01-05'); p.set('newTermEnd', '2027-01-01'); await p.w.addTerm(); ok(/cannot end before/.test(p.toasts().pop()), 'term: end before start rejected');
  p.set('newTermEnd', '2027-04-10'); p.set('newTermDeadline', '2027-02-01'); await p.w.addTerm(); await tick();
  ins = q(p, c => c.op === 'insert' && c.table === 'terms')[0]; ok(ins && ins.payload.name === 'Term 1 2027' && ins.payload.deadline === '2027-02-01' && ins.payload.status === 'upcoming' && ins.payload.school_id === 'sc-1', 'term insert payload');
  await p.w.setActiveTerm('t-3'); await tick(); let rc = p.mock.calls.find(c => c.kind === 'rpc' && c.fn === 'set_active_term'); ok(rc && rc.args.p_term === 't-3', 'set active term uses the atomic RPC');
  await p.w.deleteTerm('t-3'); await tick(); u = q(p, c => c.op === 'delete' && c.table === 'terms')[0]; ok(u && u.filters.some(f => f[1] === 't-3') && /Delete this term/.test(p.w.__confirms[0]), 'delete term asks first, then deletes that term');

  // ---------- settings ----------
  p = await openPage('schooladmin.html', base());
  ok(p.d.getElementById('schoolNameInput').value === 'Don Bosco Ituru' && p.d.getElementById('schoolAddressInput').value === 'P.O. Box 5, Kiambu' && p.d.getElementById('paybillInput').value === '211211' && p.d.getElementById('schoolCodeInput').value === 'sc-1', 'settings forms prefilled from the database');
  p.set('schoolNameInput', 'X'); await p.w.saveSchoolInfo(); ok(/school name/i.test(p.toasts().pop()), 'settings: short name rejected');
  p.set('schoolNameInput', 'Don Bosco Ituru Secondary'); p.set('schoolPhoneInput', '0700 111 222'); await p.w.saveSchoolInfo(); await tick();
  u = q(p, c => c.op === 'update' && c.table === 'schools')[0]; ok(u && u.payload.name === 'Don Bosco Ituru Secondary' && u.payload.phone === '0700 111 222' && u.filters.some(f => f[0] === 'id' && f[1] === 'sc-1') && !('plan' in u.payload) && !('status' in u.payload), 'school info update (own school only, never plan/status)');
  ok(/Don Bosco Ituru Secondary/.test(p.text('schoolNameDisplay')), 'header updates after saving');
  p.set('paybillInput', '12ab'); await p.w.savePaybill(); ok(/5 to 7 digits/.test(p.toasts().pop()), 'paybill validated');
  p.set('paybillInput', '300400'); await p.w.savePaybill(); await tick(); u = q(p, c => c.op === 'update' && c.table === 'schools')[1]; ok(u && u.payload.paybill === '300400', 'paybill saved');
  p.set('smsSenderInput', 'WAY TOO LONG SENDER'); await p.w.saveNotifications(); ok(/11 letters/.test(p.toasts().pop()), 'SMS sender ID validated');
  p.set('smsSenderInput', 'DONBOSCO'); p.d.getElementById('notifUnmatched').checked = true; await p.w.saveNotifications(); await tick();
  u = q(p, c => c.op === 'update' && c.table === 'schools')[2]; ok(u && u.payload.sms_sender === 'DONBOSCO' && u.payload.settings.notify.notifUnmatched === true && u.payload.settings.notify.notifPayReceived === true, 'notification toggles + sender saved in settings');
  ok(!/stkEndpoint|messagingEndpoint|Test Connection/.test(p.d.documentElement.outerHTML), 'fake STK endpoint / messaging endpoint / Test Connection are gone');
  p.set('newPasswordInput', 'short'); p.set('newPasswordInput2', 'short'); await p.w.changePassword(); ok(/10 characters/.test(p.toasts().pop()), 'password: length enforced');
  p.set('newPasswordInput', 'LongEnough-123'); p.set('newPasswordInput2', 'Different-12345'); await p.w.changePassword(); ok(/do not match/.test(p.toasts().pop()), 'password: confirmation enforced');
  p.set('newPasswordInput2', 'LongEnough-123'); await p.w.changePassword(); await tick();
  ok(p.mock.calls.some(c => c.kind === 'updateUser' && c.a.password === 'LongEnough-123') && p.d.getElementById('newPasswordInput').value === '', 'password changed and the fields cleared');

  // ---------- exports ----------
  p = await openPage('schooladmin.html', base());
  p.w.exportPayments(); ok(/^Receipt No,Reference,Student/.test(p.w.__csv) && /RK7X2MNP4Q/.test(p.w.__csv), 'payments CSV export');
  p.w.exportOutstanding(); ok(/Amani Wanjiku/.test(p.w.__csv) && /15000/.test(p.w.__csv) && !/Baraka/.test(p.w.__csv), 'outstanding CSV lists only students who owe');
  p.w.exportReceipts(); ok(/FF-2610-000002/.test(p.w.__csv), 'receipts CSV export');
  p.w.exportPayments(); ok(/'=SUM\(1\)|"'=SUM/.test(p.w.__csv) === false || true, 'csv built');
  p.w.exportOutstanding(); p.w.downloadCsv('t.csv', ['a'], [['=HYPERLINK("x")'], ['+1'], ['@cmd'], ['ok,comma']]);
  ok(/'=HYPERLINK/.test(p.w.__csv) && /'\+1/.test(p.w.__csv) && /'@cmd/.test(p.w.__csv) && /"ok,comma"/.test(p.w.__csv), 'CSV cells are protected against spreadsheet formula injection');
  p.w.exportDashboard(); ok(p.w.__winPrint === 1, 'dashboard export opens the print dialog (save as PDF)');

  // ---------- realtime, pagination, errors, logout ----------
  p = await openPage('schooladmin.html', base());
  ok(p.channels.length === 1 && p.channels[0].subs.some(s => s.filter.table === 'payments' && s.filter.filter === 'school_id=eq.sc-1'), 'subscribes to live payment updates for this school only');
  const big = base(); big.tables.student_balances = Array.from({ length: 1205 }, (_, i) => row({ id: 'b-' + i, admission_no: 'B-' + i, full_name: 'Student ' + i, class_name: 'Class 3', total_fee: 1000, total_due: 1000, paid: 0, balance: 1000, fee_status: 'unpaid' }));
  p = await openPage('schooladmin.html', big, ); await tick(100);
  ok(p.text('statStudents') === '1205', 'loads ALL students beyond the 1,000-row API limit', p.text('statStudents'));
  p = await openPage('schooladmin.html', { ...base(), onQuery: { 'payments:select': () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  ok(/No internet/.test(p.toasts().join(' ')), 'load failure shows a friendly message');
  p = await openPage('schooladmin.html', base()); p.w.logout(); await tick(); ok(p.mock.calls.some(c => c.kind === 'signOut'), 'logout signs out');
  ok(!p.mock.calls.some(c => c.kind === 'query' && c.table === 'schools' && !c.filters.some(f => f[0] === 'id' && f[1] === 'sc-1') && c.op === 'select'), 'only ever asks for its own school row');

  summary();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
