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
}

const SETTINGS_STORAGE_KEY = 'xolas_user_audio_settings';
const SETTINGS_EVENT_NAME = 'xolas_settings_updated';

export const DEFAULT_USER_SETTINGS: UserAudioSettings = {
  selectedAudioDeviceId: 'default',
  selectedAudioDeviceLabel: '',
  masterOutputVolume: 100,
  streamVolume: 100,
  isStreamMuted: false,
  micInputGain: 100,
  voiceActivationThreshold: 35,
  screenResolution: '1080p',
  screenFps: 60,
  screenIncludeAudio: true,
};

/**
 * Carrega as preferências salvas no localStorage com suporte a fallbacks seguros e chaves legadas.
 */
export function getUserSettings(): UserAudioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    // Compatibilidade com chaves legadas anteriores
    const legacyDevice = localStorage.getItem('selected_audio_device');
    const legacyMaster = localStorage.getItem('master_output_volume');

    const masterOutput = Number(parsed.masterOutputVolume ?? (legacyMaster ? Number(legacyMaster) : DEFAULT_USER_SETTINGS.masterOutputVolume));
    const streamVol = Number(parsed.streamVolume ?? DEFAULT_USER_SETTINGS.streamVolume);
    const micGain = Number(parsed.micInputGain ?? DEFAULT_USER_SETTINGS.micInputGain);
    const thresholdVal = Number(parsed.voiceActivationThreshold ?? DEFAULT_USER_SETTINGS.voiceActivationThreshold);
    const fpsVal = Number(parsed.screenFps ?? DEFAULT_USER_SETTINGS.screenFps);

    return {
      selectedAudioDeviceId: parsed.selectedAudioDeviceId || legacyDevice || DEFAULT_USER_SETTINGS.selectedAudioDeviceId,
      selectedAudioDeviceLabel: parsed.selectedAudioDeviceLabel || '',
      masterOutputVolume: isNaN(masterOutput) ? 100 : Math.max(0, Math.min(100, masterOutput)),
      streamVolume: isNaN(streamVol) ? 100 : Math.max(0, Math.min(100, streamVol)),
      isStreamMuted: Boolean(parsed.isStreamMuted ?? DEFAULT_USER_SETTINGS.isStreamMuted),
      micInputGain: isNaN(micGain) ? 100 : Math.max(0, Math.min(100, micGain)),
      voiceActivationThreshold: isNaN(thresholdVal) ? 35 : Math.max(0, Math.min(100, thresholdVal)),
      screenResolution: parsed.screenResolution === '720p' ? '720p' : '1080p',
      screenFps: fpsVal === 30 ? 30 : 60,
      screenIncludeAudio: parsed.screenIncludeAudio !== undefined ? Boolean(parsed.screenIncludeAudio) : DEFAULT_USER_SETTINGS.screenIncludeAudio,
    };
  } catch (err) {
    console.warn('Erro ao carregar configurações do usuário:', err);
    return { ...DEFAULT_USER_SETTINGS };
  }
}

/**
 * Resolve o dispositivo de áudio ativo: tenta por ID; se não encontrar, tenta por Label (para contornar
 * re-hashing de GUIDs do Windows); se nenhum corresponder, retorna 'default'.
 */
export function resolveAudioDevice(
  devices: MediaDeviceInfo[],
  savedId?: string,
  savedLabel?: string
): { deviceId: string; label: string } {
  if (!devices || devices.length === 0) {
    return { deviceId: 'default', label: 'Padrão do Sistema' };
  }

  // 1. Tentar correspondência exata por ID válido (que não seja 'default' ou 'communications')
  if (savedId && savedId !== 'default' && savedId !== 'communications') {
    const matchId = devices.find((d) => d.deviceId === savedId);
    if (matchId) {
      return { deviceId: matchId.deviceId, label: matchId.label };
    }
  }

  // 2. Tentar correspondência por Label se o ID não for encontrado
  if (savedLabel && savedLabel.trim()) {
    const cleanSaved = savedLabel.toLowerCase().trim();
    const matchLabel = devices.find(
      (d) => d.label && d.label.toLowerCase().trim() === cleanSaved
    );
    if (matchLabel) {
      return { deviceId: matchLabel.deviceId, label: matchLabel.label };
    }
  }

  return { deviceId: 'default', label: 'Padrão do Sistema' };
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

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));

    // Manter chaves legadas sincronizadas para máxima compatibilidade
    if (key === 'selectedAudioDeviceId') {
      localStorage.setItem('selected_audio_device', String(value));
    } else if (key === 'masterOutputVolume') {
      localStorage.setItem('master_output_volume', String(value));
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

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));

    if (partial.selectedAudioDeviceId !== undefined) {
      localStorage.setItem('selected_audio_device', String(partial.selectedAudioDeviceId));
    }
    if (partial.masterOutputVolume !== undefined) {
      localStorage.setItem('master_output_volume', String(partial.masterOutputVolume));
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
