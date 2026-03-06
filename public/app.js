/* ═══════════════════════════════════════════
   CloudVault — Application Logic
   Social Media Agency Media Sync Hub
   ═══════════════════════════════════════════ */

// ────────────────────────────
// API HELPER
// ────────────────────────────
const API = {
  async get(path) {
    const res = await fetch(`/api${path}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async postForm(path, formData) {
    const res = await fetch(`/api${path}`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async del(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
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
  connectedAccounts: [],
  gdriveConnected: false,
  gdriveEmail: '',
  gdriveName: '',
  gdriveAccessToken: '',
  gdriveApiKey: '',
  gdriveClientId: '',
  media: [],
  selectedMedia: new Set(),
  currentView: 'dashboard',
  currentPerson: null,
  lightboxIndex: -1,
  lightboxItems: [],
  transferHistory: [],
  adminLoggedIn: false,
  currentUserAccountIds: [],
  unlockedPersonIds: [],
};

function getVisibleMedia() {
  if (state.adminLoggedIn) return state.media;
  if (state.currentUserAccountIds.length === 0) return [];
  return state.media.filter((m) => state.currentUserAccountIds.includes(m.personId));
}

// ── Per-User Viewing Password ──

function isPersonLocked(accountId) {
  if (state.adminLoggedIn) return false;
  const account = state.connectedAccounts.find(a => a.id === accountId);
  if (!account || !account.hasPassword) return false;
  return !state.unlockedPersonIds.includes(accountId);
}

function showPasswordGate(personId, onSuccess) {
  const account = state.connectedAccounts.find(a => a.id === personId);
  const personName = account ? account.name : 'this person';

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-card password-gate-card">
      <div class="password-gate-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h3>Password Required</h3>
      <p>${personName}'s content is password-protected.</p>
      <div class="form-field">
        <input type="password" class="password-gate-input" placeholder="Enter viewing password" autocomplete="off" />
      </div>
      <div class="password-gate-error" style="display:none;">Incorrect password. Try again.</div>
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-ok password-unlock-btn">Unlock</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const input = overlay.querySelector('.password-gate-input');
  const errorEl = overlay.querySelector('.password-gate-error');
  input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('.password-unlock-btn').click();
  });

  overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('.password-unlock-btn').addEventListener('click', async () => {
    const password = input.value;
    if (!password) { input.focus(); return; }
    try {
      const result = await API.post(`/accounts/${personId}/verify-password`, { password });
      if (result.success) {
        state.unlockedPersonIds.push(personId);
        overlay.remove();
        onSuccess();
      }
    } catch (err) {
      errorEl.style.display = '';
      input.value = '';
      input.focus();
    }
  });
}

function showSetPasswordDialog(accountId, accountName, onComplete) {
  const account = state.connectedAccounts.find(a => a.id === accountId);
  const hasExisting = account && account.hasPassword;

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-card">
      <h3>${hasExisting ? 'Change' : 'Set'} Viewing Password</h3>
      <p>Set a password that others must enter to view ${accountName}'s content. Leave blank to remove.</p>
      <div class="form-field">
        <input type="password" class="set-password-input" placeholder="${hasExisting ? 'New password (blank to remove)' : 'Enter a password'}" autocomplete="off" />
      </div>
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-ok password-save-btn">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const input = overlay.querySelector('.set-password-input');
  input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('.password-save-btn').click();
  });

  overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('.password-save-btn').addEventListener('click', async () => {
    const password = input.value.trim();
    try {
      const result = await API.post(`/accounts/${accountId}/password`, { password: password || null });
      overlay.remove();
      if (account) account.hasPassword = result.hasPassword;
      showToast(
        result.hasPassword
          ? `Viewing password set for ${accountName}`
          : `Viewing password removed for ${accountName}`,
        result.hasPassword ? 'success' : 'info'
      );
      if (onComplete) onComplete(result.hasPassword);
    } catch (err) {
      showToast('Failed to update password: ' + err.message, 'error');
    }
  });
}

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
    renderConnectedAccounts();
  } catch (err) {
    console.error('Failed to load accounts:', err);
  }
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
// INIT
// ────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initThemeToggle();
  initNavigation();
  initModals();
  initUpload();
  initFilters();
  initLightbox();
  initDownloads();
  initSearch();
  initSidebarToggle();
  initAdmin();

  // Check for Google Drive OAuth callback
  const urlParams = new URLSearchParams(window.location.search);
  const gdriveParam = urlParams.get('gdrive');
  if (gdriveParam === 'connected') {
    showToast('Google Drive connected successfully', 'success');
    window.history.replaceState({}, '', '/');
  } else if (gdriveParam === 'error') {
    const reason = urlParams.get('reason') || 'Unknown error';
    showToast('Google Drive connection failed: ' + reason, 'error');
    window.history.replaceState({}, '', '/');
  }

  // Load persisted data from server
  try {
    await refreshAccounts();
    await refreshMedia();
    const gdrive = await API.get('/gdrive/status');
    state.gdriveConnected = gdrive.connected;
    if (gdrive.connected) {
      state.gdriveEmail = gdrive.email || '';
      state.gdriveName = gdrive.name || '';
      state.gdriveAccessToken = gdrive.accessToken || '';
      state.gdriveApiKey = gdrive.apiKey || '';
      state.gdriveClientId = gdrive.clientId || '';
    }

    // Track all accounts as "ours" for this session
    state.currentUserAccountIds = state.connectedAccounts.map((a) => a.id);

    if (state.media.length > 0) {
      $('#onboarding').style.display = 'none';
      $('#recentSection').style.display = '';
      renderRecentMedia();
    }
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }

  updateDashboard();
  renderConnectedAccounts();
  updateGDriveModal();
  populateFilterPeople();

  // After OAuth callback, auto-open the modal in connected state
  if (gdriveParam === 'connected' && state.gdriveConnected) {
    openModal('gdriveModal');
  }
});

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

  $('#goToMediaBtn').addEventListener('click', () => switchView('media'));
}

function switchView(view) {
  state.currentView = view;

  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  $(`.nav-item[data-view="${view}"]`).classList.add('active');

  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view${capitalize(view)}`).classList.add('active');

  if (view === 'people') {
    $('#personDetail').style.display = 'none';
    $('#peopleGrid').style.display = '';
  }

  if (view === 'media') renderAllMedia();
  if (view === 'people') renderPeopleGrid();
  if (view === 'downloads') renderTransferHistory();
  if (view === 'admin' && state.adminLoggedIn) renderAdminPanel();

  // Close sidebar on mobile
  $('#sidebar').classList.remove('open');
  $('#sidebarBackdrop').classList.remove('active');

  // Sync mobile nav active state
  $$('.mobile-nav-item').forEach((a) => a.classList.remove('active'));
  const mobileNavItem = $(`.mobile-nav-item[data-view="${view}"]`);
  if (mobileNavItem) mobileNavItem.classList.add('active');
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
  $('#connectICloudBtn').addEventListener('click', () => openICloudModal());
  $('#ctaConnect').addEventListener('click', () => openICloudModal());
  $('#icloudModalClose').addEventListener('click', () => closeModal('icloudModal'));
  $('#icloudModal .modal-backdrop').addEventListener('click', () => closeModal('icloudModal'));

  $('#importContinueBtn').addEventListener('click', handleImportContinue);
  initImportPickers();

  // Google Drive
  $('#connectGDriveBtn').addEventListener('click', () => {
    updateGDriveModal();
    openModal('gdriveModal');
  });
  $('#gdriveModalClose').addEventListener('click', () => closeModal('gdriveModal'));
  $('#gdriveModal .modal-backdrop').addEventListener('click', () => closeModal('gdriveModal'));
  $('#googleSignInBtn').addEventListener('click', handleGDriveConnect);
  $('#gdriveImportBtn').addEventListener('click', startGDriveImport);
  $('#gdriveDisconnectBtn').addEventListener('click', handleGDriveDisconnect);
}

function openICloudModal() {
  $('#icloudStep1').style.display = '';
  $('#icloudStep2').style.display = 'none';
  $('#icloudStep3').style.display = 'none';
  // Clear previous import state
  _importFiles.forEach(entry => { if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl); });
  _importFiles.clear();
  $('#importUserName').value = '';
  $('#importUserEmail').value = '';
  $('#importPreviewGrid').innerHTML = '';
  $('#importPreviewContainer').style.display = 'none';
  $('#importSelectedBtn').disabled = true;
  $('#importSelectedBtn').innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="16"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
    Import Selected (0)
  `;
  openModal('icloudModal');
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
// IMPORT MEDIA (replaces simulated iCloud)
// ────────────────────────────

// Map<string, { file: File, selected: boolean, objectUrl: string|null }>
let _importFiles = new Map();

async function handleImportContinue() {
  const nameVal = $('#importUserName').value.trim();
  if (!nameVal) {
    showToast('Please enter your name', 'error');
    $('#importUserName').focus();
    return;
  }

  const emailVal = $('#importUserEmail').value.trim();

  // Step 1 -> Step 2: show loading
  $('#icloudStep1').style.display = 'none';
  $('#icloudStep2').style.display = '';

  try {
    const account = await API.post('/accounts', { name: nameVal, email: emailVal || undefined });

    state.connectedAccounts.push(account);
    state.currentUserAccountIds.push(account.id);
    renderConnectedAccounts();

    // Step 2 -> Step 3: file selection
    $('#icloudStep2').style.display = 'none';
    $('#icloudStep3').style.display = '';

    // Render identity bar
    $('#importIdentityBar').innerHTML = `
      <span>Importing as: <strong>${account.name}</strong>${account.email ? ` (${account.email})` : ''}</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="edit-link" id="importSetPassword">${account.hasPassword ? 'Change Password' : 'Set Password'}</span>
        <span class="edit-link" id="importEditIdentity">Edit</span>
      </div>
    `;
    $('#importSetPassword').addEventListener('click', () => {
      showSetPasswordDialog(account.id, account.name, (hasPassword) => {
        account.hasPassword = hasPassword;
        const el = document.getElementById('importSetPassword');
        if (el) el.textContent = hasPassword ? 'Change Password' : 'Set Password';
      });
    });
    $('#importEditIdentity').addEventListener('click', () => {
      $('#icloudStep3').style.display = 'none';
      $('#icloudStep1').style.display = '';
      $('#importUserName').value = account.name;
      $('#importUserEmail').value = account.email.includes('@imported.local') ? '' : account.email;
    });

    // Store account ID
    $('#icloudStep3').dataset.accountId = account.id;

    // Hide folder picker if not supported
    if (!('webkitdirectory' in document.createElement('input'))) {
      $('#pickFolderBtn').style.display = 'none';
    }

    showToast(`Account created for ${account.name}`, 'success');
  } catch (err) {
    showToast('Failed to create account: ' + err.message, 'error');
    $('#icloudStep2').style.display = 'none';
    $('#icloudStep1').style.display = '';
  }
}

function initImportPickers() {
  const fileInput = document.getElementById('fileInput');
  const folderInput = document.getElementById('folderInput');

  if ($('#pickFilesBtn')) {
    $('#pickFilesBtn').addEventListener('click', () => fileInput.click());
  }
  if ($('#pickFolderBtn')) {
    $('#pickFolderBtn').addEventListener('click', () => folderInput.click());
  }

  fileInput.addEventListener('change', (e) => {
    addFilesToPreview(Array.from(e.target.files));
    e.target.value = ''; // allow re-selecting same files
  });

  folderInput.addEventListener('change', (e) => {
    const mediaFiles = Array.from(e.target.files).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/') ||
      f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif')
    );
    addFilesToPreview(mediaFiles);
    e.target.value = '';
  });

  // Drag and drop on the upload zone
  const zone = document.getElementById('uploadZone');
  if (zone) {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const mediaFiles = Array.from(e.dataTransfer.files).filter(f =>
        f.type.startsWith('image/') || f.type.startsWith('video/') ||
        f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif')
      );
      addFilesToPreview(mediaFiles);
    });
  }

  // Toggle all button
  if ($('#importToggleAllBtn')) {
    $('#importToggleAllBtn').addEventListener('click', toggleAllImportFiles);
  }

  // Import selected button
  if ($('#importSelectedBtn')) {
    $('#importSelectedBtn').addEventListener('click', importSelectedFiles);
  }
}

function getFileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function addFilesToPreview(files) {
  const MAX_PREVIEWS = 200;

  for (const file of files) {
    const key = getFileKey(file);
    if (_importFiles.has(key)) continue; // deduplicate

    let objectUrl = null;
    if (file.type.startsWith('image/') && _importFiles.size < MAX_PREVIEWS) {
      objectUrl = URL.createObjectURL(file);
    }

    _importFiles.set(key, { file, selected: true, objectUrl });
  }

  renderPreviewGrid();
}

function renderPreviewGrid() {
  const container = $('#importPreviewContainer');
  const grid = $('#importPreviewGrid');

  if (_importFiles.size === 0) {
    container.style.display = 'none';
    updateImportButton();
    return;
  }

  container.style.display = '';
  let html = '';
  let count = 0;

  for (const [key, entry] of _importFiles) {
    count++;
    if (count > 200) break;

    const selectedClass = entry.selected ? 'selected' : 'deselected';
    const thumbContent = entry.objectUrl
      ? `<img src="${entry.objectUrl}" alt="${entry.file.name}" onerror="this.parentElement.innerHTML='<div class=\\'preview-placeholder\\'><svg viewBox=\\'0 0 20 20\\' fill=\\'currentColor\\'><path fill-rule=\\'evenodd\\' d=\\'M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z\\' clip-rule=\\'evenodd\\'/></svg></div>'" />`
      : entry.file.type.startsWith('video/')
        ? `<div class="preview-placeholder video"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg></div>`
        : `<div class="preview-placeholder"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"/></svg></div>`;

    html += `
      <div class="import-preview-item ${selectedClass}" data-key="${key}" title="${entry.file.name}">
        ${thumbContent}
        <div class="import-preview-check">
          <svg viewBox="0 0 12 12" fill="white" width="10" height="10"><path d="M10 3L4.5 8.5 2 6" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
    `;
  }

  if (_importFiles.size > 200) {
    html += `<div class="import-preview-overflow">+${_importFiles.size - 200} more</div>`;
  }

  grid.innerHTML = html;

  // Attach click handlers
  grid.querySelectorAll('.import-preview-item').forEach(item => {
    item.addEventListener('click', () => {
      const key = item.dataset.key;
      const entry = _importFiles.get(key);
      if (!entry) return;
      entry.selected = !entry.selected;
      item.classList.toggle('selected', entry.selected);
      item.classList.toggle('deselected', !entry.selected);
      updateImportSummary();
      updateImportButton();
    });
  });

  updateImportSummary();
  updateImportButton();
}

function updateImportSummary() {
  const selected = Array.from(_importFiles.values()).filter(e => e.selected);
  const totalBytes = selected.reduce((s, e) => s + e.file.size, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
  $('#importSelectionSummary').textContent = `${selected.length} of ${_importFiles.size} files selected (${totalMB} MB)`;

  // Update toggle button text
  const allSelected = selected.length === _importFiles.size;
  $('#importToggleAllBtn').textContent = allSelected ? 'Deselect All' : 'Select All';
}

function updateImportButton() {
  const selected = Array.from(_importFiles.values()).filter(e => e.selected);
  const btn = $('#importSelectedBtn');
  btn.disabled = selected.length === 0;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="16"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
    Import Selected (${selected.length})
  `;
}

function toggleAllImportFiles() {
  const allSelected = Array.from(_importFiles.values()).every(e => e.selected);
  const newState = !allSelected;
  _importFiles.forEach(entry => { entry.selected = newState; });
  renderPreviewGrid();
}

function importSelectedFiles() {
  const accountId = $('#icloudStep3').dataset.accountId;
  if (!accountId) {
    showToast('No account connected', 'error');
    return;
  }

  const selectedFiles = Array.from(_importFiles.values())
    .filter(e => e.selected)
    .map(e => e.file);

  if (selectedFiles.length === 0) {
    showToast('No files selected', 'error');
    return;
  }

  // Clean up object URLs
  _importFiles.forEach(entry => { if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl); });
  _importFiles.clear();

  startUpload(accountId, selectedFiles);
}

// ────────────────────────────
// GOOGLE DRIVE CONNECTION (API-backed)
// ────────────────────────────
async function handleGDriveConnect() {
  // Redirect to Google OAuth — works on both desktop and mobile
  window.location.href = '/api/gdrive/auth';
}

function updateGDriveModal() {
  const signIn = $('#gdriveSignIn');
  const connected = $('#gdriveConnected');

  if (state.gdriveConnected) {
    signIn.style.display = 'none';
    connected.style.display = '';
    $('#gdriveUserEmail').textContent = state.gdriveEmail || 'Connected';
  } else {
    signIn.style.display = '';
    connected.style.display = 'none';
  }
}

async function handleGDriveDisconnect() {
  try {
    await API.del('/gdrive/disconnect');
    state.gdriveConnected = false;
    state.gdriveEmail = '';
    state.gdriveName = '';
    renderConnectedAccounts();
    updateGDriveModal();
    showToast('Google Drive disconnected', 'info');
  } catch (err) {
    showToast('Failed to disconnect: ' + err.message, 'error');
  }
}

async function startGDriveImport() {
  // Only OAuth token is required; API key is optional for quota attribution
  if (!state.gdriveAccessToken) {
    showToast('Not authenticated. Please reconnect Google Drive.', 'error');
    return;
  }

  closeModal('gdriveModal');

  // Load the Google Picker API
  try {
    await new Promise((resolve, reject) => {
      if (window.google && window.google.picker) {
        resolve();
        return;
      }
      gapi.load('picker', { callback: resolve, onerror: reject });
    });
  } catch (err) {
    showToast('Failed to load Google Picker', 'error');
    return;
  }

  // Build and show the Picker
  try {
    const builder = new google.picker.PickerBuilder()
      .setOAuthToken(state.gdriveAccessToken)
      .setAppId(state.gdriveClientId.split('-')[0])
      .addView(
        new google.picker.DocsView(google.picker.ViewId.DOCS)
          .setMimeTypes('image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,image/bmp,image/tiff,video/mp4,video/quicktime,video/x-msvideo,video/webm,video/3gpp')
          .setMode(google.picker.DocsViewMode.GRID)
          .setSelectFolderEnabled(false)
      )
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setTitle('Select photos & videos to import')
      .setCallback(handlePickerResult);

    // Only set developer key if configured and non-empty
    if (state.gdriveApiKey) {
      builder.setDeveloperKey(state.gdriveApiKey);
    }

    const picker = builder.build();
    picker.setVisible(true);
  } catch (err) {
    console.error('Picker build error:', err);
    showToast('Failed to open file picker: ' + (err.message || 'Unknown error'), 'error');
  }
}

async function handlePickerResult(data) {
  if (data.action === google.picker.Action.CANCEL) return;

  // Handle Picker errors
  if (data.action === google.picker.Action.ERROR || data.action === 'error') {
    console.error('Google Picker error:', JSON.stringify(data));
    showToast('Google Picker error. Check that the Picker API is enabled in Google Cloud Console.', 'error');
    return;
  }

  if (data.action !== google.picker.Action.PICKED) return;

  const selectedFiles = data.docs.map(doc => ({
    id: doc.id,
    name: doc.name,
    mimeType: doc.mimeType,
  }));

  if (selectedFiles.length === 0) return;

  // Show import progress modal
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
    // POST to /api/gdrive/import — reads SSE response via fetch + ReadableStream
    const response = await fetch('/api/gdrive/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: selectedFiles }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          try {
            const eventData = JSON.parse(jsonStr);

            if (eventType === 'progress') {
              if (eventData.status === 'importing') {
                const pct = eventData.total > 0 ? Math.round((eventData.current / eventData.total) * 100) : 0;
                fill.style.width = pct + '%';
                countEl.textContent = `${eventData.current} / ${eventData.total} files`;
                statusEl.textContent = eventData.fileName ? `Importing: ${eventData.fileName}` : eventData.message;
              }
            } else if (eventType === 'done') {
              fill.style.width = '100%';
              statusEl.textContent = 'Complete!';
              countEl.textContent = `${eventData.imported} imported`;

              setTimeout(async () => {
                closeModal('transferModal');
                fill.style.width = '0%';
                titleEl.textContent = 'Transferring to Google Drive...';

                if (eventData.imported > 0) {
                  showToast(`Imported ${eventData.imported} files from Google Drive`, 'success');
                  await refreshAccounts();
                  await refreshMedia();
                  updateDashboard();
                  renderConnectedAccounts();
                  populateFilterPeople();

                  if (state.media.length > 0) {
                    $('#onboarding').style.display = 'none';
                    $('#recentSection').style.display = '';
                    renderRecentMedia();
                  }
                  if (state.currentView === 'media') renderAllMedia();
                  if (state.currentView === 'people') renderPeopleGrid();
                } else {
                  showToast(eventData.message || 'No new files to import', 'info');
                }
              }, 1200);
            } else if (eventType === 'error') {
              closeModal('transferModal');
              fill.style.width = '0%';
              titleEl.textContent = 'Transferring to Google Drive...';
              showToast('Import failed: ' + eventData.message, 'error');
            }
          } catch (parseErr) {
            // skip unparseable lines
          }
        }
      }
    }
  } catch (err) {
    closeModal('transferModal');
    fill.style.width = '0%';
    $('#transferTitle').textContent = 'Transferring to Google Drive...';
    showToast('Import connection lost. Please try again.', 'error');
  }
}

// ────────────────────────────
// CONNECTED ACCOUNTS
// ────────────────────────────
function renderConnectedAccounts() {
  const container = $('#connectedAccounts');
  let html = '';

  const visibleAccounts = state.adminLoggedIn
    ? state.connectedAccounts
    : state.connectedAccounts.filter((a) => state.currentUserAccountIds.includes(a.id));

  visibleAccounts.forEach((acc) => {
    const lockOpacity = acc.hasPassword ? '1' : '0.35';
    const escapedName = acc.name.replace(/'/g, "\\'");
    html += `
      <div class="account-chip" data-id="${acc.id}">
        <span class="dot"></span>
        <span class="name">${acc.name}</span>
        <span class="type">iCloud</span>
        <button class="account-password-btn" onclick="event.stopPropagation(); showSetPasswordDialog('${acc.id}', '${escapedName}', () => refreshAccounts())" title="${acc.hasPassword ? 'Change viewing password' : 'Set viewing password'}">
          <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style="opacity:${lockOpacity}"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>
        </button>
        <button class="remove-account" onclick="removeAccount('${acc.id}')">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    `;
  });

  if (state.gdriveConnected) {
    html += `
      <div class="account-chip">
        <span class="dot" style="background: var(--blue)"></span>
        <span class="name">Google Drive</span>
        <span class="type">Storage</span>
      </div>
    `;
  }

  container.innerHTML = html;
}

async function removeAccount(id) {
  try {
    await API.del(`/accounts/${id}`);
    state.connectedAccounts = state.connectedAccounts.filter((a) => a.id !== id);
    renderConnectedAccounts();
    showToast('Account disconnected', 'info');
  } catch (err) {
    showToast('Failed to disconnect account', 'error');
  }
}

// ────────────────────────────
// FILE UPLOAD (topbar button)
// ────────────────────────────
function initUpload() {
  // Topbar Upload button
  $('#syncAllBtn').addEventListener('click', () => {
    if (state.connectedAccounts.length === 0) {
      showToast('Import media first', 'error');
      openICloudModal();
      return;
    }
    if (state.connectedAccounts.length === 1) {
      quickUpload(state.connectedAccounts[0].id);
    } else {
      showPersonPicker();
    }
  });
}

function quickUpload(accountId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,video/*,.heic,.heif';
  input.onchange = () => startUpload(accountId, Array.from(input.files));
  input.click();
}

function showPersonPicker() {
  // Simple prompt-based picker for multiple accounts
  const names = state.connectedAccounts.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
  const choice = prompt(`Choose a person to upload for:\n${names}\n\nEnter number:`);
  const idx = parseInt(choice) - 1;
  if (idx >= 0 && idx < state.connectedAccounts.length) {
    quickUpload(state.connectedAccounts[idx].id);
  }
}

async function startUpload(accountId, files) {
  if (!files || files.length === 0) {
    showToast('No files selected', 'error');
    return;
  }

  closeModal('icloudModal');

  const syncBar = $('#syncProgress');
  const fill = $('#progressFill');
  const label = $('#syncLabel');
  const percent = $('#syncPercent');

  syncBar.classList.add('active');
  label.textContent = `Uploading ${files.length} files...`;
  fill.style.width = '0%';
  percent.textContent = '0%';

  const BATCH_SIZE = 5;
  let uploaded = 0;
  let totalUploaded = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = Array.from(files).slice(i, i + BATCH_SIZE);
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

  // Refresh data from server
  await refreshMedia();
  state.currentUserAccountIds = state.connectedAccounts.map((a) => a.id);
  updateDashboard();
  populateFilterPeople();

  if (totalUploaded > 0) {
    showToast(`Uploaded ${totalUploaded} files`, 'success');
    $('#onboarding').style.display = 'none';
    $('#recentSection').style.display = '';
    renderRecentMedia();
  }

  _selectedFiles = [];
}

// ────────────────────────────
// DASHBOARD
// ────────────────────────────
async function updateDashboard() {
  try {
    const stats = await API.get('/media/stats');
    $('#totalPhotos').textContent = stats.photos;
    $('#totalVideos').textContent = stats.videos;
    $('#totalPeople').textContent = stats.people;
    $('#totalStorage').textContent = stats.totalGB + ' GB';

    const pct = Math.min((parseFloat(stats.totalGB) / 50) * 100, 100);
    $('#storageFill').style.width = pct + '%';
    $('#storageText').textContent = `${stats.totalGB} GB / 50 GB`;
  } catch (err) {
    // Fallback to client-side calc
    const visible = getVisibleMedia();
    const photos = visible.filter((m) => m.type === 'photo');
    const videos = visible.filter((m) => m.type === 'video');
    const people = new Set(visible.map((m) => m.personId));
    const totalGB = (visible.reduce((sum, m) => sum + m.sizeMB, 0) / 1024).toFixed(1);

    $('#totalPhotos').textContent = photos.length;
    $('#totalVideos').textContent = videos.length;
    $('#totalPeople').textContent = people.size;
    $('#totalStorage').textContent = totalGB + ' GB';

    const pct = Math.min((parseFloat(totalGB) / 50) * 100, 100);
    $('#storageFill').style.width = pct + '%';
    $('#storageText').textContent = `${totalGB} GB / 50 GB`;
  }
}

function renderRecentMedia() {
  const recent = [...getVisibleMedia()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12);

  const grid = $('#recentGrid');
  grid.innerHTML = recent.map((item) => createMediaCard(item)).join('');
  attachMediaCardEvents(grid);
}

// ────────────────────────────
// MEDIA CARDS
// ────────────────────────────
function createMediaCard(item, selectable = false) {
  const dateStr = new Date(item.date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const selected = state.selectedMedia.has(item.id) ? ' selected' : '';

  // Use thumbnail if available, otherwise show placeholder
  const thumbContent = item.thumbnail
    ? `<img class="thumb" src="${item.thumbnail}" alt="${item.name}" loading="lazy" />`
    : `<div class="thumb video-thumb-placeholder"><svg viewBox="0 0 48 48" fill="none" width="48" height="48"><circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/><path d="M20 16l12 8-12 8z" fill="currentColor" opacity="0.4"/></svg></div>`;

  return `
    <div class="media-card${selected}" data-id="${item.id}" data-type="${item.type}">
      ${thumbContent}
      ${
        item.type === 'video'
          ? `<div class="video-badge">
              <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg>
              ${item.duration || 'Video'}
            </div>`
          : ''
      }
      <div class="select-check"></div>
      <div class="card-overlay">
        <span class="card-name">${item.name}</span>
        <span class="card-meta">${item.personName} &middot; ${dateStr} &middot; ${item.sizeMB} MB</span>
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

// ────────────────────────────
// SELECTION
// ────────────────────────────
function toggleSelect(id, card) {
  if (state.selectedMedia.has(id)) {
    state.selectedMedia.delete(id);
    card.classList.remove('selected');
  } else {
    state.selectedMedia.add(id);
    card.classList.add('selected');
  }
  updateSelectionInfo();
}

function updateSelectionInfo() {
  const info = $('#selectionInfo');
  const count = state.selectedMedia.size;

  if (count > 0) {
    info.style.display = '';
    $('#selectedCount').textContent = `${count} selected`;
  } else {
    info.style.display = 'none';
  }
}

// ────────────────────────────
// ALL MEDIA VIEW
// ────────────────────────────
function initFilters() {
  ['filterType', 'filterPerson', 'filterDate', 'filterSort'].forEach((id) => {
    $(`#${id}`).addEventListener('change', renderAllMedia);
  });

  $('#selectAllBtn').addEventListener('click', () => {
    const grid = $('#allMediaGrid');
    grid.querySelectorAll('.media-card').forEach((card) => {
      const id = card.dataset.id;
      state.selectedMedia.add(id);
      card.classList.add('selected');
    });
    updateSelectionInfo();
  });

  $('#clearSelectionBtn').addEventListener('click', () => {
    state.selectedMedia.clear();
    $$('.media-card.selected').forEach((c) => c.classList.remove('selected'));
    updateSelectionInfo();
  });
}

function populateFilterPeople() {
  const select = $('#filterPerson');
  const people = new Map();
  getVisibleMedia().forEach((m) => people.set(m.personId, m.personName));

  select.innerHTML = '<option value="all">Everyone</option>';
  people.forEach((name, id) => {
    select.innerHTML += `<option value="${id}">${name}</option>`;
  });
}

function getFilteredMedia() {
  let items = [...getVisibleMedia()];

  const type = $('#filterType').value;
  const person = $('#filterPerson').value;
  const date = $('#filterDate').value;
  const sort = $('#filterSort').value;

  if (type !== 'all') items = items.filter((m) => m.type === type);
  if (person !== 'all') items = items.filter((m) => m.personId === person);

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
    grid.innerHTML = `
      <div class="empty-view-state">
        <svg viewBox="0 0 64 64" fill="none" width="64" height="64">
          <rect x="8" y="12" width="48" height="36" rx="4" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
          <path d="M8 40l12-12 8 8 12-12 16 16" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
          <circle cx="22" cy="24" r="4" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
        </svg>
        <h3>No media yet</h3>
        <p>Connect an iCloud account and upload files to browse your media here.</p>
      </div>
    `;
    return;
  }

  const items = getFilteredMedia();
  grid.innerHTML = items.map((item) => createMediaCard(item, true)).join('');
  attachMediaCardEvents(grid);
  updateSelectionInfo();
}

// ────────────────────────────
// PEOPLE VIEW
// ────────────────────────────
function renderPeopleGrid() {
  const visible = getVisibleMedia();
  const peopleMap = new Map();

  visible.forEach((m) => {
    if (!peopleMap.has(m.personId)) {
      peopleMap.set(m.personId, {
        id: m.personId,
        name: m.personName,
        email: m.personEmail,
        avatar: m.personName.split(' ').map((w) => w[0]).join(''),
        photos: 0,
        videos: 0,
        totalSize: 0,
      });
    }
    const p = peopleMap.get(m.personId);
    if (m.type === 'photo') p.photos++;
    else p.videos++;
    p.totalSize += m.sizeMB;
  });

  const grid = $('#peopleGrid');

  if (peopleMap.size === 0) {
    grid.innerHTML = `
      <div class="empty-view-state">
        <svg viewBox="0 0 64 64" fill="none" width="64" height="64">
          <circle cx="32" cy="24" r="12" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
          <path d="M12 52c0-11.046 8.954-20 20-20s20 8.954 20 20" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
        </svg>
        <h3>No people yet</h3>
        <p>Connect an iCloud account and upload to see people here.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = Array.from(peopleMap.values())
    .map((p) => {
      const acct = state.connectedAccounts.find(a => a.id === p.id);
      const showLock = acct && acct.hasPassword && !state.adminLoggedIn;
      return `
    <div class="person-card ${showLock ? 'person-locked' : ''}" data-person="${p.id}">
      ${showLock ? '<div class="person-lock-badge"><svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg></div>' : ''}
      <div class="person-avatar">${p.avatar}</div>
      <h3>${p.name}</h3>
      <span class="person-email">${p.email}</span>
      <div class="person-stats">
        <div class="person-stat">
          <span class="pval">${p.photos}</span>
          <span class="plabel">Photos</span>
        </div>
        <div class="person-stat">
          <span class="pval">${p.videos}</span>
          <span class="plabel">Videos</span>
        </div>
        <div class="person-stat">
          <span class="pval">${(p.totalSize / 1024).toFixed(1)}</span>
          <span class="plabel">GB</span>
        </div>
      </div>
    </div>
  `;
    })
    .join('');

  grid.querySelectorAll('.person-card').forEach((card) => {
    card.addEventListener('click', () => openPersonDetail(card.dataset.person));
  });
}

function openPersonDetail(personId) {
  // Password gate: if this person's content is protected, prompt first
  if (isPersonLocked(personId)) {
    showPasswordGate(personId, () => openPersonDetail(personId));
    return;
  }

  state.currentPerson = personId;

  const personMedia = getVisibleMedia().filter((m) => m.personId === personId);
  if (personMedia.length === 0) return;

  const person = personMedia[0];
  const photos = personMedia.filter((m) => m.type === 'photo').length;
  const videos = personMedia.filter((m) => m.type === 'video').length;

  $('#peopleGrid').style.display = 'none';
  $('#personDetail').style.display = '';

  const avatar = person.personName.split(' ').map((w) => w[0]).join('');
  $('#personHeader').innerHTML = `
    <div class="person-avatar">${avatar}</div>
    <div>
      <h2>${person.personName}</h2>
      <span class="person-email">${person.personEmail}</span>
    </div>
    <div class="person-stats" style="margin-left:auto;">
      <div class="person-stat"><span class="pval">${photos}</span><span class="plabel">Photos</span></div>
      <div class="person-stat"><span class="pval">${videos}</span><span class="plabel">Videos</span></div>
    </div>
  `;

  const categories = [...new Set(personMedia.map((m) => m.category).filter(Boolean))];
  $('#personFilters').innerHTML = `
    <button class="person-filter-btn active" data-filter="all">All</button>
    <button class="person-filter-btn" data-filter="photo">Photos</button>
    <button class="person-filter-btn" data-filter="video">Videos</button>
    ${categories.map((c) => `<button class="person-filter-btn" data-filter="cat:${c}">${c}</button>`).join('')}
  `;

  $('#personFilters').querySelectorAll('.person-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#personFilters').querySelectorAll('.person-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderPersonMedia(personId, btn.dataset.filter);
    });
  });

  $('#backToPeople').onclick = () => {
    $('#personDetail').style.display = 'none';
    $('#peopleGrid').style.display = '';
    state.currentPerson = null;
  };

  renderPersonMedia(personId, 'all');
}

function renderPersonMedia(personId, filter) {
  let items = getVisibleMedia().filter((m) => m.personId === personId);

  if (filter === 'photo') items = items.filter((m) => m.type === 'photo');
  else if (filter === 'video') items = items.filter((m) => m.type === 'video');
  else if (filter.startsWith('cat:')) items = items.filter((m) => m.category === filter.slice(4));

  items.sort((a, b) => b.timestamp - a.timestamp);

  const grid = $('#personMediaGrid');
  grid.innerHTML = items.map((item) => createMediaCard(item)).join('');
  attachMediaCardEvents(grid);
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
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Show real images/videos from server
  if (item.type === 'video') {
    const poster = item.thumbnail || '';
    mediaContainer.innerHTML = `<video src="${item.original}" controls poster="${poster}" style="max-width:100%;max-height:75vh;border-radius:10px;"></video>`;
  } else {
    mediaContainer.innerHTML = `<img src="${item.original}" alt="${item.name}" />`;
  }

  // Build metadata lines
  const metaParts = [item.personName, dateStr, `${item.sizeMB} MB`];
  if (item.resolution) metaParts.push(item.resolution);
  if (item.location) metaParts.push(item.location);

  const exifParts = [];
  if (item.cameraMake || item.cameraModel) exifParts.push([item.cameraMake, item.cameraModel].filter(Boolean).join(' '));
  if (item.latitude && item.longitude) exifParts.push(`GPS: ${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`);
  exifParts.push(`iCloud: ${item.icloudName}`);

  $('#lightboxInfo').innerHTML = `
    <div class="lb-details">
      <h3>${item.name}</h3>
      <p>${metaParts.join(' &middot; ')}</p>
      <p>${exifParts.join(' &middot; ')}</p>
    </div>
    <div class="lb-actions">
      <button class="lb-action-btn" onclick="downloadSingle('${item.id}')">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        Download
      </button>
      <button class="lb-action-btn" onclick="transferSingleToDrive('${item.id}')">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M7.71 3.5L1.15 15l3.43 5.97L11.14 9.47 7.71 3.5z"/></svg>
        To Drive
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
        if (state.currentView === 'media') renderAllMedia();
        return;
      }

      const results = getVisibleMedia().filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.personName.toLowerCase().includes(query) ||
          m.personEmail.toLowerCase().includes(query) ||
          (m.location && m.location.toLowerCase().includes(query)) ||
          (m.category && m.category.toLowerCase().includes(query))
      );

      switchView('media');
      const grid = $('#allMediaGrid');
      grid.innerHTML = results.map((item) => createMediaCard(item, true)).join('');
      attachMediaCardEvents(grid);
    }, 300);
  });
}

// ────────────────────────────
// DOWNLOADS (real file serving)
// ────────────────────────────
function initDownloads() {
  $('#downloadAllBtn').addEventListener('click', () => {
    if (state.selectedMedia.size > 0) {
      downloadSelected();
    } else {
      downloadAll();
    }
  });

  $('#downloadZipBtn').addEventListener('click', downloadAll);

  $('#gdriveTransferBtn').addEventListener('click', () => {
    if (state.selectedMedia.size > 0) {
      transferSelectedToDrive();
    } else {
      transferAllToDrive();
    }
  });

  $('#transferDriveBtn').addEventListener('click', transferAllToDrive);
}

function downloadSingle(mediaId) {
  const item = state.media.find((m) => m.id === mediaId);
  if (!item) return;

  showToast(`Downloading ${item.name}...`, 'info');

  // Real file download from server
  const a = document.createElement('a');
  a.href = `/api/download/${mediaId}`;
  a.download = item.name;
  a.click();

  addTransferHistory('download', `Downloaded ${item.name}`, item.sizeMB);
}

async function downloadSelected() {
  const count = state.selectedMedia.size;
  if (count === 0) {
    showToast('No files selected', 'error');
    return;
  }

  const ids = Array.from(state.selectedMedia);
  const items = state.media.filter((m) => state.selectedMedia.has(m.id));
  const totalSize = items.reduce((sum, m) => sum + m.sizeMB, 0);

  showToast(`Preparing ${count} files for download...`, 'info');

  try {
    const res = await fetch('/api/download/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cloudvault-selected.zip';
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Downloaded ${count} files`, 'success');
    addTransferHistory('download', `Downloaded ${count} selected files`, totalSize);
  } catch (err) {
    showToast('Download failed: ' + err.message, 'error');
  }
}

async function downloadAll() {
  const visible = getVisibleMedia();
  if (visible.length === 0) {
    showToast('No media to download. Upload files first.', 'error');
    return;
  }

  const totalSize = visible.reduce((sum, m) => sum + m.sizeMB, 0);
  showToast(`Preparing all ${visible.length} files for download...`, 'info');

  try {
    const res = await fetch('/api/download/zip-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cloudvault-all.zip';
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Downloaded ${visible.length} files`, 'success');
    addTransferHistory('download', `Downloaded all media (${visible.length} files)`, totalSize);
  } catch (err) {
    showToast('Download failed: ' + err.message, 'error');
  }
}

// ────────────────────────────
// GOOGLE DRIVE TRANSFER
// ────────────────────────────
function transferSingleToDrive(mediaId) {
  if (!state.gdriveConnected) {
    showToast('Connect Google Drive first', 'error');
    openModal('gdriveModal');
    return;
  }

  const item = state.media.find((m) => m.id === mediaId);
  if (!item) return;

  startTransferProgress([item]);
}

function transferSelectedToDrive() {
  if (!state.gdriveConnected) {
    showToast('Connect Google Drive first', 'error');
    openModal('gdriveModal');
    return;
  }

  const count = state.selectedMedia.size;
  if (count === 0) {
    showToast('No files selected', 'error');
    return;
  }

  const items = state.media.filter((m) => state.selectedMedia.has(m.id));
  startTransferProgress(items);
}

function transferAllToDrive() {
  if (!state.gdriveConnected) {
    showToast('Connect Google Drive first', 'error');
    openModal('gdriveModal');
    return;
  }

  const visible = getVisibleMedia();
  if (visible.length === 0) {
    showToast('No media to transfer. Upload files first.', 'error');
    return;
  }

  startTransferProgress(visible);
}

async function startTransferProgress(items) {
  openModal('transferModal');

  const fill = $('#transferProgressFill');
  const countEl = $('#transferCount');
  const statusEl = $('#transferStatus');
  const total = items.length;

  fill.style.width = '0%';
  countEl.textContent = `0 / ${total} files`;
  statusEl.textContent = 'Uploading to Google Drive...';

  try {
    const ids = items.map((m) => m.id);
    const result = await API.post('/gdrive/transfer', { ids });

    // Animate to 100%
    fill.style.width = '100%';
    countEl.textContent = `${result.transferred} / ${total} files`;
    statusEl.textContent = 'Complete!';

    setTimeout(() => {
      closeModal('transferModal');
      fill.style.width = '0%';

      if (result.failed > 0) {
        showToast(`${result.transferred} transferred, ${result.failed} failed`, 'error');
      } else {
        showToast(`${result.transferred} files transferred to Google Drive`, 'success');
      }

      addTransferHistory('transfer', `Transferred ${result.transferred} files to Google Drive`,
        items.reduce((sum, m) => sum + m.sizeMB, 0));
    }, 1000);
  } catch (err) {
    closeModal('transferModal');
    fill.style.width = '0%';

    if (err.message && err.message.includes('not connected')) {
      state.gdriveConnected = false;
      renderConnectedAccounts();
      showToast('Google Drive disconnected. Please reconnect.', 'error');
      openModal('gdriveModal');
    } else {
      showToast('Transfer failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }
}

// ────────────────────────────
// TRANSFER HISTORY
// ────────────────────────────
function addTransferHistory(type, description, sizeMB) {
  state.transferHistory.unshift({
    id: 'th_' + Date.now(),
    type,
    description,
    sizeMB,
    date: new Date().toISOString(),
    status: 'complete',
  });

  if (state.currentView === 'downloads') renderTransferHistory();
}

function renderTransferHistory() {
  const list = $('#historyList');

  if (state.transferHistory.length === 0) {
    list.innerHTML = '<div class="empty-state">No transfers yet</div>';
    return;
  }

  list.innerHTML = state.transferHistory
    .map(
      (item) => `
    <div class="history-item">
      <div class="hi-icon ${item.type}">
        ${
          item.type === 'download'
            ? '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>'
            : '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M7.71 3.5L1.15 15l3.43 5.97L11.14 9.47 7.71 3.5z"/></svg>'
        }
      </div>
      <div class="hi-info">
        <span class="hi-title">${item.description}</span>
        <span class="hi-meta">${new Date(item.date).toLocaleString()} &middot; ${(item.sizeMB / 1024).toFixed(2)} GB</span>
      </div>
      <span class="hi-status ${item.status}">${item.status === 'complete' ? 'Complete' : 'Pending'}</span>
    </div>
  `
    )
    .join('');
}

// ────────────────────────────
// TOAST NOTIFICATIONS
// ────────────────────────────
function showToast(message, type = 'info') {
  const container = $('#toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success:
      '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error:
      '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
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
// ADMIN PANEL (API-backed)
// ────────────────────────────
function initAdmin() {
  $('#adminLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    handleAdminLogin();
  });

  $('#adminLogoutBtn').addEventListener('click', handleAdminLogout);
  $('#clearAllMediaBtn').addEventListener('click', () => confirmAction('Clear All Media', 'This will permanently remove all uploaded photos and videos. This action cannot be undone.', clearAllMedia));
  $('#disconnectAllBtn').addEventListener('click', () => confirmAction('Disconnect All Accounts', 'This will remove all iCloud and Google Drive connections.', disconnectAllAccounts));
}

async function handleAdminLogin() {
  const input = $('#adminPasswordInput');
  const error = $('#adminError');
  const password = input.value;

  try {
    const result = await API.post('/admin/login', { password });
    if (result.success) {
      state.adminLoggedIn = true;
      error.style.display = 'none';
      input.value = '';
      $('#adminLogin').style.display = 'none';
      $('#adminPanel').style.display = '';

      // Admin sees all media
      await refreshMedia();
      await refreshAccounts();
      state.currentUserAccountIds = state.connectedAccounts.map((a) => a.id);
      renderAdminPanel();
      updateDashboard();
      populateFilterPeople();
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
  renderAdminPeopleList();
  renderAdminAccountsList();
}

function renderAdminStats() {
  const photos = state.media.filter((m) => m.type === 'photo').length;
  const videos = state.media.filter((m) => m.type === 'video').length;
  const people = new Set(state.media.map((m) => m.personId)).size;
  const totalGB = (state.media.reduce((sum, m) => sum + m.sizeMB, 0) / 1024).toFixed(1);
  const accounts = state.connectedAccounts.length;

  $('#adminStats').innerHTML = `
    <div class="admin-stat-card"><span class="asv">${state.media.length}</span><span class="asl">Total Files</span></div>
    <div class="admin-stat-card"><span class="asv">${photos}</span><span class="asl">Photos</span></div>
    <div class="admin-stat-card"><span class="asv">${videos}</span><span class="asl">Videos</span></div>
    <div class="admin-stat-card"><span class="asv">${people}</span><span class="asl">People</span></div>
    <div class="admin-stat-card"><span class="asv">${totalGB} GB</span><span class="asl">Storage</span></div>
    <div class="admin-stat-card"><span class="asv">${accounts}</span><span class="asl">Accounts</span></div>
  `;
}

function renderAdminPeopleList() {
  const list = $('#adminPeopleList');
  const peopleMap = new Map();

  state.media.forEach((m) => {
    if (!peopleMap.has(m.personId)) {
      peopleMap.set(m.personId, {
        id: m.personId,
        name: m.personName,
        email: m.personEmail,
        avatar: m.personName.split(' ').map((w) => w[0]).join(''),
        photos: 0,
        videos: 0,
        totalSize: 0,
      });
    }
    const p = peopleMap.get(m.personId);
    if (m.type === 'photo') p.photos++;
    else p.videos++;
    p.totalSize += m.sizeMB;
  });

  if (peopleMap.size === 0) {
    list.innerHTML = '<div class="empty-state">No people yet. Connect iCloud and upload first.</div>';
    return;
  }

  list.innerHTML = Array.from(peopleMap.values())
    .map(
      (p) => `
    <div class="admin-person-row" data-person-id="${p.id}">
      <div class="ap-avatar">${p.avatar}</div>
      <div class="ap-info">
        <span class="ap-name">${p.name}</span>
        <span class="ap-email">${p.email}</span>
      </div>
      <div class="ap-stats">
        <div class="ap-stat-item"><span class="apv">${p.photos}</span><span class="apl">Photos</span></div>
        <div class="ap-stat-item"><span class="apv">${p.videos}</span><span class="apl">Videos</span></div>
        <div class="ap-stat-item"><span class="apv">${(p.totalSize / 1024).toFixed(1)}</span><span class="apl">GB</span></div>
      </div>
      <button class="remove-person-btn" onclick="confirmRemovePerson('${p.id}', '${p.name.replace(/'/g, "\\'")}')">Remove</button>
    </div>
  `
    )
    .join('');
}

function renderAdminAccountsList() {
  const list = $('#adminAccountsList');
  let html = '';

  state.connectedAccounts.forEach((acc) => {
    html += `
      <div class="admin-account-row">
        <span class="aa-dot" style="background: var(--green);"></span>
        <div class="aa-info">
          <span class="aa-name">${acc.name}</span>
          <span class="aa-type">iCloud &middot; ${acc.email}</span>
        </div>
        <button class="remove-person-btn" onclick="confirmAction('Disconnect ${acc.name.replace(/'/g, "\\'")}', 'This will remove the iCloud connection for ${acc.name.replace(/'/g, "\\'")}.',  () => adminRemoveAccount('${acc.id}'))">Disconnect</button>
      </div>
    `;
  });

  if (state.gdriveConnected) {
    html += `
      <div class="admin-account-row">
        <span class="aa-dot" style="background: var(--blue);"></span>
        <div class="aa-info">
          <span class="aa-name">Google Drive</span>
          <span class="aa-type">Storage Connection</span>
        </div>
        <button class="remove-person-btn" onclick="confirmAction('Disconnect Google Drive', 'This will remove the Google Drive connection.', adminDisconnectGDrive)">Disconnect</button>
      </div>
    `;
  }

  if (!html) {
    html = '<div class="empty-state">No accounts connected.</div>';
  }

  list.innerHTML = html;
}

// ────────────────────────────
// ADMIN ACTIONS (API-backed)
// ────────────────────────────
function confirmRemovePerson(personId, personName) {
  const mediaCount = state.media.filter((m) => m.personId === personId).length;
  confirmAction(
    `Remove ${personName}`,
    `This will permanently delete ${mediaCount} files (photos and videos) belonging to ${personName}. This cannot be undone.`,
    () => removePerson(personId, personName)
  );
}

async function removePerson(personId, personName) {
  try {
    await API.del(`/admin/person/${personId}`);
    await refreshMedia();
    await refreshAccounts();
    state.currentUserAccountIds = state.connectedAccounts.map((a) => a.id);

    updateDashboard();
    renderAdminPanel();
    populateFilterPeople();

    if (getVisibleMedia().length > 0) {
      renderRecentMedia();
    } else {
      $('#recentSection').style.display = 'none';
      $('#onboarding').style.display = '';
    }

    showToast(`Removed ${personName} and all their files`, 'success');
  } catch (err) {
    showToast('Failed to remove person: ' + err.message, 'error');
  }
}

async function adminRemoveAccount(accountId) {
  try {
    await API.del(`/accounts/${accountId}`);
    await refreshAccounts();
    state.currentUserAccountIds = state.connectedAccounts.map((a) => a.id);
    renderAdminPanel();
    showToast('Account disconnected', 'success');
  } catch (err) {
    showToast('Failed to disconnect account', 'error');
  }
}

async function adminDisconnectGDrive() {
  try {
    await API.del('/gdrive/disconnect');
    state.gdriveConnected = false;
    renderConnectedAccounts();
    renderAdminPanel();
    showToast('Google Drive disconnected', 'success');
  } catch (err) {
    showToast('Failed to disconnect Google Drive', 'error');
  }
}

async function clearAllMedia() {
  try {
    await API.del('/admin/media/all');
    state.media = [];
    state.selectedMedia.clear();
    updateDashboard();
    renderAdminPanel();
    populateFilterPeople();
    $('#recentSection').style.display = 'none';
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
    state.gdriveConnected = false;
    state.currentUserAccountIds = [];
    renderConnectedAccounts();
    renderAdminPanel();
    showToast('All accounts disconnected', 'success');
  } catch (err) {
    showToast('Failed to disconnect accounts: ' + err.message, 'error');
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
