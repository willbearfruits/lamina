// LAMINA Electron shell — thin: window + native open/save dialogs. Renderer is the same no-build web app.
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('fs'); const path = require('path');
let win;
function createWindow() {
  win = new BrowserWindow({ width: 1500, height: 950, minWidth: 1100, minHeight: 700, backgroundColor: '#16181d', title: 'LAMINA', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  const send = (cmd) => win.webContents.send('app:command', cmd);
  const tpl = [
    { label: 'File', submenu: [ { label: 'New project…', accelerator: 'CmdOrCtrl+N', click: () => send('new') }, { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') }, { label: 'Save as…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveas') }, { type: 'separator' }, { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => send('export') }, { type: 'separator' }, { role: 'quit' } ] },
    { label: 'Edit', submenu: [ { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') }, { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => send('redo') }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' } ] },
    { label: 'View', submenu: [ { label: '2D editor', accelerator: '1', click: () => send('view2d') }, { label: '3D preview', accelerator: '2', click: () => send('view3d') }, { label: 'Fit board', accelerator: 'Home', click: () => send('fit') }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' } ] },
    { label: 'Board', submenu: [ { label: 'Run DRC', accelerator: 'CmdOrCtrl+R', click: () => send('drc') } ] },
    { label: 'Help', submenu: [ { label: 'Keyboard shortcuts', click: () => send('shortcuts') }, { label: 'Project folder', click: () => shell.openPath(path.join(__dirname, '..')) } ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
ipcMain.handle('save-file', async (e, name, bytes) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name }); if (r.canceled) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes)); return r.filePath;
});
ipcMain.handle('save-text', async (e, name, text, existingPath) => {
  let p = existingPath; if (!p) { const r = await dialog.showSaveDialog(win, { defaultPath: name }); if (r.canceled) return null; p = r.filePath; }
  fs.writeFileSync(p, text, 'utf8'); return p;
});
ipcMain.handle('open-file', async (e, filters) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [] }); if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0]; const buf = fs.readFileSync(p); const ext = path.extname(p).toLowerCase();
  const isImg = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext);
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' }[ext];
  return { name: path.basename(p), path: p, text: isImg ? null : buf.toString('utf8'), dataUrl: (isImg || ext === '.svg') ? `data:${mime};base64,${buf.toString('base64')}` : null };
});
