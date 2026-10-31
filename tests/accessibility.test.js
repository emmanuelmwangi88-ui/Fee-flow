/* Accessibility guards.
 *
 * These are static checks over the page source plus one dynamic check for the toast
 * live region. They exist because screen-reader support is easy to lose by accident:
 * an icon-only button added without a label, or a live region attached to the wrong
 * element, breaks silently and no functional test notices.
 */
const fs = require('fs');
const path = require('path');
const { ok, tick, summary, openPage } = require('./lib');

const ROOT = path.resolve(__dirname, '..');
const PAGES = [
  'portal.html', 'parent.html', 'schooladmin.html', 'superadmin.html',
  'fee-structure-manager.html', 'fee-adjustments.html', 'preview.html', 'index.html'
];
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* Buttons whose only content is an icon need an accessible name, or a screen reader
   announces them as just "button" with no idea what they do. */
function unnamedButtons(html) {
  const out = [];
  const re = /<button[^>]*>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    const body = m[1];
    if (/aria-label|aria-labelledby|title=/.test(tag)) continue;
    const text = body.replace(/<[^>]+>/g, '').trim();
    if (text) continue;
    out.push(tag.trim().slice(0, 90));
  }
  return out;
}

/* Links that are only an icon need a name too. */
function unnamedIconLinks(html) {
  const out = [];
  const re = /<a\b[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    const body = m[1];
    if (/aria-label|aria-labelledby|title=/.test(tag)) continue;
    if (/\bhref=/.test(tag) === false) continue;
    const text = body.replace(/<[^>]+>/g, '').trim();
    if (text) continue;
    out.push(tag.trim().slice(0, 90));
  }
  return out;
}

(async () => {
  for (const page of PAGES) {
    const html = read(page);
    const btns = unnamedButtons(html);
    ok(btns.length === 0, page + ': no icon-only button without an accessible name', btns.join(' | '));

    const links = unnamedIconLinks(html);
    ok(links.length === 0, page + ': no icon-only link without an accessible name', links.join(' | '));

    // a live region must exist before content is inserted, so the container carries it
    if (/id="toastContainer"/.test(html)) {
      const c = /<div class="ff-toasts" id="toastContainer"([^>]*)>/.exec(html);
      ok(!!c && /aria-live="polite"/.test(c[1]) && /role="status"/.test(c[1]),
         page + ': the toast container is a polite live region', c ? c[1] : 'no container');
    }
  }

  // error banners must be assertive: a failed load is not a polite suggestion
  for (const page of PAGES) {
    const html = read(page);
    if (/class="ff-alert (error|warning)"/.test(html) && /id="(levelBanner|ffBanner)"/.test(html)) {
      ok(/id="(levelBanner|ffBanner)"[^>]*role="alert"|role="alert"[^>]*id="(levelBanner|ffBanner)"/.test(html),
         page + ': the status/error banner is announced as an alert');
    }
  }

  // the service worker cache must be versioned so a changed shell evicts the old one
  const sw = read('sw.js');
  const ver = /const VERSION = '([^']+)'/.exec(sw);
  ok(!!ver && ver[1] !== 'feeflow-v1', 'sw.js: the cache version has been bumped past v1', ver && ver[1]);
  ok(/keys\.filter\(k => k !== VERSION\)/.test(sw), 'sw.js: activate deletes caches from older versions');

  // ---------- dynamic: a toast really lands inside the live region ----------
  const p = await openPage('parent.html', {
    wait: 700,
    tables: {
      profiles: [{ id: 'u-p', role: 'parent', school_id: 'sc-1', full_name: 'Jane' }],
      parents: [{ id: 'pa-1', school_id: 'sc-1', full_name: 'Jane', phone: '254712345678' }],
      schools: [{ id: 'sc-1', name: 'Don Bosco Ituru', location: 'Kiambu', paybill: '211211', level: 'Primary Only' }],
      student_balances: [{ id: 's-1', admission_no: 'ADM-1', full_name: 'Amani', class_name: 'Class 4A', boarding: false, active: true, verified: true, guardian_phone: '254712345678', total_due: 40000, paid: 10000, balance: 30000 }],
      payments: [], notifications: [], parent_students: [{ student_id: 's-1', status: 'active' }],
      fee_structure_published: [], terms: []
    }
  });
  p.w.FFUI.toast('Payment received');
  await tick(150);
  const box = p.d.getElementById('toastContainer');
  ok(!!box && box.getAttribute('aria-live') === 'polite' && box.getAttribute('role') === 'status',
     'a toast is appended to a container that is already a live region');
  ok(!!box && /Payment received/.test(box.textContent), 'the toast text is inside that region');
  // nested live regions make screen readers announce twice
  const inner = box && box.querySelector('.toast');
  ok(!inner || !inner.getAttribute('role'), 'the toast itself is not a nested live region');

  // a failed load is announced as an alert, not silently styled red
  const q = await openPage('parent.html', {
    wait: 700,
    tables: {
      profiles: [{ id: 'u-p', role: 'parent', school_id: 'sc-1', full_name: 'Jane' }],
      parents: [], schools: [], student_balances: [], payments: [], notifications: [],
      parent_students: [], fee_structure_published: [], terms: []
    },
    onQuery: { 'parents:select': () => ({ data: null, error: { message: 'Failed to fetch' } }) }
  });
  const alert = q.d.querySelector('#app [role="alert"]');
  ok(!!alert && /No internet/.test(alert.textContent), 'a load failure renders as role="alert"');

  summary();
})();
