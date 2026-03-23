/* =====================================================================
   TeleBlast – Renderer (app.js) - FULL VERSION WITH LICENSE & MEDIA
   ===================================================================== */

// ── State ──────────────────────────────────────────────────────────────
let accounts = [];
let currentBlastId = null;
let currentInviteId = null;
let scrapedMembers = [];
let activeMonitorAccountId = null;
let activePeerId = null;
let activePeerName = null;
let selectedFilePath = null; // Path file untuk media blast

// ── Helpers ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (date) => {
  if (!date) return '';
  const d = new Date(typeof date === 'number' ? date * 1000 : date);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
};
const fmtDate = (date) => {
  if (!date) return '';
  const d = new Date(typeof date === 'number' ? date * 1000 : date);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function toast(msg, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    el.style.transition = 'all .3s ease';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function addLog(containerId, target, status, message = '') {
  const container = $(containerId);
  if (!container) return;
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${fmt(new Date())}</span>
    <span class="log-target">${target}</span>
    <span class="log-status ${status}">${status === 'sent' ? '✓ Terkirim' : status === 'added' ? '✓ Berhasil' : '✕ Gagal'}${message ? ' – ' + message : ''}</span>
  `;
  container.insertBefore(entry, container.firstChild);
}

// ── Title Bar ──────────────────────────────────────────────────────────
if($('btn-minimize')) $('btn-minimize').onclick = () => window.api.windowMinimize();
if($('btn-maximize')) $('btn-maximize').onclick = () => window.api.windowMaximize();
if($('btn-close')) $('btn-close').onclick = () => window.api.windowClose();

// ── Navigation ──────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const page = $(`page-${btn.dataset.page}`);
    if (page) page.classList.add('active');
    if (btn.dataset.page === 'history') loadHistory();
  });
});

// ── Modal Helpers ────────────────────────────────────────────────────────
document.querySelectorAll('[data-modal]').forEach(el => {
  el.addEventListener('click', () => {
    $(el.dataset.modal).classList.add('hidden');
  });
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

// ══════════════════════════════════════════════════════════════════════
//  LICENSE SYSTEM (NEW)
// ══════════════════════════════════════════════════════════════════════
async function checkSystemAccess() {
  // Ambil HWID untuk ditampilkan di modal jika belum aktivasi
  const hwid = await window.api.getHWID();
  if ($('display-hwid')) $('display-hwid').textContent = hwid;

  const result = await window.api.checkLicense();
  
  if (result.valid) {
    $('modal-license').classList.add('hidden');
    document.querySelector('.layout').style.filter = 'none';
    document.querySelector('.layout').style.pointerEvents = 'all';
    toast(`Lisensi Aktif (${result.type})`, 'success');
  } else {
    $('modal-license').classList.remove('hidden');
    document.querySelector('.layout').style.filter = 'blur(10px)';
    document.querySelector('.layout').style.pointerEvents = 'none';
  }
}

if ($('btn-activate')) {
  $('btn-activate').onclick = async () => {
    const key = $('input-serial').value.trim();
    if (!key) return alert("Harap masukkan Serial Key!");

    const btn = $('btn-activate');
    btn.innerText = "Memproses...";
    btn.disabled = true;

    const res = await window.api.activateLicense(key);

    if (res.success) {
      alert("Aktivasi Berhasil! Aplikasi akan dimuat ulang.");
      location.reload();
    } else {
      alert(res.message);
      btn.innerText = "Aktivasi Sekarang";
      btn.disabled = false;
    }
  };
}

// ══════════════════════════════════════════════════════════════════════
//  ACCOUNTS
// ══════════════════════════════════════════════════════════════════════
async function loadAccounts() {
  accounts = await window.api.getAccounts();
  renderAccounts();
  populateAccountSelects();
}

function renderAccounts() {
  const grid = $('accounts-grid');
  if (!accounts.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Belum ada akun. Klik <strong>Tambah Akun</strong>.</p></div>`;
    return;
  }

  grid.innerHTML = accounts.map(acc => `
    <div class="account-card ${acc.status}" id="acc-card-${acc.id}">
      <div class="account-header">
        <div class="account-avatar">${(acc.first_name || acc.phone || '?')[0].toUpperCase()}</div>
        <div class="account-info">
          <div class="account-name">${acc.first_name || 'Akun Baru'} ${acc.username ? '@' + acc.username : ''}</div>
          <div class="account-phone">${acc.phone}</div>
        </div>
      </div>
      <div>
        <span class="status-badge ${acc.status}">
          <span class="status-dot"></span>
          ${acc.status === 'connected' ? 'Terhubung' : acc.status === 'connecting' ? 'Menghubungkan...' : 'Terputus'}
        </span>
      </div>
      <div class="account-actions">
        ${acc.status === 'connected'
          ? `<button class="btn btn-secondary btn-sm" onclick="disconnectAccount(${acc.id})">Putuskan</button>`
          : `<button class="btn btn-primary btn-sm" onclick="connectAccount(${acc.id})">Hubungkan</button>`}
        <button class="btn btn-danger btn-sm" onclick="deleteAccount(${acc.id})">Hapus</button>
      </div>
    </div>
  `).join('');
}

function populateAccountSelects() {
  const opts = accounts.map(a =>
    `<option value="${a.id}" ${a.status !== 'connected' ? 'disabled' : ''}>${a.first_name || a.phone} ${a.status === 'connected' ? '✓' : '(offline)'}</option>`
  ).join('');
  const placeholder = '<option value="">-- Pilih Akun --</option>';

  ['blast-account', 'scrape-account', 'invite-account', 'monitor-account'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = placeholder + opts;
  });
}

$('btn-add-account').onclick = () => {
  $('modal-add-account').classList.remove('hidden');
};

let pendingAccountId = null;

$('btn-save-account').onclick = async () => {
  const phone = $('acc-phone').value.trim();
  const apiId = $('acc-api-id').value.trim();
  const apiHash = $('acc-api-hash').value.trim();

  if (!phone || !apiId || !apiHash) return toast('Harap isi semua field', 'error');

  const result = await window.api.addAccount({ phone, apiId, apiHash });
  if (!result.success) return toast('Gagal: ' + result.error, 'error');

  pendingAccountId = result.id;
  $('modal-add-account').classList.add('hidden');
  toast('Menghubungkan...', 'info');
  await connectAccount(pendingAccountId);
};

window.connectAccount = async function(accountId) {
  const card = $(`acc-card-${accountId}`);
  if (card) card.classList.add('connecting');

  const result = await window.api.connectAccount(accountId);
  if (!result.success) {
    toast('Gagal: ' + result.error, 'error');
    await loadAccounts();
    return;
  }

  if (result.authorized) {
    toast(`Berhasil terhubung`, 'success');
    await loadAccounts();
  } else {
    pendingAccountId = accountId;
    await window.api.sendCode(accountId);
    toast('OTP dikirim', 'info');
    $('modal-otp').classList.remove('hidden');
    $('otp-code').focus();
  }
};

$('btn-verify-otp').onclick = async () => {
  const result = await window.api.verifyCode({ accountId: pendingAccountId, code: $('otp-code').value.trim(), password: $('otp-password').value.trim() });
  if (!result.success) return toast('Gagal: ' + result.error, 'error');

  $('modal-otp').classList.add('hidden');
  toast(`Berhasil masuk`, 'success');
  await loadAccounts();
};

window.disconnectAccount = async function(accountId) {
  await window.api.disconnectAccount(accountId);
  await loadAccounts();
};

window.deleteAccount = async function(accountId) {
  if (!confirm('Hapus akun ini?')) return;
  await window.api.deleteAccount(accountId);
  await loadAccounts();
};

// ══════════════════════════════════════════════════════════════════════
//  BLAST (MEDIA SUPPORTED)
// ══════════════════════════════════════════════════════════════════════
if ($('btn-select-file')) {
  $('btn-select-file').onclick = async () => {
    const path = await window.api.selectFile();
    if (path) {
      selectedFilePath = path;
      $('file-name-label').textContent = path.split(/[\\/]/).pop();
      toast('File terpilih', 'success');
    }
  };
}

if ($('btn-clear-file')) {
  $('btn-clear-file').onclick = () => {
    selectedFilePath = null;
    if($('file-name-label')) $('file-name-label').textContent = 'Belum ada file dipilih';
    if($('blast-file')) $('blast-file').value = ''; // Backup for old input
  };
}

$('btn-import-targets').onclick = async () => {
  const result = await window.api.importTargetsFile();
  if (result.success && result.targets.length) {
    $('blast-targets').value = result.targets.join('\n');
    toast(`${result.targets.length} target diimport`, 'success');
  }
};

$('btn-start-blast').onclick = async () => {
  const accountId = parseInt($('blast-account').value);
  const message = $('blast-message').value.trim();
  const targetsRaw = $('blast-targets').value.trim();
  const delay = parseInt($('blast-delay').value) || 0;

  if (!accountId) return toast('Pilih akun', 'error');
  if (!message && !selectedFilePath) return toast('Tulis pesan atau pilih file', 'error');
  if (!targetsRaw) return toast('Masukkan target', 'error');

  const targets = targetsRaw.split('\n').map(t => t.trim()).filter(Boolean);
  currentBlastId = uid();

  $('blast-sent').textContent = '0';
  $('blast-failed').textContent = '0';
  $('blast-total').textContent = targets.length;
  $('blast-progress-bar').style.width = '0%';
  $('blast-log').innerHTML = '';
  $('btn-start-blast').classList.add('hidden');
  $('btn-stop-blast').classList.remove('hidden');

  const result = await window.api.startBlast({ 
    accountId, 
    targets, 
    message, 
    delay, 
    blastId: currentBlastId, 
    filePath: selectedFilePath 
  });
  
  if (!result.success) {
    toast(result.error, 'error');
    $('btn-start-blast').classList.remove('hidden');
    $('btn-stop-blast').classList.add('hidden');
  }
};

$('btn-stop-blast').onclick = async () => { 
  if (currentBlastId) { 
    await window.api.stopBlast(currentBlastId); 
    $('btn-start-blast').classList.remove('hidden'); 
    $('btn-stop-blast').classList.add('hidden'); 
  } 
};

window.api.on('blast-progress', ({ blastId, target, status, sent, failed, total }) => {
  if (blastId !== currentBlastId) return;
  $('blast-sent').textContent = sent;
  $('blast-failed').textContent = failed;
  $('blast-total').textContent = total;
  const pct = total > 0 ? Math.round((sent + failed) / total * 100) : 0;
  $('blast-progress-bar').style.width = pct + '%';
  addLog('blast-log', target, status);
});

window.api.on('blast-complete', ({ blastId, sent, failed }) => {
  if (blastId !== currentBlastId) return;
  toast(`Selesai! ${sent} terkirim`, 'success');
  $('btn-start-blast').classList.remove('hidden');
  $('btn-stop-blast').classList.add('hidden');
  $('blast-progress-bar').style.width = '100%';
});

// ══════════════════════════════════════════════════════════════════════
//  SCRAPE
// ══════════════════════════════════════════════════════════════════════
$('btn-start-scrape').onclick = async () => {
  const accountId = parseInt($('scrape-account').value);
  const groupLink = $('scrape-group').value.trim();
  const limit = parseInt($('scrape-limit').value) || 500;

  if (!accountId || !groupLink) return toast('Lengkapi data scrape', 'error');

  $('scrape-status').classList.remove('hidden');
  $('scrape-status').textContent = '⏳ Scraping...';

  const result = await window.api.scrapeMembers({ accountId, groupLink, limit });
  if (!result.success) {
    $('scrape-status').textContent = '✕ Error: ' + result.error;
    return;
  }

  scrapedMembers = result.members;
  renderMembersTable(result.members);
  $('scrape-status').textContent = `✓ Berhasil scrape ${result.count} anggota`;
};

function renderMembersTable(members) {
  const tbody = $('members-table-body');
  if (!members.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Kosong.</td></tr>';
    return;
  }

  tbody.innerHTML = members.map((m, i) => `
    <tr>
      <td><input type="checkbox" class="member-check" value="${i}" /></td>
      <td>${m.userId}</td>
      <td>${m.username ? '@' + m.username : '–'}</td>
      <td>${m.firstName || ''} ${m.lastName || ''}</td>
      <td>${m.phone || '–'}</td>
    </tr>
  `).join('');
}

$('select-all').onchange = function() {
  document.querySelectorAll('.member-check').forEach(cb => cb.checked = this.checked);
};

$('btn-export-members').onclick = async () => {
  const checked = [...document.querySelectorAll('.member-check:checked')];
  const toExport = checked.length ? checked.map(cb => scrapedMembers[parseInt(cb.value)]) : scrapedMembers;
  if (!toExport.length) return toast('Data kosong', 'error');
  const r = await window.api.exportMembers(toExport);
  if (r.success) toast(`Berhasil export`, 'success');
};

$('btn-use-for-blast').onclick = () => {
  const checked = [...document.querySelectorAll('.member-check:checked')];
  const members = checked.length ? checked.map(cb => scrapedMembers[parseInt(cb.value)]) : scrapedMembers;
  if (!members.length) return toast('Pilih member dulu', 'error');
  $('blast-targets').value = members.map(m => m.username ? '@' + m.username : m.userId).join('\n');
  document.querySelector('[data-page="blast"]').click();
};

$('btn-use-for-invite').onclick = () => {
  const checked = [...document.querySelectorAll('.member-check:checked')];
  const members = checked.length ? checked.map(cb => scrapedMembers[parseInt(cb.value)]) : scrapedMembers;
  if (!members.length) return toast('Pilih member dulu', 'error');
  $('invite-targets').value = members.map(m => m.userId).join('\n');
  document.querySelector('[data-page="invite"]').click();
};

// ══════════════════════════════════════════════════════════════════════
//  AUTO INVITE
// ══════════════════════════════════════════════════════════════════════
$('btn-start-invite').onclick = async () => {
  const accountId = parseInt($('invite-account').value);
  const groupLink = $('invite-group').value.trim();
  const userIdsRaw = $('invite-targets').value.trim();
  const delay = parseInt($('invite-delay').value) || 5;

  if (!accountId || !groupLink || !userIdsRaw) return toast('Lengkapi data', 'error');
  const userIds = userIdsRaw.split('\n').map(u => u.trim()).filter(Boolean);

  currentInviteId = uid();
  $('invite-added').textContent = '0';
  $('invite-failed').textContent = '0';
  $('invite-total').textContent = userIds.length;
  $('invite-progress-bar').style.width = '0%';
  $('invite-log').innerHTML = '';

  $('btn-start-invite').classList.add('hidden');
  $('btn-stop-invite').classList.remove('hidden');

  const result = await window.api.autoInvite({ accountId, groupLink, userIds, delay, inviteId: currentInviteId });
  if (!result.success) {
    toast('Gagal: ' + result.error, 'error');
    $('btn-start-invite').classList.remove('hidden');
    $('btn-stop-invite').classList.add('hidden');
  }
};

$('btn-stop-invite').onclick = async () => { 
  if (currentInviteId) { 
    await window.api.stopInvite(currentInviteId); 
    $('btn-start-invite').classList.remove('hidden'); 
    $('btn-stop-invite').classList.add('hidden'); 
  } 
};

window.api.on('invite-progress', ({ inviteId, userId, status, added, failed, total }) => {
  if (inviteId !== currentInviteId) return;
  $('invite-added').textContent = added;
  $('invite-failed').textContent = failed;
  const pct = total > 0 ? Math.round((added + failed) / total * 100) : 0;
  $('invite-progress-bar').style.width = pct + '%';
  addLog('invite-log', userId, status === 'added' ? 'added' : 'failed');
});

window.api.on('invite-complete', ({ inviteId }) => {
  if (inviteId !== currentInviteId) return;
  toast(`Invite Selesai`, 'success');
  $('btn-start-invite').classList.remove('hidden');
  $('btn-stop-invite').classList.add('hidden');
});

// ══════════════════════════════════════════════════════════════════════
//  MONITOR / CHAT
// ══════════════════════════════════════════════════════════════════════
$('monitor-account').onchange = function() { activeMonitorAccountId = parseInt(this.value) || null; };

$('btn-load-dialogs').onclick = async () => {
  if (!activeMonitorAccountId) return toast('Pilih akun', 'error');
  const result = await window.api.getDialogs(activeMonitorAccountId);
  if (result.success) renderDialogs(result.dialogs);
};

function renderDialogs(dialogs) {
  const list = $('dialog-list');
  if (!dialogs.length) { list.innerHTML = 'Kosong.'; return; }
  list.innerHTML = dialogs.map(d => `
    <div class="dialog-item" data-peer="${d.id}" data-name="${d.name}">
      <div class="dialog-name">${d.name || 'Unknown'}</div>
      <div class="dialog-preview">${d.message || ''}</div>
    </div>
  `).join('');
  list.querySelectorAll('.dialog-item').forEach(item => {
    item.onclick = () => {
      list.querySelectorAll('.dialog-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      openChat(item.dataset.peer, item.dataset.name);
    };
  });
}

async function openChat(peerId, peerName) {
  activePeerId = peerId; activePeerName = peerName;
  $('chat-peer-name').textContent = peerName;
  $('chat-messages').innerHTML = 'Memuat...';
  const result = await window.api.getMessages({ accountId: activeMonitorAccountId, peerId, limit: 50 });
  if (result.success) renderMessages(result.messages);
}

function renderMessages(messages) {
  const container = $('chat-messages');
  container.innerHTML = messages.map(m => `
    <div class="message-bubble ${m.isOut ? 'out' : 'in'}">
      <div>${escapeHtml(m.text)}</div>
      <div class="msg-time">${fmt(m.date)}</div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

$('btn-send-chat').onclick = async () => {
  const text = $('chat-input').value.trim();
  if (!text || !activePeerId) return;
  $('chat-input').value = '';
  const result = await window.api.sendMessage({ accountId: activeMonitorAccountId, peerId: activePeerId, message: text });
  if (result.success) {
    const el = document.createElement('div'); el.className = 'message-bubble out'; el.innerHTML = `<div>${escapeHtml(text)}</div>`;
    $('chat-messages').appendChild(el); $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  }
};

window.api.on('new-message', ({ accountId, peerId, message, isOut }) => {
  if (accountId === activeMonitorAccountId && peerId === activePeerId && !isOut) {
    const el = document.createElement('div'); el.className = 'message-bubble in'; el.innerHTML = `<div>${escapeHtml(message)}</div>`;
    $('chat-messages').appendChild(el); $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  }
});

// ══════════════════════════════════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════════════════════════════════
async function loadHistory() {
  const rows = await window.api.getBlastHistory();
  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.first_name || a.phone]));
  if($('history-table-body')) {
    $('history-table-body').innerHTML = rows.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td>${accountMap[r.account_id] || '–'}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.message}</td>
        <td>${r.sent_count}</td>
        <td>${r.failed_count}</td>
        <td><span class="chip ${r.status}">${r.status}</span></td>
      </tr>
    `).join('');
  }
}

function escapeHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── Init ────────────────────────────────────────────────────────────────
(async function init() {
  await checkSystemAccess(); // CEK AKSES LISENSI DULU
  await loadAccounts();
  toast('TeleBlast Siap!', 'success');
})();