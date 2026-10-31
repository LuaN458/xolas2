import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE } from '../lib/api';
import { getAuthToken } from '../lib/authStorage';
import { useAuth } from './AuthContext';

export interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  isReconnecting: boolean;
  connectionError: string | null;
  reconnectAttempts: number;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isReconnecting: false,
  connectionError: null,
  reconnectAttempts: 0,
});

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token || !user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
      setIsConnected(false);
      setIsReconnecting(false);
      setConnectionError(null);
      setReconnectAttempts(0);
      return;
    }

    const newSocket = io(API_BASE, {
      auth: (cb) => {
        const currentToken = getAuthToken() || token;
        cb({ token: currentToken });
      },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = newSocket;

    const handleConnect = () => {
      setIsConnected(true);
      setIsReconnecting(false);
      setConnectionError(null);
      setReconnectAttempts(0);
    };

    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      setIsConnected(false);
      if (reason === 'io server disconnect') {
        setConnectionError('Desconectado pelo servidor');
      }
    };

    const handleConnectError = (err: Error) => {
      setIsConnected(false);
      setConnectionError(err.message || 'Erro de conexão com o servidor');
      console.warn('[SocketContext] connect_error:', err.message);
    };

    const handleReconnectAttempt = (attempt: number) => {
      setIsReconnecting(true);
      setReconnectAttempts(attempt);
    };

    const handleReconnect = (_attempt: number) => {
      setIsConnected(true);
      setIsReconnecting(false);
      setConnectionError(null);
      setReconnectAttempts(0);
    };

    const handleReconnectError = (err: Error) => {
      setConnectionError(err.message || 'Erro durante reconexão');
      console.warn('[SocketContext] reconnect_error:', err.message);
    };

    const handleReconnectFailed = () => {
      setIsReconnecting(false);
      setConnectionError('Falha ao reconectar ao servidor');
      console.error('[SocketContext] reconnect_failed');
    };

    newSocket.on('connect', handleConnect);
    newSocket.on('disconnect', handleDisconnect);
    newSocket.on('connect_error', handleConnectError);

    newSocket.io.on('reconnect_attempt', handleReconnectAttempt);
    newSocket.io.on('reconnect', handleReconnect);
    newSocket.io.on('reconnect_error', handleReconnectError);
    newSocket.io.on('reconnect_failed', handleReconnectFailed);

    setSocket(newSocket);

    return () => {
      newSocket.off('connect', handleConnect);
      newSocket.off('disconnect', handleDisconnect);
      newSocket.off('connect_error', handleConnectError);

      newSocket.io.off('reconnect_attempt', handleReconnectAttempt);
      newSocket.io.off('reconnect', handleReconnect);
      newSocket.io.off('reconnect_error', handleReconnectError);
      newSocket.io.off('reconnect_failed', handleReconnectFailed);

      newSocket.disconnect();
      if (socketRef.current === newSocket) {
        socketRef.current = null;
      }
    };
  }, [token, user?.id]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        isReconnecting,
        connectionError,
        reconnectAttempts,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
