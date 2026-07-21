// XREZZKY Chat — init.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

//  INIT
// ════════════════════════════════
function initApp(){
  initEmojiGrid();
  loadConvos();
  loadFollowMap();
  loadBlockSet();
  loadPeopleList();
  initPresenceTracking();       // online/offline otomatis
  initPushNotifications();      // push notifikasi
  subscribeConvos();
  subscribeFollows();
  subscribeIncomingCalls();
  startRealtimeClock();
  checkExpiredMedia();
  myRole = MY_PROFILE?.role || 'user';
  document.addEventListener('click', e=>{ if(!document.getElementById('ctx-menu').contains(e.target)) hideCtxMenu(); });
}
function cleanupChannels(){ [msgCh,typingCh,presCh,convoCh,followCh].forEach(c=>{ if(c) sb.removeChannel(c); }); clearInterval(window._presInt); }

// ════════════════════════════════
//  SIDEBAR TABS
// ════════════════════════════════
// ════════════════════════════════
//  FOLLOWS
// ════════════════════════════════
async function loadFollowMap(){
  const {data}=await sb.from('follows').select('receiver_id,status').eq('sender_id',ME.id);
  followMap={};
  if(data) data.forEach(f=>{ followMap[f.receiver_id]=f.status; });
}

function subscribeFollows(){
  if(followCh) sb.removeChannel(followCh);
  followCh = sb.channel('follows-rt-'+ME.id)
    .on('postgres_changes', {event:'*', schema:'public', table:'follows'}, async () => {
      await loadFollowMap();
      renderPeopleList(allUsers);
      loadConvos();
    })
    // Kalau ada user baru daftar → refresh people list
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'users'}, async (payload) => {
      if(payload.new?.id === ME.id) return; // skip diri sendiri
      // Tambah user baru ke allUsers tanpa reload full
      const newUser = { ...payload.new, is_online: false };
      const sudahAda = allUsers.find(u => u.id === newUser.id);
      if(!sudahAda) {
        allUsers = [newUser, ...allUsers];
        renderPeopleList(allUsers);
      }
    })
    .subscribe();
}

async function toggleFollow(targetId,targetUsername,targetEmail){
  if(followMap[targetId]==='accepted'){
    if(!confirm(`Berhenti follow @${targetUsername}?`)) return;
    await sb.from('follows').delete().eq('sender_id',ME.id).eq('receiver_id',targetId);
    delete followMap[targetId];
    showToast(`Berhenti follow @${targetUsername}`);
  } else {
    await sb.from('follows').upsert(
      {sender_id:ME.id, receiver_id:targetId, status:'accepted'},
      {onConflict:'sender_id,receiver_id'}
    );
    followMap[targetId]='accepted';
    await ensureConversation(targetId, targetUsername, targetEmail);
    showToast(`Kamu follow @${targetUsername}! 🎉`);
    await loadConvos();
  }
  renderPeopleList(allUsers); updateSidebarUI();
}

async function ensureConversation(partnerId, partnerUsername, partnerEmail){
  const [uid1, uid2] = [ME.id, partnerId].sort();

  // Step 1: upsert dulu
  const { error: upsertErr } = await sb.from('conversations').upsert(
    { owner_id: uid1, partner_id: uid2, updated_at: new Date().toISOString() },
    { onConflict: 'owner_id,partner_id', ignoreDuplicates: false }
  );
  if (upsertErr) console.warn('ensureConvo upsert:', upsertErr.message);

  // Step 2: fetch ID secara terpisah — lebih reliable dari upsert return
  const { data, error: fetchErr } = await sb.from('conversations')
    .select('id')
    .eq('owner_id', uid1)
    .eq('partner_id', uid2)
    .single();

  if (fetchErr) {
    console.error('ensureConvo fetch:', fetchErr.message);
    return null;
  }
  return data?.id || null;
}

async function getSharedConvoId(partnerId){
  const [uid1, uid2] = [ME.id, partnerId].sort();
  const { data } = await sb.from('conversations')
    .select('id')
    .eq('owner_id', uid1)
    .eq('partner_id', uid2)
    .single();
  return data?.id || null;
}

// ════════════════════════════════
//  BOOTSTRAP — entry point utama
// ════════════════════════════════
(async () => {
  // Tampilkan splash dulu
  const splash = document.getElementById('screen-splash');
  if (splash) splash.style.display = 'flex';

  // Load config dari API
  const ok = await fetchConfig();
  if (!ok) {
    if (splash) splash.innerHTML = `
      <div style="text-align:center;color:#ef4444;padding:40px;">
        <i class="fa fa-triangle-exclamation" style="font-size:40px;margin-bottom:16px;display:block;"></i>
        <div style="font-size:16px;font-weight:700;">Gagal memuat konfigurasi</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:8px;">Cek koneksi dan coba lagi</div>
        <button onclick="location.reload()" style="margin-top:20px;padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;">Muat Ulang</button>
      </div>`;
    return;
  }

  // Setelah config siap, jalankan auth listener
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_IN' && session?.user) {
      ME = session.user;
      await loadMyProfile();
    } else if (event === 'SIGNED_OUT') {
      showScreen('screen-auth');
    } else if (event === 'PASSWORD_RECOVERY') {
      showScreen('screen-reset');
    }
  });

  // Cek session existing
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    ME = session.user;
    await loadMyProfile();
  } else {
    showScreen('screen-auth');
  }
})();
