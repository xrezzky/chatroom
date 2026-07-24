// XREZZKY Chat — follows.js

// ════════════════════════════════
//  FOLLOW MAP
// ════════════════════════════════
async function loadFollowMap(){
  const {data}=await sb.from('follows').select('receiver_id,status').eq('sender_id',ME.id);
  followMap={};
  if(data) data.forEach(f=>{ followMap[f.receiver_id]=f.status; });
}

function subscribeFollows(){
  if(followCh) sb.removeChannel(followCh);
  followCh = sb.channel('follows-rt-'+ME.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'follows'},async()=>{
      await loadFollowMap();
      renderPeopleList(allUsers);
      loadConvos();
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'users'},async(payload)=>{
      if(payload.new?.id===ME.id) return;
      const newUser={...payload.new,is_online:false};
      if(!allUsers.find(u=>u.id===newUser.id)){
        allUsers=[newUser,...allUsers];
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
      {sender_id:ME.id,receiver_id:targetId,status:'accepted'},
      {onConflict:'sender_id,receiver_id'}
    );
    followMap[targetId]='accepted';
    await ensureConversation(targetId,targetUsername,targetEmail);
    showToast(`Kamu follow @${targetUsername}! 🎉`);
    await loadConvos();
  }
  renderPeopleList(allUsers);
  updateSidebarUI();
}

async function ensureConversation(partnerId,partnerUsername,partnerEmail){
  const [uid1,uid2]=[ME.id,partnerId].sort();
  const {error:upsertErr}=await sb.from('conversations').upsert(
    {owner_id:uid1,partner_id:uid2,updated_at:new Date().toISOString()},
    {onConflict:'owner_id,partner_id',ignoreDuplicates:false}
  );
  if(upsertErr) console.warn('ensureConvo:',upsertErr.message);
  const {data}=await sb.from('conversations').select('id').eq('owner_id',uid1).eq('partner_id',uid2).single();
  return data?.id||null;
}

async function getSharedConvoId(partnerId){
  const [uid1,uid2]=[ME.id,partnerId].sort();
  const {data}=await sb.from('conversations').select('id').eq('owner_id',uid1).eq('partner_id',uid2).single();
  return data?.id||null;
}

// ════════════════════════════════
//  PEOPLE / DISCOVER
// ════════════════════════════════
async function loadPeopleList(){
  const el=document.getElementById('people-list');
  el.innerHTML=`<div class="convo-empty"><i class="fa fa-spinner fa-spin"></i><p>Memuat pengguna...</p></div>`;
  try {
    const {data:{session}}=await sb.auth.getSession();
    if(!session){ el.innerHTML=`<div class="convo-empty"><i class="fa fa-lock"></i><p>Sesi habis</p></div>`; return; }

    const {data:users,error}=await sb.from('users')
      .select('id,username,email,bio,role,is_stealth,secret_keyword,avatar_url')
      .neq('id',ME.id).eq('is_stealth',false)
      .order('created_at',{ascending:false});

    let stealthUsers=[];
    if(myRole==='owner'||myRole==='admin'){
      const {data:st}=await sb.from('users')
        .select('id,username,email,bio,role,is_stealth,secret_keyword,avatar_url')
        .neq('id',ME.id).eq('is_stealth',true);
      stealthUsers=st||[];
    }

    if(error){ el.innerHTML=`<div class="convo-empty"><i class="fa fa-triangle-exclamation"></i><p>${error.message}</p></div>`; return; }

    const allVisible=[...(users||[]),...stealthUsers];
    if(!allVisible.length){
      el.innerHTML=`<div class="convo-empty"><i class="fa fa-users"></i><p>Belum ada pengguna lain</p><small>Ajak temenmu daftar!</small></div>`;
      allUsers=[]; return;
    }

    const ids=allVisible.map(u=>u.id);
    const {data:pres}=await sb.from('user_presence').select('user_id,is_online').in('user_id',ids);
    const presMap={};
    if(pres) pres.forEach(p=>{ presMap[p.user_id]=p.is_online; });
    allUsers=allVisible.map(u=>({...u,is_online:presMap[u.id]||false}));
    renderPeopleList(allUsers);
  } catch(e){
    el.innerHTML=`<div class="convo-empty"><i class="fa fa-triangle-exclamation"></i><p>Gagal memuat pengguna</p></div>`;
  }
}

function renderPeopleList(list){
  const el=document.getElementById('people-list');
  if(!list||!list.length){ el.innerHTML=`<div class="convo-empty"><i class="fa fa-users"></i><p>Belum ada pengguna lain</p></div>`; return; }
  const following=list.filter(u=>followMap[u.id]==='accepted');
  const others=list.filter(u=>followMap[u.id]!=='accepted');
  let html='';
  if(following.length) html+=`<div class="people-section-title">Kamu Ikuti</div>`+following.map(buildPeopleCard).join('');
  if(others.length)    html+=`<div class="people-section-title">Semua Pengguna</div>`+others.map(buildPeopleCard).join('');
  el.innerHTML=html;
}

function buildPeopleCard(u){
  const isFollowing=followMap[u.id]==='accepted';
  const isBlocked=blockSet.has(u.id);
  const photo=u.avatar_url||avatarUrl(u.username);
  const roleBadge=u.role&&u.role!=='user'?getRoleBadgeHTML(u.role):'';
  const stealthBadge=u.is_stealth?`<span style="font-size:9px;background:rgba(139,92,246,.15);color:#a78bfa;padding:2px 6px;border-radius:99px;"><i class="fa fa-user-secret"></i></span>`:'';

  const btn=isBlocked
    ?`<button class="btn-follow" style="background:var(--surface2);color:var(--text3);font-size:11px;" onclick="event.stopPropagation();unblockUser('${u.id}','${u.username}')"><i class="fa fa-unlock"></i></button>`
    :isFollowing
    ?`<button class="btn-follow chat-now" onclick="event.stopPropagation();quickOpenChat('${u.id}','${u.username}','${u.email}')"><i class="fa fa-message"></i> Chat</button>`
    :`<button class="btn-follow not-followed" onclick="event.stopPropagation();toggleFollow('${u.id}','${u.username}','${u.email}')"><i class="fa fa-user-plus"></i> Follow</button>`;

  return `<div class="people-card"
    data-username="${(u.username||'').toLowerCase()}"
    data-email="${(u.email||'').toLowerCase()}"
    onclick="showUserProfile('${u.id}','${esc(u.username||'')}','${esc(u.email||'')}','${esc((u.bio||'').replace(/'/g,''))}',${u.is_online||false})">
    <div class="people-card-avatar">
      <img src="${photo}" alt="" style="object-fit:cover;">
      ${u.is_online?`<div class="online-ring"></div>`:''}
    </div>
    <div class="people-info">
      <div class="people-name">${esc(u.username||'')} ${roleBadge} ${stealthBadge}</div>
      <div class="people-bio">${esc(u.bio||'Belum ada bio')}</div>
    </div>
    <div onclick="event.stopPropagation()">${btn}</div>
  </div>`;
}

async function filterPeople(v){
  const q=v.toLowerCase().trim();
  if(q.length>=4){
    const {data:stealthUsers}=await sb.from('users')
      .select('id,username,email,bio,is_online,is_stealth,secret_keyword,avatar_url')
      .eq('is_stealth',true).eq('secret_keyword',v.trim()).neq('id',ME.id);
    if(stealthUsers?.length){
      const found={...stealthUsers[0]};
      const {data:presData}=await sb.from('user_presence').select('is_online').eq('user_id',found.id).single();
      found.is_online=presData?.is_online||false;
      const el=document.getElementById('people-list');
      el.innerHTML=`<div style="padding:10px;background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.2);border-radius:12px;margin-bottom:8px;font-size:11px;color:#a78bfa;font-weight:700;text-align:center;">🔑 User ditemukan via kata kunci rahasia</div>${buildPeopleCard(found)}`;
      return;
    }
  }
  document.querySelectorAll('.people-card').forEach(el=>{
    el.style.display=!q||el.dataset.username?.includes(q)||el.dataset.email?.includes(q)?'':'none';
  });
  document.querySelectorAll('.people-section-title').forEach(title=>{
    let next=title.nextElementSibling,anyVisible=false;
    while(next&&!next.classList.contains('people-section-title')){ if(next.style.display!=='none') anyVisible=true; next=next.nextElementSibling; }
    title.style.display=anyVisible?'':'none';
  });
}

async function quickOpenChat(partnerId,partnerUsername,partnerEmail){
  showToast('⏳ Membuka chat...');
  switchSidebarTab('messages');
  let convoId=await getSharedConvoId(partnerId);
  if(!convoId) convoId=await ensureConversation(partnerId,partnerUsername,partnerEmail);
  if(convoId) await openConvo(convoId,partnerId,partnerUsername,partnerEmail);
}
