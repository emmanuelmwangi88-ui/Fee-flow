// admin-create-school: Super Admin creates a school AND its School Admin login in one atomic-ish step.
// Needs the service role (auth.admin API), so it must run on the server, never in the browser.
// Deployed with verify_jwt = true. Live-tested: 401 (no/anon token), 403 (non-super), 400 (validation),
// 409 (duplicate email, school rolled back), 200 (success).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PLANS = ["Trial", "Standard", "Premium"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Who is calling, and are they the platform Super Admin?
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);
  const caller = userData.user;
  const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", caller.id).maybeSingle();
  if (callerProfile?.role !== "super_admin") return json({ error: "Only the Super Admin can create schools" }, 403);

  // 2. Validate input
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(b.name);
  const location = str(b.location);
  const level = str(b.level);
  const paybill = str(b.paybill);
  const plan = str(b.plan) || "Trial";
  const adminEmail = str(b.admin_email).toLowerCase();
  const adminName = str(b.admin_name);
  const adminPassword = typeof b.admin_password === "string" ? b.admin_password : "";

  if (name.length < 2 || name.length > 120) return json({ error: "Enter the school name (2-120 characters)" }, 400);
  if (location.length > 120) return json({ error: "Location is too long" }, 400);
  if (level.length > 40) return json({ error: "Level is too long" }, 400);
  if (paybill && !/^[0-9]{5,7}$/.test(paybill)) return json({ error: "Paybill must be 5 to 7 digits" }, 400);
  if (!PLANS.includes(plan)) return json({ error: "Unknown plan" }, 400);
  if (!EMAIL.test(adminEmail)) return json({ error: "Enter a valid admin email address" }, 400);
  if (adminPassword.length < 10 || adminPassword.length > 72) return json({ error: "Admin password must be 10 to 72 characters" }, 400);

  // 3. Create school -> admin login -> profile; undo everything if any step fails
  const { data: school, error: schoolErr } = await admin.from("schools")
    .insert({ name, location: location || null, level: level || null, paybill: paybill || null, plan })
    .select("id").single();
  if (schoolErr || !school) return json({ error: "Could not create the school" }, 400);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: adminName || `${name} Admin` },
  });
  if (createErr || !created?.user) {
    await admin.from("schools").delete().eq("id", school.id);
    const exists = /already|exists|registered/i.test(`${createErr?.message ?? ""} ${createErr?.code ?? ""}`);
    return json({ error: exists ? "An account with that email already exists" : "Could not create the admin login" }, exists ? 409 : 400);
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: created.user.id, role: "school_admin", school_id: school.id, full_name: adminName || `${name} Admin`,
  });
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("schools").delete().eq("id", school.id);
    return json({ error: "Could not finish setting up the admin" }, 500);
  }

  await admin.from("audit_log").insert({
    school_id: school.id, actor_id: caller.id, action: "school_admin_created", entity: "profiles",
    entity_id: created.user.id, details: { email: adminEmail },
  });

  return json({ school_id: school.id, admin_user_id: created.user.id, admin_email: adminEmail });
});
