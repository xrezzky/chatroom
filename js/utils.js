// XREZZKY Chat — utils.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

//  STATE — harus di atas semua fungsi
// ════════════════════════════════
let ME = null, MY_PROFILE = null;
let convos = [], activeConvoId = null, activePartner = null, msgs = [], replyTo = null;
let msgCh = null, typingCh = null, presCh = null, convoCh = null, followCh = null;
let searchTimer = null, typingShowTimer = null;
let pendingFiles = [], lightboxMedia = null;
let followMap = {}, allUsers = [];
let blockSet = new Set();
let myRole = 'user'; // 'owner' | 'admin' | 'user'
let _appInited = false;
let _intentionalLogout = false;

const EMOJIS = ['😀','😂','🥰','😎','🤔','😅','🥺','😭','🤯','🎉','🔥','💯','👍','👏','🙏','💪','✨','⚡','💎','🚀','❤️','💙','💚','💛','🧡','🤍','👻','🤖','🦄','🎮','🎯','💬','🏆','🌟','🤝','✅','❌','⚠️','💰','🎁','🌈'];
const REACT_EMOJIS = ['❤️','😂','😮','😢','🔥','👍','🎉','💯'];

// ════════════════════════════════
//  SHOW SCREEN — definisi PERTAMA
// ════════════════════════════════
function showScreen(id) {
  const target = document.getElementById(id);
  if (!target) return;
  document.querySelectorAll('.screen').forEach(s => {
    if (s.id !== 'screen-splash') s.classList.remove('active');
  });
  target.classList.add('active');
  const splash = document.getElementById('screen-splash');
  if (splash && id !== 'screen-splash') {
    splash.style.transition = 'opacity .25s';
    splash.style.opacity = '0';
    setTimeout(() => { if (splash.parentNode) splash.remove(); }, 280);
  }
}

// ════════════════════════════════
//  UTILS — harus di atas semua fungsi yang pakai
// ════════════════════════════════
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function truncate(s,n){ return s&&s.length>n?s.slice(0,n)+'…':s||''; }
function fmtBytes(b){ if(b<1024*1024) return (b/1024).toFixed(0)+'KB'; return (b/(1024*1024)).toFixed(1)+'MB'; }
function avatarUrl(name){ return `https://ui-avatars.com/api/?name=${encodeURIComponent(name||'?')}&background=1e3a5f&color=60a5fa&bold=true`; }
function fmtTime(ts){
  if(!ts) return '';
  const d=new Date(ts),now=new Date(),diff=now-d;
  if(diff<60000) return 'baru saja';
  if(diff<3600000) return Math.floor(diff/60000)+'m';
  if(diff<86400000) return d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  if(diff<604800000) return d.toLocaleDateString('id-ID',{weekday:'short'});
  return d.toLocaleDateString('id-ID',{day:'numeric',month:'short'});
}
function autoResize(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,120)+'px'; }
function handleKey(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();} if(e.key==='Escape'){closeLightbox();cancelReply();} }
let _toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');
  if(!t) return;
  t.innerText=msg; t.classList.add('show');
  clearTimeout(_toastTimer); _toastTimer=setTimeout(()=>t.classList.remove('show'),2500);
}

// ════════════════════════════════
//  MEDIA CONFIG & LIMITS
// ════════════════════════════════
// User biasa:
//   Foto  ≤ 5MB   → permanen
//   Foto  > 5MB, ≤ 50MB  → 24 jam lalu hapus
//   Video ≤ 100MB → 24 jam lalu hapus
//   Video > 100MB → ditolak
//
// Owner / Admin:
//   Foto & Video tidak ada batas (max Cloudinary ~100MB)
//   Tidak ada timer — permanen
// ──────────────────────────────────────────────────────────────
const LIMITS = {
  user: {
    img_permanent:  5   * 1024 * 1024,   // 5MB  → simpan selamanya
    img_temp:       50  * 1024 * 1024,   // 50MB → 24 jam
    img_max:        50  * 1024 * 1024,   // max foto user
    vid_temp:       100 * 1024 * 1024,   // 100MB → 24 jam
    vid_max:        100 * 1024 * 1024,   // max video user
  },
  admin: {
    img_max: 200 * 1024 * 1024,   // 200MB max
    vid_max: 200 * 1024 * 1024,   // 200MB max
  }
};

// Tentukan tier media berdasarkan role dan ukuran
// Return: { allowed, isTemp, label }
function getMediaTier(file, isVid){
  const size = file.size;
  const isPrivileged = myRole === 'owner' || myRole === 'admin';

  if(isPrivileged){
    const max = isVid ? LIMITS.admin.vid_max : LIMITS.admin.img_max;
    if(size > max) return { allowed:false, isTemp:false, label:'File terlalu besar (max 200MB)' };
    return { allowed:true, isTemp:false, label:'Permanen (admin/owner)' };
  }

  // User biasa
  if(isVid){
    if(size > LIMITS.user.vid_max) return { allowed:false, isTemp:false, label:`Video max 100MB. File ini ${fmtBytes(size)}.` };
    return { allowed:true, isTemp:true, label:`Video dikirim — hilang dalam 24 jam ⏳` };
  } else {
    if(size > LIMITS.user.img_max) return { allowed:false, isTemp:false, label:`Foto max 50MB. File ini ${fmtBytes(size)}.` };
    const isTemp = size > LIMITS.user.img_permanent;
    return { allowed:true, isTemp, label: isTemp ? `Foto besar — hilang dalam 24 jam ⏳` : `Permanen ✅` };
  }
}

function handleFileSelect(e){
  const files = Array.from(e.target.files || []);
  e.target.value = '';

  const ALLOWED_IMG = ['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif'];
  const ALLOWED_VID = ['video/mp4','video/webm','video/quicktime','video/x-matroska','video/3gpp'];
  let blocked = [];

  for(const file of files){
    const isVid = ALLOWED_VID.includes(file.type) || file.type.startsWith('video/');
    const isImg = ALLOWED_IMG.includes(file.type) || file.type.startsWith('image/');

    if(!isVid && !isImg){
      showToast(`❌ Format tidak didukung: ${file.name}`);
      continue;
    }

    const tier = getMediaTier(file, isVid);
    if(!tier.allowed){
      blocked.push({ name: file.name, size: fmtBytes(file.size), reason: tier.label });
      continue;
    }

    const previewUrl = isVid ? null : URL.createObjectURL(file);
    pendingFiles.push({
      file, previewUrl,
      type: isVid ? 'video' : 'image',
      name: file.name,
      isTemp: tier.isTemp,
      tierLabel: tier.label
    });
  }

  if(blocked.length > 0){
    const detail = blocked.map(b => `• ${b.name} (${b.size})\n  ${b.reason}`).join('\n');
    showBlockedAlert(`File berikut DITOLAK:\n\n${detail}`);
  }

  renderMediaPreview();
}

function showBlockedAlert(msg){
  document.getElementById('upload-blocked-alert')?.remove();
  const el = document.createElement('div');
  el.id = 'upload-blocked-alert';
  el.style.cssText = `position:fixed;top:0;left:50%;transform:translateX(-50%);max-width:360px;width:calc(100% - 32px);background:#1a0a0a;border:1.5px solid #ef4444;color:#fca5a5;border-radius:0 0 16px 16px;padding:14px 16px;font-size:12px;line-height:1.7;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.7);font-family:inherit;white-space:pre-line;`;
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
    <div><b style="color:#ef4444;font-size:13px;">⛔ File Ditolak</b><br>${msg.replace(/\n/g,'<br>')}</div>
    <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#fca5a5;font-size:18px;cursor:pointer;flex-shrink:0;line-height:1;">×</button>
  </div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}



function renderMediaPreview(){
  const s = document.getElementById('media-preview-strip');
  if(!pendingFiles.length){ s.classList.remove('visible'); s.innerHTML=''; return; }
  s.classList.add('visible');
  s.innerHTML = pendingFiles.map((f,i) => {
    const isVid = f.type === 'video';
    const thumb = isVid
      ? `<div style="width:100%;height:100%;background:#0a0f1e;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;">
           <i class="fa fa-film" style="color:#60a5fa;font-size:20px;"></i>
           <span style="font-size:7px;color:#94a3b8;text-align:center;padding:0 3px;line-height:1.3;">${fmtBytes(f.file.size)}</span>
           ${f.isTemp?`<span style="font-size:7px;color:#f59e0b;">⏳24j</span>`:''}
         </div>`
      : `<div style="position:relative;width:100%;height:100%;">
           <img src="${f.previewUrl}" alt="" style="width:100%;height:100%;object-fit:cover;">
           ${f.isTemp?`<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(245,158,11,.85);font-size:7px;font-weight:700;color:#fff;text-align:center;padding:2px;">⏳ 24j</div>`:''}
         </div>`;
    return `<div class="media-thumb" title="${esc(f.name)} — ${f.tierLabel}">
      ${thumb}
      <button class="media-thumb-rm" onclick="removePendingFile(${i})">✕</button>
      <span class="media-thumb-type">${isVid?'VID':'IMG'}</span>
    </div>`;
  }).join('');
}

function removePendingFile(i){
  const f = pendingFiles[i];
  if(f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
  pendingFiles.splice(i, 1);
  renderMediaPreview();
}

// Kompres gambar sebelum upload (max 1280px, quality 0.82)
async function compressImage(file, maxPx=1280, quality=0.82){
  return new Promise(resolve=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      let {width:w, height:h} = img;
      // Scale down kalau lebih besar dari maxPx
      if(w > maxPx || h > maxPx){
        if(w >= h){ h = Math.round(h * maxPx/w); w = maxPx; }
        else      { w = Math.round(w * maxPx/h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      canvas.toBlob(blob=>{
        if(!blob){ resolve(file); return; } // fallback ke original
        const compressed = new File([blob], file.name, {type:'image/jpeg',lastModified:Date.now()});
        console.log(`Compress: ${fmtBytes(file.size)} → ${fmtBytes(compressed.size)}`);
        resolve(compressed);
      }, 'image/jpeg', quality);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function uploadToCloudinary(file, type, isTemp, onProgress){
  // Kompres gambar dulu sebelum upload
  let uploadFile = file;
  if(type === 'image'){
    try { uploadFile = await compressImage(file); } catch(e){ uploadFile = file; }
  }

  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', uploadFile);
    fd.append('upload_preset', PRESET);
    fd.append('folder', isTemp ? 'xrezzky_temp' : 'xrezzky_media');
    if(isTemp) fd.append('tags','temp_24h');

    const xhr = new XMLHttpRequest();
    const rt  = type==='video' ? 'video' : 'image';
    xhr.open('POST',`https://api.cloudinary.com/v1_1/${CLOUD}/${rt}/upload`);
    xhr.upload.onprogress = e=>{ if(e.lengthComputable&&onProgress) onProgress(Math.round((e.loaded/e.total)*100)); };
    xhr.onload = ()=>{
      if(xhr.status>=200&&xhr.status<300){
        try { resolve(JSON.parse(xhr.responseText)); } catch{ reject(new Error('Parse error')); }
      } else reject(new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror   = ()=>reject(new Error('Network error'));
    xhr.ontimeout = ()=>reject(new Error('Timeout'));
    xhr.timeout   = 180000;
    xhr.send(fd);
  });
}

async function sendMediaFiles(){
  if(!activeConvoId || !pendingFiles.length) return;

  const {data:{session}} = await sb.auth.getSession();
  if(!session){ showToast('Sesi habis, silakan login ulang.'); showScreen('screen-auth'); return; }

  const files   = [...pendingFiles];
  const caption = document.getElementById('msg-input').value.trim();
  document.getElementById('msg-input').value = '';
  autoResize(document.getElementById('msg-input'));
  pendingFiles = [];
  renderMediaPreview();

  const sendBtn  = document.querySelector('.send-btn');
  const mediaBtn = document.querySelector('.media-btn');
  sendBtn.disabled = true;
  if(mediaBtn) mediaBtn.style.pointerEvents = 'none';

  let successCount = 0;

  for(let i = 0; i < files.length; i++){
    const { file, type, previewUrl, isTemp, name: fname } = files[i];
    const label = `${i+1}/${files.length}: ${fname}`;
    showToast(`⏫ Mengupload ${label} (0%)`);

    try {
      const data = await uploadToCloudinary(file, type, isTemp, pct => {
        showToast(`⏫ ${label} — ${pct}%`);
      });
      const url       = data.secure_url;
      const public_id = data.public_id;

      const expiresAt = isTemp
        ? new Date(Date.now() + 24*60*60*1000).toISOString()
        : null;

      let msgErr = null;

      if(activeGroupId && !activeConvoId){
        // Kirim ke grup
        const {error:e} = await sb.from('group_messages').insert({
          group_id:        activeGroupId,
          sender_id:       ME.id,
          text:            (i===0 && caption) ? caption : '',
          reply_to_id:     (i===0 && replyTo?.id) ? replyTo.id : null,
          reactions:       {},
          media_url:       url,
          media_type:      type,
          media_name:      fname,
          media_public_id: public_id,
          media_expires_at: expiresAt,
        });
        msgErr = e;
      } else {
        // Kirim ke private chat
        const {error:e} = await sb.from('messages').insert({
          conversation_id: activeConvoId,
          sender_id:       ME.id,
          text:            (i===0 && caption) ? caption : '',
          is_read:         false,
          is_request:      false,
          reply_to_id:     (i===0 && replyTo?.id) ? replyTo.id : null,
          reactions:       {},
          media_url:       url,
          media_type:      type,
          media_name:      fname,
          media_public_id: public_id,
          media_expires_at: expiresAt,
        });
        msgErr = e;
        if(!e) await sb.from('conversations').update({updated_at:new Date().toISOString()}).eq('id',activeConvoId);
      }

      if(msgErr){
        showToast(`❌ Gagal kirim ${fname}: ${msgErr.message}`);
      } else {
        successCount++;
        if(isTemp) scheduleLocalExpiry(public_id, expiresAt, type);
      }

      if(previewUrl) URL.revokeObjectURL(previewUrl);

    } catch(err){
      console.error('upload error:', err);
      showToast(`❌ ${fname}: ${err.message}`);
    }
  }

  sendBtn.disabled = false;
  if(mediaBtn) mediaBtn.style.pointerEvents = '';
  cancelReply();
  if(successCount > 0) showToast(`✅ ${successCount} file terkirim!`);
}

// Simpan jadwal expiry di localStorage (fallback visual)
function scheduleLocalExpiry(publicId, expiresAt, type){
  if(!publicId || !expiresAt) return;
  const key = 'xrezzky_expiry';
  const list = JSON.parse(localStorage.getItem(key)||'[]');
  list.push({ public_id:publicId, expires_at:expiresAt, type });
  localStorage.setItem(key, JSON.stringify(list));
}

// Cek expired media setiap kali app buka
function checkExpiredMedia(){
  const key  = 'xrezzky_expiry';
  const list = JSON.parse(localStorage.getItem(key)||'[]');
  const now  = Date.now();
  const remaining = list.filter(item => new Date(item.expires_at).getTime() > now);
  localStorage.setItem(key, JSON.stringify(remaining));
  // Soft delete pesan dengan media yang sudah expired dari DB
  const expired = list.filter(item => new Date(item.expires_at).getTime() <= now);
  for(const item of expired){
    sb.from('messages')
      .update({ media_url: null, media_public_id: null, deleted_at: new Date().toISOString() })
      .eq('media_public_id', item.public_id)
      .then(() => console.log('expired media cleared:', item.public_id));
  }
}

// STATE sudah didefinisikan di atas

// showScreen sudah didefinisikan di atas