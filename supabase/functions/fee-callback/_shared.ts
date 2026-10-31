// Shared helpers for the FeeFlow Edge Functions (identical copy lives next to each function's index.ts).
import { createClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const adminClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export type Caller = { id: string; email?: string; role: string | null; schoolId: string | null };
export async function getCaller(req: Request, admin: any): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await admin.from("profiles").select("role, school_id").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, email: data.user.email, role: profile?.role ?? null, schoolId: profile?.school_id ?? null };
}

// Kenyan numbers -> 2547XXXXXXXX / 2541XXXXXXXX (same rules as the database).
export function normalizePhone(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^0[17]\d{8}$/.test(d)) return "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) return "254" + d;
  return null;
}

// Messages from our own database rules are written for people; anything else becomes a generic message.
export function dbError(error: any): { message: string; status: number } {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "");
  if (code === "22023") return { message: msg, status: 400 };
  if (code === "42501") return { message: msg || "Not allowed", status: 403 };
  if (code === "55000") return { message: msg, status: 409 };
  if (code === "55006") return { message: msg, status: 429 };
  return { message: "Something went wrong. Please try again.", status: 500 };
}

// ---------------------------------------------------------------- Daraja (M-Pesa)
export const DARAJA: Record<string, string> = { sandbox: "https://sandbox.safaricom.co.ke", production: "https://api.safaricom.co.ke" };
const tokenCache = new Map<string, { token: string; exp: number }>();
export class DarajaError extends Error { constructor(m: string, public status = 0) { super(m); } }

export async function darajaToken(env: string, key: string, secret: string, f: typeof fetch = fetch): Promise<string> {
  const ck = `${env}:${key}:${secret.slice(-4)}`;
  const hit = tokenCache.get(ck);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const res = await f(`${DARAJA[env]}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: "Basic " + btoa(`${key}:${secret}`) }, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new DarajaError("Safaricom rejected the consumer key and secret", res.status);
  const j = await res.json().catch(() => null);
  if (!j?.access_token) throw new DarajaError("Safaricom did not return an access token", res.status);
  tokenCache.set(ck, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3599) * 1000 });
  return j.access_token;
}
export function darajaTimestamp(d = new Date()): string {      // Africa/Nairobi is UTC+3
  const t = new Date(d.getTime() + 3 * 3600_000), p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
}
export const darajaPassword = (shortcode: string, passkey: string, ts: string) => btoa(shortcode + passkey + ts);
export async function darajaPost(env: string, path: string, token: string, body: unknown, f: typeof fetch = fetch) {
  const res = await f(DARAJA[env] + path, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
  });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
// Asks Safaricom what really happened to a push. 'paid' | 'failed' (with code) | 'unknown' (still processing / error)
export async function darajaQuery(cfg: any, checkoutId: string, f: typeof fetch = fetch): Promise<{ state: "paid" | "failed" | "unknown"; code?: number; desc?: string }> {
  try {
    const token = await darajaToken(cfg.environment, cfg.consumer_key, cfg.consumer_secret, f);
    const ts = darajaTimestamp();
    const r = await darajaPost(cfg.environment, "/mpesa/stkpushquery/v1/query", token, {
      BusinessShortCode: cfg.shortcode, Password: darajaPassword(cfg.shortcode, cfg.passkey, ts), Timestamp: ts, CheckoutRequestID: checkoutId,
    }, f);
    const j = r.json;
    if (!j || j.errorCode || String(j.ResponseCode) !== "0" || j.ResultCode === undefined) return { state: "unknown", desc: j?.errorMessage };
    const code = Number(j.ResultCode);
    return code === 0 ? { state: "paid", code, desc: j.ResultDesc } : { state: "failed", code, desc: j.ResultDesc };
  } catch (_e) { return { state: "unknown" }; }
}

// ---------------------------------------------------------------- Africa's Talking (SMS)
export type SmsConfig = { username: string; apiKey: string };
const atBase = (u: string) => (u === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com");
export async function atCheck(cfg: SmsConfig, f: typeof fetch = fetch): Promise<boolean> {
  const res = await f(`${atBase(cfg.username)}/version1/user?username=${encodeURIComponent(cfg.username)}`, {
    headers: { apiKey: cfg.apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(15000),
  });
  return res.ok;
}
export async function atSend(cfg: SmsConfig, phones: string[], message: string, from?: string | null, f: typeof fetch = fetch) {
  const body = new URLSearchParams({ username: cfg.username, to: phones.map((p) => "+" + p).join(","), message });
  if (from) body.set("from", from);
  let res: Response;
  try {
    res = await f(`${atBase(cfg.username)}/version1/messaging`, {
      method: "POST", headers: { apiKey: cfg.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body, signal: AbortSignal.timeout(20000),
    });
  } catch (_e) { return phones.map((phone) => ({ phone, ok: false, ref: null as string | null, cost: "", error: "Could not reach the SMS provider" })); }
  const j: any = await res.json().catch(() => null);
  const rec: any[] = j?.SMSMessageData?.Recipients ?? [];
  return phones.map((phone) => {
    const r = rec.find((x) => String(x.number).replace("+", "") === phone);
    const ok = !!r && [100, 101, 102].includes(Number(r.statusCode));
    return { phone, ok, ref: (r?.messageId as string) ?? null, cost: String(r?.cost ?? ""), error: ok ? "" : (r?.status || (res.ok ? "No status returned" : `SMS provider error ${res.status}`)) };
  });
}
export async function loadSmsConfig(admin: any): Promise<SmsConfig | null> {
  const { data } = await admin.rpc("sms_get_config");
  const row = Array.isArray(data) ? data[0] : data;
  return row?.username && row?.api_key ? { username: row.username, apiKey: row.api_key } : null;
}
export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
