// XREZZKY Chat — auth.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure


// ════════════════════════════════
//  AUTH HANDLER
// ════════════════════════════════
// ── Cek session dulu SEBELUM subscribe onAuthStateChange
// Ini cegah flash ke auth screen waktu refresh
let _initialSession = null;
(async () => {
  try {
    const { data } = await sb.auth.getSession();
    _initialSession = data?.session || null;
  } catch(e) {
    _initialSession = null;
  }
})();

sb.auth.onAuthStateChange(async (event, session) => {
  console.log('[auth]', event, session?.user?.email || 'no session');

  if (event === 'PASSWORD_RECOVERY') {
    showScreen('screen-reset-password');
    return;
  }

  // SIGNED_OUT — cek apakah ini logout beneran atau cuma flicker waktu refresh
  if (event === 'SIGNED_OUT') {
    if (_intentionalLogout) {
      // Logout beneran dari tombol
      _intentionalLogout = false;
      _appInited = false;
      ME = null; MY_PROFILE = null;
      showScreen('screen-auth');
      return;
    }
    // Bukan intentional — tunggu dulu, mungkin cuma token refresh
    setTimeout(async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (data?.session?.user) {
          console.log('[auth] false SIGNED_OUT, session masih ada');
          return;
        }
      } catch(e) {}
      _appInited = false;
      ME = null; MY_PROFILE = null;
      showScreen('screen-auth');
    }, 1000);
    return;
  }

  if (session?.user) {
    if (_appInited && ME?.id === session.user.id) {
      return; // sudah init, skip
    }
    ME = session.user;

    // Langsung masuk app dulu — jangan nunggu loadMyProfile
    showScreen('screen-app');

    if (!_appInited) {
      _appInited = true;
      initApp();
    }

    // Load profil di background setelah app tampil
    loadMyProfile().catch(e => console.error('loadMyProfile:', e));
    return;
  }

  // Kalau event INITIAL_SESSION dan session null = memang belum login
  if (event === 'INITIAL_SESSION') {
    showScreen('screen-auth');
  }
});

// ── FALLBACK: kalau onAuthStateChange ga fire dalam 500ms
setTimeout(async () => {
  const splash = document.getElementById('screen-splash');
  if (!splash) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      if (!_appInited) {
        ME = session.user;
        showScreen('screen-app');
        _appInited = true;
        initApp();
        loadMyProfile().catch(e => console.error('fallback loadMyProfile:', e));
      }
    } else {
      showScreen('screen-auth');
    }
  } catch(e) {
    showScreen('screen-auth');
  }
}, 500);

// ── HARD TIMEOUT 8 detik
setTimeout(() => {
  const splash = document.getElementById('screen-splash');
  if (!splash) return;
  const st = document.getElementById('splash-status');
  if (st) st.innerText = 'Koneksi lambat, mengalihkan...';
  setTimeout(() => {
    if (document.getElementById('screen-splash')) showScreen('screen-auth');
  }, 800);
}, 8000);

// ════════════════════════════════
//  AUTH FUNCTIONS
// ════════════════════════════════
function switchAuthTab(tab) {
  ['login','register','forgot'].forEach(t => {
    document.getElementById('form-'+t).style.display = t === tab ? '' : 'none';
  });
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
  if (!el) return;
  el.innerText = msg;
  el.style.display = 'block';
}

function showSuccess(msg) {
  const el = document.getElementById('auth-success');
  if (!el) return;
  el.innerText = msg;
  el.style.display = 'block';
}

// Wrapper: auth call dengan timeout maksimal 6 detik
async function authWithTimeout(promise, ms = 6000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function doLogin() {
  clearAuthMsg();
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!email || !pass) return showError('Isi email dan password.');

  const btn = document.querySelector('#form-login .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Masuk...';

  try {
    const { error } = await authWithTimeout(
      sb.auth.signInWithPassword({ email, password: pass })
    );
    if (error) {
      const m = error.message || '';
      if (m.includes('Invalid login credentials'))  showError('Email atau password salah.');
      else if (m.includes('Email not confirmed'))   showError('Email belum diverifikasi. Cek inbox/spam kamu.');
      else if (m.includes('rate limit'))            showError('⏳ Terlalu banyak percobaan. Tunggu dulu.');
      else                                          showError(m);
    }
    // Sukses → onAuthStateChange handle redirect otomatis
  } catch(e) {
    if (e.message === 'TIMEOUT') showError('⏳ Koneksi lambat. Coba lagi.');
    else showError('Gagal terhubung. Cek koneksi internet kamu.');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Masuk';
  }
}

async function doRegister() {
  clearAuthMsg();
  const username = document.getElementById('r-user').value.trim();
  const email    = document.getElementById('r-email').value.trim();
  const pass     = document.getElementById('r-pass').value;

  if (!username)     return showError('Username wajib diisi.');
  if (!email)        return showError('Email wajib diisi.');
  if (pass.length<6) return showError('Password minimal 6 karakter.');

  const btn = document.querySelector('#form-register .btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Membuat akun...';

  try {
    const { data, error } = await authWithTimeout(
      sb.auth.signUp({ email, password: pass })
    );

    if (error) {
      const m = error.message || '';
      if (m.includes('rate limit') || m.includes('email rate'))
        showError('⏳ Limit email. Tunggu beberapa menit lalu coba lagi.');
      else if (m.includes('already registered') || m.includes('already exists') || m.includes('already been registered'))
        showError('Email sudah terdaftar. Silakan login.');
      else
        showError(m);
      return;
    }

    if (data?.user) {
      // Insert profil di background — jangan await, biar ga nge-hang UI
      sb.from('users').upsert({
        id: data.user.id,
        username,
        email,
        bio: '',
        created_at: new Date().toISOString()
      }).then(({ error: e }) => {
        if (e) console.error('upsert user error:', e.message);
      });

      if (data.session) {
        // Email confirmation OFF → langsung login, onAuthStateChange handle
        return;
      }

      // Email confirmation ON → kasih tahu user
      showSuccess('Akun dibuat! Cek email untuk verifikasi lalu login.');
      document.getElementById('auth-notice').style.display = 'block';
      // Auto pindah ke tab login setelah 1.5 detik
      setTimeout(() => switchAuthTab('login'), 1500);
    }

  } catch(e) {
    if (e.message === 'TIMEOUT') showError('⏳ Koneksi lambat. Coba lagi.');
    else showError('Gagal terhubung. Cek koneksi internet kamu.');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Buat Akun';
  }
}

async function doForgot() {
  clearAuthMsg();
  const email = document.getElementById('f-email').value.trim();
  if (!email) return showError('Masukkan email kamu.');

  // ── Rate limit Layer 1: localStorage (cepat, client-side) ──
  const rlKey    = 'xrezzky_rl_reset_' + btoa(email.toLowerCase());
  const lastSent = parseInt(localStorage.getItem(rlKey)||'0');
  const now      = Date.now();
  const cooldown = 10 * 60 * 1000; // 10 menit

  if(lastSent && (now - lastSent) < cooldown){
    const sisa = Math.ceil((cooldown - (now - lastSent)) / 60000);
    return showError(`⏳ Tunggu ${sisa} menit lagi sebelum kirim ulang ke email ini.`);
  }

  // ── Rate limit Layer 2: DB (tidak bisa di-bypass) ──
  try {
    const since = new Date(now - cooldown).toISOString();
    const {count} = await sb.from('rate_limits')
      .select('*',{count:'exact',head:true})
      .eq('email', email.toLowerCase())
      .eq('action','reset_password')
      .gte('created_at', since);

    if(count && count > 0){
      const sisa = 10; // estimasi
      return showError(`⏳ Tunggu ${sisa} menit lagi sebelum kirim ulang ke email ini.`);
    }
  } catch(e) {
    console.warn('Rate limit DB check error:', e.message);
    // Kalau DB check gagal, tetap lanjut (jangan block user)
  }

  const btn = document.getElementById('btn-forgot');
  if(btn){ btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Mengirim...'; }

  const baseUrl = window.location.href.replace(/\/[^/]*(\?.*)?$/, '');
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: baseUrl + '/reset-password.html'
  });

  if(btn){ btn.disabled=false; btn.innerText='Kirim Link Reset'; }

  if (error) {
    const m = error.message||'';
    if(m.includes('rate limit') || m.includes('email rate'))
      return showError('⏳ Terlalu banyak percobaan. Tunggu beberapa menit.');
    if(m.includes('not found') || m.includes('invalid'))
      return showError('Email tidak terdaftar.');
    return showError(m);
  }

  // Simpan ke DB rate_limits
  try {
    await sb.from('rate_limits').insert({email:email.toLowerCase(), action:'reset_password'});
  } catch(e) { console.warn('rate_limits insert:', e.message); }

  // Simpan ke localStorage
  localStorage.setItem(rlKey, now.toString());

  showSuccess('✅ Link reset dikirim! Cek inbox/spam kamu.');

  // Countdown di UI
  let sisa = 600;
  const interval = setInterval(()=>{
    sisa--;
    const mnt = Math.floor(sisa/60);
    const dtk = sisa % 60;
    const succEl = document.getElementById('auth-success');
    if(succEl && sisa > 0) succEl.innerText = `✅ Link terkirim! Kirim ulang dalam ${mnt}:${String(dtk).padStart(2,'0')}`;
    if(sisa <= 0){ clearInterval(interval); if(succEl) succEl.innerText='✅ Link terkirim! Cek inbox/spam kamu.'; }
  }, 1000);
}

async function doLogout() {
  _intentionalLogout = true;
  try { await upsertPresence(false); } catch(e) {}
  cleanupChannels();
  _appInited = false;
  ME = null; MY_PROFILE = null; followMap = {}; allUsers = [];
  await sb.auth.signOut();
}

async function loadMyProfile() {
  const fallback = {
    id: ME.id,
    username: ME.email.split('@')[0],
    email: ME.email,
    bio: '',
    role: 'user'
  };
  if (!MY_PROFILE) {
    MY_PROFILE = fallback;
    updateSidebarUI();
  }

  try {
    const { data, error } = await Promise.race([
      sb.from('users').select('*').eq('id', ME.id).single(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
    ]);

    if (!error && data) {
      MY_PROFILE = data;
      myRole = data.role || 'user';

      // Cek apakah user di-ban
      const { data: ban } = await sb.from('bans').select('reason').eq('user_id', ME.id).single();
      if (ban) {
        await sb.auth.signOut();
        showScreen('screen-auth');
        setTimeout(() => showError(`Akun kamu di-ban. Alasan: ${ban.reason}`), 300);
        return;
      }

      updateSidebarUI();
    } else if (error?.code === 'PGRST116') {
      sb.from('users').upsert({
        id: ME.id,
        username: ME.email.split('@')[0],
        email: ME.email,
        bio: '',
        role: 'user',
        created_at: new Date().toISOString()
      }).then(({ error: e }) => {
        if (e) console.error('upsert profile:', e.message);
      });
    }
  } catch(e) {
    console.warn('loadMyProfile timeout/error:', e.message);
  }
}

async function updateSidebarUI(){
  if(!MY_PROFILE) return;
  myRole = MY_PROFILE.role || 'user';

  // Avatar — pakai foto profil custom kalau ada, fallback ke ui-avatars
  const photoUrl = MY_PROFILE.avatar_url || avatarUrl(MY_PROFILE.username);
  document.getElementById('sb-avatar').src = photoUrl;
  document.getElementById('sb-avatar').style.display = 'block';
  document.getElementById('sb-avatar-icon').style.display = 'none';
  document.getElementById('pd-avatar').src = photoUrl;
  document.getElementById('pd-name').innerText = MY_PROFILE.username;
  document.getElementById('pd-email').innerText = ME.email;
  document.getElementById('pd-username-sub').innerText = '@' + MY_PROFILE.username;
  document.getElementById('pd-bio-sub').innerText = MY_PROFILE.bio||'Tambahkan bio singkat';
  document.getElementById('pd-bio-text').innerText = MY_PROFILE.bio||'Belum ada bio';

  const roleEl = document.getElementById('pd-role-badge');
  if(roleEl) roleEl.innerHTML = getRoleBadgeHTML(myRole);

  const adminBtn = document.getElementById('admin-panel-btn');
  if(adminBtn) adminBtn.style.display = (myRole==='owner'||myRole==='admin') ? 'flex' : 'none';

  const [{count:flwing},{count:flwrs}] = await Promise.all([
    sb.from('follows').select('*',{count:'exact',head:true}).eq('sender_id',ME.id).eq('status','accepted'),
    sb.from('follows').select('*',{count:'exact',head:true}).eq('receiver_id',ME.id).eq('status','accepted'),
  ]);
  document.getElementById('pd-following').innerText = flwing||0;
  document.getElementById('pd-followers').innerText = flwrs||0;
}
