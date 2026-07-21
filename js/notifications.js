// XREZZKY Chat — notifications.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

// ════════════════════════════════
//  AUTO ONLINE / OFFLINE
// ════════════════════════════════
let _presenceVisible = true;
let _presInt = null;

function initPresenceTracking(){
  // Online saat halaman aktif
  upsertPresence(true);

  // Offline saat halaman disembunyikan / ditutup
  document.addEventListener('visibilitychange', ()=>{
    _presenceVisible = !document.hidden;
    upsertPresence(_presenceVisible);
  });

  // Offline saat keluar halaman
  window.addEventListener('beforeunload', ()=>{
    upsertPresence(false);
    if(isCallActive) endCall();
  });

  // Refresh online tiap 25 detik (agar tidak expire)
  _presInt = setInterval(()=>{
    if(_presenceVisible) upsertPresence(true);
  }, 25000);

  // Offline setelah 5 menit tidak ada interaksi
  let _idleTimer = null;
  const resetIdle = ()=>{
    clearTimeout(_idleTimer);
    if(!_presenceVisible) return;
    upsertPresence(true);
    _idleTimer = setTimeout(()=>{
      upsertPresence(false);
      _presenceVisible = false;
    }, 5 * 60 * 1000); // 5 menit idle
  };
  ['mousemove','keydown','touchstart','click','scroll'].forEach(ev=>{
    document.addEventListener(ev, resetIdle, {passive:true});
  });
  resetIdle();
}

async function upsertPresence(isOnline){
  if(!ME) return;
  try {
    await sb.from('user_presence').upsert(
      {user_id:ME.id, is_online:isOnline, last_seen:new Date().toISOString()},
      {onConflict:'user_id'}
    );
  } catch(e){ console.warn('presence error:', e.message); }
}

// ════════════════════════════════
//  WEB PUSH NOTIFICATIONS
// ════════════════════════════════
const VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUrIgmsYPkjyXlzY1XE';
// ⚠️ Generate VAPID keys di: https://vapidkeys.com
// Ganti VAPID_PUBLIC_KEY dengan key lo sendiri

let _swRegistration = null;

async function initPushNotifications(){
  if(!('Notification' in window) || !('serviceWorker' in navigator)){
    console.log('Push notifications tidak didukung browser ini');
    return;
  }

  // Register service worker
  try {
    _swRegistration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registered');
  } catch(e){
    console.warn('SW registration failed:', e);
    return;
  }

  // Minta izin notifikasi
  const permission = await Notification.requestPermission();
  if(permission !== 'granted'){
    console.log('Notifikasi tidak diizinkan');
    return;
  }

  // Subscribe push
  try {
    const sub = await _swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    // Simpan subscription ke DB
    const keys = sub.toJSON().keys;
    await sb.from('push_subscriptions').upsert({
      user_id:  ME.id,
      endpoint: sub.endpoint,
      p256dh:   keys.p256dh,
      auth:     keys.auth
    }, {onConflict:'endpoint'});

    console.log('Push subscription saved');
  } catch(e){
    console.warn('Push subscribe error:', e);
  }
}

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

// Notifikasi in-app (tanpa service worker — fallback)
function showInAppNotification(title, body, icon, onClick){
  // Kalau halaman aktif — tampilkan toast saja
  if(!document.hidden){
    showToast(`🔔 ${title}: ${body}`);
    return;
  }

  // Kalau halaman di background — pakai Notification API
  if(Notification.permission === 'granted'){
    const n = new Notification(title, {
      body, icon: icon || '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'xrezzky-chat'
    });
    n.onclick = ()=>{
      window.focus();
      if(onClick) onClick();
      n.close();
    };
  }
}

// Trigger notifikasi saat ada pesan baru
function notifyNewMessage(senderName, text, convoId, partnerId){
  if(activeConvoId === convoId) return; // sudah di chat ini — skip
  showInAppNotification(
    senderName,
    text || '📎 Media',
    avatarUrl(senderName),
    ()=>{
      switchSidebarTab('messages');
      // Buka convo yang relevan
      const c = convos.find(x=>x.id===convoId);
      if(c && c.partnerUser) openConvo(convoId, c.partnerUser.id, c.partnerUser.username, c.partnerUser.email);
    }
  );
  // Update title tab
  updateTabTitle(senderName);
}

function notifyGroupMessage(groupName, senderName, text, groupId){
  if(activeGroupId === groupId) return;
  showInAppNotification(
    `👥 ${groupName}`,
    `${senderName}: ${text||'📎 Media'}`,
    null,
    ()=>{ switchSidebarTab('groups'); }
  );
  updateTabTitle(groupName);
}

// Update title tab browser
let _titleInterval = null;
let _originalTitle = document.title;
function updateTabTitle(from){
  let show = true;
  clearInterval(_titleInterval);
  _titleInterval = setInterval(()=>{
    document.title = show ? `🔔 ${from} — XREZZKY Chat` : _originalTitle;
    show = !show;
  }, 1500);
  // Stop blinking saat user kembali ke tab
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden){
      clearInterval(_titleInterval);
      document.title = _originalTitle;
    }
  }, {once:true});
}
// ════════════════════════════════