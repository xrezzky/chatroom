// XREZZKY Chat — auth.js
// Auth handler — dipanggil SETELAH fetchConfig() selesai

// ════════════════════════════════
//  INIT AUTH (dipanggil dari bootstrap)
// ════════════════════════════════
function initAuth() {
  // Subscribe auth state
  sb.auth.onAuthStateChange(async (event, session) => {
    console.log('[auth]', event, session?.user?.email || '-');

    if (event === 'PASSWORD_RECOVERY') {
      showScreen('screen-reset-password');
      return;
    }

    if (event === 'SIGNED_OUT') {
      if (_intentionalLogout) {
        _intentionalLogout = false;
        _appInited = false;
        ME = null; MY_PROFILE = null;
        showScreen('screen-auth');
      }
      return;
    }

    if (session?.user) {
      if (_appInited && ME?.id === session.user.id) return;
      ME = session.user;
      showScreen('screen-app');
      if (!_appInited) { _appInited = true; initApp(); }
      loadMyProfile().catch(e => console.error('loadMyProfile:', e));
      return;
    }

    if (event === 'INITIAL_SESSION' && !session) {
      showScreen('screen-auth');
    }
  });

  // Cek session existing
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      if (_appInited) return;
      ME = session.user;
      showScreen('screen-app');
      _appInited = true;
      initApp();
      loadMyProfile().catch(e => console.error('loadMyProfile:', e));
    } else {
      showScreen('screen-auth');
    }
  }).catch(() => showScreen('screen-auth'));
}

// ════════════════════════════════
//  AUTH FUNCTIONS
// ════════════════════════════════
function switchAuthTab(tab) {
  if (tab === 'forgot') {
    document.getElementById('form-login').style.display = 'none';
    document.getElementById('form-register').style.display = 'none';
    document.getElementById('form-forgot').style.display = '';
  } else {
    ['login','register','forgot'].forEach(t => {
      document.getElementById('form-'+t).style.display = t === tab ? '' : 'none';
    });
  }
  document.querySelectorAll('.auth-tab').forEach((b, i) => {
    b.classList.toggle('active', (i===0&&tab==='login') || (i===1&&tab==='register'));
  });
  clearAuthMsg();
}

function clearAuthMsg() {
  ['auth-error','auth-success','auth-notice'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function showError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) { showToast('❌ ' + msg); return; }
  el.innerText = msg; el.style.display = 'block';
}

function showSuccess(msg) {
  const el = document.getElementById('auth-success');
  if (!el) { showToast('✅ ' + msg); return; }
  el.innerText = msg; el.style.display = 'block';
}

async function doLogin() {
  clearAuthMsg();
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!email || !pass) return showError('Email dan password wajib diisi.');

  const btn = document.querySelector('#form-login .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Masuk...'; }

  try {
    // Cek ban
    const { data: banCheck } = await sb.from('bans').select('reason').eq('user_id',
      (await sb.from('users').select('id').eq('email', email).single())?.data?.id || ''
    ).single();
    if (banCheck) {
      if (btn) { btn.disabled = false; btn.innerText = 'Masuk'; }
      return showError('Akun ini telah dibanned. Alasan: ' + (banCheck.reason || '-'));
    }
  } catch(e) {}

  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (btn) { btn.disabled = false; btn.innerText = 'Masuk'; }
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes('invalid') || m.includes('credentials')) return showError('Email atau password salah.');
    if (m.includes('email not confirmed')) return showError('Email belum diverifikasi. Cek inbox kamu.');
    return showError(error.message);
  }
  // Sukses → onAuthStateChange handle
}

async function doRegister() {
  clearAuthMsg();
  const username = document.getElementById('r-user').value.trim();
  const email    = document.getElementById('r-email').value.trim();
  const pass     = document.getElementById('r-pass').value;

  if (!username || !email || !pass) return showError('Semua field wajib diisi.');
  if (username.length < 3) return showError('Username minimal 3 karakter.');
  if (username.length > 30) return showError('Username maksimal 30 karakter.');
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return showError('Username hanya huruf, angka, underscore.');
  if (pass.length < 6) return showError('Password minimal 6 karakter.');

  const btn = document.querySelector('#form-register .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Mendaftar...'; }

  // Cek duplikat username
  const { data: existing } = await sb.from('users').select('id').eq('username', username).single();
  if (existing) {
    if (btn) { btn.disabled = false; btn.innerText = 'Buat Akun'; }
    return showError('Username sudah dipakai. Pilih username lain.');
  }

  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if (error) {
    if (btn) { btn.disabled = false; btn.innerText = 'Buat Akun'; }
    if (error.message.includes('already registered')) return showError('Email sudah terdaftar.');
    return showError(error.message);
  }

  // Insert profil user
  if (data?.user) {
    await sb.from('users').insert({
      id: data.user.id, username, email,
      role: 'user', bio: '', is_stealth: false
    });

    // Kalau session langsung ada (email confirm OFF) → langsung masuk
    if (data.session) {
      ME = data.user;
      if (btn) { btn.disabled = false; btn.innerText = 'Buat Akun'; }
      showScreen('screen-app');
      if (!_appInited) { _appInited = true; initApp(); }
      loadMyProfile().catch(()=>{});
      return;
    }
  }

  if (btn) { btn.disabled = false; btn.innerText = 'Buat Akun'; }
  showSuccess('✅ Akun dibuat! Cek email untuk verifikasi, lalu login.');
  switchAuthTab('login');
}

async function doForgot() {
  clearAuthMsg();
  const email = document.getElementById('f-email').value.trim();
  if (!email) return showError('Masukkan email kamu.');

  // Rate limit localStorage
  const rlKey    = 'xrezzky_rl_reset_' + btoa(email.toLowerCase());
  const lastSent = parseInt(localStorage.getItem(rlKey) || '0');
  const now      = Date.now();
  const cooldown = 10 * 60 * 1000;
  if (lastSent && (now - lastSent) < cooldown) {
    const sisa = Math.ceil((cooldown - (now - lastSent)) / 60000);
    return showError(`⏳ Tunggu ${sisa} menit lagi.`);
  }

  const btn = document.getElementById('btn-forgot');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  const baseUrl = window.location.origin;
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: baseUrl + '/reset-password.html'
  });

  if (btn) { btn.disabled = false; btn.innerText = 'Kirim Link Reset'; }
  if (error) return showError(error.message);

  localStorage.setItem(rlKey, now.toString());
  showSuccess('✅ Link reset dikirim! Cek inbox/spam kamu.');

  // Countdown
  let sisa = 600;
  const iv = setInterval(() => {
    sisa--;
    const el = document.getElementById('auth-success');
    const m = Math.floor(sisa/60), s = sisa%60;
    if (el && sisa > 0) el.innerText = `✅ Link terkirim. Kirim ulang dalam ${m}:${String(s).padStart(2,'0')}`;
    if (sisa <= 0) { clearInterval(iv); if (el) el.innerText = '✅ Link terkirim! Cek inbox kamu.'; }
  }, 1000);
}

async function loadMyProfile() {
  if (!ME) return;
  const { data, error } = await sb.from('users').select('*').eq('id', ME.id).single();
  if (error || !data) return;
  MY_PROFILE = data;
  myRole = data.role || 'user';
  await updateSidebarUI();
}

async function doLogout() {
  _intentionalLogout = true;
  try { await upsertPresence(false); } catch(e) {}
  cleanupChannels();
  _appInited = false;
  ME = null; MY_PROFILE = null;
  followMap = {}; allUsers = [];
  await sb.auth.signOut();
  showScreen('screen-auth');
}
