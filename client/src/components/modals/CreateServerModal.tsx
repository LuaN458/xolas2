import React, { useState } from 'react';
import { X, Layers } from 'lucide-react';
import { api } from '../../lib/api';
import { Server } from '../../types';

interface CreateServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onServerCreated: (server: Server) => void;
}

export const CreateServerModal: React.FC<CreateServerModalProps> = ({
  isOpen,
  onClose,
  onServerCreated,
}) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await api.post('/api/servers', {
        name: name.trim(),
      });
      onServerCreated(response.data.server);
      setName('');
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Falha ao criar espaço.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 select-none animate-in fade-in">
      <div className="bg-obsidian-surface rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl border border-obsidian-border p-6">
        <div className="flex items-center justify-between pb-4 border-b border-obsidian-border">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-obsidian-accent" />
            <h2 className="text-sm font-bold text-obsidian-text-primary">Novo Espaço de Trabalho</h2>
          </div>
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

          <div>
            <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
              Nome do Espaço
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Xolas Central"
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
              {loading ? 'Criando...' : 'Criar Espaço'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
