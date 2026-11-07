import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../../lib/api';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { Channel, Message } from '../../types';
import { MessageItem } from './MessageItem';
import { Hash } from 'lucide-react';

interface MessageAreaProps {
  channel: Channel;
  layoutMode?: 'linear' | 'campsite' | 'compact';
}

export const MessageArea: React.FC<MessageAreaProps> = ({
  channel,
  layoutMode = 'linear',
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const canDelete = Boolean(
    user?.role === 'ADMIN' || user?.customRole?.permissions?.includes('delete_messages')
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!canDelete) return;
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
        console.warn('Exclusão de mensagem falhou:', err);
      }
    },
    [canDelete, socket, channel.id]
  );

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    async function loadMessages() {
      try {
        const response = await api.get(`/api/channels/${channel.id}/messages`);
        if (isMounted) {
          setMessages(response.data.messages || []);
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

      const handleConnect = () => {
        socket.emit('join-channel', channel.id);
        loadMessages();
      };

      const handleNewMessage = (msg: Message) => {
        if (msg.channelId === channel.id) {
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        }
      };

      const handleMessageDeleted = (data: { channelId: string; messageId: string }) => {
        if (data.channelId === channel.id) {
          setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
        }
      };

      socket.on('connect', handleConnect);
      socket.on('new-message', handleNewMessage);
      socket.on('message-deleted', handleMessageDeleted);

      return () => {
        socket.emit('leave-channel', channel.id);
        socket.off('connect', handleConnect);
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
    <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 flex flex-col justify-between bg-zinc-950 custom-scroll select-none">
      <div>
        {/* Banner de início do canal */}
        <div className="max-w-4xl mx-auto w-full px-2 py-6 mb-6 border-b border-zinc-800">
          <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-indigo-400 mb-3 shadow-sm">
            <Hash className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold text-zinc-100 mb-1 tracking-tight">
            #{channel.name}
          </h2>
          <p className="text-zinc-400 text-xs">
            Início do histórico de discussões neste espaço.
          </p>
        </div>

        {/* Mensagens */}
        {loading ? (
          <div className="text-center py-8 text-zinc-500 text-xs font-mono">
            Carregando discussões...
          </div>
        ) : messages.length === 0 ? (
          <div className="max-w-4xl mx-auto text-center py-12 text-zinc-500 text-xs">
            Nenhuma mensagem neste canal ainda. Seja o primeiro a enviar!
          </div>
        ) : layoutMode === 'campsite' ? (
          <div className="max-w-4xl mx-auto w-full space-y-3">
            {messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                isAdmin={canDelete}
                onDelete={handleDeleteMessage}
                layoutMode="campsite"
              />
            ))}
          </div>
        ) : layoutMode === 'compact' ? (
          <div className="max-w-4xl mx-auto w-full space-y-1">
            {messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                isAdmin={canDelete}
                onDelete={handleDeleteMessage}
                layoutMode="compact"
              />
            ))}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto w-full divide-y divide-zinc-800/80 border border-zinc-800 rounded-xl bg-zinc-900/20 overflow-hidden shadow-sm">
            {messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                isAdmin={canDelete}
                onDelete={handleDeleteMessage}
                layoutMode="linear"
              />
            ))}
          </div>
        )}
      </div>

      <div ref={bottomRef} />
    </div>
  );
};
