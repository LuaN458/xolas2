import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../../lib/api';
import { User, CustomRole, VercelMetricsData } from '../../types';
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
  Server,
  Cloud,
  Globe,
  Gauge,
  ExternalLink,
  Zap,
  KeyRound,
  AlertTriangle,
  Radio,
  Layers,
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
  // Aba principal de nível superior: 'users' (Cadastros & Aprovações), 'roles' (Cargos & Permissões) ou 'vercel' (Servidor Vercel & Métricas)
  const [mainTab, setMainTab] = useState<'users' | 'roles' | 'vercel'>('users');

  // Estados da aba Vercel
  const [vercelMetrics, setVercelMetrics] = useState<VercelMetricsData | null>(null);
  const [vercelLoading, setVercelLoading] = useState(false);
  const [vercelRefreshing, setVercelRefreshing] = useState(false);
  const [vercelStatus, setVercelStatus] = useState<{
    hasToken: boolean;
    projectId: string | null;
    teamId: string | null;
    maskedToken: string | null;
  } | null>(null);
  const [showVercelConfig, setShowVercelConfig] = useState(false);
  const [vercelTokenInput, setVercelTokenInput] = useState('');
  const [vercelProjectIdInput, setVercelProjectIdInput] = useState('');
  const [vercelTeamIdInput, setVercelTeamIdInput] = useState('');
  const [vercelTesting, setVercelTesting] = useState(false);
  const [vercelSaving, setVercelSaving] = useState(false);

  // Sub-abas de aprovação de usuários
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estado da aba de Cargos
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState('#6366f1');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [savingRole, setSavingRole] = useState(false);

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    setFeedback({ type, message });
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

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
  }, [onPendingCountChange, showFeedback]);

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

  const fetchVercelStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/vercel/status');
      if (res.data?.config) {
        setVercelStatus(res.data.config);
        if (res.data.config.projectId) {
          setVercelProjectIdInput(res.data.config.projectId);
        }
        if (res.data.config.teamId) {
          setVercelTeamIdInput(res.data.config.teamId);
        }
      }
    } catch {}
  }, []);

  const fetchVercelMetrics = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setVercelRefreshing(true);
    else setVercelLoading(true);
    try {
      const res = await api.get('/api/admin/vercel/metrics', {
        params: { refresh: forceRefresh ? 'true' : undefined },
      });
      if (res.data?.metrics) {
        setVercelMetrics(res.data.metrics);
      }
    } catch (err: any) {
      showFeedback('error', 'Falha ao buscar métricas da Vercel: ' + (err.response?.data?.error || err.message));
    } finally {
      setVercelLoading(false);
      setVercelRefreshing(false);
    }
  }, [showFeedback]);

  const handleTestVercel = async () => {
    setVercelTesting(true);
    try {
      const res = await api.post('/api/admin/vercel/test', {
        token: vercelTokenInput.trim() || undefined,
        projectId: vercelProjectIdInput.trim() || undefined,
        teamId: vercelTeamIdInput.trim() || undefined,
      });
      if (res.data?.success) {
        showFeedback('success', res.data.message || 'Conexão com a Vercel bem-sucedida!');
      } else {
        showFeedback('error', res.data?.message || 'Falha ao conectar com a Vercel.');
      }
    } catch (err: any) {
      showFeedback('error', err.response?.data?.message || 'Erro ao testar conexão.');
    } finally {
      setVercelTesting(false);
    }
  };

  const handleSaveVercelConfig = async () => {
    setVercelSaving(true);
    try {
      const res = await api.post('/api/admin/vercel/config', {
        token: vercelTokenInput.trim() || undefined,
        projectId: vercelProjectIdInput.trim() || undefined,
        teamId: vercelTeamIdInput.trim() || undefined,
      });
      if (res.data?.success) {
        showFeedback('success', 'Configurações da Vercel salvas com sucesso!');
        setShowVercelConfig(false);
        setVercelTokenInput('');
        fetchVercelStatus();
        fetchVercelMetrics(true);
      }
    } catch (err: any) {
      showFeedback('error', err.response?.data?.error || 'Erro ao salvar configurações.');
    } finally {
      setVercelSaving(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
      fetchRoles();
      if (mainTab === 'vercel') {
        fetchVercelStatus();
        fetchVercelMetrics();
      }
    }
  }, [isOpen, mainTab, fetchUsers, fetchRoles, fetchVercelStatus, fetchVercelMetrics]);

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
                  if (mainTab === 'vercel') {
                    fetchVercelMetrics(true);
                    fetchVercelStatus();
                  } else {
                    fetchUsers();
                    fetchRoles();
                  }
                }}
                disabled={loading || rolesLoading || vercelRefreshing || vercelLoading}
                className="p-2 rounded-lg text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card transition-all"
                title="Recarregar dados"
              >
                <RefreshCw className={`w-4 h-4 ${loading || rolesLoading || vercelRefreshing || vercelLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Abas Principais: Cadastros vs Cargos vs Servidor Vercel */}
          <div className="flex items-center space-x-2 px-6 pt-1 pb-3 overflow-x-auto">
            <button
              onClick={() => setMainTab('users')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all shrink-0 ${
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
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all shrink-0 ${
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

            <button
              onClick={() => setMainTab('vercel')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all shrink-0 ${
                mainTab === 'vercel'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400/40'
                  : 'bg-obsidian-card/60 text-obsidian-text-muted hover:text-obsidian-text-primary hover:bg-obsidian-card border border-obsidian-border'
              }`}
            >
              <Server className="w-4 h-4 text-cyan-400" />
              <span>Servidor Vercel & Métricas</span>
              {vercelMetrics?.configured && (
                <span
                  className={`w-2 h-2 rounded-full ${
                    vercelMetrics.metrics.status === 'healthy'
                      ? 'bg-emerald-400 ring-2 ring-emerald-400/30'
                      : vercelMetrics.metrics.status === 'degraded'
                      ? 'bg-amber-400 ring-2 ring-amber-400/30'
                      : 'bg-rose-400 ring-2 ring-rose-400/30'
                  }`}
                  title={`Status Vercel: ${vercelMetrics.metrics.status}`}
                />
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

        {/* CONTEÚDO DA ABA 3: SERVIDOR VERCEL & MÉTRICAS */}
        {mainTab === 'vercel' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Barra de Status e Ações do Servidor Vercel */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-obsidian-card border border-obsidian-border shadow-lg">
              <div className="flex items-center space-x-3.5">
                <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-500/20 to-cyan-500/10 border border-indigo-500/30 text-indigo-400 shadow-inner">
                  <Server className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      {vercelMetrics?.projectName ? `Projeto: ${vercelMetrics.projectName}` : 'Infraestrutura Vercel'}
                    </h3>
                    {vercelMetrics?.configured ? (
                      <span
                        className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          vercelMetrics.metrics.status === 'healthy'
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                            : vercelMetrics.metrics.status === 'degraded'
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                            : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            vercelMetrics.metrics.status === 'healthy'
                              ? 'bg-emerald-400 animate-pulse'
                              : vercelMetrics.metrics.status === 'degraded'
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                          }`}
                        />
                        <span>
                          {vercelMetrics.metrics.status === 'healthy'
                            ? 'Operacional'
                            : vercelMetrics.metrics.status === 'degraded'
                            ? 'Degradado'
                            : 'Falha'}
                        </span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        Não Configurado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-obsidian-text-muted mt-0.5">
                    {vercelMetrics?.framework
                      ? `Framework: ${vercelMetrics.framework.toUpperCase()} • Edge Network • Latência: ${vercelMetrics.latencyMs || 0}ms`
                      : 'Hospedagem Fullstack e Métricas de Servidor'}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowVercelConfig((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all border ${
                    showVercelConfig
                      ? 'bg-indigo-600 text-white border-indigo-400/50 shadow-md shadow-indigo-600/30'
                      : 'bg-obsidian-surface text-obsidian-text-secondary hover:text-white hover:bg-obsidian-card border-obsidian-border'
                  }`}
                  title="Configurar credenciais da Vercel"
                >
                  <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{showVercelConfig ? 'Ocultar Chaves' : 'Credenciais'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    fetchVercelMetrics(true);
                    fetchVercelStatus();
                  }}
                  disabled={vercelRefreshing || vercelLoading}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-obsidian-surface hover:bg-obsidian-card text-obsidian-text-secondary hover:text-white border border-obsidian-border transition-all flex items-center space-x-1.5 shadow-sm"
                  title="Atualizar métricas em tempo real"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${vercelRefreshing ? 'animate-spin' : ''}`} />
                  <span>Atualizar</span>
                </button>
              </div>
            </div>

            {/* Painel Expansível de Configuração das Chaves Vercel */}
            {(showVercelConfig || !vercelMetrics?.configured) && (
              <div className="p-5 rounded-2xl bg-obsidian-card/80 border border-indigo-500/30 shadow-xl space-y-4 animate-in fade-in duration-200">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
                      <KeyRound className="w-4 h-4 text-indigo-400" />
                      <span>Configuração da Integração Vercel</span>
                    </h4>
                    <p className="text-[11px] text-obsidian-text-muted mt-1 leading-relaxed">
                      Insira o seu <strong>Personal Access Token</strong> da Vercel e o <strong>Project ID</strong> para sincronizar métricas de deploy, erros e requisições. As chaves são armazenadas com segurança no servidor.
                    </p>
                  </div>
                  {vercelStatus?.maskedToken && (
                    <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30">
                      Token Ativo: {vercelStatus.maskedToken}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-obsidian-text-secondary">
                      Vercel API Token (Bearer)
                    </label>
                    <input
                      type="password"
                      placeholder={vercelStatus?.hasToken ? '••••••••••••••••••••••••' : 'Cole seu Token da Vercel'}
                      value={vercelTokenInput}
                      onChange={(e) => setVercelTokenInput(e.target.value)}
                      className="w-full px-3 py-2 bg-obsidian-surface border border-obsidian-border rounded-xl text-xs text-white placeholder-obsidian-text-muted focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-obsidian-text-secondary">
                      Project ID (ex: prj_...)
                    </label>
                    <input
                      type="text"
                      placeholder="prj_..."
                      value={vercelProjectIdInput}
                      onChange={(e) => setVercelProjectIdInput(e.target.value)}
                      className="w-full px-3 py-2 bg-obsidian-surface border border-obsidian-border rounded-xl text-xs text-white placeholder-obsidian-text-muted focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2 md:col-span-1">
                    <label className="text-[11px] font-semibold text-obsidian-text-secondary">
                      Team ID (Opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="team_... (opcional)"
                      value={vercelTeamIdInput}
                      onChange={(e) => setVercelTeamIdInput(e.target.value)}
                      className="w-full px-3 py-2 bg-obsidian-surface border border-obsidian-border rounded-xl text-xs text-white placeholder-obsidian-text-muted focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-obsidian-border/50">
                  <span className="text-[10px] text-obsidian-text-muted">
                    Obtenha seu token em{' '}
                    <a
                      href="https://vercel.com/account/tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:underline inline-flex items-center space-x-1"
                    >
                      <span>vercel.com/account/tokens</span>
                      <ExternalLink className="w-2.5 h-2.5 inline" />
                    </a>
                  </span>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleTestVercel}
                      disabled={vercelTesting}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-obsidian-surface hover:bg-obsidian-border/40 text-obsidian-text-primary border border-obsidian-border transition-all flex items-center space-x-1.5"
                    >
                      {vercelTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      <span>Testar Conexão</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveVercelConfig}
                      disabled={vercelSaving}
                      className="px-4 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all flex items-center space-x-1.5"
                    >
                      {vercelSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      <span>Salvar Credenciais</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Aviso Informativo de Compatibilidade WebSocket Fullstack */}
            <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-500/25 flex items-start space-x-3.5 backdrop-blur-sm">
              <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0 mt-0.5">
                <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-white flex items-center space-x-2">
                  <span>Arquitetura Híbrida Fullstack: Vercel + WebSocket</span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    Dual Host
                  </span>
                </h4>
                <p className="text-[11px] text-obsidian-text-secondary leading-relaxed">
                  As rotas HTTP da API e o frontend SPA são executados na Vercel com CDN global de alta performance. As conexões persistentes de tempo real (Socket.IO, chat e canais de voz WebRTC) operam com segurança através do host WebSocket dedicado (<strong>{vercelMetrics?.websocketCompatibilityNotice?.recommendedSocketHost || 'xolas-server.onrender.com'}</strong>).
                </p>
              </div>
            </div>

            {/* Loading Skeleton */}
            {vercelLoading && !vercelMetrics && (
              <div className="space-y-4 animate-pulse">
                <div className="h-28 bg-obsidian-card rounded-2xl border border-obsidian-border" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="h-24 bg-obsidian-card rounded-2xl border border-obsidian-border" />
                  <div className="h-24 bg-obsidian-card rounded-2xl border border-obsidian-border" />
                  <div className="h-24 bg-obsidian-card rounded-2xl border border-obsidian-border" />
                  <div className="h-24 bg-obsidian-card rounded-2xl border border-obsidian-border" />
                </div>
              </div>
            )}

            {/* CONTEÚDO PRINCIPAL DE MÉTRICAS (QUANDO CARREGADO) */}
            {vercelMetrics && (
              <>
                {/* Card de Deploy em Produção */}
                <div className="p-5 rounded-2xl bg-obsidian-card border border-obsidian-border shadow-lg space-y-4">
                  <div className="flex items-center justify-between border-b border-obsidian-border/50 pb-3">
                    <div className="flex items-center space-x-2.5">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Deploy Ativo em Produção
                      </h4>
                    </div>

                    {vercelMetrics.productionDeployment?.url && (
                      <a
                        href={vercelMetrics.productionDeployment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 font-mono font-semibold transition-colors"
                      >
                        <span>{vercelMetrics.productionDeployment.url.replace(/^https?:\/\//, '')}</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>

                  {vercelMetrics.productionDeployment ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="p-3 bg-obsidian-surface rounded-xl border border-obsidian-border/60">
                        <span className="text-[10px] font-semibold text-obsidian-text-muted uppercase">Status</span>
                        <div className="flex items-center space-x-1.5 mt-1">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              vercelMetrics.productionDeployment.state === 'READY'
                                ? 'bg-emerald-400'
                                : vercelMetrics.productionDeployment.state === 'BUILDING'
                                ? 'bg-amber-400 animate-pulse'
                                : 'bg-rose-400'
                            }`}
                          />
                          <span className="text-xs font-bold text-white font-mono">
                            {vercelMetrics.productionDeployment.state}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 bg-obsidian-surface rounded-xl border border-obsidian-border/60">
                        <span className="text-[10px] font-semibold text-obsidian-text-muted uppercase">Branch / Ref</span>
                        <p className="text-xs font-bold text-white font-mono mt-1 truncate">
                          {vercelMetrics.productionDeployment.branch || 'main'}
                          {vercelMetrics.productionDeployment.commitSha && ` (${vercelMetrics.productionDeployment.commitSha})`}
                        </p>
                      </div>

                      <div className="p-3 bg-obsidian-surface rounded-xl border border-obsidian-border/60">
                        <span className="text-[10px] font-semibold text-obsidian-text-muted uppercase">Tempo de Build</span>
                        <p className="text-xs font-bold text-white font-mono mt-1">
                          {vercelMetrics.productionDeployment.buildDurationSeconds !== undefined
                            ? `${vercelMetrics.productionDeployment.buildDurationSeconds}s`
                            : 'Instantâneo'}
                        </p>
                      </div>

                      <div className="p-3 bg-obsidian-surface rounded-xl border border-obsidian-border/60">
                        <span className="text-[10px] font-semibold text-obsidian-text-muted uppercase">Data do Deploy</span>
                        <p className="text-xs font-bold text-white font-mono mt-1 truncate">
                          {new Date(vercelMetrics.productionDeployment.createdAt).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-obsidian-text-muted italic">
                      Nenhum deploy ativo registrado no momento para este projeto.
                    </p>
                  )}

                  {vercelMetrics.productionDeployment?.commitMessage && (
                    <div className="p-2.5 bg-obsidian-surface/60 rounded-xl border border-obsidian-border/40 text-[11px] text-obsidian-text-secondary font-mono truncate">
                      Commit: <span className="text-white">{vercelMetrics.productionDeployment.commitMessage}</span>
                    </div>
                  )}
                </div>

                {/* Grid das 4 Métricas Principais da Vercel */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Métrica 1: Requisições & Invocações */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-obsidian-card to-obsidian-surface border border-obsidian-border shadow-md space-y-2">
                    <div className="flex items-center justify-between text-cyan-400">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-obsidian-text-muted">
                        Requisições
                      </span>
                      <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                        <Zap className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="text-xl font-extrabold text-white font-mono">
                      {vercelMetrics.metrics.totalRequestsEstimate.toLocaleString('pt-BR')}
                    </div>
                    <p className="text-[10px] text-obsidian-text-muted">
                      Invocações Edge & Serverless
                    </p>
                  </div>

                  {/* Métrica 2: Latência Média */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-obsidian-card to-obsidian-surface border border-obsidian-border shadow-md space-y-2">
                    <div className="flex items-center justify-between text-emerald-400">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-obsidian-text-muted">
                        Latência Média
                      </span>
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <Gauge className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="text-xl font-extrabold text-white font-mono">
                      {vercelMetrics.metrics.latencyMs} <span className="text-xs font-normal text-obsidian-text-muted">ms</span>
                    </div>
                    <p className="text-[10px] text-emerald-400 font-medium">
                      Ultra-baixa latência Edge
                    </p>
                  </div>

                  {/* Métrica 3: Taxa de Erros 4xx/5xx */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-obsidian-card to-obsidian-surface border border-obsidian-border shadow-md space-y-2">
                    <div className="flex items-center justify-between text-indigo-400">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-obsidian-text-muted">
                        Taxa de Erros
                      </span>
                      <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="text-xl font-extrabold text-white font-mono">
                      {vercelMetrics.metrics.errorRatePercent.toFixed(2)}%
                    </div>
                    <p className="text-[10px] text-emerald-400 font-medium">
                      Integridade 99.9%
                    </p>
                  </div>

                  {/* Métrica 4: Bandwidth / Transferência */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-obsidian-card to-obsidian-surface border border-obsidian-border shadow-md space-y-2">
                    <div className="flex items-center justify-between text-purple-400">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-obsidian-text-muted">
                        Largura de Banda
                      </span>
                      <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                        <Globe className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="text-xl font-extrabold text-white font-mono">
                      {(vercelMetrics.metrics.bandwidthBytesEstimate / (1024 * 1024)).toFixed(1)}{' '}
                      <span className="text-xs font-normal text-obsidian-text-muted">MB</span>
                    </div>
                    <p className="text-[10px] text-obsidian-text-muted">
                      Tráfego Outbound CDN
                    </p>
                  </div>
                </div>

                {/* Domínios e Infraestrutura */}
                {vercelMetrics.domains && vercelMetrics.domains.length > 0 && (
                  <div className="p-5 rounded-2xl bg-obsidian-card border border-obsidian-border shadow-lg space-y-3">
                    <div className="flex items-center space-x-2">
                      <Globe className="w-4 h-4 text-cyan-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Domínios Registrados & Certificados SSL
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {vercelMetrics.domains.map((dom) => (
                        <div
                          key={dom.name}
                          className="p-3 bg-obsidian-surface rounded-xl border border-obsidian-border flex items-center justify-between"
                        >
                          <div className="truncate pr-2">
                            <span className="text-xs font-mono font-bold text-white truncate block">
                              {dom.name}
                            </span>
                            <span className="text-[10px] text-obsidian-text-muted">
                              SSL Ativo • Vercel Edge
                            </span>
                          </div>
                          <span className="p-1 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Histórico dos Últimos Deploys */}
                {vercelMetrics.recentDeployments && vercelMetrics.recentDeployments.length > 0 && (
                  <div className="p-5 rounded-2xl bg-obsidian-card border border-obsidian-border shadow-lg space-y-3">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-indigo-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Deploys Recentes
                      </h4>
                    </div>

                    <div className="divide-y divide-obsidian-border/60">
                      {vercelMetrics.recentDeployments.map((dep) => (
                        <div
                          key={dep.id}
                          className="py-2.5 flex items-center justify-between text-xs transition-colors hover:bg-obsidian-surface/40 px-2 rounded-lg"
                        >
                          <div className="flex items-center space-x-3 truncate pr-3">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                dep.state === 'READY'
                                  ? 'bg-emerald-400'
                                  : dep.state === 'BUILDING'
                                  ? 'bg-amber-400 animate-pulse'
                                  : 'bg-rose-400'
                              }`}
                            />
                            <div className="truncate">
                              <span className="font-semibold text-white truncate block">
                                {dep.commitMessage}
                              </span>
                              <span className="text-[10px] text-obsidian-text-muted font-mono">
                                por {dep.creator} • {new Date(dep.createdAt).toLocaleString('pt-BR')}
                              </span>
                            </div>
                          </div>

                          {dep.url && (
                            <a
                              href={dep.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-mono flex items-center space-x-1 shrink-0"
                            >
                              <span>Visualizar</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};