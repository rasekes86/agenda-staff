// ============================================
// SUPABASE CONFIGURATION - Single source of truth
// All scripts must read Supabase URL/KEY from here.
// DO NOT duplicate these constants in other files.
// ============================================

const SUPABASE_URL = 'https://iugutcsukxkxlgpkmzxt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE';

// Alias for backward compatibility with pdf-editor-full.js
const SUPABASE_KEY = SUPABASE_ANON_KEY;

// Create Supabase client (using CDN loaded in HTML)
let supabase;

function initSupabase() {
  if (typeof window !== 'undefined' && window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

/**
 * Build authorization headers for Supabase REST API calls.
 * Uses session token when available; NEVER uses anon key as Bearer auth.
 * @returns {Object} Headers object with apikey and Authorization
 */
function getSupabaseHeaders(session) {
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  // Only set Authorization if we have a valid session token
  // NEVER fall back to anon key as Bearer - that bypasses RLS
  if (session && session.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}
