import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Xolas',
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Ocultar barra de menu padrão do Windows para estilo limpo de app desktop
  mainWindow.setMenuBarVisibility(false);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handler IPC para capturar janelas e telas disponíveis para transmissão
ipcMain.handle('get-screen-sources', async () => {
  try {
    let sources = [];
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: false,
      });
    } catch (err) {
      console.warn('Erro ao buscar janelas e telas em conjunto, tentando telas:', err);
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 480, height: 270 },
      });
    }

    if (!sources || sources.length === 0) {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 480, height: 270 },
      });
    }

    return sources.map((source) => ({
      id: source.id,
      name: source.name || (source.id.startsWith('screen:') ? 'Monitor' : 'Janela'),
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : '',
      appIcon: null,
    }));
  } catch (error) {
    console.error('Erro ao capturar fontes de tela:', error);
    return [];
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
