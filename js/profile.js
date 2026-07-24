// XREZZKY Chat — profile.js
// Generated: split from monolithic index.html

// ════════════════════════════════
//  UPDATE SIDEBAR UI
// ════════════════════════════════
async function updateSidebarUI(){
  if(!MY_PROFILE) return;
  myRole = MY_PROFILE.role || 'user';

  const photoUrl = MY_PROFILE.avatar_url || avatarUrl(MY_PROFILE.username);

  // Sidebar avatar
  const sbAvatar = document.getElementById('sb-avatar');
  const sbIcon   = document.getElementById('sb-avatar-icon');
  if(sbAvatar){ sbAvatar.src = photoUrl; sbAvatar.style.display = 'block'; }
  if(sbIcon)  sbIcon.style.display = 'none';

  // Profile drawer
  const pdAvatar = document.getElementById('pd-avatar');
  if(pdAvatar) pdAvatar.src = photoUrl;
  const pdName = document.getElementById('pd-name');
  if(pdName) pdName.innerText = MY_PROFILE.username;
  const pdEmail = document.getElementById('pd-email');
  if(pdEmail) pdEmail.innerText = ME?.email || '';
  const pdUsernameSub = document.getElementById('pd-username-sub');
  if(pdUsernameSub) pdUsernameSub.innerText = '@' + MY_PROFILE.username;
  const pdBioSub = document.getElementById('pd-bio-sub');
  if(pdBioSub) pdBioSub.innerText = MY_PROFILE.bio || 'Tambahkan bio singkat';
  const pdBioText = document.getElementById('pd-bio-text');
  if(pdBioText) pdBioText.innerText = MY_PROFILE.bio || 'Belum ada bio';

  // Role badge
  const roleEl = document.getElementById('pd-role-badge');
  if(roleEl) roleEl.innerHTML = getRoleBadgeHTML(myRole);

  // Tombol admin — tampilkan kalau owner/admin
  const adminBtn = document.getElementById('admin-panel-btn');
  if(adminBtn){
    adminBtn.style.display = (myRole==='owner'||myRole==='admin') ? 'flex' : 'none';
  }

  // Stats follow
  try {
    const [{count:flwing},{count:flwrs}] = await Promise.all([
      sb.from('follows').select('*',{count:'exact',head:true}).eq('sender_id',ME.id).eq('status','accepted'),
      sb.from('follows').select('*',{count:'exact',head:true}).eq('receiver_id',ME.id).eq('status','accepted'),
    ]);
    const pdFollowing = document.getElementById('pd-following');
    const pdFollowers = document.getElementById('pd-followers');
    if(pdFollowing) pdFollowing.innerText = flwing||0;
    if(pdFollowers) pdFollowers.innerText = flwrs||0;
  } catch(e){}
}

// ════════════════════════════════
//  EDIT PROFIL
// ════════════════════════════════

async function uploadProfilePhoto(event){
  const file = event.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ showToast('❌ Hanya file gambar yang diizinkan.'); return; }
  if(file.size > 5*1024*1024){ showToast('❌ Ukuran foto max 5MB.'); return; }

  const spinner = document.getElementById('pd-avatar-upload-spinner');
  spinner.style.display = 'flex';

  try {
    // Upload ke Cloudinary
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', PRESET);
    fd.append('folder', 'xrezzky_avatars');

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {method:'POST',body:fd});
    if(!res.ok) throw new Error('Upload gagal');
    const data = await res.json();
    const url = data.secure_url;

    // Update DB
    const {error} = await sb.from('users').update({avatar_url:url}).eq('id',ME.id);
    if(error) throw new Error(error.message);

    MY_PROFILE.avatar_url = url;
    document.getElementById('pd-avatar').src = url;
    document.getElementById('sb-avatar').src = url;
    showToast('✅ Foto profil diperbarui!');
  } catch(e) {
    showToast('❌ Gagal upload: '+e.message);
  } finally {
    spinner.style.display = 'none';
    event.target.value = '';
  }
}

async function changeUsername(){
  const current = MY_PROFILE.username;
  const newName = prompt('Username baru:', current);
  if(!newName || newName.trim()===current) return;
  const trimmed = newName.trim();
  if(trimmed.length < 3){ showToast('❌ Username minimal 3 karakter.'); return; }
  if(trimmed.length > 30){ showToast('❌ Username maksimal 30 karakter.'); return; }
  if(!/^[a-zA-Z0-9_]+$/.test(trimmed)){ showToast('❌ Hanya huruf, angka, dan underscore.'); return; }

  // Cek duplikat
  const {data:existing} = await sb.from('users').select('id').eq('username',trimmed).neq('id',ME.id).single();
  if(existing){ showToast('❌ Username sudah dipakai orang lain.'); return; }

  const {error} = await sb.from('users').update({username:trimmed}).eq('id',ME.id);
  if(error){ showToast('❌ Gagal: '+error.message); return; }
  MY_PROFILE.username = trimmed;
  updateSidebarUI();
  showToast('✅ Username diperbarui!');
}

async function changeBio(){
  const current = MY_PROFILE.bio||'';
  const newBio = prompt('Bio baru (max 100 karakter):', current);
  if(newBio===null) return;
  if(newBio.length > 100){ showToast('❌ Bio maksimal 100 karakter.'); return; }
  const {error} = await sb.from('users').update({bio:newBio.trim()}).eq('id',ME.id);
  if(error){ showToast('❌ Gagal: '+error.message); return; }
  MY_PROFILE.bio = newBio.trim();
  updateSidebarUI();
  showToast('✅ Bio diperbarui!');
}

async function changePassword(){
  // 2 opsi: ganti langsung (kalau sudah login) atau kirim link reset
  const choice = confirm('Ganti password sekarang?\n\nOK = Ganti langsung\nBatal = Kirim link reset ke email');

  if(choice){
    // Ganti langsung
    const newPass = prompt('Password baru (min 6 karakter):');
    if(!newPass) return;
    if(newPass.length < 6){ showToast('❌ Password minimal 6 karakter.'); return; }
    const confirm2 = prompt('Konfirmasi password baru:');
    if(newPass !== confirm2){ showToast('❌ Password tidak cocok.'); return; }
    const {error} = await sb.auth.updateUser({password:newPass});
    if(error){ showToast('❌ Gagal: '+error.message); return; }
    showToast('✅ Password berhasil diperbarui!');
  } else {
    // Kirim link reset ke email yang sudah login
    const email = ME.email;
    const rlKey    = 'xrezzky_rl_reset_' + btoa(email.toLowerCase());
    const lastSent = parseInt(localStorage.getItem(rlKey)||'0');
    const now      = Date.now();
    const cooldown = 10 * 60 * 1000;

    if(lastSent && (now - lastSent) < cooldown){
      const sisa = Math.ceil((cooldown - (now - lastSent)) / 60000);
      showToast(`⏳ Tunggu ${sisa} menit lagi.`); return;
    }

    const baseUrl = window.location.href.replace(/\/[^/]*(\?.*)?$/, '');
    const {error} = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: baseUrl + '/reset-password.html'
    });
    if(error){ showToast('❌ Gagal: '+error.message); return; }
    localStorage.setItem(rlKey, now.toString());
    showToast(`✅ Link reset dikirim ke ${email}!`);
  }
}

// ════════════════════════════════