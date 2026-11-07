export interface CustomRole {
  id: string;
  name: string;
  color: string;
  permissions: string[];
  isDefault?: boolean;
  userCount?: number;
  createdAt?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
  status?: string;
  role?: 'ADMIN' | 'USER';
  customRoleId?: string | null;
  customRole?: CustomRole | null;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  isApproved?: boolean;
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
  attachmentUrl?: string | null;
  attachmentType?: string | null;
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

export interface VercelMetricsData {
  configured: boolean;
  projectId?: string;
  projectName?: string;
  framework?: string;
  latencyMs?: number;
  lastChecked: string;
  productionDeployment?: {
    id: string;
    url: string;
    state: string;
    createdAt: number;
    readyAt?: number;
    buildDurationSeconds?: number;
    commitMessage?: string;
    commitSha?: string;
    branch?: string;
  } | null;
  recentDeployments: Array<{
    id: string;
    url: string;
    state: string;
    createdAt: number;
    creator?: string;
    commitMessage?: string;
  }>;
  domains: Array<{
    name: string;
    apexName?: string;
    verified?: boolean;
  }>;
  metrics: {
    totalRequestsEstimate: number;
    errorRatePercent: number;
    latencyMs: number;
    bandwidthBytesEstimate: number;
    status: 'healthy' | 'degraded' | 'error' | 'not_configured';
  };
  websocketCompatibilityNotice: {
    isServerless: boolean;
    notice: string;
    recommendedSocketHost: string;
  };
}

declare global {
  interface Window {
    electronAPI?: {
      getScreenSources: () => Promise<ScreenSource[]>;
      checkWindowExists?: (sourceId?: string) => Promise<boolean>;
      isElectron?: boolean;
      openExternal?: (url: string) => Promise<void>;
      getAppVersion?: () => Promise<string>;
      checkForUpdates?: () => Promise<{ status: string; version: string; error?: string; result?: any }>;
      restartAndInstall?: () => Promise<void>;
      onPrepareForRestart?: (callback: () => void) => () => void;
      onUpdateAvailable?: (callback: (info: UpdateInfo) => void) => () => void;
      onUpdateProgress?: (callback: (progress: UpdateProgress) => void) => () => void;
      onUpdateDownloaded?: (callback: (info: UpdateInfo) => void) => () => void;
      onUpdateNotAvailable?: (callback: (info: UpdateInfo) => void) => () => void;
      onUpdateError?: (callback: (error: string) => void) => () => void;
      startProcessAudioCapture?: (sourceId?: string) => Promise<{ started: boolean; mode?: string; reason?: string }>;
      stopProcessAudioCapture?: () => Promise<{ stopped: boolean }>;
      onProcessAudioChunk?: (callback: (chunk: Uint8Array) => void) => () => void;
      registerGlobalHotkeys?: (hotkeys: Record<string, string>) => Promise<{ success: boolean; registered: string[] }>;
      onHotkeyTrigger?: (callback: (action: string) => void) => () => void;
      loadUserSettings?: () => Promise<any>;
      saveUserSettings?: (settings: any) => Promise<{ success: boolean }>;
      loadAuthSession?: () => Promise<{
        token?: string | null;
        user?: User | null;
        lastUsername?: string;
        cachedServers?: Server[];
        cachedServerDetails?: Record<string, Server>;
        updatedAt?: string;
      } | null>;
      saveAuthSession?: (sessionData: {
        token?: string | null;
        user?: User | null;
        lastUsername?: string;
        cachedServers?: Server[];
        cachedServerDetails?: Record<string, Server>;
      }) => Promise<{ success: boolean }>;
      clearAuthSession?: (keepLastUsername?: string) => Promise<{ success: boolean }>;
    };
  }
}
