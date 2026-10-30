import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { User, CustomRole } from '../../types';
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
  Award,
  UserCheck,
  PhoneOff,
  MicOff,
  Plus,
  Monitor,
  Edit2,
  Tag,
} from 'lucide-react';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPendingCountChange?: (count: number) => void;
}

const SYSTEM_PERMISSIONS = [
  {
    id: 'delete_messages',
    name: 'Excluir Mensagens do Chat',
    description: 'Permite apagar mensagens de qualquer usuário nas discussões.',
    icon: Trash2,
  },
  {
    id: 'disconnect_voice',
    name: 'Desconectar da Sala de Voz',
    description: 'Permite desconectar participantes de qualquer canal de áudio/vídeo.',
    icon: PhoneOff,
  },
  {
    id: 'server_mute',
    name: 'Silenciar no Servidor (Server Mute)',
    description: 'Permite mutar o microfone de participantes para toda a chamada.',
    icon: MicOff,
  },
  {
    id: 'manage_users',
    name: 'Gerenciar Cadastros & Aprovações',
    description: 'Permite acessar o painel de aprovação e liberar ou recusar membros.',
    icon: UserCheck,
  },
  {
    id: 'manage_channels',
    name: 'Criar & Gerenciar Canais',
    description: 'Permite criar novos canais de texto e de voz nos espaços.',
    icon: Plus,
  },
  {
    id: 'stream_screen',
    name: 'Transmitir Tela & Áudio',
    description: 'Permite compartilhar tela e transmitir áudio de jogos/janelas.',
    icon: Monitor,
  },
];

const COLOR_PRESETS = [
  { name: 'Índigo', value: '#6366f1' },
  { name: 'Púrpura', value: '#8b5cf6' },
  { name: 'Rosa', value: '#ec4899' },
  { name: 'Rubi', value: '#ef4444' },
  { name: 'Âmbar', value: '#f59e0b' },
  { name: 'Esmeralda', value: '#10b981' },
  { name: 'Ciano', value: '#06b6d4' },
  { name: 'Azul', value: '#3b82f6' },
];

export const AdminModal: React.FC<AdminModalProps> = ({
  isOpen,
  onClose,
  onPendingCountChange,
}) => {
  // Aba principal de nível superior: 'users' (Cadastros & Aprovações) ou 'roles' (Cargos & Permissões)
  const [mainTab, setMainTab] = useState<'users' | 'roles'>('users');

  // Sub-abas de aprovação de usuários
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Estado da aba de Cargos
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState('#6366f1');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [savingRole, setSavingRole] = useState(false);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

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
      showFeedback('error', err.response?.data?.error || 'Erro ao carregar lista de usuários.');
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const res = await api.get('/api/admin/roles');
      setRoles(res.data.roles || []);
    } catch (err) {
      console.warn('Erro ao carregar cargos:', err);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
      fetchRoles();
    }
  }, [isOpen, fetchUsers, fetchRoles]);

  if (!isOpen) return null;

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
      await fetchRoles();
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

  const handleAssignCustomRole = async (userId: string, customRoleId: string | null) => {
    try {
      await api.patch(`/api/admin/users/${userId}/custom-role`, { customRoleId });
      showFeedback('success', 'Cargo do usuário atualizado com sucesso!');
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                customRoleId,
                customRole: roles.find((r) => r.id === customRoleId) || null,
              }
            : u
        )
      );
      fetchRoles();
    } catch (err: any) {
      showFeedback('error', err.response?.data?.error || 'Falha ao atribuir cargo.');
    }
  };

  // Gerenciamento de Cargos
  const handleTogglePermission = (permId: string) => {
    setRolePermissions((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  };

  const handleResetRoleForm = () => {
    setEditingRoleId(null);
    setRoleName('');
    setRoleColor('#6366f1');
    setRolePermissions([]);
  };

  const handleEditRole = (role: CustomRole) => {
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setRoleColor(role.color || '#6366f1');
    setRolePermissions(role.permissions || []);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = roleName.trim();
    if (!cleanName) {
      showFeedback('error', 'Informe o nome do cargo.');
      return;
    }

    setSavingRole(true);
    try {
      if (editingRoleId) {
        await api.patch(`/api/admin/roles/${editingRoleId}`, {
          name: cleanName,
          color: roleColor,
          permissions: rolePermissions,
        });
        showFeedback('success', `Cargo "${cleanName}" atualizado com sucesso!`);
      } else {
        await api.post('/api/admin/roles', {
          name: cleanName,
          color: roleColor,
          permissions: rolePermissions,
        });
        showFeedback('success', `Cargo "${cleanName}" criado com sucesso!`);
      }
      handleResetRoleForm();
      await fetchRoles();
      await fetchUsers();
    } catch (err: any) {
      showFeedback('error', err.response?.data?.error || 'Falha ao salvar cargo.');
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role: CustomRole) => {
    if (
      !window.confirm(
        `Deseja realmente excluir o cargo "${role.name}"? Usuários com este cargo voltarão ao cargo padrão.`
      )
    ) {
      return;
    }

    try {
      await api.delete(`/api/admin/roles/${role.id}`);
      showFeedback('success', `Cargo "${role.name}" excluído.`);
      if (editingRoleId === role.id) {
        handleResetRoleForm();
      }
      await fetchRoles();
      await fetchUsers();
    } catch (err: any) {
      showFeedback('error', err.response?.data?.error || 'Falha ao excluir cargo.');
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
      <div className="bg-obsidian-surface rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl border border-obsidian-border overflow-hidden">
        {/* Cabeçalho com Abas Principais de Nível Superior */}
        <div className="flex flex-col border-b border-obsidian-border bg-obsidian-card/40">
          <div className="flex items-center justify-between px-6 pt-4 pb-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-md shadow-indigo-500/10">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-obsidian-text-primary tracking-tight flex items-center space-x-2">
                  <span>Painel de Administração</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Xolas Studio
                  </span>
                </h2>
                <p className="text-xs text-obsidian-text-muted">
                  Gerencie aprovações de novos membros e crie cargos com permissões modulares
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  fetchUsers();
                  fetchRoles();
                }}
                disabled={loading || rolesLoading}
                className="p-2 rounded-lg text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card transition-all"
                title="Recarregar dados"
              >
                <RefreshCw className={`w-4 h-4 ${loading || rolesLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Abas Principais: Cadastros vs Cargos */}
          <div className="flex items-center space-x-2 px-6 pt-1 pb-3">
            <button
              onClick={() => setMainTab('users')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all ${
                mainTab === 'users'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400/40'
                  : 'bg-obsidian-card/60 text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card border border-obsidian-border'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Cadastros & Aprovações</span>
              {counts.pending > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-extrabold animate-pulse">
                  {counts.pending}
                </span>
              )}
            </button>

            <button
              onClick={() => setMainTab('roles')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all ${
                mainTab === 'roles'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400/40'
                  : 'bg-obsidian-card/60 text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card border border-obsidian-border'
              }`}
            >
              <Award className="w-4 h-4" />
              <span>Cargos & Permissões</span>
              {roles.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/30 text-indigo-300 text-[10px] font-mono font-bold">
                  {roles.length}
                </span>
              )}
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

        {/* CONTEÚDO DA ABA 1: CADASTROS & APROVAÇÕES */}
        {mainTab === 'users' && (
          <>
            {/* Barra de Filtros e Busca */}
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
                          className="w-10 h-10 rounded-xl bg-obsidian-surface border border-obsidian-border shrink-0 object-cover"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            <span className="font-semibold text-sm text-obsidian-text-primary truncate">
                              {u.username}
                            </span>
                            {u.role === 'ADMIN' && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                ADMIN
                              </span>
                            )}
                            {u.customRole && (
                              <span
                                style={{
                                  backgroundColor: `${u.customRole.color}25`,
                                  color: u.customRole.color,
                                  borderColor: `${u.customRole.color}50`,
                                }}
                                className="px-1.5 py-0.2 rounded text-[10px] font-bold border truncate"
                              >
                                {u.customRole.name}
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
                          <div className="text-[11px] text-obsidian-text-muted flex items-center space-x-2 truncate mt-0.5">
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

                      {/* Botões de Ação & Seletor de Cargo */}
                      <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                        {activeTab === 'approved' && (
                          <div className="flex items-center space-x-1.5 mr-1">
                            <Tag className="w-3.5 h-3.5 text-obsidian-text-muted" />
                            <select
                              value={u.customRoleId || ''}
                              onChange={(e) => handleAssignCustomRole(u.id, e.target.value || null)}
                              className="bg-obsidian-surface border border-obsidian-border rounded-lg px-2 py-1 text-xs text-obsidian-text-secondary hover:text-white focus:outline-none focus:border-indigo-500 cursor-pointer transition-colors max-w-[140px] truncate"
                              title="Definir cargo do usuário"
                            >
                              <option value="">Sem cargo (Padrão)</option>
                              {roles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

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
                              {u.role === 'ADMIN' ? 'Rebaixar' : 'Admin'}
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
          </>
        )}

        {/* CONTEÚDO DA ABA 2: CARGOS & PERMISSÕES */}
        {mainTab === 'roles' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {/* Formulário de Criação / Edição de Cargo */}
            <form
              onSubmit={handleSaveRole}
              className="bg-obsidian-card rounded-2xl p-5 border border-obsidian-border shadow-lg space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-obsidian-border/70">
                <div className="flex items-center space-x-2">
                  <Award className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-bold text-obsidian-text-primary">
                    {editingRoleId ? 'Editar Cargo' : 'Criar Novo Cargo'}
                  </h3>
                </div>

                {editingRoleId && (
                  <button
                    type="button"
                    onClick={handleResetRoleForm}
                    className="text-xs text-obsidian-text-muted hover:text-white transition-colors"
                  >
                    Cancelar Edição
                  </button>
                )}
              </div>

              {/* Linha 1: Nome do Cargo e Seletor de Cor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
                    Nome do Cargo
                  </label>
                  <input
                    type="text"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    placeholder="Ex: Moderador, Staff, VIP, Co-Dono..."
                    maxLength={32}
                    required
                    className="w-full bg-obsidian-surface border border-obsidian-border rounded-xl px-3 py-2 text-xs text-obsidian-text-primary placeholder:text-obsidian-text-muted focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
                    Cor da Insígnia (Badge)
                  </label>
                  <div className="flex items-center space-x-2 pt-0.5">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setRoleColor(c.value)}
                        style={{ backgroundColor: c.value }}
                        className={`w-6 h-6 rounded-full transition-transform ${
                          roleColor === c.value
                            ? 'scale-125 ring-2 ring-white shadow-md'
                            : 'hover:scale-110 opacity-80 hover:opacity-100'
                        }`}
                        title={c.name}
                      />
                    ))}
                    <div
                      style={{
                        backgroundColor: `${roleColor}25`,
                        color: roleColor,
                        borderColor: `${roleColor}60`,
                      }}
                      className="ml-2 px-2.5 py-1 rounded-lg text-xs font-bold border truncate"
                    >
                      {roleName.trim() || 'Pré-visualização'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Linha 2: Caixas para Marcar (Checkboxes de Funções) */}
              <div>
                <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-2">
                  Funções & Permissões Autorizadas
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {SYSTEM_PERMISSIONS.map((perm) => {
                    const isChecked = rolePermissions.includes(perm.id);
                    const Icon = perm.icon;

                    return (
                      <label
                        key={perm.id}
                        onClick={() => handleTogglePermission(perm.id)}
                        className={`p-3 rounded-xl border flex items-start space-x-3 cursor-pointer transition-all ${
                          isChecked
                            ? 'bg-indigo-600/15 border-indigo-500/50 text-white shadow-sm'
                            : 'bg-obsidian-surface hover:bg-obsidian-surface/80 border-obsidian-border text-obsidian-text-muted hover:text-obsidian-text-secondary'
                        }`}
                      >
                        {/* Checkbox estilizado */}
                        <div
                          className={`w-4 h-4 rounded-md border mt-0.5 shrink-0 flex items-center justify-center transition-colors ${
                            isChecked
                              ? 'bg-indigo-600 border-indigo-400'
                              : 'border-white/30 bg-obsidian-card'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3 text-white" />}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold flex items-center space-x-1.5 text-obsidian-text-primary">
                            <Icon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <span>{perm.name}</span>
                          </div>
                          <p className="text-[11px] text-obsidian-text-muted leading-tight mt-0.5">
                            {perm.description}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingRole}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{editingRoleId ? 'Salvar Alterações' : 'Criar Cargo'}</span>
                </button>
              </div>
            </form>

            {/* Lista de Cargos Criados */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs px-1">
                <span className="font-bold text-obsidian-text-muted uppercase tracking-wider text-[10px]">
                  Cargos Existentes ({roles.length})
                </span>
                <span className="text-obsidian-text-muted text-[11px]">
                  Atribua aos usuários na aba "Cadastros & Aprovações"
                </span>
              </div>

              {rolesLoading && roles.length === 0 ? (
                <div className="py-8 text-center text-obsidian-text-muted text-xs">
                  Carregando cargos...
                </div>
              ) : roles.length === 0 ? (
                <div className="p-8 text-center bg-obsidian-card rounded-2xl border border-obsidian-border text-obsidian-text-muted text-xs">
                  Nenhum cargo customizado criado ainda. Crie seu primeiro cargo no formulário acima!
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {roles.map((r) => (
                    <div
                      key={r.id}
                      className="bg-obsidian-card rounded-2xl p-4 border border-obsidian-border flex flex-col justify-between space-y-3 hover:border-obsidian-border/80 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span
                            style={{
                              backgroundColor: `${r.color}25`,
                              color: r.color,
                              borderColor: `${r.color}60`,
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold border"
                          >
                            {r.name}
                          </span>
                          <span className="text-[11px] text-obsidian-text-muted font-mono">
                            {r.userCount || 0} {r.userCount === 1 ? 'membro' : 'membros'}
                          </span>
                        </div>

                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            onClick={() => handleEditRole(r)}
                            className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-white hover:bg-white/10 transition-colors"
                            title="Editar Cargo"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRole(r)}
                            className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Excluir Cargo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Lista resumida de permissões ativas */}
                      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-obsidian-border/60">
                        {r.permissions && r.permissions.length > 0 ? (
                          r.permissions.map((pId) => {
                            const pObj = SYSTEM_PERMISSIONS.find((sp) => sp.id === pId);
                            return (
                              <span
                                key={pId}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-obsidian-surface text-obsidian-text-secondary border border-obsidian-border"
                              >
                                {pObj?.name || pId}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-[10px] text-obsidian-text-muted italic">
                            Nenhuma permissão especial marcada
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};