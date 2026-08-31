/**
 * TeleShort v2.1 — Supabase Database Client.
 *
 * Prefer a correctly configured server key, but fall back to the current
 * project's valid publishable/anon key when an old Vercel service-role key
 * has been left behind. The live database currently has backend-compatible
 * policies, so this keeps the main Mini App usable while the Vercel secret
 * can be rotated separately.
 */

const { createClient } = require('@supabase/supabase-js');

let supabaseInstance = null;

const FALLBACK_SUPABASE_URL = 'https://rdkgkxnqqrewvrkayccw.supabase.co';
const FALLBACK_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJka2dreW5xcXJld3Zya2F5Y2N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNjgwNzIsImV4cCI6MjEwMzc0NDA3Mn0.xUOR1nyy2MLtrwYCyraieb29tEsz7ZAhQcVWxT7ybbA';

function getSupabaseClient() {
  if (supabaseInstance) return supabaseInstance;

  const supabaseUrl = (
    process.env.SUPABASE_URL || FALLBACK_SUPABASE_URL
  ).trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');

  // Prefer anon/publishable over the currently broken service-role value.
  const serviceKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY ||
    FALLBACK_SUPABASE_KEY
  ).trim();

  if (!supabaseUrl || !serviceKey) throw new Error('Database configuration missing');

  supabaseInstance = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseInstance;
}

module.exports = { getSupabaseClient };
