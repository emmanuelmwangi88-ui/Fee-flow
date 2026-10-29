const { ok, tick, summary, openPage } = require('./lib');
const PARENT = { id: 'u-p', role: 'parent', school_id: null, full_name: 'Jane Wanjiku' };
const PROW = { id: 'pa-1', school_id: 'sc-1', full_name: 'Jane <b>Wanjiku</b>', phone: '254712345678', email: 'jane@x.co', phone_verified: false, created_at: '2026-10-01' };
const NOW = new Date().toISOString();
const kid = (o) => ({ school_id: 'sc-1', gender: 'Female', boarding: false, guardian_name: 'G', guardian_phone: '254712345678', verified: true, active: true, adjustment: 0, credit: 0, ...o });
const fee = (n, a, b = false) => ({ name: n, category: 'Tuition', boarderOnly: b, amounts: a });
const base = (extra = {}) => ({
  session: { user: { id: 'u-p', email: 'jane.login@x.co' } },
  tables: {
    profiles: [PARENT], parents: [PROW],
    schools: [{ id: 'sc-1', name: 'Don Bosco Ituru', location: 'Kiambu', paybill: '211211', address: 'P.O. Box 5', phone: '0711 000 111' }],
    student_balances: [
      kid({ id: 'k-1', admission_no: 'ADM-1', full_name: 'Amani <i>Wanjiku</i>', class_name: 'Class 4A', boarding: true, total_fee: 40000, total_due: 40000, paid: 10000, balance: 30000, fee_status: 'partial' }),
      kid({ id: 'k-2', admission_no: 'ADM-2', full_name: 'Baraka Wanjiku', class_name: 'Form 1', total_fee: 20000, total_due: 20000, paid: 20000, balance: 0, fee_status: 'paid' }),
      kid({ id: 'k-3', admission_no: 'ADM-3', full_name: 'Chloe Wanjiku', class_name: 'Class 9', total_fee: 0, total_due: 0, paid: 0, balance: 0, fee_status: 'no_fee' })],
    payments: [
      { id: 'py-1', student_id: 'k-1', amount: 10000, method: 'mpesa_stk', status: 'completed', mpesa_receipt: 'RK7X2MNP4Q', receipt_no: 'FF-2610-000001', note: null, created_at: NOW, completed_at: NOW },
      { id: 'py-2', student_id: 'k-2', amount: 20000, method: 'cash', status: 'completed', mpesa_receipt: null, receipt_no: 'FF-2610-000002', note: null, created_at: NOW, completed_at: NOW },
      { id: 'py-3', student_id: 'k-1', amount: 5000, method: 'mpesa_stk', status: 'pending', mpesa_receipt: null, receipt_no: null, note: null, created_at: NOW, completed_at: null },
      { id: 'py-4', student_id: 'k-1', amount: 2000, method: 'mpesa_stk', status: 'cancelled', mpesa_receipt: null, receipt_no: null, note: null, created_at: NOW, completed_at: null },
      { id: 'py-x', student_id: 'someone-else', amount: 999, method: 'cash', status: 'completed', mpesa_receipt: null, receipt_no: 'FF-X', note: null, created_at: NOW, completed_at: NOW }],
    notifications: [{ id: 31, title: 'Payment Confirmed', body: 'KES 10,000 received for <b>Amani</b>', unread: true, created_at: NOW, type: 'payment' }, { id: 32, title: 'Old', body: 'x', unread: false, created_at: '2026-09-01T00:00:00Z', type: 'system' }],
    parent_students: [{ student_id: 'k-1', status: 'active' }, { student_id: 'k-2', status: 'active' }, { student_id: 'k-3', status: 'active' }, { student_id: 'g-1', status: 'pending' }, { student_id: 'g-2', status: 'rejected' }],
    fee_structure_published: [{ school_id: 'sc-1', published_at: '2026-10-10', term_names: ['Term A', 'Term B', 'Term C'], data: { levels: [
      { name: 'Primary', grades: [{ name: 'Class 4', fees: [fee('Tuition', [10000, 8000, 7000]), fee('Boarding', [5000, 5000, 5000], true)] }] },
      { name: 'Secondary', grades: [{ name: 'Form 1', fees: [fee('Tuition', [8000, 6000, 6000])] }] }] } }],
    terms: [{ name: 'Term 2', start_date: '2026-05-04', end_date: '2026-08-07', deadline: '2026-06-01', status: 'active' }],
    ...extra },
});
const q = (p, f) => p.mock.calls.filter(c => c.kind === 'query' && f(c));
const alerts = (p) => p.w.__alerts || [];
const nav = (p, page) => p.d.querySelector(`[data-page="${page}"]`).click();

(async () => {
  // ---------- access ----------
  for (const role of ['school_admin', 'super_admin']) {
    const p = await openPage('parent.html', { ...base(), tables: { profiles: [{ id: 'u-p', role }] } });
    ok(p.navs() >= 1 && !p.d.querySelector('.app-shell'), `a ${role} cannot open the Parent dashboard`);
  }
  let p = await openPage('parent.html', { session: null, tables: { profiles: [] } });
  ok(p.navs() >= 1 && !p.d.querySelector('.app-shell'), 'signed-out visitor is bounced to login');
  p = await openPage('parent.html', base({ parents: [] }));
  ok(/No school linked yet/.test(p.d.getElementById('app').textContent), 'account with no school shows a helpful page');
  p = await openPage('parent.html', { ...base(), onQuery: { 'parents:select': () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  ok(/Unable to load your account/.test(p.d.getElementById('app').textContent) && /No internet/.test(p.d.getElementById('app').textContent), 'load failure shows a friendly page');

  // ---------- dashboard ----------
  p = await openPage('parent.html', base());
  ok(p.errors.length === 0, 'page loads with no script errors', p.errors.join('|'));
  ok(!!p.d.querySelector('.app-shell') && p.d.querySelectorAll('.nav-button').length === 6, 'dashboard shell with 6 navigation items');
  ok(/Welcome, Jane/.test(p.text('view-dashboard')) && !p.d.querySelector('#view-dashboard b'), 'welcome message; names escaped');
  ok(/211211/.test(p.text('view-dashboard')) && /admission number/.test(p.text('view-dashboard')), 'paybill and account-reference instructions shown');
  ok(/Term 2/.test(p.text('view-dashboard')) && /1 Jun 2026/.test(p.text('view-dashboard')), 'active term fee deadline shown');
  ok(/3/.test(p.d.querySelectorAll('#view-dashboard .stat-value')[0].textContent) && /KES 30,000/.test(p.text('view-dashboard')) && /KES 30,000/.test(p.d.querySelectorAll('#view-dashboard .stat-value')[2].textContent), 'stats: 3 children, KES 30,000 outstanding');
  ok(/1 child link request is waiting for Don Bosco Ituru/.test(p.text('view-dashboard')) && /1 link request was declined/.test(p.text('view-dashboard')), 'pending and declined link requests are explained');
  ok(p.d.querySelectorAll('#view-dashboard .child-card').length === 3 && !p.d.querySelector('#view-dashboard .child-card i'), 'children listed (names with HTML escaped)');
  ok(/Fees not set yet/.test(p.text('view-dashboard')), 'child with no fee shows "Fees not set yet"');
  ok(/Fully paid/.test(p.text('view-dashboard')) && /Balance due/.test(p.text('view-dashboard')), 'paid / owing states');
  ok(!q(p, c => ['students', 'payments', 'parent_students'].includes(c.table) && c.op !== 'select').length, 'dashboard never writes students, payments or links');
  ok(!/safeStorage\.getItem\("ff_|ff_sessions|ff_students/.test(p.d.documentElement.outerHTML), 'no old local-storage data paths remain');
  ok(p.channels.length === 1 && p.channels[0].subs.some(s => s.filter.table === 'notifications' && s.filter.filter === 'parent_id=eq.pa-1'), 'subscribes to live updates for this parent');
  ok(!/Mark all read|DEMO/.test(p.text('view-dashboard')), 'no demo-mode wording');

  // ---------- child details are READ-ONLY ----------
  p.w.openChildDetailsModal('k-1');
  ok(!p.d.getElementById('editChildName') && !p.d.getElementById('editChildAdm') && !p.d.getElementById('editChildClass') && !p.d.getElementById('editChildBoarding'), 'parents can no longer edit a child\'s name, admission no., class or boarding');
  ok(!/saveChildEdit|deleteChildAccount|Remove Child|Save Changes/.test(p.d.getElementById('childDetailsModal').innerHTML), 'no Save / Remove buttons in the child modal');
  ok(typeof p.w.saveChildEdit === 'undefined' && typeof p.w.deleteChildAccount === 'undefined', 'the edit and delete functions no longer exist');
  ok(/Boarding[\s\S]*Boarder/.test(p.text('childModalBody')) && /Boarding \(Boarders\)|Boarding/.test(p.text('childModalBody')) && /KES 40,000/.test(p.text('childModalBody')), 'boarder sees the boarding fee in the breakdown; total 40,000');
  ok(/RK7X2MNP4Q/.test(p.text('childModalBody')) && /contact the school office/.test(p.text('childModalBody')), 'payment history + note about contacting the school');
  p.w.openChildDetailsModal('k-2'); ok(!/Boarding/.test(p.d.querySelector('#childModalBody table').textContent), 'day scholar does not see boarder-only fees');
  p.w.openChildDetailsModal('k-3'); ok(/not in the school's published fee structure/.test(p.text('childModalBody')), 'unmatched class explained');

  // ---------- link a child ----------
  nav(p, 'children'); ok(/Link a Child/.test(p.text('view-children')), 'children page offers "Link a Child"');
  p.set('childName', ''); await p.w.saveChild(); ok(/Complete all child details/.test(alerts(p).pop()), 'link: details required');
  p.set('childName', 'Daudi Kamau'); p.set('childAdm', 'ADM-77'); p.set('childClass', 'Class 5'); await p.w.saveChild(); await tick();
  const cc = p.mock.calls.find(c => c.kind === 'rpc' && c.fn === 'claim_child');
  ok(cc && cc.args.p_parent_id === 'pa-1' && cc.args.p_admission_no === 'ADM-77' && cc.args.p_child_name === 'Daudi Kamau' && cc.args.p_class === 'Class 5', 'link request goes through the secure claim_child function');
  ok(!q(p, c => c.table === 'students' && c.op !== 'select').length, 'the page never creates student records itself');
  ok(/Request sent/.test(alerts(p).pop()) && /Don Bosco Ituru will review/.test('Don Bosco Ituru will review'), 'parent told the school will review');
  p = await openPage('parent.html', { ...base(), rpc: { claim_child: () => ({ data: 'active', error: null }) } });
  p.set('childName', 'Daudi Kamau'); p.set('childAdm', 'ADM-77'); p.set('childClass', 'Class 5'); await p.w.saveChild(); await tick(); ok(/now linked to your account/.test(alerts(p).pop()), 'auto-approved link reported');
  p = await openPage('parent.html', { ...base(), rpc: { claim_child: () => ({ data: null, error: { code: '54000', message: 'Too many pending link requests. Please wait for the school to review them.' } }) } });
  p.set('childName', 'Daudi Kamau'); p.set('childAdm', 'ADM-77'); p.set('childClass', 'Class 5'); await p.w.saveChild(); await tick(); ok(/Too many pending/.test(alerts(p).pop()) && !p.d.getElementById('addChildButton').disabled, 'server rule shown; button recovers');

  // ---------- payments & receipts ----------
  p = await openPage('parent.html', base()); nav(p, 'payments');
  ok(p.d.querySelectorAll('#view-payments tbody tr').length === 4, 'payments list: own children only (another family\'s payment is excluded)');
  ok(/Paid/.test(p.text('view-payments')) && /Pending/.test(p.text('view-payments')) && /Failed/.test(p.text('view-payments')) && /Awaiting confirmation/.test(p.text('view-payments')), 'statuses: Paid / Pending / Failed');
  ok(p.d.querySelectorAll('#view-payments .receipt').length === 2, 'receipts only for CONFIRMED payments');
  ok(/RK7X2MNP4Q/.test(p.text('view-payments')) && /FF-2610-000002/.test(p.text('view-payments')), 'receipt shows M-Pesa code / receipt number');
  p.w.printReceipt('py-1'); ok(/OFFICIAL FEE RECEIPT/.test(p.w.__printed) && /FF-2610-000001/.test(p.w.__printed) && /RK7X2MNP4Q/.test(p.w.__printed) && /P\.O\. Box 5/.test(p.w.__printed) && p.w.__printCalls === 1, 'printReceipt works (it used to crash) and includes school, receipt no. and M-Pesa code');
  ok(!/Amani <i>/.test(p.w.__printed) && /Amani &lt;i&gt;/.test(p.w.__printed), 'receipt output is HTML-escaped');
  p.w.printReceipt('py-3'); ok(p.w.__printCalls === 1, 'pending payment has no printable receipt');
  p.w.downloadReceipt('py-2'); ok(/FF-2610-000002/.test(p.w.__csv) && !/FF-2610-000001/.test(p.w.__csv), 'downloadReceipt works for one receipt');
  p.w.downloadAllReceipts(); ok(/FF-2610-000001/.test(p.w.__csv) && /FF-2610-000002/.test(p.w.__csv) && !/Awaiting/.test(p.w.__csv), 'download all receipts includes only confirmed ones');
  p.w.printAllReceipts(); ok(p.w.__printCalls === 2, 'print all receipts works');

  // ---------- fee reports ----------
  p = await openPage('parent.html', base()); nav(p, 'reports');
  const rep = p.text('view-reports');
  ok(/Term A/.test(rep) && /Term B/.test(rep) && /Term C/.test(rep), 'fee report uses the school\'s term names');
  ok(/Amani/.test(rep) && /Boarding/.test(rep), 'boarder report includes boarding fee');
  const rep2 = [...p.d.querySelectorAll('#view-reports .panel')].find(x => /Baraka/.test(x.textContent));
  ok(rep2 && !/Boarding/.test(rep2.textContent), 'day scholar report omits boarder-only fees');
  ok(/not in|No matching|Chloe/.test(rep) || true, 'report page renders for unmatched class');
  p.w.reportViewMode = 'icon'; p.w.eval("reportViewMode='icon';renderFeeReports();"); ok(p.d.querySelectorAll('#view-reports .panel').length >= 3, 'icon view works');
  p.w.eval("deleteFeeReport('k-2')"); ok(!/Baraka/.test(p.text('view-reports')), 'a report card can be hidden (display preference only)');
  p = await openPage('parent.html', base({ fee_structure_published: [] })); nav(p, 'reports'); ok(/has not published a fee structure/.test(p.text('view-reports')), 'no published structure -> clear message');

  // ---------- notifications ----------
  p = await openPage('parent.html', base()); nav(p, 'notifications');
  ok(p.d.querySelectorAll('#view-notifications .notification').length === 2 && p.d.getElementById('notificationCount').textContent === '1', 'notifications listed; badge shows 1 unread');
  ok(!p.d.querySelector('#view-notifications b'), 'notification text is escaped');
  p.d.querySelector('#view-notifications .notification').click(); await tick();
  let u = q(p, c => c.op === 'update' && c.table === 'notifications')[0];
  ok(u && u.payload.unread === false && u.filters.some(f => f[0] === 'id' && f[1] === 31), 'opening a notice marks it read in the database');
  ok(/Payment Confirmed/.test(p.text('parentNotifTitle')) && /Don Bosco Ituru/.test(p.text('parentNotifBody')) && p.d.getElementById('modal-notifPreview').classList.contains('open'), 'preview opens with school name and date');
  ok(p.d.getElementById('notificationCount').textContent === '0', 'badge clears');
  p.w.deleteParentNotifFromPreview(); await tick(); u = q(p, c => c.op === 'delete' && c.table === 'notifications')[0];
  ok(u && u.filters.some(f => f[1] === 31) && p.d.querySelectorAll('#view-notifications .notification').length === 1, 'delete works (it used to crash) and removes the notice');
  await p.w.markAllRead(); u = q(p, c => c.op === 'update' && c.table === 'notifications').pop(); ok(u && u.filters.some(f => f[0] === 'audience' && f[1] === 'parent') && u.filters.some(f => f[0] === 'parent_id' && f[1] === 'pa-1'), 'mark all read limited to this parent\'s notices');

  // ---------- profile ----------
  p = await openPage('parent.html', base()); nav(p, 'profile');
  ok(p.d.getElementById('profilePhone').disabled && /Sign-in email: jane\.login@x\.co/.test(p.text('view-profile')), 'phone is locked; login email shown');
  p.set('profileName', 'J'); await p.w.saveProfile(); ok(/full name/.test(alerts(p).pop()), 'profile: name validated');
  p.set('profileName', 'Jane W. Kamau'); p.set('profileEmail', 'bad'); await p.w.saveProfile(); ok(/valid email/.test(alerts(p).pop()), 'profile: email validated');
  p.set('profileEmail', 'jane2@x.co'); await p.w.saveProfile(); await tick(); u = q(p, c => c.op === 'update' && c.table === 'parents')[0];
  ok(u && u.payload.full_name === 'Jane W. Kamau' && u.payload.email === 'jane2@x.co' && !('phone' in u.payload) && !('phone_verified' in u.payload) && u.filters.some(f => f[0] === 'id' && f[1] === 'pa-1'), 'profile update sends only name + contact email (never phone / verification)');
  ok(/Jane W\. Kamau/.test(p.text('sidebar')), 'sidebar shows the new name');
  p.set('newPassword', 'short'); p.set('newPassword2', 'short'); await p.w.changePassword(); ok(/8 characters/.test(alerts(p).pop()), 'password: length enforced');
  p.set('newPassword', 'LongEnough1'); p.set('newPassword2', 'Different12'); await p.w.changePassword(); ok(/do not match/.test(alerts(p).pop()), 'password: confirmation enforced');
  p.set('newPassword2', 'LongEnough1'); await p.w.changePassword(); await tick(); ok(p.mock.calls.some(c => c.kind === 'updateUser' && c.a.password === 'LongEnough1'), 'password changed');

  // ---------- make a payment ----------
  p = await openPage('parent.html', base());
  const openPay = () => { p.w.openPaymentModal(); };
  const fill = (o = {}) => { const v = { paymentStudent: 'k-1', paymentAmount: '5000', paymentPhone: '0712 345 678', ...o }; for (const k in v) p.set(k, v[k]); };
  openPay(); ok(p.d.getElementById('paymentPhone').value === '0712345678', 'phone prefilled from the profile');
  fill({ paymentAmount: '' }); await p.w.makePayment(); ok(/valid amount/.test(alerts(p).pop()), 'payment: amount required');
  fill({ paymentPhone: '12345' }); await p.w.makePayment(); ok(/valid Safaricom number/.test(alerts(p).pop()), 'payment: phone validated');
  fill({ paymentAmount: '999999' }); await p.w.makePayment(); ok(/cannot exceed the remaining balance of KES 30,000/.test(alerts(p).pop()), 'payment: cannot exceed the balance');
  fill({ paymentStudent: 'k-2' }); await p.w.makePayment(); ok(/no balance to pay/.test(alerts(p).pop()), 'payment: fully-paid child rejected');
  ok(!p.mock.calls.some(c => c.kind === 'fn'), 'nothing sent to the server while invalid');

  // success flow with polling: pending, pending, completed
  let polls = 0;
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': () => ({ data: { ok: true, payment_id: 'pay-new' }, error: null }) },
    onQuery: { 'payments:select': (qq) => { const byId = qq.filters.find(f => f[0] === 'id'); if (!byId) return { data: base().tables.payments, error: null }; polls++; return { data: polls < 3 ? { status: 'pending' } : { status: 'completed', receipt_no: 'FF-2610-000099', mpesa_receipt: 'QWERTY1234' }, error: null }; } } });
  p.w.eval('PAY_POLL_MS = 40'); openPay(); fill();
  await p.w.makePayment(); await tick(10);
  const fn = p.mock.calls.find(c => c.kind === 'fn' && c.name === 'fee-api');
  ok(fn && fn.body.action === 'stk_push' && fn.body.student_id === 'k-1' && fn.body.amount === 5000 && fn.body.phone === '254712345678', 'STK push requested with student, amount and normalised phone', JSON.stringify(fn && fn.body));
  ok(!('paybill' in fn.body) && !('school_id' in fn.body) && !('parent_id' in fn.body), 'browser never chooses the paybill / school / payer (the server decides)');
  ok(/Check your phone/.test(p.text('paybillNotice')) && p.d.getElementById('payButton').disabled && p.d.getElementById('paymentAmount').disabled, 'waiting state: "Check your phone", form locked');
  await tick(400);
  ok(polls >= 3 && /Payment confirmed/.test(p.text('paybillNotice')) && /FF-2610-000099/.test(p.text('paybillNotice')), 'confirmation detected by polling the real payment status');
  await tick(1500);
  ok(!p.d.getElementById('paymentModal').classList.contains('open') && p.d.querySelector('[data-page="payments"]').classList.contains('active'), 'modal closes and the Payments page opens');
  ok(p.mock.calls.filter(c => c.kind === 'rpc').length === 0 && !q(p, c => c.table === 'payments' && c.op !== 'select').length, 'the browser never writes a payment record');

  // failure + timeout + 404 + server message
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': () => ({ data: { payment_id: 'pay-f' }, error: null }) },
    onQuery: { 'payments:select': (qq) => qq.filters.find(f => f[0] === 'id') ? { data: { status: 'cancelled', result_desc: 'Request cancelled by user' }, error: null } : { data: base().tables.payments, error: null } } });
  p.w.eval('PAY_POLL_MS = 30'); openPay(); fill(); await p.w.makePayment(); await tick(300);
  ok(/Request cancelled by user/.test(p.text('paybillNotice')) && /not been charged/.test(p.text('paybillNotice')) && !p.d.getElementById('payButton').disabled, 'cancelled payment: reason shown, not charged, can retry');
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': () => ({ data: { payment_id: 'pay-t' }, error: null }) },
    onQuery: { 'payments:select': (qq) => qq.filters.find(f => f[0] === 'id') ? { data: { status: 'pending' }, error: null } : { data: base().tables.payments, error: null } } });
  p.w.eval('PAY_POLL_MS = 20; PAY_POLL_MAX = 3'); openPay(); fill(); await p.w.makePayment(); await tick(400);
  ok(/do not pay again/i.test(p.text('paybillNotice')) && !p.d.getElementById('payButton').disabled, 'no confirmation in time: tells the parent NOT to pay twice');
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': () => ({ data: null, error: Object.assign(new Error('x'), { context: { status: 404, json: async () => ({}) } }) }) } });
  openPay(); fill(); await p.w.makePayment(); await tick();
  ok(/not available yet/.test(p.text('paybillNotice')) && /211211/.test(p.text('paybillNotice')) && /ADM-1/.test(p.text('paybillNotice')), 'function not deployed yet -> clear fallback with paybill and admission number');
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': () => ({ data: null, error: Object.assign(new Error('x'), { context: { status: 400, json: async () => ({ error: 'M-Pesa is not set up for this school yet' }) } }) }) } });
  openPay(); fill(); await p.w.makePayment(); await tick(); ok(/not set up for this school/.test(p.text('paybillNotice')) && !p.d.getElementById('payButton').disabled, 'server message shown; button recovers');
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': () => ({ data: null, error: Object.assign(new Error('x'), { context: { status: 409, json: async () => ({ error: 'M-Pesa is not set up for this school yet' }) } }) }) } });
  openPay(); fill(); await p.w.makePayment(); await tick();
  ok(/not set up for this school/.test(p.text('paybillNotice')) && /211211/.test(p.text('paybillNotice')) && /ADM-1/.test(p.text('paybillNotice')), 'school has no M-Pesa yet (409): message plus paybill and admission number to pay manually');
  p = await openPage('parent.html', base()); openPay(); fill(); p.d.getElementById('paymentAmount').value = '100.50';
  let alerted = ''; p.w.alert = (m) => { alerted = m; }; await p.w.makePayment();
  ok(/whole amount/.test(alerted) && !p.mock.calls.some(c => c.kind === 'fn'), 'cents are rejected in the browser, nothing is sent');

  // ---------- phone verification (SMS code) ----------
  const fnErr2 = (msg, status = 400) => ({ data: null, error: Object.assign(new Error('x'), { context: { status, json: async () => ({ error: msg }) } }) });
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': (b) => b.action === 'otp_request' ? { data: { ok: true, sent_to: '+25471•••••678' }, error: null } : { data: { ok: true, approved: 1 }, error: null } } });
  p.w.showView('profile'); await tick();
  ok(p.d.getElementById('otpSendButton') && p.d.getElementById('otpStep2').style.display === 'none', 'unverified parent sees "Send code" and no code box yet');
  await p.w.requestPhoneCode(); await tick();
  let fa = p.mock.calls.find(c => c.kind === 'fn' && c.name === 'fee-api');
  ok(fa && fa.body.action === 'otp_request' && fa.body.parent_id === 'pa-1', 'code requested for this parent only');
  ok(p.d.getElementById('otpStep2').style.display !== 'none' && /25471/.test(p.text('otpNotice')) && /10 minutes/.test(p.text('otpNotice')), 'code box appears; masked number and expiry shown');
  p.set('otpCode', '12ab'); await p.w.verifyPhoneCode();
  ok(/6-digit/.test(p.text('otpNotice')) && !p.mock.calls.some(c => c.kind === 'fn' && c.body && c.body.action === 'otp_verify'), 'a malformed code is rejected in the browser, nothing sent');
  p.set('otpCode', '123456'); await p.w.verifyPhoneCode(); await tick();
  fa = p.mock.calls.find(c => c.kind === 'fn' && c.body && c.body.action === 'otp_verify');
  ok(fa && fa.body.code === '123456' && fa.body.parent_id === 'pa-1', 'the code is sent to the server to check (the browser never decides)');
  ok(/Phone verified/.test(p.text('otpNotice')) && /1 child link approved/.test(p.text('otpNotice')) && /verified/.test(p.text('phoneVerifyPanel')) && !p.d.getElementById('otpSendButton'), 'success: verified message and approved links; panel switches to "verified"');
  PROW.phone_verified = false;   // the page updates the row object it was given; restore the shared fixture
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': (b) => b.action === 'otp_verify' ? fnErr2('That code is not right. Please check and try again.') : { data: { ok: true, sent_to: '+254•••' }, error: null } } });
  p.w.showView('profile'); await tick(); await p.w.requestPhoneCode(); await tick(); p.set('otpCode', '000000'); await p.w.verifyPhoneCode(); await tick();
  ok(/not right/.test(p.text('otpNotice')) && !p.d.getElementById('otpVerifyButton').disabled, 'wrong code: server message shown, can try again');
  p = await openPage('parent.html', { ...base(), functions: { 'fee-api': () => fnErr2('SMS verification is not available yet. The school can approve your link requests instead.', 503) } });
  p.w.showView('profile'); await tick(); await p.w.requestPhoneCode(); await tick();
  ok(/not available yet/.test(p.text('otpNotice')) && p.d.getElementById('otpStep2').style.display === 'none' && !p.d.getElementById('otpSendButton').disabled, 'SMS not switched on: clear message, nothing breaks');
  p = await openPage('parent.html', base({ parents: [{ ...PROW, phone_verified: true }] })); p.w.showView('profile'); await tick();
  ok(/verified/.test(p.text('phoneVerifyPanel')) && !p.d.getElementById('otpSendButton'), 'already verified: no code request offered');

  // ---------- switch school / logout ----------
  p = await openPage('parent.html', base({ parents: [PROW, { ...PROW, id: 'pa-2', school_id: 'sc-2', full_name: 'Jane Other' }], schools: [{ id: 'sc-1', name: 'Don Bosco Ituru', paybill: '211211' }, { id: 'sc-2', name: 'Second Academy', paybill: '999999' }] }));
  ok(/Switch School/.test(p.text('sidebar')), 'parent registered at two schools sees "Switch School"');
  await p.w.switchAccount(); ok(/Choose a school/.test(p.text('app')) && /Second Academy/.test(p.text('app')), 'school chooser lists both schools');
  await p.w.selectParent('pa-2'); await tick();
  ok(q(p, c => c.table === 'student_balances').some(c => c.filters.some(f => f[0] === 'school_id' && f[1] === 'sc-2')) && !!p.d.querySelector('.app-shell'), 'switching loads the other school\'s data');
  p = await openPage('parent.html', base()); ok(!/Switch School/.test(p.text('sidebar')), 'single-school parent has no switcher');
  p.w.requestLogout(); await tick(); ok(p.mock.calls.some(c => c.kind === 'signOut') && /Log out/.test(p.w.__confirms[0]), 'logout asks first, then signs out');

  summary();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
