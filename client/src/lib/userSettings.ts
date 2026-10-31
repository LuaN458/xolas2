export interface UserKeybindings {
  toggleMute: string;
  toggleDeafen: string;
  stopScreenShare: string;
}

export interface UserAudioSettings {
  selectedAudioDeviceId: string;
  selectedAudioDeviceLabel: string;
  masterOutputVolume: number; // 0 a 100
  streamVolume: number; // 0 a 100
  isStreamMuted: boolean;
  micInputGain: number; // 0 a 100
  voiceActivationThreshold: number; // 0 a 100 (limiar de ativação de voz estilo Discord)
  screenResolution: '720p' | '1080p';
  screenFps: 30 | 60;
  screenIncludeAudio: boolean;
  screenStreamMode: 'fluidity' | 'balanced' | 'detail';
  keybindings: UserKeybindings;
}

const SETTINGS_STORAGE_KEY = 'xolas_user_audio_settings';
const SETTINGS_EVENT_NAME = 'xolas_settings_updated';

export const DEFAULT_USER_KEYBINDINGS: UserKeybindings = {
  toggleMute: 'CommandOrControl+Shift+M',
  toggleDeafen: 'CommandOrControl+Shift+D',
  stopScreenShare: 'CommandOrControl+Shift+S',
};

export const DEFAULT_USER_SETTINGS: UserAudioSettings = {
  selectedAudioDeviceId: 'default',
  selectedAudioDeviceLabel: '',
  masterOutputVolume: 100,
  streamVolume: 100,
  isStreamMuted: false,
  micInputGain: 100,
  voiceActivationThreshold: 20,
  screenResolution: '1080p',
  screenFps: 60,
  screenIncludeAudio: true,
  screenStreamMode: 'fluidity',
  keybindings: DEFAULT_USER_KEYBINDINGS,
};

/**
 * Converte aceleradores do Electron (ex: 'CommandOrControl+Shift+M' ou 'ShiftLeft') em lista legível para UI.
 */
export function formatAcceleratorForDisplay(accelerator: string): string[] {
  if (!accelerator || !accelerator.trim()) return [];
  const parts = accelerator.split('+').map((p) => p.trim());
  return parts.map((part) => {
    switch (part.toLowerCase()) {
      case 'shiftleft':
        return 'Shift (Esq)';
      case 'shiftright':
        return 'Shift (Dir)';
      case 'controlleft':
      case 'ctrlleft':
        return 'Ctrl (Esq)';
      case 'controlright':
      case 'ctrlright':
        return 'Ctrl (Dir)';
      case 'altleft':
        return 'Alt';
      case 'altright':
        return 'Alt Gr';
      case 'commandorcontrol':
      case 'ctrl':
      case 'control':
        return 'Ctrl';
      case 'shift':
        return 'Shift';
      case 'alt':
        return 'Alt';
      case 'super':
      case 'meta':
        return 'Win';
      case 'space':
        return 'Espaço';
      case 'capslock':
        return 'Caps Lock';
      default:
        return part.length === 1 ? part.toUpperCase() : part;
    }
  });
}

/**
 * Converte um KeyboardEvent do navegador em acelerador compatível com o Electron ou tecla física direta (ex: 'ShiftLeft').
 * Se allowSingleModifier for true (ou no keyup/registro direto), permite teclas individuais como ShiftLeft, ControlLeft, etc.
 */
export function keyboardEventToAccelerator(e: KeyboardEvent, allowSingleModifier: boolean = true): string | null {
  if (e.key === 'Escape') {
    return null; // Tecla Escape cancela gravação
  }

  const isModifierKey = ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key);

  // Se for tecla modificadora isolada
  if (isModifierKey) {
    if (!allowSingleModifier) return null;
    if (e.code === 'ShiftLeft') return 'ShiftLeft';
    if (e.code === 'ShiftRight') return 'ShiftRight';
    if (e.code === 'ControlLeft') return 'ControlLeft';
    if (e.code === 'ControlRight') return 'ControlRight';
    if (e.code === 'AltLeft') return 'AltLeft';
    if (e.code === 'AltRight') return 'AltRight';
    return e.code || e.key;
  }

  const parts: string[] = [];

  if (e.ctrlKey || e.metaKey) {
    parts.push('CommandOrControl');
  }
  if (e.shiftKey) {
    parts.push('Shift');
  }
  if (e.altKey) {
    parts.push('Alt');
  }

  let mainKey = e.key;

  if (mainKey.length === 1) {
    mainKey = mainKey.toUpperCase();
  } else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(mainKey)) {
    mainKey = mainKey.toUpperCase();
  } else if (mainKey === ' ' || e.code === 'Space') {
    mainKey = 'Space';
  } else if (e.code === 'CapsLock') {
    mainKey = 'CapsLock';
  }

  parts.push(mainKey);
  return parts.join('+');
}

// Cache em memória para sincronização atômica e evitar leitura de estados obsoletos
let cachedSettings: UserAudioSettings | null = null;
let isNativeSyncInitialized = false;

/**
 * Normaliza e valida um objeto parcial de configurações aplicando valores padrão seguros.
 */
function sanitizeUserSettings(parsed: any): UserAudioSettings {
  const legacyDevice = typeof localStorage !== 'undefined' ? localStorage.getItem('selected_audio_device') : null;
  const legacyMaster = typeof localStorage !== 'undefined' ? localStorage.getItem('master_output_volume') : null;

  const masterOutput = Number(parsed?.masterOutputVolume ?? (legacyMaster ? Number(legacyMaster) : DEFAULT_USER_SETTINGS.masterOutputVolume));
  const streamVol = Number(parsed?.streamVolume ?? DEFAULT_USER_SETTINGS.streamVolume);
  const micGain = Number(parsed?.micInputGain ?? DEFAULT_USER_SETTINGS.micInputGain);
  const thresholdVal = Number(parsed?.voiceActivationThreshold ?? DEFAULT_USER_SETTINGS.voiceActivationThreshold);
  const fpsVal = Number(parsed?.screenFps ?? DEFAULT_USER_SETTINGS.screenFps);

  const rawKeybindings = parsed?.keybindings || {};
  const keybindings: UserKeybindings = {
    toggleMute: rawKeybindings.toggleMute !== undefined ? rawKeybindings.toggleMute : DEFAULT_USER_KEYBINDINGS.toggleMute,
    toggleDeafen: rawKeybindings.toggleDeafen !== undefined ? rawKeybindings.toggleDeafen : DEFAULT_USER_KEYBINDINGS.toggleDeafen,
    stopScreenShare: rawKeybindings.stopScreenShare !== undefined ? rawKeybindings.stopScreenShare : DEFAULT_USER_KEYBINDINGS.stopScreenShare,
  };

  return {
    selectedAudioDeviceId: parsed?.selectedAudioDeviceId || legacyDevice || DEFAULT_USER_SETTINGS.selectedAudioDeviceId,
    selectedAudioDeviceLabel: parsed?.selectedAudioDeviceLabel || '',
    masterOutputVolume: isNaN(masterOutput) ? 100 : Math.max(0, Math.min(100, masterOutput)),
    streamVolume: isNaN(streamVol) ? 100 : Math.max(0, Math.min(100, streamVol)),
    isStreamMuted: Boolean(parsed?.isStreamMuted ?? DEFAULT_USER_SETTINGS.isStreamMuted),
    micInputGain: isNaN(micGain) ? 100 : Math.max(0, Math.min(100, micGain)),
    voiceActivationThreshold: isNaN(thresholdVal) ? 20 : Math.max(0, Math.min(100, thresholdVal)),
    screenResolution: parsed?.screenResolution === '720p' ? '720p' : '1080p',
    screenFps: fpsVal === 30 ? 30 : 60,
    screenIncludeAudio: parsed?.screenIncludeAudio !== undefined ? Boolean(parsed.screenIncludeAudio) : DEFAULT_USER_SETTINGS.screenIncludeAudio,
    screenStreamMode: ['fluidity', 'balanced', 'detail'].includes(parsed?.screenStreamMode)
      ? parsed.screenStreamMode
      : 'fluidity',
    keybindings,
  };
}

/**
 * Inicializa a sincronização com o arquivo nativo JSON do Electron (AppData/Xolas/user-settings.json).
 */
export function initNativeSettingsSync(): void {
  if (isNativeSyncInitialized || typeof window === 'undefined') return;
  isNativeSyncInitialized = true;

  if (window.electronAPI?.loadUserSettings) {
    window.electronAPI.loadUserSettings().then((nativeSettings) => {
      if (nativeSettings && typeof nativeSettings === 'object') {
        const sanitized = sanitizeUserSettings(nativeSettings);
        cachedSettings = sanitized;

        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
          if (sanitized.selectedAudioDeviceId) {
            localStorage.setItem('selected_audio_device', sanitized.selectedAudioDeviceId);
          }
          localStorage.setItem('master_output_volume', String(sanitized.masterOutputVolume));
        } catch {}

        window.dispatchEvent(new CustomEvent(SETTINGS_EVENT_NAME, { detail: sanitized }));
      }
    }).catch((err) => {
      console.warn('[Settings] Falha ao sincronizar configurações nativas do Electron:', err);
    });
  }
}

// Disparar sincronização na inicialização
if (typeof window !== 'undefined') {
  initNativeSettingsSync();
}

/**
 * Carrega as preferências salvas com suporte a cache em memória, arquivo físico e localStorage.
 */
export function getUserSettings(): UserAudioSettings {
  if (cachedSettings) {
    return { ...cachedSettings };
  }

  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : {};
    const sanitized = sanitizeUserSettings(parsed);
    cachedSettings = sanitized;
    return { ...sanitized };
  } catch (err) {
    console.warn('Erro ao carregar configurações do usuário:', err);
    return { ...DEFAULT_USER_SETTINGS };
  }
}

/**
 * Resolve o dispositivo de áudio ativo: tenta por ID; se não encontrar, tenta por Label (para contornar
 * re-hashing de GUIDs do Windows); se nenhum corresponder, retorna 'default' com flag isFallback=true.
 */
export function resolveAudioDevice(
  devices: MediaDeviceInfo[],
  savedId?: string,
  savedLabel?: string
): { deviceId: string; label: string; isFallback: boolean } {
  if (!devices || devices.length === 0) {
    return { deviceId: 'default', label: 'Padrão do Sistema', isFallback: true };
  }

  // 1. Tentar correspondência exata por ID válido (que não seja 'default' ou 'communications')
  if (savedId && savedId !== 'default' && savedId !== 'communications') {
    const matchId = devices.find((d) => d.deviceId === savedId);
    if (matchId) {
      return { deviceId: matchId.deviceId, label: matchId.label || savedLabel || '', isFallback: false };
    }
  }

  // 2. Tentar correspondência por Label se o ID não for encontrado (apenas se houver labels expostos)
  if (savedLabel && savedLabel.trim()) {
    const cleanSaved = savedLabel.toLowerCase().trim();
    const matchLabel = devices.find(
      (d) => d.label && d.label.toLowerCase().trim() === cleanSaved
    );
    if (matchLabel) {
      return { deviceId: matchLabel.deviceId, label: matchLabel.label, isFallback: false };
    }
  }

  // Se o usuário já havia configurado 'default', não é fallback de erro
  const isExplicitDefault = !savedId || savedId === 'default';
  return { deviceId: 'default', label: 'Padrão do Sistema', isFallback: !isExplicitDefault };
}

/**
 * Salva uma preferência individual e notifica outros componentes em tempo real.
 */
export function saveUserSetting<K extends keyof UserAudioSettings>(key: K, value: UserAudioSettings[K]): UserAudioSettings {
  const current = getUserSettings();
  const updated: UserAudioSettings = {
    ...current,
    [key]: value,
  };
  cachedSettings = updated;

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));

    // Manter chaves legadas sincronizadas para máxima compatibilidade
    if (key === 'selectedAudioDeviceId') {
      localStorage.setItem('selected_audio_device', String(value));
    } else if (key === 'masterOutputVolume') {
      localStorage.setItem('master_output_volume', String(value));
    }

    // Persistir em arquivo físico no Electron
    if (typeof window !== 'undefined' && window.electronAPI?.saveUserSettings) {
      window.electronAPI.saveUserSettings(updated).catch(() => {});
    }

    // Disparar evento para que componentes abertos sincronizem seus estados instantaneamente
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT_NAME, { detail: updated }));
    }
  } catch (err) {
    console.warn('Erro ao salvar configuração do usuário:', err);
  }

  return updated;
}

/**
 * Salva múltiplas configurações de uma vez.
 */
export function saveMultipleUserSettings(partial: Partial<UserAudioSettings>): UserAudioSettings {
  const current = getUserSettings();
  const updated: UserAudioSettings = {
    ...current,
    ...partial,
  };
  cachedSettings = updated;

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));

    if (partial.selectedAudioDeviceId !== undefined) {
      localStorage.setItem('selected_audio_device', String(partial.selectedAudioDeviceId));
    }
    if (partial.masterOutputVolume !== undefined) {
      localStorage.setItem('master_output_volume', String(partial.masterOutputVolume));
    }

    // Persistir em arquivo físico no Electron
    if (typeof window !== 'undefined' && window.electronAPI?.saveUserSettings) {
      window.electronAPI.saveUserSettings(updated).catch(() => {});
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT_NAME, { detail: updated }));
    }
  } catch (err) {
    console.warn('Erro ao salvar configurações do usuário:', err);
  }

  return updated;
}

/**
 * Registra um ouvinte para sincronização instantânea em componentes React.
 */
export function subscribeToSettingsChange(callback: (settings: UserAudioSettings) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: Event) => {
    const custom = event as CustomEvent<UserAudioSettings>;
    if (custom.detail) {
      callback(custom.detail);
    } else {
      callback(getUserSettings());
    }
  };

  window.addEventListener(SETTINGS_EVENT_NAME, handler);
  return () => {
    window.removeEventListener(SETTINGS_EVENT_NAME, handler);
  };
}
