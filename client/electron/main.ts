import { app, BrowserWindow, ipcMain, desktopCapturer, shell, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { autoUpdater } from 'electron-updater';

// Permitir reprodução automática de áudio e vídeo WebRTC sem bloqueio de gesto
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

// Configuração do Auto-Updater para GitHub Releases
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Verificando novas atualizações...');
    mainWindow?.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Nova atualização encontrada:', info.version);
    mainWindow?.webContents.send('update-available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] Software atualizado:', info?.version);
    mainWindow?.webContents.send('update-not-available', info);
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater] Erro ao verificar atualização:', err);
    mainWindow?.webContents.send('update-error', err?.message || String(err));
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('update-download-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Atualização baixada com sucesso:', info.version);
    mainWindow?.webContents.send('update-downloaded', info);
  });
}

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

  // Iniciar checagem automática silenciosa quase imediata quando a interface terminar de carregar
  mainWindow.webContents.once('did-finish-load', () => {
    if (app.isPackaged) {
      setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify().catch((err) => {
          console.warn('[AutoUpdater] Falha na checagem inicial:', err);
        });
      }, 800);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Configurar ouvintes de auto-atualização
setupAutoUpdater();

// Checar atualizações periodicamente em segundo plano (a cada 2 horas)
setInterval(() => {
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
}, 2 * 60 * 60 * 1000);

// Handlers IPC para controle de atualizações
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { status: 'dev-mode', version: app.getVersion() };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: 'success', result, version: app.getVersion() };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.warn('[AutoUpdater] Erro ao checar atualizações:', errMsg);
    // Se o GitHub retornar 404 (sem releases publicadas ainda), não é um erro de falha do app
    if (errMsg.includes('404') || errMsg.includes('latest') || errMsg.includes('Cannot find')) {
      return { status: 'no-release-found', error: errMsg, version: app.getVersion() };
    }
    return { status: 'error', error: errMsg, version: app.getVersion() };
  }
});

ipcMain.handle('restart-and-install', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('open-external', async (_event, url: string) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
  }
});

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

app.whenReady().then(() => {
  // Habilitar captura de áudio loopback nativa para getDisplayMedia no Windows
  try {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          if (sources && sources.length > 0) {
            callback({ video: sources[0], audio: 'loopback' });
          } else {
            callback({});
          }
        })
        .catch(() => {
          callback({});
        });
    });
  } catch (err) {
    console.warn('Aviso ao configurar DisplayMediaRequestHandler:', err);
  }

  createWindow();
});

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
