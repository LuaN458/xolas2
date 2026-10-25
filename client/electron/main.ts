import { app, BrowserWindow, ipcMain, desktopCapturer, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { autoUpdater } from 'electron-updater';

// Permitir reprodução automática de áudio e vídeo WebRTC sem bloqueio de gesto
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Desativar throttling de segundo plano para manter 60 FPS constantes na transmissão quando o usuário estiver com o jogo em tela cheia
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Ativar aceleração por hardware GPU (NVENC / AMD AMF / Intel QuickSync) e captura DXGI zero-copy
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch(
  'enable-features',
  'MediaFoundationD3D11VideoCapture,VaapiVideoEncoder,VaapiVideoDecoder,PlatformHEVCDecoderSupport'
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let audioCaptureProcess: ChildProcess | null = null;

function stopProcessAudioCapture() {
  if (audioCaptureProcess) {
    try {
      audioCaptureProcess.stdout?.removeAllListeners();
      audioCaptureProcess.stderr?.removeAllListeners();
      audioCaptureProcess.kill();
    } catch {}
    audioCaptureProcess = null;
  }
}

function getWasapiHelperPath(): string {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'wasapi-loopback.exe') : '',
    path.join(__dirname, 'wasapi-loopback.exe'),
    path.join(__dirname, '../electron/wasapi-loopback.exe'),
    path.join(app.getAppPath(), 'electron/wasapi-loopback.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

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

function isSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > 2048) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
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
      backgroundThrottling: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.webContents.setBackgroundThrottling(false);

  // Bloquear criação de janelas pop-up não autorizadas e redirecionar links HTTP(S) seguros para o navegador do sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = isSafeExternalUrl(url);
    if (safeUrl) {
      shell.openExternal(safeUrl).catch(() => {});
    }
    return { action: 'deny' };
  });

  // Impedir navegação da janela principal do Electron para páginas externas maliciosas (Anti-Phishing / RCE)
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowedDevOrigin = process.env.VITE_DEV_SERVER_URL;
    if (allowedDevOrigin && navigationUrl.startsWith(allowedDevOrigin)) {
      return;
    }
    if (navigationUrl.startsWith('file://')) {
      return;
    }
    event.preventDefault();
    const safeUrl = isSafeExternalUrl(navigationUrl);
    if (safeUrl) {
      shell.openExternal(safeUrl).catch(() => {});
    }
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
    stopProcessAudioCapture();
    mainWindow = null;
  });
}

// Configurar ouvintes de auto-atualização
setupAutoUpdater();

// Checar atualizações periodicamente em segundo plano (a cada 2 minutos para sincronizar participantes rapidamente)
setInterval(() => {
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
}, 2 * 60 * 1000);

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

ipcMain.handle('open-external', async (_event, url: unknown) => {
  const safeUrl = isSafeExternalUrl(url);
  if (safeUrl) {
    await shell.openExternal(safeUrl);
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

// Handler IPC para captura de áudio isolada via WASAPI Process Loopback (Windows 10/11)
// - Se sourceId for "window:<HWND>:0", captura SOMENTE a árvore de processos daquela janela (INCLUDE_TARGET_PROCESS_TREE)
// - Se sourceId for "screen:<ID>:0", captura o áudio do sistema EXCLUINDO a árvore de processos do Xolas (EXCLUDE_TARGET_PROCESS_TREE)
ipcMain.handle('start-process-audio-capture', async (_event, sourceId?: string) => {
  stopProcessAudioCapture();

  if (process.platform !== 'win32') {
    return { started: false, reason: 'not-win32' };
  }

  const exePath = getWasapiHelperPath();
  if (!fs.existsSync(exePath)) {
    console.warn('[WASAPI] Helper binário não encontrado em:', exePath);
    return { started: false, reason: 'binary-missing' };
  }

  const args: string[] = [];
  if (typeof sourceId === 'string' && sourceId.length <= 128 && sourceId.startsWith('window:')) {
    const parts = sourceId.split(':');
    const hwndStr = parts[1];
    if (hwndStr && /^\d{1,20}$/.test(hwndStr)) {
      args.push('--hwnd', hwndStr, '--fallback-exclude-pid', String(process.pid));
    } else {
      args.push('--exclude-pid', String(process.pid));
    }
  } else {
    args.push('--exclude-pid', String(process.pid));
  }

  try {
    const child = spawn(exePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    audioCaptureProcess = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-audio-chunk', chunk);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log(msg);
      }
    });

    child.on('exit', (code) => {
      if (audioCaptureProcess === child) {
        audioCaptureProcess = null;
      }
      if (code !== 0 && code !== null) {
        console.warn(`[WASAPI] Processo finalizado com código ${code}`);
      }
    });

    return { started: true, mode: sourceId?.startsWith('window:') ? 'include-window-tree' : 'exclude-xolas-tree' };
  } catch (err: any) {
    console.error('[WASAPI] Erro ao iniciar wasapi-loopback.exe:', err);
    return { started: false, reason: err?.message || String(err) };
  }
});

ipcMain.handle('stop-process-audio-capture', () => {
  stopProcessAudioCapture();
  return { stopped: true };
});

app.whenReady().then(() => {
  try {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          if (sources && sources.length > 0) {
            callback({ video: sources[0] });
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
  stopProcessAudioCapture();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
