// Оболочка функциональной копии SPA: одно окно, локальный файл, внешние ссылки — в системный браузер.
const { app, BrowserWindow, Menu, shell } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('file:')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return
    event.preventDefault()
    shell.openExternal(url)
  })
  win.loadFile(path.join(__dirname, 'app', 'index.html'))
}

Menu.setApplicationMenu(null)
app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
