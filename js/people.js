// XREZZKY Chat — people.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

// ════════════════════════════════
//  CONVERSATIONS
// ════════════════════════════════
async function loadConvos(){
  // Single query — ambil semua conversation dimana ME terlibat
  // Dengan model shared (owner_id < partner_id), kita bisa jadi owner atau partner
  const {data:ownerConvos} = await sb.from('conversations')
    .select('*, partner:partner_id(id,username,email,bio,role,is_stealth)')
    .eq('owner_id', ME.id)
    .order('updated_at',{ascending:false});

  const {data:partnerConvos} = await sb.from('conversations')
    .select('*, owner:owner_id(id,username,email,bio,role,is_stealth)')
    .eq('partner_id', ME.id)
    .order('updated_at',{ascending:false});

  // Normalisasi: semua punya field `partnerUser` yang konsisten
  const normalized = [
    ...(ownerConvos||[]).map(c => ({...c, partnerUser: c.partner})),
    ...(partnerConvos||[]).map(c => ({...c, partnerUser: c.owner})),
  ];

  // Deduplicate by id + sort
  const seen = new Set();
  convos = normalized.filter(c => {
    if(seen.has(c.id)) return false;
    seen.add(c.id); return true;
  }).sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));

  await renderConvoList(convos);
}

async function renderConvoList(list){
  const el=document.getElementById('convo-list');
  if(!list.length){ el.innerHTML=`<div class="convo-empty"><i class="fa fa-comments"></i><p>Belum ada percakapan</p><small>Follow seseorang di 🌐 Temukan</small></div>`; return; }

  const convoIds = list.map(c=>c.id);

  // Batch: last message per convo
  const {data:recentMsgs} = await sb.from('messages')
    .select('conversation_id,text,sender_id,created_at,is_read,media_url,media_type')
    .in('conversation_id', convoIds)
    .order('created_at', {ascending:false});
  const lastMsgMap = {};
  if(recentMsgs) for(const m of recentMsgs){
    if(!lastMsgMap[m.conversation_id]) lastMsgMap[m.conversation_id]=m;
  }

  // Batch: unread
  const {data:unreadMsgs} = await sb.from('messages')
    .select('conversation_id')
    .in('conversation_id', convoIds)
    .eq('is_read', false)
    .neq('sender_id', ME.id);
  const unreadMap = {};
  if(unreadMsgs) for(const m of unreadMsgs){
    unreadMap[m.conversation_id] = (unreadMap[m.conversation_id]||0)+1;
  }

  // Batch: presence — kumpulkan semua partner IDs
  const partnerIds = list.map(c => c.owner_id === ME.id ? c.partner_id : c.owner_id).filter(Boolean);
  const {data:presList} = partnerIds.length
    ? await sb.from('user_presence').select('user_id,is_online').in('user_id', partnerIds)
    : {data:[]};
  const presMap = {};
  if(presList) presList.forEach(p=>{ presMap[p.user_id]=p.is_online; });

  let html = '';
  for(const c of list){
    const partner = c.partnerUser; // sudah dinormalisasi di loadConvos
    if(!partner) continue;

    const partnerId = partner.id;
    const last = lastMsgMap[c.id];
    const u = unreadMap[c.id]||0;
    const isOnline = presMap[partnerId]||false;

    let lastText = last
      ? (last.media_url
          ? (last.sender_id===ME.id?'✓ ':'')+(last.media_type==='video'?'🎥 Video':'🖼️ Foto')
          : (last.sender_id===ME.id?'✓ ':'')+truncate(last.text||'',34))
      : 'Mulai percakapan...';

    html += `<div class="convo-item${activeConvoId===c.id?' active':''}"
      onclick="openConvo('${c.id}','${partnerId}','${esc(partner.username)}','${esc(partner.email)}')"
      data-name="${(partner.username||'').toLowerCase()}">
      <div class="convo-avatar">
        <img src="${avatarUrl(partner.username)}">
        ${isOnline?`<div class="online-ring"></div>`:''}
      </div>
      <div class="convo-info">
        <div class="convo-top">
          <span class="convo-name">${esc(partner.username)}</span>
          <span class="convo-time">${last?fmtTime(last.created_at):''}</span>
        </div>
        <div class="convo-bot">
          <span class="convo-last">${esc(lastText)}</span>
          ${u>0?`<span class="unread-pill">${u>99?'99+':u}</span>`:''}
        </div>
      </div>
    </div>`;
  }
  el.innerHTML = html;
}

function subscribeConvos(){
  if(convoCh) sb.removeChannel(convoCh);
  convoCh = sb.channel('my-convos-'+ME.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'conversations'},
      (payload) => {
        const c = payload.new || payload.old;
        if(c?.owner_id===ME.id || c?.partner_id===ME.id) loadConvos();
      }
    ).subscribe();
}
function filterConvos(v){ document.querySelectorAll('.convo-item').forEach(el=>{ el.style.display=el.dataset.name?.includes(v.toLowerCase())?'':'none'; }); }