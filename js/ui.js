// XREZZKY Chat — ui.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

// ════════════════════════════════
//  PROFILE
// ════════════════════════════════

function goToAdminPanel(){
  // Buka admin.html di tab baru
  const base = window.location.href.replace(/\/[^/]*(\?.*)?$/, '');
  window.open(base + '/admin.html', '_blank');
}

function openProfileDrawer(){ document.getElementById('profile-drawer').classList.add('open'); updateSidebarUI(); }
function closeProfileDrawer(){ document.getElementById('profile-drawer').classList.remove('open'); }
// changeUsername defined above
// changeBio defined above
// changePassword defined above
function showPartnerInfo(){ if(!activePartner) return; showToast(activePartner.email); }
function openClearConfirm(){ if(!activeConvoId||!confirm('Hapus semua pesan?')) return; sb.from('messages').delete().eq('conversation_id',activeConvoId).then(()=>{ msgs=[]; renderMessages(); showToast('Chat dihapus.'); }); }
function backToList(){ document.getElementById('sidebar').classList.remove('hidden-mobile'); document.getElementById('chatroom').classList.remove('show-mobile'); document.getElementById('chat-ui').style.display='none'; document.getElementById('empty-state').style.display=''; activeConvoId=null; activePartner=null; if(msgCh) sb.removeChannel(msgCh); if(typingCh) sb.removeChannel(typingCh); if(presCh) sb.removeChannel(presCh); }

// ════════════════════════════════
//  RESET PASSWORD (dari link email)
// ════════════════════════════════
function checkPassStrength(v){
  const bar=document.getElementById('pass-bar');
  const label=document.getElementById('pass-label');
  if(!v){ bar.style.width='0'; label.innerText=''; return; }
  let score=0;
  if(v.length>=6) score++;
  if(v.length>=10) score++;
  if(/[A-Z]/.test(v)) score++;
  if(/[0-9]/.test(v)) score++;
  if(/[^A-Za-z0-9]/.test(v)) score++;
  const levels=[
    {pct:'20%',bg:'#ef4444',text:'Sangat lemah'},
    {pct:'40%',bg:'#f97316',text:'Lemah'},
    {pct:'60%',bg:'#f59e0b',text:'Cukup'},
    {pct:'80%',bg:'#22c55e',text:'Kuat'},
    {pct:'100%',bg:'#10b981',text:'Sangat kuat 💪'},
  ];
  const lvl=levels[Math.min(score,4)];
  bar.style.width=lvl.pct; bar.style.background=lvl.bg;
  label.innerText=lvl.text; label.style.color=lvl.bg;
}

async function doResetPassword(){
  const p1=document.getElementById('rp-pass1').value;
  const p2=document.getElementById('rp-pass2').value;
  const errEl=document.getElementById('reset-error');
  const sucEl=document.getElementById('reset-success');
  errEl.style.display='none'; sucEl.style.display='none';

  if(p1.length<6){ errEl.innerText='Password minimal 6 karakter.'; errEl.style.display='block'; return; }
  if(p1!==p2){ errEl.innerText='Password tidak cocok!'; errEl.style.display='block'; return; }

  const btn=document.getElementById('btn-reset');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';

  const {error}=await sb.auth.updateUser({password:p1});
  btn.disabled=false; btn.innerText='Simpan Password Baru';

  if(error){
    errEl.innerText='Gagal: '+error.message; errEl.style.display='block';
  } else {
    sucEl.innerText='✅ Password berhasil diubah! Mengalihkan ke aplikasi...'; sucEl.style.display='block';
    // Biarkan onAuthStateChange yang handle redirect, cukup signOut dulu biar fresh login
    setTimeout(async()=>{
      await sb.auth.signOut();
      showScreen('screen-auth');
    }, 2000);
  }
}