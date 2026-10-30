import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import {
  clearStoredAuthSession,
  getAuthToken,
  getStoredAuthSync,
  loadStoredAuthNative,
  persistAuthSession,
} from '../lib/authStorage';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ status: 'APPROVED' | 'PENDING'; user?: User }>;
  register: (
    username: string,
    password: string,
    email?: string
  ) => Promise<{ status: 'APPROVED' | 'PENDING'; user?: User }>;
  updateUsername: (newUsername: string) => Promise<void>;
  updateProfile: (data: { username?: string; avatarUrl?: string }) => Promise<User>;
  updateAvatar: (newAvatarUrl: string) => Promise<User>;
  logout: () => void;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  setToken: React.Dispatch<React.SetStateAction<string | null>>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialSync = getStoredAuthSync();
  const [user, setUser] = useState<User | null>(initialSync.user);
  const [token, setToken] = useState<string | null>(initialSync.token);
  const [loading, setLoading] = useState<boolean>(() => !(initialSync.token && initialSync.user));
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isMounted = true;

    const clearRetryTimer = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    async function verifySessionWithServer(activeToken: string) {
      if (!isMounted || !activeToken) return;

      try {
        const response = await api.get('/api/auth/me');
        if (!isMounted) return;

        const loadedUser: User = response.data.user;
        const refreshedToken: string = response.data.token || activeToken;

        if (
          loadedUser.approvalStatus === 'PENDING' ||
          loadedUser.approvalStatus === 'REJECTED' ||
          !loadedUser.isApproved
        ) {
          clearStoredAuthSession();
          setToken(null);
          setUser(null);
        } else {
          persistAuthSession(refreshedToken, loadedUser);
          setToken(refreshedToken);
          setUser(loadedUser);
        }
        clearRetryTimer();
      } catch (err: any) {
        if (!isMounted) return;
        const status = err.response?.status;
        console.warn('[Auth] Falha ao sincronizar sessão com o servidor:', status || err.message);

        // Só desloga se o servidor recusar explicitamente a sessão (401 / 403)
        if (status === 401 || status === 403) {
          clearStoredAuthSession();
          setToken(null);
          setUser(null);
          clearRetryTimer();
        } else {
          // Falha de rede, timeout ou servidor acordando (Cold Start ao ligar o PC):
          // mantém o usuário logado localmente e tenta sincronizar novamente em 5 segundos
          clearRetryTimer();
          retryTimerRef.current = setTimeout(() => {
            const currentToken = getAuthToken();
            if (currentToken && isMounted) {
              verifySessionWithServer(currentToken);
            }
          }, 5000);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    async function bootstrapAuth() {
      // 1. Carregar sessão do arquivo físico nativo do Electron (AppData/Roaming/Xolas/auth-session.json)
      const stored = await loadStoredAuthNative();
      if (!isMounted) return;

      if (!stored.token) {
        setLoading(false);
        return;
      }

      setToken(stored.token);
      if (stored.user) {
        // Entrar imediatamente no app com o usuário salvo em disco (sem bloquear na tela de loading)
        setUser(stored.user);
        setLoading(false);
      }

      // 2. Validar e sincronizar com o servidor em segundo plano (com retentativas automáticas)
      await verifySessionWithServer(stored.token);
    }

    bootstrapAuth();

    const handleOnline = () => {
      const currentToken = getAuthToken();
      if (currentToken && isMounted) {
        verifySessionWithServer(currentToken);
      }
    };

    window.addEventListener('online', handleOnline);

    return () => {
      isMounted = false;
      clearRetryTimer();
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const login = async (username: string, password: string) => {
    const response = await api.post('/api/auth/login', { username, password });
    const { user: loggedUser, token: authToken, approvalStatus } = response.data;

    if (approvalStatus === 'PENDING' || loggedUser?.approvalStatus === 'PENDING') {
      return { status: 'PENDING' as const, user: loggedUser };
    }

    persistAuthSession(authToken, loggedUser);
    setToken(authToken);
    setUser(loggedUser);
    return { status: 'APPROVED' as const, user: loggedUser };
  };

  const register = async (username: string, password: string, email?: string) => {
    const response = await api.post('/api/auth/register', { username, password, email });
    const { user: registeredUser, token: authToken, approvalStatus } = response.data;

    if (approvalStatus === 'PENDING' || registeredUser?.approvalStatus === 'PENDING') {
      return { status: 'PENDING' as const, user: registeredUser };
    }

    persistAuthSession(authToken, registeredUser);
    setToken(authToken);
    setUser(registeredUser);
    return { status: 'APPROVED' as const, user: registeredUser };
  };

  const updateProfile = async (data: { username?: string; avatarUrl?: string }): Promise<User> => {
    const response = await api.patch('/api/auth/profile', data);
    const updatedUser: User = response.data.user;
    const currentToken = getAuthToken() || token;
    if (currentToken) {
      persistAuthSession(currentToken, updatedUser);
    }
    setUser(updatedUser);
    return updatedUser;
  };

  const updateUsername = async (newUsername: string) => {
    await updateProfile({ username: newUsername });
  };

  const updateAvatar = async (newAvatarUrl: string): Promise<User> => {
    return await updateProfile({ avatarUrl: newAvatarUrl });
  };

  const logout = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    clearStoredAuthSession();
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        updateUsername,
        updateProfile,
        updateAvatar,
        logout,
        setUser,
        setToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
