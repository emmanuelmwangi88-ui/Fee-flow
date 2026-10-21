const { ok, tick, summary, openPage } = require('./lib');
const ADMIN = { id: 'u-1', role: 'school_admin', school_id: 'sc-1', full_name: 'Admin' };
const SCHOOL = { id: 'sc-1', name: 'Don Bosco Ituru', paybill: '211211' };
const fee = (n, a, b = false) => ({ name: n, category: 'Tuition', boarderOnly: b, amounts: a });
const levels = () => [{ name: 'Primary', grades: [{ name: 'Class 4', fees: [fee('Tuition', [10000, 8000, 7000]), fee('Boarding', [5000, 5000, 5000], true)] }, { name: 'Class 5', fees: [] }] },
                      { name: 'Secondary', grades: [{ name: 'Form 1', fees: [fee('Tuition', [20000, 15000, 15000])] }] }];
const base = (extra = {}) => ({ tables: { profiles: [ADMIN], schools: [SCHOOL], fee_structures: [], fee_structure_published: [], student_balances: [], ...extra } });
const q = (p, f) => p.mock.calls.filter(c => c.kind === 'query' && f(c));
const ev = (p, code) => p.w.eval(code);
const fire = (p, type) => p.d.dispatchEvent(new p.w.Event(type, { bubbles: true }));
const unbilledRows = [{ class_name: 'Class 4A', total_fee: 25000, verified: true, active: true }, { class_name: 'Class 9', total_fee: 0, verified: true, active: true }, { class_name: 'Class 9', total_fee: 0, verified: true, active: true }, { class_name: 'Ghost', total_fee: 0, verified: false, active: true }];

(async () => {
  // ---------- access ----------
  let p = await openPage('fee-structure-manager.html', { tables: { profiles: [{ id: 'u-1', role: 'parent' }] } });
  ok(p.navs() >= 1 && !p.d.getElementById('ffPublish'), 'a parent cannot open the Fee Structure Manager');
  p = await openPage('fee-structure-manager.html', { session: null, tables: { profiles: [] } });
  ok(p.navs() >= 1 && !p.d.getElementById('ffPublish'), 'signed-out visitor is bounced to login');

  // ---------- fresh school: blank structure ----------
  p = await openPage('fee-structure-manager.html', base());
  ok(p.errors.length === 0, 'page loads with no script errors', p.errors.join('|'));
  ok(['ffBack', 'ffTerms', 'ffSave', 'ffPublish'].every(id => p.d.getElementById(id)), 'Back / Terms / Save / Publish buttons are present');
  ok(p.d.getElementById('schoolNameInput').value === 'Don Bosco Ituru' && p.d.getElementById('schoolNameInput').readOnly, "school name comes from the database and is read-only");
  ok(!/Riverbend/.test(p.d.documentElement.outerHTML), 'the hard-coded demo school ("Riverbend Academy") is gone');
  ok(ev(p, 'state.levels[0].grades[0].name') === 'PP1' && ev(p, 'state.levels[0].grades[0].fees.length') === 0, 'new school starts with an empty standard grade list');
  ok(/Not published yet/.test(p.text('ffPubInfo')), 'shows "Not published yet"');

  // ---------- existing draft / published ----------
  p = await openPage('fee-structure-manager.html', base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: levels(), activeLevel: 0, activeGrade: {}, activeTerm: 0 }, term_names: ['Term A', 'Term B', 'Term C'], updated_at: '2026-10-01' }] }));
  ok(ev(p, 'state.levels[0].grades[0].name') === 'Class 4' && ev(p, 'TERMS.join("|")') === 'Term A|Term B|Term C', 'saved draft and custom term names are loaded');
  ok(/211211/.test(p.d.querySelector('.doc-footer').textContent) && /admission number/i.test(p.d.querySelector('.doc-footer').textContent), 'preview footer uses the real paybill and the learner admission number');
  ok(/Class 4/.test(p.text('gradeRail')) && /Class 5/.test(p.text('gradeRail')), 'grade rail shows the saved grades');
  p = await openPage('fee-structure-manager.html', base({ fee_structure_published: [{ school_id: 'sc-1', data: { levels: levels() }, term_names: ['T1', 'T2', 'T3'], published_at: '2026-10-10T08:00:00Z' }] }));
  ok(ev(p, 'state.levels[1].grades[0].name') === 'Form 1' && /Last published 10 Oct 2026/.test(p.text('ffPubInfo')), 'with no draft, editing starts from the published structure');
  p = await openPage('fee-structure-manager.html', base({ schools: [{ id: 'sc-1', name: '<img src=x onerror=alert(1)>School', paybill: null }], fee_structures: [{ school_id: 'sc-1', draft: { levels: levels() }, term_names: ['T1', 'T2', 'T3'] }] }));
  ok(!p.d.querySelector('.doc img, #previewCol img') && /Not configured/.test(p.d.querySelector('.doc-footer').textContent), 'school name is escaped in the preview; missing paybill says "Not configured"');

  // ---------- autosave + clean payload ----------
  p = await openPage('fee-structure-manager.html', base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: levels() }, term_names: ['Term 1', 'Term 2', 'Term 3'] }] }));
  ev(p, "state.levels[0].grades[1].fees.push({name:'  Lunch  ', category:'Lunch / Meals', boarderOnly:false, amounts:['2500','', 'abc']})");
  fire(p, 'input'); await tick(1000);
  let up = q(p, c => c.op === 'upsert' && c.table === 'fee_structures');
  ok(up.length === 1, 'autosave sends ONE upsert after typing stops', String(up.length));
  const d = up[0] && up[0].payload;
  ok(d && d.school_id === 'sc-1' && up[0].opts.onConflict === 'school_id' && d.updated_by === 'u-1' && d.term_names.length === 3, 'draft saved against this school only');
  const lunch = d && d.draft.levels[0].grades[1].fees[0];
  ok(lunch && lunch.name === 'Lunch' && JSON.stringify(lunch.amounts) === '[2500,0,0]', 'saved fees are cleaned: names trimmed, amounts become numbers, junk becomes 0', JSON.stringify(lunch));
  ok(d && d.draft.schoolName === 'Don Bosco Ituru', 'school name stored from the database, not from the input');
  fire(p, 'input'); fire(p, 'input'); fire(p, 'input'); await tick(1000);
  ok(q(p, c => c.op === 'upsert' && c.table === 'fee_structures').length === 2, 'rapid typing is debounced (3 events -> 1 more save)');
  ev(p, "state.levels[0].grades[0].fees[0].amounts[0] = 12345"); fire(p, 'input');
  const ev2 = new p.w.Event('beforeunload', { cancelable: true }); p.w.dispatchEvent(ev2);
  ok(ev2.defaultPrevented, 'leaving with unsaved changes asks for confirmation');
  await tick(1000);
  const ev3 = new p.w.Event('beforeunload', { cancelable: true }); p.w.dispatchEvent(ev3);
  ok(!ev3.defaultPrevented, 'no warning once everything is saved');

  // ---------- Save Draft button ----------
  p = await openPage('fee-structure-manager.html', base());
  p.d.getElementById('ffSave').click(); await tick(); ok(q(p, c => c.op === 'upsert' && c.table === 'fee_structures').length === 1 && /Draft saved/.test(p.text('ffStatus')), 'Save Draft saves immediately');
  p = await openPage('fee-structure-manager.html', { ...base(), onQuery: { 'fee_structures:upsert': () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  p.d.getElementById('ffSave').click(); await tick(); ok(/Could not save: No internet/.test(p.text('ffStatus')), 'save failure is reported');

  // ---------- term names ----------
  p = await openPage('fee-structure-manager.html', { ...base(), prompts: ['Opening Term', 'Middle Term', 'Closing Term'] });
  p.d.getElementById('ffTerms').click(); await tick(1000);
  ok(ev(p, 'TERMS.join("|")') === 'Opening Term|Middle Term|Closing Term', 'term names can be edited');
  up = q(p, c => c.op === 'upsert' && c.table === 'fee_structures'); ok(up.length >= 1 && up[up.length - 1].payload.term_names[0] === 'Opening Term', 'new term names are saved');
  p = await openPage('fee-structure-manager.html', { ...base(), prompts: ['A', '', 'C'] });
  p.d.getElementById('ffTerms').click(); await tick(); ok(ev(p, 'TERMS.join("|")') === 'Term 1|Term 2|Term 3', 'a blank term name cancels the edit');

  // ---------- grade rail ----------
  p = await openPage('fee-structure-manager.html', { ...base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: levels() }, term_names: ['T1', 'T2', 'T3'] }] }), prompts: ['Class 9'] });
  p.d.querySelector('.add-grade-btn').click(); ok(ev(p, 'state.levels[0].grades.length') === 3 && ev(p, 'state.levels[0].grades[2].name') === 'Class 9' && ev(p, 'state.levels[0].grades[2].fees.length') === 0, 'add grade creates an empty grade');
  p.mock.calls.length = 0; p.w.prompt = () => 'class 9'; p.d.querySelector('.add-grade-btn').click(); ok(/already exists/.test(p.w.__alerts.pop()) && ev(p, 'state.levels[0].grades.length') === 3, 'duplicate grade name rejected');
  p.w.prompt = () => 'Class 4A'; p.d.querySelectorAll('.grade-del')[0].click(); ok(ev(p, 'state.levels[0].grades[0].name') === 'Class 4A', 'rename grade');
  p.d.querySelectorAll('.grade-del')[3 - 1 + 0 + 0 + 1 - 1 + 1 - 1].click();           // delete (every 2nd button) - exercised below
  p = await openPage('fee-structure-manager.html', { ...base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: levels() }, term_names: ['T1', 'T2', 'T3'] }] }), confirm: true });
  const dels = [...p.d.querySelectorAll('.grade-del')].filter(b => b.textContent === '✕'); dels[1].click();
  ok(ev(p, 'state.levels[0].grades.length') === 1 && /Delete Class 5/.test(p.w.__confirms[0]), 'delete grade asks first, then removes it');
  p.d.querySelectorAll('.grade-del')[1].click(); ok(/At least one grade/.test(p.w.__alerts.pop()) && ev(p, 'state.levels[0].grades.length') === 1, 'the last grade in a level cannot be deleted');

  // ---------- publish: validation ----------
  p = await openPage('fee-structure-manager.html', base());
  p.d.getElementById('ffPublish').click(); await tick();
  ok(/at least one fee item/i.test(p.w.__alerts.pop()) && !q(p, c => c.op !== 'select' && c.table === 'fee_structure_published').length, 'cannot publish an empty structure');
  p = await openPage('fee-structure-manager.html', base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: [{ name: 'Primary', grades: [{ name: 'Class 4', fees: [fee('T', [1, 1, 1])] }, { name: 'Grade 4B', fees: [] }] }] }, term_names: ['T1', 'T2', 'T3'] }] }));
  p.d.getElementById('ffPublish').click(); await tick();
  ok(/same grade/i.test(p.w.__alerts.pop()), 'grades that would match the same students (Class 4 / Grade 4B) are rejected');
  p = await openPage('fee-structure-manager.html', base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: [{ name: 'Primary', grades: [{ name: 'Class 4', fees: [fee('  ', [1, 1, 1])] }] }] }, term_names: ['T1', 'T2', 'T3'] }] }));
  p.d.getElementById('ffPublish').click(); await tick(); ok(/has no name/i.test(p.w.__alerts.pop()), 'a fee item without a name is rejected');
  p = await openPage('fee-structure-manager.html', base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: levels() }, term_names: ['T1', 'T2', 'T3'] }] }));
  ev(p, "state.levels[0].grades[0].fees[0].amounts[0] = 99999999999"); p.d.getElementById('ffPublish').click(); await tick();
  ok(/0 and 10,000,000/.test(p.w.__alerts.pop()), 'absurd amounts are rejected');

  // ---------- publish: success ----------
  const ready = () => base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: levels() }, term_names: ['Term 1', 'Term 2', 'Term 3'] }], student_balances: unbilledRows });
  p = await openPage('fee-structure-manager.html', { ...ready(), confirm: false });
  p.d.getElementById('ffPublish').click(); await tick(); ok(/Publish this fee structure/.test(p.w.__confirms[0]) && !q(p, c => c.op !== 'select' && c.table === 'fee_structure_published').length, 'publishing asks for confirmation; declining publishes nothing');
  p = await openPage('fee-structure-manager.html', ready());
  p.d.getElementById('ffPublish').click(); await tick(150);
  const order = p.mock.calls.filter(c => c.kind === 'query' && c.op === 'upsert').map(c => c.table);
  ok(order[0] === 'fee_structures' && order[1] === 'fee_structure_published', 'draft is saved first, then published', order.join(' -> '));
  const pub = q(p, c => c.op === 'upsert' && c.table === 'fee_structure_published')[0];
  ok(pub && pub.payload.school_id === 'sc-1' && pub.payload.published_by === 'u-1' && pub.opts.onConflict === 'school_id' && pub.payload.term_names.length === 3, 'published for this school, by this admin');
  ok(pub && Array.isArray(pub.payload.data.levels) && pub.payload.data.levels[0].grades[0].name === 'Class 4' && pub.payload.data.paybill === '211211' && !('activeLevel' in pub.payload.data), 'published data contains only the fee structure (no editor state)');
  ok(!JSON.stringify(pub.payload).includes('total_fee') && !q(p, c => c.table === 'students' && c.op !== 'select').length, 'browser never writes student totals (the database recalculates them)');
  const al = p.w.__alerts.pop();
  ok(/1 student\(s\) now have fees/.test(al) && /2 student\(s\) have no fee/.test(al) && /Class 9/.test(al) && !/Ghost/.test(al), 'after publishing: reports which classes did not match a grade (ignores unverified students)', al);
  ok(/Last published/.test(p.text('ffPubInfo')) && !p.d.getElementById('ffPublish').disabled, 'published-date shown; button re-enabled');
  p = await openPage('fee-structure-manager.html', base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: levels() }, term_names: ['T1', 'T2', 'T3'] }], student_balances: [{ class_name: 'Class 4A', total_fee: 25000, verified: true, active: true }] }));
  p.d.getElementById('ffPublish').click(); await tick(150); ok(/Published\. 1 student/.test(p.text('ffStatus')) && !p.w.__alerts, 'when every student matches there is no warning popup');

  // ---------- publish: failures ----------
  p = await openPage('fee-structure-manager.html', { ...ready(), onQuery: { 'fee_structure_published:upsert': () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }) } });
  p.d.getElementById('ffPublish').click(); await tick(150); ok(/Publish failed: You do not have permission/.test(p.text('ffStatus')) && !p.d.getElementById('ffPublish').disabled, 'publish permission error shown; button recovers');
  p = await openPage('fee-structure-manager.html', { ...ready(), onQuery: { 'fee_structures:upsert': () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  p.d.getElementById('ffPublish').click(); await tick(150); ok(!q(p, c => c.op !== 'select' && c.table === 'fee_structure_published').length && /Publish failed/.test(p.text('ffStatus')), 'if the draft cannot be saved, nothing is published');

  // ---------- load failure must never overwrite saved work ----------
  p = await openPage('fee-structure-manager.html', { ...ready(), onQuery: { 'fee_structures:select': () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  ok(p.d.getElementById('ffBanner') && /No internet/.test(p.d.getElementById('ffBanner').textContent) && /not overwritten/.test(p.d.getElementById('ffBanner').textContent), 'load failure shows a banner explaining saving is off');
  fire(p, 'input'); await tick(1000); p.d.getElementById('ffSave').click(); await tick();
  ok(!q(p, c => c.op === 'upsert').length, 'autosave and Save Draft do NOT run after a failed load (saved draft cannot be overwritten)');
  ok(/Not saved/.test(p.text('ffStatus')), 'Save Draft says why nothing was saved');
  p.d.getElementById('ffPublish').click(); await tick(); ok(/Cannot publish/.test(p.text('ffStatus')) && !q(p, c => c.op !== 'select' && c.table === 'fee_structure_published').length, 'publishing is blocked after a failed load');

  summary();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
