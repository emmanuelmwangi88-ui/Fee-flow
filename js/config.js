/* FeeFlow public connection settings.
 *
 * The publishable key is DESIGNED to be public: it only identifies the project, and every row of data
 * is protected by Row Level Security in the database. NEVER put a secret / service_role key, a Daraja
 * key or any password in this file or anywhere else in the repo. */
window.FF_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://kwuhuvkxvylgzohkrcqt.supabase.co',
  SUPABASE_KEY: 'sb_publishable_2sDXj0qKTgizEiEdDPY06A_Vt9Fk4hT'
});
