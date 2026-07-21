// XREZZKY Chat — config.js
// Credential diambil dari Vercel API route (bukan hardcoded)

const { createClient } = window.supabase;

// State global sementara — diisi setelah fetchConfig()
let sb     = null;
let CLOUD  = null;
let PRESET = null;

async function fetchConfig() {
  try {
    const res  = await fetch('/api/config');
    if (!res.ok) throw new Error('Config fetch failed: ' + res.status);
    const cfg  = await res.json();

    if (!cfg.supabaseUrl || !cfg.supabaseKey) throw new Error('Config tidak lengkap');

    sb = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: {
        persistSession:    true,
        storageKey:        'xrezzky-session',
        storage:           window.localStorage,
        autoRefreshToken:  true,
        detectSessionInUrl: true
      }
    });

    CLOUD  = cfg.cloudName;
    PRESET = cfg.cloudPreset;

    console.log('[Config] loaded ✅');
    return true;
  } catch (e) {
    console.error('[Config] gagal:', e.message);

    // FALLBACK untuk development lokal
    // HAPUS ini sebelum deploy ke production!
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.warn('[Config] Menggunakan fallback local dev config');
      sb = createClient(
        'https://ewmxwzwudwefwabnfgqu.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3bXh3end1ZHdlZndhYm5mZ3F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTY5MTUsImV4cCI6MjA5NDQzMjkxNX0.R4fb-wcqC1F_lA4t32WHinoR2zRdA3DFScny8lyWysA',
        { auth: { persistSession: true, storageKey: 'xrezzky-session', storage: window.localStorage, autoRefreshToken: true, detectSessionInUrl: true } }
      );
      CLOUD  = 'dknodp2zg';
      PRESET = 'chat_Unsigned';
      return true;
    }
    return false;
  }
}
