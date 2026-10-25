import React, { useState } from 'react';
import { X, MessageSquareText, Radio } from 'lucide-react';
import { api } from '../../lib/api';
import { Channel } from '../../types';

interface CreateChannelModalProps {
  isOpen: boolean;
  serverId: string;
  initialType?: 'TEXT' | 'VOICE';
  onClose: () => void;
  onChannelCreated: (channel: Channel) => void;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  serverId,
  initialType = 'TEXT',
  onClose,
  onChannelCreated,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<'TEXT' | 'VOICE'>(initialType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await api.post(`/api/servers/${serverId}/channels`, {
        name: name.trim(),
        type,
      });
      onChannelCreated(response.data.channel);
      setName('');
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Falha ao criar canal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 select-none animate-in fade-in">
      <div className="bg-obsidian-surface rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl border border-obsidian-border p-6">
        <div className="flex items-center justify-between pb-4 border-b border-obsidian-border">
          <h2 className="text-sm font-bold text-obsidian-text-primary">Novo Canal</h2>
          <button
            onClick={onClose}
            className="text-obsidian-text-muted hover:text-white transition-colors p-1 rounded-lg hover:bg-obsidian-card"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="p-2 bg-obsidian-rose/10 border border-obsidian-rose/30 text-obsidian-rose rounded-lg text-xs">
              {error}
            </div>
          )}

          {/* Tipo de Canal */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('TEXT')}
              className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                type === 'TEXT'
                  ? 'bg-obsidian-card border-obsidian-accent text-white shadow-md shadow-indigo-500/10'
                  : 'bg-obsidian-card/40 border-obsidian-border text-obsidian-text-muted hover:text-white hover:bg-obsidian-card'
              }`}
            >
              <MessageSquareText className={`w-4 h-4 ${type === 'TEXT' ? 'text-obsidian-accent' : ''}`} />
              <span className="text-xs font-medium">Discussão</span>
            </button>

            <button
              type="button"
              onClick={() => setType('VOICE')}
              className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                type === 'VOICE'
                  ? 'bg-obsidian-card border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                  : 'bg-obsidian-card/40 border-obsidian-border text-obsidian-text-muted hover:text-white hover:bg-obsidian-card'
              }`}
            >
              <Radio className={`w-4 h-4 ${type === 'VOICE' ? 'text-emerald-400' : ''}`} />
              <span className="text-xs font-medium">Áudio & Vídeo</span>
            </button>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
              Identificador do Canal
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: roadmap-q4"
              required
              autoFocus
              className="w-full bg-obsidian-card border border-obsidian-border rounded-xl p-2.5 text-obsidian-text-primary text-xs outline-none focus:border-obsidian-accent/60"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-obsidian-text-muted hover:text-white text-xs font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-4 py-1.5 bg-obsidian-accent hover:bg-obsidian-accent-hover disabled:opacity-50 text-white rounded-xl font-medium text-xs transition-colors"
            >
              {loading ? 'Criando...' : 'Criar Canal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
