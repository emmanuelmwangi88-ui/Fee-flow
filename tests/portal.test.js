const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0; const failures = [];
const ok = (cond, label, extra = '') => { (cond ? pass++ : (fail++, failures.push(label + ' ' + extra))); console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond ? '' : '  ' + extra)); };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

class Loader extends ResourceLoader {
  fetch(url) {
    if (url.includes('/js/vendor/')) return Promise.resolve(Buffer.from(''));          // real library replaced by the mock
    if (url.startsWith('http://localhost/')) {
      const f = path.join(ROOT, decodeURIComponent(url.replace('http://localhost/', '').split(/[?#]/)[0]));
      return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('404 ' + url));
    }
    return Promise.resolve(Buffer.from(''));
  }
}

function makeMock(o = {}) {
  const calls = [];
  const st = { session: o.session || null, profile: o.profile || null, schools: o.schools ?? [
      { id: 's-1', name: 'Alpha Academy', location: 'Kiambu', level: 'Primary' },
      { id: 's-2', name: '<img src=x onerror=alert(1)>Evil School', location: 'Nairobi', level: 'Secondary' }] };
  const auth = {
    getSession: async () => ({ data: { session: st.session } }),
    onAuthStateChange: (cb) => { st.listener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithPassword: async (c) => { calls.push(['signIn', c]); if (o.signInError) return { data: {}, error: o.signInError }; st.session = { user: o.user }; return { data: { user: o.user, session: st.session }, error: null }; },
    signUp: async (a) => { calls.push(['signUp', a]); if (o.signUpError) return { data: {}, error: o.signUpError };
      const user = o.signUpUser || { id: 'u-new', email: a.email, identities: [{}] };
      if (o.signUpSession) st.session = { user };
      return { data: { user, session: o.signUpSession ? st.session : null }, error: null }; },
    signOut: async () => { calls.push(['signOut']); st.session = null; return { error: null }; },
    updateUser: async (a) => { calls.push(['updateUser', a]); return { data: {}, error: o.updateUserError || null }; },
    resetPasswordForEmail: async (e, opt) => { calls.push(['reset', e, opt]); return { error: o.resetError || null }; },
  };
  const handler = (table, q, single) => {
    if (table === 'schools') return { data: st.schools, error: o.schoolsError || null };
    if (table === 'profiles') return { data: st.profile, error: null };
    return { data: null, error: null };
  };
  const from = (table) => { const q = { table }; const api = {
    select() { return api; }, order() { return api; }, eq() { return api; },
    maybeSingle: async () => handler(table, q, true),
    then: (res, rej) => (o.schoolsDelay && table === 'schools' ? new Promise(r => setTimeout(r, o.schoolsDelay)) : Promise.resolve()).then(() => handler(table, q, false)).then(res, rej) }; return api; };
  const rpc = async (fn, args) => { calls.push(['rpc', fn, args]); const r = (o.rpc || {})[fn]; return r ? r(args) : { data: null, error: null }; };
  return { client: { auth, from, rpc }, calls, st };
}

async function open(o = {}) {
  const mock = makeMock(o);
  let html = fs.readFileSync(path.join(ROOT, 'portal.html'), 'utf8');
  html = html.replace('function go(url) { location.replace(url); }', "function go(url) { (window.__nav = window.__nav || []).push(url); }");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message.split('\n')[0]));
  const dom = new JSDOM(html, { url: 'http://localhost/portal.html' + (o.hash || ''), runScripts: 'dangerously', resources: new Loader(), virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) { w.supabase = { createClient: () => mock.client }; } });
  await tick(60);
  const w = dom.window, d = w.document;
  const set = (id, v) => { d.getElementById(id).value = v; };
  const shown = (id) => d.getElementById(id).style.display !== 'none';
  const err = (id) => { const e = d.getElementById(id); return e.classList.contains('show') ? d.getElementById(id + 'Text').textContent : ''; };
  return { w, d, mock, errors, set, shown, err, nav: () => w.__nav || [] };
}
const rolesUser = { id: 'u-1', email: 'x@example.com', user_metadata: {} };

(async () => {
  // ---------- page load ----------
  let p = await open();
  ok(p.errors.length === 0, 'portal loads with no script errors', p.errors.join('|'));
  ok(p.shown('stepLogin') && !p.shown('stepRegister'), 'sign-in form is shown first');
  ok(!!p.d.getElementById('loginEmail') && !!p.d.getElementById('loginPassword'), 'email + password fields exist');
  ok(!p.d.getElementById('loginType') && !p.d.getElementById('loginUsername'), 'old account-type / username fields are gone');
  ok(!/123456|SADMIN|ff_sessions|DEMO_OTP/.test(fs.readFileSync(ROOT + '/portal.html', 'utf8')), 'no fake OTP / hardcoded password / local sessions remain');

  // ---------- sign-in validation & errors ----------
  p.set('loginEmail', 'not-an-email'); p.set('loginPassword', 'x'); await p.w.signIn();
  ok(/valid email/i.test(p.err('loginError')), 'invalid email rejected before any request');
  ok(!p.mock.calls.some(c => c[0] === 'signIn'), 'no sign-in request sent for invalid email');
  p.set('loginEmail', 'a@b.co'); p.set('loginPassword', ''); await p.w.signIn();
  ok(/password/i.test(p.err('loginError')), 'empty password rejected');

  p = await open({ signInError: { message: 'Invalid login credentials' } });
  p.set('loginEmail', 'a@b.co'); p.set('loginPassword', 'wrong'); await p.w.signIn(); await tick();
  ok(p.err('loginError') === 'Incorrect email or password.', 'wrong password -> friendly message', p.err('loginError'));
  ok(!p.d.getElementById('loginSubmitBtn').disabled, 'button re-enabled after failure');
  ok(p.nav().length === 0, 'no redirect after failed sign-in');

  // ---------- role routing ----------
  for (const [role, page] of [['super_admin', 'superadmin.html'], ['school_admin', 'schooladmin.html'], ['parent', 'parent.html']]) {
    p = await open({ user: rolesUser, profile: { id: 'u-1', role, school_id: role === 'school_admin' ? 's-1' : null, full_name: 'N' } });
    p.set('loginEmail', 'A@B.co'); p.set('loginPassword', 'secret-pass'); await p.w.signIn(); await tick();
    ok(p.nav().includes(page), `${role} is sent to ${page}`, JSON.stringify(p.nav()));
    const si = p.mock.calls.find(c => c[0] === 'signIn');
    ok(si && si[1].email === 'a@b.co', `${role}: email lower-cased before sign-in`);
  }

  p = await open({ user: rolesUser, profile: null });
  p.set('loginEmail', 'a@b.co'); p.set('loginPassword', 'secret-pass'); await p.w.signIn(); await tick();
  ok(/not set up/i.test(p.err('loginError')) && p.mock.calls.some(c => c[0] === 'signOut') && p.nav().length === 0,
     'account with no profile is signed out and told to contact the school');

  // ---------- already signed in ----------
  p = await open({ session: { user: rolesUser }, profile: { id: 'u-1', role: 'school_admin', school_id: 's-1' } });
  ok(p.nav().includes('schooladmin.html'), 'already-signed-in visitor skips the form');

  // ---------- registration validation ----------
  p = await open();
  p.w.switchTab(p.d.querySelector('.ff-tab[data-tab="register"]'), 'register');
  ok(p.shown('stepRegister') && !p.shown('stepLogin'), 'Register tab opens the registration form');
  const fillReg = (o = {}) => { const v = { regName: 'Jane Wanjiku', regPhone: '712 345 678', regEmail: 'Jane@Example.com', regPassword: 'longenough1', regPassword2: 'longenough1', regSchool: 's-1', ...o }; for (const k in v) if (k !== 'agree') p.set(k, v[k]); p.d.getElementById('regAgree').checked = o.agree !== false; };
  const tryReg = async (o, re, label) => { fillReg(o); await p.w.registerParent(); await tick(); ok(re.test(p.err('registerError')), label, p.err('registerError')); };
  await tryReg({ regName: 'J' }, /full name/i, 'short name rejected');
  await tryReg({ agree: false }, /Terms of Use/i, 'parent registration needs the terms checkbox');
  await tryReg({ regPhone: '123' }, /phone/i, 'bad phone rejected');
  await tryReg({ regPhone: '612345678' }, /phone/i, 'phone not starting 7/1 rejected');
  await tryReg({ regEmail: 'nope' }, /email/i, 'bad email rejected');
  await tryReg({ regSchool: '' }, /school/i, 'missing school rejected');
  await tryReg({ regPassword: 'short', regPassword2: 'short' }, /8 characters/i, 'short password rejected');
  await tryReg({ regPassword2: 'different12' }, /do not match/i, 'password mismatch rejected');
  ok(!p.mock.calls.some(c => c[0] === 'signUp'), 'nothing sent to the server while the form is invalid');

  // ---------- registration success (email confirmation OFF) ----------
  p = await open({ signUpSession: true, rpc: { register_parent: () => ({ data: 'parent-uuid-1', error: null }) } });
  p.w.switchTab(p.d.querySelector('.ff-tab[data-tab="register"]'), 'register');
  fillReg(); await p.w.registerParent(); await tick();
  const su = p.mock.calls.find(c => c[0] === 'signUp')[1];
  ok(su.email === 'jane@example.com' && su.password === 'longenough1', 'signUp gets lower-cased email + password');
  ok(su.options.data.reg.phone === '254712345678' && su.options.data.reg.school_id === 's-1', 'registration details passed in full international format');
  ok(/portal\.html$/.test(su.options.emailRedirectTo), 'confirmation email links back to portal.html', su.options.emailRedirectTo);
  const rp = p.mock.calls.find(c => c[0] === 'rpc' && c[1] === 'register_parent');
  ok(rp && rp[2].p_phone === '254712345678' && rp[2].p_school_id === 's-1' && rp[2].p_name === 'Jane Wanjiku', 'register_parent RPC called with validated details');
  ok(p.shown('stepAddChildren') && !p.shown('stepRegister'), 'moves to Add Children');

  // ---------- add children ----------
  const kid = async (n, c, a) => { p.set('childName', n); p.set('childClass', c); p.set('childAdm', a); await p.w.addChild(); await tick(); };
  await kid('A', 'Class 4', 'ADM-1'); ok(/full name/i.test(p.err('childError')), 'child: short name rejected');
  await kid('Amani Wanjiku', '', 'ADM-1'); ok(/class/i.test(p.err('childError')), 'child: class required');
  await kid('Amani Wanjiku', 'Class 4', ''); ok(/admission/i.test(p.err('childError')), 'child: admission number required');
  p.mock.client.rpc = async (fn, args) => { p.mock.calls.push(['rpc', fn, args]); return { data: args.p_admission_no === 'ADM-LINKED' ? 'active' : 'pending', error: null }; };
  await kid('Amani Wanjiku', 'Class 4', 'ADM-PENDING');
  const cc = p.mock.calls.find(c => c[0] === 'rpc' && c[1] === 'claim_child');
  ok(cc && cc[2].p_parent_id === 'parent-uuid-1' && cc[2].p_admission_no === 'ADM-PENDING' && cc[2].p_class === 'Class 4', 'claim_child called with parent id, admission no and class');
  ok(/Awaiting school approval/.test(p.d.getElementById('childList').textContent), 'pending child shows "Awaiting school approval"');
  ok(!p.d.getElementById('finishBtn').disabled, 'Finish enabled after adding a child');
  await kid('Baraka Wanjiku', 'Form 1', 'ADM-LINKED');
  ok(/Linked/.test(p.d.getElementById('childList').textContent), 'linked child shows "Linked"');
  ok(p.d.getElementById('childAdm').value === '' && p.d.getElementById('childName').value === '', 'form cleared after adding');
  p.w.finishRegistration(); ok(p.nav().includes('parent.html'), 'Finish goes to the parent dashboard');

  // server-side error surfaces readably
  p.mock.client.rpc = async () => ({ data: null, error: { code: '54000', message: 'Too many pending link requests. Please wait for the school to review them.' } });
  await kid('Chloe Wanjiku', 'Class 2', 'ADM-9'); ok(/Too many pending/.test(p.err('childError')), 'server rule message shown to the parent');

  // ---------- registration: email confirmation ON / duplicates / errors ----------
  p = await open({ signUpSession: false });
  p.w.switchTab(p.d.querySelector('.ff-tab[data-tab="register"]'), 'register'); fillReg(); await p.w.registerParent(); await tick();
  ok(p.shown('stepVerifyReg') && p.d.getElementById('confirmEmailAddress').textContent === 'jane@example.com', 'confirmation-required flow shows "Check your email"');
  ok(!p.mock.calls.some(c => c[0] === 'rpc'), 'no parent row requested until the email is confirmed');

  p = await open({ signUpUser: { id: 'x', email: 'jane@example.com', identities: [] } });
  p.w.switchTab(p.d.querySelector('.ff-tab[data-tab="register"]'), 'register'); fillReg(); await p.w.registerParent(); await tick();
  ok(/already exists/i.test(p.err('registerError')), 'already-registered email detected');

  p = await open({ signUpSession: true, rpc: { register_parent: () => ({ data: null, error: { code: '23505', message: 'A parent account with this phone number or login already exists at this school' } }) } });
  p.w.switchTab(p.d.querySelector('.ff-tab[data-tab="register"]'), 'register'); fillReg(); await p.w.registerParent(); await tick();
  ok(/already exists at this school/.test(p.err('registerError')) && !p.shown('stepAddChildren'), 'duplicate phone at a school is reported, flow stops');

  // ---------- deferred registration (confirmed email, first login) ----------
  const metaUser = { id: 'u-9', email: 'jane@example.com', user_metadata: { reg: { school_id: 's-1', name: 'Jane Wanjiku', phone: '254712345678' } } };
  p = await open({ user: metaUser, profile: null, rpc: { register_parent: () => ({ data: 'parent-uuid-9', error: null }) } });
  p.set('loginEmail', 'jane@example.com'); p.set('loginPassword', 'longenough1'); await p.w.signIn(); await tick();
  ok(p.mock.calls.some(c => c[0] === 'rpc' && c[1] === 'register_parent') && p.shown('stepAddChildren'), 'first login after email confirmation completes registration');
  ok(p.mock.calls.some(c => c[0] === 'updateUser' && c[1].data && c[1].data.reg === null), 'pending-registration metadata cleaned up');

  // ---------- schools list & XSS ----------
  p = await open();
  p.w.switchTab(p.d.querySelector('.ff-tab[data-tab="register"]'), 'register'); p.w.searchSchools('');
  const res = p.d.getElementById('schoolSearchResults');
  ok(res.querySelectorAll('.school-result').length === 2, 'both schools listed');
  ok(!res.querySelector('img'), 'school names are HTML-escaped (no injected <img>)');
  p.w.searchSchools('alpha'); ok(res.querySelectorAll('.school-result').length === 1, 'search filters by name');
  p.w.searchSchools('nairobi'); ok(res.querySelectorAll('.school-result').length === 1, 'search filters by location');
  p.w.selectSchool('s-1'); ok(p.d.getElementById('regSchool').value === 's-1' && p.d.getElementById('schoolSearch').value === 'Alpha Academy', 'selecting a school fills the hidden id');
  p = await open({ schools: [] }); p.w.searchSchools(''); ok(/No schools have been registered/.test(p.d.getElementById('schoolSearchResults').textContent), 'empty platform shows a helpful message');
  p = await open({ schoolsError: { message: 'Failed to fetch' } }); p.w.searchSchools(''); ok(/No internet/.test(p.d.getElementById('schoolSearchResults').textContent), 'network failure shown while loading schools');

  p = await open({ schoolsDelay: 400 }); p.w.switchTab(p.d.querySelector('.ff-tab[data-tab="register"]'), 'register'); p.w.searchSchools('');
  ok(/Loading schools/.test(p.d.getElementById('schoolSearchResults').textContent), 'shows "Loading schools" while the list is still loading');
  await tick(500);
  ok(p.d.getElementById('schoolSearchResults').querySelectorAll('.school-result').length === 2, 'open list refreshes itself when schools arrive');

  // ---------- forgot password ----------
  p = await open(); p.set('loginEmail', ''); await p.w.forgotPassword();
  ok(/email address above/i.test(p.err('loginError')), 'forgot password asks for the email first');
  p.set('loginEmail', 'Jane@Example.com'); await p.w.forgotPassword(); await tick();
  const rc = p.mock.calls.find(c => c[0] === 'reset');
  ok(rc && rc[1] === 'jane@example.com' && /portal\.html$/.test(rc[2].redirectTo), 'reset email requested with redirect back to portal.html');
  ok(p.d.getElementById('loginNotice').style.display === 'flex' && /on its way/.test(p.d.getElementById('loginNoticeText').textContent), 'neutral confirmation (does not reveal whether the account exists)');

  // ---------- password recovery ----------
  p = await open({ hash: '#access_token=abc&type=recovery', session: { user: rolesUser }, user: rolesUser, profile: { id: 'u-1', role: 'parent' } });
  ok(p.shown('stepNewPassword') && !p.shown('stepLogin'), 'recovery link opens the "Set a New Password" step');
  ok(p.nav().length === 0, 'recovery link does not auto-redirect away');
  p.set('newPassword', 'short'); p.set('newPassword2', 'short'); await p.w.updatePassword(); ok(/8 characters/.test(p.err('newPasswordError')), 'new password: length enforced');
  p.set('newPassword', 'brandnewpass1'); p.set('newPassword2', 'different1234'); await p.w.updatePassword(); ok(/do not match/.test(p.err('newPasswordError')), 'new password: confirmation enforced');
  p.set('newPassword2', 'brandnewpass1'); await p.w.updatePassword(); await tick();
  ok(p.mock.calls.some(c => c[0] === 'updateUser' && c[1].password === 'brandnewpass1') && p.nav().includes('parent.html'), 'password updated, then routed to the dashboard');

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
