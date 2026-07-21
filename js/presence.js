// XREZZKY Chat — presence.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

//  TYPING
// ════════════════════════════════
async function broadcastTyping(){ if(!typingCh||!activeConvoId) return; typingCh.send({type:'broadcast',event:'typing',payload:{user_id:ME.id}}); }
function subscribeTyping(convoId){ if(typingCh) sb.removeChannel(typingCh); typingCh=sb.channel('typing-'+convoId).on('broadcast',{event:'typing'},payload=>{ if(payload.payload?.user_id!==ME.id) showTypingIndicator(); }).subscribe(); }
function showTypingIndicator(){ const row=document.getElementById('typing-row'); if(activePartner) document.getElementById('typing-avatar').src=avatarUrl(activePartner.username); row.style.display='block'; clearTimeout(typingShowTimer); typingShowTimer=setTimeout(hideTypingIndicator,2500); scrollBottom(false); }
function hideTypingIndicator(){ document.getElementById('typing-row').style.display='none'; }

// ════════════════════════════════
//  PRESENCE
// ════════════════════════════════
// upsertPresence defined in initPresenceTracking section
function subscribePartnerPresence(partnerId){ if(presCh) sb.removeChannel(presCh); presCh=sb.channel('pres-'+partnerId).on('postgres_changes',{event:'*',schema:'public',table:'user_presence',filter:`user_id=eq.${partnerId}`},()=>refreshPartnerPresence()).subscribe(); }

// ════════════════════════════════
//  EMOJI
// ════════════════════════════════
function initEmojiGrid(){ const g=document.getElementById('emoji-grid'); if(g.children.length>0) return; g.innerHTML=EMOJIS.map(e=>`<div class="emoji-cell" onclick="insertEmoji('${e}')">${e}</div>`).join(''); }
function toggleEmoji(){ const ep=document.getElementById('emoji-picker'); ep.style.display=ep.style.display==='block'?'none':'block'; }
function insertEmoji(e){ const input=document.getElementById('msg-input'); input.value+=e; input.focus(); autoResize(input); }

// ════════════════════════════════
//  NEW CHAT MODAL (email search)
// ════════════════════════════════
function openNewChat(){ document.getElementById('modal-new-chat').classList.add('open'); document.getElementById('search-email').value=''; resetSearchResults(); setTimeout(()=>document.getElementById('search-email').focus(),300); }
function closeNewChat(){ document.getElementById('modal-new-chat').classList.remove('open'); }
function resetSearchResults(){ document.getElementById('search-results').innerHTML=`<div style="text-align:center;padding:32px 0;color:var(--text3);"><i class="fa fa-envelope" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px;"></i><p style="font-size:13px;">Ketik email untuk mencari</p></div>`; }
function debounceSearch(v){ clearTimeout(searchTimer); if(!v||v.length<3){ resetSearchResults(); return; } searchTimer=setTimeout(()=>searchUser(v),400); }
async function searchUser(q){
  const el=document.getElementById('search-results');
  el.innerHTML=`<div style="text-align:center;padding:20px;"><span class="spinner"></span></div>`;
  const {data:users}=await sb.from('users').select('id,username,email').ilike('email','%'+q+'%').neq('id',ME.id).limit(10);
  if(!users||!users.length){ el.innerHTML=`<div style="text-align:center;padding:32px 0;color:var(--text3);"><i class="fa fa-user-slash" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px;"></i><p>Tidak ditemukan</p></div>`; return; }
  el.innerHTML=users.map(u=>`<div class="user-result" onclick="startChat('${u.id}','${esc(u.username)}','${esc(u.email)}')"><img src="${avatarUrl(u.username)}"><div><div class="user-result-name">${esc(u.username)}</div><div class="user-result-email">${esc(u.email)}</div></div><button class="chat-btn">Chat</button></div>`).join('');
}
async function startChat(partnerId,partnerUsername,partnerEmail){
  closeNewChat();
  if(!followMap[partnerId]){
    await sb.from('follows').upsert(
      {sender_id:ME.id, receiver_id:partnerId, status:'accepted'},
      {onConflict:'sender_id,receiver_id'}
    );
    followMap[partnerId]='accepted';
  }
  const convoId = await ensureConversation(partnerId, partnerUsername, partnerEmail);
  await loadConvos();
  if(convoId) await openConvo(convoId, partnerId, partnerUsername, partnerEmail);
  else showToast('Gagal membuka chat.');
}
