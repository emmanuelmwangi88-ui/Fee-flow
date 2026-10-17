const { ok, tick, summary, openPage } = require('./lib');
const SUPER = { id: 'u-1', role: 'super_admin', school_id: null, full_name: 'Platform Super Admin' };
const data = () => ({
  tables: {
    profiles: [SUPER],
    schools: [
      { id: 's-1', name: 'Alpha Academy', location: 'Kiambu', level: 'Primary & Secondary', paybill: '123456', plan: 'Standard', status: 'active', created_at: '2026-10-01T10:00:00Z' },
      { id: 's-2', name: '<img src=x onerror=alert(1)>Evil School', location: 'Nairobi', level: 'Primary Only', paybill: null, plan: 'Premium', status: 'active', created_at: '2026-10-02T10:00:00Z' },
      { id: 's-3', name: 'Gamma Trial', location: 'Thika', level: 'Secondary Only', paybill: '654321', plan: 'Trial', status: 'suspended', created_at: '2026-10-03T10:00:00Z' }],
    notifications: [
      { id: 11, title: 'School added', body: 'Alpha Academy was added to the platform.', unread: true, created_at: new Date().toISOString() },
      { id: 12, title: 'Old news', body: 'Earlier', unread: false, created_at: '2026-09-01T10:00:00Z' }],
    platform_settings: [{ key: 'name', value: 'FeeFlow Kenya' }, { key: 'support_email', value: 'help@feeflow.test' }],
  },
  rpc: {
    platform_overview: () => ({ data: [{ school_id: 's-1', students: 120, parents: 80, collection_rate: 25.5 }, { school_id: 's-2', students: 30, parents: 10, collection_rate: 90 }], error: null }),
    platform_parents: () => ({ data: [{ id: 'p-1', full_name: 'Jane <b>Wanjiku</b>', phone: '254712345678', email: 'j@x.co', school_id: 's-1', school_name: 'Alpha Academy', children: 2, created_at: '2026-10-05T10:00:00Z' },
                                       { id: 'p-2', full_name: 'Peter Otieno', phone: '254722000111', email: 'p@x.co', school_id: 's-2', school_name: 'Evil School', children: 1, created_at: '2026-10-06T10:00:00Z' }], error: null }),
  },
});
const fnErr = (msg, status = 400) => ({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: { status, json: async () => ({ error: msg }) } }) });

(async () => {
  // ---------- access control ----------
  let p = await openPage('superadmin.html', { session: null, tables: { profiles: [] } });
  ok(p.d.getElementById('authCheck').style.display === 'none' && p.navs() >= 1, 'signed-out visitor is bounced to the login page and sees nothing');
  p = await openPage('superadmin.html', { tables: { profiles: [{ id: 'u-1', role: 'parent' }] } });
  ok(p.d.getElementById('authCheck').style.display === 'none' && p.navs() >= 1, 'a parent cannot open the Super Admin page');
  p = await openPage('superadmin.html', { tables: { profiles: [{ id: 'u-1', role: 'school_admin', school_id: 's-1' }] } });
  ok(p.d.getElementById('authCheck').style.display === 'none' && p.navs() >= 1, 'a school admin cannot open the Super Admin page');

  // ---------- dashboard ----------
  p = await openPage('superadmin.html', data());
  ok(p.errors.length === 0, 'page loads with no script errors', p.errors.join('|'));
  ok(p.d.getElementById('authCheck').style.display === 'block', 'Super Admin sees the dashboard');
  ok(p.text('userName') === 'Platform Super Admin', 'shows the signed-in admin\'s name');
  ok(p.text('statSchools') === '2', 'active schools counted (suspended excluded)', p.text('statSchools'));
  ok(p.text('statStudents') === '150', 'total students from platform_overview = 150', p.text('statStudents'));
  ok(p.text('statRevenue') === 'KES 18,000' && p.text('statMonthly') === 'KES 216,000', 'hosting revenue = Standard 6,000 + Premium 12,000', p.text('statRevenue') + ' / ' + p.text('statMonthly'));
  ok(/Standard[\s\S]*Premium|Premium[\s\S]*Standard/.test(p.text('plansBody')) && !/Trial/.test(p.text('plansBody')), 'plans table counts only active schools');
  ok(p.text('parentCount') === '2', 'parent count');
  ok(p.d.querySelectorAll('#schoolsOverview .school-card').length === 3, 'a card per school');
  ok(/25\.5%/.test(p.text('schoolsOverview')) && /90%/.test(p.text('collectionProgress')), 'collection rates shown');
  ok(!p.d.querySelector('#schoolsOverview img, #schoolsTable img, #collectionProgress img'), 'school names are escaped (no injected <img>)');
  ok(/Evil School/.test(p.text('schoolsTable')), 'hostile school name displayed as plain text');
  ok(p.d.querySelectorAll('#schoolsTable tbody tr').length === 3, 'schools table has 3 rows');
  ok(/Suspended/.test(p.text('schoolsTable')), 'suspended school labelled');
  ok(/\+254712345678/.test(p.text('parentsBody')) && !p.d.querySelector('#parentsBody b'), 'parents listed with +254 phone; HTML in names escaped');
  ok(p.d.getElementById('notifDot').style.display === 'block', 'bell dot shows unread notifications');
  ok(/Just now/.test(p.text('recentActivity')) && /School added/.test(p.text('recentActivity')), 'recent activity with relative time');
  ok(p.d.getElementById('platformName').value === 'FeeFlow Kenya' && p.d.getElementById('supportEmail').value === 'help@feeflow.test', 'settings loaded from the database');
  ok(!/testAPI|••••/.test(p.d.documentElement.outerHTML), 'fake API-key fields and fake "Test Connection" are gone');
  ok(/never typed into this page/.test(p.text('sec-settings')), 'settings page explains secrets stay on the server');
  const q = p.mock.calls.filter(c => c.kind === 'query' && c.table === 'notifications')[0];
  ok(q && q.filters.some(f => f[0] === 'audience' && f[1] === 'super'), 'only "super" notifications are requested');
  ok(!p.mock.calls.some(c => c.kind === 'query' && ['students', 'payments', 'parents'].includes(c.table)), 'page never queries students / payments / parents tables directly');

  // ---------- filters ----------
  p.w.filterSchools('suspended'); ok(p.d.querySelectorAll('#schoolsTable tbody tr').length === 1, 'filter: suspended');
  p.w.filterSchools('trial'); ok(/Gamma Trial/.test(p.text('schoolsTable')) && p.d.querySelectorAll('#schoolsTable tbody tr').length === 1, 'filter: trial plan');
  p.w.filterSchools('active'); ok(p.d.querySelectorAll('#schoolsTable tbody tr').length === 2, 'filter: active');
  p.set('parentSchoolFilter', 's-2'); p.w.filterParents();
  ok(p.d.querySelectorAll('#parentsBody tr').length === 1 && /Peter Otieno/.test(p.text('parentsBody')), 'parent list filters by school');

  // ---------- notifications ----------
  await p.w.markRead(11); await tick();
  const mr = p.mock.calls.find(c => c.kind === 'query' && c.op === 'update' && c.table === 'notifications');
  ok(mr && mr.payload.unread === false && mr.filters.some(f => f[0] === 'id' && f[1] === 11), 'markRead updates that notification');
  ok(p.d.getElementById('notifDot').style.display === 'none', 'bell dot clears');
  await p.w.markAllRead(); ok(p.mock.calls.filter(c => c.op === 'update').length >= 2, 'markAllRead sends an update');

  // ---------- add school: validation ----------
  p.w.openAddSchool();
  p.set('newSchoolName', 'N'); await p.w.addSchool(); ok(/school name/i.test(p.toasts().pop()), 'add: short name rejected');
  p.set('newSchoolName', 'Delta School'); p.set('newSchoolPaybill', '12ab'); await p.w.addSchool(); ok(/Paybill/i.test(p.toasts().pop()), 'add: bad paybill rejected');
  p.set('newSchoolPaybill', '123456'); p.set('newSchoolAdminEmail', 'nope'); await p.w.addSchool(); ok(/email/i.test(p.toasts().pop()), 'add: bad admin email rejected');
  p.set('newSchoolAdminEmail', 'Admin@Delta.ac.ke'); p.set('newSchoolAdminPassword', 'short'); await p.w.addSchool(); ok(/10 characters/i.test(p.toasts().pop()), 'add: short password rejected');
  ok(!p.mock.calls.some(c => c.kind === 'fn'), 'nothing sent to the server while invalid');

  // ---------- add school: success ----------
  p = await openPage('superadmin.html', { ...data(), functions: { 'admin-create-school': () => ({ data: { school_id: 'new' }, error: null }) } });
  p.w.openAddSchool(); p.set('newSchoolName', 'Delta School'); p.set('newSchoolLocation', 'Nakuru'); p.set('newSchoolPaybill', '123456');
  p.set('newSchoolAdminEmail', 'Admin@Delta.ac.ke'); p.set('newSchoolAdminPassword', 'LongEnough-123');
  await p.w.addSchool(); await tick();
  const fc = p.mock.calls.find(c => c.kind === 'fn' && c.name === 'admin-create-school');
  ok(fc && fc.body.name === 'Delta School' && fc.body.admin_email === 'admin@delta.ac.ke' && fc.body.admin_password === 'LongEnough-123', 'create: function called with lower-cased admin email');
  ok(fc && fc.body.plan === 'Standard' && fc.body.level === 'Primary & Secondary' && fc.body.paybill === '123456' && fc.body.location === 'Nakuru', 'create: plan, level, paybill and location sent', JSON.stringify(fc && fc.body));
  ok(/Delta School created/.test(p.toasts().pop()), 'create: success message');
  ok(!p.d.getElementById('modal-addSchool').classList.contains('open'), 'create: modal closes');
  ok(p.mock.calls.filter(c => c.kind === 'rpc' && c.fn === 'platform_overview').length === 2, 'create: dashboard reloads');
  ok(p.d.getElementById('newSchoolAdminPassword').value === '', 'temporary password is cleared from the form after success');

  // ---------- add school: server errors ----------
  p = await openPage('superadmin.html', { ...data(), functions: { 'admin-create-school': () => fnErr('An account with that email already exists', 409) } });
  p.w.openAddSchool(); p.set('newSchoolName', 'Delta School'); p.set('newSchoolAdminEmail', 'dup@delta.ac.ke'); p.set('newSchoolAdminPassword', 'LongEnough-123');
  p.d.getElementById('modal-addSchool').classList.add('open');
  await p.w.addSchool(); await tick();
  ok(/already exists/.test(p.toasts().pop()), 'create: server message (duplicate email) shown');
  ok(p.d.getElementById('modal-addSchool').classList.contains('open') && !p.d.getElementById('saveSchoolBtn').disabled, 'create: modal stays open and button re-enabled so you can fix it');

  // ---------- edit school ----------
  p = await openPage('superadmin.html', data());
  p.w.editSchool('s-2');
  ok(p.d.getElementById('newSchoolName').value.startsWith('<img') && p.d.getElementById('newSchoolPlan').value.startsWith('Premium'), 'edit: form pre-filled (plan Premium)');
  ok(p.d.getElementById('adminCredsRow').style.display === 'none' && p.d.getElementById('editOnlyBlock').style.display === 'block', 'edit: admin-credential fields hidden, status + reset shown');
  ok(p.text('modalSchoolTitleText') === 'Edit School', 'edit: title changes');
  p.set('editSchoolStatus', 'suspended'); p.set('newSchoolLocation', 'Mombasa');
  await p.w.addSchool(); await tick();
  const up = p.mock.calls.find(c => c.kind === 'query' && c.op === 'update' && c.table === 'schools');
  ok(up && up.filters.some(f => f[0] === 'id' && f[1] === 's-2') && up.payload.status === 'suspended' && up.payload.location === 'Mombasa' && up.payload.plan === 'Premium', 'edit: update sent for that school only with new status/location', JSON.stringify(up));
  ok(up && !('admin_email' in up.payload) && !('adminPassword' in up.payload), 'edit: never sends admin credentials');
  p.w.openAddSchool(); ok(p.d.getElementById('newSchoolName').value === '' && p.d.getElementById('adminCredsRow').style.display !== 'none' && p.text('modalSchoolTitleText') === 'Add New School', 'opening "Add School" after an edit resets the form to create mode');

  // ---------- reset admin password ----------
  p = await openPage('superadmin.html', { ...data(), functions: { 'admin-reset-password': () => ({ data: { ok: true }, error: null }) } });
  p.w.editSchool('s-1'); p.set('resetAdminPassword', 'short'); await p.w.resetAdminPassword();
  ok(/10 characters/.test(p.toasts().pop()) && !p.mock.calls.some(c => c.kind === 'fn'), 'reset: short password rejected locally');
  p.set('resetAdminPassword', 'BrandNew-Pass-1'); await p.w.resetAdminPassword(); await tick();
  const rc = p.mock.calls.find(c => c.kind === 'fn' && c.name === 'admin-reset-password');
  ok(rc && rc.body.school_id === 's-1' && rc.body.new_password === 'BrandNew-Pass-1', 'reset: function called for that school');
  ok(/password was reset/i.test(p.toasts().pop()) && p.d.getElementById('resetAdminPassword').value === '', 'reset: success message and field cleared');
  p = await openPage('superadmin.html', { ...data(), functions: { 'admin-reset-password': () => fnErr('No administrator found for this school', 404) } });
  p.w.editSchool('s-1'); p.set('resetAdminPassword', 'BrandNew-Pass-1'); await p.w.resetAdminPassword(); await tick();
  ok(/No administrator found/.test(p.toasts().pop()), 'reset: server error shown');

  // ---------- view school ----------
  p = await openPage('superadmin.html', data()); p.w.viewSchool('s-1');
  ok(/Students: 120/.test(p.w.__alerts[0]) && /Parent accounts: 80/.test(p.w.__alerts[0]) && /25\.5%/.test(p.w.__alerts[0]) && /KES 6,000/.test(p.w.__alerts[0]), 'view: shows students, parents, collection and plan fee');

  // ---------- settings ----------
  p = await openPage('superadmin.html', data());
  p.set('platformName', 'X'); await p.w.saveSettings(); ok(/platform name/i.test(p.toasts().pop()), 'settings: short name rejected');
  p.set('platformName', 'FeeFlow Africa'); p.set('supportEmail', 'bad'); await p.w.saveSettings(); ok(/valid support email/i.test(p.toasts().pop()), 'settings: bad email rejected');
  p.set('supportEmail', 'help@feeflow.co.ke'); p.set('supportPhone', '0700111222'); await p.w.saveSettings(); await tick();
  const us = p.mock.calls.find(c => c.kind === 'query' && c.op === 'upsert');
  ok(us && us.table === 'platform_settings' && us.opts.onConflict === 'key' && us.payload.length === 3 && us.payload.find(r => r.key === 'name').value === 'FeeFlow Africa', 'settings: upsert of name / support email / support phone');

  // ---------- error handling, toasts, logout ----------
  p = await openPage('superadmin.html', { ...data(), rpc: { platform_overview: () => ({ data: null, error: { message: 'Failed to fetch' } }), platform_parents: () => ({ data: [], error: null }) } });
  ok(/No internet/.test(p.toasts().join(' ')) && p.d.getElementById('authCheck').style.display === 'block', 'load failure shows a friendly message and the page still renders');
  p.w.showToast('<img src=x onerror=alert(1)>', 'info'); ok(!p.d.querySelector('#toastContainer img') && /<img/.test(p.toasts().pop()), 'toasts never interpret HTML');
  p = await openPage('superadmin.html', data()); p.w.logout(); await tick();
  ok(p.mock.calls.some(c => c.kind === 'signOut'), 'logout signs out of Supabase');

  summary();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
