/* School self-registration: a school signs itself up on portal.html, THEN logs in.
 * This is the flow that replaces "only the Super Admin can create a school".
 * The browser calls supabase.auth.signUp() and then the public.register_school RPC
 * (see supabase/migrations/20261029_0011_school_self_registration.sql). */
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0; const failures = [];
const ok = (cond, label, extra = '') => { cond ? pass++ : (fail++, failures.push(label + ' ' + extra)); console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond ? '' : '  ' + extra)); };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

class Loader extends ResourceLoader {
  fetch(url) {
    if (url.includes('/js/vendor/')) return Promise.resolve(Buffer.from(''));
    if (url.startsWith('http://localhost/')) {
      const f = path.join(ROOT, decodeURIComponent(url.replace('http://localhost/', '')).split(/[?#]/)[0]);
      return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('404 ' + url));
    }
    return Promise.resolve(Buffer.from(''));
  }
}

function makeMock(o = {}) {
  const calls = [];
  const st = { session: o.session || null, profile: o.profile || null };
  const auth = {
    getSession: async () => ({ data: { session: st.session } }),
    onAuthStateChange: (cb) => { st.listener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    signUp: async (a) => {
      calls.push(['signUp', a]);
      if (o.signUpError) return { data: {}, error: o.signUpError };
      const user = o.signUpUser || { id: 'u-new', email: a.email, identities: [{}] };
      if (o.signUpSession) st.session = { user };
      return { data: { user, session: o.signUpSession ? st.session : null }, error: null };
    },
    signOut: async () => { calls.push(['signOut']); st.session = null; return { error: null }; },
    updateUser: async (a) => { calls.push(['updateUser', a]); return { data: {}, error: null }; },
    resetPasswordForEmail: async (e) => { calls.push(['reset', e]); return { error: null }; },
  };
  const from = (table) => { const q = { table }; const api = {
    select() { return api; }, order() { return api; }, eq() { return api; }, limit() { return api; },
    maybeSingle: async () => ({ data: table === 'profiles' ? st.profile : null, error: null }),
    then: (res, rej) => Promise.resolve({ data: table === 'profiles' ? st.profile : null, error: null }).then(res, rej) }; return api; };
  const rpc = async (fn, args) => { calls.push(['rpc', fn, args]); const h = (o.rpc || {})[fn]; return h ? h(args) : { data: 'school-uuid-1', error: null }; };
  return { client: { auth, from, rpc }, calls, st };
}

async function open(o = {}) {
  const mock = makeMock(o);
  let html = fs.readFileSync(path.join(ROOT, 'portal.html'), 'utf8');
  html = html.replace('function go(url) { location.replace(url); }', "function go(url) { (window.__nav = window.__nav || []).push(url); }");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message.split('\n')[0]));
  const dom = new JSDOM(html, { url: 'http://localhost/portal.html', runScripts: 'dangerously', resources: new Loader(), virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) { w.supabase = { createClient: () => mock.client }; w.alert = m => (w.__alerts = w.__alerts || []).push(m); } });
  await tick(60);
  const w = dom.window, d = w.document;
  const set = (id, v) => { d.getElementById(id).value = v; };
  const shown = (id) => d.getElementById(id).style.display !== 'none';
  const err = (id) => { const e = d.getElementById(id); return e.classList.contains('show') ? d.getElementById(id + 'Text').textContent : ''; };
  return { w, d, mock, errors, set, shown, err, nav: () => w.__nav || [] };
}

const FIELDS = { regSchoolName: 'Don Bosco Ituru', regSchoolLocation: 'Gatundu, Kiambu', regSchoolPhone: '0712345678',
  regSchoolPaybill: '211211', regSchoolAdminName: 'Mary Njeri', regSchoolEmail: 'admin@donbosco.ac.ke',
  regSchoolPassword: 'longenough1', regSchoolPassword2: 'longenough1' };

(async () => {
  // ---------- getting there ----------
  let p = await open();
  ok(!p.shown('stepSchool'), 'the school form starts hidden behind the sign-in step');
  p.d.querySelector('.ff-tab[data-tab="school"]').click();
  ok(p.shown('stepSchool'), 'the "School" tab opens the school registration form');
  ok(p.d.querySelectorAll('#levelCards .ff-level-card').length === 3, 'the school type picker offers primary / secondary / both');
  p.d.querySelector('#levelCards .ff-level-card[data-level="Secondary Only"]').click();
  ok(p.d.querySelector('#levelCards .ff-level-card[data-level="Secondary Only"]').classList.contains('sel')
     && p.d.querySelectorAll('#levelCards .ff-level-card.sel').length === 1, 'choosing "Secondary school" records the level');

  // click a level card instead of poking at the script's variable
  const pickLevel = (pg, level) => { pg.d.querySelector('#levelCards .ff-level-card[data-level="' + level + '"]').click(); };

  // ---------- validation happens in the browser, before any request ----------
  const fill = (over = {}) => Object.entries({ ...FIELDS, ...over }).forEach(([k, v]) => p.set(k, v));
  p = await open(); p.d.querySelector('.ff-tab[data-tab="school"]').click(); fill({ regSchoolName: 'D' });
  await p.w.registerSchool();
  ok(/school name/i.test(p.err('registerSchoolError')) && !p.mock.calls.some(c => c[0] === 'signUp'), 'a too-short school name is rejected without contacting the server');

  p = await open(); p.d.querySelector('.ff-tab[data-tab="school"]').click(); fill();
  await p.w.registerSchool();
  ok(/what kind of school/i.test(p.err('registerSchoolError')) && !p.mock.calls.some(c => c[0] === 'signUp'), 'the school type is required');

  p = await open(); p.d.querySelector('.ff-tab[data-tab="school"]').click(); fill({ regSchoolPaybill: '12' });
  pickLevel(p, 'Primary Only');
  await p.w.registerSchool();
  ok(/paybill/i.test(p.err('registerSchoolError')) && !p.mock.calls.some(c => c[0] === 'signUp'), 'a bad paybill number is rejected');

  p = await open(); p.d.querySelector('.ff-tab[data-tab="school"]').click(); fill({ regSchoolPhone: '12345' });
  pickLevel(p, 'Primary Only');
  await p.w.registerSchool();
  ok(/phone/i.test(p.err('registerSchoolError')) && !p.mock.calls.some(c => c[0] === 'signUp'), 'a bad school phone number is rejected');

  p = await open(); p.d.querySelector('.ff-tab[data-tab="school"]').click(); fill({ regSchoolPassword2: 'different1' });
  pickLevel(p, 'Primary Only');
  await p.w.registerSchool();
  ok(/do not match/i.test(p.err('registerSchoolError')) && !p.mock.calls.some(c => c[0] === 'signUp'), 'mismatched passwords are rejected');

  p = await open(); p.d.querySelector('.ff-tab[data-tab="school"]').click(); fill({ regSchoolPassword: 'short', regSchoolPassword2: 'short' });
  pickLevel(p, 'Primary Only');
  await p.w.registerSchool();
  ok(/8 characters/i.test(p.err('registerSchoolError')) && !p.mock.calls.some(c => c[0] === 'signUp'), 'a short password is rejected');

  // ---------- the happy path: signUp, then register_school, then straight into the dashboard ----------
  p = await open({ signUpSession: true, rpc: { register_school: () => ({ data: 'school-uuid-1', error: null }) } });
  p.d.querySelector('.ff-tab[data-tab="school"]').click();
  pickLevel(p, 'Primary & Secondary');
  fill();
  await p.w.registerSchool(); await tick(80);

  const su = p.mock.calls.find(c => c[0] === 'signUp');
  ok(!!su && su[1].email === 'admin@donbosco.ac.ke' && su[1].password === 'longenough1', 'the school signs up with its own email and password');
  const reg = su && su[1].options && su[1].options.data && su[1].options.data.reg;
  ok(reg && reg.kind === 'school' && reg.name === 'Don Bosco Ituru' && reg.level === 'Primary & Secondary'
     && reg.paybill === '211211' && reg.admin_name === 'Mary Njeri' && reg.phone === '254712345678',
     'the school details travel in the sign-up metadata (level, paybill, administrator)', JSON.stringify(reg));
  ok(su && su[1].options.data.full_name === 'Mary Njeri', 'the administrator name is stored as the account full name');

  const rpc = p.mock.calls.find(c => c[0] === 'rpc');
  ok(!!rpc && rpc[1] === 'register_school', 'the school is created through the register_school RPC, not the super-admin edge function');
  ok(rpc && rpc[2].p_name === 'Don Bosco Ituru' && rpc[2].p_level === 'Primary & Secondary'
     && rpc[2].p_paybill === '211211' && rpc[2].p_admin_name === 'Mary Njeri' && rpc[2].p_phone === '254712345678'
     && rpc[2].p_location === 'Gatundu, Kiambu', 'the RPC gets every detail the school typed', JSON.stringify(rpc && rpc[2]));
  ok(!p.mock.calls.some(c => c[0] === 'rpc' && c[1] === 'register_parent'), 'the parent RPC is never used for a school');
  ok(p.nav().includes('schooladmin.html'), 'after registering, the school lands in its own dashboard');

  // ---------- email confirmation turned on: wait for the link, then finish ----------
  p = await open({ signUpSession: false, rpc: { register_school: () => ({ data: 'school-uuid-1', error: null }) } });
  p.d.querySelector('.ff-tab[data-tab="school"]').click();
  pickLevel(p, 'Secondary Only');
  fill();
  await p.w.registerSchool(); await tick(80);
  ok(p.shown('stepVerifyReg') && /admin@donbosco\.ac\.ke/.test(p.d.getElementById('confirmEmailAddress').textContent),
     'with email confirmation on, the school is told to check its email before signing in');
  ok(!p.mock.calls.some(c => c[0] === 'rpc'), 'nothing is created before the email address is confirmed');
  ok(!p.nav().length, 'and the school is not signed in yet');

  // signing in after confirming finishes the job
  p.mock.st.session = { user: { id: 'u-new', email: 'admin@donbosco.ac.ke', user_metadata: { reg: { kind: 'school', name: 'Don Bosco Ituru', level: 'Secondary Only', paybill: '211211', admin_name: 'Mary Njeri', phone: '254712345678' } } } };
  await p.w.routeAfterLogin(p.mock.st.session.user); await tick(80);
  const rpc2 = p.mock.calls.filter(c => c[0] === 'rpc' && c[1] === 'register_school');
  ok(rpc2.length === 1 && rpc2[0][2].p_level === 'Secondary Only', 'signing in after confirming completes the registration');
  ok(p.nav().includes('schooladmin.html'), 'and the school reaches its dashboard');

  // ---------- failures are explained, not swallowed ----------
  p = await open({ signUpSession: true, rpc: { register_school: () => ({ data: null, error: { code: '23505', message: 'A school with these details already exists' } }) } });
  p.d.querySelector('.ff-tab[data-tab="school"]').click();
  p.d.querySelector('#levelCards .ff-level-card[data-level="Primary Only"]').click();
  fill();
  await p.w.registerSchool(); await tick(80);
  ok(/already exists/i.test(p.err('registerSchoolError')), 'a duplicate school is reported to the school, not hidden');

  p = await open({ signUpError: { message: 'User already registered' } });
  p.d.querySelector('.ff-tab[data-tab="school"]').click();
  p.d.querySelector('#levelCards .ff-level-card[data-level="Primary Only"]').click();
  fill();
  await p.w.registerSchool(); await tick(60);
  ok(p.err('registerSchoolError').length > 0, 'a failed sign-up is reported');
  ok(!p.mock.calls.some(c => c[0] === 'rpc'), 'and no school is created when the sign-up fails');

  // an email that is already taken comes back as a user with no identities
  p = await open({ signUpUser: { id: 'x', email: 'admin@donbosco.ac.ke', identities: [] } });
  p.d.querySelector('.ff-tab[data-tab="school"]').click();
  p.d.querySelector('#levelCards .ff-level-card[data-level="Primary Only"]').click();
  fill();
  await p.w.registerSchool(); await tick(60);
  ok(/already exists|sign in/i.test(p.err('registerSchoolError')), 'an email that is already registered is explained');

  // ---------- the migration behind the button ----------
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261029_0011_school_self_registration.sql'), 'utf8');
  ok(/create or replace function public\.register_school\(/.test(sql), 'the migration creates public.register_school');
  ok(/security definer/.test(sql), 'register_school is SECURITY DEFINER (RLS blocks ordinary inserts into schools)');
  ok(/auth\.uid\(\)/.test(sql), 'and it only ever acts for the signed-in caller');
  ok(/grant execute on function public\.register_school\([^)]*\) to authenticated/.test(sql), 'authenticated users may call it');
  ok(/revoke execute on function public\.register_school\([^)]*\) from public, anon/.test(sql), 'anonymous visitors may not');
  ok(/insert into public\.profiles[^;]*'school_admin'/.test(sql), 'it makes the caller the school_admin of the new school');
  ok(/insert into public\.terms/.test(sql), 'it seeds the school year\'s terms');
  ok(/insert into public\.notifications/.test(sql), 'it welcomes the school with a notification');
  ok(!/anon\b.*grant execute on function public\.register_school/.test(sql), 'no anonymous grant slipped in');

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
