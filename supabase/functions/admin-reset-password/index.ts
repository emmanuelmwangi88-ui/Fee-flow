// admin-reset-password: Super Admin sets a new password for a school's administrator.
// Needs the service role (auth.admin API), so it runs on the server only. Deployed with verify_jwt = true.
// Live-tested: 401 (no token), 403 (school admin), 400 (short password / bad id), 404 (unknown school),
// 200 (new password works, old password rejected).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Only the platform Super Admin may do this
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);
  const caller = userData.user;
  const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", caller.id).maybeSingle();
  if (callerProfile?.role !== "super_admin") return json({ error: "Only the Super Admin can reset an admin password" }, 403);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const schoolId = typeof b.school_id === "string" ? b.school_id : "";
  const newPassword = typeof b.new_password === "string" ? b.new_password : "";
  if (!UUID.test(schoolId)) return json({ error: "Unknown school" }, 400);
  if (newPassword.length < 10 || newPassword.length > 72) return json({ error: "Password must be 10 to 72 characters" }, 400);

  // The target must be a SCHOOL ADMIN of that school (never a super admin or a parent)
  const { data: target } = await admin.from("profiles").select("id")
    .eq("school_id", schoolId).eq("role", "school_admin").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!target) return json({ error: "No administrator found for this school" }, 404);

  const { error: updErr } = await admin.auth.admin.updateUserById(target.id, { password: newPassword });
  if (updErr) return json({ error: "Could not reset the password. Try a stronger one." }, 400);

  await admin.from("audit_log").insert({
    school_id: schoolId, actor_id: caller.id, action: "school_admin_password_reset", entity: "profiles", entity_id: target.id,
  });
  return json({ ok: true });
});
