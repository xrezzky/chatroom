// XREZZKY Chat — config.js
// Credential HANYA dari Vercel API route — TIDAK ada hardcode

const { createClient } = window.supabase;

let sb     = null;
let CLOUD  = null;
let PRESET = null;

async function fetchConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const cfg = await res.json();
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !cfg.cloudName) {
      throw new Error('Config tidak lengkap');
    }
    sb = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: {
        persistSession:     true,
        storageKey:         'xrezzky-session',
        storage:            window.localStorage,
        autoRefreshToken:   true,
        detectSessionInUrl: true
      }
    });
    CLOUD  = cfg.cloudName;
    PRESET = cfg.cloudPreset;
    return true;
  } catch (e) {
    console.error('[Config] gagal:', e.message);
    return false;
  }
}
