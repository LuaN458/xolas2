import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../lib/api';
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
  logout: () => void;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  setToken: React.Dispatch<React.SetStateAction<string | null>>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('discord_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      const savedToken = localStorage.getItem('discord_token');
      if (!savedToken) {
        setLoading(false);
        return;
      }

      try {
        const response = await api.get('/api/auth/me');
        const loadedUser: User = response.data.user;
        if (loadedUser.approvalStatus === 'PENDING' || !loadedUser.isApproved) {
          localStorage.removeItem('discord_token');
          setToken(null);
          setUser(null);
        } else {
          setUser(loadedUser);
        }
      } catch (err: any) {
        console.error('Falha ao autenticar com token salvo:', err);
        // Só limpa o token se for erro explícito de autenticação inválida (401 / 403)
        if (err.response?.status === 401 || err.response?.status === 403) {
          localStorage.removeItem('discord_token');
          setToken(null);
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, []);

  const login = async (username: string, password: string) => {
    const response = await api.post('/api/auth/login', { username, password });
    const { user: loggedUser, token: authToken, approvalStatus } = response.data;

    if (approvalStatus === 'PENDING' || loggedUser?.approvalStatus === 'PENDING') {
      return { status: 'PENDING' as const, user: loggedUser };
    }

    localStorage.setItem('discord_token', authToken);
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

    localStorage.setItem('discord_token', authToken);
    setToken(authToken);
    setUser(registeredUser);
    return { status: 'APPROVED' as const, user: registeredUser };
  };

  const updateUsername = async (newUsername: string) => {
    const response = await api.patch('/api/auth/profile', { username: newUsername });
    const updatedUser = response.data.user;
    setUser(updatedUser);
  };

  const logout = () => {
    localStorage.removeItem('discord_token');
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
