export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
  status?: string;
  createdAt?: string;
}

export interface Channel {
  id: string;
  name: string;
  type: 'TEXT' | 'VOICE';
  serverId: string;
}

export interface Member {
  id: string;
  role: string;
  userId: string;
  serverId: string;
  user: User;
}

export interface Server {
  id: string;
  name: string;
  iconUrl?: string | null;
  ownerId: string;
  channels: Channel[];
  members: Member[];
}

export interface Message {
  id: string;
  content: string;
  userId: string;
  channelId: string;
  createdAt: string;
  user: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
}

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string | null;
}

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | Array<{ note: string }>;
}

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

declare global {
  interface Window {
    electronAPI?: {
      getScreenSources: () => Promise<ScreenSource[]>;
      isElectron?: boolean;
      openExternal?: (url: string) => Promise<void>;
      getAppVersion?: () => Promise<string>;
      checkForUpdates?: () => Promise<{ status: string; version: string; error?: string; result?: any }>;
      restartAndInstall?: () => Promise<void>;
      onUpdateAvailable?: (callback: (info: UpdateInfo) => void) => () => void;
      onUpdateProgress?: (callback: (progress: UpdateProgress) => void) => () => void;
      onUpdateDownloaded?: (callback: (info: UpdateInfo) => void) => () => void;
      onUpdateNotAvailable?: (callback: (info: UpdateInfo) => void) => () => void;
      onUpdateError?: (callback: (error: string) => void) => () => void;
      startProcessAudioCapture?: (sourceId?: string) => Promise<{ started: boolean; mode?: string; reason?: string }>;
      stopProcessAudioCapture?: () => Promise<{ stopped: boolean }>;
      onProcessAudioChunk?: (callback: (chunk: Uint8Array) => void) => () => void;
    };
  }
}
