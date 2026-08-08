// ═══════════════════════════════════════════════════════
//  XREZZKY Chat — call.js v5 (production-ready)
//  Arsitektur:
//    - Session ID unik per call (UUID)
//    - State terpisah: DB state | local state | WebRTC state
//    - Heartbeat untuk detect stale session
//    - Single listener, no duplicates
//    - Atomic cleanup: lokal dulu, DB background
// ═══════════════════════════════════════════════════════

const CALL_DEBUG = true; // set false di production
function callLog(...args){ if(CALL_DEBUG) console.log('[CALL]', ...args); }

// ── STUN/TURN config ──────────────────────────────────
const STUN_SERVERS = {
  iceServers: [
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
    {urls:'stun:stun2.l.google.com:19302'},
    {urls:'turn:openrelay.metered.ca:80',   username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443',  username:'openrelayproject',credential:'openrelayproject'},
  ]
};

// ═══════════════════════════════════════════════════════
//  STATE — 3 layer terpisah
// ═══════════════════════════════════════════════════════

// Layer 1: Session state (per-call, reset tiap call baru)
let _session = {
  id:         null,   // UUID unik per call — KUNCI anti-stale
  roomId:     null,   // makeRoomId(A,B) + session.id
  partnerId:  null,
  historyId:  null,
  role:       null,   // 'caller' | 'callee'
  startedAt:  null,
};

// Layer 2: Local client state
let _local = {
  isActive:      false,
  isMuted:       false,
  incomingOffer: null,
  incomingFrom:  null,
  iceQueue:      [],
  remoteSet:     false,
  lastCall:      {},  // anti-spam: {partnerId: timestamp}
};

// Layer 3: WebRTC + infrastructure objects
let _rt = {
  pc:           null,
  localStream:  null,
  signalCh:     null,
  waitOfferCh:  null,
  incomingCh:   null,  // SINGLE global incoming listener
  callTimer:    null,
  callSeconds:  0,
  callTimeout:  null,
  vibrateLoop:  null,
  ringtoneCtx:  null,
  ringtoneInt:  null,
  heartbeatInt: null,  // heartbeat timer
};

// ── Generate session ID ───────────────────────────────
function genSessionId(){
  return 'cs-' + Date.now() + '-' + Math.random().toString(36).slice(2,9);
}

function makeRoomId(a, b, sessionId){
  // Room ID = sorted IDs + session ID → unik per call
  return [a,b].sort().join('_') + '_' + sessionId;
}

// ═══════════════════════════════════════════════════════
//  RESET — 3 fungsi berbeda sesuai kebutuhan
// ═══════════════════════════════════════════════════════

// Reset WebRTC objects (Layer 3) — sinkron, cepat
function _resetWebRTC(){
  if(_rt.pc){
    try {
      // Hapus semua event handler dulu biar tidak trigger lagi
      _rt.pc.ontrack              = null;
      _rt.pc.onicecandidate       = null;
      _rt.pc.onconnectionstatechange = null;
      _rt.pc.onsignalingstatechange  = null;
      _rt.pc.close();
    } catch(e){}
    _rt.pc = null;
  }
  if(_rt.localStream){
    _rt.localStream.getTracks().forEach(t=>{ try{t.stop();}catch(e){} });
    _rt.localStream = null;
  }
  if(_rt.signalCh){
    try{sb.removeChannel(_rt.signalCh);}catch(e){}
    _rt.signalCh = null;
  }
  if(_rt.waitOfferCh){
    try{sb.removeChannel(_rt.waitOfferCh);}catch(e){}
    _rt.waitOfferCh = null;
  }
  clearInterval(_rt.callTimer);    _rt.callTimer=null; _rt.callSeconds=0;
  clearTimeout(_rt.callTimeout);   _rt.callTimeout=null;
  clearInterval(_rt.vibrateLoop);  _rt.vibrateLoop=null;
  clearInterval(_rt.heartbeatInt); _rt.heartbeatInt=null;
  _stopRingtone();
  if(navigator.vibrate) navigator.vibrate(0);
  if(window._callNotif){ try{window._callNotif.close();}catch(e){} window._callNotif=null; }
  const audio = document.getElementById('remote-audio');
  if(audio){ audio.srcObject=null; audio.muted=false; }
}

// Reset local state (Layer 2)
function _resetLocal(){
  _local.isActive      = false;
  _local.isMuted       = false;
  _local.incomingOffer = null;
  _local.incomingFrom  = null;
  _local.iceQueue      = [];
  _local.remoteSet     = false;
}

// Reset session (Layer 1)
function _resetSession(){
  _session.id        = null;
  _session.roomId    = null;
  _session.partnerId = null;
  _session.historyId = null;
  _session.role      = null;
  _session.startedAt = null;
}

// Reset UI elements
function _resetUI(){
  document.getElementById('call-overlay')?.classList.remove('active');
  document.getElementById('incoming-call')?.classList.remove('show');
  const btnMute = document.getElementById('btn-mute');
  if(btnMute){
    btnMute.classList.remove('active');
    const c=btnMute.querySelector('.call-btn-circle');
    if(c) c.innerHTML='<i class="fa fa-microphone" style="color:#fff;"></i>';
  }
  const btnSpk = document.getElementById('btn-speaker');
  if(btnSpk){
    const c=btnSpk.querySelector('.call-btn-circle');
    if(c) c.innerHTML='<i class="fa fa-volume-high" style="color:#fff;"></i>';
  }
}

// FULL RESET — panggil ini saat end/reject call
// Sinkron untuk local, async untuk DB cleanup
function forceEndLocal(){
  callLog('forceEndLocal — session:', _session.id);
  _resetWebRTC();
  _resetUI();
  _resetLocal();
  _resetSession();
}

// DB cleanup (background, tidak blocking)
function _cleanupDB(roomId, sessionId){
  if(!roomId) return;
  callLog('cleanupDB — room:', roomId);
  setTimeout(async ()=>{
    try {
      await sb.from('call_signals').delete().eq('room_id', roomId);
      callLog('cleanupDB done');
    } catch(e){ callLog('cleanupDB error:', e.message); }
  }, 1500); // delay 1.5s biar signal 'end' kebaca dulu
}

// ═══════════════════════════════════════════════════════
//  ANTI-SPAM
// ═══════════════════════════════════════════════════════
function _canCall(partnerId){
  const now=Date.now(), last=_local.lastCall[partnerId]||0;
  if(now-last<5000){ showToast('⏳ Tunggu sebentar.'); return false; }
  _local.lastCall[partnerId]=now;
  return true;
}

// ═══════════════════════════════════════════════════════
//  WebRTC PEER CONNECTION
// ═══════════════════════════════════════════════════════
function _createPC(partnerId, sessionId){
  const p = new RTCPeerConnection(STUN_SERVERS);

  p.ontrack = e => {
    callLog('ontrack received');
    const audio = document.getElementById('remote-audio');
    if(audio && audio.srcObject!==e.streams[0]){
      audio.srcObject=e.streams[0];
      audio.play().catch(err=>callLog('autoplay blocked:',err));
    }
  };

  p.onicecandidate = async e => {
    if(!e.candidate) return;
    callLog('ICE candidate generated');
    await _sendSignal('ice',{candidate:e.candidate.toJSON()},partnerId,sessionId);
  };

  p.onconnectionstatechange = () => {
    const state = p.connectionState;
    callLog('connectionState:', state);

    // Guard: ignore jika PC ini sudah bukan _rt.pc aktif
    if(p !== _rt.pc){ callLog('stale PC event ignored'); return; }

    const statusEl = document.getElementById('call-status');
    const timerEl  = document.getElementById('call-timer');
    const avatarEl = document.getElementById('call-avatar');

    if(state==='connected'){
      clearTimeout(_rt.callTimeout);
      if(statusEl) statusEl.style.display='none';
      if(timerEl)  timerEl.style.display='block';
      if(avatarEl) avatarEl.classList.remove('ringing');
      _startTimer();
      _markAnswered();
      _startHeartbeat(partnerId, sessionId);
    }

    if(state==='connecting'){
      if(statusEl){ statusEl.style.display='block'; statusEl.innerText='Menyambungkan...'; }
    }

    if(['disconnected','failed'].includes(state)){
      if(statusEl){ statusEl.style.display='block'; statusEl.innerText='Koneksi terputus...'; }
      setTimeout(()=>{
        if(_rt.pc===p && ['disconnected','failed','closed'].includes(p.connectionState)){
          callLog('connection lost — ending call');
          endCall();
        }
      }, 4000);
    }

    if(state==='closed' && _local.isActive){
      callLog('PC closed — force end');
      endCall();
    }
  };

  p.onsignalingstatechange = ()=>{
    callLog('signalingState:', p.signalingState);
  };

  return p;
}

// ═══════════════════════════════════════════════════════
//  HEARTBEAT — deteksi stale session
// ═══════════════════════════════════════════════════════
function _startHeartbeat(partnerId, sessionId){
  clearInterval(_rt.heartbeatInt);
  _rt.heartbeatInt = setInterval(async ()=>{
    // Cek apakah sesi masih valid
    if(!_local.isActive || _session.id!==sessionId){
      clearInterval(_rt.heartbeatInt);
      return;
    }
    // Kirim heartbeat signal
    try {
      await sb.from('call_signals').insert({
        room_id: _session.roomId, from_id: ME.id,
        to_id: partnerId, type:'heartbeat', payload:{sessionId}
      });
    } catch(e){}
  }, 8000); // tiap 8 detik
}

// ═══════════════════════════════════════════════════════
//  ICE CANDIDATE QUEUE
// ═══════════════════════════════════════════════════════
async function _drainIceQueue(){
  if(!_rt.pc || !_local.remoteSet) return;
  callLog('draining ICE queue:', _local.iceQueue.length);
  while(_local.iceQueue.length>0){
    const c=_local.iceQueue.shift();
    try{ await _rt.pc.addIceCandidate(new RTCIceCandidate(c)); }
    catch(e){ callLog('ICE drain error:', e.message); }
  }
}

// ═══════════════════════════════════════════════════════
//  SIGNALING
// ═══════════════════════════════════════════════════════
async function _sendSignal(type, payload, toId, sessionId){
  const roomId = _session.roomId || makeRoomId(ME.id, toId, sessionId||'?');
  callLog('sendSignal:', type, '→', toId?.slice(0,8));
  try {
    await sb.from('call_signals').insert({
      room_id:roomId, from_id:ME.id, to_id:toId,
      type, payload:{...payload, _sessionId: sessionId||_session.id}
    });
  } catch(e){ callLog('sendSignal error:', e.message); }
}

// Alias global (dipanggil dari luar)
async function sendSignal(type, payload, toId){
  await _sendSignal(type, payload, toId, _session.id);
}

function _subscribeCallSignals(roomId, sessionId){
  if(_rt.signalCh){ try{sb.removeChannel(_rt.signalCh);}catch(e){} }
  callLog('subscribeSignals — room:', roomId);

  _rt.signalCh = sb.channel('csig-'+sessionId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'call_signals'},
      async payload => {
        const sig = payload.new;

        // Freshness check — ignore signal > 30 detik
        const age = Date.now() - new Date(sig.created_at).getTime();
        if(age > 30000){ callLog('stale signal dropped:', sig.type, age+'ms'); return; }

        // Guard: hanya proses signal untuk sesi ini
        if(sig.room_id !== roomId)         { return; }
        if(sig.from_id === ME.id)          { return; } // dari diri sendiri
        if(sig.payload?._sessionId && sig.payload._sessionId !== sessionId) {
          callLog('stale session signal ignored:', sig.type, sig.payload._sessionId);
          return;
        }

        callLog('signal received:', sig.type);

        switch(sig.type){
          case 'answer':
            if(_rt.pc && _rt.pc.signalingState==='have-local-offer'){
              try {
                await _rt.pc.setRemoteDescription(new RTCSessionDescription(sig.payload.sdp));
                _local.remoteSet=true;
                await _drainIceQueue();
                const sEl=document.getElementById('call-status');
                if(sEl){ sEl.style.display='block'; sEl.innerText='Menyambungkan...'; }
              } catch(e){ callLog('setRemoteDesc error:', e); }
            }
            break;

          case 'ice':
            if(sig.payload?.candidate){
              if(_local.remoteSet && _rt.pc){
                try{ await _rt.pc.addIceCandidate(new RTCIceCandidate(sig.payload.candidate)); }
                catch(e){ callLog('addICE error:', e.message); }
              } else {
                _local.iceQueue.push(sig.payload.candidate);
                callLog('ICE queued, total:', _local.iceQueue.length);
              }
            }
            break;

          case 'accept':
            { const sEl=document.getElementById('call-status');
              if(sEl){ sEl.style.display='block'; sEl.innerText='Menyambungkan...'; } }
            break;

          case 'reject':
            showToast('❌ Panggilan ditolak.');
            if(_session.historyId) sb.from('call_history').update({status:'rejected',ended_at:new Date().toISOString()}).eq('id',_session.historyId).catch(()=>{});
            _cleanupDB(roomId, sessionId);
            forceEndLocal();
            break;

          case 'end':
            callLog('end signal received');
            showToast('📵 Panggilan diakhiri.');
            _cleanupDB(roomId, sessionId);
            forceEndLocal();
            break;

          case 'heartbeat':
            callLog('heartbeat from partner');
            break;
        }
      })
    .subscribe(status=>{ callLog('signalCh status:', status); });
}

// ═══════════════════════════════════════════════════════
//  CALLER FLOW
// ═══════════════════════════════════════════════════════
async function startCall(){
  if(!activePartner){ showToast('Buka chat dulu.'); return; }
  if(_local.isActive){ showToast('Sudah ada panggilan aktif.'); return; }
  if(!_canCall(activePartner.id)) return;

  // Force cleanup sesi lama
  if(_session.id){
    callLog('cleanup stale session before new call:', _session.id);
    forceEndLocal();
  }

  callLog('startCall →', activePartner.username);

  // Minta akses mikrofon DULU sebelum set state apapun
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:false
    });
  } catch(e){
    showToast('❌ Mikrofon tidak bisa diakses: '+e.message);
    return;
  }

  // Set session state
  const sessionId = genSessionId();
  _session.id        = sessionId;
  _session.partnerId = activePartner.id;
  _session.roomId    = makeRoomId(ME.id, activePartner.id, sessionId);
  _session.role      = 'caller';
  _session.startedAt = Date.now();
  _local.isActive    = true;

  callLog('session created:', sessionId, 'room:', _session.roomId);

  _rt.localStream = stream;
  _rt.pc = _createPC(activePartner.id, sessionId);
  _rt.localStream.getTracks().forEach(t=>_rt.pc.addTrack(t,_rt.localStream));

  // Subscribe signals SEBELUM kirim offer
  _subscribeCallSignals(_session.roomId, sessionId);

  // Tampilkan UI
  const pAvatar = activePartner.avatar_url||avatarUrl(activePartner.username);
  showCallOverlay(activePartner.username, pAvatar, 'Memanggil...');

  // Catat riwayat
  try {
    const {data:h}=await sb.from('call_history').insert({
      room_id:_session.roomId, caller_id:ME.id,
      receiver_id:activePartner.id, status:'missed'
    }).select('id').single();
    _session.historyId = h?.id||null;
  } catch(e){}

  // Kirim notif 'call' ke penerima (dengan session ID)
  await _sendSignal('call',{
    callerName:   MY_PROFILE.username,
    callerAvatar: MY_PROFILE.avatar_url||avatarUrl(MY_PROFILE.username),
    sessionId:    sessionId,
    roomId:       _session.roomId
  }, activePartner.id, sessionId);

  // Buat & kirim offer
  try {
    const offer = await _rt.pc.createOffer({offerToReceiveAudio:true});
    await _rt.pc.setLocalDescription(offer);
    await _sendSignal('offer',{sdp:{type:offer.type,sdp:offer.sdp}}, activePartner.id, sessionId);
  } catch(e){
    showToast('❌ Gagal buat offer: '+e.message);
    forceEndLocal();
    return;
  }

  // Timeout 45 detik
  _rt.callTimeout = setTimeout(async ()=>{
    if(_local.isActive && _rt.callSeconds===0 && _session.id===sessionId){
      callLog('call timeout — no answer');
      showToast('📵 Tidak ada jawaban.');
      if(_session.historyId) sb.from('call_history').update({status:'missed',ended_at:new Date().toISOString()}).eq('id',_session.historyId).catch(()=>{});
      _cleanupDB(_session.roomId, sessionId);
      forceEndLocal();
    }
  }, 45000);
}

// ═══════════════════════════════════════════════════════
//  CALLEE FLOW
// ═══════════════════════════════════════════════════════
async function acceptCall(){
  callLog('acceptCall');
  _stopRingtone();
  clearInterval(_rt.vibrateLoop);
  if(navigator.vibrate) navigator.vibrate(0);
  if(window._callNotif){ window._callNotif.close(); window._callNotif=null; }
  document.getElementById('incoming-call')?.classList.remove('show');

  if(!_local.incomingOffer || !_local.incomingFrom || !_session.id){
    callLog('acceptCall invalid — offer:', !!_local.incomingOffer, 'from:', !!_local.incomingFrom, 'session:', !!_session.id);
    showToast('❌ Sesi panggilan tidak valid. Tunggu panggilan masuk.');
    forceEndLocal(); return;
  }

  // Cek freshness — offer tidak boleh lebih dari 45 detik
  if(_session.startedAt && Date.now()-_session.startedAt > 45000){
    callLog('acceptCall — session too old, rejecting');
    showToast('❌ Sesi panggilan sudah kadaluarsa.');
    forceEndLocal(); return;
  }

  // Minta akses mikrofon
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:false
    });
  } catch(e){
    showToast('❌ Mikrofon tidak bisa diakses: '+e.message);
    await _sendSignal('reject',{reason:'no_mic'}, _local.incomingFrom, _session.id);
    forceEndLocal(); return;
  }

  callLog('acceptCall — session:', _session.id, 'room:', _session.roomId);

  _local.isActive    = true;
  _session.role      = 'callee';
  _session.partnerId = _local.incomingFrom;
  _session.startedAt = Date.now();

  _rt.localStream = stream;
  _rt.pc = _createPC(_session.partnerId, _session.id);
  _rt.localStream.getTracks().forEach(t=>_rt.pc.addTrack(t,_rt.localStream));

  _subscribeCallSignals(_session.roomId, _session.id);

  const partnerName   = document.getElementById('ic-name')?.innerText||'Partner';
  const partnerAvatar = document.getElementById('ic-avatar')?.src||avatarUrl(partnerName);
  showCallOverlay(partnerName, partnerAvatar, 'Menyambungkan...');

  try {
    await _rt.pc.setRemoteDescription(new RTCSessionDescription(_local.incomingOffer.sdp));
    _local.remoteSet=true;
    await _drainIceQueue();

    const answer = await _rt.pc.createAnswer();
    await _rt.pc.setLocalDescription(answer);
    await _sendSignal('answer',{sdp:{type:answer.type,sdp:answer.sdp}}, _session.partnerId, _session.id);
    await _sendSignal('accept',{}, _session.partnerId, _session.id);
  } catch(e){
    callLog('acceptCall error:', e);
    showToast('❌ Gagal menyambung: '+e.message);
    forceEndLocal(); return;
  }

  _local.incomingOffer=null;
  _local.incomingFrom=null;
}

async function rejectCall(){
  callLog('rejectCall');
  _stopRingtone();
  clearInterval(_rt.vibrateLoop);
  if(navigator.vibrate) navigator.vibrate(0);
  if(window._callNotif){ window._callNotif.close(); window._callNotif=null; }
  document.getElementById('incoming-call')?.classList.remove('show');

  if(_local.incomingFrom){
    await _sendSignal('reject',{}, _local.incomingFrom, _session.id);
    try {
      await sb.from('call_history')
        .update({status:'rejected',ended_at:new Date().toISOString()})
        .eq('caller_id',_local.incomingFrom).eq('receiver_id',ME.id)
        .is('ended_at',null);
    } catch(e){}
  }
  _cleanupDB(_session.roomId, _session.id);
  forceEndLocal();
}

async function endCall(){
  if(!_local.isActive && !_session.id){ callLog('endCall — nothing to end'); return; }
  callLog('endCall — session:', _session.id);

  const partner   = _session.partnerId;
  const histId    = _session.historyId;
  const secs      = _rt.callSeconds;
  const roomId    = _session.roomId;
  const sessionId = _session.id;

  // 1. Kirim end signal SEBELUM cleanup
  if(partner && sessionId){
    try {
      await sb.from('call_signals').insert({
        room_id: roomId, from_id: ME.id, to_id: partner,
        type:'end', payload:{_sessionId: sessionId}
      });
      callLog('end signal sent');
    } catch(e){ callLog('end signal error:', e.message); }
  }

  // 2. Force reset lokal (sinkron)
  forceEndLocal();

  // 3. Update riwayat background
  if(histId){
    sb.from('call_history').update({
      status:secs>0?'answered':'missed',
      duration:secs, ended_at:new Date().toISOString()
    }).eq('id',histId).catch(()=>{});
  }

  // 4. DB cleanup background (dengan delay)
  _cleanupDB(roomId, sessionId);
}

function _markAnswered(){
  if(_session.historyId){
    sb.from('call_history').update({status:'answered'}).eq('id',_session.historyId).catch(()=>{});
  }
}

// ═══════════════════════════════════════════════════════
//  GLOBAL INCOMING LISTENER — SINGLE INSTANCE
// ═══════════════════════════════════════════════════════
function subscribeIncomingCalls(){
  // Pastikan tidak ada listener lama
  if(_rt.incomingCh){
    try{sb.removeChannel(_rt.incomingCh);}catch(e){}
    _rt.incomingCh=null;
  }

  callLog('subscribeIncomingCalls — user:', ME.id?.slice(0,8));

  _rt.incomingCh = sb.channel('incoming-'+ME.id+'-'+Date.now())
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'call_signals'},
      async payload => {
        const sig = payload.new;
        if(sig.to_id!==ME.id || sig.type!=='call') return;

        // ── FRESHNESS CHECK — tolak signal yang lebih dari 15 detik ──
        const signalAge = Date.now() - new Date(sig.created_at).getTime();
        if(signalAge > 15000){
          callLog('stale signal ignored, age:', signalAge+'ms');
          return;
        }

        callLog('incoming call from:', sig.from_id?.slice(0,8), 'age:', signalAge+'ms');

        // Busy → tolak otomatis
        if(_local.isActive){
          callLog('busy — auto reject');
          try {
            await sb.from('call_signals').insert({
              room_id: sig.payload?.roomId||makeRoomId(ME.id,sig.from_id,sig.payload?.sessionId||'?'),
              from_id: ME.id, to_id: sig.from_id,
              type:'reject', payload:{reason:'busy',_sessionId:sig.payload?.sessionId}
            });
          } catch(e){}
          return;
        }

        // Cek apakah ada sesi lama yang belum dibersihkan
        if(_session.id){
          callLog('stale session detected, force cleanup before incoming');
          forceEndLocal();
        }

        // Set incoming state
        _local.incomingFrom  = sig.from_id;
        _local.incomingOffer = null;
        _local.iceQueue      = [];
        _local.remoteSet     = false;

        // Set session state dari caller
        _session.id     = sig.payload?.sessionId || genSessionId();
        _session.roomId = sig.payload?.roomId    || makeRoomId(ME.id, sig.from_id, _session.id);

        const callerName   = sig.payload?.callerName  || 'Seseorang';
        const callerAvatar = sig.payload?.callerAvatar || avatarUrl(callerName);

        // Tampilkan UI incoming
        const icName   = document.getElementById('ic-name');
        const icAvatar = document.getElementById('ic-avatar');
        if(icName)   icName.innerText = callerName;
        if(icAvatar) icAvatar.src     = callerAvatar;
        document.getElementById('incoming-call')?.classList.add('show');

        // Subscribe untuk dapat offer dari caller
        if(_rt.waitOfferCh){ try{sb.removeChannel(_rt.waitOfferCh);}catch(e){} }
        _rt.waitOfferCh = sb.channel('woffer-'+_session.id)
          .on('postgres_changes',{event:'INSERT',schema:'public',table:'call_signals'},
            p=>{
              const s=p.new;
              if(s.room_id!==_session.roomId || s.from_id===ME.id) return;
              if(s.payload?._sessionId && s.payload._sessionId!==_session.id) return;
              if(s.type==='offer'){
                callLog('offer received ✅');
                _local.incomingOffer=s.payload;
                try{sb.removeChannel(_rt.waitOfferCh);}catch(e){}
                _rt.waitOfferCh=null;
              }
            })
          .subscribe();

        // Ringtone + vibrate
        _playRingtone();
        if(navigator.vibrate){
          navigator.vibrate([400,200,400,200,400]);
          _rt.vibrateLoop=setInterval(()=>{
            if(document.getElementById('incoming-call')?.classList.contains('show'))
              navigator.vibrate([400,200,400,200,400]);
            else clearInterval(_rt.vibrateLoop);
          },2500);
        }

        // Browser notification
        if(Notification.permission==='granted'){
          if(window._callNotif) window._callNotif.close();
          window._callNotif=new Notification(`${callerName} memanggil...`,{
            body:'Ketuk untuk menjawab',icon:callerAvatar,
            tag:'incoming-call',renotify:true,requireInteraction:true
          });
          window._callNotif.onclick=()=>{ window.focus(); window._callNotif?.close(); };
        } else if(Notification.permission==='default'){
          Notification.requestPermission().then(p=>{
            if(p==='granted'){
              window._callNotif=new Notification(`${callerName} memanggil...`,{
                body:'Ketuk untuk menjawab',icon:callerAvatar,tag:'incoming-call',requireInteraction:true
              });
            }
          });
        }

        updateTabTitle(`${callerName}`);

        // Auto reject 30 detik
        setTimeout(()=>{
          if(document.getElementById('incoming-call')?.classList.contains('show')){
            callLog('auto reject — no answer in 30s');
            rejectCall();
          }
        }, 30000);
      })
    .subscribe(status=>{ callLog('incomingCh status:', status); });
}

// ═══════════════════════════════════════════════════════
//  UI & CONTROLS
// ═══════════════════════════════════════════════════════
function showCallOverlay(name,avatar,status){
  const avatarEl=document.getElementById('call-avatar');
  const nameEl  =document.getElementById('call-name');
  const statusEl=document.getElementById('call-status');
  const timerEl =document.getElementById('call-timer');
  const overlay =document.getElementById('call-overlay');
  if(avatarEl){ avatarEl.src=avatar; avatarEl.className='call-avatar ringing'; }
  if(nameEl)   nameEl.innerText=name;
  if(statusEl){ statusEl.innerText=status; statusEl.style.display='block'; }
  if(timerEl)  timerEl.style.display='none';
  if(overlay)  overlay.classList.add('active');
}

function _startTimer(){
  _rt.callSeconds=0;
  clearInterval(_rt.callTimer);
  _rt.callTimer=setInterval(()=>{
    _rt.callSeconds++;
    const m=Math.floor(_rt.callSeconds/60), s=_rt.callSeconds%60;
    const el=document.getElementById('call-timer');
    if(el) el.innerText=`${m}:${String(s).padStart(2,'0')}`;
  },1000);
}

function toggleMute(){
  if(!_rt.localStream) return;
  _local.isMuted=!_local.isMuted;
  _rt.localStream.getAudioTracks().forEach(t=>t.enabled=!_local.isMuted);
  const btn=document.getElementById('btn-mute');
  if(btn){
    btn.classList.toggle('active',_local.isMuted);
    const c=btn.querySelector('.call-btn-circle');
    if(c) c.innerHTML=_local.isMuted
      ?'<i class="fa fa-microphone-slash" style="color:#ef4444;"></i>'
      :'<i class="fa fa-microphone" style="color:#fff;"></i>';
  }
}

function toggleSpeaker(){
  const audio=document.getElementById('remote-audio');
  if(!audio) return;
  audio.muted=!audio.muted;
  const btn=document.getElementById('btn-speaker');
  if(btn){
    const c=btn.querySelector('.call-btn-circle');
    if(c) c.innerHTML=audio.muted
      ?'<i class="fa fa-volume-xmark" style="color:#ef4444;"></i>'
      :'<i class="fa fa-volume-high" style="color:#fff;"></i>';
  }
}

// ═══════════════════════════════════════════════════════
//  RINGTONE
// ═══════════════════════════════════════════════════════
function _playRingtone(){
  _stopRingtone();
  try {
    _rt.ringtoneCtx=new (window.AudioContext||window.webkitAudioContext)();
    const beep=()=>{
      if(!_rt.ringtoneCtx) return;
      const freqs=[880,1100]; let t=_rt.ringtoneCtx.currentTime;
      for(let i=0;i<4;i++){
        const o=_rt.ringtoneCtx.createOscillator(), g=_rt.ringtoneCtx.createGain();
        o.connect(g); g.connect(_rt.ringtoneCtx.destination);
        o.type='sine'; o.frequency.value=freqs[i%2];
        g.gain.setValueAtTime(0.2,t);
        g.gain.exponentialRampToValueAtTime(0.001,t+0.3);
        o.start(t); o.stop(t+0.3); t+=0.4;
      }
    };
    beep();
    _rt.ringtoneInt=setInterval(beep,2500);
  } catch(e){}
}

function _stopRingtone(){
  clearInterval(_rt.ringtoneInt); _rt.ringtoneInt=null;
  try{ if(_rt.ringtoneCtx) _rt.ringtoneCtx.close(); }catch(e){}
  _rt.ringtoneCtx=null;
}

// Alias
function playRingtone(){ _playRingtone(); }
function stopRingtone(){ _stopRingtone(); }

// ═══════════════════════════════════════════════════════
//  RIWAYAT PANGGILAN
// ═══════════════════════════════════════════════════════
async function openCallHistory(){
  const {data}=await sb.from('call_history')
    .select('*,caller:caller_id(username,avatar_url),receiver:receiver_id(username,avatar_url)')
    .or(`caller_id.eq.${ME.id},receiver_id.eq.${ME.id}`)
    .order('started_at',{ascending:false}).limit(50);

  const list=data||[];
  let html=`<div style="padding:16px 18px 8px;font-size:16px;font-weight:900;display:flex;align-items:center;gap:8px;">
    <i class="fa fa-phone-volume" style="color:var(--accent);"></i> Riwayat Panggilan
  </div>`;
  if(!list.length){
    html+=`<div style="padding:40px 20px;text-align:center;color:var(--text3);">
      <i class="fa fa-phone-slash" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px;"></i>
      Belum ada riwayat
    </div>`;
  } else {
    html+=list.map(c=>{
      const isOut=c.caller_id===ME.id;
      const other=isOut?c.receiver:c.caller;
      const statusMap={answered:isOut?'Terhubung':'Masuk',missed:'Tak terjawab',rejected:'Ditolak',busy:'Sibuk'};
      const iconMap={answered:isOut?'fa-arrow-up-right-from-square':'fa-arrow-down-left',missed:'fa-phone-missed',rejected:'fa-phone-slash',busy:'fa-phone-slash'};
      const colorMap={answered:'var(--green)',missed:'var(--red)',rejected:'var(--text3)',busy:'var(--text3)'};
      const dur=c.duration?` · ${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}`:'';
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--border);cursor:pointer;" onclick="quickOpenChatById('${other?.id||''}','${esc(other?.username||'')}')">
        <img src="${other?.avatar_url||avatarUrl(other?.username||'?')}" style="width:42px;height:42px;border-radius:50%;flex-shrink:0;object-fit:cover;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">@${esc(other?.username||'?')}</div>
          <div style="font-size:11px;color:${colorMap[c.status]||'var(--text3)'};display:flex;align-items:center;gap:5px;margin-top:2px;">
            <i class="fa ${iconMap[c.status]||'fa-phone'}"></i> ${statusMap[c.status]||c.status}${dur}
          </div>
        </div>
        <div style="font-size:10px;color:var(--text3);">${fmtTime(c.started_at)}</div>
      </div>`;
    }).join('');
  }
  showBottomSheetGeneric(html);
}

function quickOpenChatById(userId,username){
  if(!userId) return;
  const c=convos.find(x=>x.partnerUser?.id===userId);
  if(c) openConvo(c.id,userId,username,c.partnerUser?.email||'');
  document.getElementById('generic-sheet')?.classList.remove('open');
}

function showBottomSheetGeneric(html){
  let modal=document.getElementById('generic-sheet');
  if(!modal){
    modal=document.createElement('div');
    modal.id='generic-sheet'; modal.className='modal-overlay';
    modal.onclick=e=>{ if(e.target===modal) modal.classList.remove('open'); };
    modal.innerHTML=`<div class="bottom-sheet" style="max-height:85dvh;overflow-y:auto;"><div class="sheet-handle"></div><div id="generic-sheet-body"></div></div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('generic-sheet-body').innerHTML=html;
  modal.classList.add('open');
}
