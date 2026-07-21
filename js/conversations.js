// XREZZKY Chat — conversations.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure


// ════════════════════════════════
//  OPEN CONVO
// ════════════════════════════════
async function openConvo(convoId, partnerId, partnerName, partnerEmail){
  activeConvoId = convoId;
  activePartner = {id:partnerId, username:partnerName, email:partnerEmail};

  document.getElementById('ch-avatar').src = avatarUrl(partnerName);
  document.getElementById('ch-name').innerText = partnerName;
  document.getElementById('ch-status').innerText = '...';
  document.getElementById('ch-status').className = 'chat-partner-status';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-ui').style.display = 'flex';
  document.getElementById('sidebar').classList.add('hidden-mobile');
  document.getElementById('chatroom').classList.add('show-mobile');

  document.querySelectorAll('.convo-item').forEach(el => {
    el.classList.toggle('active', el.onclick?.toString().includes(convoId));
  });

  await refreshPartnerPresence();
  await loadMessages();
  await markRead();
  await updateChatInputState();
  await loadPinnedMessage();
  // Tampilkan tombol call untuk chat private
  const callBtn = document.getElementById('btn-voice-call');
  if(callBtn) callBtn.style.display = '';
  subscribeMessages(convoId);
  subscribePartnerPresence(partnerId);
  subscribeTyping(convoId);
  loadConvos();
  document.getElementById('msg-input').focus();
}

async function refreshPartnerPresence(){
  if(!activePartner) return;
  const {data}=await sb.from('user_presence').select('is_online,last_seen').eq('user_id',activePartner.id).single();
  const el=document.getElementById('ch-status');
  if(data?.is_online){ el.innerText='Online'; el.className='chat-partner-status online'; }
  else if(data?.last_seen){ el.innerText='Terakhir dilihat '+fmtTime(data.last_seen); el.className='chat-partner-status'; }
  else { el.innerText=activePartner.email; el.className='chat-partner-status'; }
}

// ════════════════════════════════
//  MESSAGES
// ════════════════════════════════
async function loadMessages(){
  const {data}=await sb.from('messages')
    .select('id,conversation_id,sender_id,text,is_read,is_request,reply_to_id,reactions,media_url,media_type,media_name,media_public_id,media_expires_at,deleted_at,created_at')
    .eq('conversation_id',activeConvoId)
    .is('deleted_at',null)
    .order('created_at',{ascending:true});
  msgs=data||[]; renderMessages(); scrollBottom();
}

function renderMessages(){
  const el=document.getElementById('msg-area'); let html='',lastDate='';
  msgs.forEach(m=>{
    const d=new Date(m.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    if(d!==lastDate){ html+=`<div class="date-sep"><div class="date-sep-line"></div><div class="date-sep-label">${d}</div><div class="date-sep-line"></div></div>`; lastDate=d; }
    html+=buildMsgHTML(m);
  });
  el.innerHTML=html;
}

function buildMsgHTML(m){
  const isMe = m.sender_id===ME.id;

  // Cek hapus untuk saya (localStorage)
  const deletedForMe = JSON.parse(localStorage.getItem('xrezzky_deleted_me_'+ME.id)||'[]');
  if(deletedForMe.includes(m.id)) return '';

  // Definisi time SEKALI di sini — dipakai di seluruh fungsi
  const time = new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});

  // Pesan dihapus untuk semua
  if(m.deleted_at){
    return `<div class="msg-row${isMe?' me':' them'}" data-id="${m.id}">
      ${!isMe?`<img class="msg-avatar" src="${avatarUrl(activePartner?.username||'?')}">`:''}
      <div class="msg-bubble-wrap">
        <div class="msg-bubble" style="background:var(--surface);border:1px solid var(--border);opacity:.7;">
          <span class="msg-deleted"><i class="fa fa-ban"></i> Pesan telah dihapus</span>
        </div>
        <div class="msg-meta"><span>${time}</span></div>
      </div>
    </div>`;
  }

  // Sisanya normal — TIDAK ada const time lagi di bawah
  let replyHTML='';
  if(m.reply_to_id){ const orig=msgs.find(x=>x.id===m.reply_to_id); if(orig){ const prev=orig.media_url?(orig.media_type==='video'?'🎥 Video':'🖼️ Foto'):truncate(orig.text||'',60); replyHTML=`<div class="msg-reply-quote"><strong>${orig.sender_id===ME.id?'Kamu':esc(activePartner.username)}</strong>${esc(prev)}</div>`; } }
  const reactions=m.reactions||{};
  const reactHTML=Object.keys(reactions).length?`<div class="reactions-wrap">${Object.entries(reactions).map(([em,arr])=>`<div class="reaction-chip" onclick="toggleReact('${m.id}','${em}')">${em}<span class="reaction-count">${arr.length}</span></div>`).join('')}</div>`:'';
  const tick=isMe?`<span class="tick${m.is_read?' read':''}"><i class="fa fa-check${m.is_read?'-double':''}"></i></span>`:'';
  let bubbleContent='', bubbleClass='msg-bubble';
  if(m.media_url){
    bubbleClass+=' media-bubble';
    const fname = m.media_name||(m.media_type==='video'?'video.mp4':'foto.jpg');

    // Hitung sisa waktu kalau ada expiry
    let expiryBadge = '';
    if(m.media_expires_at){
      const remaining = new Date(m.media_expires_at) - new Date();
      if(remaining > 0){
        const hrs = Math.floor(remaining / 3600000);
        const min = Math.floor((remaining % 3600000) / 60000);
        const label = hrs > 0 ? `⏳ ${hrs}j ${min}m lagi` : `⏳ ${min}m lagi`;
        expiryBadge = `<div style="font-size:9px;color:#f59e0b;font-weight:700;padding:2px 6px 4px;text-align:center;">${label} — media hilang otomatis</div>`;
      } else {
        expiryBadge = `<div style="font-size:9px;color:#94a3b8;padding:2px 6px 4px;text-align:center;">Media sudah dihapus</div>`;
      }
    }

    if(m.media_type==='video'){
      bubbleContent=`<video class="msg-media-video" controls preload="none"><source src="${m.media_url}" type="video/mp4"></video>
        <div class="msg-media-footer">
          <span class="msg-media-name">🎥 ${esc(fname)}</span>
          <button class="msg-download-btn" onclick="downloadMedia('${m.media_url}','${esc(fname)}',event)"><i class="fa fa-download"></i> Unduh</button>
        </div>${expiryBadge}`;
    } else {
      bubbleContent=`<img class="msg-media-img" src="${m.media_url}" alt="foto" loading="lazy" onclick="openLightbox('${m.media_url}','image','${esc(fname)}')">
        <div class="msg-media-footer">
          <span class="msg-media-name">🖼️ ${esc(fname)}</span>
          <button class="msg-download-btn" onclick="downloadMedia('${m.media_url}','${esc(fname)}',event)"><i class="fa fa-download"></i> Unduh</button>
        </div>${expiryBadge}`;
    }
    if(m.text) bubbleContent+=`<div style="padding:6px 6px 2px;font-size:14px;">${esc(m.text)}</div>`;

  } else if(m.media_type && !m.media_url){
    // Media sudah expired / dihapus
    bubbleClass+=' media-bubble';
    const icon = m.media_type==='video' ? '🎥' : '🖼️';
    bubbleContent=`<div style="padding:16px;text-align:center;color:var(--text3);">
      <div style="font-size:28px;margin-bottom:6px;opacity:.4;">${icon}</div>
      <div style="font-size:11px;font-weight:600;">Media sudah dihapus</div>
      <div style="font-size:10px;margin-top:2px;opacity:.6;">Berlaku 24 jam setelah dikirim</div>
    </div>`;
  } else {
    bubbleContent=`<span>${esc(m.text||'')}</span>`;
  }
  return `<div class="msg-row${isMe?' me':' them'}" data-id="${m.id}" oncontextmenu="showCtx(event,'${m.id}')">
    ${!isMe?`<img class="msg-avatar" src="${avatarUrl(activePartner?.username||'?')}">`:''}
    <div class="msg-bubble-wrap"><div class="${bubbleClass}" onclick="handleBubbleClick(event,'${m.id}')">${replyHTML}${bubbleContent}</div><div class="msg-meta"><span>${time}</span>${tick}</div>${reactHTML}</div>
  </div>`;
}

function subscribeMessages(convoId){
  if(msgCh) sb.removeChannel(msgCh);
  msgCh=sb.channel('msgs-'+convoId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${convoId}`},async payload=>{
      const m=payload.new; if(msgs.find(x=>x.id===m.id)) return;
      msgs.push(m); appendMessage(m);
      if(m.sender_id!==ME.id){
        await markRead(); loadConvos();
        // Trigger notifikasi
        notifyNewMessage(
          activePartner?.username || 'Pesan baru',
          m.text || (m.media_url ? '📎 Media' : ''),
          convoId,
          m.sender_id
        );
      }
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:`conversation_id=eq.${convoId}`},async payload=>{
      const idx=msgs.findIndex(x=>x.id===payload.new.id); if(idx!==-1) msgs[idx]=payload.new;
      renderMessages(); scrollBottom(false);
    })
    .on('postgres_changes',{event:'DELETE',schema:'public',table:'messages',filter:`conversation_id=eq.${convoId}`},async payload=>{ msgs=msgs.filter(x=>x.id!==payload.old.id); renderMessages(); })
    .subscribe();
}

function appendMessage(m){
  const el=document.getElementById('msg-area');
  const lastSep=el.querySelector('.date-sep:last-of-type .date-sep-label');
  const d=new Date(m.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
  if(!lastSep||lastSep.innerText!==d) el.insertAdjacentHTML('beforeend',`<div class="date-sep"><div class="date-sep-line"></div><div class="date-sep-label">${d}</div><div class="date-sep-line"></div></div>`);
  el.insertAdjacentHTML('beforeend',buildMsgHTML(m)); scrollBottom();
}

async function _origSendMsg(){
  if(!activeConvoId) return;
  if(pendingFiles.length){ await sendMediaFiles(); return; }
  const input=document.getElementById('msg-input'), text=input.value.trim();
  if(!text) return;

  const {data:{session}} = await sb.auth.getSession();
  if(!session){ showToast('Sesi habis, silakan login ulang.'); showScreen('screen-auth'); return; }

  // Cek apakah ini pesan pertama / request mode
  const {data:convo} = await sb.from('conversations').select('chat_status').eq('id',activeConvoId).single();
  const isMutual = followMap[activePartner?.id]==='accepted';
  const isRequest = convo?.chat_status==='pending' && !isMutual;

  input.value=''; autoResize(input); hideTypingIndicator();
  const replyId = replyTo?.id || null;
  cancelReply();

  const {error} = await sb.from('messages').insert({
    conversation_id: activeConvoId,
    sender_id: ME.id,
    text,
    is_read: false,
    is_request: isRequest,
    reply_to_id: replyId,
    reactions: {}
  });

  if(error){
    console.error('sendMsg error:', error);
    if(error.code==='42501'||error.message?.includes('policy'))
      showToast('❌ Tidak bisa kirim pesan. Follow user ini dulu.');
    else
      showToast('❌ Gagal kirim: '+error.message);
    input.value=text; autoResize(input);
    return;
  }
  await sb.from('conversations').update({updated_at:new Date().toISOString()}).eq('id',activeConvoId);
  if(isRequest) await updateChatInputState();
}

async function downloadMedia(url,filename,e){
  if(e){e.preventDefault();e.stopPropagation();}
  try { const res=await fetch(url); const blob=await res.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }
  catch { window.open(url,'_blank'); }
}
function openLightbox(url,type,name){
  lightboxMedia={url,type,name};
  document.getElementById('lightbox-content').innerHTML=type==='video'
    ?`<video src="${url}" controls preload="none" style="max-width:95vw;max-height:82dvh;border-radius:12px;"></video>`
    :`<img src="${url}" alt="${esc(name)}" style="max-width:95vw;max-height:82dvh;border-radius:12px;object-fit:contain;">`;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox(){ document.getElementById('lightbox').classList.remove('open'); document.getElementById('lightbox-content').innerHTML=''; lightboxMedia=null; }
function downloadLightboxMedia(){ if(!lightboxMedia) return; downloadMedia(lightboxMedia.url,lightboxMedia.name||'media'); }

// ════════════════════════════════
//  READ / SCROLL / REPLY / DELETE / REACT
// ════════════════════════════════
async function markRead(){ if(!activeConvoId) return; await sb.from('messages').update({is_read:true}).eq('conversation_id',activeConvoId).neq('sender_id',ME.id).eq('is_read',false); }
function scrollBottom(smooth=true){ const el=document.getElementById('msg-area'); if(smooth) el.style.scrollBehavior='smooth'; setTimeout(()=>{ el.scrollTop=el.scrollHeight; el.style.scrollBehavior=''; },60); }
function setReply(msgId){ const m=msgs.find(x=>x.id===msgId); if(!m) return; replyTo=m; document.getElementById('reply-bar').style.display='block'; document.getElementById('reply-text').innerText=m.media_url?(m.media_type==='video'?'🎥 Video':'🖼️ Foto'):truncate(m.text||'',70); document.getElementById('msg-input').focus(); hideCtxMenu(); }
function cancelReply(){ replyTo=null; document.getElementById('reply-bar').style.display='none'; }