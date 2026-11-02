/* FeeFlow shared client: one Supabase connection + sign-in / role helpers used by every page.
 * Load order in each page:  vendor/supabase-*.js  ->  config.js  ->  ff-client.js            */
(() => {
  'use strict';
  const cfg = window.FF_CONFIG;
  if (!cfg || !window.supabase) {
    console.error('FeeFlow: Supabase library or config.js is missing.');
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const ROUTES = { super_admin: 'superadmin.html', school_admin: 'schooladmin.html', parent: 'parent.html' };
  const routeFor = (role) => ROUTES[role] || 'portal.html';

  async function getUser() {
    const { data } = await sb.auth.getSession();
    return data && data.session ? data.session.user : null;
  }

  /** The signed-in user's profile {id, role, school_id, full_name, email}, or null. */
  async function getProfile() {
    const user = await getUser();
    if (!user) return null;
    const { data, error } = await sb.from('profiles')
      .select('id, role, school_id, full_name, staff_role').eq('id', user.id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, email: user.email } : null;
  }

  /** Page guard. Sends the visitor to the login page unless they hold one of `roles`.
   *  (This is only a convenience: the database enforces access with Row Level Security.) */
  async function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    let profile = null;
    try { profile = await getProfile(); } catch (e) { profile = null; }
    if (!profile || !allowed.includes(profile.role)) {
      location.replace('portal.html');
      return null;
    }
    return profile;
  }

  async function signOut() {
    try { await sb.auth.signOut(); } catch (e) { /* clear local state regardless */ }
    location.replace('portal.html');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Turns Supabase / Postgres errors into messages a parent or bursar can act on. */
  function friendlyError(err) {
    if (!err) return 'Something went wrong. Please try again.';
    const msg = String(err.message || err.error_description || err);
    const code = err.code || err.error_code || '';
    if (['22023', '23505', '23514', '54000', '28000'].includes(code)) return msg;   // our own readable database messages
    if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'No internet connection. Check your network and try again.';
    if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the confirmation link.';
    if (/already registered|already been registered|email_exists|user_already_exists/i.test(msg + code)) return 'An account with this email already exists. Please log in instead.';
    if (err.status === 429 || /rate limit|too many/i.test(msg + code)) return 'Too many attempts. Please wait a minute and try again.';
    if (/password should be|weak_password/i.test(msg + code)) return 'Choose a stronger password (at least 8 characters).';
    if (code === '42501' || /permission denied|row-level security/i.test(msg)) return 'You do not have permission to do that.';
    if (code === 'PGRST301' || /jwt expired/i.test(msg)) return 'Your session expired. Please sign in again.';
    return msg || 'Something went wrong. Please try again.';
  }

  window.FF = Object.freeze({ sb, getUser, getProfile, requireRole, signOut, routeFor, escapeHtml, friendlyError });
})();
