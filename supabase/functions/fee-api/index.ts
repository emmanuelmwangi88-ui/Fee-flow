// fee-api: authenticated actions (verify_jwt = true). The browser sends { action, ... }.
//   stk_push     parent   start an M-Pesa STK Push for one child
//   mpesa_save   school admin / super admin   test + store Daraja credentials (encrypted in Vault)
//   mpesa_remove / mpesa_status
//   send_message school admin   bulk message or fee reminder: in-app (parents' portal) and/or SMS
//   otp_request / otp_verify    parent   verify the phone number by SMS code
//   sms_save / sms_remove       super admin   platform SMS provider credentials
import {
  adminClient, atCheck, atSend, cors, darajaPassword, darajaPost, darajaTimestamp, darajaToken, DarajaError, dbError,
  getCaller, hmacHex, json, loadSmsConfig, normalizePhone, UUID, type Caller,
} from "./_shared.ts";

const one = (data: any) => (Array.isArray(data) ? data[0] : data);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const baseUrl = () => Deno.env.get("SUPABASE_URL")!;

// ------------------------------------------------------------------ M-Pesa STK Push
async function stkPush(admin: any, caller: Caller, b: any) {
  if (caller.role !== "parent") return json({ error: "Only parents can pay school fees here" }, 403);
  const studentId = str(b.student_id, 60), amount = Number(b.amount), phone = normalizePhone(b.phone);
  if (!UUID.test(studentId)) return json({ error: "Choose a child to pay for" }, 400);
  if (!phone) return json({ error: "Enter a valid Safaricom number" }, 400);

  const created = await admin.rpc("create_stk_payment", { p_user: caller.id, p_student: studentId, p_amount: amount, p_phone: phone });
  if (created.error) { const e = dbError(created.error); return json({ error: e.message }, e.status); }
  const pay = one(created.data);
  const fail = (desc: string) => admin.rpc("set_stk_request_result", { p_payment: pay.payment_id, p_merchant: null, p_checkout: null, p_ok: false, p_desc: desc });

  const cfg = one((await admin.rpc("mpesa_get_config", { p_school: pay.school_id })).data);
  if (!cfg) { await fail("M-Pesa is not configured"); return json({ error: "M-Pesa is not set up for this school yet" }, 409); }
  try {
    const token = await darajaToken(cfg.environment, cfg.consumer_key, cfg.consumer_secret);
    const ts = darajaTimestamp();
    const r = await darajaPost(cfg.environment, "/mpesa/stkpush/v1/processrequest", token, {
      BusinessShortCode: cfg.shortcode, Password: darajaPassword(cfg.shortcode, cfg.passkey, ts), Timestamp: ts,
      TransactionType: cfg.shortcode_type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: Math.round(amount), PartyA: phone, PartyB: cfg.shortcode, PhoneNumber: phone,
      CallBackURL: `${baseUrl()}/functions/v1/fee-callback?r=stk&s=${pay.school_id}&t=${cfg.callback_token}`,
      AccountReference: String(pay.admission_no).replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || "FEES", TransactionDesc: "School fees",
    });
    const j = r.json;
    if (j && String(j.ResponseCode) === "0" && j.CheckoutRequestID) {
      await admin.rpc("set_stk_request_result", { p_payment: pay.payment_id, p_merchant: j.MerchantRequestID ?? null, p_checkout: j.CheckoutRequestID, p_ok: true, p_desc: null });
      return json({ ok: true, payment_id: pay.payment_id, mode: cfg.environment, message: j.CustomerMessage ?? "Check your phone" });
    }
    const why = j?.errorMessage || j?.ResponseDescription || "M-Pesa could not start the payment";
    await fail(why);
    return json({ error: `M-Pesa could not start the payment (${why}). Please try again or pay from your M-Pesa menu.` }, 502);
  } catch (e) {
    await fail(e instanceof DarajaError ? e.message : "Could not reach M-Pesa");
    return json({ error: e instanceof DarajaError ? "The school's M-Pesa connection needs attention. Please pay from your M-Pesa menu for now." : "Could not reach M-Pesa. Please try again in a moment." }, 502);
  }
}

// ------------------------------------------------------------------ M-Pesa configuration
function targetSchool(caller: Caller, b: any): string | null {
  if (caller.role === "school_admin") return caller.schoolId;
  if (caller.role === "super_admin") return UUID.test(str(b.school_id, 60)) ? str(b.school_id, 60) : null;
  return null;
}
async function mpesaStatus(admin: any, school: string) {
  const cfg = one((await admin.rpc("mpesa_get_config", { p_school: school })).data);
  return cfg ? { configured: true, environment: cfg.environment, shortcode: cfg.shortcode, shortcode_type: cfg.shortcode_type, c2b_registered: !!cfg.c2b_registered }
             : { configured: false };
}
async function mpesaSave(admin: any, caller: Caller, b: any) {
  const school = targetSchool(caller, b);
  if (!school) return json({ error: "Not allowed" }, 403);
  const env = str(b.environment, 12), shortcode = str(b.shortcode, 10), type = str(b.shortcode_type, 10) || "paybill";
  const key = str(b.consumer_key, 200), secret = str(b.consumer_secret, 200), passkey = str(b.passkey, 300);
  if (!["sandbox", "production"].includes(env)) return json({ error: "Choose sandbox or production" }, 400);
  if (!/^[0-9]{5,7}$/.test(shortcode)) return json({ error: "The paybill / till number must be 5 to 7 digits" }, 400);
  if (!["paybill", "till"].includes(type)) return json({ error: "Choose paybill or till" }, 400);
  if (key.length < 8 || secret.length < 8 || passkey.length < 16) return json({ error: "Paste the full consumer key, consumer secret and passkey from the Daraja portal" }, 400);

  let token: string;                                   // prove the credentials are real BEFORE storing anything
  try { token = await darajaToken(env, key, secret); }
  catch (e) {
    return json({ error: e instanceof DarajaError ? `Safaricom rejected these credentials (${env}). Check the consumer key and secret, and that the app is a ${env} app.` : "Could not reach Safaricom. Please try again." }, 400);
  }
  const saved = await admin.rpc("mpesa_save_config", { p_school: school, p_env: env, p_shortcode: shortcode, p_type: type, p_key: key, p_secret: secret, p_passkey: passkey });
  if (saved.error) return json({ error: "Could not save the M-Pesa settings" }, 500);

  let c2b = false;                                     // paybill-menu payments: register our confirmation URLs (best effort)
  try {
    const cfg = one((await admin.rpc("mpesa_get_config", { p_school: school })).data);
    const u = `${baseUrl()}/functions/v1/fee-callback?s=${school}&t=${cfg.callback_token}`;
    const r = await darajaPost(env, "/mpesa/c2b/v2/registerurl", token, { ShortCode: shortcode, ResponseType: "Completed", ConfirmationURL: u + "&r=c2b-confirm", ValidationURL: u + "&r=c2b-validate" });
    c2b = String(r.json?.ResponseCode ?? "") === "0" || /success/i.test(String(r.json?.ResponseDescription ?? ""));
  } catch (_e) { /* optional */ }
  await admin.rpc("mpesa_mark_c2b", { p_school: school, p_ok: c2b });
  await admin.from("audit_log").insert({ school_id: school, actor_id: caller.id, action: "mpesa_config_saved", entity: "school_mpesa_config", entity_id: school, details: { environment: env, shortcode } });
  return json({ ok: true, mode: env === "production" ? "live" : "sandbox", c2b_registered: c2b });
}
async function mpesaRemove(admin: any, caller: Caller, b: any) {
  const school = targetSchool(caller, b);
  if (!school) return json({ error: "Not allowed" }, 403);
  await admin.rpc("mpesa_remove_config", { p_school: school });
  await admin.from("audit_log").insert({ school_id: school, actor_id: caller.id, action: "mpesa_config_removed", entity: "school_mpesa_config", entity_id: school });
  return json({ ok: true });
}

// ------------------------------------------------------------------ bulk messages and fee reminders
async function sendMessage(admin: any, caller: Caller, b: any) {
  if (caller.role !== "school_admin" || !caller.schoolId) return json({ error: "Only a school admin can send messages" }, 403);
  const schoolId = caller.schoolId;
  const mode = b.mode === "reminder" ? "reminder" : "message";
  const channels = { inapp: b.channels?.inapp !== false, sms: !!b.channels?.sms };
  const title = mode === "reminder" ? "Fee Balance Reminder" : str(b.title, 120);
  const text = str(b.message, 1000);
  if (!channels.inapp && !channels.sms) return json({ error: "Choose at least one way to send (in-app or SMS)" }, 400);
  if (mode === "message" && (title.length < 2 || text.length < 2)) return json({ error: "Enter a title and a message" }, 400);
  if (channels.sms && mode === "message" && text.length > 320) return json({ error: "SMS messages can be at most 320 characters" }, 400);

  const { data: school } = await admin.from("schools").select("name, paybill, sms_sender").eq("id", schoolId).maybeSingle();
  const schoolName = school?.name ?? "School";
  let sel = admin.from("student_balances").select("id, full_name, class_name, admission_no, balance, guardian_phone")
    .eq("school_id", schoolId).eq("verified", true).eq("active", true).limit(5000);
  const ids = Array.isArray(b.student_ids) ? b.student_ids.filter((x: unknown) => typeof x === "string" && UUID.test(x)) : [];
  if (ids.length) sel = sel.in("id", ids.slice(0, 5000));
  let list: any[] = (await sel).data ?? [];
  const classes: string[] = Array.isArray(b.class_names) ? b.class_names.map((c: unknown) => str(c, 40)).filter(Boolean) : [];
  if (classes.length) list = list.filter((s) => classes.includes(s.class_name) || classes.includes(String(s.class_name).replace(/[A-Z]$/, "").trim()));
  if (mode === "reminder" || b.only_owing) list = list.filter((s) => Number(s.balance) > 0);
  if (!list.length) return json({ error: "No students match this selection" }, 400);
  if (list.length > 2000) return json({ error: "Too many recipients at once (the limit is 2,000). Narrow the selection." }, 400);

  // who is linked to these children?
  const byStudent = new Map<string, any>(list.map((s) => [s.id, s]));
  const links: any[] = [];
  for (const part of chunk(list.map((s) => s.id), 400)) {
    links.push(...((await admin.from("parent_students").select("parent_id, student_id").eq("status", "active").in("student_id", part)).data ?? []));
  }
  const parentIds = [...new Set(links.map((l) => l.parent_id))];
  const parents = new Map<string, any>();
  for (const part of chunk(parentIds, 400)) {
    for (const p of ((await admin.from("parents").select("id, phone").in("id", part)).data ?? [])) parents.set(p.id, p);
  }
  const perParent = new Map<string, { students: any[] }>();
  for (const l of links) { const e = perParent.get(l.parent_id) ?? { students: [] }; e.students.push(byStudent.get(l.student_id)); perParent.set(l.parent_id, e); }

  // ---- in-app: appears in the parent's portal notifications
  let inapp = 0;
  if (channels.inapp) {
    const rows = [...perParent.entries()].map(([parent_id, e]) => ({
      audience: "parent", school_id: schoolId, parent_id, type: mode === "reminder" ? "fee-reminder" : "announcement", title,
      body: mode === "reminder"
        ? `${schoolName}: Remaining fee balance for ${e.students.map((s) => s.full_name).join(", ")} is KES ${money(e.students.reduce((a, s) => a + Number(s.balance), 0))}.`
        : text,
    }));
    for (const part of chunk(rows, 400)) {
      const ins = await admin.from("notifications").insert(part);
      if (ins.error) return json({ error: "Could not deliver the in-app messages. Nothing was sent by SMS." }, 500);
      inapp += part.length;
    }
  }

  // ---- SMS
  const sms = { enabled: false, sent: 0, failed: 0, skipped_recent: 0, reason: "", cost: "" };
  if (channels.sms) {
    const cfg = await loadSmsConfig(admin);
    if (!cfg) sms.reason = "SMS is not switched on for FeeFlow yet, so only in-app messages were sent.";
    else {
      sms.enabled = true;
      const targets = new Map<string, { students: any[] }>();               // phone -> students
      const add = (phone: string | null, s: any) => { if (!phone) return; const e = targets.get(phone) ?? { students: [] }; if (!e.students.includes(s)) e.students.push(s); targets.set(phone, e); };
      for (const s of list) {
        const guardian = normalizePhone(s.guardian_phone);
        if (guardian) add(guardian, s);
        else for (const l of links.filter((x) => x.student_id === s.id)) add(normalizePhone(parents.get(l.parent_id)?.phone), s);
      }
      if (mode === "message") for (const l of links) add(normalizePhone(parents.get(l.parent_id)?.phone), byStudent.get(l.student_id));
      let phones = [...targets.keys()];
      if (mode === "reminder") {                                             // at most one reminder SMS per number per day
        const recent = new Set<string>();
        for (const part of chunk(phones, 300)) {
          for (const r of ((await admin.from("sms_log").select("phone").eq("school_id", schoolId).eq("kind", "reminder").eq("status", "sent")
            .gte("created_at", new Date(Date.now() - 20 * 3600_000).toISOString()).in("phone", part)).data ?? [])) recent.add(r.phone);
        }
        sms.skipped_recent = phones.filter((p) => recent.has(p)).length;
        phones = phones.filter((p) => !recent.has(p));
      }
      const log: any[] = []; let cost = 0;
      const record = (phone: string, message: string, ok: boolean, ref: string | null, error: string, c: string) => {
        log.push({ school_id: schoolId, phone, kind: mode, message, status: ok ? "sent" : "failed", provider_ref: ref, error: error || null });
        if (ok) sms.sent++; else sms.failed++; cost += parseFloat(c.replace(/[^0-9.]/g, "")) || 0;
      };
      if (mode === "message") {
        const message = `${schoolName}: ${text}`;
        for (const part of chunk(phones, 100)) for (const r of await atSend(cfg, part, message, school?.sms_sender)) record(r.phone, message, r.ok, r.ref, r.error, r.cost);
      } else {                                                               // reminders are personal: balance + how to pay
        for (const part of chunk(phones, 10)) {
          await Promise.all(part.map(async (phone) => {
            const st = targets.get(phone)!.students, total = st.reduce((a, s) => a + Number(s.balance), 0);
            const pay = school?.paybill ? ` Pay via M-Pesa Paybill ${school.paybill}, A/C ${st.map((s) => s.admission_no).join("/")}.` : "";
            const message = `${schoolName}: Fee balance for ${st.map((s) => s.full_name).join(", ")} is KES ${money(total)}.${pay}`.slice(0, 320);
            const [r] = await atSend(cfg, [phone], message, school?.sms_sender);
            record(phone, message, r.ok, r.ref, r.error, r.cost);
          }));
        }
      }
      for (const part of chunk(log, 400)) await admin.from("sms_log").insert(part);
      sms.cost = cost ? `KES ${cost.toFixed(2)}` : "";
    }
  }

  await admin.from("reminder_history").insert({
    school_id: schoolId, sent_by: caller.id, recipient_count: inapp || perParent.size, channels: [channels.inapp && "website", channels.sms && "sms"].filter(Boolean),
    kind: mode, title, audience: classes.length ? classes.join(", ") : (ids.length ? `${list.length} selected` : "All matching"), sms_sent: sms.sent, sms_failed: sms.failed,
  });
  return json({ ok: true, students: list.length, parents_notified: inapp, no_parent_linked: list.filter((s) => !links.some((l) => l.student_id === s.id)).length, sms });
}

// ------------------------------------------------------------------ phone verification
async function otpRequest(admin: any, caller: Caller, b: any) {
  if (caller.role !== "parent") return json({ error: "Not allowed" }, 403);
  const parentId = str(b.parent_id, 60);
  if (!UUID.test(parentId)) return json({ error: "Unknown account" }, 400);
  const cfg = await loadSmsConfig(admin);
  if (!cfg) return json({ error: "SMS verification is not available yet. The school can approve your link requests instead." }, 503);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const hash = await hmacHex(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, `${parentId}:${code}`);
  const made = await admin.rpc("phone_otp_create", { p_user: caller.id, p_parent: parentId, p_hash: hash });
  if (made.error) { const e = dbError(made.error); return json({ error: e.message }, e.status); }
  const phone = String(made.data);
  const message = `Your FeeFlow verification code is ${code}. It expires in 10 minutes. Do not share it.`;
  const [r] = await atSend(cfg, [phone], message, null);
  const { data: prow } = await admin.from("parents").select("school_id").eq("id", parentId).maybeSingle();
  await admin.from("sms_log").insert({ school_id: prow?.school_id ?? null, parent_id: parentId, phone, kind: "otp", message: "Verification code (hidden)", status: r.ok ? "sent" : "failed", provider_ref: r.ref, error: r.error || null });
  if (!r.ok) return json({ error: "We could not send the SMS. Please try again in a moment." }, 502);
  return json({ ok: true, sent_to: "+" + phone.slice(0, 5) + "•••••" + phone.slice(-3) });
}
async function otpVerify(admin: any, caller: Caller, b: any) {
  if (caller.role !== "parent") return json({ error: "Not allowed" }, 403);
  const parentId = str(b.parent_id, 60), code = str(b.code, 10);
  if (!UUID.test(parentId) || !/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code" }, 400);
  const hash = await hmacHex(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, `${parentId}:${code}`);
  const res = String((await admin.rpc("phone_otp_check", { p_user: caller.id, p_parent: parentId, p_hash: hash })).data ?? "denied");
  if (res.startsWith("ok:")) return json({ ok: true, approved: Number(res.slice(3)) });
  const map: Record<string, [string, number]> = { wrong: ["That code is not right. Please check and try again.", 400], expired: ["That code has expired. Ask for a new one.", 400], locked: ["Too many wrong tries. Ask for a new code in a minute.", 429], denied: ["Not allowed", 403] };
  const [message, status] = map[res] ?? ["Could not verify the code", 400];
  return json({ error: message }, status);
}

// ------------------------------------------------------------------ platform SMS provider
async function smsSave(admin: any, caller: Caller, b: any) {
  if (caller.role !== "super_admin") return json({ error: "Only the platform admin can do this" }, 403);
  if (b.remove) { await admin.rpc("sms_remove_config"); return json({ ok: true, enabled: false }); }
  const username = str(b.username, 60), apiKey = str(b.api_key, 200);
  if (username.length < 3 || apiKey.length < 16) return json({ error: "Enter your Africa's Talking username and API key" }, 400);
  let ok = false;
  try { ok = await atCheck({ username, apiKey }); } catch (_e) { /* handled below */ }
  if (!ok) return json({ error: "Africa's Talking rejected these details. Check the username and API key." }, 400);
  const saved = await admin.rpc("sms_save_config", { p_username: username, p_api_key: apiKey });
  if (saved.error) return json({ error: "Could not save the SMS settings" }, 500);
  await admin.from("audit_log").insert({ actor_id: caller.id, action: "sms_config_saved", entity: "platform_settings", entity_id: "sms" });
  return json({ ok: true, enabled: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = adminClient();
  const caller = await getCaller(req, admin);
  if (!caller) return json({ error: "Not signed in" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  try {
    switch (b?.action) {
      case "stk_push": return await stkPush(admin, caller, b);
      case "mpesa_save": return await mpesaSave(admin, caller, b);
      case "mpesa_remove": return await mpesaRemove(admin, caller, b);
      case "mpesa_status": { const s = targetSchool(caller, b); return s ? json(await mpesaStatus(admin, s)) : json({ error: "Not allowed" }, 403); }
      case "send_message": return await sendMessage(admin, caller, b);
      case "otp_request": return await otpRequest(admin, caller, b);
      case "otp_verify": return await otpVerify(admin, caller, b);
      case "sms_save": return await smsSave(admin, caller, b);
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (_e) {
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
