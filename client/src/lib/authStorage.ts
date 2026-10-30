import { Server, User } from '../types';

const TOKEN_KEY = 'discord_token';
const USER_KEY = 'discord_user';
const LAST_USERNAME_KEY = 'xolas_last_username';
const CACHED_SERVERS_KEY = 'xolas_cached_servers';
const CACHED_SERVER_DETAILS_KEY = 'xolas_cached_server_details';

let memoryToken: string | null = null;
let memoryUser: User | null = null;
let memoryLastUsername: string = '';

/**
 * Decodifica o payload básico de um JWT (sem verificar assinatura criptográfica no cliente)
 * para reconstruir o perfil mínimo do usuário caso apenas o token exista em versões antigas.
 */
export function decodeUserFromJwt(token: string): User | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const jsonPayload = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const decoded = JSON.parse(jsonPayload);
    if (!decoded || typeof decoded.userId !== 'string' || typeof decoded.username !== 'string') {
      return null;
    }

    // Se o token tiver exp e já tiver expirado há muito tempo, ainda verificamos
    if (typeof decoded.exp === 'number' && decoded.exp * 1000 < Date.now()) {
      return null;
    }

    return {
      id: decoded.userId,
      username: decoded.username,
      email: typeof decoded.email === 'string' ? decoded.email : `${decoded.username.toLowerCase()}@xolas.local`,
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(decoded.username)}`,
      role: decoded.role === 'ADMIN' ? 'ADMIN' : 'USER',
      approvalStatus: 'APPROVED',
      isApproved: true,
    };
  } catch {
    return null;
  }
}

/**
 * Lê de forma síncrona o token e o usuário salvos no localStorage ou memória.
 */
export function getStoredAuthSync(): { token: string | null; user: User | null; lastUsername: string } {
  try {
    const rawToken = memoryToken || (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null);
    const rawUserStr = typeof localStorage !== 'undefined' ? localStorage.getItem(USER_KEY) : null;
    const rawLastUsername =
      memoryLastUsername || (typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_USERNAME_KEY) || '' : '');

    let parsedUser: User | null = memoryUser;
    if (!parsedUser && rawUserStr) {
      try {
        const candidate = JSON.parse(rawUserStr);
        if (candidate && typeof candidate.id === 'string' && typeof candidate.username === 'string') {
          parsedUser = candidate;
        }
      } catch {}
    }

    // Migração automática: se existe token válido mas o objeto user ainda não havia sido salvo
    if (rawToken && !parsedUser) {
      parsedUser = decodeUserFromJwt(rawToken);
      if (parsedUser && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(parsedUser));
        } catch {}
      }
    }

    memoryToken = rawToken;
    memoryUser = parsedUser;
    if (parsedUser?.username) {
      memoryLastUsername = parsedUser.username;
    } else if (rawLastUsername) {
      memoryLastUsername = rawLastUsername;
    }

    return {
      token: rawToken,
      user: parsedUser,
      lastUsername: memoryLastUsername,
    };
  } catch {
    return { token: memoryToken, user: memoryUser, lastUsername: memoryLastUsername };
  }
}

export function getAuthToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
    if (stored) memoryToken = stored;
    return stored;
  } catch {
    return null;
  }
}

export function getLastUsername(): string {
  if (memoryLastUsername) return memoryLastUsername;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_USERNAME_KEY) : '';
    if (stored) {
      memoryLastUsername = stored;
      return stored;
    }
    const sync = getStoredAuthSync();
    return sync.lastUsername || sync.user?.username || '';
  } catch {
    return '';
  }
}

/**
 * Carrega a sessão do arquivo físico nativo do Electron (AppData/Roaming/Xolas/auth-session.json)
 * e sincroniza com o localStorage caso o localStorage tenha sido limpo na inicialização do Windows.
 */
export async function loadStoredAuthNative(): Promise<{
  token: string | null;
  user: User | null;
  lastUsername: string;
}> {
  const syncState = getStoredAuthSync();

  if (typeof window !== 'undefined' && window.electronAPI?.loadAuthSession) {
    try {
      const nativeData = await window.electronAPI.loadAuthSession();
      if (nativeData && typeof nativeData === 'object') {
        const resolvedToken = nativeData.token || syncState.token || null;
        let resolvedUser = nativeData.user || syncState.user || null;

        if (resolvedToken && !resolvedUser) {
          resolvedUser = decodeUserFromJwt(resolvedToken);
        }

        const resolvedLastUsername =
          resolvedUser?.username || nativeData.lastUsername || syncState.lastUsername || '';

        memoryToken = resolvedToken;
        memoryUser = resolvedUser;
        memoryLastUsername = resolvedLastUsername;

        // Restaurar no localStorage se estava ausente
        try {
          if (resolvedToken) {
            localStorage.setItem(TOKEN_KEY, resolvedToken);
          }
          if (resolvedUser) {
            localStorage.setItem(USER_KEY, JSON.stringify(resolvedUser));
          }
          if (resolvedLastUsername) {
            localStorage.setItem(LAST_USERNAME_KEY, resolvedLastUsername);
          }
          if (Array.isArray(nativeData.cachedServers) && nativeData.cachedServers.length > 0) {
            localStorage.setItem(CACHED_SERVERS_KEY, JSON.stringify(nativeData.cachedServers));
          }
          if (nativeData.cachedServerDetails && typeof nativeData.cachedServerDetails === 'object') {
            localStorage.setItem(CACHED_SERVER_DETAILS_KEY, JSON.stringify(nativeData.cachedServerDetails));
          }
        } catch {}

        // Se a sessão existia apenas no localStorage e ainda não no arquivo nativo, gravar no arquivo nativo
        if (resolvedToken && resolvedUser && (!nativeData.token || !nativeData.user)) {
          window.electronAPI
            .saveAuthSession?.({
              token: resolvedToken,
              user: resolvedUser,
              lastUsername: resolvedLastUsername,
            })
            .catch(() => {});
        }

        return {
          token: resolvedToken,
          user: resolvedUser,
          lastUsername: resolvedLastUsername,
        };
      }
    } catch (err) {
      console.warn('[AuthStorage] Falha ao ler sessão nativa do Electron:', err);
    }
  }

  // Se já existe sessão no localStorage e o arquivo nativo estava vazio, persistir no arquivo nativo
  if (syncState.token && syncState.user && typeof window !== 'undefined' && window.electronAPI?.saveAuthSession) {
    window.electronAPI
      .saveAuthSession({
        token: syncState.token,
        user: syncState.user,
        lastUsername: syncState.user.username || syncState.lastUsername,
      })
      .catch(() => {});
  }

  return syncState;
}

/**
 * Persiste o token e o objeto user tanto no localStorage quanto no arquivo físico do Electron.
 */
export function persistAuthSession(token: string, user: User): void {
  memoryToken = token;
  memoryUser = user;
  if (user?.username) {
    memoryLastUsername = user.username;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      if (user?.username) {
        localStorage.setItem(LAST_USERNAME_KEY, user.username);
      }
    }
  } catch (err) {
    console.warn('[AuthStorage] Erro ao salvar sessão no localStorage:', err);
  }

  if (typeof window !== 'undefined' && window.electronAPI?.saveAuthSession) {
    window.electronAPI
      .saveAuthSession({
        token,
        user,
        lastUsername: user?.username || memoryLastUsername,
      })
      .catch(() => {});
  }
}

/**
 * Limpa a sessão ativa (quando o usuário clica em Sair ou o token é recusado com 401/403),
 * mantendo o último nickname salvo para facilitar o próximo acesso.
 */
export function clearStoredAuthSession(): void {
  const keepUsername = memoryUser?.username || memoryLastUsername || getLastUsername();
  memoryToken = null;
  memoryUser = null;
  if (keepUsername) {
    memoryLastUsername = keepUsername;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      if (keepUsername) {
        localStorage.setItem(LAST_USERNAME_KEY, keepUsername);
      }
    }
  } catch {}

  if (typeof window !== 'undefined' && window.electronAPI?.clearAuthSession) {
    window.electronAPI.clearAuthSession(keepUsername).catch(() => {});
  }
}

/**
 * Cache local de servidores e canais para exibição imediata ao abrir o app enquanto a rede conecta.
 */
export function getCachedServers(): Server[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHED_SERVERS_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistCachedServers(servers: Server[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CACHED_SERVERS_KEY, JSON.stringify(servers));
    }
    if (typeof window !== 'undefined' && window.electronAPI?.saveAuthSession) {
      window.electronAPI.saveAuthSession({ cachedServers: servers }).catch(() => {});
    }
  } catch {}
}

export function getCachedServerDetails(serverId: string): Server | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHED_SERVER_DETAILS_KEY) : null;
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map && typeof map === 'object' && map[serverId] ? map[serverId] : null;
  } catch {
    return null;
  }
}

export function persistCachedServerDetails(server: Server): void {
  if (!server?.id) return;
  try {
    let map: Record<string, Server> = {};
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHED_SERVER_DETAILS_KEY) : null;
    if (raw) {
      try {
        map = JSON.parse(raw) || {};
      } catch {}
    }
    map[server.id] = server;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CACHED_SERVER_DETAILS_KEY, JSON.stringify(map));
    }
    if (typeof window !== 'undefined' && window.electronAPI?.saveAuthSession) {
      window.electronAPI.saveAuthSession({ cachedServerDetails: map }).catch(() => {});
    }
  } catch {}
}
