// XREZZKY Chat — follows.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

// ════════════════════════════════
//  PEOPLE / DISCOVER
// ════════════════════════════════
async function loadPeopleList(){
  const el = document.getElementById('people-list');
  el.innerHTML = `<div class="convo-empty"><i class="fa fa-spinner fa-spin"></i><p>Memuat pengguna...</p></div>`;
  try {
    const {data:{session}} = await sb.auth.getSession();
    if(!session){ el.innerHTML=`<div class="convo-empty"><i class="fa fa-lock"></i><p>Sesi habis</p></div>`; return; }

    // Semua user tampil di global KECUALI:
    // 1. Diri sendiri
    // 2. Yang is_stealth = TRUE
    // Admin/owner dengan is_stealth=FALSE tetap muncul
    const {data:users, error} = await sb.from('users')
      .select('id,username,email,bio,role,is_stealth,secret_keyword,avatar_url')
      .neq('id', ME.id)
      .eq('is_stealth', false)  // semua role yang tidak stealth
      .order('created_at',{ascending:false});

    // Kalau admin/owner — lihat semua termasuk stealth
    let stealthUsers = [];
    if(myRole === 'owner' || myRole === 'admin'){
      const {data:stData} = await sb.from('users')
        .select('id,username,email,bio,role,is_stealth,secret_keyword,avatar_url')
        .neq('id', ME.id)
        .eq('is_stealth', true);
      stealthUsers = stData || [];
    }

    if(error){ el.innerHTML=`<div class="convo-empty"><i class="fa fa-triangle-exclamation"></i><p>${error.message}</p></div>`; return; }

    const allVisible = [...(users||[]), ...stealthUsers];
    if(!allVisible.length){
      el.innerHTML=`<div class="convo-empty"><i class="fa fa-users"></i><p>Belum ada pengguna lain</p><small>Ajak temenmu daftar!</small></div>`;
      allUsers=[]; return;
    }

    const ids = allVisible.map(u=>u.id);
    const {data:pres} = await sb.from('user_presence').select('user_id,is_online').in('user_id',ids);
    const presMap = {};
    if(pres) pres.forEach(p=>{ presMap[p.user_id]=p.is_online; });
    allUsers = allVisible.map(u=>({...u, is_online: presMap[u.id]||false}));
    renderPeopleList(allUsers);
  } catch(e) {
    el.innerHTML=`<div class="convo-empty"><i class="fa fa-triangle-exclamation"></i><p>Gagal memuat pengguna</p></div>`;
  }
}

function renderPeopleList(list){
  const el=document.getElementById('people-list');
  if(!list.length){ el.innerHTML=`<div class="convo-empty"><i class="fa fa-users"></i><p>Belum ada pengguna lain</p></div>`; return; }
  const following=list.filter(u=>followMap[u.id]==='accepted');
  const others=list.filter(u=>followMap[u.id]!=='accepted');
  let html='';
  if(following.length){ html+=`<div class="people-section-title">Kamu Ikuti</div>`+following.map(buildPeopleCard).join(''); }
  if(others.length){ html+=`<div class="people-section-title">Semua Pengguna</div>`+others.map(buildPeopleCard).join(''); }
  el.innerHTML=html;
}

function buildPeopleCard(u){
  const isFollowing = followMap[u.id]==='accepted';
  const isBlocked   = blockSet.has(u.id);
  const photo       = u.avatar_url || avatarUrl(u.username);
  const roleBadge   = u.role&&u.role!=='user' ? getRoleBadgeHTML(u.role) : '';
  const stealthBadge= u.is_stealth ? `<span style="font-size:9px;background:rgba(139,92,246,.15);color:#a78bfa;padding:2px 6px;border-radius:99px;font-weight:700;"><i class="fa fa-user-secret"></i></span>` : '';

  const btn = isBlocked
    ? `<button class="btn-follow" style="background:var(--surface2);color:var(--text3);font-size:11px;" onclick="event.stopPropagation();unblockUser('${u.id}','${u.username}')"><i class="fa fa-unlock"></i></button>`
    : isFollowing
    ? `<button class="btn-follow chat-now" onclick="event.stopPropagation();quickOpenChat('${u.id}','${u.username}','${u.email}')"><i class="fa fa-message"></i> Chat</button>`
    : `<button class="btn-follow not-followed" onclick="event.stopPropagation();toggleFollow('${u.id}','${u.username}','${u.email}')"><i class="fa fa-user-plus"></i> Follow</button>`;

  return `<div class="people-card"
    data-username="${(u.username||'').toLowerCase()}"
    data-email="${(u.email||'').toLowerCase()}"
    onclick="showUserProfile('${u.id}','${u.username}','${u.email}','${(u.bio||'').replace(/'/g,"")}',${u.is_online})">
    <div class="people-card-avatar">
      <img src="${photo}" alt="" style="object-fit:cover;">
      ${u.is_online ? `<div class="online-ring"></div>` : ''}
    </div>
    <div class="people-info">
      <div class="people-name">${u.username} ${roleBadge} ${stealthBadge}</div>
      <div class="people-bio">${u.bio||'Belum ada bio'}</div>
    </div>
    <div onclick="event.stopPropagation()">${btn}</div>
  </div>`;
}

async function filterPeople(v){
  const q = v.toLowerCase().trim();

  // Cek apakah input adalah kata kunci rahasia dari stealth user
  if(q.length >= 4){
    const {data:stealthUsers} = await sb.from('users')
      .select('id,username,email,bio,is_online,is_stealth,secret_keyword')
      .eq('is_stealth', true)
      .eq('secret_keyword', v.trim())
      .neq('id', ME.id);

    if(stealthUsers?.length){
      // Tampilkan stealth user yang cocok kata kuncinya
      const found = {...stealthUsers[0]};
      const {data:presData} = await sb.from('user_presence').select('is_online').eq('user_id',found.id).single();
      found.is_online = presData?.is_online || false;

      const el = document.getElementById('people-list');
      el.innerHTML = `
        <div style="padding:10px;background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.2);border-radius:12px;margin-bottom:8px;font-size:11px;color:#a78bfa;font-weight:700;text-align:center;">
          🔑 User ditemukan via kata kunci rahasia
        </div>
        ${buildPeopleCard(found)}`;
      return;
    }
  }

  // Filter normal
  document.querySelectorAll('.people-card').forEach(el=>{
    const match = !q || el.dataset.username?.includes(q) || el.dataset.email?.includes(q);
    el.style.display = match ? '' : 'none';
  });
  document.querySelectorAll('.people-section-title').forEach(title=>{
    let next=title.nextElementSibling, anyVisible=false;
    while(next&&!next.classList.contains('people-section-title')){ if(next.style.display!=='none') anyVisible=true; next=next.nextElementSibling; }
    title.style.display=anyVisible?'':'none';
  });
}

async function quickOpenChat(partnerId, partnerUsername, partnerEmail){
  showToast('⏳ Membuka chat...');
  switchSidebarTab('messages');
  try {
    let convoId = await getSharedConvoId(partnerId);
    if (!convoId) convoId = await ensureConversation(partnerId, partnerUsername, partnerEmail);
    if (!convoId) { showToast('❌ Gagal membuka chat. Pastikan sudah follow user ini.'); return; }
    await loadConvos();
    await openConvo(convoId, partnerId, partnerUsername, partnerEmail);
  } catch(e) {
    console.error('quickOpenChat:', e);
    showToast('❌ Gagal: ' + e.message);
  }
}
