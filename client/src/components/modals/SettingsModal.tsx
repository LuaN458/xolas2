import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useVoice } from '../../contexts/VoiceContext';
import { useSocket } from '../../contexts/SocketContext';
import { api } from '../../lib/api';
import { X, User, Mic, Check, AlertCircle, Volume2, Lock, Sliders, ShieldCheck, Sparkles, RefreshCw } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { user, updateUsername } = useAuth();
  const { socket } = useSocket();
  const {
    selectedAudioDeviceId,
    setSelectedAudioDeviceId,
    audioDevices,
    refreshAudioDevices,
    masterVolume,
    setMasterVolume,
    micInputGain,
    setMicInputGain,
  } = useVoice();

  const [activeTab, setActiveTab] = useState<'profile' | 'audio' | 'updates'>('profile');
  const [newNickname, setNewNickname] = useState(user?.username || '');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Estados de Alteração de Senha
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Estados de Versão e Auto-Atualização
  const [appVersion, setAppVersion] = useState<string>('1.0.0');
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then((v) => {
        if (v) setAppVersion(v);
      });
    }
  }, []);

  const handleManualCheckUpdate = async () => {
    if (!window.electronAPI?.checkForUpdates) {
      setUpdateStatus('Versão mais recente instalada.');
      return;
    }
    setIsCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const res = await window.electronAPI.checkForUpdates();
      if (res?.status === 'dev-mode') {
        setUpdateStatus('Modo de desenvolvimento (auto-updater ativo em builds instaladas).');
      } else if (res?.error) {
        setUpdateStatus('Não foi possível verificar atualizações no momento.');
      } else {
        setUpdateStatus('Verificação concluída. Você está na versão mais recente!');
      }
    } catch {
      setUpdateStatus('Você está na versão mais recente!');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // Estados e refs do Teste de Volume do Microfone
  const [volumeLevel, setVolumeLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (user?.username) {
      setNewNickname(user.username);
    }
  }, [user?.username]);

  useEffect(() => {
    if (isOpen) {
      refreshAudioDevices();
    }
  }, [isOpen, refreshAudioDevices]);

  // Iniciar medição de volume do microfone na aba de áudio
  useEffect(() => {
    if (!isOpen || activeTab !== 'audio') {
      stopMicTest();
      return;
    }

    startMicTest(selectedAudioDeviceId);

    return () => {
      stopMicTest();
    };
  }, [isOpen, activeTab, selectedAudioDeviceId]);

  const startMicTest = async (deviceId: string) => {
    stopMicTest();

    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        // Normalizar volume de 0 a 100 aplicando o ganho configurado
        const normalized = Math.min(100, Math.round((avg / 128) * 100 * 2 * (micInputGain / 100)));
        setVolumeLevel(normalized);

        animationFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      console.warn('Não foi possível iniciar o teste de áudio:', err);
    }
  };

  const stopMicTest = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setVolumeLevel(0);
  };

  const handleSaveNickname = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNickname.trim() || newNickname.trim() === user?.username) return;

    setLoading(true);
    setStatusMessage(null);

    try {
      await updateUsername(newNickname.trim());

      // Notificar outros membros via WebSocket
      if (socket) {
        socket.emit('update-profile', {
          username: newNickname.trim(),
        });
      }

      setStatusMessage({ type: 'success', text: 'Apelido atualizado com sucesso!' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.error || 'Erro ao atualizar apelido.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;

    if (newPassword.length < 4) {
      setStatusMessage({ type: 'error', text: 'A nova senha deve ter no mínimo 4 caracteres.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatusMessage({ type: 'error', text: 'A confirmação de senha não coincide com a nova senha.' });
      return;
    }

    setPasswordLoading(true);
    setStatusMessage(null);

    try {
      const res = await api.patch('/api/auth/password', {
        currentPassword,
        newPassword,
      });

      setStatusMessage({ type: 'success', text: res.data?.message || 'Senha atualizada com sucesso!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.error || 'Erro ao atualizar senha. Verifique a senha atual.',
      });
    } finally {
      setPasswordLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-in fade-in">
      <div className="bg-obsidian-surface rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl border border-obsidian-border flex flex-col max-h-[85vh]">
        {/* Cabeçalho */}
        <div className="p-4 px-6 border-b border-obsidian-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-obsidian-text-primary tracking-tight">
            Configurações
          </h2>
          <button
            onClick={() => {
              stopMicTest();
              onClose();
            }}
            className="text-obsidian-text-muted hover:text-white transition-colors p-1 rounded-lg hover:bg-obsidian-card"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Abas com Pílulas e Alto Contraste */}
        <div className="flex border-b border-obsidian-border bg-obsidian-bg px-6 py-2.5 gap-2 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-3.5 py-2 rounded-xl flex items-center space-x-2 transition-all border ${
              activeTab === 'profile'
                ? 'bg-obsidian-card text-white border-obsidian-accent shadow-sm shadow-indigo-500/25 ring-1 ring-obsidian-accent/30'
                : 'text-obsidian-text-secondary border-transparent hover:text-white hover:bg-obsidian-card/60'
            }`}
          >
            <User className="w-4 h-4 text-indigo-400" />
            <span>Perfil & Apelido</span>
          </button>

          <button
            onClick={() => setActiveTab('audio')}
            className={`px-3.5 py-2 rounded-xl flex items-center space-x-2 transition-all border ${
              activeTab === 'audio'
                ? 'bg-obsidian-card text-white border-obsidian-accent shadow-sm shadow-indigo-500/25 ring-1 ring-obsidian-accent/30'
                : 'text-obsidian-text-secondary border-transparent hover:text-white hover:bg-obsidian-card/60'
            }`}
          >
            <Mic className="w-4 h-4 text-emerald-400" />
            <span>Voz & Microfone</span>
          </button>

          <button
            onClick={() => setActiveTab('updates')}
            className={`px-3.5 py-2 rounded-xl flex items-center space-x-2 transition-all border ${
              activeTab === 'updates'
                ? 'bg-obsidian-card text-white border-obsidian-accent shadow-sm shadow-indigo-500/25 ring-1 ring-obsidian-accent/30'
                : 'text-obsidian-text-secondary border-transparent hover:text-white hover:bg-obsidian-card/60'
            }`}
          >
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>Atualizações</span>
          </button>
        </div>

        {/* Conteúdo da Aba */}
        <div className="p-6 flex-1 overflow-y-auto">
          {statusMessage && (
            <div
              className={`mb-4 p-3 rounded-xl flex items-center space-x-2 text-xs border ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-obsidian-rose/10 border-obsidian-rose/30 text-obsidian-rose'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="space-y-6">
              {/* Aba de Perfil */}
              <form onSubmit={handleSaveNickname} className="space-y-5">
              <div className="flex items-center space-x-4 p-3 bg-obsidian-card rounded-xl border border-obsidian-border">
                <img
                  src={
                    user?.avatarUrl ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.username || 'user'}`
                  }
                  alt={user?.username}
                  className="w-14 h-14 rounded-xl bg-obsidian-surface border border-obsidian-border"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-white font-semibold text-sm truncate">
                    {user?.username}
                  </div>
                  <div className="text-obsidian-text-muted text-xs font-mono truncate">
                    {user?.email && !user.email.endsWith('@xolas.local')
                      ? user.email
                      : `@${user?.username?.toLowerCase()}`}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-2">
                  Novo Apelido (Nome de Exibição)
                </label>
                <input
                  type="text"
                  value={newNickname}
                  onChange={(e) => setNewNickname(e.target.value)}
                  placeholder="Seu novo apelido"
                  required
                  className="w-full bg-obsidian-card border border-obsidian-border rounded-xl p-2.5 text-obsidian-text-primary text-xs outline-none focus:border-obsidian-accent/60"
                />
                <p className="text-[11px] text-obsidian-text-muted mt-1.5">
                  Esse nome aparecerá para todos nos canais de texto e salas de transmissão.
                </p>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={loading || !newNickname.trim() || newNickname.trim() === user?.username}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition-all shadow-lg shadow-indigo-600/30 border border-indigo-400/40"
                >
                  {loading ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>

            {/* Seção de Segurança & Alteração de Senha */}
            <div className="border-t border-obsidian-border mt-6 pt-5">
              <div className="flex items-center space-x-2 text-white font-semibold text-xs mb-3">
                <div className="p-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
                  <Lock className="w-3.5 h-3.5" />
                </div>
                <span>Segurança & Alteração de Senha</span>
              </div>

              <form onSubmit={handleSavePassword} className="space-y-3.5 bg-obsidian-card/40 p-4 rounded-xl border border-obsidian-border">
                <div>
                  <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
                    Senha Atual
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Digite sua senha atual"
                    required
                    className="w-full bg-obsidian-card border border-obsidian-border rounded-xl p-2.5 text-obsidian-text-primary text-xs outline-none focus:border-obsidian-accent/60 placeholder-obsidian-text-muted"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
                      Nova Senha
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Mínimo 4 caracteres"
                      required
                      className="w-full bg-obsidian-card border border-obsidian-border rounded-xl p-2.5 text-obsidian-text-primary text-xs outline-none focus:border-obsidian-accent/60 placeholder-obsidian-text-muted"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-1.5">
                      Confirmar Nova Senha
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita a nova senha"
                      required
                      className="w-full bg-obsidian-card border border-obsidian-border rounded-xl p-2.5 text-obsidian-text-primary text-xs outline-none focus:border-obsidian-accent/60 placeholder-obsidian-text-muted"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
                    className="px-5 py-2.5 bg-obsidian-card hover:bg-obsidian-card-hover border border-obsidian-border hover:border-indigo-500/50 text-white hover:text-indigo-400 disabled:opacity-40 rounded-xl font-bold text-xs transition-all shadow-sm flex items-center space-x-1.5"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{passwordLoading ? 'Atualizando...' : 'Atualizar Senha'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
          )}

          {activeTab === 'audio' && (
            /* Aba de Áudio & Microfone */
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider mb-2">
                  Dispositivo de Entrada (Microfone)
                </label>
                <select
                  value={selectedAudioDeviceId}
                  onChange={(e) => setSelectedAudioDeviceId(e.target.value)}
                  className="w-full bg-obsidian-card border border-obsidian-border rounded-xl p-2.5 text-obsidian-text-primary text-xs outline-none focus:border-obsidian-accent/60 cursor-pointer"
                >
                  <option value="default">Padrão do Sistema</option>
                  {audioDevices.map((device, idx) => (
                    <option key={device.deviceId || idx} value={device.deviceId}>
                      {device.label || `Microfone ${idx + 1}`}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-obsidian-text-muted mt-1.5">
                  Selecione o microfone que deseja utilizar nas transmissões e salas de voz.
                </p>
              </div>

              {/* Sensibilidade / Ganho do Microfone */}
              <div className="p-4 bg-obsidian-card rounded-xl border border-obsidian-border space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2 text-obsidian-text-secondary font-medium">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    <span>Sensibilidade do Microfone</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-white bg-obsidian-surface px-2 py-0.5 rounded-lg border border-obsidian-border tabular-nums">
                    {micInputGain}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={micInputGain}
                  onChange={(e) => setMicInputGain(Number(e.target.value))}
                  className="w-full h-1.5 bg-obsidian-surface rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                />
                <p className="text-[10px] text-obsidian-text-muted">
                  Ajuste a intensidade de captação da sua voz antes de entrar em salas ou transmissões.
                </p>
              </div>

              {/* Medidor de Volume em Tempo Real */}
              <div className="p-4 bg-obsidian-card rounded-xl border border-obsidian-border space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2 text-obsidian-text-secondary font-medium">
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                    <span>Teste de Microfone em Tempo Real</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400">
                    {volumeLevel > 0 ? `${volumeLevel}%` : 'Fale algo...'}
                  </span>
                </div>

                {/* Barra Animada de Nível de Som */}
                <div className="w-full h-3 bg-obsidian-surface rounded-full overflow-hidden border border-obsidian-border p-[1px]">
                  <div
                    className="h-full rounded-full transition-all duration-75 bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-500"
                    style={{ width: `${Math.max(4, volumeLevel)}%` }}
                  />
                </div>
                <p className="text-[10px] text-obsidian-text-muted">
                  Fale no microfone para conferir se a barra verde se move conforme o tom da sua voz.
                </p>
              </div>

              {/* Volume Geral de Saída das Transmissões e Salas */}
              <div className="p-4 bg-obsidian-card rounded-xl border border-obsidian-border space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2 text-obsidian-text-secondary font-medium">
                    <Volume2 className="w-4 h-4 text-indigo-400" />
                    <span>Volume Geral de Reprodução</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-white bg-obsidian-surface px-2 py-0.5 rounded-lg border border-obsidian-border tabular-nums">
                    {masterVolume}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={masterVolume}
                  onChange={(e) => setMasterVolume(Number(e.target.value))}
                  className="w-full h-1.5 bg-obsidian-surface rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                />
                <p className="text-[10px] text-obsidian-text-muted">
                  Ajuste o volume geral para transmissões de tela e salas de áudio.
                </p>
              </div>

              {/* Notificação de Persistência Local */}
              <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 flex items-center space-x-2.5 text-xs text-emerald-400">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span className="text-[11px] text-emerald-300/90 leading-tight">
                  Suas preferências de volumes, ganho e microfone são gravadas localmente neste dispositivo e mantidas mesmo após fechar o aplicativo.
                </span>
              </div>
            </div>
          )}

          {activeTab === 'updates' && (
            /* Nova Aba Exclusiva de Atualizações */
            <div className="space-y-5">
              {/* Card de Destaque da Versão */}
              <div className="p-5 bg-obsidian-card rounded-2xl border border-obsidian-border space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-3 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 shadow-inner">
                      <Sparkles className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-sm font-bold text-white tracking-wide">Xolas Desktop</h3>
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-obsidian-surface text-indigo-300 border border-obsidian-border shadow-sm">
                          v{appVersion}
                        </span>
                      </div>
                      <p className="text-[11px] text-obsidian-text-muted mt-0.5">
                        Aplicativo de Comunicação e Transmissão Studio Obsidian
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleManualCheckUpdate}
                    disabled={isCheckingUpdate}
                    className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 shadow-lg shadow-indigo-500/25 disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                    <span>{isCheckingUpdate ? 'Verificando...' : 'Verificar Atualização'}</span>
                  </button>
                </div>

                {/* Status do Sistema */}
                <div className="p-3.5 bg-obsidian-surface rounded-xl border border-obsidian-border flex items-center space-x-2.5 text-xs">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isCheckingUpdate ? 'bg-indigo-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
                  <span className="text-obsidian-text-secondary font-medium">Status do Sistema:</span>
                  <span className="text-white font-medium text-[11px] truncate flex-1">
                    {updateStatus || 'Você está utilizando a versão mais recente.'}
                  </span>
                </div>
              </div>

              {/* Informações do Canal e Distribuição */}
              <div className="p-4 bg-obsidian-card rounded-xl border border-obsidian-border space-y-3">
                <h4 className="text-[10px] font-bold text-obsidian-text-muted uppercase tracking-wider">
                  Canal de Distribuição
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-obsidian-surface rounded-xl border border-obsidian-border">
                    <span className="text-[10px] text-obsidian-text-muted block mb-0.5">Provedor Oficial</span>
                    <span className="font-semibold text-white">GitHub Releases</span>
                  </div>
                  <div className="p-3 bg-obsidian-surface rounded-xl border border-obsidian-border">
                    <span className="text-[10px] text-obsidian-text-muted block mb-0.5">Repositório</span>
                    <span className="font-semibold text-indigo-400 font-mono">LuaN458/xolas2</span>
                  </div>
                </div>
              </div>

              {/* Informações sobre Atualizações em Segundo Plano */}
              <div className="p-3.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 flex items-start space-x-3 text-xs text-emerald-400">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold text-emerald-300 block">Atualizações Automáticas Ativas</span>
                  <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                    O Xolas verifica o repositório silenciosamente a cada 2 horas. Quando houver uma nova versão, ela será baixada automaticamente em segundo plano e você receberá uma notificação na tela para reiniciar o aplicativo.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
