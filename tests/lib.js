// Shared test helpers: simulated browser + chainable Supabase mock
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0; const failures = [];
const ok = (cond, label, extra = '') => { cond ? pass++ : (fail++, failures.push(label + ' ' + extra)); console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond ? '' : '  ' + extra)); };
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
const summary = () => { console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); } };

class Loader extends ResourceLoader {
  fetch(url) {
    if (url.includes('/js/vendor/')) return Promise.resolve(Buffer.from(''));
    if (url.startsWith('http://localhost/')) {
      const f = path.join(ROOT, decodeURIComponent(url.replace('http://localhost/', '').split(/[?#]/)[0]));
      return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('404 ' + url));
    }
    return Promise.resolve(Buffer.from(''));
  }
}

function makeMock(o = {}) {
  const calls = []; const st = { session: o.session === undefined ? { user: { id: 'u-1', email: 'feeflowadmin@gmail.com' } } : o.session };
  const auth = {
    getSession: async () => ({ data: { session: st.session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => { calls.push({ kind: 'signOut' }); st.session = null; return { error: null }; },
    updateUser: async (a) => { calls.push({ kind: 'updateUser', a }); return { data: {}, error: (o.updateUserError || null) }; },
  };
  const from = (table) => {
    const q = { table, op: 'select', filters: [], payload: null, opts: null };
    const run = async () => {
      calls.push({ kind: 'query', table: q.table, op: q.op, filters: q.filters.slice(), payload: q.payload, opts: q.opts });
      const h = (o.onQuery || {})[table + ':' + q.op];
      if (h) return h(q);
      if (q.op === 'select') { let rows = (o.tables || {})[table] || []; if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1); return { data: rows, error: null }; }
      return { data: null, error: null };
    };
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      in(k, vals) { q.filters.push([k, vals]); return api; },
      update(p) { q.op = 'update'; q.payload = p; return api; },
      insert(p) { q.op = 'insert'; q.payload = p; return api; },
      delete() { q.op = 'delete'; return api; },
      range(a, b) { q.range = [a, b]; return api; },
      upsert(p, opts) { q.op = 'upsert'; q.payload = p; q.opts = opts; return api; },
      maybeSingle: () => run().then(r => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] || null) : r.data })),
      then: (res, rej) => run().then(res, rej),
    };
    return api;
  };
  const rpc = async (fn, args) => { calls.push({ kind: 'rpc', fn, args }); const h = (o.rpc || {})[fn]; return h ? h(args) : { data: [], error: null }; };
  const channels = [];
  const channel = (name) => { const c = { name, subs: [], on(type, filter, cb) { c.subs.push({ type, filter, cb }); return c; }, subscribe() { return c; } }; channels.push(c); return c; };
  const functions = { invoke: async (name, opts) => { calls.push({ kind: 'fn', name, body: opts && opts.body }); const h = (o.functions || {})[name]; return h ? h(opts.body) : { data: {}, error: null }; } };
  return { client: { auth, from, rpc, functions, channel }, calls, st, channels };
}

async function openPage(page, o = {}) {
  const mock = makeMock(o);
  const errors = []; let navs = 0;
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = e.message.split('\n')[0]; if (/Not implemented: navigation/.test(m)) navs++; else errors.push(m); });
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, page), 'utf8'), { url: 'http://localhost/' + page, runScripts: 'dangerously', resources: new Loader(), virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      if (o.pre) o.pre(w);
      w.supabase = { createClient: () => mock.client };
      w.alert = (m) => { (w.__alerts = w.__alerts || []).push(m); };
      w.confirm = (m) => { (w.__confirms = w.__confirms || []).push(m); return o.confirm !== false; };
      w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
      const RealBlob = w.Blob; w.Blob = function (parts, opts) { w.__csv = parts.join(''); return new RealBlob(parts, opts); };
      w.open = () => ({ document: { write(h) { w.__printed = (w.__printed || '') + h; }, close() {} }, print() { w.__printCalls = (w.__printCalls || 0) + 1; }, focus() {} });
      w.print = () => { w.__winPrint = (w.__winPrint || 0) + 1; };
      w.prompt = (m, d) => { (w.__prompts = w.__prompts || []).push(m); return (o.prompts && o.prompts.length) ? o.prompts.shift() : null; };
    } });
  await tick(o.wait || 120);
  const w = dom.window, d = w.document;
  return { w, d, mock, errors, channels: mock.channels, navs: () => navs, set: (id, v) => { d.getElementById(id).value = v; }, text: (id) => d.getElementById(id).textContent,
           toasts: () => Array.from(d.querySelectorAll('#toastContainer .toast')).map(t => t.textContent.trim()),
           calls: (f) => mock.calls.filter(f) };
}
module.exports = { ok, tick, summary, openPage, ROOT };
