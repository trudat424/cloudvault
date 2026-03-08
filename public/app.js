/* ═══════════════════════════════════════════
   CloudVault — Application Logic
   ═══════════════════════════════════════════ */

// ────────────────────────────
// API HELPER
// ────────────────────────────
const API = {
  _getHeaders(extra = {}) {
    const headers = { ...extra };
    if (state.currentUser) headers['X-Account-Id'] = state.currentUser.id;
    return headers;
  },
  async get(path) {
    const res = await fetch(`/api${path}`, { headers: this._getHeaders() });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: this._getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async postForm(path, formData) {
    const res = await fetch(`/api${path}`, { method: 'POST', headers: this._getHeaders(), body: formData });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async del(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'DELETE',
      headers: this._getHeaders({ 'Content-Type': 'application/json' }),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

// ────────────────────────────
// APP STATE
// ────────────────────────────
const state = {
  currentUser: null, // { id, name, username, email }
  connectedAccounts: [],
  gdriveConnected: false,
  gdriveEmail: '',
  gdriveName: '',
  gdriveAccessToken: '',
  media: [],
  selectedMedia: new Set(),
  currentView: 'dashboard',
  lightboxIndex: -1,
  lightboxItems: [],
  transferHistory: [],
  adminLoggedIn: false,
  driveQuota: null, // { limitGB, usageGB, percentUsed }
  lastKnownLimitGB: null, // for detecting upgrades
};

function getVisibleMedia() {
  return state.media;
}

// ────────────────────────────
// DOM REFERENCES
// ────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ────────────────────────────
// THEME TOGGLE
// ────────────────────────────
function initThemeToggle() {
  const saved = localStorage.getItem('cloudvault-theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    updateThemeUI(true);
  }

  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('cloudvault-theme', 'light');
        updateThemeUI(false);
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('cloudvault-theme', 'dark');
        updateThemeUI(true);
      }
    });
  }
}

function updateThemeUI(isDark) {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon) {
    icon.innerHTML = isDark
      ? '<circle cx="10" cy="10" r="5"/><path d="M10 1v2m0 14v2m-7-9H1m18 0h-2m-1.343-5.657L14.243 5.757m-8.486 8.486L4.343 15.657m11.314 0l-1.414-1.414M5.757 5.757L4.343 4.343"/>'
      : '<path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>';
    icon.setAttribute('fill', isDark ? 'none' : 'currentColor');
    if (isDark) {
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.5');
    } else {
      icon.removeAttribute('stroke');
      icon.removeAttribute('stroke-width');
    }
  }
  if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

// ────────────────────────────
// AUTH: SIGNUP / LOGIN
// ────────────────────────────
function initAuth() {
  const signupForm = $('#signupForm');
  const loginForm = $('#loginForm');
  const switchBtn = $('#authSwitch');
  let showingLogin = false;

  switchBtn.addEventListener('click', () => {
    showingLogin = !showingLogin;
    signupForm.style.display = showingLogin ? 'none' : '';
    loginForm.style.display = showingLogin ? '' : 'none';
    switchBtn.innerHTML = showingLogin
      ? 'New here? <strong>Create account</strong>'
      : 'Already have an account? <strong>Log in</strong>';
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#signupUsername').value.trim();
    const password = $('#signupPassword').value.trim();
    const name = $('#signupName').value.trim();
    const errorEl = $('#signupError');

    if (!username || !password) {
      errorEl.textContent = 'Username and password are required.';
      errorEl.style.display = '';
      return;
    }

    try {
      errorEl.style.display = 'none';
      const account = await API.post('/accounts/signup', { username, password, name: name || username });
      state.currentUser = account;
      localStorage.setItem('cloudvault-user', JSON.stringify(account));
      showApp();
      showToast(`Welcome to CloudVault, ${account.name}!`, 'success');
    } catch (err) {
      let msg = 'Signup failed';
      try { msg = JSON.parse(err.message).error; } catch(_) { msg = err.message; }
      errorEl.textContent = msg;
      errorEl.style.display = '';
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value.trim();
    const rememberMe = $('#rememberMe').checked;
    const errorEl = $('#loginError');

    if (!username || !password) {
      errorEl.textContent = 'Username and password are required.';
      errorEl.style.display = '';
      return;
    }

    try {
      errorEl.style.display = 'none';
      const account = await API.post('/accounts/login', { username, password });
      state.currentUser = account;
      if (rememberMe) {
        localStorage.setItem('cloudvault-user', JSON.stringify(account));
      } else {
        sessionStorage.setItem('cloudvault-user', JSON.stringify(account));
        localStorage.removeItem('cloudvault-user');
      }
      showApp();
      showToast(`Welcome back, ${account.name}!`, 'success');
    } catch (err) {
      let msg = 'Invalid username or password';
      try { msg = JSON.parse(err.message).error; } catch(_) {}
      errorEl.textContent = msg;
      errorEl.style.display = '';
    }
  });
}

function checkSavedSession() {
  const saved = localStorage.getItem('cloudvault-user') || sessionStorage.getItem('cloudvault-user');
  if (saved) {
    try {
      state.currentUser = JSON.parse(saved);
      return true;
    } catch (_) {}
  }
  return false;
}

function logout() {
  state.currentUser = null;
  localStorage.removeItem('cloudvault-user');
  sessionStorage.removeItem('cloudvault-user');
  $('#authGate').style.display = '';
  $('#sidebar').style.display = '';
  $('#mainContent').style.display = '';
  $('#fabContainer').style.display = '';
  $('#mobileNav').style.display = '';
  // Reset visibility
  document.querySelectorAll('.sidebar, .main-content, .fab-container, .mobile-nav').forEach(el => {
    el.style.display = 'none';
  });
  $('#authGate').style.display = '';
  showToast('Logged out', 'info');
}

function showApp() {
  $('#authGate').style.display = 'none';
  $('#sidebar').style.display = '';
  $('#mainContent').style.display = '';
  $('#fabContainer').style.display = '';
  $('#mobileNav').style.display = '';

  // Update sidebar user info
  if (state.currentUser) {
    const avatar = state.currentUser.name.split(' ').map(w => w[0]).join('').toUpperCase();
    $('#sidebarUserAvatar').textContent = avatar;
    $('#sidebarUserName').textContent = state.currentUser.name;
  }

  // Role-based UI
  const role = state.currentUser.role || 'viewer';
  const fabContainer = document.getElementById('fabContainer');
  if (fabContainer) {
    fabContainer.style.display = role === 'viewer' ? 'none' : '';
  }

  loadAppData();
}

async function loadAppData() {
  try {
    await refreshAccounts();
    await refreshMedia();

    const gdrive = await API.get('/gdrive/status');
    state.gdriveConnected = gdrive.connected;
    if (gdrive.connected && gdrive.needsReauth) {
      // Scope changed — prompt user instead of silently redirecting (avoids redirect loop)
      showToast('Google Drive permissions need updating. Please reconnect.', 'warning');
    }
    if (gdrive.connected) {
      state.gdriveEmail = gdrive.email || '';
      state.gdriveName = gdrive.name || '';
      state.gdriveAccessToken = gdrive.accessToken || '';
      // Update sidebar button to show connected state
      $('#connectGDriveBtn span').textContent = 'Browse Google Drive';

      // Fetch real Drive quota
      await fetchDriveQuota();
    }

    // Smart onboarding step detection
    const hasMedia = getVisibleMedia().length > 0;
    if (hasMedia) {
      // Has media — hide onboarding, show media grid
      $('#onboarding').style.display = 'none';
      $('#dashboardMedia').style.display = '';
      renderAllMedia();
    } else if (!state.gdriveConnected) {
      // No media, Drive not connected — show Step 1
      $('#onboarding').style.display = '';
      $('#dashboardMedia').style.display = 'none';
      showOnboardingStep(1);
    } else {
      // Drive connected but no media — show Step 2
      $('#onboarding').style.display = '';
      $('#dashboardMedia').style.display = 'none';
      showOnboardingStep(2);
    }
  } catch (err) {
    console.error('Failed to load data:', err);
  }

  updateDashboard();
}

// ────────────────────────────
// INIT
// ────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initThemeToggle();
  initAuth();

  // Check for share link first
  const urlParams = new URLSearchParams(window.location.search);
  const shareToken = urlParams.get('share');
  if (shareToken) {
    showSharePublicView(shareToken);
    return;
  }

  // Check for saved session
  if (checkSavedSession()) {
    showApp();
  } else {
    // Show auth gate, hide everything else
    $('#authGate').style.display = '';
    $('#sidebar').style.display = 'none';
    $('#mainContent').style.display = 'none';
    $('#fabContainer').style.display = 'none';
    $('#mobileNav').style.display = 'none';
  }

  initNavigation();
  initModals();
  initFabUpload();
  initDriveBrowser();
  initFilters();
  initLightbox();
  initDownloads();
  initSearch();
  initSidebarToggle();
  initAdmin();
  initStorageUpgrade();
  initOnboarding();

  // Check for Google Drive OAuth callback
  const gdriveParam = urlParams.get('gdrive');
  if (gdriveParam === 'connected') {
    showToast('Google Drive connected successfully', 'success');
    window.history.replaceState({}, '', '/');
    // loadAppData() will detect Drive connected + no media → show Step 2 automatically
  } else if (gdriveParam === 'error') {
    const reason = urlParams.get('reason') || 'Unknown error';
    showToast('Google Drive connection failed: ' + reason, 'error');
    window.history.replaceState({}, '', '/');
  }

  // Sidebar logout
  $('#sidebarLogout').addEventListener('click', logout);
});

async function refreshMedia() {
  try {
    state.media = await API.get('/media');
  } catch (err) {
    console.error('Failed to load media:', err);
  }
}

async function refreshAccounts() {
  try {
    state.connectedAccounts = await API.get('/accounts');
  } catch (err) {
    console.error('Failed to load accounts:', err);
  }
}

// ────────────────────────────
// NAVIGATION
// ────────────────────────────
function initNavigation() {
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      switchView(view);
    });
  });
}

function switchView(view) {
  state.currentView = view;

  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  const navItem = $(`.nav-item[data-view="${view}"]`);
  if (navItem) navItem.classList.add('active');

  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view${capitalize(view)}`).classList.add('active');

  if (view === 'dashboard') renderAllMedia();
  if (view === 'sharing') renderSharingView();
  if (view === 'downloads') renderTransferHistory();
  if (view === 'admin' && state.adminLoggedIn) {
    renderAdminPanel();
    loadAdminUsers();
    loadAdminAccess();
  }

  // Close sidebar on mobile
  $('#sidebar').classList.remove('open');
  $('#sidebarBackdrop').classList.remove('active');

  // Sync mobile nav
  $$('.mobile-nav-item').forEach((a) => a.classList.remove('active'));
  const mobileItem = $(`.mobile-nav-item[data-view="${view}"]`);
  if (mobileItem) mobileItem.classList.add('active');
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ────────────────────────────
// SIDEBAR TOGGLE (mobile)
// ────────────────────────────
function initSidebarToggle() {
  $('#sidebarToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
    $('#sidebarBackdrop').classList.toggle('active');
  });

  $('#sidebarBackdrop').addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#sidebarBackdrop').classList.remove('active');
  });

  $$('.mobile-nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      if (view) switchView(view);
    });
  });
}

// ────────────────────────────
// MODALS
// ────────────────────────────
function initModals() {
  // Sidebar "Connect Google Drive" button — connect or open browser
  $('#connectGDriveBtn').addEventListener('click', () => {
    if (state.gdriveConnected) {
      openDriveBrowser();
    } else {
      window.location.href = '/api/gdrive/auth?accountId=' + state.currentUser.id;
    }
  });
}

function openModal(id) {
  $(`#${id}`).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  $(`#${id}`).classList.remove('active');
  document.body.style.overflow = '';
}

// ────────────────────────────
// FAB UPLOAD MENU (expandable)
// ────────────────────────────
function initFabUpload() {
  const fab = $('#fabUpload');
  const container = $('#fabContainer');
  const backdrop = $('#fabBackdrop');
  const fileInput = $('#fabFileInput');

  function toggleFab() {
    if (!state.currentUser) {
      showToast('Please log in first', 'error');
      return;
    }
    container.classList.toggle('open');
  }

  function closeFab() {
    container.classList.remove('open');
  }

  fab.addEventListener('click', toggleFab);
  backdrop.addEventListener('click', closeFab);

  // "From Device" option — upload directly to S3
  $('#fabDevice').addEventListener('click', () => {
    closeFab();
    fileInput.click();
  });

  // "Google Drive" option — open browser or connect
  $('#fabGDrive').addEventListener('click', () => {
    closeFab();
    openDriveBrowser();
  });

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    e.target.value = ''; // allow re-selecting
    startUpload(state.currentUser.id, files);
  });
}

// ────────────────────────────
// FILE UPLOAD
// ────────────────────────────
async function startUpload(accountId, files) {
  if (!files || files.length === 0) {
    showToast('No files selected', 'error');
    return;
  }

  const syncBar = $('#syncProgress');
  const fill = $('#progressFill');
  const label = $('#syncLabel');
  const percent = $('#syncPercent');

  syncBar.classList.add('active');
  label.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`;
  fill.style.width = '0%';
  percent.textContent = '0%';

  const BATCH_SIZE = 5;
  let uploaded = 0;
  let totalUploaded = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const formData = new FormData();
    formData.append('account_id', accountId);
    batch.forEach((f) => formData.append('files', f));

    try {
      const result = await API.postForm('/media/upload', formData);
      totalUploaded += result.count;
    } catch (err) {
      showToast(`Upload error: ${err.message}`, 'error');
    }

    uploaded += batch.length;
    const pct = Math.round((uploaded / files.length) * 100);
    fill.style.width = pct + '%';
    percent.textContent = pct + '%';
    label.textContent = `Uploading... ${uploaded}/${files.length}`;
  }

  syncBar.classList.remove('active');
  fill.style.width = '0%';

  await refreshMedia();
  updateDashboard();

  // Refresh Drive quota after upload
  if (state.gdriveConnected) fetchDriveQuota();

  if (totalUploaded > 0) {
    showToast(`Uploaded ${totalUploaded} file${totalUploaded > 1 ? 's' : ''}`, 'success');
    $('#onboarding').style.display = 'none';
    $('#dashboardMedia').style.display = '';
    renderAllMedia();
  }
}

// ────────────────────────────
// GOOGLE DRIVE BROWSER
// ────────────────────────────
let driveNextPageToken = null;
let driveSelectedFiles = {};   // { fileId: { id, name, mimeType } }
let driveSearchTimeout = null;

async function openDriveBrowser() {
  if (!state.gdriveConnected) {
    window.location.href = '/api/gdrive/auth?accountId=' + state.currentUser.id;
    return;
  }

  const browser = $('#driveBrowser');
  browser.style.display = '';
  document.body.style.overflow = 'hidden';

  driveSelectedFiles = {};
  driveNextPageToken = null;
  $('#driveFileGrid').innerHTML = '';
  $('#driveSearchInput').value = '';
  updateDriveSelectionUI();

  await loadDriveFiles();
}

function closeDriveBrowser() {
  $('#driveBrowser').style.display = 'none';
  document.body.style.overflow = '';
}

async function loadDriveFiles(append = false) {
  const loading = $('#driveLoading');
  const grid = $('#driveFileGrid');
  const empty = $('#driveEmpty');
  const loadMore = $('#driveLoadMore');

  if (!append) {
    loading.style.display = '';
    grid.innerHTML = '';
    empty.style.display = 'none';
    loadMore.style.display = 'none';
  } else {
    loadMore.textContent = 'Loading...';
    loadMore.disabled = true;
  }

  try {
    let url = '/gdrive/files?';
    const search = $('#driveSearchInput').value.trim();
    if (search) url += `q=${encodeURIComponent(search)}&`;
    if (append && driveNextPageToken) url += `pageToken=${encodeURIComponent(driveNextPageToken)}&`;

    const data = await API.get(url.slice(0, -1));
    driveNextPageToken = data.nextPageToken;

    loading.style.display = 'none';

    if (data.files.length === 0 && !append) {
      empty.style.display = '';
      return;
    }

    data.files.forEach(file => {
      const thumb = file.thumbnailLink || '';
      const isSelected = !!driveSelectedFiles[file.id];

      const item = document.createElement('div');
      item.className = 'drive-file-item' + (isSelected ? ' selected' : '');
      item.dataset.fileId = file.id;
      item.innerHTML = `
        <div class="drive-file-thumb">
          ${thumb ? `<img src="${thumb}" alt="" loading="lazy" />` : `<div class="drive-file-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </div>`}
          <div class="drive-file-check">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
          </div>
        </div>
        <span class="drive-file-name">${file.name}</span>
      `;

      item.addEventListener('click', () => {
        if (driveSelectedFiles[file.id]) {
          delete driveSelectedFiles[file.id];
          item.classList.remove('selected');
        } else {
          driveSelectedFiles[file.id] = { id: file.id, name: file.name, mimeType: file.mimeType };
          item.classList.add('selected');
        }
        updateDriveSelectionUI();
      });

      grid.appendChild(item);
    });

    loadMore.style.display = driveNextPageToken ? '' : 'none';
    loadMore.textContent = 'Load More';
    loadMore.disabled = false;
  } catch (err) {
    loading.style.display = 'none';
    showToast('Failed to load Drive files: ' + err.message, 'error');
  }
}

function updateDriveSelectionUI() {
  const count = Object.keys(driveSelectedFiles).length;
  const footer = $('#driveBrowserFooter');
  footer.style.display = count > 0 ? '' : 'none';
  $('#driveSelectionCount').textContent = `${count} selected`;
}

function initDriveBrowser() {
  $('#driveBrowserClose').addEventListener('click', closeDriveBrowser);

  $('#driveLoadMore').addEventListener('click', () => loadDriveFiles(true));

  // Search with debounce
  $('#driveSearchInput').addEventListener('input', () => {
    clearTimeout(driveSearchTimeout);
    driveSearchTimeout = setTimeout(() => {
      driveNextPageToken = null;
      loadDriveFiles();
    }, 400);
  });

  // Import button
  $('#driveImportBtn').addEventListener('click', () => {
    const files = Object.values(driveSelectedFiles);
    if (files.length === 0) return;
    closeDriveBrowser();
    importDriveFiles(files);
  });
}

async function importDriveFiles(selectedFiles) {
  if (selectedFiles.length === 0) return;

  openModal('transferModal');
  const fill = $('#transferProgressFill');
  const countEl = $('#transferCount');
  const statusEl = $('#transferStatus');
  const titleEl = $('#transferTitle');

  titleEl.textContent = 'Importing from Google Drive...';
  fill.style.width = '0%';
  countEl.textContent = `0 / ${selectedFiles.length} files`;
  statusEl.textContent = 'Starting import...';

  try {
    const response = await fetch('/api/gdrive/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Id': state.currentUser.id,
      },
      body: JSON.stringify({ files: selectedFiles }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const eventData = JSON.parse(line.slice(6));
            if (eventType === 'progress' && eventData.status === 'importing') {
              const pct = eventData.total > 0 ? Math.round((eventData.current / eventData.total) * 100) : 0;
              fill.style.width = pct + '%';
              countEl.textContent = `${eventData.current} / ${eventData.total} files`;
              statusEl.textContent = eventData.fileName ? `Importing: ${eventData.fileName}` : eventData.message;
            } else if (eventType === 'done') {
              fill.style.width = '100%';
              statusEl.textContent = 'Complete!';
              countEl.textContent = `${eventData.imported} imported`;
              setTimeout(async () => {
                closeModal('transferModal');
                if (eventData.imported > 0) {
                  showToast(`Imported ${eventData.imported} files from Google Drive`, 'success');
                  await refreshMedia();
                  updateDashboard();
                  if (getVisibleMedia().length > 0) {
                    $('#onboarding').style.display = 'none';
                    $('#dashboardMedia').style.display = '';
                    renderAllMedia();
                  }
                }
              }, 1200);
            } else if (eventType === 'error') {
              closeModal('transferModal');
              showToast('Import failed: ' + eventData.message, 'error');
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    closeModal('transferModal');
    showToast('Import connection lost. Please try again.', 'error');
  }
}

async function handleGDriveDisconnect() {
  try {
    await API.del('/gdrive/disconnect');
    state.gdriveConnected = false;
    state.gdriveEmail = '';
    state.gdriveName = '';
    // Update sidebar button text
    $('#connectGDriveBtn span').textContent = 'Connect Google Drive';
    showToast('Google Drive disconnected', 'info');
  } catch (err) {
    showToast('Failed to disconnect: ' + err.message, 'error');
  }
}

// ────────────────────────────
// DRIVE QUOTA & STORAGE
// ────────────────────────────
async function fetchDriveQuota() {
  try {
    const quota = await API.get('/gdrive/quota');
    const prevLimit = state.driveQuota ? state.driveQuota.limitGB : null;
    state.driveQuota = quota;

    // Detect upgrade: limit increased since last check
    if (prevLimit !== null && quota.limitGB > prevLimit) {
      const newLabel = formatStorageSize(quota.limitGB);
      showToast(`Storage upgraded to ${newLabel}!`, 'success');
    }

    // Save last known limit for cross-session detection
    const savedLimit = parseFloat(localStorage.getItem('cloudvault-drive-limit') || '0');
    if (savedLimit > 0 && quota.limitGB > savedLimit) {
      const newLabel = formatStorageSize(quota.limitGB);
      showToast(`Storage upgraded to ${newLabel}!`, 'success');
    }
    localStorage.setItem('cloudvault-drive-limit', String(quota.limitGB));

    updateStorageUI();
    return quota;
  } catch (e) {
    console.error('Failed to fetch Drive quota:', e);
    return null;
  }
}

function formatStorageSize(gb) {
  if (gb < 0) return 'Unlimited';
  if (gb >= 1000) return (gb / 1000).toFixed(gb % 1000 === 0 ? 0 : 1) + ' TB';
  if (gb >= 100) return Math.round(gb) + ' GB';
  return gb.toFixed(1) + ' GB';
}

function updateStorageUI() {
  const indicator = $('#storageIndicator');
  const upgradeBtn = $('#storageUpgradeBtn');

  if (state.driveQuota && state.driveQuota.limitGB > 0) {
    const q = state.driveQuota;
    const usageLabel = formatStorageSize(q.usageGB);
    const limitLabel = formatStorageSize(q.limitGB);
    const pct = Math.min(q.percentUsed, 100);

    $('#storageFill').style.width = pct + '%';
    $('#storageText').textContent = `${usageLabel} / ${limitLabel}`;

    // Warn when >80% full
    if (pct >= 80) {
      indicator.classList.add('warning');
      upgradeBtn.style.display = '';
    } else {
      indicator.classList.remove('warning');
      upgradeBtn.style.display = '';
    }
  } else if (state.driveQuota && state.driveQuota.limitGB < 0) {
    // Unlimited (e.g. Google Workspace)
    const usageLabel = formatStorageSize(state.driveQuota.usageGB);
    $('#storageFill').style.width = '0%';
    $('#storageText').textContent = `${usageLabel} / Unlimited`;
    indicator.classList.remove('warning');
    upgradeBtn.style.display = 'none';
  } else {
    // Not connected — show app-level storage
    const visible = getVisibleMedia();
    const totalGB = (visible.reduce((sum, m) => sum + m.sizeMB, 0) / 1024).toFixed(1);
    $('#storageFill').style.width = '0%';
    $('#storageText').textContent = `${totalGB} GB / 15 GB`;
    upgradeBtn.style.display = 'none';
  }
}

function openUpgradeModal() {
  const modal = $('#upgradeModal');
  modal.classList.add('active');

  if (state.driveQuota) {
    const q = state.driveQuota;
    const pct = Math.min(q.percentUsed, 100);
    const usageLabel = formatStorageSize(q.usageGB);
    const limitLabel = formatStorageSize(q.limitGB);
    $('#upgradeBarFill').style.width = pct + '%';
    if (pct >= 80) $('#upgradeBarFill').classList.add('danger');
    else $('#upgradeBarFill').classList.remove('danger');
    $('#upgradeUsageText').textContent = `${usageLabel} of ${limitLabel} used (${pct.toFixed(0)}%)`;

    // Highlight current plan
    const plans = modal.querySelectorAll('.upgrade-plan');
    plans.forEach(p => p.classList.remove('active'));

    const limitGB = q.limitGB;
    if (limitGB <= 15) plans[0].classList.add('active');
    else if (limitGB <= 100) plans[1].classList.add('active');
    else if (limitGB <= 200) plans[2].classList.add('active');
    else plans[3].classList.add('active');
  }
}

async function checkForUpgrade() {
  const btn = $('#checkUpgradeBtn');
  btn.textContent = 'Checking...';
  btn.classList.add('checking');

  const prevLimit = state.driveQuota ? state.driveQuota.limitGB : 0;
  const quota = await fetchDriveQuota();

  btn.classList.remove('checking');

  if (quota && quota.limitGB > prevLimit) {
    btn.textContent = 'Upgrade detected!';
    const newLabel = formatStorageSize(quota.limitGB);
    showToast(`Storage upgraded to ${newLabel}!`, 'success');

    // Update plan badges
    openUpgradeModal(); // refresh display

    // Auto close modal after brief delay
    setTimeout(() => {
      $('#upgradeModal').classList.remove('active');
    }, 2000);
  } else {
    btn.textContent = 'No changes detected — try again in a minute';
    setTimeout(() => {
      btn.textContent = "I've upgraded — check now";
    }, 3000);
  }
}

// ────────────────────────────
// ONBOARDING (3-step guided flow)
// ────────────────────────────
function showOnboardingStep(step) {
  const step1 = $('#onboardingStep1');
  const step2 = $('#onboardingStep2');
  const step3 = $('#onboardingStep3');
  if (step1) step1.style.display = step === 1 ? '' : 'none';
  if (step2) step2.style.display = step === 2 ? '' : 'none';
  if (step3) step3.style.display = step === 3 ? '' : 'none';
}

function initOnboarding() {
  // Step 1: Connect Google Drive
  const connectBtn = $('#onboardingConnectBtn');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      if (!state.currentUser) {
        showToast('Please log in first', 'error');
        return;
      }
      window.location.href = '/api/gdrive/auth?accountId=' + state.currentUser.id;
    });
  }

  // Step 2: Import prompt
  const importYes = $('#onboardingImportYes');
  if (importYes) {
    importYes.addEventListener('click', () => {
      showOnboardingStep(3);
      startImportAll();
    });
  }

  const importNo = $('#onboardingImportNo');
  if (importNo) {
    importNo.addEventListener('click', () => {
      // Skip import — hide onboarding, show empty dashboard
      $('#onboarding').style.display = 'none';
      $('#dashboardMedia').style.display = '';
      showToast('You can import files anytime using the + button or Drive browser', 'info');
    });
  }
}

async function startImportAll() {
  const titleEl = $('#onboardingProgressTitle');
  const statusEl = $('#onboardingProgressStatus');
  const fill = $('#onboardingProgressFill');
  const countEl = $('#onboardingProgressCount');
  const spinner = $('#onboardingSpinner');

  titleEl.textContent = 'Importing Your Content...';
  statusEl.textContent = 'Scanning your Google Drive...';
  fill.style.width = '0%';
  countEl.textContent = '';

  try {
    const response = await fetch('/api/gdrive/import-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Id': state.currentUser.id,
      },
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const eventData = JSON.parse(line.slice(6));
            if (eventType === 'progress') {
              if (eventData.phase === 'scanning') {
                statusEl.textContent = eventData.message || 'Scanning your Google Drive...';
                countEl.textContent = eventData.found ? `${eventData.found} files found` : '';
              } else if (eventData.phase === 'importing') {
                const pct = eventData.total > 0 ? Math.round((eventData.current / eventData.total) * 100) : 0;
                fill.style.width = pct + '%';
                statusEl.textContent = eventData.fileName ? `Importing: ${eventData.fileName}` : 'Importing...';
                countEl.textContent = `${eventData.current} / ${eventData.total} files`;
              }
            } else if (eventType === 'done') {
              fill.style.width = '100%';
              titleEl.textContent = 'Import Complete!';
              statusEl.textContent = `Successfully imported ${eventData.imported} files`;
              countEl.textContent = eventData.skipped > 0 ? `(${eventData.skipped} already existed)` : '';
              if (spinner) spinner.style.display = 'none';

              // After a brief pause, transition to media grid
              setTimeout(async () => {
                await refreshMedia();
                updateDashboard();
                if (getVisibleMedia().length > 0) {
                  $('#onboarding').style.display = 'none';
                  $('#dashboardMedia').style.display = '';
                  renderAllMedia();
                  showToast(`Imported ${eventData.imported} files from Google Drive`, 'success');
                }
              }, 1500);
            } else if (eventType === 'error') {
              titleEl.textContent = 'Import Failed';
              statusEl.textContent = eventData.message || 'An error occurred';
              if (spinner) spinner.style.display = 'none';
              showToast('Import failed: ' + (eventData.message || 'Unknown error'), 'error');
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    titleEl.textContent = 'Import Failed';
    statusEl.textContent = 'Connection lost. Please try again.';
    if (spinner) spinner.style.display = 'none';
    showToast('Import connection lost. Please try again.', 'error');
  }
}

// ────────────────────────────
// DASHBOARD
// ────────────────────────────
async function updateDashboard() {
  const visible = getVisibleMedia();
  const photos = visible.filter((m) => m.type === 'photo');
  const videos = visible.filter((m) => m.type === 'video');
  const totalGB = (visible.reduce((sum, m) => sum + m.sizeMB, 0) / 1024).toFixed(1);

  $('#totalPhotos').textContent = photos.length;
  $('#totalVideos').textContent = videos.length;
  $('#totalStorage').textContent = totalGB + ' GB';

  updateStorageUI();
}

function initStorageUpgrade() {
  // Upgrade button in sidebar
  $('#storageUpgradeBtn').addEventListener('click', (e) => {
    e.preventDefault();
    openUpgradeModal();
  });

  // "I've upgraded — check now" button
  $('#checkUpgradeBtn').addEventListener('click', checkForUpgrade);

  // Also allow clicking the storage indicator itself when in warning state
  $('#storageIndicator').addEventListener('click', (e) => {
    if (e.target.closest('.storage-upgrade-btn')) return; // handled above
    if ($('#storageIndicator').classList.contains('warning')) {
      openUpgradeModal();
    }
  });

  // Periodically re-check quota every 5 minutes (to detect upgrades)
  setInterval(async () => {
    if (state.gdriveConnected) {
      await fetchDriveQuota();
    }
  }, 5 * 60 * 1000);
}

// ────────────────────────────
// MEDIA CARDS
// ────────────────────────────
function createMediaCard(item, selectable = false) {
  const dateStr = new Date(item.date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const selected = state.selectedMedia.has(item.id) ? ' selected' : '';
  const thumbContent = item.thumbnail
    ? `<img class="thumb" src="${item.thumbnail}" alt="${item.name}" loading="lazy" />`
    : `<div class="thumb video-thumb-placeholder"><svg viewBox="0 0 48 48" fill="none" width="48" height="48"><circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/><path d="M20 16l12 8-12 8z" fill="currentColor" opacity="0.4"/></svg></div>`;

  return `
    <div class="media-card${selected}" data-id="${item.id}" data-type="${item.type}">
      ${thumbContent}
      ${item.type === 'video' ? `<div class="video-badge"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg></div>` : ''}
      <div class="select-check"></div>
      <div class="card-overlay">
        <span class="card-name">${item.name}</span>
        <span class="card-meta">${dateStr} &middot; ${item.sizeMB} MB</span>
      </div>
    </div>
  `;
}

function attachMediaCardEvents(container) {
  container.querySelectorAll('.media-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const id = card.dataset.id;
      if (container.classList.contains('selectable') && (e.target.closest('.select-check') || e.ctrlKey || e.metaKey)) {
        toggleSelect(id, card);
        return;
      }
      const items = Array.from(container.querySelectorAll('.media-card')).map((c) => c.dataset.id);
      openLightbox(id, items);
    });
  });
}

function toggleSelect(id, card) {
  if (state.selectedMedia.has(id)) {
    state.selectedMedia.delete(id);
    card.classList.remove('selected');
  } else {
    state.selectedMedia.add(id);
    card.classList.add('selected');
  }
}

// ────────────────────────────
// MEDIA FILTERS
// ────────────────────────────
function initFilters() {
  ['filterType', 'filterDate', 'filterSort'].forEach((id) => {
    $(`#${id}`).addEventListener('change', renderAllMedia);
  });
}

function getFilteredMedia() {
  let items = [...getVisibleMedia()];
  const type = $('#filterType').value;
  const date = $('#filterDate').value;
  const sort = $('#filterSort').value;

  if (type !== 'all') items = items.filter((m) => m.type === type);
  if (date !== 'all') {
    const now = Date.now();
    const day = 86400000;
    const cutoffs = { today: day, week: day * 7, month: day * 30, year: day * 365 };
    items = items.filter((m) => now - m.timestamp < cutoffs[date]);
  }
  switch (sort) {
    case 'newest': items.sort((a, b) => b.timestamp - a.timestamp); break;
    case 'oldest': items.sort((a, b) => a.timestamp - b.timestamp); break;
    case 'largest': items.sort((a, b) => b.sizeMB - a.sizeMB); break;
    case 'smallest': items.sort((a, b) => a.sizeMB - b.sizeMB); break;
    case 'name': items.sort((a, b) => a.name.localeCompare(b.name)); break;
  }
  return items;
}

function renderAllMedia() {
  const grid = $('#allMediaGrid');
  if (getVisibleMedia().length === 0) {
    grid.innerHTML = '';
    return;
  }
  const items = getFilteredMedia();
  grid.innerHTML = items.map((item) => createMediaCard(item)).join('');
  attachMediaCardEvents(grid);
}

// ────────────────────────────
// SHARING VIEW
// ────────────────────────────
async function renderSharingView() {
  if (!state.currentUser) return;

  try {
    const shares = await API.get(`/share/my/${state.currentUser.id}`);
    renderShareLink(shares.links);
    renderSharedWith(shares.sharedWith);
    renderSharedWithMe(shares.sharedWithMe);
  } catch (err) {
    console.error('Failed to load shares:', err);
  }

  initShareUserSearch();
}

function renderShareLink(links) {
  const area = $('#shareLinkArea');
  if (links.length > 0) {
    const link = links[0];
    const url = `${window.location.origin}/?share=${link.token}`;
    area.innerHTML = `
      <div class="share-link-card">
        <div class="share-link-url">
          <input type="text" value="${url}" readonly id="shareLinkUrl" />
          <button class="share-copy-btn" id="copyShareLink">Copy</button>
        </div>
        <button class="share-revoke-btn" data-id="${link.id}">Revoke Link</button>
      </div>
    `;
    $('#copyShareLink').addEventListener('click', () => {
      const input = $('#shareLinkUrl');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        showToast('Link copied!', 'success');
      }).catch(() => {
        document.execCommand('copy');
        showToast('Link copied!', 'success');
      });
    });
    area.querySelector('.share-revoke-btn').addEventListener('click', async (e) => {
      try {
        await API.del(`/share/link/${e.target.dataset.id}`);
        showToast('Share link revoked', 'info');
        renderSharingView();
      } catch (err) {
        showToast('Failed to revoke link', 'error');
      }
    });
  } else {
    area.innerHTML = `
      <button class="cta-btn share-create-link-btn" id="createShareLink">Create Share Link</button>
    `;
    $('#createShareLink').addEventListener('click', async () => {
      try {
        await API.post('/share/link', { accountId: state.currentUser.id });
        showToast('Share link created!', 'success');
        renderSharingView();
      } catch (err) {
        showToast('Failed to create link', 'error');
      }
    });
  }
}

function renderSharedWith(sharedWith) {
  const list = $('#sharedWithList');
  if (sharedWith.length === 0) {
    list.innerHTML = '<div class="empty-state-small">Not sharing with anyone yet. Search for a user above.</div>';
    return;
  }
  list.innerHTML = sharedWith.map(s => `
    <div class="shared-user-chip">
      <div class="shared-user-avatar">${s.viewerName.charAt(0).toUpperCase()}</div>
      <div class="shared-user-info">
        <span class="shared-user-name">${s.viewerName}</span>
        <span class="shared-user-username">@${s.viewerUsername}</span>
      </div>
      <button class="share-remove-btn" data-id="${s.id}" title="Remove access">
        <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.share-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await API.del(`/share/user/${btn.dataset.id}`);
        showToast('Access removed', 'info');
        renderSharingView();
      } catch (err) {
        showToast('Failed to remove access', 'error');
      }
    });
  });
}

function renderSharedWithMe(sharedWithMe) {
  const list = $('#sharedWithMeList');
  if (sharedWithMe.length === 0) {
    list.innerHTML = '<div class="empty-state-small">No one has shared with you yet.</div>';
    return;
  }
  list.innerHTML = sharedWithMe.map(s => `
    <div class="shared-user-chip clickable" data-owner-id="${s.ownerAccountId}">
      <div class="shared-user-avatar">${s.ownerName.charAt(0).toUpperCase()}</div>
      <div class="shared-user-info">
        <span class="shared-user-name">${s.ownerName}</span>
        <span class="shared-user-username">@${s.ownerUsername}</span>
      </div>
      <span class="view-shared-arrow">
        <svg viewBox="0 0 20 20" fill="currentColor" width="16"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>
      </span>
    </div>
  `).join('');

  list.querySelectorAll('.shared-user-chip.clickable').forEach(chip => {
    chip.addEventListener('click', () => viewSharedMedia(chip.dataset.ownerId));
  });
}

async function viewSharedMedia(ownerId) {
  try {
    const media = await API.get(`/share/shared-media/${ownerId}?viewer=${state.currentUser.id}`);
    // Show in a simple lightbox-style grid overlay
    showSharedMediaOverlay(media);
  } catch (err) {
    showToast('Cannot view shared media', 'error');
  }
}

function showSharedMediaOverlay(mediaItems) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.style.alignItems = 'flex-start';
  overlay.style.paddingTop = '40px';

  let html = `
    <div class="shared-media-overlay-content">
      <div class="shared-media-overlay-header">
        <h3>Shared Media</h3>
        <button class="shared-media-close-btn">Close</button>
      </div>
      <div class="media-grid shared-media-grid">
  `;

  mediaItems.forEach(item => {
    const thumbContent = item.thumbnail
      ? `<img class="thumb" src="${item.thumbnail}" alt="${item.name}" loading="lazy" />`
      : `<div class="thumb video-thumb-placeholder"><svg viewBox="0 0 48 48" fill="none" width="48" height="48"><circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/><path d="M20 16l12 8-12 8z" fill="currentColor" opacity="0.4"/></svg></div>`;

    html += `
      <div class="media-card" data-id="${item.id}">
        ${thumbContent}
        <div class="card-overlay">
          <span class="card-name">${item.name}</span>
        </div>
      </div>
    `;
  });

  html += '</div></div>';
  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  overlay.querySelector('.shared-media-close-btn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Clicking a card opens the full image
  overlay.querySelectorAll('.media-card').forEach(card => {
    card.addEventListener('click', () => {
      const item = mediaItems.find(m => m.id === card.dataset.id);
      if (item) {
        window.open(item.original, '_blank');
      }
    });
  });
}

let _shareSearchTimer = null;
function initShareUserSearch() {
  const input = $('#shareUserSearch');
  const results = $('#shareUserResults');

  // Remove old listeners by cloning
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  newInput.addEventListener('input', () => {
    clearTimeout(_shareSearchTimer);
    const q = newInput.value.trim();
    if (q.length < 1) { results.innerHTML = ''; return; }

    _shareSearchTimer = setTimeout(async () => {
      try {
        const users = await API.get(`/accounts/search?q=${encodeURIComponent(q)}`);
        // Filter out self
        const filtered = users.filter(u => u.id !== state.currentUser.id);
        if (filtered.length === 0) {
          results.innerHTML = '<div class="share-no-results">No users found</div>';
          return;
        }
        results.innerHTML = filtered.map(u => `
          <div class="share-user-result" data-id="${u.id}" data-name="${u.name}">
            <span class="share-result-avatar">${u.name.charAt(0).toUpperCase()}</span>
            <span class="share-result-name">${u.name}</span>
            <span class="share-result-username">@${u.username}</span>
            <button class="share-add-btn">Share</button>
          </div>
        `).join('');

        results.querySelectorAll('.share-add-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const row = btn.closest('.share-user-result');
            try {
              await API.post('/share/user', {
                ownerAccountId: state.currentUser.id,
                viewerAccountId: row.dataset.id,
              });
              showToast(`Shared with ${row.dataset.name}`, 'success');
              results.innerHTML = '';
              newInput.value = '';
              renderSharingView();
            } catch (err) {
              showToast('Failed to share', 'error');
            }
          });
        });
      } catch (err) {
        results.innerHTML = '';
      }
    }, 300);
  });
}

// ────────────────────────────
// PUBLIC SHARE VIEW
// ────────────────────────────
async function showSharePublicView(token) {
  // Hide everything except the share view
  $('#authGate').style.display = 'none';
  $('#sidebar').style.display = 'none';
  $('#mainContent').style.display = 'none';
  $('#fabContainer').style.display = 'none';
  $('#mobileNav').style.display = 'none';
  $('#sharePublicView').style.display = '';

  try {
    const data = await API.get(`/share/link/view/${token}`);
    $('#shareOwnerName').textContent = `${data.ownerName}'s Media`;

    const grid = $('#shareMediaGrid');
    if (data.media.length === 0) {
      grid.innerHTML = '<div class="empty-state">No media shared yet.</div>';
      return;
    }

    grid.innerHTML = data.media.map(item => {
      const thumbContent = item.thumbnail
        ? `<img class="thumb" src="${item.thumbnail}" alt="${item.name}" loading="lazy" />`
        : `<div class="thumb video-thumb-placeholder"><svg viewBox="0 0 48 48" fill="none" width="48" height="48"><circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/><path d="M20 16l12 8-12 8z" fill="currentColor" opacity="0.4"/></svg></div>`;

      return `
        <div class="media-card" data-id="${item.id}" data-original="${item.original}">
          ${thumbContent}
          ${item.type === 'video' ? '<div class="video-badge"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg></div>' : ''}
          <div class="card-overlay">
            <span class="card-name">${item.name}</span>
          </div>
        </div>
      `;
    }).join('');

    // Click to view full size
    grid.querySelectorAll('.media-card').forEach(card => {
      card.addEventListener('click', () => {
        window.open(card.dataset.original, '_blank');
      });
    });
  } catch (err) {
    $('#shareOwnerName').textContent = 'Link Not Found';
    $('#shareMediaGrid').innerHTML = '<div class="empty-state">This share link is invalid or has been revoked.</div>';
  }
}

// ────────────────────────────
// LIGHTBOX
// ────────────────────────────
function initLightbox() {
  $('#lightboxClose').addEventListener('click', closeLightbox);
  $('#lightbox .lightbox-backdrop').addEventListener('click', closeLightbox);
  $('#lightboxPrev').addEventListener('click', () => navigateLightbox(-1));
  $('#lightboxNext').addEventListener('click', () => navigateLightbox(1));

  document.addEventListener('keydown', (e) => {
    if (!$('#lightbox').classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
  });
}

function openLightbox(mediaId, itemIds) {
  state.lightboxItems = itemIds;
  state.lightboxIndex = itemIds.indexOf(mediaId);
  $('#lightbox').classList.add('active');
  document.body.style.overflow = 'hidden';
  renderLightboxContent();
}

function closeLightbox() {
  $('#lightbox').classList.remove('active');
  document.body.style.overflow = '';
  const video = $('#lightboxMedia video');
  if (video) video.pause();
}

function navigateLightbox(dir) {
  state.lightboxIndex += dir;
  if (state.lightboxIndex < 0) state.lightboxIndex = state.lightboxItems.length - 1;
  if (state.lightboxIndex >= state.lightboxItems.length) state.lightboxIndex = 0;
  renderLightboxContent();
}

function renderLightboxContent() {
  const id = state.lightboxItems[state.lightboxIndex];
  const item = state.media.find((m) => m.id === id);
  if (!item) return;

  const mediaContainer = $('#lightboxMedia');
  const dateStr = new Date(item.date).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  if (item.type === 'video') {
    const poster = item.thumbnail || '';
    mediaContainer.innerHTML = `<video src="${item.original}" controls poster="${poster}" style="max-width:100%;max-height:75vh;border-radius:10px;"></video>`;
  } else {
    mediaContainer.innerHTML = `<img src="${item.original}" alt="${item.name}" />`;
  }

  const metaParts = [dateStr, `${item.sizeMB} MB`];
  if (item.resolution) metaParts.push(item.resolution);

  $('#lightboxInfo').innerHTML = `
    <div class="lb-details">
      <h3>${item.name}</h3>
      <p>${metaParts.join(' &middot; ')}</p>
    </div>
    <div class="lb-actions">
      <button class="lb-action-btn" onclick="downloadSingle('${item.id}')">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        Download
      </button>
    </div>
  `;
}

// ────────────────────────────
// SEARCH
// ────────────────────────────
function initSearch() {
  let debounceTimer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = e.target.value.toLowerCase().trim();
      if (!query) {
        renderAllMedia();
        return;
      }
      const results = getVisibleMedia().filter(
        (m) => m.name.toLowerCase().includes(query) ||
          (m.location && m.location.toLowerCase().includes(query)) ||
          (m.category && m.category.toLowerCase().includes(query))
      );
      switchView('dashboard');
      const grid = $('#allMediaGrid');
      grid.innerHTML = results.map((item) => createMediaCard(item)).join('');
      attachMediaCardEvents(grid);
    }, 300);
  });
}

// ────────────────────────────
// DOWNLOADS
// ────────────────────────────
function initDownloads() {
  $('#downloadAllBtn').addEventListener('click', () => {
    if (state.selectedMedia.size > 0) downloadSelected();
    else downloadAll();
  });
  $('#downloadZipBtn').addEventListener('click', downloadAll);
  $('#transferDriveBtn').addEventListener('click', transferAllToDrive);
}

function downloadSingle(mediaId) {
  const item = state.media.find((m) => m.id === mediaId);
  if (!item) return;
  showToast(`Downloading ${item.name}...`, 'info');
  const a = document.createElement('a');
  a.href = `/api/download/${mediaId}`;
  a.download = item.name;
  a.click();
  addTransferHistory('download', `Downloaded ${item.name}`, item.sizeMB);
}

async function downloadSelected() {
  const count = state.selectedMedia.size;
  if (count === 0) { showToast('No files selected', 'error'); return; }
  const ids = Array.from(state.selectedMedia);
  showToast(`Preparing ${count} files...`, 'info');
  try {
    const res = await fetch('/api/download/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'cloudvault-selected.zip'; a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${count} files`, 'success');
  } catch (err) {
    showToast('Download failed: ' + err.message, 'error');
  }
}

async function downloadAll() {
  const visible = getVisibleMedia();
  if (visible.length === 0) { showToast('No media to download', 'error'); return; }
  showToast(`Preparing ${visible.length} files...`, 'info');
  try {
    const res = await fetch('/api/download/zip-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'cloudvault-all.zip'; a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${visible.length} files`, 'success');
  } catch (err) {
    showToast('Download failed: ' + err.message, 'error');
  }
}

// ────────────────────────────
// GOOGLE DRIVE TRANSFER
// ────────────────────────────
function transferAllToDrive() {
  if (!state.gdriveConnected) {
    showToast('Connect Google Drive first', 'error');
    return;
  }
  const visible = getVisibleMedia();
  if (visible.length === 0) { showToast('No media to transfer', 'error'); return; }
  startTransferProgress(visible);
}

async function startTransferProgress(items) {
  openModal('transferModal');
  const fill = $('#transferProgressFill');
  const countEl = $('#transferCount');
  const statusEl = $('#transferStatus');
  const titleEl = $('#transferTitle');
  titleEl.textContent = 'Transferring to Google Drive...';
  fill.style.width = '0%';
  countEl.textContent = `0 / ${items.length} files`;
  statusEl.textContent = 'Uploading to Google Drive...';

  try {
    const ids = items.map((m) => m.id);
    const result = await API.post('/gdrive/transfer', { ids });
    fill.style.width = '100%';
    countEl.textContent = `${result.transferred} / ${items.length} files`;
    statusEl.textContent = 'Complete!';
    setTimeout(() => {
      closeModal('transferModal');
      fill.style.width = '0%';
      showToast(`${result.transferred} files transferred to Google Drive`, 'success');
      addTransferHistory('transfer', `Transferred ${result.transferred} files to Google Drive`,
        items.reduce((sum, m) => sum + m.sizeMB, 0));
    }, 1000);
  } catch (err) {
    closeModal('transferModal');
    fill.style.width = '0%';
    showToast('Transfer failed: ' + (err.message || 'Unknown error'), 'error');
  }
}

// ────────────────────────────
// TRANSFER HISTORY
// ────────────────────────────
function addTransferHistory(type, description, sizeMB) {
  state.transferHistory.unshift({
    id: 'th_' + Date.now(), type, description, sizeMB,
    date: new Date().toISOString(), status: 'complete',
  });
  if (state.currentView === 'downloads') renderTransferHistory();
}

function renderTransferHistory() {
  const list = $('#historyList');
  if (state.transferHistory.length === 0) {
    list.innerHTML = '<div class="empty-state">No transfers yet</div>';
    return;
  }
  list.innerHTML = state.transferHistory.map((item) => `
    <div class="history-item">
      <div class="hi-icon ${item.type}">
        ${item.type === 'download'
          ? '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>'
          : '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M7.71 3.5L1.15 15l3.43 5.97L11.14 9.47 7.71 3.5z"/></svg>'}
      </div>
      <div class="hi-info">
        <span class="hi-title">${item.description}</span>
        <span class="hi-meta">${new Date(item.date).toLocaleString()}</span>
      </div>
      <span class="hi-status ${item.status}">Complete</span>
    </div>
  `).join('');
}

// ────────────────────────────
// TOAST NOTIFICATIONS
// ────────────────────────────
function showToast(message, type = 'info') {
  const container = $('#toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = {
    success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
    info: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>',
  };
  toast.innerHTML = `
    <span class="toast-icon" style="color: var(--${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'})">${icons[type]}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ────────────────────────────
// ADMIN PANEL
// ────────────────────────────
function initAdmin() {
  $('#adminLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    handleAdminLogin();
  });
  $('#adminLogoutBtn').addEventListener('click', handleAdminLogout);
  $('#clearAllMediaBtn').addEventListener('click', () => confirmAction('Clear All Media', 'This will permanently remove all uploaded photos and videos.', clearAllMedia));
  $('#disconnectAllBtn').addEventListener('click', () => confirmAction('Disconnect All Accounts', 'This will remove all connections.', disconnectAllAccounts));
}

async function handleAdminLogin() {
  const input = $('#adminPasswordInput');
  const error = $('#adminError');
  try {
    const result = await API.post('/admin/login', { password: input.value });
    if (result.success) {
      state.adminLoggedIn = true;
      error.style.display = 'none';
      input.value = '';
      $('#adminLogin').style.display = 'none';
      $('#adminPanel').style.display = '';
      await refreshMedia();
      await refreshAccounts();
      renderAdminPanel();
      loadAdminUsers();
      loadAdminAccess();
      updateDashboard();
      showToast('Admin access granted', 'success');
    }
  } catch (err) {
    error.style.display = '';
    input.value = '';
    input.focus();
  }
}

function handleAdminLogout() {
  state.adminLoggedIn = false;
  $('#adminLogin').style.display = '';
  $('#adminPanel').style.display = 'none';
  showToast('Logged out of admin', 'info');
}

function renderAdminPanel() {
  if (!state.adminLoggedIn) return;
  renderAdminStats();
  renderAdminMedia();
  initAdminMediaFilters();
  renderAdminAccountsList();
}

function initAdminMediaFilters() {
  document.querySelectorAll('.admin-filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.admin-filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      renderAdminMedia(chip.dataset.filter);
    });
  });
}

function renderAdminMedia(filter = 'all') {
  const grid = $('#adminMediaGrid');
  if (!grid) return;
  let items = [...state.media].sort((a, b) => b.timestamp - a.timestamp);
  if (filter === 'photo') items = items.filter((m) => m.type === 'photo');
  else if (filter === 'video') items = items.filter((m) => m.type === 'video');

  if (items.length === 0) {
    grid.innerHTML = '<div class="admin-media-empty">No media uploaded yet.</div>';
    return;
  }

  grid.innerHTML = items.map((item, i) => {
    const delay = Math.min(i * 0.02, 0.4);
    const thumbContent = item.thumbnail
      ? `<img src="${item.thumbnail}" alt="${item.name}" loading="lazy" />`
      : `<div class="admin-media-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 16l5-5 4 4 4-4 5 5"/></svg></div>`;
    return `
      <div class="admin-media-thumb" data-id="${item.id}" style="animation-delay:${delay}s">
        ${thumbContent}
        <span class="thumb-owner">${item.personName}</span>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.admin-media-thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const allIds = items.map((m) => m.id);
      openLightbox(thumb.dataset.id, allIds);
    });
  });
}

function renderAdminStats() {
  const photos = state.media.filter((m) => m.type === 'photo').length;
  const videos = state.media.filter((m) => m.type === 'video').length;
  const totalGB = (state.media.reduce((sum, m) => sum + m.sizeMB, 0) / 1024).toFixed(1);
  const accounts = state.connectedAccounts.length;

  $('#adminStats').innerHTML = `
    <div class="admin-stat-card"><span class="asv">${state.media.length}</span><span class="asl">Total Files</span></div>
    <div class="admin-stat-card"><span class="asv">${photos}</span><span class="asl">Photos</span></div>
    <div class="admin-stat-card"><span class="asv">${videos}</span><span class="asl">Videos</span></div>
    <div class="admin-stat-card"><span class="asv">${totalGB} GB</span><span class="asl">Storage</span></div>
    <div class="admin-stat-card"><span class="asv">${accounts}</span><span class="asl">Accounts</span></div>
  `;
}

function renderAdminAccountsList() {
  const list = $('#adminAccountsList');
  if (state.connectedAccounts.length === 0) {
    list.innerHTML = '<div class="empty-state">No accounts.</div>';
    return;
  }
  list.innerHTML = state.connectedAccounts.map(acc => `
    <div class="admin-account-row">
      <span class="aa-dot" style="background: var(--green);"></span>
      <div class="aa-info">
        <span class="aa-name">${acc.name}</span>
        <span class="aa-type">${acc.username ? '@' + acc.username : acc.email}</span>
      </div>
      <button class="remove-person-btn" onclick="confirmAction('Remove ${acc.name.replace(/'/g, "\\'")}', 'This will remove this account.', () => adminRemoveAccount('${acc.id}'))">Remove</button>
    </div>
  `).join('');
}

async function adminRemoveAccount(accountId) {
  try {
    await API.del(`/accounts/${accountId}`);
    await refreshAccounts();
    renderAdminPanel();
    showToast('Account removed', 'success');
  } catch (err) {
    showToast('Failed to remove account', 'error');
  }
}

async function clearAllMedia() {
  try {
    await API.del('/admin/media/all');
    state.media = [];
    state.selectedMedia.clear();
    updateDashboard();
    renderAdminPanel();
    $('#dashboardMedia').style.display = 'none';
    $('#onboarding').style.display = '';
    showToast('All media cleared', 'success');
  } catch (err) {
    showToast('Failed to clear media: ' + err.message, 'error');
  }
}

async function disconnectAllAccounts() {
  try {
    await API.del('/admin/accounts/all');
    state.connectedAccounts = [];
    renderAdminPanel();
    showToast('All accounts disconnected', 'success');
  } catch (err) {
    showToast('Failed to disconnect accounts: ' + err.message, 'error');
  }
}

// ────────────────────────────
// ADMIN USER MANAGEMENT
// ────────────────────────────
async function loadAdminUsers() {
  try {
    const users = await API.get('/admin/users');
    renderAdminUsers(users);
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

function renderAdminUsers(users) {
  const container = document.getElementById('adminUsersList');
  if (!container) return;

  container.innerHTML = users.map(u => `
    <div class="admin-user-row" data-user-id="${u.id}">
      <div class="admin-user-info">
        <strong>${u.name}</strong> <span class="admin-user-username">@${u.username}</span>
        <span class="admin-user-drive">${u.gdriveConnected ? '✓ Drive: ' + u.gdriveEmail : '✗ No Drive'}</span>
        <span class="admin-user-media">${u.mediaCount} files · ${u.totalGB} GB</span>
      </div>
      <select class="admin-role-select" data-user-id="${u.id}" onchange="changeUserRole('${u.id}', this.value)">
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
        <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
      </select>
    </div>
  `).join('');
}

async function changeUserRole(userId, newRole) {
  try {
    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Account-Id': state.currentUser ? state.currentUser.id : '' },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) throw new Error('Failed to update role');
    showToast(`Role updated to ${newRole}`, 'success');
  } catch (err) {
    showToast('Failed to update role', 'error');
  }
}

async function loadAdminAccess() {
  try {
    const grants = await API.get('/admin/access');
    renderAdminAccess(grants);
  } catch (err) {
    console.error('Failed to load access grants:', err);
  }
}

function renderAdminAccess(grants) {
  const container = document.getElementById('adminAccessList');
  if (!container) return;

  container.innerHTML = grants.length === 0
    ? '<p class="empty-state-text">No access grants yet. Grant users access to view other users\' content.</p>'
    : grants.map(g => `
      <div class="admin-access-row">
        <span><strong>${g.viewerName}</strong> (@${g.viewerUsername}) can view <strong>${g.ownerName}</strong>'s content</span>
        <button class="btn-icon" onclick="revokeAccess('${g.id}')" title="Revoke">✕</button>
      </div>
    `).join('');
}

async function grantAccess() {
  const viewerSelect = document.getElementById('accessViewerSelect');
  const ownerSelect = document.getElementById('accessOwnerSelect');
  if (!viewerSelect || !ownerSelect) return;

  const viewerId = viewerSelect.value;
  const ownerId = ownerSelect.value;

  if (!viewerId || !ownerId) {
    showToast('Select both users', 'error');
    return;
  }

  try {
    await API.post('/admin/access', { viewerId, ownerId });
    showToast('Access granted', 'success');
    loadAdminAccess();
  } catch (err) {
    showToast('Failed to grant access', 'error');
  }
}

async function revokeAccess(grantId) {
  try {
    await API.del(`/admin/access/${grantId}`);
    showToast('Access revoked', 'success');
    loadAdminAccess();
  } catch (err) {
    showToast('Failed to revoke access', 'error');
  }
}

// ────────────────────────────
// CONFIRM DIALOG
// ────────────────────────────
function confirmAction(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-card">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-delete">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.confirm-delete').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
}
