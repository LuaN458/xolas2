import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { User } from '../../types';
import {
  Shield,
  Check,
  X,
  Trash2,
  Users,
  Clock,
  Search,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPendingCountChange?: (count: number) => void;
}

export const AdminModal: React.FC<AdminModalProps> = ({
  isOpen,
  onClose,
  onPendingCountChange,
}) => {
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/admin/users');
      const data = response.data;
      setUsers(data.users || []);
      if (data.counts) {
        setCounts(data.counts);
        onPendingCountChange?.(data.counts.pending || 0);
      }
    } catch (err: any) {
      console.error('Falha ao carregar usuários:', err);
      setFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Erro ao carregar lista de usuários.',
      });
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen, fetchUsers]);

  if (!isOpen) return null;

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const handleApprove = async (user: User) => {
    setActionLoadingId(user.id);
    try {
      await api.post(`/api/admin/users/${user.id}/approve`);
      showFeedback('success', `Acesso liberado para ${user.username}!`);
      await fetchUsers();
    } catch (err: any) {
      showFeedback('error', err.response?.data?.error || 'Falha ao aprovar usuário.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (user: User) => {
    if (!window.confirm(`Tem certeza que deseja recusar a solicitação de ${user.username}?`)) {
      return;
    }
    setActionLoadingId(user.id);
    try {
      await api.post(`/api/admin/users/${user.id}/reject`);
      showFeedback('success', `Solicitação de ${user.username} foi recusada.`);
      await fetchUsers();
    } catch (err: any) {
      showFeedback('error', err.response?.data?.error || 'Falha ao recusar usuário.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (user: User) => {
    if (
      !window.confirm(
        `ATENÇÃO: Deseja excluir permanentemente o cadastro de "${user.username}"? Essa ação não pode ser desfeita.`
      )
    ) {
      return;
    }
    setActionLoadingId(user.id);
    try {
      await api.delete(`/api/admin/users/${user.id}`);
      showFeedback('success', `Usuário "${user.username}" foi removido do sistema.`);
      await fetchUsers();
    } catch (err: any) {
      showFeedback('error', err.response?.data?.error || 'Falha ao excluir usuário.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleRole = async (user: User) => {
    const newRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN';
    const confirmMsg =
      newRole === 'ADMIN'
        ? `Conceder privilégios de ADMINISTRADOR para "${user.username}"?`
        : `Remover privilégios de Administrador de "${user.username}"?`;

    if (!window.confirm(confirmMsg)) return;

    setActionLoadingId(user.id);
    try {
      await api.patch(`/api/admin/users/${user.id}/role`, { role: newRole });
      showFeedback('success', `Papel de ${user.username} atualizado para ${newRole}.`);
      await fetchUsers();
    } catch (err: any) {
      showFeedback('error', err.response?.data?.error || 'Falha ao atualizar papel.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesTab =
      activeTab === 'pending'
        ? u.approvalStatus === 'PENDING'
        : activeTab === 'approved'
        ? u.approvalStatus === 'APPROVED'
        : u.approvalStatus === 'REJECTED';

    if (!matchesTab) return false;

    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      u.username.toLowerCase().includes(term) ||
      (u.email && u.email.toLowerCase().includes(term))
    );
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none z-50">
      <div className="bg-obsidian-surface rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl border border-obsidian-border overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-obsidian-border bg-obsidian-card/40">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-md shadow-indigo-500/10">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-obsidian-text-primary tracking-tight flex items-center space-x-2">
                <span>Painel de Administração</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Moderação
                </span>
              </h2>
              <p className="text-xs text-obsidian-text-muted">
                Aprove novos usuários e controle o acesso geral ao Xolas
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-2 rounded-lg text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card transition-all"
              title="Recarregar lista"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`px-6 py-2.5 text-xs border-b transition-all flex items-center space-x-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Abas e Busca */}
        <div className="px-6 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-obsidian-border bg-obsidian-surface">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all ${
                activeTab === 'pending'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Pendentes</span>
              {counts.pending > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-pulse">
                  {counts.pending}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('approved')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all ${
                activeTab === 'approved'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Aprovados ({counts.approved})</span>
            </button>

            <button
              onClick={() => setActiveTab('rejected')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all ${
                activeTab === 'rejected'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card'
              }`}
            >
              <X className="w-3.5 h-3.5" />
              <span>Recusados ({counts.rejected})</span>
            </button>
          </div>

          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-obsidian-text-muted" />
            <input
              type="text"
              placeholder="Buscar por nickname..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-obsidian-card border border-obsidian-border rounded-lg text-xs text-obsidian-text-primary placeholder:text-obsidian-text-muted focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        {/* Lista de Usuários */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
          {loading && users.length === 0 ? (
            <div className="py-16 text-center text-obsidian-text-muted text-xs flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              <span>Carregando usuários...</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-16 text-center text-obsidian-text-muted text-xs flex flex-col items-center justify-center space-y-2">
              <ShieldCheck className="w-10 h-10 text-emerald-400/50 mb-1" />
              <span className="font-semibold text-obsidian-text-primary text-sm">
                {activeTab === 'pending'
                  ? 'Nenhuma solicitação pendente!'
                  : 'Nenhum usuário encontrado nesta aba.'}
              </span>
              <span>
                {activeTab === 'pending'
                  ? 'Todos os novos cadastros já foram avaliados.'
                  : 'Nenhum registro corresponde aos filtros.'}
              </span>
            </div>
          ) : (
            filteredUsers.map((u) => {
              const isActionLoading = actionLoadingId === u.id;

              return (
                <div
                  key={u.id}
                  className="bg-obsidian-card rounded-xl p-3.5 border border-obsidian-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-obsidian-border/80 transition-all"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <img
                      src={
                        u.avatarUrl ||
                        `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.username)}`
                      }
                      alt={u.username}
                      className="w-10 h-10 rounded-xl bg-obsidian-surface border border-obsidian-border shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-sm text-obsidian-text-primary truncate">
                          {u.username}
                        </span>
                        {u.role === 'ADMIN' && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            ADMIN
                          </span>
                        )}
                        {u.approvalStatus === 'PENDING' && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse">
                            Aguardando
                          </span>
                        )}
                        {u.approvalStatus === 'REJECTED' && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-gray-500/20 text-gray-400 border border-gray-500/30">
                            Recusado
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-obsidian-text-muted flex items-center space-x-2 truncate">
                        <span>{u.email}</span>
                        {u.createdAt && (
                          <>
                            <span>•</span>
                            <span>Cadastrado em {formatDate(u.createdAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Botões de Ação */}
                  <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                    {activeTab === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(u)}
                          disabled={isActionLoading}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-lg text-xs font-semibold shadow-md shadow-emerald-600/30 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Aprovar</span>
                        </button>

                        <button
                          onClick={() => handleReject(u)}
                          disabled={isActionLoading}
                          className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Recusar</span>
                        </button>
                      </>
                    )}

                    {activeTab === 'approved' && (
                      <>
                        <button
                          onClick={() => handleToggleRole(u)}
                          disabled={isActionLoading}
                          className="px-2.5 py-1.5 bg-obsidian-surface hover:bg-obsidian-surface/80 border border-obsidian-border text-obsidian-text-primary rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                          title={u.role === 'ADMIN' ? 'Remover Admin' : 'Tornar Admin'}
                        >
                          {u.role === 'ADMIN' ? 'Rebaixar para Membro' : 'Tornar Admin'}
                        </button>

                        <button
                          onClick={() => handleReject(u)}
                          disabled={isActionLoading}
                          className="p-1.5 text-amber-400 hover:bg-amber-500/10 rounded-lg border border-transparent hover:border-amber-500/30 transition-all disabled:opacity-50"
                          title="Revogar Acesso (Recusar)"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    )}

                    {activeTab === 'rejected' && (
                      <button
                        onClick={() => handleApprove(u)}
                        disabled={isActionLoading}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Reaprovar</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(u)}
                      disabled={isActionLoading}
                      className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg border border-transparent hover:border-rose-500/30 transition-all disabled:opacity-50"
                      title="Excluir Permanentemente"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
