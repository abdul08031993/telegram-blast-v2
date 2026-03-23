const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Window Controls ──────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // ── License System (TAMBAHKAN INI) ──────────────────────────────────
  getHWID: () => ipcRenderer.invoke('get-hwid'),
  checkLicense: () => ipcRenderer.invoke('check-license'),
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),

  // ── Accounts ────────────────────────────────────────────────────────
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (data) => ipcRenderer.invoke('add-account', data),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  connectAccount: (id) => ipcRenderer.invoke('connect-account', id),
  sendCode: (id) => ipcRenderer.invoke('send-code', id),
  verifyCode: (data) => ipcRenderer.invoke('verify-code', data),
  disconnectAccount: (id) => ipcRenderer.invoke('disconnect-account', id),

  // ── Blast ───────────────────────────────────────────────────────────
  startBlast: (data) => ipcRenderer.invoke('start-blast', data),
  stopBlast: (blastId) => ipcRenderer.invoke('stop-blast', blastId),
  getBlastHistory: () => ipcRenderer.invoke('get-blast-history'),
  importTargetsFile: () => ipcRenderer.invoke('import-targets-file'),
  selectFile: () => ipcRenderer.invoke('select-file'),

  // ── Scrape ──────────────────────────────────────────────────────────
  scrapeMembers: (data) => ipcRenderer.invoke('scrape-members', data),
  getScrapedMembers: (data) => ipcRenderer.invoke('get-scraped-members', data),
  exportMembers: (members) => ipcRenderer.invoke('export-members', members),

  // ── Auto Invite ─────────────────────────────────────────────────────
  autoInvite: (data) => ipcRenderer.invoke('auto-invite', data),
  stopInvite: (inviteId) => ipcRenderer.invoke('stop-invite', inviteId),

  // ── Chat / Monitoring ───────────────────────────────────────────────
  getDialogs: (accountId) => ipcRenderer.invoke('get-dialogs', accountId),
  getMessages: (data) => ipcRenderer.invoke('get-messages', data),
  sendMessage: (data) => ipcRenderer.invoke('send-message', data),

  // ── Events ──────────────────────────────────────────────────────────
  on: (channel, cb) => {
    const allowed = [
      'new-message', 
      'blast-progress', 
      'blast-complete', 
      'scrape-progress', 
      'invite-progress', 
      'invite-complete'
    ];
    if (allowed.includes(channel)) {
      // Menggunakan listener yang bersih
      const subscription = (_event, ...args) => cb(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  },
  // off opsional jika kamu sudah menggunakan return function di atas
  off: (channel, cb) => ipcRenderer.removeListener(channel, cb),
});