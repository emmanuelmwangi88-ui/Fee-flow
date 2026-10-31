const { ok, tick, summary, openPage } = require('./lib');
const ADMIN = { id: 'u-1', role: 'school_admin', school_id: 'sc-1', full_name: 'Admin' };
const school = (level = 'Primary & Secondary', extra = {}) => ({ id: 'sc-1', name: 'Don Bosco Ituru', paybill: '211211', level, status: 'active', ...extra });
const fee = (n, a, b = false) => ({ name: n, category: 'Tuition', boarderOnly: b, amounts: a });
const levels = () => [{ name: 'Primary', grades: [{ name: 'Class 4', fees: [fee('Tuition', [10000, 8000, 7000]), fee('Boarding', [5000, 5000, 5000], true)] }, { name: 'Class 5', fees: [] }] },
                      { name: 'Secondary', grades: [{ name: 'Form 1', fees: [fee('Tuition', [20000, 15000, 15000])] }] }];
const base = (extra = {}, lvl) => ({ tables: { profiles: [ADMIN], schools: [school(lvl)], fee_structures: [], fee_structure_published: [], student_balances: [], ...extra } });
const draftOf = (lv = levels(), tn = ['Term 1', 'Term 2', 'Term 3']) => ({ fee_structures: [{ school_id: 'sc-1', draft: { levels: lv }, term_names: tn }] });
const q = (p, f) => p.mock.calls.filter(c => c.kind === 'query' && f(c));
const ev = (p, code) => p.w.eval(code);
const st = (p) => p.w.FM.state;
const names = (p) => st(p).levels.map(l => l.name + ':' + l.grades.map(g => g.name).join(','));
const change = (p, el, v) => { if (v !== undefined) el.value = v; el.dispatchEvent(new p.w.Event('input', { bubbles: true })); el.dispatchEvent(new p.w.Event('change', { bubbles: true })); };
const unbilledRows = [{ class_name: 'Class 4A', total_fee: 25000, verified: true, active: true }, { class_name: 'Class 9', total_fee: 0, verified: true, active: true }, { class_name: 'Class 9', total_fee: 0, verified: true, active: true }, { class_name: 'Ghost', total_fee: 0, verified: false, active: true }];

(async () => {
  // ---------- access ----------
  let p = await openPage('fee-structure-manager.html', { tables: { profiles: [{ id: 'u-1', role: 'parent' }] } });
  ok(p.navs() >= 1 && !p.d.getElementById('gradeRail').children.length, 'a parent cannot open the Fee Structure Manager');
  p = await openPage('fee-structure-manager.html', { session: null, tables: { profiles: [] } });
  ok(p.navs() >= 1 && !p.d.getElementById('gradeRail').children.length, 'signed-out visitor is bounced to login');

  // ---------- the structure follows the school type ----------
  p = await openPage('fee-structure-manager.html', base({}, 'Primary Only'));
  ok(p.errors.length === 0, 'page loads with no script errors', p.errors.join('|'));
  ok(names(p).join(' ') === 'Pre-Primary:PP1,PP2 Lower Primary:Grade 1,Grade 2,Grade 3 Upper Primary:Grade 4,Grade 5,Grade 6', 'a primary school starts with PP1 to Grade 6 only', names(p).join(' '));
  ok(!/Form 1|Grade 10/.test(p.d.body.textContent), 'a primary school never sees secondary grades');
  ok(p.d.querySelector('[data-add="junior"]'), 'a primary school can add Junior School (Grade 7-9)');
  ok(/primary school/i.test(p.text('schoolType')) && /Let's set up fees/.test(p.text('setupBox')), 'shows the school type and a first-time setup note');
  p = await openPage('fee-structure-manager.html', base({}, 'Secondary Only'));
  ok(names(p).join(' ') === 'Junior School:Grade 7,Grade 8,Grade 9 Senior School:Grade 10,Grade 11,Grade 12', 'a secondary school starts with Grade 7-12', names(p).join(' '));
  ok(!/PP1|Grade 1,/.test(names(p).join(' ')) && p.d.querySelector('[data-add="legacy"]'), 'no primary grades for a secondary school; the 8-4-4 Form 1-4 can be added');
  p.d.querySelector('[data-add="legacy"]').click();
  ok(names(p).pop() === 'Secondary (8-4-4):Form 1,Form 2,Form 3,Form 4', 'adding 8-4-4 creates Form 1 to Form 4');
  p = await openPage('fee-structure-manager.html', base({}, 'Primary & Secondary'));
  ok(st(p).levels.length === 5 && st(p).levels[0].grades[0].name === 'PP1' && st(p).levels[4].grades[2].name === 'Grade 12', 'a combined school gets every section');
  const g = st(p).levels[2].grades[0];
  ok(g.fees.some(f => f.name === 'Tuition') && g.fees.every(f => f.amounts.every(a => a === 0)), 'starter fee items are suggested but no amounts are ever guessed');
  ok(!st(p).levels[0].grades[0].fees.some(f => f.boarderOnly) && st(p).levels[2].grades[0].fees.some(f => f.boarderOnly), 'boarding is not suggested for pre-primary but is for upper primary');

  // ---------- existing draft / published ----------
  p = await openPage('fee-structure-manager.html', base(draftOf(levels(), ['Term A', 'Term B', 'Term C'])));
  ok(st(p).levels[0].grades[0].name === 'Class 4' && p.w.FM.TERMS.join('|') === 'Term A|Term B|Term C', 'saved draft and custom term names are loaded');
  ok(!/Let's set up/.test(p.text('setupBox')), 'no first-time note once a draft exists');
  ok(/211211/.test(p.d.querySelector('.doc-footer').textContent) && /admission number/i.test(p.d.querySelector('.doc-footer').textContent), 'preview footer uses the real paybill and the admission number');
  ok(/Class 4/.test(p.text('gradeRail')) && /Class 5/.test(p.text('gradeRail')), 'grade rail shows the saved grades');
  p = await openPage('fee-structure-manager.html', base({ fee_structure_published: [{ school_id: 'sc-1', data: { levels: levels() }, term_names: ['T1', 'T2', 'T3'], published_at: '2026-10-10T08:00:00Z' }] }));
  ok(st(p).levels[1].grades[0].name === 'Form 1' && /Last published 10 Oct 2026/.test(p.text('ffPubInfo')), 'with no draft, editing starts from the published structure');
  p = await openPage('fee-structure-manager.html', { tables: { profiles: [ADMIN], schools: [school('Primary Only', { name: '<img src=x onerror=alert(1)>School', paybill: null })], ...draftOf(), fee_structure_published: [], student_balances: [] } });
  ok(!p.d.querySelector('.doc img, #schoolTitle img') && /Not configured/.test(p.d.querySelector('.doc-footer').textContent), 'school name is escaped; a missing paybill says "Not configured"');
  p = await openPage('fee-structure-manager.html', { tables: { profiles: [ADMIN], schools: [school('Primary Only', { status: 'pending' })], ...draftOf(), fee_structure_published: [], student_balances: [] } });
  ok(p.d.getElementById('ffInactive'), 'a school still awaiting approval is told parents cannot see fees yet');

  // ---------- totals: day scholar vs boarder ----------
  p = await openPage('fee-structure-manager.html', base(draftOf()));
  ok(/25,000/.test(p.text('totDay')) && /40,000/.test(p.text('totBoard')), 'day scholar year total 25,000 and boarder 40,000');
  ok(/Boarder/.test(p.text('previewCol')) && /\(boarders\)/.test(p.text('previewCol')), 'preview shows the boarder line only when there are boarding fees');
  const amt = p.d.querySelector('input[data-f="amt"][data-t="0"]'); change(p, amt, '12,000');
  ok(st(p).levels[0].grades[0].fees[0].amounts[0] === '12000' && /27,000/.test(p.text('totDay')), 'typing an amount updates totals instantly (commas ignored)');
  ok(p.d.activeElement !== null && p.d.querySelector('input[data-f="amt"][data-t="0"]') === amt, 'typing does not rebuild the table (cursor keeps its place)');
  const flag = p.d.querySelectorAll('input[data-f="board"]')[1]; flag.checked = false; change(p, flag);
  ok(st(p).levels[0].grades[0].fees[1].boarderOnly === false && /42,000/.test(p.text('totDay')), 'un-ticking "boarders only" adds the fee to the day scholar total');

  // ---------- class names vs students ----------
  p = await openPage('fee-structure-manager.html', base({ ...draftOf(), student_balances: unbilledRows }));
  ok(p.d.getElementById('ffClassWarn') && /Class 9/.test(p.text('ffClassWarn')) && !/Class 4A/.test(p.text('ffClassWarn')) && !/Ghost/.test(p.text('ffClassWarn')), 'warns about student classes that have no matching grade (ignores matches and unverified students)');

  // ---------- adding / editing items and grades ----------
  p = await openPage('fee-structure-manager.html', base(draftOf()));
  p.d.querySelectorAll('.grade-item')[1].click();                       // Class 5: no fees
  ok(/No fee items/.test(p.text('editorCol')), 'an empty grade says so');
  const sel = p.d.getElementById('presetSel'); sel.value = '0'; sel.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  ok(st(p).levels[0].grades[1].fees.length === 1 && st(p).levels[0].grades[1].fees[0].amounts.join() === '0,0,0', 'a typical fee item can be added from the list');
  p.d.getElementById('addCustomBtn').click();
  ok(st(p).levels[0].grades[1].fees.length === 2 && st(p).levels[0].grades[1].fees[1].name === '', 'a custom fee item can be added');
  p.w.confirm = () => true; p.d.querySelector('button[data-del="1"]').click();
  ok(st(p).levels[0].grades[1].fees.length === 1, 'a fee item can be removed');
  p.w.prompt = () => 'Class 9'; p.d.getElementById('addGradeBtn').click();
  ok(st(p).levels[0].grades.length === 3 && st(p).levels[0].grades[2].name === 'Class 9' && st(p).levels[0].grades[2].fees.length === 1, 'a new grade starts from the current items with zero amounts');
  ok(st(p).levels[0].grades[2].fees.every(f => f.amounts.every(a => a === 0)), 'copied items for a new grade carry no amounts');
  p.w.prompt = () => 'Grade 9A'; p.d.getElementById('addGradeBtn').click(); ok(/already exists/.test(p.w.__alerts.pop()) && st(p).levels[0].grades.length === 3, 'duplicate grade (ignoring Class/Grade and stream letter) rejected');
  p.w.prompt = () => 'Class 9B'; p.d.getElementById('renameBtn').click(); ok(st(p).levels[0].grades[2].name === 'Class 9B', 'a grade can be renamed');
  p.d.getElementById('delGradeBtn').click(); ok(st(p).levels[0].grades.length === 2, 'a grade can be deleted after confirmation');
  p = await openPage('fee-structure-manager.html', base({ fee_structures: [{ school_id: 'sc-1', draft: { levels: [{ name: 'Primary', grades: [{ name: 'Class 4', fees: [] }] }] }, term_names: ['T1', 'T2', 'T3'] }] }));
  p.d.getElementById('delGradeBtn').click(); ok(/needs at least one grade/.test(p.w.__alerts.pop()) && st(p).levels[0].grades.length === 1, 'the last grade in a section cannot be deleted');

  // ---------- copy to other grades / percent ----------
  p = await openPage('fee-structure-manager.html', base(draftOf()));
  p.d.getElementById('copyBtn').click();
  ok(p.d.querySelectorAll('#copyPick input').length === 2, 'copy dialog lists the other grades');
  p.d.getElementById('copyAll').click(); p.d.getElementById('copyGo').click();
  ok(st(p).levels[0].grades[1].fees.length === 2 && st(p).levels[1].grades[0].fees.length === 2 && st(p).levels[1].grades[0].fees[1].boarderOnly === true, 'fees (with boarding flags) are copied to every ticked grade, across sections');
  st(p).levels[0].grades[1].fees[0].amounts[0] = 1; ok(st(p).levels[0].grades[0].fees[0].amounts[0] === 10000, 'copies are independent of the original');
  p = await openPage('fee-structure-manager.html', base(draftOf()));
  p.w.prompt = () => '10'; p.d.getElementById('pctBtn').click();
  ok(st(p).levels[0].grades[0].fees[0].amounts.join() === '11000,8800,7700', 'increase all amounts by 10%', st(p).levels[0].grades[0].fees[0].amounts.join());
  p.w.prompt = () => 'abc'; p.d.getElementById('pctBtn').click(); ok(/between -90 and 300/.test(p.w.__alerts.pop()), 'a nonsense percentage is rejected');

  // ---------- autosave + clean payload ----------
  p = await openPage('fee-structure-manager.html', base(draftOf()));
  ok(!q(p, c => c.op === 'upsert').length, 'nothing is saved just by opening the page');
  p.d.querySelectorAll('.grade-item')[1].click();
  const s2 = p.d.getElementById('presetSel'); s2.value = '1'; s2.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  const a0 = p.d.querySelector('input[data-f="amt"][data-t="0"]'); change(p, a0, '2500');
  p.d.querySelector('input[data-f="name"]').value = '  Lunch  '; change(p, p.d.querySelector('input[data-f="name"]'));
  await tick(1000);
  let up = q(p, c => c.op === 'upsert' && c.table === 'fee_structures');
  ok(up.length === 1, 'autosave sends ONE upsert after typing stops', String(up.length));
  const d = up[0] && up[0].payload;
  ok(d && d.school_id === 'sc-1' && up[0].opts.onConflict === 'school_id' && d.updated_by === 'u-1' && d.term_names.length === 3, 'draft saved against this school only');
  const lunch = d && d.draft.levels[0].grades[1].fees[0];
  ok(lunch && lunch.name === 'Lunch' && JSON.stringify(lunch.amounts) === '[2500,0,0]', 'saved fees are cleaned: names trimmed, amounts numeric', JSON.stringify(lunch));
  ok(d && d.draft.schoolName === 'Don Bosco Ituru', 'school name stored from the database');
  for (let i = 0; i < 3; i++) change(p, p.d.querySelector('input[data-f="amt"][data-t="1"]'), String(100 + i));
  await tick(1000); ok(q(p, c => c.op === 'upsert' && c.table === 'fee_structures').length === 2, 'rapid typing is debounced (3 edits -> 1 more save)');
  change(p, p.d.querySelector('input[data-f="amt"][data-t="1"]'), '555');
  const ev2 = new p.w.Event('beforeunload', { cancelable: true }); p.w.dispatchEvent(ev2); ok(ev2.defaultPrevented, 'leaving with unsaved changes asks for confirmation');
  await tick(1000); const ev3 = new p.w.Event('beforeunload', { cancelable: true }); p.w.dispatchEvent(ev3); ok(!ev3.defaultPrevented, 'no warning once saved');

  // ---------- Save draft, term names ----------
  p = await openPage('fee-structure-manager.html', base());
  p.d.getElementById('ffSave').click(); await tick(); ok(q(p, c => c.op === 'upsert' && c.table === 'fee_structures').length === 1 && /Draft saved/.test(p.text('ffStatus')), 'Save draft saves immediately');
  p = await openPage('fee-structure-manager.html', { ...base(), onQuery: { 'fee_structures:upsert': () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  p.d.getElementById('ffSave').click(); await tick(); ok(/Could not save: No internet/.test(p.text('ffStatus')), 'save failure is reported');
  p = await openPage('fee-structure-manager.html', base(draftOf()));
  const th = p.d.querySelector('input[data-term="0"]'); change(p, th, 'Opening Term'); await tick(1000);
  up = q(p, c => c.op === 'upsert' && c.table === 'fee_structures');
  ok(p.w.FM.TERMS[0] === 'Opening Term' && up.length >= 1 && up[up.length - 1].payload.term_names[0] === 'Opening Term', 'term names are edited in the table header and saved');
  change(p, p.d.querySelector('input[data-term="1"]'), ''); p.d.getElementById('ffPublish').click(); await tick();
  ok(/Term names cannot be empty/.test(p.w.__alerts.pop()), 'a blank term name blocks publishing');

  // ---------- publish: validation ----------
  p = await openPage('fee-structure-manager.html', base());
  p.d.getElementById('ffPublish').click(); await tick();
  ok(/at least one fee item/i.test(p.w.__alerts.pop()) && !q(p, c => c.op !== 'select' && c.table === 'fee_structure_published').length, 'cannot publish a structure with no amounts');
  p = await openPage('fee-structure-manager.html', base(draftOf([{ name: 'Primary', grades: [{ name: 'Class 4', fees: [fee('T', [1, 1, 1])] }, { name: 'Grade 4B', fees: [] }] }])));
  p.d.getElementById('ffPublish').click(); await tick(); ok(/same grade/i.test(p.w.__alerts.pop()), 'grades that would match the same students are rejected');
  p = await openPage('fee-structure-manager.html', base(draftOf([{ name: 'Primary', grades: [{ name: 'Class 4', fees: [fee('  ', [1, 1, 1])] }] }])));
  p.d.getElementById('ffPublish').click(); await tick(); ok(/has no name/i.test(p.w.__alerts.pop()), 'a fee item without a name is rejected');
  p = await openPage('fee-structure-manager.html', base(draftOf()));
  st(p).levels[0].grades[0].fees[0].amounts[0] = 99999999999; p.d.getElementById('ffPublish').click(); await tick();
  ok(/0 and 10,000,000/.test(p.w.__alerts.pop()), 'absurd amounts are rejected');

  // ---------- publish: success ----------
  const ready = () => base({ ...draftOf(), student_balances: unbilledRows });
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
  ok(/1 student\(s\) now have fees/.test(al) && /2 student\(s\) have no fee/.test(al) && /Class 9/.test(al) && !/Ghost/.test(al), 'after publishing: reports which classes did not match a grade', al);
  ok(/Last published/.test(p.text('ffPubInfo')) && !p.d.getElementById('ffPublish').disabled, 'published-date shown; button re-enabled');
  p = await openPage('fee-structure-manager.html', base({ ...draftOf(), student_balances: [{ class_name: 'Class 4A', total_fee: 25000, verified: true, active: true }] }));
  p.d.getElementById('ffPublish').click(); await tick(150); ok(/Published\. 1 student/.test(p.text('ffStatus')) && !p.w.__alerts, 'when every student matches there is no warning popup');

  // ---------- publish: failures ----------
  p = await openPage('fee-structure-manager.html', { ...ready(), onQuery: { 'fee_structure_published:upsert': () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }) } });
  p.d.getElementById('ffPublish').click(); await tick(150); ok(/Publish failed: You do not have permission/.test(p.text('ffStatus')) && !p.d.getElementById('ffPublish').disabled, 'publish permission error shown; button recovers');
  p = await openPage('fee-structure-manager.html', { ...ready(), onQuery: { 'fee_structures:upsert': () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  p.d.getElementById('ffPublish').click(); await tick(150); ok(!q(p, c => c.op !== 'select' && c.table === 'fee_structure_published').length && /Publish failed/.test(p.text('ffStatus')), 'if the draft cannot be saved, nothing is published');

  // ---------- load failure must never overwrite saved work ----------
  p = await openPage('fee-structure-manager.html', { ...ready(), onQuery: { 'fee_structures:select': () => ({ data: null, error: { message: 'Failed to fetch' } }) } });
  ok(p.d.getElementById('ffBanner') && /No internet/.test(p.d.getElementById('ffBanner').textContent) && /not overwritten/.test(p.d.getElementById('ffBanner').textContent), 'load failure shows a banner explaining saving is off');
  change(p, p.d.querySelector('input[data-f="amt"][data-t="0"]'), '1'); await tick(1000); p.d.getElementById('ffSave').click(); await tick();
  ok(!q(p, c => c.op === 'upsert').length, 'autosave and Save draft do NOT run after a failed load');
  ok(/Not saved/.test(p.text('ffStatus')), 'Save draft says why nothing was saved');
  p.d.getElementById('ffPublish').click(); await tick(); ok(/Cannot publish/.test(p.text('ffStatus')) && !q(p, c => c.op !== 'select' && c.table === 'fee_structure_published').length, 'publishing is blocked after a failed load');

  summary();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
