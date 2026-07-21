// XREZZKY Chat — groups.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

let activeGroupId = null;
let groupMsgCh = null;
let selectedMembers = {};

async function loadGroups(){
  const el = document.getElementById('groups-list');
  el.innerHTML = `<div class="convo-empty"><i class="fa fa-spinner fa-spin"></i><p>Memuat grup...</p></div>`;
  try {
    const {data:myGroups} = await sb.from('group_members')
      .select('group_id,role,group:group_id(id,name,description,avatar_url,is_public,created_by,created_at)')
      .eq('user_id', ME.id);
    const {data:publicGroups} = await sb.from('groups')
      .select('id,name,description,avatar_url,is_public,created_by,created_at')
      .eq('is_public', true).order('created_at',{ascending:false});

    const myGroupIds = new Set((myGroups||[]).map(m=>m.group_id));
    allGroups = [
      ...(myGroups||[]).map(m=>({...m.group, myRole:m.role, isMember:true})),
      ...(publicGroups||[]).filter(g=>!myGroupIds.has(g.id)).map(g=>({...g, myRole:null, isMember:false}))
    ];
    if(!allGroups.length){
      el.innerHTML=`<div class="convo-empty"><i class="fa fa-users"></i><p>Belum ada grup</p><small>Tap + untuk buat grup baru</small></div>`;
      return;
    }
    renderGroupList(allGroups);
  } catch(e) {
    el.innerHTML=`<div class="convo-empty"><i class="fa fa-triangle-exclamation"></i><p>Gagal memuat grup</p></div>`;
  }
}

function renderGroupList(list){
  const el = document.getElementById('groups-list');
  const joined   = list.filter(g=>g.isMember);
  const discover = list.filter(g=>!g.isMember);
  let html = '';
  if(joined.length){ html+=`<div class="people-section-title">Grup Saya</div>`+joined.map(buildGroupCard).join(''); }
  if(discover.length){ html+=`<div class="people-section-title">Grup Publik</div>`+discover.map(buildGroupCard).join(''); }
  el.innerHTML = html;
}

function buildGroupCard(g){
  return `<div class="group-card${activeGroupId===g.id?' active':''}"
    onclick="openGroupChat('${g.id}','${esc(g.name)}')"
    data-name="${(g.name||'').toLowerCase()}">
    <div class="group-avatar">${g.avatar_url?`<img src="${g.avatar_url}">`:'<i class="fa fa-users" style="color:#fff;font-size:20px;"></i>'}</div>
    <div class="group-info">
      <div class="group-name">${esc(g.name)} ${g.is_public?`<span class="badge-public">Publik</span>`:''}</div>
      <div class="group-last">${esc(g.description||'Tap untuk buka')}</div>
    </div>
    <div class="group-meta">
      ${!g.isMember
        ?`<button class="btn-follow not-followed" style="font-size:11px;padding:5px 10px;" onclick="event.stopPropagation();joinGroup('${g.id}','${esc(g.name)}')"><i class="fa fa-right-to-bracket"></i> Gabung</button>`
        :`<span class="group-count" style="font-size:10px;color:var(--text3);">${g.myRole}</span>`}
    </div>
  </div>`;
}

function filterGroups(v){
  document.querySelectorAll('.group-card').forEach(el=>{
    el.style.display=!v||el.dataset.name?.includes(v.toLowerCase())?'':'none';
  });
}

async function openGroupChat(groupId, groupName){
  activeGroupId  = groupId;
  activeConvoId  = null;
  activePartner  = null;

  const {data:membership} = await sb.from('group_members')
    .select('role').eq('group_id',groupId).eq('user_id',ME.id).single();
  if(!membership){ showToast('Gabung grup dulu!'); return; }

  document.getElementById('ch-avatar').src = avatarUrl(groupName);
  document.getElementById('ch-name').innerText = groupName;
  document.getElementById('ch-status').innerText = 'Grup · Memuat...';
  document.getElementById('ch-status').className = 'chat-partner-status';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-ui').style.display = 'flex';
  document.getElementById('request-banner').style.display = 'none';
  document.getElementById('blocked-banner').style.display = 'none';
  document.getElementById('chat-locked-bar').style.display = 'none';
  document.getElementById('input-bar').style.display = '';
  document.getElementById('pin-bar').style.display = 'none';
  document.getElementById('sidebar').classList.add('hidden-mobile');
  document.getElementById('chatroom').classList.add('show-mobile');

  // Update header actions untuk grup
  document.querySelector('.chat-header-actions').innerHTML = `
    <button class="icon-btn" onclick="openGroupInfo('${groupId}')" title="Info Grup">
      <i class="fa fa-circle-info" style="color:var(--accent);font-size:13px;"></i>
    </button>`;

  // Sembunyikan tombol call untuk grup
  const callBtn2 = document.getElementById('btn-voice-call');
  if(callBtn2) callBtn2.style.display = 'none';

  msgs = [];
  await loadGroupMessages(groupId);
  subscribeGroupMessages(groupId);

  const {count} = await sb.from('group_members').select('*',{count:'exact',head:true}).eq('group_id',groupId);
  document.getElementById('ch-status').innerText = `${count||0} member`;
  document.getElementById('msg-input').focus();

  // Highlight active group card
  document.querySelectorAll('.group-card').forEach(el=>{
    el.classList.toggle('active', el.dataset.name===(groupName||'').toLowerCase()&&el.onclick?.toString().includes(groupId));
  });
}

async function loadGroupMessages(groupId){
  const {data} = await sb.from('group_messages')
    .select('*, sender:sender_id(id,username)')
    .eq('group_id', groupId).is('deleted_at',null)
    .order('created_at',{ascending:true});
  msgs = (data||[]).map(m=>({...m, isGroupMsg:true}));
  renderGroupMessages();
  scrollBottom();
}

function renderGroupMessages(){
  const el = document.getElementById('msg-area');
  let html='', lastDate='';
  msgs.forEach(m=>{
    const d = new Date(m.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    if(d!==lastDate){ html+=`<div class="date-sep"><div class="date-sep-line"></div><div class="date-sep-label">${d}</div><div class="date-sep-line"></div></div>`; lastDate=d; }
    html += buildGroupMsgHTML(m);
  });
  el.innerHTML = html;
}

function buildGroupMsgHTML(m){
  const isMe   = m.sender_id===ME.id;
  const sender = m.sender?.username||'?';
  const time   = new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  if(m.deleted_at) return `<div class="msg-row${isMe?' me':' them'}" data-id="${m.id}">
    ${!isMe?`<img class="msg-avatar" src="${avatarUrl(sender)}">`:''}
    <div class="msg-bubble-wrap">
      <div class="msg-bubble" style="background:var(--surface);border:1px solid var(--border);opacity:.7;">
        <span class="msg-deleted"><i class="fa fa-ban"></i> Pesan telah dihapus</span>
      </div>
      <div class="msg-meta"><span>${time}</span></div>
    </div></div>`;

  let bc='msg-bubble', content='';
  if(m.media_url){
    bc+=' media-bubble';
    const fname=m.media_name||(m.media_type==='video'?'video.mp4':'foto.jpg');
    if(m.media_type==='video') content=`<video class="msg-media-video" controls preload="none"><source src="${m.media_url}"></video><div class="msg-media-footer"><span class="msg-media-name">🎥 ${esc(fname)}</span><button class="msg-download-btn" onclick="downloadMedia('${m.media_url}','${esc(fname)}',event)"><i class="fa fa-download"></i></button></div>`;
    else content=`<img class="msg-media-img" src="${m.media_url}" loading="lazy" onclick="openLightbox('${m.media_url}','image','${esc(fname)}')"><div class="msg-media-footer"><span class="msg-media-name">🖼️ ${esc(fname)}</span><button class="msg-download-btn" onclick="downloadMedia('${m.media_url}','${esc(fname)}',event)"><i class="fa fa-download"></i></button></div>`;
    if(m.text) content+=`<div style="padding:6px 6px 2px;font-size:14px;">${esc(m.text)}</div>`;
  } else { content=`<span>${esc(m.text||'')}</span>`; }

  return `<div class="msg-row${isMe?' me':' them'}" data-id="${m.id}" oncontextmenu="showGroupCtx(event,'${m.id}')">
    ${!isMe?`<img class="msg-avatar" src="${avatarUrl(sender)}">`:''}
    <div class="msg-bubble-wrap">
      ${!isMe?`<div style="font-size:10px;font-weight:700;color:var(--accent);margin-bottom:2px;padding:0 4px;">@${esc(sender)}</div>`:''}
      <div class="${bc}" onclick="void(0)">${content}</div>
      <div class="msg-meta"><span>${time}</span></div>
    </div>
  </div>`;
}

function subscribeGroupMessages(groupId){
  if(groupMsgCh) sb.removeChannel(groupMsgCh);
  groupMsgCh = sb.channel('grp-'+groupId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'group_messages',filter:`group_id=eq.${groupId}`},
      async payload=>{
        const m=payload.new;
        if(msgs.find(x=>x.id===m.id)) return;
        const {data:sender}=await sb.from('users').select('id,username').eq('id',m.sender_id).single();
        const full={...m,isGroupMsg:true,sender};
        msgs.push(full);
        document.getElementById('msg-area').insertAdjacentHTML('beforeend',buildGroupMsgHTML(full));
        scrollBottom();
        // Notifikasi grup
        if(m.sender_id !== ME.id){
          const grp = allGroups.find(g=>g.id===activeGroupId);
          notifyGroupMessage(
            grp?.name || 'Grup',
            sender?.username || 'Seseorang',
            m.text || (m.media_url?'📎 Media':''),
            m.group_id
          );
        }
      })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'group_messages',filter:`group_id=eq.${groupId}`},
      ()=>loadGroupMessages(groupId))
    .subscribe();
}

// Override sendMsg untuk grup
async function sendMsg(){
  if(activeGroupId && !activeConvoId){
    const input=document.getElementById('msg-input'), text=input.value.trim();
    if(!text) return;
    input.value=''; autoResize(input);
    const {error}=await sb.from('group_messages').insert({group_id:activeGroupId,sender_id:ME.id,text,reactions:{}});
    if(error){showToast('❌ Gagal: '+error.message); input.value=text; autoResize(input);}
    return;
  }
  await _origSendMsg();
}

function showGroupCtx(e,msgId){
  e.preventDefault(); e.stopPropagation();
  const m=msgs.find(x=>x.id===msgId), isMe=m?.sender_id===ME.id;
  document.getElementById('ctx-reactions').innerHTML=REACT_EMOJIS.map(r=>`<div class="ctx-react-btn" onclick="toggleGroupReact('${msgId}','${r}')">${r}</div>`).join('');
  let actions=`<div class="ctx-action" onclick="setGroupReply('${msgId}')"><i class="fa fa-reply" style="color:var(--accent);width:16px;"></i>Balas</div>`;
  if(m?.media_url) actions+=`<div class="ctx-action" onclick="downloadMedia('${m.media_url}','${esc(m.media_name||'media')}')"><i class="fa fa-download" style="color:var(--green);width:16px;"></i>Unduh</div>`;
  if(isMe||myRole==='owner'||myRole==='admin') actions+=`<div class="ctx-action danger" onclick="deleteGroupMsg('${msgId}')"><i class="fa fa-trash" style="width:16px;"></i>Hapus</div>`;
  document.getElementById('ctx-actions').innerHTML=actions;
  const menu=document.getElementById('ctx-menu');
  menu.style.left=Math.min(e.clientX,window.innerWidth-230)+'px';
  menu.style.top=Math.min(e.clientY,window.innerHeight-200)+'px';
  menu.style.display='block';
}

async function deleteGroupMsg(msgId){
  await deleteMsgForAll(msgId); // reuse — sudah handle grup
}

async function toggleGroupReact(msgId,emoji){
  const m=msgs.find(x=>x.id===msgId); if(!m) return;
  const reactions={...(m.reactions||{})};
  const arr=[...(reactions[emoji]||[])];
  const idx=arr.indexOf(ME.id);
  if(idx===-1) arr.push(ME.id); else arr.splice(idx,1);
  if(arr.length) reactions[emoji]=arr; else delete reactions[emoji];
  await sb.from('group_messages').update({reactions}).eq('id',msgId);
  hideCtxMenu();
}

function setGroupReply(msgId){
  const m=msgs.find(x=>x.id===msgId); if(!m) return;
  replyTo=m;
  document.getElementById('reply-bar').style.display='block';
  document.getElementById('reply-text').innerText=truncate(m.text||'Media',60);
  document.getElementById('msg-input').focus();
  hideCtxMenu();
}

// Create group
let _grpSearchTimer=null;

function openCreateGroup(){
  selectedMembers={};
  ['grp-name','grp-desc','grp-member-search'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const cb=document.getElementById('grp-public'); if(cb) cb.checked=false;
  const track=document.getElementById('grp-pub-track'); if(track) track.style.background='var(--border2)';
  const thumb=document.getElementById('grp-pub-thumb'); if(thumb) thumb.style.left='2px';
  document.getElementById('grp-member-results').innerHTML='';
  document.getElementById('grp-selected-members').innerHTML='';
  const btn=document.getElementById('btn-create-group');
  if(btn){ btn.innerHTML='<i class="fa fa-plus"></i> Buat Grup'; btn.onclick=()=>createGroup(); }
  document.getElementById('modal-create-group').classList.add('open');
}

function closeCreateGroup(){ document.getElementById('modal-create-group').classList.remove('open'); }

// Toggle public switch
document.addEventListener('DOMContentLoaded',()=>{
  const cb=document.getElementById('grp-public');
  if(cb) cb.addEventListener('change',function(){
    document.getElementById('grp-pub-track').style.background=this.checked?'var(--accent)':'var(--border2)';
    document.getElementById('grp-pub-thumb').style.left=this.checked?'22px':'2px';
  });
});

function searchGroupMembers(v){
  clearTimeout(_grpSearchTimer);
  const el=document.getElementById('grp-member-results');
  if(!v||v.length<2){ el.innerHTML=''; return; }
  _grpSearchTimer=setTimeout(async()=>{
    const {data}=await sb.from('users').select('id,username,email').ilike('username','%'+v+'%').neq('id',ME.id).limit(8);
    if(!data?.length){ el.innerHTML=`<div style="font-size:11px;color:var(--text3);padding:8px;">Tidak ditemukan</div>`; return; }
    el.innerHTML=data.map(u=>`
      <div class="user-result" onclick="addGroupMember('${u.id}','${esc(u.username)}','${esc(u.email)}')"
        style="padding:8px;${selectedMembers[u.id]?'opacity:.4;pointer-events:none;':''}">
        <img src="${avatarUrl(u.username)}" style="width:32px;height:32px;border-radius:50%;">
        <div><div style="font-size:13px;font-weight:700;">@${esc(u.username)}</div><div style="font-size:10px;color:var(--text3);">${esc(u.email)}</div></div>
        ${selectedMembers[u.id]?`<span style="margin-left:auto;color:var(--green);font-size:11px;">✓</span>`:''}
      </div>`).join('');
  },300);
}

function addGroupMember(uid,username,email){
  if(selectedMembers[uid]) return;
  selectedMembers[uid]={username,email};
  renderSelectedMembers();
  document.getElementById('grp-member-results').innerHTML='';
  document.getElementById('grp-member-search').value='';
}

function removeGroupMember(uid){ delete selectedMembers[uid]; renderSelectedMembers(); }

function renderSelectedMembers(){
  document.getElementById('grp-selected-members').innerHTML=Object.entries(selectedMembers).map(([id,{username}])=>`
    <div class="member-chip"><img src="${avatarUrl(username)}">@${esc(username)}<span class="member-chip-rm" onclick="removeGroupMember('${id}')">✕</span></div>`).join('');
}

async function createGroup(){
  const name=document.getElementById('grp-name').value.trim();
  if(!name){ showToast('Nama grup wajib diisi.'); return; }
  const btn=document.getElementById('btn-create-group');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const {data:grp,error}=await sb.from('groups').insert({
    name, description:document.getElementById('grp-desc').value.trim(),
    is_public:document.getElementById('grp-public').checked, created_by:ME.id
  }).select().single();
  if(error||!grp){ btn.disabled=false; btn.innerHTML='<i class="fa fa-plus"></i> Buat Grup'; showToast('❌ Gagal: '+(error?.message||'unknown')); return; }
  await sb.from('group_members').insert({group_id:grp.id,user_id:ME.id,role:'owner'});
  const memberInserts=Object.keys(selectedMembers).map(uid=>({group_id:grp.id,user_id:uid,role:'member'}));
  if(memberInserts.length) await sb.from('group_members').insert(memberInserts);
  btn.disabled=false; btn.innerHTML='<i class="fa fa-plus"></i> Buat Grup';
  closeCreateGroup();
  showToast(`✅ Grup "${name}" berhasil dibuat!`);
  await loadGroups();
  openGroupChat(grp.id,grp.name);
}

async function joinGroup(groupId,groupName){
  const {error}=await sb.from('group_members').insert({group_id:groupId,user_id:ME.id,role:'member'});
  if(error){ showToast('❌ Gagal gabung: '+error.message); return; }
  showToast(`✅ Berhasil gabung "${groupName}"!`);
  await loadGroups(); openGroupChat(groupId,groupName);
}

async function leaveGroup(groupId){
  if(!confirm('Keluar dari grup ini?')) return;
  await sb.from('group_members').delete().eq('group_id',groupId).eq('user_id',ME.id);
  showToast('Kamu keluar dari grup.');
  activeGroupId=null; backToList(); await loadGroups();
}

async function openGroupInfo(groupId){
  document.getElementById('modal-group-info').classList.add('open');
  document.getElementById('grp-info-body').innerHTML=`<div style="text-align:center;padding:30px;"><span class="spinner"></span></div>`;
  const [{data:grp},{data:members}]=await Promise.all([
    sb.from('groups').select('*').eq('id',groupId).single(),
    sb.from('group_members').select('*,user:user_id(id,username,email)').eq('group_id',groupId)
  ]);
  if(!grp) return;
  document.getElementById('grp-info-title').innerText=grp.name;
  const myMship=members?.find(m=>m.user_id===ME.id);
  const isAdmin=myMship?.role==='owner'||myMship?.role==='admin';
  document.getElementById('grp-info-body').innerHTML=`
    <div style="text-align:center;margin-bottom:20px;">
      <div style="width:72px;height:72px;border-radius:18px;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:30px;margin:0 auto 10px;">👥</div>
      <div style="font-size:18px;font-weight:900;">${esc(grp.name)}</div>
      ${grp.description?`<div style="font-size:12px;color:var(--text2);margin-top:4px;">${esc(grp.description)}</div>`:''}
      <div style="margin-top:8px;">${grp.is_public?`<span class="badge-public">🌐 Publik</span>`:`<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:2px 8px;border-radius:99px;">🔒 Private</span>`}</div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">${members?.length||0} Member</div>
    ${(members||[]).map(m=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;margin-bottom:4px;background:var(--surface);">
        <img src="${avatarUrl(m.user?.username||'?')}" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">@${esc(m.user?.username||'?')}</div>
          <div style="font-size:10px;color:var(--text3);">${m.role}</div>
        </div>
        ${isAdmin&&m.user_id!==ME.id?`<button onclick="kickMember('${groupId}','${m.user_id}','${esc(m.user?.username||'?')}')" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:var(--red);border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:inherit;">Keluarkan</button>`:''}
      </div>`).join('')}
    <div style="padding-top:16px;margin-top:8px;border-top:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;">
      ${isAdmin?`<button onclick="addMembersToGroup('${groupId}')" style="flex:1;padding:11px;border-radius:12px;background:rgba(59,130,246,.12);color:var(--accent);border:1px solid rgba(59,130,246,.2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;"><i class="fa fa-user-plus"></i> Tambah Member</button>`:''}
      <button onclick="leaveGroup('${groupId}')" style="flex:1;padding:11px;border-radius:12px;background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;"><i class="fa fa-right-from-bracket"></i> Keluar Grup</button>
    </div>`;
}

function closeGroupInfo(){ document.getElementById('modal-group-info').classList.remove('open'); }

async function kickMember(groupId,userId,username){
  if(!confirm(`Keluarkan @${username}?`)) return;
  await sb.from('group_members').delete().eq('group_id',groupId).eq('user_id',userId);
  showToast(`@${username} dikeluarkan.`); openGroupInfo(groupId);
}

async function addMembersToGroup(groupId){
  closeGroupInfo(); openCreateGroup();
  document.getElementById('grp-name').value='_add_members_';
  document.getElementById('btn-create-group').innerHTML='<i class="fa fa-user-plus"></i> Tambah Member';
  document.getElementById('btn-create-group').onclick=async()=>{
    if(!Object.keys(selectedMembers).length){ showToast('Pilih member dulu.'); return; }
    const inserts=Object.keys(selectedMembers).map(uid=>({group_id:groupId,user_id:uid,role:'member'}));
    await sb.from('group_members').upsert(inserts,{onConflict:'group_id,user_id',ignoreDuplicates:true});
    closeCreateGroup(); showToast('✅ Member ditambahkan!');
    document.getElementById('btn-create-group').onclick=()=>createGroup();
    openGroupInfo(groupId);
  };
}

// Override switchSidebarTab untuk handle grup
function switchSidebarTab(tab){
  ['messages','people','groups'].forEach(t=>{
    document.getElementById('tab-'+t)?.classList.toggle('active',t===tab);
    document.getElementById('panel-'+t)?.classList.toggle('active',t===tab);
  });
  document.getElementById('search-wrap-msgs').style.display=tab==='messages'?'':'none';
  if(tab==='people'){ const isEmpty=!allUsers.length||document.querySelector('#people-list .convo-empty'); if(isEmpty) loadPeopleList(); }
  if(tab==='groups') loadGroups();
}
