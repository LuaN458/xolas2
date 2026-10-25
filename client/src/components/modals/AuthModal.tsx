import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Command } from 'lucide-react';

export const AuthModal: React.FC = () => {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        await login(cleanUser, password);
      } else {
        await register(cleanUser, password);
      }
    } catch (err: any) {
      if (!err.response) {
        setError('Não foi possível conectar ao servidor da Xolas. Verifique sua conexão ou tente novamente em instantes.');
      } else {
        setError(
          err.response?.data?.error ||
            (isLogin ? 'Nickname ou senha incorretos.' : 'Falha ao cadastrar nickname.')
        );
      }
    } finally {
      setLoading(false);
    }
  };

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
          <div className="mb-4 p-2.5 bg-obsidian-rose/10 border border-obsidian-rose/30 text-obsidian-rose rounded-lg text-xs">
            {error}
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
      </div>
    </div>
  );
};
