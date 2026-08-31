/**
 * TeleShort v2.1 — Supabase Database Client (Service Role)
 * Exclusively used by backend serverless functions to bypass RLS safely.
 */

const { createClient } = require('@supabase/supabase-js');

let supabaseInstance = null;

function getSupabaseClient() {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Database configuration missing: SUPABASE_URL or SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not set.');
  }

  const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');

  supabaseInstance = createClient(cleanUrl, serviceKey.trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return supabaseInstance;
}

module.exports = {
  getSupabaseClient
};
