/* Tests for platform-tools.html (super admin): health, invoices, trials, support inbox. */
const { ok, tick, summary, openPage } = require('./lib');
const soon = new Date(Date.now() + 5 * 864e5).toISOString();
const base = () => ({
  wait: 500,
  tables: {
    profiles: [{ id: 'u-1', role: 'super_admin', full_name: 'Root' }],
    schools: [{ id: 'sc-1', name: 'Don Bosco', plan: 'Trial', status: 'active', trial_ends_at: soon }, { id: 'sc-2', name: 'Alpha', plan: 'Pro', status: 'active' }],
    subscription_invoices: [{ id: 'i-1', school_id: 'sc-1', number: 'INV-1', description: 'Sub', amount: 5000, status: 'unpaid', due_date: '2020-01-01', issued_at: soon }],
    support_tickets: [{ id: 't-1', school_id: 'sc-1', subject: 'Help', category: 'payments', status: 'open', created_at: soon, updated_at: soon }],
    support_messages: [{ id: 'm-1', ticket_id: 't-1', from_platform: false, body: 'It broke <b>x</b>', created_at: soon }]
  },
  rpc: { platform_health: async () => ({ data: { schools_active: 2, schools_suspended: 0, payments_pending_over_1h: 3, payments_failed_24h: 0, payments_completed_24h: 9, tickets_open: 1, invoices_overdue: 1, trials_ending_7d: 1, cron_failures_24h: 0, checked_at: soon }, error: null }) }
});
const rpcs = (p, fn) => p.calls(c => c.kind === 'rpc' && c.fn === fn);
(async () => {
  for (const role of ['school_admin', 'parent']) {
    const p = await openPage('platform-tools.html', { tables: { profiles: [{ id: 'u-1', role, school_id: 'sc-1' }] } });
    ok(p.d.getElementById('ffApp').style.display !== 'flex', `${role} cannot open Platform tools`);
  }
  const p = await openPage('platform-tools.html', base());
  ok(p.errors.length === 0, 'loads without script errors', p.errors.join('|'));
  ok(/Platform health/.test(p.text('view-health')) && /needs attention/.test(p.text('view-health')), 'health flags pending payments');
  await p.w.PT.go('billing'); await tick();
  ok(/INV-1/.test(p.text('view-billing')) && /Don Bosco/.test(p.text('view-billing')) && /overdue|unpaid/.test(p.text('view-billing')), 'invoice list');
  p.w.PT.newInvoice(); p.set('ivAmt', '12000'); await p.d.getElementById('opOk').onclick(); await tick();
  const inv = rpcs(p, 'issue_invoice')[0];
  ok(inv && inv.args.p_amount === 12000 && inv.args.p_school === 'sc-1', 'issue_invoice payload');
  p.w.prompt = () => 'QWE123'; await p.w.PT.settle('i-1', true); await tick();
  ok(rpcs(p, 'settle_invoice')[0].args.p_ref === 'QWE123' && rpcs(p, 'settle_invoice')[0].args.p_paid === true, 'settle_invoice payload');
  await p.w.PT.go('trials'); await tick();
  ok(/Don Bosco/.test(p.text('view-trials')) && !/Alpha/.test(p.text('view-trials')), 'trial list only shows trial schools');
  await p.w.PT.extend('sc-1', 14); await tick();
  const up = p.calls(c => c.kind === 'query' && c.table === 'schools' && c.op === 'update').pop();
  ok(up && up.payload.trial_ends_at && new Date(up.payload.trial_ends_at) > new Date(soon), 'extend updates trial_ends_at');
  await p.w.PT.go('support'); await tick();
  await p.w.PT.openTicket('t-1'); await tick();
  ok(/&lt;b&gt;x&lt;\/b&gt;/.test(p.d.getElementById('thread').innerHTML), 'ticket text is escaped');
  p.set('tkReply', 'On it'); await p.w.PT.reply('t-1'); await tick();
  ok(rpcs(p, 'reply_ticket')[0].args.p_body === 'On it', 'reply_ticket payload');
  summary();
})();
