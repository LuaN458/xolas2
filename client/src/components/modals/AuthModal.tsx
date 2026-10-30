import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getLastUsername, loadStoredAuthNative } from '../../lib/authStorage';
import { Command, RefreshCw, Clock, ArrowLeft, ShieldAlert, CheckCircle2 } from 'lucide-react';

export const AuthModal: React.FC = () => {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState(() => getLastUsername());
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('1.0.3');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);

  // Estado para tela de espera de aprovação
  const [pendingUser, setPendingUser] = useState<{ username: string; password?: string } | null>(null);
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then((v) => {
        if (v) setAppVersion(v);
      });
    }
    loadStoredAuthNative().then((stored) => {
      if (stored.lastUsername) {
        setUsername((prev) => prev || stored.lastUsername);
      }
    });
  }, []);

  const handleManualCheckUpdate = async () => {
    if (!window.electronAPI?.checkForUpdates) return;
    setIsCheckingUpdate(true);
    setUpdateStatusText('Buscando atualizações...');
    try {
      const res = await window.electronAPI.checkForUpdates();
      if (res?.status === 'success') {
        setUpdateStatusText('Verificação concluída!');
      } else {
        setUpdateStatusText('Você está na versão mais recente!');
      }
    } catch {
      setUpdateStatusText('Falha ao verificar.');
    } finally {
      setIsCheckingUpdate(false);
      setTimeout(() => setUpdateStatusText(null), 4000);
    }
  };

  const handleCheckApprovalStatus = async () => {
    if (!pendingUser || !pendingUser.password) return;
    setIsCheckingApproval(true);
    setApprovalMessage(null);
    try {
      const res = await login(pendingUser.username, pendingUser.password);
      if (res.status === 'APPROVED') {
        setPendingUser(null);
      } else {
        setApprovalMessage('Seu cadastro ainda está na fila de aprovação da moderação.');
      }
    } catch (err: any) {
      const errCode = err.response?.data?.error;
      if (errCode === 'PENDING_APPROVAL') {
        setApprovalMessage('Seu cadastro ainda está na fila de aprovação da moderação.');
      } else if (errCode === 'REJECTED') {
        setError('Sua solicitação de cadastro foi recusada pela administração.');
        setPendingUser(null);
      } else {
        setApprovalMessage('Não foi possível verificar no momento. Tente novamente em instantes.');
      }
    } finally {
      setIsCheckingApproval(false);
    }
  };

  // Checar aprovação automaticamente a cada 5 segundos se estiver na tela de espera
  useEffect(() => {
    if (!pendingUser || !pendingUser.password) return;
    const interval = setInterval(() => {
      handleCheckApprovalStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [pendingUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setError('Por favor, informe seu nickname e senha.');
      setLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const res = await login(cleanUser, password);
        if (res.status === 'PENDING') {
          setPendingUser({ username: cleanUser, password });
        }
      } else {
        const res = await register(cleanUser, password);
        if (res.status === 'PENDING') {
          setPendingUser({ username: cleanUser, password });
        }
      }
    } catch (err: any) {
      const errData = err.response?.data;
      if (errData?.error === 'PENDING_APPROVAL') {
        setPendingUser({ username: cleanUser, password });
      } else if (errData?.error === 'REJECTED') {
        setError('Sua solicitação de cadastro foi recusada pela administração.');
      } else if (!err.response) {
        setError('Não foi possível conectar ao servidor da Xolas. Verifique sua conexão ou tente novamente em instantes.');
      } else {
        setError(
          errData?.error ||
            (isLogin ? 'Nickname ou senha incorretos.' : 'Falha ao cadastrar nickname.')
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // Tela de Aguardando Aprovação
  if (pendingUser) {
    return (
      <div className="fixed inset-0 bg-obsidian-bg flex items-center justify-center p-4 select-none z-50">
        <div className="bg-obsidian-surface rounded-2xl w-full max-w-sm p-7 shadow-2xl border border-obsidian-border text-center">
          <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-amber-400 shadow-lg shadow-amber-500/10 animate-pulse">
            <Clock className="w-6 h-6" />
          </div>

          <h2 className="text-lg font-bold text-obsidian-text-primary tracking-tight mb-1">
            Cadastro em Análise
          </h2>
          <p className="text-obsidian-text-muted text-xs mb-5">
            O nickname <strong className="text-obsidian-text-primary">"{pendingUser.username}"</strong> foi criado e está na fila de moderação.
          </p>

          <div className="bg-obsidian-card rounded-xl p-3.5 border border-obsidian-border text-left mb-5 space-y-2">
            <div className="flex items-center space-x-2 text-xs text-amber-300 font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>Aguardando liberação de um Administrador</span>
            </div>
            <p className="text-[11px] text-obsidian-text-secondary leading-relaxed">
              Para evitar lotação indesejada e preservar a qualidade dos canais, o acesso é liberado por um administrador. Assim que sua conta for aprovada, a entrada ocorrerá automaticamente.
            </p>
          </div>

          {approvalMessage && (
            <div className="mb-4 p-2.5 bg-obsidian-card border border-obsidian-border text-obsidian-text-secondary rounded-lg text-xs">
              {approvalMessage}
            </div>
          )}

          <div className="space-y-2">
            <button
              onClick={handleCheckApprovalStatus}
              disabled={isCheckingApproval}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center space-x-2 border border-indigo-400/40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingApproval ? 'animate-spin' : ''}`} />
              <span>{isCheckingApproval ? 'Verificando...' : 'Verificar Aprovação Agora'}</span>
            </button>

            <button
              onClick={() => {
                setPendingUser(null);
                setError(null);
              }}
              className="w-full py-2 bg-obsidian-card hover:bg-obsidian-card/80 text-obsidian-text-muted hover:text-obsidian-text-primary rounded-xl text-xs font-semibold transition-all border border-obsidian-border flex items-center justify-center space-x-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar para Login</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-obsidian-bg flex items-center justify-center p-4 select-none z-50">
      <div className="bg-obsidian-surface rounded-2xl w-full max-w-sm p-7 shadow-2xl border border-obsidian-border">
        <div className="text-center mb-6">
          <div className="w-10 h-10 bg-obsidian-card border border-obsidian-border rounded-xl flex items-center justify-center mx-auto mb-3 text-obsidian-accent shadow-md shadow-indigo-500/10">
            <Command className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-bold text-obsidian-text-primary tracking-tight mb-1">
            {isLogin ? 'Conectar ao Xolas' : 'Criar Nova Conta no Xolas'}
          </h2>
          <p className="text-obsidian-text-muted text-xs">
            {isLogin
              ? 'Insira suas credenciais para acessar seus espaços.'
              : 'Comece a se comunicar com voz e vídeo em alta fidelidade.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-2.5 bg-obsidian-rose/10 border border-obsidian-rose/30 text-obsidian-rose rounded-lg text-xs flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
              Nickname
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Digite seu nickname"
              required
              autoFocus
              className="w-full bg-obsidian-card border border-obsidian-border rounded-xl p-2.5 text-obsidian-text-primary text-xs outline-none focus:border-obsidian-accent/60 placeholder-obsidian-text-muted"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite sua senha"
              required
              className="w-full bg-obsidian-card border border-obsidian-border rounded-xl p-2.5 text-obsidian-text-primary text-xs outline-none focus:border-obsidian-accent/60 placeholder-obsidian-text-muted"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition-all shadow-lg shadow-indigo-600/30 border border-indigo-400/40"
          >
            {loading ? 'Processando...' : isLogin ? 'Entrar' : 'Cadastrar Nickname'}
          </button>
        </form>

        <div className="mt-4 text-center text-xs text-obsidian-text-muted">
          {isLogin ? 'Não tem um nickname? ' : 'Já tem cadastro? '}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
            }}
            className="text-indigo-400 hover:text-indigo-300 hover:underline font-semibold"
          >
            {isLogin ? 'Criar agora' : 'Entrar'}
          </button>
        </div>

        {/* Rodapé com versão e verificação de atualização */}
        <div className="mt-5 pt-3 border-t border-obsidian-border/60 flex items-center justify-between text-[11px] text-obsidian-text-muted">
          <span className="font-mono">Xolas v{appVersion}</span>
          <button
            type="button"
            onClick={handleManualCheckUpdate}
            disabled={isCheckingUpdate}
            className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center space-x-1 font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
            <span>{updateStatusText || 'Buscar atualização'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
