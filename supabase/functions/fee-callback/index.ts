// fee-callback: PUBLIC endpoint (verify_jwt = false) used by Safaricom and by the scheduled reconciliation job.
//   ?r=stk&s=<school>&t=<token>          STK Push result from Safaricom
//   ?r=c2b-validate&s=..&t=..            paybill-menu payment: may we accept this account number?
//   ?r=c2b-confirm&s=..&t=..             paybill-menu payment: money received
//   ?r=reconcile  (header x-reconcile-token)   settles pushes whose callback never arrived
// Safaricom cannot send a login, so every route checks a secret: a per-school token (vault-backed) or the job token.
import { adminClient, darajaQuery, UUID } from "./_shared.ts";

const ack = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { status: 200, headers: { "Content-Type": "application/json" } });
const reject = () => new Response(JSON.stringify({ ResultCode: "C2B00012", ResultDesc: "Rejected" }), { status: 200, headers: { "Content-Type": "application/json" } });
const forbidden = () => new Response("Forbidden", { status: 403 });
const one = (data: any) => (Array.isArray(data) ? data[0] : data);

// "20261017143022" (Nairobi time) -> ISO string
function parseTransTime(v: unknown): string | null {
  const m = String(v ?? "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00` : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const route = url.searchParams.get("r") ?? "stk";
  const admin = adminClient();

  // ------------------------------------------------------------ scheduled reconciliation
  if (route === "reconcile") {
    const ok = (await admin.rpc("reconcile_token_ok", { p_token: req.headers.get("x-reconcile-token") ?? "" })).data;
    if (!ok) return forbidden();
    const expired = (await admin.rpc("expire_stk_payments")).data ?? 0;
    const { data: pending } = await admin.rpc("pending_stk_payments", { p_min_age: "1 minute", p_max_age: "24 hours" });
    const cfgs = new Map<string, any>();
    let settled = 0, checked = 0;
    for (const p of pending ?? []) {
      if (!cfgs.has(p.school_id)) cfgs.set(p.school_id, one((await admin.rpc("mpesa_get_config", { p_school: p.school_id })).data));
      const cfg = cfgs.get(p.school_id);
      if (!cfg) continue;
      checked++;
      const q = await darajaQuery(cfg, p.checkout_request_id);
      if (q.state === "unknown") continue;                       // still processing: try again on the next run
      const code = q.state === "paid" ? 0 : (q.code ?? 1);
      const res = (await admin.rpc("complete_stk_payment", {
        p_checkout: p.checkout_request_id, p_school: p.school_id, p_amount: q.state === "paid" ? p.amount : null, p_receipt: null,
        p_code: code, p_desc: q.desc ?? null, p_raw: { source: "reconcile", query: q },
      })).data;
      if (res === "completed" || res === "failed") settled++;
    }
    return new Response(JSON.stringify({ expired, checked, settled }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // ------------------------------------------------------------ Safaricom callbacks: authenticate with the school's token
  const school = url.searchParams.get("s") ?? "", token = url.searchParams.get("t") ?? "";
  if (!UUID.test(school) || !token) return forbidden();
  if (!(await admin.rpc("mpesa_token_ok", { p_school: school, p_token: token })).data) return forbidden();
  let body: any;
  try { body = await req.json(); } catch { return ack(); }

  if (route === "c2b-validate") {
    const valid = (await admin.rpc("c2b_account_valid", { p_school: school, p_ref: String(body?.BillRefNumber ?? "") })).data;
    return valid ? ack() : reject();
  }

  if (route === "c2b-confirm") {
    await admin.rpc("record_c2b_payment", {
      p_school: school, p_trans_id: String(body?.TransID ?? ""), p_amount: Number(body?.TransAmount),
      p_bill_ref: String(body?.BillRefNumber ?? ""), p_msisdn: String(body?.MSISDN ?? ""),
      p_name: [body?.FirstName, body?.MiddleName, body?.LastName].filter(Boolean).join(" "),
      p_trans_time: parseTransTime(body?.TransTime), p_raw: body,
    });
    return ack();
  }

  // route === "stk"
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return ack();
  const items: any[] = cb.CallbackMetadata?.Item ?? [];
  const get = (n: string) => items.find((i) => i.Name === n)?.Value;
  const code = Number(cb.ResultCode);
  if (code === 0) {
    // In production we never trust the callback alone: ask Safaricom whether this push really succeeded.
    const cfg = one((await admin.rpc("mpesa_get_config", { p_school: school })).data);
    if (cfg?.environment === "production") {
      const q = await darajaQuery(cfg, cb.CheckoutRequestID);
      if (q.state !== "paid") return ack();                      // leave it pending; the reconciliation job settles it
    }
  }
  await admin.rpc("complete_stk_payment", {
    p_checkout: String(cb.CheckoutRequestID), p_school: school, p_amount: get("Amount") ?? null,
    p_receipt: get("MpesaReceiptNumber") ? String(get("MpesaReceiptNumber")) : null, p_code: code, p_desc: cb.ResultDesc ?? null, p_raw: body,
  });
  return ack();
});
