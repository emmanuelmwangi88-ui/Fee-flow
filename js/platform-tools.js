/* FeeFlow — Platform tools (super admin only): health, manual invoices, trials, support inbox.
   All writes use database functions / column-limited grants that only a super admin passes. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => FF.escapeHtml(s);
  const money = n => FFUI.money(n);
  const num = n => Number(n) || 0;
  const TABS = { health: 'Health', billing: 'Invoices', trials: 'Trials', support: 'Support inbox' };
  let sb, schools = [], tickets = [];
  const fail = e => FFUI.toast(FF.friendlyError(e), 'error');
  const toast = m => FFUI.toast(m, 'success');
  const badge = (c, t) => `<span class="ff-badge ${c}">${esc(t)}</span>`;
  const head = (icon, color, title, sub, extra) => `<div class="ff-page-head"><div><div class="ff-page-title"><i data-ico="${icon}" style="color:${color}"></i> ${title}</div><div class="ff-page-desc">${sub}</div></div>${extra || ''}</div>`;
  const empty = (icon, t) => `<div class="ff-empty"><div class="ff-empty-icon"><i data-ico="${icon}"></i></div><p>${t}</p></div>`;
  const paint = el => FFUI.paint(el || document);
  const sname = id => (schools.find(s => s.id === id) || {}).name || '—';

  async function renderHealth() {
    const v = $('view-health');
    const { data, error } = await sb.rpc('platform_health');
    if (error) { fail(error); return; }
    const h = data || {};
    const items = [
      ['Active schools', h.schools_active, 'green', 0], ['Suspended schools', h.schools_suspended, 'amber', 1],
      ['Payments completed (24h)', h.payments_completed_24h, 'green', 0], ['Payments failed (24h)', h.payments_failed_24h, 'red', 1],
      ['Payments pending over 1h', h.payments_pending_over_1h, 'red', 1], ['Open support requests', h.tickets_open, 'blue', 0],
      ['Overdue invoices', h.invoices_overdue, 'red', 1], ['Trials ending in 7 days', h.trials_ending_7d, 'amber', 0], ['Scheduled-job failures (24h)', h.cron_failures_24h, 'red', 1]
    ];
    const attention = items.filter(i => i[3] && num(i[1]) > 0 && i[2] === 'red').length;
    v.innerHTML = head('shield', 'var(--ff-green)', 'Platform health', 'Checked ' + FFUI.fmtDateTime(h.checked_at)) +
      `<div class="ff-alert ${attention ? 'danger' : 'success'}"><i data-ico="${attention ? 'alert' : 'checkCircle'}"></i><div>${attention ? 'Something needs attention — see the red items below.' : 'No stuck payments, failed jobs or overdue invoices.'}</div></div>
      <div class="ff-stats">${items.map(i => `<div class="ff-stat"><div class="ff-stat-value" style="${i[3] && num(i[1]) > 0 && i[2] === 'red' ? 'color:var(--ff-red)' : ''}">${num(i[1])}</div><div class="ff-stat-label">${i[0]}</div></div>`).join('')}</div>`;
    paint(v);
  }

  async function renderBilling() {
    const v = $('view-billing');
    const r = await sb.from('subscription_invoices').select('id, school_id, number, description, amount, status, due_date, issued_at, payment_ref').order('issued_at', { ascending: false }).limit(200);
    if (r.error) { fail(r.error); return; }
    const today = new Date().toISOString().slice(0, 10);
    v.innerHTML = head('receipt', 'var(--ff-green)', 'Invoices', 'Manual invoices to schools. You mark them paid once the money has arrived.',
      '<button class="ff-btn ff-btn-primary" type="button" onclick="PT.newInvoice()"><i data-ico="plus" data-size="ff-ico-sm"></i> New invoice</button>') +
      `<div class="ff-card">${(r.data || []).length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>Number</th><th>School</th><th>For</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
      ${(r.data || []).map(i => `<tr><td><strong>${esc(i.number)}</strong></td><td>${esc(sname(i.school_id))}</td><td>${esc(i.description)}</td><td>${money(i.amount)}</td><td>${esc(FFUI.fmtDate(i.due_date))}</td>
      <td>${badge(i.status === 'paid' ? 'green' : i.status === 'void' ? '' : (i.due_date < today ? 'red' : 'amber'), i.status)}${i.payment_ref ? `<div class="ff-hint">${esc(i.payment_ref)}</div>` : ''}</td>
      <td>${i.status === 'unpaid' ? `<button class="ff-btn ff-btn-primary ff-btn-sm" type="button" onclick="PT.settle('${i.id}',true)">Mark paid</button> <button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="PT.settle('${i.id}',false)">Void</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="ff-card-body">${empty('receipt', 'No invoices yet.')}</div>`}</div>`;
    paint(v);
  }
  function openOp(title, html, ok, fn) {
    $('opTitle').textContent = title; $('opBody').innerHTML = html; $('opOk').textContent = ok;
    $('opOk').onclick = async () => { $('opOk').disabled = true; try { if (await fn()) FFUI.closeModal('op'); } finally { $('opOk').disabled = false; } };
    FFUI.openModal('op');
  }
  function newInvoice() {
    const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    openOp('New invoice', `<div class="ff-field"><label class="ff-label" for="ivSchool">School</label><select class="ff-select" id="ivSchool">${schools.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      <div class="ff-field"><label class="ff-label" for="ivDesc">For</label><input class="ff-input" id="ivDesc" value="FeeFlow subscription"></div>
      <div class="ff-row"><div class="ff-field"><label class="ff-label" for="ivAmt">Amount (KES)</label><input class="ff-input" type="number" id="ivAmt" min="1"></div>
      <div class="ff-field"><label class="ff-label" for="ivDue">Due</label><input class="ff-input" type="date" id="ivDue" value="${due}"></div></div>`, 'Issue invoice', async () => {
      const amt = +$('ivAmt').value; if (!(amt > 0)) { FFUI.toast('Enter an amount.', 'error'); return false; }
      const { error } = await sb.rpc('issue_invoice', { p_school: $('ivSchool').value, p_amount: amt, p_description: $('ivDesc').value, p_due: $('ivDue').value });
      if (error) { fail(error); return false; } toast('Invoice issued.'); renderBilling(); return true; });
  }
  async function settle(id, paid) {
    let ref = null;
    if (paid) { ref = prompt('Payment reference (M-Pesa code or bank ref):'); if (ref === null) return; }
    else if (!confirm('Void this invoice?')) return;
    const { error } = await sb.rpc('settle_invoice', { p_id: id, p_paid: !!paid, p_ref: ref });
    if (error) { fail(error); return; } toast(paid ? 'Marked paid.' : 'Invoice voided.'); renderBilling();
  }

  async function renderTrials() {
    const v = $('view-trials');
    const t = schools.filter(s => s.plan === 'Trial').sort((a, b) => new Date(a.trial_ends_at) - new Date(b.trial_ends_at));
    v.innerHTML = head('clock', 'var(--ff-amber)', 'Trials', 'Schools on the free trial, soonest to expire first. Extending is a manual decision.') +
      `<div class="ff-card">${t.length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>School</th><th>Ends</th><th>Days left</th><th></th></tr></thead><tbody>
      ${t.map(s => { const d = Math.ceil((new Date(s.trial_ends_at) - Date.now()) / 864e5); return `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(FFUI.fmtDate(s.trial_ends_at))}</td><td>${badge(d < 0 ? 'red' : d <= 7 ? 'amber' : 'green', d < 0 ? 'ended' : d + ' days')}</td>
      <td><button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="PT.extend('${s.id}',14)">+14 days</button> <button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="PT.extend('${s.id}',30)">+30 days</button></td></tr>`; }).join('')}
      </tbody></table></div>` : `<div class="ff-card-body">${empty('clock', 'No schools on trial.')}</div>`}</div>`;
    paint(v);
  }
  async function extend(id, days) {
    const s = schools.find(x => x.id === id); if (!s) return;
    const from = Math.max(Date.now(), new Date(s.trial_ends_at || Date.now()).getTime());
    const to = new Date(from + days * 864e5).toISOString();
    const { error } = await sb.from('schools').update({ trial_ends_at: to }).eq('id', id);
    if (error) { fail(error); return; }
    s.trial_ends_at = to; toast('Trial extended by ' + days + ' days.'); renderTrials();
  }

  async function renderSupport(openId) {
    const v = $('view-support');
    const r = await sb.from('support_tickets').select('id, school_id, subject, category, status, created_at, updated_at').order('updated_at', { ascending: false }).limit(100);
    if (r.error) { fail(r.error); return; }
    tickets = r.data || [];
    const rank = { open: 0, answered: 1, closed: 2 };
    tickets.sort((a, b) => rank[a.status] - rank[b.status] || new Date(b.updated_at) - new Date(a.updated_at));
    v.innerHTML = head('mail', 'var(--ff-blue)', 'Support inbox', 'Requests from schools. Open ones first.') +
      `<div class="ff-card">${tickets.length ? `<div class="ff-table-wrap"><table class="ff-table"><thead><tr><th>School</th><th>Subject</th><th>Topic</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
      ${tickets.map(t => `<tr><td>${esc(sname(t.school_id))}</td><td><strong>${esc(t.subject)}</strong></td><td>${esc(t.category)}</td><td>${badge(t.status === 'open' ? 'amber' : t.status === 'answered' ? 'green' : '', t.status)}</td><td>${esc(FFUI.timeAgo(t.updated_at))}</td>
      <td><button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="PT.openTicket('${t.id}')">Open</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="ff-card-body">${empty('mail', 'The inbox is empty.')}</div>`}</div><div id="thread" style="margin-top:18px"></div>`;
    paint(v); if (openId) openTicket(openId);
  }
  async function openTicket(id) {
    const t = tickets.find(x => x.id === id); const box = $('thread'); if (!t) return;
    const r = await sb.from('support_messages').select('id, from_platform, body, created_at').eq('ticket_id', id).order('created_at');
    if (r.error) { fail(r.error); return; }
    box.innerHTML = `<div class="ff-card"><div class="ff-card-head"><div class="ff-card-title">${esc(sname(t.school_id))} — ${esc(t.subject)}</div>${t.status !== 'closed' ? `<button class="ff-btn ff-btn-outline ff-btn-sm" type="button" onclick="PT.closeTicket('${id}')">Close</button>` : badge('', 'closed')}</div>
      <div class="ff-card-body">${(r.data || []).map(m => `<div style="margin-bottom:12px;padding:10px 12px;border-radius:10px;background:${m.from_platform ? 'var(--ff-green-50)' : 'var(--ff-surface-2)'}"><div class="ff-hint">${m.from_platform ? 'FeeFlow team' : 'School'} · ${esc(FFUI.fmtDateTime(m.created_at))}</div><div style="white-space:pre-wrap">${esc(m.body)}</div></div>`).join('')}
      ${t.status !== 'closed' ? `<div class="ff-field"><textarea class="ff-textarea" id="tkReply" rows="3" placeholder="Reply to the school"></textarea></div><button class="ff-btn ff-btn-primary" type="button" onclick="PT.reply('${id}')">Send reply</button>` : ''}</div></div>`;
    paint(box);
  }
  async function reply(id) {
    const body = ($('tkReply').value || '').trim(); if (!body) return;
    const { error } = await sb.rpc('reply_ticket', { p_ticket: id, p_body: body });
    if (error) { fail(error); return; } await renderSupport(id);
  }
  async function closeTicket(id) { const { error } = await sb.rpc('close_ticket', { p_ticket: id }); if (error) fail(error); else toast('Closed.'); renderSupport(id); }

  const RENDER = { health: renderHealth, billing: renderBilling, trials: renderTrials, support: renderSupport };
  async function go(tab) {
    if (!TABS[tab]) return;
    document.querySelectorAll('.ff-view').forEach(x => x.classList.toggle('active', x.id === 'view-' + tab));
    document.querySelectorAll('.ff-nav-item[data-tab]').forEach(x => x.classList.toggle('active', x.getAttribute('data-tab') === tab));
    $('pageTitle').textContent = TABS[tab];
    try { await RENDER[tab](); } catch (e) { fail(e); }
  }
  async function init() {
    sb = FF.sb;
    const me = await FF.requireRole('super_admin');
    if (!me) { $('unauthorizedPage').style.display = 'block'; $('ffApp').style.display = 'none'; return; }
    $('unauthorizedPage').style.display = 'none'; $('ffApp').style.display = 'flex';
    const r = await sb.from('schools').select('id, name, plan, status, trial_ends_at').order('name');
    schools = r.data || [];
    const want = (location.hash || '').replace('#', '');
    await go(TABS[want] ? want : 'health');
  }
  document.addEventListener('DOMContentLoaded', function () {
    FFUI.loadTheme(); const b = $('themeBtn');
    if (b) b.addEventListener('click', () => FFUI.setTheme(FFUI.loadTheme() === 'dark' ? 'light' : 'dark'));
  });
  window.PT = { init, go, TABS, newInvoice, settle, extend, openTicket, reply, closeTicket };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
