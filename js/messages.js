// XREZZKY Chat — messages.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

// ════════════════════════════════
//  DELETE & PIN
// ════════════════════════════════

// Hapus untuk saya saja — soft delete, set deleted_at
async function deleteMsgForMe(msgId){
  if(!confirm('Hapus pesan ini untuk kamu saja?')) return;
  // Simpan di localStorage — pesan masih ada di DB tapi ga ditampilkan
  const key = 'xrezzky_deleted_me_' + ME.id;
  const list = JSON.parse(localStorage.getItem(key)||'[]');
  if(!list.includes(msgId)) list.push(msgId);
  localStorage.setItem(key, JSON.stringify(list));
  // Hapus dari array lokal + re-render
  msgs = msgs.filter(m => m.id !== msgId);
  renderMessages();
  hideCtxMenu();
  showToast('Pesan dihapus untuk kamu.');
}

// Hapus untuk semua — soft delete di DB
async function deleteMsgForAll(msgId){
  const m = msgs.find(x => x.id === msgId);
  if(!m) return;
  if(!confirm('Hapus pesan ini untuk semua orang?')) return;

  // Cek apakah ini pesan grup atau private
  const isGroup = m.isGroupMsg || (activeGroupId && !activeConvoId);
  const table   = isGroup ? 'group_messages' : 'messages';

  // Cek izin: hanya sender atau admin/owner
  const canDelete = m.sender_id === ME.id || myRole === 'owner' || myRole === 'admin';
  if(!canDelete){ showToast('❌ Kamu tidak bisa menghapus pesan ini.'); return; }

  const {error} = await sb.from(table)
    .update({
      deleted_at:      new Date().toISOString(),
      text:            null,
      media_url:       null,
      media_public_id: null
    })
    .eq('id', msgId);

  if(error){ showToast('❌ Gagal hapus: ' + error.message); return; }

  hideCtxMenu();
  showToast('✅ Pesan dihapus untuk semua.');

  // Update lokal langsung — ga perlu tunggu realtime
  const idx = msgs.findIndex(x=>x.id===msgId);
  if(idx !== -1){
    msgs[idx] = {...msgs[idx], deleted_at: new Date().toISOString(), text:null, media_url:null};
    if(isGroup) renderGroupMessages();
    else renderMessages();
  }
}

// Pin pesan — 1 pin per conversation
async function pinMsg(msgId){
  const m = msgs.find(x => x.id === msgId);
  if(!m) return;

  // Cek apakah sudah ada pin di conversation ini
  const {data:existing} = await sb.from('pinned_messages')
    .select('id').eq('conversation_id', activeConvoId).single();

  if(existing){
    // Ganti pin yang lama
    await sb.from('pinned_messages')
      .update({ message_id: msgId, pinned_by: ME.id, pinned_at: new Date().toISOString() })
      .eq('conversation_id', activeConvoId);
  } else {
    await sb.from('pinned_messages').insert({
      conversation_id: activeConvoId,
      message_id: msgId,
      pinned_by: ME.id
    });
  }

  hideCtxMenu();
  showToast('📌 Pesan di-pin!');
  loadPinnedMessage();
}

async function unpinMsg(){
  await sb.from('pinned_messages').delete().eq('conversation_id', activeConvoId);
  document.getElementById('pin-bar').style.display = 'none';
  showToast('Pin dilepas.');
}

async function loadPinnedMessage(){
  if(!activeConvoId) return;
  const {data} = await sb.from('pinned_messages')
    .select('*, message:message_id(id,text,sender_id,media_type,media_url,media_name)')
    .eq('conversation_id', activeConvoId)
    .single();

  const bar = document.getElementById('pin-bar');
  if(!data?.message){ bar.style.display='none'; return; }

  const m = data.message;
  const preview = m.media_url
    ? (m.media_type==='video'?'🎥 Video':'🖼️ Foto')
    : truncate(m.text||'',50);

  bar.style.display = 'flex';
  document.getElementById('pin-bar-text').innerText = preview;
  document.getElementById('pin-bar-btn').onclick = () => {
    // Scroll ke pesan yang di-pin
    const el = document.querySelector(`.msg-row[data-id="${m.id}"]`);
    if(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); el.style.background='rgba(59,130,246,0.15)'; setTimeout(()=>el.style.background='',1500); }
    else showToast('Pesan tidak ditemukan di layar ini.');
  };
}
async function toggleReact(msgId,emoji){ const m=msgs.find(x=>x.id===msgId); if(!m) return; const reactions={...(m.reactions||{})}; const arr=[...(reactions[emoji]||[])]; const idx=arr.indexOf(ME.id); if(idx===-1) arr.push(ME.id); else arr.splice(idx,1); if(arr.length) reactions[emoji]=arr; else delete reactions[emoji]; await sb.from('messages').update({reactions}).eq('id',msgId); hideCtxMenu(); }

// ════════════════════════════════
//  CTX MENU
// ════════════════════════════════
function showCtx(e, msgId){
  e.preventDefault(); e.stopPropagation();
  const m = msgs.find(x=>x.id===msgId);
  const isMe = m?.sender_id===ME.id;
  const isPrivileged = myRole==='owner'||myRole==='admin';

  document.getElementById('ctx-reactions').innerHTML = REACT_EMOJIS.map(r=>
    `<div class="ctx-react-btn" onclick="toggleReact('${msgId}','${r}')">${r}</div>`
  ).join('');

  let actions = `<div class="ctx-action" onclick="setReply('${msgId}')">
    <i class="fa fa-reply" style="color:var(--accent);width:16px;"></i>Balas
  </div>`;

  if(m?.media_url) actions += `<div class="ctx-action" onclick="downloadMedia('${m.media_url}','${esc(m.media_name||'media')}')">
    <i class="fa fa-download" style="color:var(--green);width:16px;"></i>Unduh
  </div>`;

  // Pin — bisa dilakukan oleh siapapun di conversation
  actions += `<div class="ctx-action" onclick="pinMsg('${msgId}')">
    <i class="fa fa-thumbtack" style="color:var(--yellow);width:16px;"></i>Pin Pesan
  </div>`;

  // Laporan — hanya untuk pesan orang lain
  if(!isMe) actions += `<div class="ctx-action" onclick="openReport('${m.sender_id}','${esc(activePartner?.username||'')}','${msgId}')">
    <i class="fa fa-flag" style="color:var(--red);width:16px;"></i>Laporkan
  </div>`;

  // Hapus untuk saya — semua orang bisa hapus pesan apapun dari tampilan mereka
  actions += `<div class="ctx-action" onclick="deleteMsgForMe('${msgId}')">
    <i class="fa fa-eye-slash" style="color:var(--text3);width:16px;"></i>Hapus untuk Saya
  </div>`;

  // Hapus untuk semua — hanya sender atau admin/owner
  if(isMe || isPrivileged) actions += `<div class="ctx-action danger" onclick="deleteMsgForAll('${msgId}')">
    <i class="fa fa-trash" style="width:16px;"></i>Hapus untuk Semua
  </div>`;

  document.getElementById('ctx-actions').innerHTML = actions;
  const x = Math.min(e.clientX, window.innerWidth-230);
  const y = Math.min(e.clientY, window.innerHeight-220);
  const menu = document.getElementById('ctx-menu');
  menu.style.left = x+'px'; menu.style.top = y+'px'; menu.style.display = 'block';
}
function hideCtxMenu(){ document.getElementById('ctx-menu').style.display='none'; }
function handleBubbleClick(e,msgId){}

// ════════════════════════════════