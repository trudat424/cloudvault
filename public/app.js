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
  async put(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'PUT',
      headers: this._getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
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
  // Folder browser state
  currentFolderId: null, // null = root
  folderPath: [],        // breadcrumb: [{ id, name }, ...]
  folders: [],           // current level's folders
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
      showToast('Google Drive permissions need updating. Please reconnect.', 'warning');
    }
    if (gdrive.connected) {
      state.gdriveEmail = gdrive.email || '';
      state.gdriveName = gdrive.name || '';
      state.gdriveAccessToken = gdrive.accessToken || '';
    }

    // Always show the file browser and load folders
    // navigateToFolder handles showing/hiding onboarding based on folder+media presence
    $('#dashboardMedia').style.display = '';
    await navigateToFolder(null);
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
  initOnboarding();
  initFileBrowser();

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

  if (view === 'dashboard') navigateToFolder(state.currentFolderId);
  if (view === 'sharing') renderSharingView();
  if (view === 'connections') renderConnectionsView();
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

  // "Import URL" option
  const fabUrl = $('#fabUrlImport');
  if (fabUrl) {
    fabUrl.addEventListener('click', () => {
      closeFab();
      openUrlImportModal();
    });
  }

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
    if (state.currentFolderId) formData.append('folder_id', state.currentFolderId);
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

  if (totalUploaded > 0) {
    showToast(`Uploaded ${totalUploaded} file${totalUploaded > 1 ? 's' : ''}`, 'success');
    $('#onboarding').style.display = 'none';
    $('#dashboardMedia').style.display = '';
    navigateToFolder(state.currentFolderId);
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
                    navigateToFolder(state.currentFolderId);
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
    $('#connectGDriveBtn span').textContent = 'Import from Google Drive';
    showToast('Google Drive disconnected', 'info');
  } catch (err) {
    showToast('Failed to disconnect: ' + err.message, 'error');
  }
}

// ────────────────────────────
// STORAGE UI
// ────────────────────────────
function updateStorageUI() {
  const visible = getVisibleMedia();
  const totalGB = (visible.reduce((sum, m) => sum + m.sizeMB, 0) / 1024).toFixed(1);
  $('#storageText').textContent = `${totalGB} GB used`;
}

// ────────────────────────────
// ONBOARDING (upload-first welcome)
// ────────────────────────────
function initOnboarding() {
  // "Upload Files" button on onboarding card
  const uploadBtn = $('#onboardingUploadBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      if (!state.currentUser) {
        showToast('Please log in first', 'error');
        return;
      }
      $('#fabFileInput').click();
    });
  }

  // "or import from Google Drive" link
  const driveBtn = $('#onboardingDriveBtn');
  if (driveBtn) {
    driveBtn.addEventListener('click', () => {
      if (!state.currentUser) {
        showToast('Please log in first', 'error');
        return;
      }
      openDriveBrowser();
    });
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

  // AI badge
  const aiBadge = item.aiStatus === 'done'
    ? '<div class="ai-badge" title="AI analyzed">✨</div>'
    : item.aiStatus === 'processing'
    ? '<div class="ai-badge processing" title="Analyzing...">⏳</div>'
    : '';

  // Platform badge
  const platformIcons = {
    instagram: '📸', tiktok: '🎵', twitter: '𝕏', youtube: '▶',
    drive: '📁', upload: '',
  };
  const platformBadge = item.sourcePlatform && item.sourcePlatform !== 'upload'
    ? `<div class="platform-badge" title="${item.sourcePlatform}">${platformIcons[item.sourcePlatform] || '🔗'}</div>`
    : '';

  return `
    <div class="media-card${selected}" data-id="${item.id}" data-type="${item.type}">
      ${thumbContent}
      ${item.type === 'video' ? `<div class="video-badge"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg></div>` : ''}
      ${aiBadge}
      ${platformBadge}
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
  ['filterType', 'filterSort'].forEach((id) => {
    const el = $(`#${id}`);
    if (el) el.addEventListener('change', () => navigateToFolder(state.currentFolderId));
  });
}

function getFilteredMedia(items) {
  let filtered = items ? [...items] : [...getVisibleMedia()];
  const typeEl = $('#filterType');
  const sortEl = $('#filterSort');
  const type = typeEl ? typeEl.value : 'all';
  const sort = sortEl ? sortEl.value : 'newest';

  if (type !== 'all') filtered = filtered.filter((m) => m.type === type);
  switch (sort) {
    case 'newest': filtered.sort((a, b) => b.timestamp - a.timestamp); break;
    case 'oldest': filtered.sort((a, b) => a.timestamp - b.timestamp); break;
    case 'largest': filtered.sort((a, b) => b.sizeMB - a.sizeMB); break;
    case 'smallest': filtered.sort((a, b) => a.sizeMB - b.sizeMB); break;
    case 'name': filtered.sort((a, b) => a.name.localeCompare(b.name)); break;
  }
  return filtered;
}

function renderAllMedia() {
  navigateToFolder(state.currentFolderId);
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

  // AI description and tags
  let aiHtml = '';
  if (item.aiDescription) {
    aiHtml += `<div class="lb-ai-description"><span class="lb-ai-label">✨ AI Description</span><p>${item.aiDescription}</p></div>`;
  }
  if (item.aiTags && item.aiTags.length > 0) {
    aiHtml += `<div class="lb-ai-tags">${item.aiTags.map(tag =>
      `<span class="ai-tag" onclick="searchByTag('${tag.replace(/'/g, "\\'")}')">${tag}</span>`
    ).join('')}</div>`;
  }

  $('#lightboxInfo').innerHTML = `
    <div class="lb-details">
      <h3>${item.name}</h3>
      <p>${metaParts.join(' &middot; ')}</p>
      ${aiHtml}
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
        navigateToFolder(state.currentFolderId);
        return;
      }
      const results = getVisibleMedia().filter(
        (m) => m.name.toLowerCase().includes(query) ||
          (m.location && m.location.toLowerCase().includes(query)) ||
          (m.category && m.category.toLowerCase().includes(query)) ||
          (m.aiDescription && m.aiDescription.toLowerCase().includes(query)) ||
          (m.aiTags && m.aiTags.some(t => t.toLowerCase().includes(query)))
      );
      if (state.currentView !== 'dashboard') switchView('dashboard');
      // Show search results without folder structure
      const foldersSection = $('#foldersSection');
      const filesLabel = $('#filesLabel');
      const emptyState = $('#emptyFolderState');
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesLabel) { filesLabel.style.display = ''; filesLabel.textContent = `Search results (${results.length})`; }
      if (emptyState) emptyState.style.display = 'none';
      const grid = $('#allMediaGrid');
      grid.innerHTML = results.map((item) => createMediaCard(item)).join('');
      attachMediaCardEvents(grid);
    }, 300);
  });
}

function searchByTag(tag) {
  closeLightbox();
  const searchInput = $('#searchInput');
  searchInput.value = tag;
  searchInput.dispatchEvent(new Event('input'));
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
}

function downloadSingle(mediaId) {
  const item = state.media.find((m) => m.id === mediaId);
  if (!item) return;
  showToast(`Downloading ${item.name}...`, 'info');
  const a = document.createElement('a');
  a.href = `/api/download/${mediaId}`;
  a.download = item.name;
  a.click();
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
  renderAdminScraperSettings();
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

async function adminRemoveAccount(accountId) {
  try {
    await API.del(`/admin/person/${accountId}`);
    await refreshAccounts();
    renderAdminPanel();
    loadAdminUsers();
    loadAdminAccess();
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

  if (users.length === 0) {
    container.innerHTML = '<p class="empty-state-text">No users registered yet.</p>';
    return;
  }

  // Store users for access grant dropdowns
  state._adminUsers = users;
  renderAccessGrantForm(users);

  container.innerHTML = users.map(u => {
    const roleIcon = u.role === 'admin' ? '🛡️' : u.role === 'member' ? '👤' : '👁️';
    const safeName = u.name.replace(/'/g, "\\'");
    return `
    <div class="admin-user-row" data-user-id="${u.id}">
      <div class="admin-user-info">
        <strong>${roleIcon} ${u.name}</strong> <span class="admin-user-username">@${u.username}</span>
        <span class="admin-user-meta">${u.mediaCount} files · ${u.totalGB} GB${u.gdriveConnected ? ' · Drive ✓' : ''}</span>
      </div>
      <div class="admin-user-actions">
        <select class="admin-role-select" data-user-id="${u.id}" onchange="changeUserRole('${u.id}', this.value)">
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
          <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
        </select>
        <button class="admin-remove-btn" title="Remove user" onclick="confirmAction('Remove ${safeName}', 'This will remove this user and all their media. Cannot be undone.', () => adminRemoveAccount('${u.id}'))">✕</button>
      </div>
    </div>
  `}).join('');
}

function renderAccessGrantForm(users) {
  const form = document.getElementById('accessGrantForm');
  if (!form || users.length < 2) {
    if (form) form.innerHTML = '<p class="empty-state-text">Need at least 2 users to set up content sharing.</p>';
    return;
  }
  const options = users.map(u => `<option value="${u.id}">${u.name} (@${u.username})</option>`).join('');
  form.innerHTML = `
    <select id="accessViewerSelect"><option value="">Who can view...</option>${options}</select>
    <span>can see</span>
    <select id="accessOwnerSelect"><option value="">Whose content...</option>${options}</select>
    <button class="btn btn-primary" onclick="grantAccess()">Grant</button>
  `;
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

// ────────────────────────────
// FOLDER BROWSER
// ────────────────────────────
function initFileBrowser() {
  const newFolderBtn = $('#newFolderBtn');
  if (newFolderBtn) newFolderBtn.addEventListener('click', promptCreateFolder);

  const emptyUploadBtn = $('#emptyFolderUploadBtn');
  if (emptyUploadBtn) {
    emptyUploadBtn.addEventListener('click', () => {
      if (!state.currentUser) { showToast('Please log in first', 'error'); return; }
      $('#fabFileInput').click();
    });
  }
}

async function navigateToFolder(folderId) {
  state.currentFolderId = folderId;

  try {
    // Fetch folders at this level
    let folderUrl = `/folders?account_id=${state.currentUser.id}`;
    if (folderId) folderUrl += `&parent_id=${folderId}`;
    const folders = await API.get(folderUrl);
    state.folders = folders;

    // Fetch breadcrumb path
    if (folderId) {
      const folderInfo = await API.get(`/folders/${folderId}`);
      state.folderPath = folderInfo.path || [];
    } else {
      state.folderPath = [];
    }

    // Fetch media at this level
    let mediaUrl = `/media?`;
    if (folderId) {
      mediaUrl += `folder_id=${folderId}`;
    } else {
      mediaUrl += `root=true`;
    }
    const typeFilter = $('#filterType') ? $('#filterType').value : 'all';
    const sortFilter = $('#filterSort') ? $('#filterSort').value : 'newest';
    if (typeFilter !== 'all') mediaUrl += `&type=${typeFilter}`;
    mediaUrl += `&sort=${sortFilter}`;

    const media = await API.get(mediaUrl);

    renderBreadcrumb();
    renderFileBrowser(folders, media);
  } catch (err) {
    console.error('Failed to navigate to folder:', err);
    showToast('Failed to load folder', 'error');
  }
}

function renderBreadcrumb() {
  const bar = $('#breadcrumbBar');
  if (!bar) return;

  let html = `
    <a href="#" class="breadcrumb-item breadcrumb-root ${state.folderPath.length === 0 ? 'active' : ''}" data-folder-id="">
      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/></svg>
      <span>My Files</span>
    </a>
  `;

  state.folderPath.forEach((segment, i) => {
    const isLast = i === state.folderPath.length - 1;
    html += `
      <span class="breadcrumb-sep">/</span>
      <a href="#" class="breadcrumb-item ${isLast ? 'active' : ''}" data-folder-id="${segment.id}">
        <span>${segment.name}</span>
      </a>
    `;
  });

  bar.innerHTML = html;

  // Attach click events
  bar.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const fId = item.dataset.folderId;
      navigateToFolder(fId || null);
    });
  });

  // Enable breadcrumb items as drop targets
  attachBreadcrumbDropEvents();
}

function renderFileBrowser(folders, media) {
  const foldersSection = $('#foldersSection');
  const foldersGrid = $('#foldersGrid');
  const filesSection = $('#filesSection');
  const filesLabel = $('#filesLabel');
  const mediaGrid = $('#allMediaGrid');
  const emptyState = $('#emptyFolderState');

  const hasFolders = folders.length > 0;
  const hasMedia = media.length > 0;

  // Show onboarding only at root with no content; hide file browser sections when onboarding shows
  const onboarding = $('#onboarding');
  const dashboardMedia = $('#dashboardMedia');
  const showOnboarding = !hasFolders && !hasMedia && !state.currentFolderId;
  if (onboarding) {
    onboarding.style.display = showOnboarding ? '' : 'none';
  }
  if (dashboardMedia) {
    dashboardMedia.style.display = showOnboarding ? 'none' : '';
  }
  if (showOnboarding) return; // Don't render file browser sections when onboarding is shown

  // Folders
  if (hasFolders) {
    foldersSection.style.display = '';
    foldersGrid.innerHTML = folders.map(f => createFolderCard(f)).join('');
    attachFolderCardEvents(foldersGrid);
  } else {
    foldersSection.style.display = 'none';
  }

  // Files label - show only when there are also folders
  if (filesLabel) {
    filesLabel.style.display = (hasFolders && hasMedia) ? '' : 'none';
    filesLabel.textContent = 'Files';
  }

  // Media
  if (hasMedia) {
    filesSection.style.display = '';
    const filteredMedia = getFilteredMedia(media);
    mediaGrid.innerHTML = filteredMedia.map(item => createMediaCard(item)).join('');
    attachMediaCardEvents(mediaGrid);
    emptyState.style.display = 'none';
  } else if (!hasFolders) {
    // Show empty state only if there's nothing at all
    filesSection.style.display = 'none';
    emptyState.style.display = state.currentFolderId ? '' : 'none';
  } else {
    filesSection.style.display = 'none';
    emptyState.style.display = 'none';
  }

  // Enable drag-and-drop
  attachDragDropEvents();
}

function createFolderCard(folder) {
  const itemCount = (folder.subfolderCount || 0) + (folder.mediaCount || 0);
  return `
    <div class="folder-card" data-folder-id="${folder.id}">
      <div class="folder-card-icon">
        <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M4 4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2H4z"/></svg>
      </div>
      <div class="folder-card-info">
        <span class="folder-card-name">${folder.name}</span>
        <span class="folder-card-count">${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
      </div>
      <button class="folder-card-menu" data-folder-id="${folder.id}" title="Folder options">
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/></svg>
      </button>
    </div>
  `;
}

function attachFolderCardEvents(container) {
  container.querySelectorAll('.folder-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't navigate if clicking the menu button
      if (e.target.closest('.folder-card-menu')) return;
      const folderId = card.dataset.folderId;
      navigateToFolder(folderId);
    });
  });

  container.querySelectorAll('.folder-card-menu').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showFolderContextMenu(btn.dataset.folderId, e);
    });
  });
}

// ────────────────────────────
// DRAG & DROP
// ────────────────────────────
function attachDragDropEvents() {
  const foldersGrid = $('#foldersGrid');
  const mediaGrid = $('#allMediaGrid');

  // --- Make media cards draggable ---
  if (mediaGrid) {
    mediaGrid.querySelectorAll('.media-card[data-id]').forEach(card => {
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        const draggedId = card.dataset.id;

        // Multi-select: if this item is selected, drag all selected items
        let mediaIds = [];
        let folderIds = [];
        if (state.selectedMedia.has(draggedId)) {
          mediaIds = Array.from(state.selectedMedia);
        } else {
          mediaIds = [draggedId];
        }

        e.dataTransfer.setData('application/json', JSON.stringify({ mediaIds, folderIds }));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');

        // Visual: add dragging class to all selected cards
        if (state.selectedMedia.has(draggedId)) {
          mediaGrid.querySelectorAll('.media-card.selected').forEach(c => c.classList.add('dragging'));
        }
      });

      card.addEventListener('dragend', () => {
        document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
    });
  }

  // --- Make folder cards draggable AND drop targets ---
  if (foldersGrid) {
    foldersGrid.querySelectorAll('.folder-card[data-folder-id]').forEach(card => {
      const folderId = card.dataset.folderId;

      // Draggable
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('application/json', JSON.stringify({ mediaIds: [], folderIds: [folderId] }));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      // Drop target
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!card.classList.contains('dragging')) {
          card.classList.add('drag-over');
        }
      });

      card.addEventListener('dragleave', (e) => {
        if (!card.contains(e.relatedTarget)) {
          card.classList.remove('drag-over');
        }
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');

        try {
          const payload = JSON.parse(e.dataTransfer.getData('application/json'));
          if (!payload) return;

          if (payload.folderIds && payload.folderIds.includes(folderId)) {
            showToast('Cannot move a folder into itself', 'error');
            return;
          }

          await API.post('/folders/move', {
            mediaIds: payload.mediaIds || [],
            folderIds: payload.folderIds || [],
            targetFolderId: folderId,
          });

          const total = (payload.mediaIds?.length || 0) + (payload.folderIds?.length || 0);
          showToast(`Moved ${total} item${total !== 1 ? 's' : ''}`, 'success');
          state.selectedMedia.clear();
          navigateToFolder(state.currentFolderId);
        } catch (err) {
          console.error('Drop move failed:', err);
          showToast('Failed to move items', 'error');
        }
      });
    });
  }
}

function attachBreadcrumbDropEvents() {
  const bar = $('#breadcrumbBar');
  if (!bar) return;

  bar.querySelectorAll('.breadcrumb-item').forEach(item => {
    const targetFolderId = item.dataset.folderId || null;

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    });

    item.addEventListener('dragleave', (e) => {
      if (!item.contains(e.relatedTarget)) {
        item.classList.remove('drag-over');
      }
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');

      try {
        const payload = JSON.parse(e.dataTransfer.getData('application/json'));
        if (!payload) return;

        const actualTarget = targetFolderId || null;
        if (actualTarget === state.currentFolderId) return; // no-op

        await API.post('/folders/move', {
          mediaIds: payload.mediaIds || [],
          folderIds: payload.folderIds || [],
          targetFolderId: actualTarget,
        });

        const total = (payload.mediaIds?.length || 0) + (payload.folderIds?.length || 0);
        showToast(`Moved ${total} item${total !== 1 ? 's' : ''}`, 'success');
        state.selectedMedia.clear();
        navigateToFolder(state.currentFolderId);
      } catch (err) {
        console.error('Breadcrumb drop failed:', err);
        showToast('Failed to move items', 'error');
      }
    });
  });
}

function showFolderContextMenu(folderId, event) {
  // Remove any existing context menu
  document.querySelectorAll('.folder-context-menu').forEach(m => m.remove());

  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;

  const menu = document.createElement('div');
  menu.className = 'folder-context-menu';
  menu.innerHTML = `
    <button class="ctx-item" data-action="rename">
      <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
      Rename
    </button>
    <button class="ctx-item danger" data-action="delete">
      <svg viewBox="0 0 20 20" fill="currentColor" width="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
      Delete
    </button>
  `;

  // Position near the button
  const rect = event.target.closest('.folder-card-menu').getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left - 100}px`;
  menu.style.zIndex = '1000';

  document.body.appendChild(menu);

  menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
    menu.remove();
    promptRenameFolder(folderId, folder.name);
  });

  menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
    menu.remove();
    confirmAction('Delete Folder', `Delete "${folder.name}"? Contents will be moved to the parent folder.`, async () => {
      try {
        await API.del(`/folders/${folderId}?action=move_to_parent`);
        showToast(`Folder "${folder.name}" deleted`, 'success');
        await refreshMedia();
        navigateToFolder(state.currentFolderId);
      } catch (err) {
        showToast('Failed to delete folder', 'error');
      }
    });
  });

  // Close on click outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 10);
}

function promptCreateFolder() {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-card">
      <h3>New Folder</h3>
      <div class="form-field" style="margin: 16px 0;">
        <input type="text" id="newFolderName" placeholder="Folder name" autofocus style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-size:0.95rem;" />
      </div>
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-delete" style="background:var(--accent);color:white;">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#newFolderName');
  input.focus();

  overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const create = async () => {
    const name = input.value.trim();
    if (!name) { showToast('Folder name is required', 'error'); return; }
    try {
      await API.post('/folders', {
        name,
        parent_id: state.currentFolderId || null,
        account_id: state.currentUser.id,
      });
      overlay.remove();
      showToast(`Folder "${name}" created`, 'success');
      navigateToFolder(state.currentFolderId);
    } catch (err) {
      let msg = 'Failed to create folder';
      try { msg = JSON.parse(err.message).error; } catch(_) {}
      showToast(msg, 'error');
    }
  };

  overlay.querySelector('.confirm-delete').addEventListener('click', create);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
}

function promptRenameFolder(folderId, currentName) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-card">
      <h3>Rename Folder</h3>
      <div class="form-field" style="margin: 16px 0;">
        <input type="text" id="renameFolderInput" value="${currentName}" autofocus style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-size:0.95rem;" />
      </div>
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-delete" style="background:var(--accent);color:white;">Rename</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#renameFolderInput');
  input.focus();
  input.select();

  overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const rename = async () => {
    const name = input.value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    try {
      await API.put(`/folders/${folderId}`, { name });
      overlay.remove();
      showToast(`Renamed to "${name}"`, 'success');
      navigateToFolder(state.currentFolderId);
    } catch (err) {
      showToast('Failed to rename folder', 'error');
    }
  };

  overlay.querySelector('.confirm-delete').addEventListener('click', rename);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') rename(); });
}

// ────────────────────────────
// CONNECTIONS VIEW
// ────────────────────────────
async function renderConnectionsView() {
  const grid = $('#connectionsGrid');
  if (!grid) return;

  try {
    const platforms = await API.get('/social/platforms');

    // Add Google Drive as a connection too
    let html = '';

    // Social platforms
    platforms.forEach(p => {
      const iconMap = {
        instagram: '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>',
        tiktok: '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.43V13.1a8.28 8.28 0 005.58 2.17V11.8a4.85 4.85 0 01-3.77-1.74V6.69h3.77z"/></svg>',
        twitter: '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
        youtube: '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
      };

      const statusClass = p.connected ? 'connected' : '';

      // Build action buttons
      let actions = '';
      if (p.connected) {
        actions += `<button class="conn-btn conn-browse" data-platform="${p.id}">Browse</button>`;
        actions += `<button class="conn-btn conn-url-import" data-platform="${p.id}">Import URL</button>`;
        actions += `<button class="conn-btn conn-disconnect" data-platform="${p.id}">Disconnect</button>`;
      } else {
        // Always show Import URL (no API keys needed)
        actions += `<button class="conn-btn conn-url-import" data-platform="${p.id}">Import URL</button>`;
        // Show scrape browse for YouTube
        if (p.scrapeBrowseAvailable) {
          actions += `<button class="conn-btn conn-scrape-browse" data-platform="${p.id}">Search</button>`;
        }
        // Show connect if API keys are available
        if (p.available) {
          actions += `<button class="conn-btn conn-connect" data-platform="${p.id}" data-available="${p.available}">Connect API</button>`;
        }
      }

      html += `
        <div class="connection-card ${statusClass}" data-platform="${p.id}">
          <div class="connection-icon">${iconMap[p.id] || ''}</div>
          <div class="connection-info">
            <h3 class="connection-name">${p.name}</h3>
            <p class="connection-desc">${p.connected ? (p.username ? '@' + p.username : 'Connected') : p.description}</p>
            ${p.connected ? `<span class="connection-categories">${p.categories.join(', ')}</span>` : ''}
          </div>
          <div class="connection-actions">
            ${actions}
          </div>
        </div>
      `;
    });

    // Google Drive card
    html += `
      <div class="connection-card ${state.gdriveConnected ? 'connected' : ''}" data-platform="gdrive">
        <div class="connection-icon">
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M7.71 3.5L1.15 15l3.43 5.97L11.14 9.47 7.71 3.5zm1.14 0l6.86 11.94H22.85L16 3.5H8.85zM15.29 16.5H1.71L5.14 22.47h13.72l-3.57-5.97z"/></svg>
        </div>
        <div class="connection-info">
          <h3 class="connection-name">Google Drive</h3>
          <p class="connection-desc">${state.gdriveConnected ? (state.gdriveEmail || 'Connected') : 'Import files from Drive'}</p>
        </div>
        <div class="connection-actions">
          ${state.gdriveConnected
            ? `<button class="conn-btn conn-browse" data-platform="gdrive">Browse</button>
               <button class="conn-btn conn-disconnect" data-platform="gdrive">Disconnect</button>`
            : `<button class="conn-btn conn-connect" data-platform="gdrive">Connect</button>`
          }
        </div>
      </div>
    `;

    grid.innerHTML = html;

    // Attach events
    grid.querySelectorAll('.conn-connect').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        const available = btn.dataset.available !== 'false';
        if (!available && platform !== 'gdrive') {
          showToast(`${platform.charAt(0).toUpperCase() + platform.slice(1)} API keys not configured. Add them to your .env file to enable this connection.`, 'error');
          return;
        }
        if (platform === 'gdrive') {
          window.location.href = '/api/gdrive/auth?accountId=' + state.currentUser.id;
        } else {
          window.location.href = `/api/social/${platform}/auth?accountId=${state.currentUser.id}`;
        }
      });
    });

    grid.querySelectorAll('.conn-browse').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        if (platform === 'gdrive') {
          openDriveBrowser();
        } else {
          openSocialBrowser(platform);
        }
      });
    });

    // URL import buttons
    grid.querySelectorAll('.conn-url-import').forEach(btn => {
      btn.addEventListener('click', () => {
        openUrlImportModal(btn.dataset.platform);
      });
    });

    // Scrape browse buttons (YouTube search)
    grid.querySelectorAll('.conn-scrape-browse').forEach(btn => {
      btn.addEventListener('click', () => {
        openScrapeBrowser(btn.dataset.platform);
      });
    });

    grid.querySelectorAll('.conn-disconnect').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        confirmAction(`Disconnect ${platform}`, `Are you sure you want to disconnect ${platform}?`, async () => {
          try {
            if (platform === 'gdrive') {
              await handleGDriveDisconnect();
            } else {
              await API.del(`/social/${platform}/disconnect`);
              showToast(`${platform} disconnected`, 'info');
            }
            renderConnectionsView();
          } catch (err) {
            showToast('Failed to disconnect', 'error');
          }
        });
      });
    });

  } catch (err) {
    console.error('Failed to load connections:', err);
    grid.innerHTML = '<div class="empty-state">Failed to load connections.</div>';
  }
}

// ────────────────────────────
// SOCIAL MEDIA BROWSER
// ────────────────────────────
async function openSocialBrowser(platform) {
  // Reuse the drive browser modal with different content
  const browser = $('#driveBrowser');
  browser.style.display = '';
  document.body.style.overflow = 'hidden';

  const platformNames = { instagram: 'Instagram', tiktok: 'TikTok', twitter: 'Twitter / X', youtube: 'YouTube' };
  browser.querySelector('.drive-browser-title span').textContent = platformNames[platform] || platform;

  driveSelectedFiles = {};
  const grid = $('#driveFileGrid');
  grid.innerHTML = '';
  $('#driveSearchInput').value = '';
  updateDriveSelectionUI();

  const loading = $('#driveLoading');
  const empty = $('#driveEmpty');
  const loadMore = $('#driveLoadMore');
  loading.style.display = '';
  empty.style.display = 'none';
  loadMore.style.display = 'none';

  try {
    const data = await API.get(`/social/${platform}/content`);
    loading.style.display = 'none';

    if (!data.items || data.items.length === 0) {
      empty.style.display = '';
      empty.querySelector('p').textContent = `No content found on ${platformNames[platform]}.`;
      return;
    }

    data.items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'drive-file-item';
      el.dataset.fileId = item.id;
      el.innerHTML = `
        <div class="drive-file-thumb">
          ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" loading="lazy" />` : `<div class="drive-file-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </div>`}
          <div class="drive-file-check">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
          </div>
          ${item.category ? `<span class="social-category-badge">${item.category}</span>` : ''}
        </div>
        <span class="drive-file-name">${item.title || item.id}</span>
      `;

      el.addEventListener('click', () => {
        if (driveSelectedFiles[item.id]) {
          delete driveSelectedFiles[item.id];
          el.classList.remove('selected');
        } else {
          driveSelectedFiles[item.id] = { id: item.id, title: item.title, url: item.url, category: item.category };
          el.classList.add('selected');
        }
        updateDriveSelectionUI();
      });

      grid.appendChild(el);
    });

    // Override import button for social
    const importBtn = $('#driveImportBtn');
    const newImport = importBtn.cloneNode(true);
    importBtn.parentNode.replaceChild(newImport, importBtn);
    newImport.addEventListener('click', () => {
      const items = Object.values(driveSelectedFiles);
      if (items.length === 0) return;
      closeDriveBrowser();
      importSocialContent(platform, items);
    });

  } catch (err) {
    loading.style.display = 'none';
    showToast(`Failed to load ${platformNames[platform]} content`, 'error');
    closeDriveBrowser();
  }
}

async function importSocialContent(platform, items) {
  openModal('transferModal');
  const fill = $('#transferProgressFill');
  const countEl = $('#transferCount');
  const statusEl = $('#transferStatus');
  const titleEl = $('#transferTitle');

  const platformNames = { instagram: 'Instagram', tiktok: 'TikTok', twitter: 'Twitter / X', youtube: 'YouTube' };
  titleEl.textContent = `Importing from ${platformNames[platform]}...`;
  fill.style.width = '0%';
  countEl.textContent = `0 / ${items.length} files`;
  statusEl.textContent = 'Starting import...';

  try {
    const response = await fetch(`/api/social/${platform}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Id': state.currentUser.id,
      },
      body: JSON.stringify({ items }),
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
              const pct = eventData.total > 0 ? Math.round((eventData.current / eventData.total) * 100) : 0;
              fill.style.width = pct + '%';
              countEl.textContent = `${eventData.current} / ${eventData.total} files`;
              statusEl.textContent = eventData.fileName ? `Importing: ${eventData.fileName}` : 'Importing...';
            } else if (eventType === 'done') {
              fill.style.width = '100%';
              statusEl.textContent = 'Complete!';
              countEl.textContent = `${eventData.imported} imported`;
              setTimeout(async () => {
                closeModal('transferModal');
                if (eventData.imported > 0) {
                  showToast(`Imported ${eventData.imported} files from ${platformNames[platform]}`, 'success');
                  await refreshMedia();
                  updateDashboard();
                  if (getVisibleMedia().length > 0) {
                    $('#onboarding').style.display = 'none';
                    $('#dashboardMedia').style.display = '';
                    navigateToFolder(state.currentFolderId);
                  }
                }
              }, 1200);
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

// ────────────────────────────
// URL IMPORT MODAL
// ────────────────────────────
function openUrlImportModal(platform) {
  const modal = $('#urlImportModal');
  if (!modal) return;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  const input = $('#urlImportInput');
  const error = $('#urlImportError');
  const preview = $('#urlImportPreview');
  const actions = $('#urlImportActions');

  input.value = '';
  error.style.display = 'none';
  preview.style.display = 'none';
  preview.innerHTML = '';
  actions.style.display = 'none';

  if (platform) {
    const names = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', twitter: 'Twitter/X' };
    input.placeholder = `Paste a ${names[platform] || platform} URL...`;
  } else {
    input.placeholder = 'https://...';
  }

  setTimeout(() => input.focus(), 100);

  $('#urlImportClose').onclick = () => closeUrlImportModal();
  $('#urlImportBackdrop').onclick = () => closeUrlImportModal();
  $('#urlImportFetchBtn').onclick = () => fetchUrlPreview();

  input.onpaste = () => setTimeout(() => fetchUrlPreview(), 150);
  input.onkeydown = (e) => { if (e.key === 'Enter') fetchUrlPreview(); };
}

function closeUrlImportModal() {
  const modal = $('#urlImportModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
}

async function fetchUrlPreview() {
  const input = $('#urlImportInput');
  const error = $('#urlImportError');
  const preview = $('#urlImportPreview');
  const actions = $('#urlImportActions');
  const fetchBtn = $('#urlImportFetchBtn');

  const url = input.value.trim();
  if (!url) {
    error.textContent = 'Please paste a URL';
    error.style.display = '';
    return;
  }

  error.style.display = 'none';
  preview.style.display = 'none';
  actions.style.display = 'none';
  fetchBtn.textContent = 'Fetching...';
  fetchBtn.disabled = true;

  try {
    const res = await fetch('/api/social/import-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Id': state.currentUser?.id || '',
      },
      body: JSON.stringify({ url, action: 'preview' }),
    });

    const data = await res.json();
    fetchBtn.textContent = 'Fetch';
    fetchBtn.disabled = false;

    if (!res.ok) {
      error.textContent = data.error || 'Failed to fetch URL';
      error.style.display = '';
      return;
    }

    const item = data.item;
    if (!item) {
      error.textContent = 'Could not extract content from this URL';
      error.style.display = '';
      return;
    }

    const platformIcons = { youtube: '▶️', instagram: '📷', tiktok: '🎵', twitter: '🐦' };
    const platformNames = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', twitter: 'Twitter/X' };

    preview.innerHTML = `
      <div class="url-preview-card">
        ${item.thumbnail ? `<img class="url-preview-thumb" src="${item.thumbnail}" alt="" />` : '<div class="url-preview-thumb-placeholder">No preview</div>'}
        <div class="url-preview-info">
          <span class="url-preview-platform">${platformIcons[item.platform] || '🔗'} ${platformNames[item.platform] || item.platform}</span>
          <h4 class="url-preview-title">${item.title || 'Untitled'}</h4>
          ${item.author ? `<span class="url-preview-author">by ${item.author}</span>` : ''}
          ${item.category ? `<span class="url-preview-category">${item.category}</span>` : ''}
        </div>
      </div>
    `;
    preview.style.display = '';
    actions.style.display = '';

    state._urlImportItem = item;
    state._urlImportUrl = url;

    $('#urlImportConfirmBtn').onclick = () => confirmUrlImport();

  } catch (err) {
    fetchBtn.textContent = 'Fetch';
    fetchBtn.disabled = false;
    error.textContent = 'Network error. Please try again.';
    error.style.display = '';
  }
}

async function confirmUrlImport() {
  if (!state.currentUser) {
    showToast('Please log in first', 'error');
    return;
  }

  const url = state._urlImportUrl;
  if (!url) return;

  closeUrlImportModal();

  openModal('transferModal');
  const fill = $('#transferProgressFill');
  const countEl = $('#transferCount');
  const statusEl = $('#transferStatus');
  const titleEl = $('#transferTitle');

  const platformNames = { instagram: 'Instagram', tiktok: 'TikTok', twitter: 'Twitter/X', youtube: 'YouTube' };
  const item = state._urlImportItem;
  titleEl.textContent = `Importing from ${platformNames[item?.platform] || 'URL'}...`;
  fill.style.width = '0%';
  countEl.textContent = '';
  statusEl.textContent = 'Starting import...';

  try {
    const response = await fetch('/api/social/import-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Id': state.currentUser.id,
      },
      body: JSON.stringify({ url, action: 'import' }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop();

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const eventData = JSON.parse(line.slice(6));
            if (eventType === 'progress') {
              statusEl.textContent = eventData.status === 'downloading' ? 'Downloading...' : 'Uploading to vault...';
              fill.style.width = eventData.status === 'uploading' ? '60%' : '20%';
            } else if (eventType === 'done') {
              fill.style.width = '100%';
              statusEl.textContent = 'Complete!';
              countEl.textContent = `${eventData.imported} imported`;
              setTimeout(async () => {
                closeModal('transferModal');
                showToast(`Imported "${eventData.title || 'content'}" from ${platformNames[eventData.platform] || 'URL'}`, 'success');
                await refreshMedia();
                updateDashboard();
                if (getVisibleMedia().length > 0) {
                  $('#onboarding').style.display = 'none';
                  $('#dashboardMedia').style.display = '';
                  navigateToFolder(state.currentFolderId);
                }
              }, 1200);
            } else if (eventType === 'error') {
              closeModal('transferModal');
              showToast(eventData.error || 'Import failed', 'error');
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    closeModal('transferModal');
    showToast('Import failed. Please try again.', 'error');
  }
}

// ────────────────────────────
// SCRAPE BROWSER (YouTube Search)
// ────────────────────────────
let socialSelectedItems = {};

async function openScrapeBrowser(platform) {
  const browser = $('#socialBrowser');
  if (!browser) return;
  browser.style.display = '';
  document.body.style.overflow = 'hidden';

  socialSelectedItems = {};
  const grid = $('#socialFileGrid');
  grid.innerHTML = '';
  $('#socialSearchInput').value = '';
  $('#socialEmpty').style.display = '';
  $('#socialLoading').style.display = 'none';
  $('#socialBrowserFooter').style.display = 'none';

  const platformNames = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', twitter: 'Twitter/X' };
  $('#socialBrowserTitle').textContent = `${platformNames[platform] || platform} Search`;

  $('#socialBrowserClose').onclick = () => closeScrapeBrowser();

  let searchTimeout;
  const searchInput = $('#socialSearchInput');
  searchInput.onkeyup = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const q = searchInput.value.trim();
      if (q.length >= 2) performScrapeSearch(platform, q);
    }, 400);
  };
  searchInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimeout);
      const q = searchInput.value.trim();
      if (q) performScrapeSearch(platform, q);
    }
  };

  $('#socialImportBtn').onclick = () => {
    const items = Object.values(socialSelectedItems);
    if (items.length === 0) return;
    closeScrapeBrowser();
    importUrlItems(items);
  };

  setTimeout(() => searchInput.focus(), 100);
}

function closeScrapeBrowser() {
  const browser = $('#socialBrowser');
  if (browser) browser.style.display = 'none';
  document.body.style.overflow = '';
}

async function performScrapeSearch(platform, query) {
  const grid = $('#socialFileGrid');
  const loading = $('#socialLoading');
  const empty = $('#socialEmpty');

  grid.innerHTML = '';
  loading.style.display = '';
  empty.style.display = 'none';

  try {
    const data = await API.get(`/social/${platform}/scrape?q=${encodeURIComponent(query)}`);
    loading.style.display = 'none';

    if (!data.items || data.items.length === 0) {
      empty.style.display = '';
      empty.querySelector('p').textContent = 'No results found.';
      return;
    }

    data.items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'drive-file-item';
      el.dataset.fileId = item.id;
      el.innerHTML = `
        <div class="drive-file-thumb">
          ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" loading="lazy" />` : `<div class="drive-file-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </div>`}
          <div class="drive-file-check">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
          </div>
          ${item.category ? `<span class="social-category-badge">${item.category}</span>` : ''}
          ${item.duration ? `<span class="social-duration-badge">${formatDuration(item.duration)}</span>` : ''}
        </div>
        <span class="drive-file-name">${item.title || item.id}</span>
        ${item.author ? `<span class="drive-file-meta">${item.author}</span>` : ''}
      `;

      el.addEventListener('click', () => {
        if (socialSelectedItems[item.id]) {
          delete socialSelectedItems[item.id];
          el.classList.remove('selected');
        } else {
          socialSelectedItems[item.id] = item;
          el.classList.add('selected');
        }
        updateSocialSelectionUI();
      });

      grid.appendChild(el);
    });

  } catch (err) {
    loading.style.display = 'none';
    showToast('Search failed', 'error');
  }
}

function updateSocialSelectionUI() {
  const count = Object.keys(socialSelectedItems).length;
  const footer = $('#socialBrowserFooter');
  if (footer) footer.style.display = count > 0 ? '' : 'none';
  const countEl = $('#socialSelectionCount');
  if (countEl) countEl.textContent = `${count} selected`;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function importUrlItems(items) {
  openModal('transferModal');
  const fill = $('#transferProgressFill');
  const countEl = $('#transferCount');
  const statusEl = $('#transferStatus');
  const titleEl = $('#transferTitle');

  titleEl.textContent = 'Importing from URL...';
  fill.style.width = '0%';
  countEl.textContent = `0 / ${items.length} files`;
  statusEl.textContent = 'Starting import...';

  let imported = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const pct = Math.round(((i) / items.length) * 100);
    fill.style.width = pct + '%';
    countEl.textContent = `${i} / ${items.length} files`;
    statusEl.textContent = `Importing: ${item.title || item.id}`;

    try {
      const response = await fetch('/api/social/import-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Account-Id': state.currentUser.id,
        },
        body: JSON.stringify({ url: item.sourceUrl || item.url, action: 'import' }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes('event: done')) { imported++; break; }
        if (buf.includes('event: error')) break;
      }
    } catch (_) {}
  }

  fill.style.width = '100%';
  statusEl.textContent = 'Complete!';
  countEl.textContent = `${imported} / ${items.length} imported`;

  setTimeout(async () => {
    closeModal('transferModal');
    if (imported > 0) {
      showToast(`Imported ${imported} files`, 'success');
      await refreshMedia();
      updateDashboard();
      if (getVisibleMedia().length > 0) {
        $('#onboarding').style.display = 'none';
        $('#dashboardMedia').style.display = '';
        navigateToFolder(state.currentFolderId);
      }
    }
  }, 1200);
}

// ────────────────────────────
// ADMIN SCRAPER COOKIE SETTINGS
// ────────────────────────────
async function renderAdminScraperSettings() {
  const container = $('#adminScraperCookies');
  if (!container) return;

  const platforms = [
    { id: 'youtube', name: 'YouTube', icon: '▶️' },
    { id: 'instagram', name: 'Instagram', icon: '📷' },
    { id: 'tiktok', name: 'TikTok', icon: '🎵' },
    { id: 'twitter', name: 'Twitter/X', icon: '🐦' },
  ];

  let status = {};
  try {
    status = await API.get('/admin/scraper-cookies');
  } catch (_) {}

  container.innerHTML = platforms.map(p => `
    <div class="scraper-cookie-row" data-platform="${p.id}">
      <div class="scraper-cookie-header">
        <span class="scraper-cookie-label">${p.icon} ${p.name}</span>
        <span class="scraper-cookie-status ${status[p.id] ? 'configured' : ''}">${status[p.id] ? '✓ Configured' : '✗ Not set'}</span>
      </div>
      <textarea class="scraper-cookie-input" id="scraperCookie_${p.id}" placeholder="Paste cookie header string from browser DevTools..."></textarea>
      <div class="scraper-cookie-actions">
        <label class="scraper-cookie-file-label">
          <input type="file" class="scraper-cookie-file" data-platform="${p.id}" accept=".txt,.cookie,.cookies" style="display:none;" />
          Upload File
        </label>
        <button class="btn btn-primary scraper-cookie-save" data-platform="${p.id}">Save</button>
        <button class="btn scraper-cookie-clear" data-platform="${p.id}" ${!status[p.id] ? 'disabled' : ''}>Clear</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.scraper-cookie-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const platform = btn.dataset.platform;
      const textarea = $(`#scraperCookie_${platform}`);
      const cookies = textarea.value.trim();
      if (!cookies) {
        showToast('Please paste a cookie string or upload a file', 'error');
        return;
      }
      try {
        await API.put(`/admin/scraper-cookies/${platform}`, { cookies });
        showToast(`${platform} cookies saved`, 'success');
        textarea.value = '';
        renderAdminScraperSettings();
      } catch (err) {
        showToast('Failed to save cookies', 'error');
      }
    });
  });

  container.querySelectorAll('.scraper-cookie-clear').forEach(btn => {
    btn.addEventListener('click', async () => {
      const platform = btn.dataset.platform;
      try {
        await API.del(`/admin/scraper-cookies/${platform}`);
        showToast(`${platform} cookies cleared`, 'info');
        renderAdminScraperSettings();
      } catch (err) {
        showToast('Failed to clear cookies', 'error');
      }
    });
  });

  container.querySelectorAll('.scraper-cookie-file').forEach(input => {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const platform = input.dataset.platform;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result;
        const parsed = parseNetscapeCookieFile(text);
        const textarea = $(`#scraperCookie_${platform}`);
        textarea.value = parsed || text;
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  });
}

function parseNetscapeCookieFile(text) {
  const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const cookies = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 7) {
      cookies.push(`${parts[5]}=${parts[6]}`);
    }
  }
  return cookies.length > 0 ? cookies.join('; ') : null;
}
