// XREZZKY Chat — misc.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure


// ════════════════════════════════
//  REALTIME CLOCK
// ════════════════════════════════
function startRealtimeClock(){
  function tick(){
    const now=new Date();
    const jam=now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const tgl=now.toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short'});
    const el=document.getElementById('sidebar-clock');
    if(el) el.innerText=`${tgl} · ${jam}`;
  }
  tick();
  setInterval(tick,1000);
}

// ════════════════════════════════
//  UTILS
// ════════════════════════════════
// ════════════════════════════════
//  BLOCKS
// ════════════════════════════════
async function loadBlockSet(){
  const { data } = await sb.from('blocks').select('blocked_id').eq('blocker_id', ME.id);
  blockSet = new Set((data||[]).map(b => b.blocked_id));
}

async function blockUser(targetId, targetUsername){
  if(!confirm(`Blokir @${targetUsername}? Mereka tidak bisa mengirim pesan ke kamu.`)) return;
  await sb.from('blocks').upsert({blocker_id:ME.id, blocked_id:targetId},{onConflict:'blocker_id,blocked_id'});
  blockSet.add(targetId);
  // Unfollow juga
  await sb.from('follows').delete().eq('sender_id',ME.id).eq('receiver_id',targetId);
  delete followMap[targetId];
  showToast(`@${targetUsername} diblokir.`);
  renderPeopleList(allUsers);
  closeUserProfile();
  if(activePartner?.id === targetId) updateChatInputState();
}

async function unblockUser(targetId, targetUsername){
  if(!confirm(`Buka blokir @${targetUsername}?`)) return;
  await sb.from('blocks').delete().eq('blocker_id',ME.id).eq('blocked_id',targetId);
  blockSet.delete(targetId);
  showToast(`@${targetUsername} tidak lagi diblokir.`);
  renderPeopleList(allUsers);
  if(activePartner?.id === targetId) updateChatInputState();
}

function unblockFromBanner(){
  if(activePartner) unblockUser(activePartner.id, activePartner.username);
}

async function isBlockedBy(targetId){
  // Cek apakah target memblokir kita
  const { data } = await sb.from('blocks').select('id').eq('blocker_id',targetId).eq('blocked_id',ME.id).single();
  return !!data;
}

// ════════════════════════════════
//  CHAT STATUS & REQUEST SYSTEM
// ════════════════════════════════
async function updateChatInputState(){
  if(!activeConvoId || !activePartner) return;

  const inputBar    = document.getElementById('input-bar');
  const reqBanner   = document.getElementById('request-banner');
  const blockedBan  = document.getElementById('blocked-banner');
  const lockedBar   = document.getElementById('chat-locked-bar');

  // Reset semua
  inputBar.style.display    = '';
  reqBanner.style.display   = 'none';
  blockedBan.style.display  = 'none';
  lockedBar.style.display   = 'none';

  // Cek blokir
  if(blockSet.has(activePartner.id)){
    inputBar.style.display   = 'none';
    blockedBan.style.display = 'flex';
    document.getElementById('blocked-banner-text').innerText = `Kamu memblokir @${activePartner.username}.`;
    return;
  }

  // Cek diblokir oleh partner
  const blockedByThem = await isBlockedBy(activePartner.id);
  if(blockedByThem){
    inputBar.style.display   = 'none';
    blockedBan.style.display = 'flex';
    document.getElementById('blocked-banner-text').innerText = 'Kamu tidak bisa mengirim pesan ke pengguna ini.';
    const unblockBtn = blockedBan.querySelector('button');
    if(unblockBtn) unblockBtn.style.display = 'none';
    return;
  }

  // Cek status conversation
  const { data: convo } = await sb.from('conversations').select('chat_status').eq('id',activeConvoId).single();
  const isMutual = followMap[activePartner.id] === 'accepted';

  if(convo?.chat_status === 'active' || isMutual){
    // Chat normal
    return;
  }

  // Status pending — cek apakah kita yang kirim request atau yang nerima
  const { data: myMsg } = await sb.from('messages')
    .select('id').eq('conversation_id',activeConvoId).eq('sender_id',ME.id).eq('is_request',true).single();

  const { data: theirMsg } = await sb.from('messages')
    .select('id,sender_id').eq('conversation_id',activeConvoId).eq('is_request',true).single();

  if(theirMsg && theirMsg.sender_id !== ME.id){
    // Partner yang kirim request — tampilkan banner di sisi kita
    reqBanner.style.display = 'flex';
    document.getElementById('req-banner-sub').innerText =
      `@${activePartner.username} mengirimkan permintaan chat. Follow balik untuk bisa chat normal.`;
    inputBar.style.display = 'none';
    return;
  }

  if(myMsg){
    // Kita sudah kirim 1 request — lock input
    inputBar.style.display   = 'none';
    lockedBar.style.display  = 'flex';
    return;
  }

  // Belum ada pesan sama sekali — bisa kirim 1 request
  // Input normal, tapi pesan pertama akan di-mark is_request=true
}

async function acceptChatRequest(){
  // Follow balik partner
  if(activePartner){
    await sb.from('follows').upsert(
      {sender_id:ME.id, receiver_id:activePartner.id, status:'accepted'},
      {onConflict:'sender_id,receiver_id'}
    );
    followMap[activePartner.id] = 'accepted';
    // Trigger SQL akan auto set chat_status = active
    showToast(`Kamu follow @${activePartner.username} balik! Chat terbuka 🎉`);
    await updateChatInputState();
    renderPeopleList(allUsers);
    updateSidebarUI();
  }
}

async function declineChatRequest(){
  if(!activePartner) return;
  // Unfollow sender (kalau ada) dan hapus conversation
  await sb.from('follows').delete().eq('sender_id',activePartner.id).eq('receiver_id',ME.id);
  await sb.from('conversations').delete().eq('id',activeConvoId);
  backToList();
  showToast('Permintaan chat diabaikan.');
}

// ════════════════════════════════
//  REPORTS
// ════════════════════════════════
let _reportTargetId   = null;
let _reportTargetName = null;
let _reportMessageId  = null;
let _reportReason     = null;

function openReport(userId, username, msgId = null){
  _reportTargetId   = userId;
  _reportTargetName = username;
  _reportMessageId  = msgId;
  _reportReason     = null;
  document.getElementById('report-detail').value = '';
  document.querySelectorAll('.report-reason-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('report-submit-btn').disabled = true;
  document.getElementById('modal-report').classList.add('open');
  closeUserProfile();
  hideCtxMenu();
}

function selectReason(btn, reason){
  document.querySelectorAll('.report-reason-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _reportReason = reason;
  document.getElementById('report-submit-btn').disabled = false;
}

function closeReport(){
  document.getElementById('modal-report').classList.remove('open');
}

async function submitReport(){
  if(!_reportReason || !_reportTargetId) return;
  const btn = document.getElementById('report-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Mengirim...';

  const detail = document.getElementById('report-detail').value.trim();

  const { error } = await sb.from('reports').insert({
    reporter_id: ME.id,
    reported_id: _reportTargetId,
    message_id:  _reportMessageId || null,
    reason:      _reportReason,
    detail:      detail,
    status:      'pending'
  });

  btn.disabled = false;
  btn.innerHTML = '<i class="fa fa-flag"></i> Kirim Laporan';

  if(error){
    showToast('❌ Gagal mengirim laporan: ' + error.message);
    return;
  }

  closeReport();
  showToast('✅ Laporan terkirim. Tim kami akan meninjau.');
}

// ════════════════════════════════
//  ROLE SYSTEM
// ════════════════════════════════
function getRoleBadgeHTML(role){
  if(role === 'owner') return `<span class="role-badge owner"><i class="fa fa-crown"></i> Owner</span>`;
  if(role === 'admin') return `<span class="role-badge admin"><i class="fa fa-shield-halved"></i> Admin</span>`;
  return '';
}

// Admin/Owner: pantau chat langsung (monitor mode)
async function monitorChat(userId, username, email){
  // Admin bisa buka chat siapapun sebagai observer
  // Kita ambil conversation ID antara dua user tersebut
  // Untuk simplicity: buka chat biasa tapi dengan flag monitor
  closeUserProfile();
  showToast(`👁️ Memantau chat @${username}...`);

  // Cari semua conversation yang melibatkan user ini
  const { data: convosData } = await sb.from('conversations')
    .select('*, partner:partner_id(*), owner:owner_id(*)')
    .or(`owner_id.eq.${userId},partner_id.eq.${userId}`)
    .order('updated_at', {ascending:false})
    .limit(1);

  if(!convosData || !convosData.length){
    showToast('User ini belum punya percakapan.');
    return;
  }

  const c = convosData[0];
  const partner = c.owner_id === userId ? c.partner : c.owner;
  if(!partner) return;

  // Open convo in read-only monitor mode
  await openConvoMonitor(c.id, userId, username, partner);
}

async function openConvoMonitor(convoId, monitoredId, monitoredName, partner){
  // Set active convo tapi dalam mode monitor (ga bisa kirim)
  activeConvoId = convoId;
  activePartner = { id: partner.id, username: partner.username, email: partner.email };

  document.getElementById('ch-avatar').src = avatarUrl(monitoredName);
  document.getElementById('ch-name').innerText = `👁️ ${monitoredName} ↔ ${partner.username}`;
  document.getElementById('ch-status').innerText = 'Mode Monitor — Read Only';
  document.getElementById('ch-status').className = 'chat-partner-status';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-ui').style.display = 'flex';
  document.getElementById('sidebar').classList.add('hidden-mobile');
  document.getElementById('chatroom').classList.add('show-mobile');

  // Sembunyikan input — monitor tidak bisa kirim
  document.getElementById('input-bar').style.display = 'none';
  document.getElementById('chat-locked-bar').style.display = 'none';
  document.getElementById('blocked-banner').style.display = 'none';
  document.getElementById('request-banner').style.display = 'none';

  await loadMessages();
  subscribeMessages(convoId);
}
let _profileUserId = null;

async function showUserProfile(userId, username, email, bio, isOnline){
  _profileUserId = userId;
  const overlay = document.getElementById('modal-user-profile');
  overlay.classList.add('open');

  // Set data langsung
  document.getElementById('pm-avatar').src = avatarUrl(username);
  document.getElementById('pm-name').innerText = username;
  document.getElementById('pm-bio').innerText = bio || 'Belum ada bio';

  const dot = document.getElementById('pm-online-dot');
  const badge = document.getElementById('pm-status-badge');
  if(isOnline){
    dot.style.display = 'block';
    badge.innerText = '🟢 Online';
    badge.className = 'pm-status-badge online';
  } else {
    dot.style.display = 'none';
    badge.innerText = 'Offline';
    badge.className = 'pm-status-badge offline';
  }

  // Reset stats & actions
  document.getElementById('pm-followers').innerText = '-';
  document.getElementById('pm-following').innerText = '-';
  renderProfileActions(userId, username, email);

  // Load stats async
  try {
    const [{ count: flwrs }, { count: flwing }] = await Promise.all([
      sb.from('follows').select('*', {count:'exact', head:true}).eq('receiver_id', userId).eq('status','accepted'),
      sb.from('follows').select('*', {count:'exact', head:true}).eq('sender_id', userId).eq('status','accepted'),
    ]);
    document.getElementById('pm-followers').innerText = flwrs || 0;
    document.getElementById('pm-following').innerText = flwing || 0;
  } catch(e) { console.error('profile stats:', e); }
}

function renderProfileActions(userId, username, email){
  const isFollowing = followMap[userId]==='accepted';
  const isBlocked   = blockSet.has(userId);
  const el          = document.getElementById('pm-actions');
  let html = '';

  if(isBlocked){
    html += `<button class="pm-btn secondary" onclick="unblockUser('${userId}','${esc(username)}');closeUserProfile()">
      <i class="fa fa-unlock"></i> Buka Blokir
    </button>`;
  } else {
    if(isFollowing){
      html += `<button class="pm-btn primary" onclick="closeUserProfile();quickOpenChat('${userId}','${esc(username)}','${esc(email)}')">
        <i class="fa fa-message"></i> Kirim Pesan
      </button>`;
      html += `<button class="pm-btn secondary" onclick="toggleFollow('${userId}','${esc(username)}','${esc(email)}');closeUserProfile()">
        <i class="fa fa-user-minus"></i> Unfollow
      </button>`;
    } else {
      html += `<button class="pm-btn primary" onclick="toggleFollow('${userId}','${esc(username)}','${esc(email)}');renderProfileActions('${userId}','${esc(username)}','${esc(email)}')">
        <i class="fa fa-user-plus"></i> Follow
      </button>`;
    }
    html += `<button class="pm-btn danger" onclick="blockUser('${userId}','${esc(username)}')">
      <i class="fa fa-ban"></i>
    </button>`;
  }

  // Laporan — semua user bisa
  html += `<button class="pm-btn secondary" style="flex:none;padding:14px;" title="Laporkan" onclick="openReport('${userId}','${esc(username)}')">
    <i class="fa fa-flag" style="color:var(--red)"></i>
  </button>`;

  // Admin/Owner monitor
  if(myRole === 'owner' || myRole === 'admin'){
    html += `<button class="pm-btn secondary" style="flex:none;padding:14px;" title="Pantau Chat" onclick="monitorChat('${userId}','${esc(username)}','${esc(email)}')">
      <i class="fa fa-eye" style="color:var(--accent)"></i>
    </button>`;
  }

  el.innerHTML = html;
}

function closeUserProfile(){
  document.getElementById('modal-user-profile').classList.remove('open');
  _profileUserId = null;
}
