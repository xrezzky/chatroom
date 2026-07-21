// XREZZKY Chat — call.js
// Generated: split from monolithic index.html
// DO NOT edit manually — use the full project structure

//  VOICE CALL v3 — stable, fast, no ghost session
// ════════════════════════════════
const STUN_SERVERS = {
  iceServers: [
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
    {urls:'stun:stun2.l.google.com:19302'},
    {urls:'stun:stun3.l.google.com:19302'},
    // TURN fallback kalau STUN gagal (jaringan ketat)
    {urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
  ]
};

// ── State ──────────────────────────────────────
let pc              = null;
let localStream     = null;
let callSignalCh    = null;
let callRoomId      = null;
let callPartnerId   = null;
let callTimer       = null;
let callSeconds     = 0;
let isMuted         = false;
let isCallActive    = false;
let _incomingOffer  = null;
let _incomingFrom   = null;
let _historyId      = null;
let _callTimeout    = null;
let _lastCall       = {};
let _vibrateLoop    = null;
let _waitOfferCh    = null;
let _ringtoneCtx    = null;
let _ringtoneInt    = null;

function makeRoomId(a,b){ return [a,b].sort().join('_'); }

// ── Hard reset semua state ──────────────────────
function resetCallState(){
  if(pc){ try{ pc.close(); }catch(e){} pc=null; }
  if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
  if(callSignalCh){ try{ sb.removeChannel(callSignalCh); }catch(e){} callSignalCh=null; }
  if(_waitOfferCh){ try{ sb.removeChannel(_waitOfferCh); }catch(e){} _waitOfferCh=null; }
  clearInterval(callTimer); callTimer=null;
  clearTimeout(_callTimeout); _callTimeout=null;
  clearInterval(_vibrateLoop); _vibrateLoop=null;
  stopRingtone();
  if(navigator.vibrate) navigator.vibrate(0);
  if(window._callNotif){ window._callNotif.close(); window._callNotif=null; }
  document.getElementById('remote-audio').srcObject=null;
  document.getElementById('call-overlay').classList.remove('active');
  document.getElementById('incoming-call').classList.remove('show');
  isCallActive=false; callSeconds=0; isMuted=false;
  callRoomId=null; callPartnerId=null;
  _incomingOffer=null; _incomingFrom=null;
  _historyId=null;
}

// ── Anti-spam cooldown ──────────────────────────
function canCallNow(pid){
  const now=Date.now(), last=_lastCall[pid]||0;
  if(now-last<5000){ showToast('⏳ Tunggu sebentar.'); return false; }
  _lastCall[pid]=now; return true;
}

// ── Buat RTCPeerConnection baru ──────────────────
function createPC(partnerId){
  const p = new RTCPeerConnection(STUN_SERVERS);
  p.ontrack = e => {
    const audio = document.getElementById('remote-audio');
    if(audio.srcObject !== e.streams[0]) audio.srcObject = e.streams[0];
  };
  p.onicecandidate = async e => {
    if(e.candidate) await sendSignal('ice',{candidate:e.candidate},partnerId);
  };
  p.onconnectionstatechange = () => {
    console.log('[WebRTC] state:', p.connectionState);
    if(p.connectionState==='connected'){
      clearTimeout(_callTimeout);
      document.getElementById('call-status').style.display='none';
      document.getElementById('call-timer').style.display='block';
      document.getElementById('call-avatar').classList.remove('ringing');
      startCallTimer();
      markCallAnswered();
    }
    if(['disconnected','failed'].includes(p.connectionState)){
      // Coba reconnect dulu sebelum end
      setTimeout(()=>{
        if(pc && ['disconnected','failed','closed'].includes(pc.connectionState)) endCall();
      }, 3000);
    }
    if(p.connectionState==='closed') endCall();
  };
  // ICE trickle — proses candidate secepat mungkin
  p.onicegatheringstatechange = () => {
    console.log('[ICE] gathering:', p.iceGatheringState);
  };
  return p;
}

// ════ CALLER FLOW ═════════════════════════════
async function startCall(){
  if(!activePartner){ showToast('Buka chat dulu.'); return; }
  if(isCallActive){ showToast('Sudah ada panggilan aktif.'); return; }
  if(!canCallNow(activePartner.id)) return;

  // Bersihkan sesi lama dulu
  resetCallState();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:false
    });
  } catch(e){
    showToast('❌ Mikrofon tidak bisa diakses: '+e.message);
    return;
  }

  callPartnerId = activePartner.id;
  callRoomId    = makeRoomId(ME.id, callPartnerId);
  isCallActive  = true;

  const pAvatar = activePartner.avatar_url || avatarUrl(activePartner.username);
  showCallOverlay(activePartner.username, pAvatar, 'Memanggil...');

  // Catat riwayat
  try {
    const {data:h} = await sb.from('call_history').insert({
      room_id:callRoomId, caller_id:ME.id, receiver_id:callPartnerId, status:'missed'
    }).select('id').single();
    _historyId = h?.id||null;
  } catch(e){}

  pc = createPC(callPartnerId);
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));

  subscribeCallSignals(callRoomId);

  // Kirim signal 'call' ke penerima
  await sendSignal('call',{
    callerName:   MY_PROFILE.username,
    callerAvatar: MY_PROFILE.avatar_url||avatarUrl(MY_PROFILE.username)
  }, callPartnerId);

  // Buat offer
  try {
    const offer = await pc.createOffer({offerToReceiveAudio:true});
    await pc.setLocalDescription(offer);
    await sendSignal('offer',{sdp:offer}, callPartnerId);
  } catch(e){
    showToast('❌ Gagal membuat koneksi: '+e.message);
    resetCallState();
    return;
  }

  // Timeout 45 detik tidak terjawab
  _callTimeout = setTimeout(()=>{
    if(isCallActive && callSeconds===0){
      showToast('📵 Tidak ada jawaban.');
      if(_historyId) sb.from('call_history').update({status:'missed',ended_at:new Date().toISOString()}).eq('id',_historyId).then(()=>{});
      resetCallState();
    }
  }, 45000);
}

// ════ CALLEE FLOW ═════════════════════════════
async function acceptCall(){
  stopRingtone();
  clearInterval(_vibrateLoop);
  if(navigator.vibrate) navigator.vibrate(0);
  if(window._callNotif){ window._callNotif.close(); window._callNotif=null; }
  document.getElementById('incoming-call').classList.remove('show');

  if(!_incomingOffer||!_incomingFrom){
    showToast('❌ Sesi panggilan tidak valid.');
    resetCallState(); return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:false
    });
  } catch(e){
    showToast('❌ Mikrofon tidak bisa diakses: '+e.message);
    await sendSignal('reject',{reason:'no_mic'},_incomingFrom);
    resetCallState(); return;
  }

  callPartnerId = _incomingFrom;
  callRoomId    = makeRoomId(ME.id, callPartnerId);
  isCallActive  = true;

  const partnerName   = document.getElementById('ic-name').innerText;
  const partnerAvatar = document.getElementById('ic-avatar').src;
  showCallOverlay(partnerName, partnerAvatar, 'Menyambungkan...');

  pc = createPC(callPartnerId);
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  subscribeCallSignals(callRoomId);

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(_incomingOffer.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal('answer',{sdp:answer}, callPartnerId);
    await sendSignal('accept',{}, callPartnerId);
  } catch(e){
    showToast('❌ Gagal menyambung: '+e.message);
    resetCallState(); return;
  }

  _incomingOffer=null; _incomingFrom=null;
}

async function rejectCall(){
  if(_incomingFrom){
    await sendSignal('reject',{},_incomingFrom).catch(()=>{});
    // Update riwayat jadi rejected
    try {
      await sb.from('call_history')
        .update({status:'rejected',ended_at:new Date().toISOString()})
        .eq('caller_id',_incomingFrom).eq('receiver_id',ME.id)
        .is('ended_at',null);
    } catch(e){}
  }
  resetCallState();
}

async function endCall(){
  if(callPartnerId) await sendSignal('end',{},callPartnerId).catch(()=>{});

  // Update riwayat
  if(_historyId){
    try {
      await sb.from('call_history').update({
        status: callSeconds>0?'answered':'missed',
        duration: callSeconds,
        ended_at: new Date().toISOString()
      }).eq('id',_historyId);
    } catch(e){}
  }

  resetCallState();
}

function markCallAnswered(){
  if(_historyId){
    sb.from('call_history').update({status:'answered'}).eq('id',_historyId).then(()=>{});
  }
}

// ── Controls ────────────────────────────────────
function toggleMute(){
  if(!localStream) return;
  isMuted=!isMuted;
  localStream.getAudioTracks().forEach(t=>t.enabled=!isMuted);
  const btn=document.getElementById('btn-mute');
  btn.querySelector('.call-btn-circle').innerHTML = isMuted
    ? '<i class="fa fa-microphone-slash" style="color:#ef4444;"></i>'
    : '<i class="fa fa-microphone" style="color:#fff;"></i>';
  btn.classList.toggle('active',isMuted);
}

function toggleSpeaker(){
  const audio=document.getElementById('remote-audio');
  audio.muted=!audio.muted;
  document.getElementById('btn-speaker').querySelector('.call-btn-circle').innerHTML = audio.muted
    ? '<i class="fa fa-volume-xmark" style="color:#ef4444;"></i>'
    : '<i class="fa fa-volume-high" style="color:#fff;"></i>';
}

function startCallTimer(){
  callSeconds=0; clearInterval(callTimer);
  callTimer=setInterval(()=>{
    callSeconds++;
    const m=Math.floor(callSeconds/60), s=callSeconds%60;
    document.getElementById('call-timer').innerText=`${m}:${String(s).padStart(2,'0')}`;
  },1000);
}

function showCallOverlay(name,avatar,status){
  document.getElementById('call-avatar').src=avatar;
  document.getElementById('call-avatar').className='call-avatar ringing';
  document.getElementById('call-name').innerText=name;
  document.getElementById('call-status').innerText=status;
  document.getElementById('call-status').style.display='block';
  document.getElementById('call-timer').style.display='none';
  document.getElementById('call-overlay').classList.add('active');
}

// ── Signaling ────────────────────────────────────
async function sendSignal(type,payload,toId){
  try {
    await sb.from('call_signals').insert({
      room_id: callRoomId||makeRoomId(ME.id,toId),
      from_id:ME.id, to_id:toId, type, payload
    });
  } catch(e){ console.warn('[Signal] send error:', e.message); }
}

function subscribeCallSignals(roomId){
  if(callSignalCh){ try{sb.removeChannel(callSignalCh);}catch(e){} }
  callSignalCh = sb.channel('call-'+roomId+'-'+Date.now())
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'call_signals'},
      async payload => {
        const sig=payload.new;
        if(sig.room_id!==roomId||sig.from_id===ME.id) return;
        console.log('[Signal] received:', sig.type);

        switch(sig.type){
          case 'answer':
            if(pc && ['have-local-offer','have-remote-pranswer'].includes(pc.signalingState)){
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(sig.payload.sdp));
                document.getElementById('call-status').innerText='Menyambungkan...';
              } catch(e){ console.warn('[SDP answer]', e); }
            }
            break;
          case 'ice':
            if(pc && pc.remoteDescription && sig.payload?.candidate){
              try { await pc.addIceCandidate(new RTCIceCandidate(sig.payload.candidate)); } catch(e){}
            }
            break;
          case 'accept':
            document.getElementById('call-status').innerText='Menyambungkan...';
            break;
          case 'reject':
            showToast('❌ Panggilan ditolak.');
            if(_historyId) sb.from('call_history').update({status:'rejected',ended_at:new Date().toISOString()}).eq('id',_historyId).then(()=>{});
            resetCallState();
            break;
          case 'end':
            showToast('📵 Panggilan diakhiri.');
            endCall();
            break;
        }
      })
    .subscribe();
}

// ── Incoming call listener ───────────────────────
function subscribeIncomingCalls(){
  sb.channel('incoming-'+ME.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'call_signals'},
      async payload => {
        const sig=payload.new;
        if(sig.to_id!==ME.id||sig.type!=='call') return;

        if(isCallActive){
          const tmpRoom=makeRoomId(ME.id,sig.from_id);
          await sb.from('call_signals').insert({
            room_id:tmpRoom, from_id:ME.id, to_id:sig.from_id,
            type:'reject', payload:{reason:'busy'}
          }).catch(()=>{});
          return;
        }

        // Reset state lama dulu
        if(_waitOfferCh){ try{sb.removeChannel(_waitOfferCh);}catch(e){} _waitOfferCh=null; }
        _incomingFrom=sig.from_id;
        _incomingOffer=null;
        const rId=makeRoomId(ME.id,sig.from_id);
        callRoomId=rId;

        const callerName  =sig.payload?.callerName||'Seseorang';
        const callerAvatar=sig.payload?.callerAvatar||avatarUrl(callerName);

        // Tampilkan UI langsung
        document.getElementById('ic-name').innerText=callerName;
        document.getElementById('ic-avatar').src=callerAvatar;
        document.getElementById('incoming-call').classList.add('show');

        // Subscribe buat terima offer
        _waitOfferCh=sb.channel('waitoffer-'+rId+'-'+Date.now())
          .on('postgres_changes',{event:'INSERT',schema:'public',table:'call_signals'},
            p=>{
              if(p.new.room_id!==rId||p.new.from_id===ME.id) return;
              if(p.new.type==='offer'){
                _incomingOffer=p.new.payload;
                console.log('[Incoming] offer received');
                try{sb.removeChannel(_waitOfferCh);}catch(e){} _waitOfferCh=null;
              }
            })
          .subscribe();

        // Ringtone loop
        playRingtone();

        // Vibrate loop
        if(navigator.vibrate){
          navigator.vibrate([400,200,400,200,400]);
          _vibrateLoop=setInterval(()=>{
            if(document.getElementById('incoming-call').classList.contains('show'))
              navigator.vibrate([400,200,400,200,400]);
            else clearInterval(_vibrateLoop);
          },2500);
        }

        // Browser notification
        if(Notification.permission==='granted'){
          if(window._callNotif) window._callNotif.close();
          window._callNotif=new Notification(`${callerName} memanggil...`,{
            body:'Ketuk untuk menjawab',icon:callerAvatar,
            tag:'incoming-call',renotify:true,requireInteraction:true
          });
          window._callNotif.onclick=()=>{window.focus();window._callNotif?.close();};
        } else if(Notification.permission==='default'){
          Notification.requestPermission().then(p=>{
            if(p==='granted' && document.getElementById('incoming-call').classList.contains('show')){
              window._callNotif=new Notification(`${callerName} memanggil...`,{
                body:'Ketuk untuk menjawab',icon:callerAvatar,
                tag:'incoming-call',requireInteraction:true
              });
            }
          });
        }

        updateTabTitle(`${callerName}`);

        // Auto reject 30 detik
        setTimeout(()=>{
          if(document.getElementById('incoming-call').classList.contains('show')) rejectCall();
        },30000);
      })
    .subscribe();
}

// ── Ringtone ─────────────────────────────────────
function playRingtone(){
  stopRingtone();
  try {
    _ringtoneCtx=new (window.AudioContext||window.webkitAudioContext)();
    const beep=()=>{
      if(!_ringtoneCtx) return;
      const freqs=[880,1100];
      let t=_ringtoneCtx.currentTime;
      for(let i=0;i<4;i++){
        const o=_ringtoneCtx.createOscillator(), g=_ringtoneCtx.createGain();
        o.connect(g); g.connect(_ringtoneCtx.destination);
        o.type='sine'; o.frequency.value=freqs[i%2];
        g.gain.setValueAtTime(0.2,t);
        g.gain.exponentialRampToValueAtTime(0.001,t+0.3);
        o.start(t); o.stop(t+0.3); t+=0.4;
      }
    };
    beep();
    _ringtoneInt=setInterval(beep,2500);
  } catch(e){}
}

function stopRingtone(){
  clearInterval(_ringtoneInt); _ringtoneInt=null;
  try{if(_ringtoneCtx){_ringtoneCtx.close();}}catch(e){}
  _ringtoneCtx=null;
}

// ── Call History ─────────────────────────────────
async function openCallHistory(){
  const {data} = await sb.from('call_history')
    .select('*, caller:caller_id(username,avatar_url), receiver:receiver_id(username,avatar_url)')
    .or(`caller_id.eq.${ME.id},receiver_id.eq.${ME.id}`)
    .order('started_at',{ascending:false}).limit(50);

  const list=data||[];
  let html=`<div style="padding:16px 18px 8px;font-size:16px;font-weight:900;display:flex;align-items:center;gap:8px;">
    <i class="fa fa-phone-volume" style="color:var(--accent);"></i> Riwayat Panggilan
  </div>`;

  if(!list.length){
    html+=`<div style="padding:40px 20px;text-align:center;color:var(--text3);">
      <i class="fa fa-phone-slash" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px;"></i>
      Belum ada riwayat panggilan
    </div>`;
  } else {
    html+=list.map(c=>{
      const isOut=c.caller_id===ME.id;
      const other=isOut?c.receiver:c.caller;
      const statusMap={answered:isOut?'Terhubung':'Masuk',missed:'Tak terjawab',rejected:'Ditolak',busy:'Sibuk'};
      const iconMap={answered:isOut?'fa-arrow-up-right-from-square':'fa-arrow-down-left', missed:'fa-phone-missed',rejected:'fa-phone-slash',busy:'fa-phone-slash'};
      const colorMap={answered:'var(--green)',missed:'var(--red)',rejected:'var(--text3)',busy:'var(--text3)'};
      const dur=c.duration?` · ${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}` :'';
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--border);cursor:pointer;"
        onclick="quickOpenChatById('${other?.id||''}','${esc(other?.username||'')}')">
        <img src="${other?.avatar_url||avatarUrl(other?.username||'?')}" style="width:42px;height:42px;border-radius:50%;flex-shrink:0;object-fit:cover;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">@${esc(other?.username||'?')}</div>
          <div style="font-size:11px;color:${colorMap[c.status]||'var(--text3)'};display:flex;align-items:center;gap:5px;margin-top:2px;">
            <i class="fa ${iconMap[c.status]||'fa-phone'}"></i>
            ${statusMap[c.status]||c.status}${dur}
          </div>
        </div>
        <div style="font-size:10px;color:var(--text3);flex-shrink:0;text-align:right;">
          ${fmtTime(c.started_at)}
        </div>
      </div>`;
    }).join('');
  }

  showBottomSheetGeneric(html);
}

function quickOpenChatById(userId, username){
  if(!userId) return;
  const c = convos.find(x=>x.partnerUser?.id===userId);
  if(c) openConvo(c.id, userId, username, c.partnerUser?.email||'');
  let modal = document.getElementById('generic-sheet');
  if(modal) modal.classList.remove('open');
}

function showBottomSheetGeneric(html){
  let modal=document.getElementById('generic-sheet');
  if(!modal){
    modal=document.createElement('div');
    modal.id='generic-sheet';
    modal.className='modal-overlay';
    modal.onclick=e=>{ if(e.target===modal) modal.classList.remove('open'); };
    modal.innerHTML=`<div class="bottom-sheet" style="max-height:85dvh;overflow-y:auto;"><div class="sheet-handle"></div><div id="generic-sheet-body"></div></div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('generic-sheet-body').innerHTML=html;
  modal.classList.add('open');
}


let allGroups = [];