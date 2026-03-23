const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { machineIdSync } = require('node-machine-id');
const axios = require('axios');

// ─── KONFIGURASI LISENSI ──────────────────────────────────────────────────────
const GAS_URL = 'https://script.google.com/macros/s/AKfycbx07IHEJR2gRLQe5ERQ3K19uUHwnrBY1vKw8BSljwadRQYZ1tfd3m2sfjHbbUVopfWk/exec';
const DEVICE_ID = machineIdSync();

let mainWindow;
let db;
const clients = {}; // accountId -> TelegramClient
const messageListeners = {}; // accountId -> listener ref
const blastRunning = {}; // blastId -> bool

// ─── Database Setup ───────────────────────────────────────────────────────────
function initDB() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'teleblast.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      session TEXT DEFAULT '',
      api_id TEXT NOT NULL,
      api_hash TEXT NOT NULL,
      username TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      status TEXT DEFAULT 'disconnected',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blast_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      message TEXT,
      targets TEXT,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scraped_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      group_link TEXT,
      user_id TEXT,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      is_bot INTEGER DEFAULT 0,
      scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      peer_id TEXT,
      peer_name TEXT,
      message TEXT,
      is_out INTEGER DEFAULT 0,
      date INTEGER,
      msg_id INTEGER
    );
  `);
}

// ─── Auto Connect Feature ─────────────────────────────────────────────────────
async function autoConnectAccounts() {
  const activeAccounts = db.prepare("SELECT * FROM accounts WHERE status = 'connected'").all();
  console.log(`[AutoConnect] Mencoba menghubungkan kembali ${activeAccounts.length} akun...`);

  for (const acc of activeAccounts) {
    try {
      const session = new StringSession(acc.session);
      const client = new TelegramClient(session, parseInt(acc.api_id), acc.api_hash, {
        connectionRetries: 5,
        deviceModel: "TeleBlast Desktop",
        systemVersion: "Linux/Windows",
        appVersion: "1.0.0",
      });

      await client.connect();
      
      if (await client.isUserAuthorized()) {
        clients[acc.id] = client;
        setupMessageListener(acc.id, client);
        console.log(`[AutoConnect] Berhasil: ${acc.first_name || acc.phone}`);
      } else {
        db.prepare("UPDATE accounts SET status = 'disconnected' WHERE id = ?").run(acc.id);
      }
    } catch (e) {
      console.error(`[AutoConnect] Gagal pada ${acc.phone}:`, e.message);
    }
  }
}

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#17212b',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('renderer/index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  initDB();
  await autoConnectAccounts();
  createWindow();
});

app.on('window-all-closed', () => {
  Object.values(clients).forEach(c => c.disconnect().catch(() => {}));
  app.quit();
});

// ─── LISENSI IPC HANDLERS ─────────────────────────────────────────────────────
ipcMain.handle('get-hwid', () => DEVICE_ID);

ipcMain.handle('check-license', async () => {
  try {
    const res = await axios.post(GAS_URL, {
      action: "check",
      hwid: DEVICE_ID
    });
    return res.data;
  } catch (e) {
    return { valid: false, error: "Koneksi ke server lisensi gagal." };
  }
});

ipcMain.handle('activate-license', async (_, serialKey) => {
  try {
    const res = await axios.post(GAS_URL, {
      action: "activate",
      key: serialKey,
      hwid: DEVICE_ID
    });
    return res.data;
  } catch (e) {
    return { success: false, message: "Gagal aktivasi karena masalah jaringan." };
  }
});

// ─── Native File Selection ──────────────────────────────────────────────────
ipcMain.handle('select-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Media/Files', extensions: ['jpg', 'png', 'jpeg', 'gif', 'mp4', 'pdf', 'zip', 'txt'] }
    ]
  });
  if (canceled) return null;
  return filePaths[0];
});

// ─── Account Management ──────────────────────────────────────────────────────
ipcMain.handle('get-accounts', () => {
  return db.prepare('SELECT * FROM accounts ORDER BY id DESC').all();
});

ipcMain.handle('add-account', (_, { phone, apiId, apiHash }) => {
  try {
    const stmt = db.prepare('INSERT OR IGNORE INTO accounts (phone, api_id, api_hash) VALUES (?, ?, ?)');
    const result = stmt.run(phone, apiId, apiHash);
    return { success: true, id: result.lastInsertRowid };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-account', (_, id) => {
  try {
    if (clients[id]) {
      clients[id].disconnect().catch(() => {});
      delete clients[id];
    }
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Telegram Auth Flow ───────────────────────────────────────────────────────
ipcMain.handle('connect-account', async (_, accountId) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) return { success: false, error: 'Account not found' };

  try {
    const session = new StringSession(account.session || '');
    const client = new TelegramClient(session, parseInt(account.api_id), account.api_hash, {
      connectionRetries: 10,
      deviceModel: "TeleBlast Desktop",
      systemVersion: "Linux/Windows",
      appVersion: "1.0.0",
    });
    clients[accountId] = client;

    await client.connect();

    if (await client.isUserAuthorized()) {
      const me = await client.getMe();
      db.prepare('UPDATE accounts SET status=?, session=?, username=?, first_name=? WHERE id=?').run(
        'connected',
        client.session.save(),
        me.username || '',
        me.firstName || '',
        accountId
      );
      setupMessageListener(accountId, client);
      return { success: true, authorized: true, user: { username: me.username, firstName: me.firstName } };
    } else {
      return { success: true, authorized: false };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('send-code', async (_, accountId) => {
  const client = clients[accountId];
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!client || !account) return { success: false, error: 'Client not initialized' };

  try {
    if (!client.connected) await client.connect();
    await client.sendCode({ apiId: parseInt(account.api_id), apiHash: account.api_hash }, account.phone);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('verify-code', async (_, { accountId, code, password }) => {
  const client = clients[accountId];
  if (!client) return { success: false, error: 'Client not initialized' };
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);

  try {
    await client.start({
      phoneNumber: account.phone,
      phoneCode: async () => code,
      password: async () => password,
      onError: (err) => { throw err; },
    });

    const me = await client.getMe();
    db.prepare('UPDATE accounts SET status=?, session=?, username=?, first_name=? WHERE id=?').run(
      'connected',
      client.session.save(),
      me.username || '',
      me.firstName || '',
      accountId
    );
    setupMessageListener(accountId, client);
    return { success: true, user: { username: me.username, firstName: me.firstName } };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('disconnect-account', async (_, accountId) => {
  try {
    if (clients[accountId]) {
      await clients[accountId].disconnect();
      delete clients[accountId];
    }
    db.prepare('UPDATE accounts SET status=? WHERE id=?').run('disconnected', accountId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Message Listener (Monitoring) ────────────────────────────────────────────
function setupMessageListener(accountId, client) {
  if (messageListeners[accountId]) {
    client.removeEventHandler(messageListeners[accountId]);
  }

  const handler = async (event) => {
    const msg = event.message;
    try {
      const sender = await msg.getSender();
      const chat = await msg.getChat();
      const peerName = chat
        ? (chat.title || chat.firstName || chat.username || 'Unknown')
        : (sender?.firstName || sender?.username || 'Unknown');
      const peerId = chat ? String(chat.id) : String(sender?.id || '');

      db.prepare(`
        INSERT INTO messages (account_id, peer_id, peer_name, message, is_out, date, msg_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(accountId, peerId, peerName, msg.text || '', msg.out ? 1 : 0, msg.date, msg.id);

      if (mainWindow) {
        mainWindow.webContents.send('new-message', {
          accountId,
          peerId,
          peerName,
          message: msg.text || '',
          isOut: msg.out,
          date: msg.date,
          msgId: msg.id,
          senderName: sender?.firstName || sender?.username || 'Unknown',
        });
      }
    } catch (_) {}
  };

  messageListeners[accountId] = handler;
  client.addEventHandler(handler, new NewMessage({}));
}

// ─── Blast Feature ────────────────────────────────────────────────────────────
ipcMain.handle('start-blast', async (_, { accountId, targets, message, delay, blastId, filePath }) => {
  const client = clients[accountId];
  if (!client) return { success: false, error: 'Account not connected' };

  blastRunning[blastId] = true;

  const historyId = db.prepare('INSERT INTO blast_history (account_id, message, targets, status) VALUES (?, ?, ?, ?)')
    .run(accountId, message, JSON.stringify(targets), 'running').lastInsertRowid;

  let sent = 0, failed = 0;

  (async () => {
    for (const target of targets) {
      if (!blastRunning[blastId]) break;
      
      try {
        const entity = await client.getEntity(target);
        const nameToUse = entity.firstName || "Kak";
        const personalizedMsg = message.replace(/{name}/g, nameToUse);

        if (filePath && fs.existsSync(filePath)) {
          await client.sendFile(entity, { file: filePath, caption: personalizedMsg, forceDocument: false });
        } else {
          await client.sendMessage(entity, { message: personalizedMsg });
        }
        
        sent++;
        mainWindow.webContents.send('blast-progress', { blastId, target, status: 'sent', sent, failed, total: targets.length });

      } catch (e) {
        if (e.name === 'FloodWaitError' || e.errorMessage?.includes('FLOOD_WAIT')) {
          const waitTime = e.seconds || 60;
          mainWindow.webContents.send('blast-progress', { blastId, target, status: 'failed', error: `Limit! Tunggu ${waitTime}s`, sent, failed, total: targets.length });
          await sleep(waitTime * 1000);
          continue; 
        }
        failed++;
        mainWindow.webContents.send('blast-progress', { blastId, target, status: 'failed', error: e.message, sent, failed, total: targets.length });
      }

      if (delay > 0 && targets.indexOf(target) < targets.length - 1) {
        await sleep(delay * 1000);
      }
    }
    db.prepare('UPDATE blast_history SET sent_count=?, failed_count=?, status=? WHERE id=?').run(sent, failed, 'completed', historyId);
    mainWindow.webContents.send('blast-complete', { blastId, sent, failed });
    delete blastRunning[blastId];
  })();

  return { success: true };
});

ipcMain.handle('stop-blast', (_, blastId) => { blastRunning[blastId] = false; return { success: true }; });

ipcMain.handle('get-blast-history', () => {
  return db.prepare('SELECT * FROM blast_history ORDER BY created_at DESC LIMIT 50').all();
});

// ─── Scrape Members (OPTIMIZED WITH TRANSACTION) ──────────────────────────────
ipcMain.handle('scrape-members', async (_, { accountId, groupLink, limit }) => {
  const client = clients[accountId];
  if (!client) return { success: false, error: 'Account not connected' };

  try {
    const entity = await client.getEntity(groupLink);
    mainWindow.webContents.send('scrape-progress', { status: 'started', group: entity.title || groupLink });

    const participants = await client.getParticipants(entity, { limit: limit || 500 });
    const members = [];

    for (const p of participants) {
      if (p.bot) continue;
      members.push({
        userId: String(p.id),
        username: p.username || '',
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        phone: p.phone || '',
        isBot: p.bot ? 1 : 0,
      });
    }

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO scraped_members (account_id, group_link, user_id, username, first_name, last_name, phone, is_bot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const runTransaction = db.transaction((data) => {
      for (const m of data) {
        insertStmt.run(accountId, groupLink, m.userId, m.username, m.firstName, m.lastName, m.phone, m.isBot);
      }
    });

    runTransaction(members);

    mainWindow.webContents.send('scrape-progress', { status: 'done', count: members.length });
    return { success: true, members, count: members.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-scraped-members', (_, { groupLink } = {}) => {
  if (groupLink) return db.prepare('SELECT * FROM scraped_members WHERE group_link=? ORDER BY scraped_at DESC').all(groupLink);
  return db.prepare('SELECT * FROM scraped_members ORDER BY scraped_at DESC LIMIT 500').all();
});

ipcMain.handle('export-members', async (_, members) => {
  const { filePath } = await dialog.showSaveDialog({ title: 'Export Members', defaultPath: 'members.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (!filePath) return { success: false };
  const csv = 'user_id,username,first_name,last_name,phone\n' + members.map(m => `${m.userId},${m.username},${m.firstName},${m.lastName},${m.phone}`).join('\n');
  fs.writeFileSync(filePath, csv, 'utf8');
  return { success: true, filePath };
});

// ─── Auto Invite ─────────────────────────────────────────────────────────────
ipcMain.handle('auto-invite', async (_, { accountId, groupLink, userIds, delay, inviteId }) => {
  const client = clients[accountId];
  if (!client) return { success: false, error: 'Account not connected' };
  blastRunning[inviteId] = true;
  let added = 0, failed = 0;
  (async () => {
    try {
      const entity = await client.getEntity(groupLink);
      for (const userId of userIds) {
        if (!blastRunning[inviteId]) break;
        try {
          await client.invoke(new Api.channels.InviteToChannelRequest({ channel: entity, users: [await client.getEntity(userId)] }));
          added++;
          mainWindow.webContents.send('invite-progress', { inviteId, userId, status: 'added', added, failed, total: userIds.length });
        } catch (e) {
          if (e.name === 'FloodWaitError') { await sleep(e.seconds * 1000); continue; }
          failed++;
          mainWindow.webContents.send('invite-progress', { inviteId, userId, status: 'failed', error: e.message, added, failed, total: userIds.length });
        }
        if (delay > 0) await sleep(delay * 1000);
      }
    } catch (e) {
      mainWindow.webContents.send('invite-complete', { inviteId, added, failed, error: e.message });
      return;
    }
    mainWindow.webContents.send('invite-complete', { inviteId, added, failed });
    delete blastRunning[inviteId];
  })();
  return { success: true };
});

// ─── Chat Monitoring ──────────────────────────────────────────────────────────
ipcMain.handle('get-dialogs', async (_, accountId) => {
  const client = clients[accountId];
  if (!client) return { success: false, error: 'Not connected' };
  try {
    const dialogs = await client.getDialogs({ limit: 50 });
    return { success: true, dialogs: dialogs.map(d => ({ id: String(d.id), name: d.name || 'Unknown', unreadCount: d.unreadCount || 0, message: d.message?.text || '', date: d.date })) };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('get-messages', async (_, { accountId, peerId, limit }) => {
  const client = clients[accountId];
  if (!client) return { success: false, error: 'Not connected' };
  try {
    const entity = await client.getEntity(peerId);
    const messages = await client.getMessages(entity, { limit: limit || 50 });
    return { success: true, messages: messages.reverse().map(m => ({ id: m.id, text: m.text || '', isOut: m.out, date: m.date })) };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('send-message', async (_, { accountId, peerId, message }) => {
  const client = clients[accountId];
  if (!client) return { success: false, error: 'Not connected' };
  try { await client.sendMessage(peerId, { message }); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('import-targets-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({ title: 'Import Targets', filters: [{ name: 'CSV/Excel', extensions: ['csv', 'txt'] }], properties: ['openFile'] });
  if (!filePaths || !filePaths.length) return { success: false };
  const content = fs.readFileSync(filePaths[0], 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  return { success: true, targets: lines };
});

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close', () => mainWindow.close());

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
