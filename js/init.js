// XREZZKY Chat — init.js
// Entry point utama — bootstrap app

// ════════════════════════════════
//  BOOTSTRAP
// ════════════════════════════════
(async () => {
  // 1. Tampilkan splash
  const splashStatus = document.getElementById('splash-status');
  if (splashStatus) splashStatus.innerText = 'Memuat...';

  // 2. Fetch config dari API
  const ok = await fetchConfig();

  if (!ok) {
    const splash = document.getElementById('screen-splash');
    if (splash) splash.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:40px;text-align:center;">
        <i class="fa fa-triangle-exclamation" style="font-size:40px;color:#ef4444;"></i>
        <div style="font-size:16px;font-weight:700;color:#f1f5f9;">Gagal memuat konfigurasi</div>
        <div style="font-size:12px;color:#64748b;">Cek koneksi internet kamu</div>
        <button onclick="location.reload()" style="padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:700;">Coba Lagi</button>
      </div>`;
    return;
  }

  // 3. Config ready → jalankan auth
  initAuth();

  // Hard timeout 10 detik
  setTimeout(() => {
    if (document.getElementById('screen-splash')) showScreen('screen-auth');
  }, 10000);
})();

// ════════════════════════════════
//  INIT APP (dipanggil setelah login)
// ════════════════════════════════
function initApp() {
  initEmojiGrid();
  loadConvos();
  loadFollowMap();
  loadBlockSet();
  loadPeopleList();
  initPresenceTracking();
  initPushNotifications();
  subscribeConvos();
  subscribeFollows();
  subscribeIncomingCalls();
  startRealtimeClock();
  checkExpiredMedia();
  myRole = MY_PROFILE?.role || 'user';
  document.addEventListener('click', e => {
    const ctx = document.getElementById('ctx-menu');
    if (ctx && !ctx.contains(e.target)) hideCtxMenu();
  });
}

// ════════════════════════════════
//  SWITCH SIDEBAR TAB
// ════════════════════════════════
function switchSidebarTab(tab) {
  ['messages','people','groups'].forEach(t => {
    document.getElementById('tab-'+t)?.classList.toggle('active', t===tab);
    document.getElementById('panel-'+t)?.classList.toggle('active', t===tab);
  });
  const sw = document.getElementById('search-wrap-msgs');
  if (sw) sw.style.display = tab==='messages' ? '' : 'none';
  if (tab==='people') {
    const isEmpty = !allUsers.length || document.querySelector('#people-list .convo-empty');
    if (isEmpty) loadPeopleList();
  }
  if (tab==='groups') loadGroups();
}

// ════════════════════════════════
//  ADMIN PANEL
// ════════════════════════════════
function goToAdminPanel() {
  window.open(window.location.origin + '/admin.html', '_blank');
}
