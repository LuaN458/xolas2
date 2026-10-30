import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../../lib/api';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { Channel, Message } from '../../types';
import { MessageItem } from './MessageItem';
import { MessageSquareText } from 'lucide-react';

interface MessageAreaProps {
  channel: Channel;
}

export const MessageArea: React.FC<MessageAreaProps> = ({ channel }) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === 'ADMIN';

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!isAdmin) return;
      // Remoção otimista imediata na UI
      setMessages((prev) => prev.filter((m) => m.id !== messageId));

      if (socket) {
        socket.emit('admin:delete-message', {
          channelId: channel.id,
          messageId,
        });
      }

      try {
        await api.delete(`/api/channels/${channel.id}/messages/${messageId}`);
      } catch (err) {
        console.warn('Exclusão de mensagem via HTTP falhou (ou já processada via socket):', err);
      }
    },
    [isAdmin, socket, channel.id]
  );

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    async function loadMessages() {
      try {
        const response = await api.get(`/api/channels/${channel.id}/messages`);
        if (isMounted) {
          setMessages(response.data.messages);
        }
      } catch (err) {
        console.error('Falha ao carregar mensagens:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadMessages();

    if (socket) {
      socket.emit('join-channel', channel.id);

      const handleNewMessage = (msg: Message) => {
        if (msg.channelId === channel.id) {
          setMessages((prev) => [...prev, msg]);
        }
      };

      const handleMessageDeleted = (data: { channelId: string; messageId: string }) => {
        if (data.channelId === channel.id) {
          setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
        }
      };

      socket.on('new-message', handleNewMessage);
      socket.on('message-deleted', handleMessageDeleted);

      return () => {
        socket.emit('leave-channel', channel.id);
        socket.off('new-message', handleNewMessage);
        socket.off('message-deleted', handleMessageDeleted);
        isMounted = false;
      };
    }

    return () => {
      isMounted = false;
    };
  }, [channel.id, socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col justify-between bg-obsidian-bg">
      <div>
        {/* Banner de início do canal (Studio Minimalista) */}
        <div className="px-3 py-6 mb-4 border-b border-obsidian-border">
          <div className="w-10 h-10 rounded-xl bg-obsidian-card border border-obsidian-border flex items-center justify-center text-obsidian-accent mb-3">
            <MessageSquareText className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-bold text-obsidian-text-primary mb-1">
            #{channel.name}
          </h2>
          <p className="text-obsidian-text-muted text-xs">
            Início do histórico de discussões neste espaço.
          </p>
        </div>

        {/* Lista de Mensagens */}
        {loading ? (
          <div className="text-center py-8 text-obsidian-text-muted text-xs font-mono">
            Carregando mensagens...
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                isAdmin={isAdmin}
                onDelete={handleDeleteMessage}
              />
            ))}
          </div>
        )}
      </div>

      <div ref={bottomRef} />
    </div>
  );
};
