const { ok, tick, summary, openPage } = require('./lib');
(async () => {
  let p = await openPage('portal.html', { session: null, tables: { profiles: [] } });
  ok(p.d.getElementById('ffLang') && /Sign in/.test(p.d.body.textContent) && p.d.documentElement.lang === 'en', 'English by default, toggle present');
  ok(p.w.FFI18N.dictionary['Sign in'] === 'Ingia', 'dictionary loaded');
  // simulate Swahili choice
  p = await openPage('portal.html', { session: null, tables: { profiles: [] }, pre: w => w.localStorage.setItem('ff.lang', 'sw') });
  await tick(300);
  const txt = p.d.body.textContent;
  ok(p.d.documentElement.lang === 'sw' && /Karibu tena/.test(txt) && /Ingia/.test(txt) && !/Welcome back/.test(txt), 'Swahili swaps known phrases');
  ok(p.d.getElementById('ffLang').textContent === 'EN', 'toggle offers English when in Swahili');
  p = await openPage('index.html', { pre: w => w.localStorage.setItem('ff.lang', 'sw') });
  await tick(300);
  ok(/Vipengele/.test(p.d.body.textContent), 'landing page translated');
  summary();
})();
