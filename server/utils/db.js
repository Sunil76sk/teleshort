/** TeleShort v2.1 — Supabase Database Client */
const { createClient } = require('@supabase/supabase-js');

let supabaseInstance=null;
const FALLBACK_SUPABASE_URL='https://rdkgkxnqqrewvrkayccw.supabase.co';
const FALLBACK_SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJka2dreW5xcXJld3Zya2F5Y2N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNjgwNzIsImV4cCI6MjEwMzc0NDA3Mn0.xUOR1nyy2MLtrwYCyraieb29tEsz7ZAhQcVWxT7ybbA';
// This header is required by the database RLS policies for backend-only tables.
// Financial RPCs additionally require CHALLENGE_SECRET and never trust this header alone.
const BACKEND_DB_HEADER_KEY=process.env.TELESHORT_DB_HEADER_KEY||'3MISxZiEo4jebdVnkIMN1H070TLl15XtLPS6VCXBfFGFhMkdN1_5VQjsJfPt9Ih2';

function getSupabaseClient(){
  if(supabaseInstance)return supabaseInstance;
  const supabaseUrl=(process.env.SUPABASE_URL||FALLBACK_SUPABASE_URL).trim().replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');
  const key=(process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY||process.env.SUPABASE_KEY||FALLBACK_SUPABASE_KEY).trim();
  if(!supabaseUrl||!key)throw new Error('Database configuration missing');
  supabaseInstance=createClient(supabaseUrl,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{'x-teleshort-server-key':BACKEND_DB_HEADER_KEY}}});
  return supabaseInstance;
}
module.exports={getSupabaseClient};
