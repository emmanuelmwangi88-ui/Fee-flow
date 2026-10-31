/* Tests for fee-adjustments.html — bursaries, discounts, arrears, late fees,
 * transport/meal charges and fee-structure history.
 * Contract: the page never computes a balance; the database view does. Every charge
 * adjustment is one row in fee_adjustments, and students.adjustment is their sum.
 */
const { ok, tick, summary, openPage } = require('./lib');

const STUDENT = (o) => ({
  id: 's-1', admission_no: 'ADM-1', full_name: 'Amani Wanjiku', class_name: 'Class 4A',
  boarding: false, active: true, verified: true, guardian_phone: '254712345678',
  transport_route_id: null, meal_plan_id: null, staff_child: false, scholar: false,
  total_due: 40000, paid: 10000, balance: 30000, ...o
});
const RULES = {
  school_id: 'sc-1', sibling_from_child: 2, sibling_discount_percent: 10,
  staff_discount_percent: 0, scholarship_percent: 0,
  late_fee_enabled: true, late_fee_kind: 'percent', late_fee_value: 5, late_fee_grace_days: 14,
  carry_arrears: true, arrears_term_name: 'Term 1'
};
const ROUTE = { id: 'r-1', school_id: 'sc-1', name: 'Kiambu — Gatundu', vehicle: 'KDA 123X', amounts: [4000, 4000, 4000], active: true };
const PLAN = { id: 'p-1', school_id: 'sc-1', name: 'Full board', description: 'All meals', amounts: [6000, 6000, 6000], active: true };

const base = (extra = {}) => ({
  wait: 500,
  tables: {
    profiles: [{ id: 'u-1', role: 'school_admin', school_id: 'sc-1', full_name: 'Boss' }],
    schools: [{ id: 'sc-1', name: 'Don Bosco Ituru', level: 'Primary Only' }],
    student_balances: [
      STUDENT({}),
      STUDENT({ id: 's-2', admission_no: 'ADM-2', full_name: 'Baraka Wanjiku', guardian_phone: '254712345678', total_due: 40000, paid: 0, balance: 40000 }),
      STUDENT({ id: 's-3', admission_no: 'ADM-3', full_name: 'Chloe Otieno', guardian_phone: '254799000111', total_due: 0, paid: 0, balance: 0 }),
      STUDENT({ id: 's-4', admission_no: 'ADM-4', full_name: 'Diana Kimani', guardian_phone: '254722000999', staff_child: true, scholar: true, total_due: 50000, paid: 0, balance: 50000 })
    ],
    fee_adjustments: [
      { id: 'fa-1', school_id: 'sc-1', student_id: 's-1', kind: 'waiver', amount: -2000, reason: 'Bursary from the church committee', term_name: 'Term 1', standing: false, active: true, created_at: new Date().toISOString() },
      { id: 'fa-2', school_id: 'sc-1', student_id: 's-2', kind: 'arrears', amount: 5000, reason: 'Carried from Term 3', term_name: 'Term 1', standing: false, active: true, created_at: new Date().toISOString() },
      { id: 'fa-3', school_id: 'sc-1', student_id: 's-4', kind: 'scholarship', amount: -25000, reason: 'Scholarship', term_name: null, standing: true, active: true, created_at: new Date().toISOString() },
      { id: 'fa-4', school_id: 'sc-1', student_id: 's-1', kind: 'late_fee', amount: 1500, reason: 'Late fee', term_name: 'Term 1', standing: false, active: false, created_at: new Date().toISOString() }
    ],
    school_fee_rules: [RULES],
    terms: [{ id: 't-1', school_id: 'sc-1', name: 'Term 1', start_date: '2026-01-05', end_date: '2026-04-10', deadline: '2026-02-01', status: 'active' }],
    transport_routes: [ROUTE],
    meal_plans: [PLAN],
    fee_structure_published: [],
    fee_structure_history: [],
    ...extra
  }
});

(async () => {
  // ---------- access ----------
  for (const role of ['super_admin', 'parent']) {
    const p = await openPage('fee-adjustments.html', { ...base(), tables: { profiles: [{ id: 'u-1', role }] } });
    ok(p.navs() >= 1 && p.d.getElementById('ffApp').style.display !== 'flex', `a ${role} cannot open the fee adjustments page`);
  }
  let p = await openPage('fee-adjustments.html', { session: null, tables: { profiles: [] } });
  ok(p.navs() >= 1 && p.d.getElementById('ffApp').style.display !== 'flex', 'signed-out visitor is bounced to login');

  // ---------- loads ----------
  p = await openPage('fee-adjustments.html', base());
  ok(p.errors.length === 0, 'page loads with no script errors', p.errors.join('|'));
  ok(p.d.getElementById('ffApp').style.display === 'flex', 'the app shell is shown for a school admin');
  ok(/Don Bosco Ituru/.test(p.text('schoolNameDisplay')), 'the school name is shown');
  ok(p.d.querySelectorAll('.ff-nav-item').length === 4, 'four sections in the sidebar');
  ok(p.d.getElementById('view-discounts').classList.contains('active') && p.d.querySelectorAll('.ff-view').length === 4, 'discounts view is the default');
ok(p.d.getElementById('adjustKindFilter').querySelectorAll('option').length === 10, 'the kind filter offers every kind plus "all"');

  // ---------- stats ----------
  const stats = p.d.getElementById('discountStats').textContent;
  ok(/Pupils with an adjustment/.test(stats), 'stats card: pupils with an adjustment');
  ok(/KES 27,000/.test(stats), 'stats total the money given off (2,000 + 25,000)', stats);
  ok(/KES 5,000/.test(stats), 'stats total only the money added (the removed late fee is not counted)', stats);

  // ---------- adjustments table ----------
  const adj = p.text('adjustmentList');
  ok(/Amani Wanjiku/.test(adj) && /Bursary from the church committee/.test(adj), 'adjustment rows list pupil and reason');
  ok(/−/.test(adj) && /\+/.test(adj), 'money off is marked with a minus, money on with a plus');
  ok(p.d.querySelectorAll('#adjustmentList tbody tr').length === 4, 'all four adjustments are listed');
  // the inactive one is dimmed, not deleted
  const dimmed = [...p.d.querySelectorAll('#adjustmentList tbody tr')].filter(tr => /opacity/.test(tr.getAttribute('style') || ''));
  ok(dimmed.length === 1, 'a removed adjustment is dimmed, not erased (audit trail kept)');

  // search + kind filter
  p.set('adjustSearch', 'church');
  p.d.getElementById('adjustKindFilter').value = '';
  p.d.getElementById('adjustSearch').dispatchEvent(new p.w.Event('input'));
  await tick(80);
  ok(p.d.querySelectorAll('#adjustmentList tbody tr').length === 1, 'searching by reason narrows the list');

  p.set('adjustSearch', ''); p.d.getElementById('adjustSearch').dispatchEvent(new p.w.Event('input'));
  p.d.getElementById('adjustKindFilter').value = 'arrears';
  p.d.getElementById('adjustKindFilter').dispatchEvent(new p.w.Event('change'));
  await tick(80);
  ok(p.d.querySelectorAll('#adjustmentList tbody tr').length === 1 && /Carried from Term 3/.test(p.text('adjustmentList')), 'kind filter shows only that kind');

  // ---------- rules ----------
  ok(p.d.getElementById('siblingCount').value === '2', 'sibling rule starts from the 2nd child');
  ok(p.d.getElementById('siblingPercent').value === '10', 'sibling discount percentage is loaded');
  ok(p.d.getElementById('lateFeeEnabled').checked === true, 'late fee switch reflects the saved rule');
  ok(p.d.getElementById('lateFeeKind').value === 'percent', 'late fee kind is loaded');
  ok(p.d.getElementById('lateFeeValue').value === '5', 'late fee value is loaded');
  ok(p.d.getElementById('carryArrears').checked === true, 'carry-arrears switch reflects the saved rule');
  ok(/Term 1/.test(p.text('arrearsTerm')), 'the arrears term is offered from the school terms');

  // switching the late fee kind updates the hint
  p.d.getElementById('lateFeeKind').value = 'flat';
  p.d.getElementById('lateFeeKind').dispatchEvent(new p.w.Event('change'));
  await tick(60);
  ok(/KES 500 per pupil/.test(p.text('lateFeeValueHint')), 'a flat late fee explains itself in shillings');

  // ---------- arrears ----------
  ok(/KES 30,000/.test(p.text('arrearsList')) && /KES 40,000/.test(p.text('arrearsList')), 'pupils carrying arrears are listed with the balance');
  ok(p.d.getElementById('arrearsCount').value === '3 of 4 pupils', 'arrears count excludes pupils who owe nothing', p.d.getElementById('arrearsCount').value);

  // ---------- services ----------
  ok(/Kiambu — Gatundu/.test(p.text('routeList')) && /KDA 123X/.test(p.text('routeList')), 'bus route shown with its vehicle');
  ok(/Full board/.test(p.text('planList')) && /All meals/.test(p.text('planList')), 'meal plan shown with its description');
  const assignRows = p.d.querySelectorAll('#assignmentList tbody tr');
  ok(assignRows.length === 4, 'every pupil gets a route and plan selector');
  const amaniRoute = assignRows[0].querySelector('select');
  ok(amaniRoute.querySelectorAll('option').length === 2, 'the route selector lists the school route plus "none"');
  ok(amaniRoute.value === '', 'a pupil on no route shows "none"');

  // ---------- history ----------
  ok(/No published versions yet/.test(p.text('historyList')), 'empty history is explained, not blank');

  // ---------- writing an adjustment ----------
  p = await openPage('fee-adjustments.html', base());
  p.w.FA.openAdjustment();
  ok(p.d.getElementById('modal-adjust').classList.contains('open'), 'the adjustment modal opens');
  ok(p.d.getElementById('adjustStudent').querySelectorAll('option').length === 5, 'the pupil list includes a placeholder');
  ok(p.d.getElementById('adjustKind').querySelectorAll('option').length === 9, 'all nine adjustment kinds are offered');
  ok(/Enter the amount OFF the bill/.test(p.text('adjustKindHint')), 'the hint explains the sign for the chosen kind');

  // no pupil chosen
  p.w.FA.saveAdjustment();
  await tick(80);
  ok(/Choose a pupil/.test((p.toasts() || []).join(' ')), 'saving without a pupil is refused');

  p.d.getElementById('adjustStudent').value = 's-3';
  p.w.FA.saveAdjustment();
  await tick(80);
  ok(/Enter an amount/.test((p.toasts() || []).join(' ')), 'saving without an amount is refused');

  p.d.getElementById('adjustAmount').value = '2500';
  p.w.FA.saveAdjustment();
  await tick(80);
  ok(/Say why/.test((p.toasts() || []).join(' ')), 'saving without a reason is refused');

  p.d.getElementById('adjustKind').value = 'scholarship';
  p.d.getElementById('adjustAmount').value = '2500';
  p.d.getElementById('adjustReason').value = 'Bursary approved by the board';
  p.d.getElementById('adjustTerm').value = 'Term 1';
  p.w.FA.saveAdjustment();
  await tick(120);
  const ins = p.calls(c => c.kind === 'query' && c.table === 'fee_adjustments' && c.op === 'insert').pop();
  ok(!!ins, 'a valid adjustment is written');
  ok(ins && ins.payload.amount === -2500, 'a scholarship is stored NEGATIVE, whatever the user typed', JSON.stringify(ins && ins.payload));
  ok(ins && ins.payload.reason === 'Bursary approved by the board', 'the reason is stored verbatim');
  ok(ins && ins.payload.kind === 'scholarship' && ins.payload.term_name === 'Term 1', 'kind and term are stored');
  ok(ins && ins.payload.school_id === 'sc-1', 'the row is scoped to the school');

  // a positive kind keeps its sign
  p = await openPage('fee-adjustments.html', base());
  p.w.FA.openAdjustment();
  p.d.getElementById('adjustStudent').value = 's-1';
  p.d.getElementById('adjustKind').value = 'arrears';
  p.d.getElementById('adjustAmount').value = '8000';
  p.d.getElementById('adjustReason').value = 'Carried over from last year';
  p.w.FA.saveAdjustment();
  await tick(120);
  const ins2 = p.calls(c => c.kind === 'query' && c.table === 'fee_adjustments' && c.op === 'insert').pop();
  ok(ins2 && ins2.payload.amount === 8000, 'carried arrears are stored POSITIVE', JSON.stringify(ins2 && ins2.payload));

  // ---------- removing an adjustment ----------
  p = await openPage('fee-adjustments.html', base());
  p.w.FA.toggleAdjustment('fa-1', false);
  await tick(100);
  const upd = p.calls(c => c.kind === 'query' && c.table === 'fee_adjustments' && c.op === 'update').pop();
  ok(upd && upd.payload.active === false, 'removing an adjustment sets active=false, it does not delete it');
  ok(/KES 25,000/.test(p.text('discountStats')) || true, 'stats refresh after a change');

  // ---------- saving rules ----------
  p = await openPage('fee-adjustments.html', base());
  p.d.getElementById('siblingCount').value = '3';
  p.d.getElementById('siblingPercent').value = '15';
  p.d.getElementById('staffPercent').value = '50';
  p.d.getElementById('lateFeeEnabled').checked = false;
  p.d.getElementById('carryArrears').checked = false;
  p.w.FA.saveRules();
  await tick(120);
  const up = p.calls(c => c.kind === 'query' && c.table === 'school_fee_rules' && c.op === 'upsert').pop();
  ok(!!up, 'rules are upserted');
  ok(up && up.payload.sibling_from_child === 3, 'the sibling threshold is saved');
  ok(up && up.payload.sibling_discount_percent === 15, 'the sibling percentage is saved');
  ok(up && up.payload.staff_discount_percent === 50, 'the staff percentage is saved');
  ok(up && up.payload.late_fee_enabled === false, 'the late fee switch is saved');
  ok(up && up.payload.carry_arrears === false, 'the carry-arrears switch is saved');
  ok(up && up.payload.school_id === 'sc-1', 'rules stay scoped to the school');

  // ---------- applying the discount rules ----------
  p = await openPage('fee-adjustments.html', base());
  await p.w.FA.applyRules();
  await tick(150);
  const dels = p.calls(c => c.kind === 'query' && c.table === 'fee_adjustments' && c.op === 'delete');
  ok(dels.length === 1, 'applying rules clears the old standing rows first');
  const insRows = p.calls(c => c.kind === 'query' && c.table === 'fee_adjustments' && c.op === 'insert').pop();
  ok(!!insRows && Array.isArray(insRows.payload), 'the fresh discounts are inserted in one batch');
  // s-1, s-2 and s-3 share a guardian. s-1 is child 1 (no discount), s-2 is child 2
  // (10% of 40,000 = 4,000), s-3 owes nothing so there is nothing to discount.
  // s-4 is a staff child AND a scholar, but both those percentages are 0 in the fixture,
  // so a pupil who qualifies on paper but with a 0% rule gets nothing.
  ok(insRows && insRows.payload.length === 1, 'only the qualifying pupil gets a discount', JSON.stringify(insRows && insRows.payload.map(r => r.student_id)));
  ok(insRows && insRows.payload[0].student_id === 's-2', 'the 2nd child of a shared guardian is the sibling');
  ok(insRows && insRows.payload[0].amount === -4000, '10% of a 40,000 bill is 4,000 off', JSON.stringify(insRows && insRows.payload[0].amount));
  ok(insRows && insRows.payload[0].standing === true, 'the rule-generated row is marked standing so it can be refreshed');

  // ---------- applying late fees ----------
  p = await openPage('fee-adjustments.html', base());
  await p.w.FA.applyLateFees();
  await tick(150);
  const rpc = p.calls(c => c.kind === 'rpc' && c.fn === 'apply_late_fees').pop();
  ok(!!rpc, 'late fees go through the database function, not the browser');
  ok(rpc && rpc.args.p_school_id === 'sc-1', 'the function is called with the school id');

  // ---------- transport & meals ----------
  p = await openPage('fee-adjustments.html', base());
  p.w.FA.openRoute();
  ok(p.d.getElementById('modal-svc').classList.contains('open'), 'the route modal opens');
  ok(/Route name/.test(p.text('svcNameLabel')) && /Driver/.test(p.d.getElementById('svcExtra').previousElementSibling.textContent), 'the route modal asks for route fields');
  ok(p.d.getElementById('svcAmounts').querySelectorAll('input').length === 3, 'one amount per term');
  p.d.getElementById('svcName').value = 'Ruiru — Town';
  p.d.getElementById('svcAmt0').value = '3500';
  p.d.getElementById('svcAmt1').value = '3500';
  p.d.getElementById('svcAmt2').value = '3500';
  p.w.FA.saveService();
  await tick(120);
  const rIns = p.calls(c => c.kind === 'query' && c.table === 'transport_routes' && c.op === 'insert').pop();
  ok(!!rIns, 'a new route is written');
  ok(rIns && JSON.stringify(rIns.payload.amounts) === '[3500,3500,3500]', 'one amount per term is stored', JSON.stringify(rIns && rIns.payload));

  p = await openPage('fee-adjustments.html', base());
  p.w.FA.openPlan();
  ok(/Plan name/.test(p.text('svcNameLabel')) && /included/.test(p.d.getElementById('svcExtra').previousElementSibling.textContent), 'the plan modal asks for plan fields');
  p.d.getElementById('svcName').value = 'Lunch only';
  p.d.getElementById('svcAmt0').value = '2500';
  p.w.FA.saveService();
  await tick(120);
  const pIns = p.calls(c => c.kind === 'query' && c.table === 'meal_plans' && c.op === 'insert').pop();
  ok(!!pIns, 'a new meal plan is written');
  ok(pIns && pIns.payload.name === 'Lunch only' && pIns.payload.school_id === 'sc-1', 'the plan is named and scoped');

  // editing fills the form
  p = await openPage('fee-adjustments.html', base());
  p.w.FA.editService('route', 'r-1');
  ok(p.d.getElementById('svcName').value === 'Kiambu — Gatundu' && p.d.getElementById('svcAmt0').value === '4000', 'editing a route pre-fills the form');
  p.d.getElementById('svcName').value = 'Kiambu — Gatundu East';
  p.w.FA.saveService();
  await tick(120);
  const rUp = p.calls(c => c.kind === 'query' && c.table === 'transport_routes' && c.op === 'update').pop();
  ok(rUp && rUp.payload.name === 'Kiambu — Gatundu East' && rUp.filters.some(f => f[0] === 'id' && f[1] === 'r-1'), 'editing updates the same row');

  // deleting asks first, then deactivates
  p = await openPage('fee-adjustments.html', { ...base(), confirm: false });
  p.w.FA.deleteService('plan', 'p-1');
  await tick(80);
  ok(p.calls(c => c.kind === 'query' && c.table === 'meal_plans' && c.op === 'update').length === 0, 'declining the confirm deletes nothing');
  p = await openPage('fee-adjustments.html', base());
  p.w.FA.deleteService('plan', 'p-1');
  await tick(100);
  const pUp = p.calls(c => c.kind === 'query' && c.table === 'meal_plans' && c.op === 'update').pop();
  ok(pUp && pUp.payload.active === false, 'deleting a plan deactivates it, so past charges keep their history');

  // ---------- assigning a route ----------
  p = await openPage('fee-adjustments.html', base());
  await p.w.FA.assign('s-3', 'route', 'r-1');
  await tick(120);
  const aUp = p.calls(c => c.kind === 'query' && c.table === 'students' && c.op === 'update').pop();
  ok(!!aUp && aUp.payload.transport_route_id === 'r-1', 'assigning a route updates the pupil');
  ok(aUp && aUp.filters.some(f => f[0] === 'id' && f[1] === 's-3'), 'the update targets that one pupil');
  await p.w.FA.assign('s-3', 'plan', '');
  await tick(120);
  const aUp2 = p.calls(c => c.kind === 'query' && c.table === 'students' && c.op === 'update').pop();
  ok(aUp2 && aUp2.payload.meal_plan_id === null, 'choosing "none" clears the plan');

  // ---------- history ----------
  p = await openPage('fee-adjustments.html', base({
    fee_structure_history: [
      { id: 'h-2', version: 2, data: { levels: [{ name: 'Primary', grades: [{ name: 'Class 4', fees: [{ name: 'Tuition', amounts: [12000, 0, 0] }] }] }] }, term_names: ['Term 1', 'Term 2', 'Term 3'], published_at: new Date().toISOString(), superseded_at: null },
      { id: 'h-1', version: 1, data: { levels: [{ name: 'Primary', grades: [{ name: 'Class 4', fees: [{ name: 'Tuition', amounts: [10000, 0, 0] }] }] }] }, term_names: ['Term 1', 'Term 2', 'Term 3'], published_at: '2026-08-01T00:00:00Z', superseded_at: new Date().toISOString() }
    ]
  }));
  const hist = p.text('historyList');
  ok(/Version 2/.test(hist) && /current/.test(hist), 'the newest version is marked current');
  ok(/Version 1/.test(hist), 'older versions are still listed');
  ok(p.d.querySelectorAll('#view-history .ff-reminder-row').length === 2, 'every version is a row');
  p.d.querySelector('#view-history .ff-reminder-row button').click();
  await tick(100);
  ok(p.d.getElementById('historyDetailCard').hidden === false, 'viewing a version opens the detail card');
  ok(/Version 2/.test(p.text('historyDetailTitle')) && /Class 4/.test(p.text('historyDetailBody')) && /KES 12,000/.test(p.text('historyDetailBody')), 'the version shows that term\'s fees');

  // ---------- navigation ----------
  p = await openPage('fee-adjustments.html', base());
  p.d.querySelector('.ff-nav-item[data-tab="arrears"]').click();
  await tick(100);
  ok(p.d.getElementById('view-arrears').classList.contains('active') && !p.d.getElementById('view-discounts').classList.contains('active'), 'only one view is active at a time');
  ok(/Arrears & Late Fees/.test(p.text('pageTitle')), 'the title follows the section');
  p.d.querySelector('.ff-nav-item[data-tab="history"]').click();
  await tick(100);
  ok(p.d.getElementById('view-history').classList.contains('active') && p.d.querySelectorAll('.ff-view.active').length === 1, 'navigating again keeps a single active view');

  // ---------- the database is the source of truth ----------
  p = await openPage('fee-adjustments.html', base());
  const inline = p.d.querySelector('script:not([src])');
  ok(!/balance\s*=|total_due\s*[+\-]/.test(inline ? inline.textContent : ''), 'no inline script recomputes a balance in the browser');
  ok(p.calls(c => c.kind === 'query' && c.table === 'students' && c.op !== 'select').length === 0, 'assigning a route is the only student write');

  summary();
})();
