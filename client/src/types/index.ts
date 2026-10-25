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

declare global {
  interface Window {
    electronAPI?: {
      getScreenSources: () => Promise<ScreenSource[]>;
      isElectron?: boolean;
    };
  }
}
