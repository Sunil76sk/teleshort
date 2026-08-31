/** TeleShort v2.1 — Supabase Database Client */
const { createClient } = require('@supabase/supabase-js');
let supabaseInstance = null;

function getSupabaseClient(){
  if(supabaseInstance) return supabaseInstance;

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');
  // Server-side APIs must use a secret/service key. The anon/publishable key is intentionally
  // rejected here because protected tables (ad_sessions, ad_events, wallet, etc.) use RLS.
  const key = String(
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim();

  if(!supabaseUrl) throw new Error('SUPABASE_URL is not configured');
  if(!key) throw new Error('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is not configured for the server');

  supabaseInstance = createClient(supabaseUrl, key, {
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{'x-teleshort-server-key':String(process.env.TELESHORT_DB_HEADER_KEY || '').trim()}}
  });
  return supabaseInstance;
}

module.exports = { getSupabaseClient };
