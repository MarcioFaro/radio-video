import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useRoomStore } from '../store/useRoomStore';
import { useUserStore } from '../store/useUserStore';
import { useRoomsStore } from '../store/useRoomsStore';
import AddMusicModal from '../components/AddMusicModal';
import { Play, Pause, SkipForward, Plus, MessageCircle, Users, ChevronLeft, Send, Video, PictureInPicture2, Mic2, Headphones, ChevronUp, ChevronDown, BellOff, BellRing, Moon, Settings, Trash2, Volume2, VolumeX, AlertTriangle } from 'lucide-react';
import { getServerTime } from '../data/realtime';

const VAPID_PUBLIC_KEY = 'BD29BGxbHjhrzUQrUHLiAaRJZDhr7fRP0F3PFtPGpCHLaGjEPKi-Ril1heXJwVOa_3GV-exRHHo4y8cROaaZGhY';
const BACKEND_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : 'http://127.0.0.1:3005';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Room() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useUserStore(s => s.user);
  const localRooms = useRoomsStore(s => s.rooms);
  const usersCount = location.state?.usersCount || 0;
  const [previewMode, setPreviewMode] = useState(usersCount > 0);
  
  const { 
    roomName, queue, presence, chat, playback, radialista_id, connected,
    joinRoom, leaveRoom, setPlaybackStatus, sendMessage, moveTrack, removeTrack, seekTo, trackEnded
  } = useRoomStore();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [chatMsg, setChatMsg] = useState('');
  const [activeTab, setActiveTab] = useState<'queue' | 'chat'>('queue');
  const [showVideo, setShowVideo] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pushMuted, setPushMuted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showPauseWarning, setShowPauseWarning] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const playerRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lastSyncTsRef = useRef<number | null>(null);
  const hideControlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealControls = () => {
    setShowControls(true);
    if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    hideControlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2500);
  };

  useEffect(() => {
    return () => {
      if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    };
  }, []);

  const formatTime = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const timeFromPointer = useCallback((clientX: number) => {
    const bar = barRef.current;
    const el = playerRef.current;
    if (!bar || !el || !duration) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  const pipSupported =
    typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;

  const togglePip = () => {
    const el = playerRef.current;
    if (!el || !(el instanceof HTMLVideoElement)) return;

    const openPip = () => {
      if (document.pictureInPictureElement === el) {
        document.exitPictureInPicture().catch(() => {});
      } else {
        el.requestPictureInPicture().catch((e) => console.log('PiP blocked:', e));
      }
    };

    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      openPip();
      return;
    }
    el.addEventListener('loadedmetadata', openPip, { once: true });
  };

  useEffect(() => {
    if (user && id) {
      // Pega o nome da sala do mock local se não existir
      const rn = localRooms.find(r => r.id === id)?.name || `Sala ${id}`;
      joinRoom(id, rn, user);
    }
    
    if ('Notification' in window && 'serviceWorker' in navigator) {
      setPushEnabled(Notification.permission === 'granted');
    }
    
    return () => leaveRoom();
  }, [id, user]);

  useEffect(() => {
    if (sleepMinutes === null) return;
    const timer = setTimeout(() => {
      setSleepMinutes(null);
      leaveRoom();
      navigate('/rooms');
    }, sleepMinutes * 60 * 1000);
    return () => clearTimeout(timer);
  }, [sleepMinutes, navigate, leaveRoom]);

  const currentTrack = queue.find(t => t.id === playback.currentTrackId) || queue[0];
  const isRadialista = radialista_id === user?.id;

  const lineup = [...presence].sort((a, b) => (a.entrou_em ?? 0) - (b.entrou_em ?? 0));
  const myIndex = lineup.findIndex(u => u.id === user?.id);
  const myPosition = myIndex >= 0 ? myIndex + 1 : 0;
  const radialistaName = lineup.find(u => u.id === radialista_id)?.name;

  const mediaSrc = showVideo && currentTrack?.video_url ? currentTrack.video_url : currentTrack?.audio_url;

  // Sincroniza o player HTML com o estado do Zustand (via Sockets)
  useEffect(() => {
    const el = playerRef.current;
    if (el && mediaSrc) {
      if (el.src !== mediaSrc) {
        el.src = mediaSrc;
      }
      
      if (playback.status === 'playing' && !previewMode) {
        if (el.paused) {
          el.play().then(() => setAutoplayBlocked(false)).catch(e => {
            console.log('Autoplay blocked:', e);
            setAutoplayBlocked(true);
          });
        }
      } else {
        el.pause();
      }

      // Segue o timestamp do radialista quando chega um novo valor (seek)
      if (playback.timestamp !== lastSyncTsRef.current) {
        lastSyncTsRef.current = playback.timestamp;
        if (
          playback.timestamp > 0 &&
          el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          Math.abs(el.currentTime - playback.timestamp) > 1
        ) {
          el.currentTime = playback.timestamp;
        }
      }
    }
  }, [playback.status, playback.currentTrackId, playback.timestamp, currentTrack, mediaSrc]);

  // Acompanha o progresso do player (time / duration) e corrige deriva
  useEffect(() => {
    const el = playerRef.current;
    if (!el) return;
    const onTime = () => {
      if (!dragging) {
        setTime(el.currentTime);
        
        // Correção de deriva do servidor
        if (playback.status === 'playing' && playback.updated_at && connected) {
          const expected = playback.timestamp + (getServerTime() - playback.updated_at) / 1000;
          const duration = el.duration || Infinity;
          if (expected >= 0 && expected <= duration && Math.abs(el.currentTime - expected) > 2) {
            el.currentTime = expected;
          }
        }
      }
    };
    const onMeta = () => setDuration(el.duration || 0);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
    };
  }, [showVideo, currentTrack, dragging, playback.status, playback.timestamp, playback.updated_at, connected]);

  // Reseta o progresso ao trocar de faixa
  useEffect(() => {
    setTime(0);
    setDuration(0);
    lastSyncTsRef.current = null;
    if (playerRef.current) {
      playerRef.current.currentTime = 0;
    }
  }, [mediaSrc]);

  // O Auto-advance agora é gerenciado pelo Backend na Fase 6.
  // Nenhum cliente avança a fila sozinho por eventos locais.

  // Estado do Picture-in-Picture (nativo, apenas no modo vídeo)
  useEffect(() => {
    const el = playerRef.current;
    if (!el || !(el instanceof HTMLVideoElement)) return;
    const enter = () => setPipActive(true);
    const leave = () => setPipActive(false);
    el.addEventListener('enterpictureinpicture', enter);
    el.addEventListener('leavepictureinpicture', leave);
    return () => {
      el.removeEventListener('enterpictureinpicture', enter);
      el.removeEventListener('leavepictureinpicture', leave);
    };
  }, [showVideo, currentTrack]);

  // Media Session API (Metadata para PiP, Lockscreen, etc.)
  useEffect(() => {
    if ('mediaSession' in navigator) {
      if (currentTrack) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.titulo,
          artist: 'Comuna-Radio',
          album: roomName || 'Sala',
          artwork: [
            { src: currentTrack.thumbnail_url || '/favicon.svg', sizes: '512x512', type: 'image/jpeg' }
          ]
        });
      } else {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Nada tocando',
          artist: 'Comuna-Radio'
        });
      }
    }
  }, [currentTrack, roomName]);

  if (!user) return <div className="p-8 text-center text-white">Carregando...</div>;

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatMsg.trim()) {
      sendMessage(user.name, chatMsg);
      setChatMsg('');
    }
  };

  const togglePlay = () => {
    if (!isRadialista || !currentTrack) return;
    
    if (playback.status === 'playing' && presence.length > 1) {
      setShowPauseWarning(true);
      return;
    }
    
    const newStatus = playback.status === 'playing' ? 'paused' : 'playing';
    const currentTime = playerRef.current ? playerRef.current.currentTime : 0;
    
    // Força a ação síncrona no elemento para evitar bloqueio no celular
    if (playerRef.current) {
      if (newStatus === 'playing') {
        playerRef.current.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
      } else {
        playerRef.current.pause();
      }
    }
    
    setPlaybackStatus(newStatus, currentTrack.id, currentTime);
  };

  const confirmPauseAndLeave = () => {
    setShowPauseWarning(false);
    if (playerRef.current) {
      playerRef.current.pause();
    }
    leaveRoom();
    navigate('/rooms');
  };

  const handleNextTrack = () => {
    if (!isRadialista || !currentTrack) return;
    trackEnded(currentTrack.id);
  };

  const handlePlayTrack = (trackId: string) => {
    if (!isRadialista) return;
    setPlaybackStatus('playing', trackId, 0);
  };

  const handleSeekStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isRadialista || !duration) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    setTime(timeFromPointer(e.clientX));
  };

  const handleSeekMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setTime(timeFromPointer(e.clientX));
  };

  const handleSeekEnd = () => {
    if (!dragging) return;
    const finalTime = time;
    const el = playerRef.current;
    if (el) el.currentTime = finalTime;
    if (isRadialista) seekTo(finalTime);
    setDragging(false);
  };

  const handleTogglePush = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      alert('Notificações Push não são suportadas pelo seu navegador.');
      return;
    }
    
    if (Notification.permission === 'granted') {
      alert('Notificações já estão ativadas.');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Permissão negada.');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      
      await fetch(`${BACKEND_URL}/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, subscription: sub })
      });
      
      setPushEnabled(true);
    } catch (e) {
      console.error('Push subscription failed:', e);
      alert('Erro ao ativar notificações push.');
    }
  };

  const handleToggleMute = async () => {
    const newState = !pushMuted;
    setPushMuted(newState);
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(`${BACKEND_URL}/push/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint, roomId: id, muted: newState })
          });
        }
      } catch (e) {
        console.error('Failed to update push settings', e);
      }
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#121212] overflow-hidden relative">

      
      {/* Preview Overlay */}
      {previewMode && (
        <div className="absolute inset-0 z-50 pointer-events-none flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="pointer-events-auto flex flex-col items-center gap-6 bg-[#181818] p-8 rounded-2xl shadow-2xl border border-[#1db954]/20 max-w-sm text-center mx-4">
            <h2 className="text-2xl font-bold text-white">Pronto para ouvir?</h2>
            <p className="text-gray-400 text-sm">Você está no modo de pré-visualização. Navegue pela rádio e, quando quiser, confirme a entrada.</p>
            <button 
              onClick={() => setPreviewMode(false)}
              className="bg-[#1db954] text-black font-bold px-12 py-4 rounded-full text-lg shadow-[0_0_40px_rgba(29,185,84,0.3)] hover:scale-105 transition-transform w-full"
            >
              Entrar na Rádio
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex-none p-4 flex items-center justify-between z-10 relative bg-[#181818] border-b border-white/5">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/rooms')}
            className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white line-clamp-1">{roomName || 'Sala'}</h1>
            <p className="text-xs text-gray-400 flex items-center gap-1 flex-wrap">
              <Users size={12} /> {presence.length} ouvindo
              <span className="mx-0.5">•</span>
              <Mic2 size={12} /> {radialistaName || 'Ninguém'}
              <span className={connected ? 'text-[#1db954] ml-1' : 'text-red-400 ml-1'}>
                {'\u2022'} {connected ? 'sinc' : 'off'}
              </span>
            </p>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {isRadialista ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#1db954] text-black">
                  <Mic2 size={12} /> Você é o Radialista
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/10 text-gray-200 border border-white/10">
                  <Headphones size={12} className={myPosition === 2 ? 'text-[#1db954]' : 'text-gray-400'} />
                  {myPosition === 2 ? 'Você é o próximo radialista' : myPosition > 0 ? `Você está em #${myPosition} na fila` : 'Ouvinte'}
                </span>
              )}
              
              <button 
                onClick={handleTogglePush}
                title={pushEnabled ? "Notificações ativadas" : "Ativar notificações"}
                className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${
                  pushEnabled 
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                    : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
                }`}
              >
                {pushEnabled ? <BellRing size={12} /> : <BellOff size={12} />}
                {pushEnabled ? 'Alertas On' : 'Alertas Off'}
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Sleep Timer */}
          <div className="relative group">
            <button
              className={`p-2 rounded-full transition-colors ${sleepMinutes ? 'text-[#1db954] bg-[#1db954]/10' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              title="Sleep Timer"
            >
              <Moon size={20} />
            </button>
            <div className="absolute right-0 top-full mt-2 w-32 bg-[#282828] border border-white/10 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
              <div className="p-2 text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/10">Sleep Timer</div>
              {[15, 30, 60].map(mins => (
                <button
                  key={mins}
                  onClick={() => setSleepMinutes(mins)}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-white/5 ${sleepMinutes === mins ? 'text-[#1db954]' : 'text-white'}`}
                >
                  {mins} minutos
                </button>
              ))}
              <button
                onClick={() => setSleepMinutes(null)}
                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-white/5 border-t border-white/10"
              >
                Desativar
              </button>
            </div>
          </div>
          
          {/* Settings */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-full transition-colors ${showSettings ? 'text-white bg-white/10' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            title="Configurações da Sala"
          >
            <Settings size={20} />
          </button>
          
          {/* Settings Modal/Dropdown */}
          {showSettings && (
            <div className="absolute right-4 top-16 w-64 bg-[#282828] border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden">
              <div className="p-4 border-b border-white/10">
                <h3 className="font-bold text-white">Configurações da Sala</h3>
              </div>
              <div className="p-4">
                <label className="flex items-center justify-between cursor-pointer group">
                  <span className="text-sm text-gray-200 group-hover:text-white">Silenciar notificações Push</span>
                  <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pushMuted ? 'bg-[#1db954]' : 'bg-gray-600'}`}>
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${pushMuted ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                  <input type="checkbox" className="hidden" checked={pushMuted} onChange={handleToggleMute} />
                </label>
                <p className="text-[11px] text-gray-400 mt-2">Você não receberá avisos quando alguém adicionar músicas ou enviar mensagens no chat desta sala.</p>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left Side: Player & Info */}
        <div className="flex-1 flex flex-col p-4 lg:p-8 overflow-y-auto">
          
          {/* Video Player Area */}
          <div
            onTouchStart={revealControls}
            onClick={revealControls}
            onMouseEnter={revealControls}
            onMouseMove={revealControls}
            onMouseLeave={() => {
              if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
              setShowControls(false);
            }}
            className={`w-full max-w-5xl mx-auto aspect-video shrink-0 bg-black rounded-xl overflow-hidden relative shadow-2xl flex items-center justify-center transition-all ${
              showVideo
                ? 'min-h-[200px] max-h-[40vh] lg:max-h-[50vh]'
                : 'min-h-[100px] max-h-[20vh] lg:min-h-[200px] lg:max-h-[50vh]'
            }`}
          >
            {currentTrack ? (
              <>
                {/* Imagem de Fundo (Blur) */}
                <img src={currentTrack.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30 blur-xl" />
                
                <video 
                  ref={playerRef as any} 
                  className={`w-full h-full object-contain z-10 ${showVideo ? 'relative' : 'absolute opacity-0 pointer-events-none'}`} 
                  playsInline 
                  muted={isMuted} 
                  onEnded={() => {
                    if (isRadialista && currentTrack) {
                      trackEnded(currentTrack.id);
                    }
                  }}
                />
                
                {!showVideo && (
                  <img src={currentTrack.thumbnail_url} alt="Cover" className="relative h-full object-contain z-10 shadow-2xl rounded-lg" />
                )}

                {/* Overlay de Bloqueio de Autoplay (Celular) */}
                {autoplayBlocked && (
                  <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4 text-center">
                    <div className="bg-[#282828] p-6 rounded-2xl shadow-2xl border border-white/10 flex flex-col items-center max-w-sm">
                      <VolumeX size={48} className="text-red-400 mb-4" />
                      <h3 className="text-white font-bold text-lg mb-2">Áudio Bloqueado</h3>
                      <p className="text-gray-400 text-sm mb-6">O seu navegador bloqueou a reprodução automática.</p>
                      <button 
                        onClick={() => {
                          setAutoplayBlocked(false);
                          if (playerRef.current) {
                            playerRef.current.play().catch(() => setAutoplayBlocked(true));
                          }
                        }}
                        className="bg-[#1db954] text-black px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform"
                      >
                        <Play fill="currentColor" size={20} /> Liberar Áudio
                      </button>
                    </div>
                  </div>
                )}

                {/* Overlay Controls */}
                <div className={`absolute inset-0 bg-black/40 transition-opacity z-20 flex items-center justify-center gap-4 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                  <button 
                    onClick={togglePlay}
                    disabled={!isRadialista}
                    className="w-16 h-16 bg-[#1db954] text-black rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-50 disabled:bg-gray-500"
                  >
                    {playback.status === 'playing' ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
                  </button>
                  <button 
                    onClick={handleNextTrack}
                    disabled={!isRadialista}
                    className="w-12 h-12 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30 transition-colors disabled:opacity-50"
                  >
                    <SkipForward size={24} fill="currentColor" />
                  </button>
                </div>

                {/* Botão para mostrar vídeo (Minimap feature future proof) + PiP + Volume */}
                <div className="absolute bottom-4 right-4 z-30 flex gap-2">
                  <div className="flex items-center gap-1 bg-black/50 rounded px-2 hover:bg-black/80 transition-colors group">
                    <button 
                      onClick={() => {
                        const newMuted = !isMuted;
                        setIsMuted(newMuted);
                        if (!newMuted && volume === 0) {
                          setVolume(1);
                          if (playerRef.current) playerRef.current.volume = 1;
                        }
                      }}
                      className="p-1.5 text-white"
                      title={isMuted ? 'Ativar som' : 'Mutar som (apenas para você)'}
                    >
                      {isMuted ? <VolumeX size={16} className="text-red-400" /> : <Volume2 size={16} />}
                    </button>
                    <input 
                      type="range" 
                      min="0" max="1" step="0.01" 
                      value={isMuted ? 0 : volume}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setVolume(val);
                        if (playerRef.current) playerRef.current.volume = val;
                        setIsMuted(val === 0);
                      }}
                      className="w-0 group-hover:w-20 md:w-24 focus:w-24 transition-all cursor-pointer accent-[#1db954]"
                      title="Controle de Volume"
                    />
                  </div>
                  {showVideo && pipSupported && (
                    <button 
                      onClick={togglePip}
                      className="p-2 bg-black/50 text-white rounded hover:bg-black/80 transition-colors"
                      title={pipActive ? 'Fechar Picture-in-Picture' : 'Abrir Picture-in-Picture'}
                    >
                      <PictureInPicture2 size={16} className={pipActive ? 'text-[#1db954]' : 'text-white'} />
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      setShowVideo(!showVideo);
                      if (showVideo) setPipActive(false);
                    }}
                    className="p-2 bg-black/50 text-white rounded hover:bg-black/80 transition-colors"
                    title="Ativar/Desativar Vídeo"
                  >
                    <Video size={16} className={showVideo ? 'text-[#1db954]' : 'text-white'} />
                  </button>
                </div>
              </>
            ) : (
              <p className="text-gray-500 relative z-10">Fila Vazia</p>
            )}
          </div>

          {/* Barra de progresso / seek */}
          {currentTrack && (
            <div className="mt-3 flex items-center gap-3 select-none">
              <span className="text-[11px] tabular-nums text-gray-400 w-10 text-right">{formatTime(time)}</span>
              <div
                ref={barRef}
                onPointerDown={handleSeekStart}
                onPointerMove={handleSeekMove}
                onPointerUp={handleSeekEnd}
                onPointerCancel={handleSeekEnd}
                className={`group relative flex-1 h-1.5 rounded-full bg-white/15 ${isRadialista ? 'cursor-pointer' : ''}`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[#1db954]"
                  style={{ width: `${duration ? (time / duration) * 100 : 0}%` }}
                />
                {isRadialista && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `${duration ? (time / duration) * 100 : 0}%` }}
                  />
                )}
              </div>
              <span className="text-[11px] tabular-nums text-gray-400 w-10">{formatTime(duration)}</span>
            </div>
          )}

          <div className="mt-6 flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white line-clamp-1">{currentTrack?.titulo || 'Nada tocando'}</h2>
              <p className="text-gray-400 mt-1">Adicionado por {currentTrack?.adicionado_por || '-'}</p>
            </div>
          </div>
          
          {!isRadialista && (
            <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg text-blue-200 text-sm">
              Você é um ouvinte. Apenas o Radialista pode tocar, pausar, pular ou reordenar a fila.
            </div>
          )}
        </div>

        {/* Right Side: Sidebar */}
        <div className="w-full lg:w-96 bg-[#181818] border-l border-white/5 flex flex-col h-[50vh] lg:h-full">
          <div className="flex border-b border-white/5">
            <button 
              onClick={() => setActiveTab('queue')}
              className={`flex-1 p-4 font-bold text-sm border-b-2 transition-colors ${activeTab === 'queue' ? 'border-[#1db954] text-[#1db954]' : 'border-transparent text-gray-400 hover:text-white'}`}
            >
              Fila
            </button>
            <button 
              onClick={() => setActiveTab('chat')}
              className={`flex-1 p-4 font-bold text-sm border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === 'chat' ? 'border-[#1db954] text-[#1db954]' : 'border-transparent text-gray-400 hover:text-white'}`}
            >
              <MessageCircle size={16} /> Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'queue' ? (
              <div className="space-y-3">
                {queue.map((track, index) => {
                  const isCurrent = playback.currentTrackId === track.id;
                  const clickable = isRadialista;
                  return (
                    <div
                      key={track.id}
                      onClick={clickable ? () => handlePlayTrack(track.id) : undefined}
                      title={clickable ? 'Tocar esta música' : undefined}
                      className={`flex gap-3 items-center p-2 rounded-lg transition-all ${
                        isCurrent
                          ? 'bg-[#1db954]/20 border border-[#1db954]/50 scale-[1.02] z-10 shadow-lg'
                          : clickable
                            ? 'bg-white/5 hover:bg-white/10 opacity-80 hover:opacity-100 cursor-pointer'
                            : 'bg-white/5 opacity-80'
                      }`}
                    >
                      <img src={track.thumbnail_url} alt="" className="w-12 h-12 object-cover rounded" />
                      <div className="flex-1 overflow-hidden">
                        <p className={`text-sm font-medium line-clamp-1 ${isCurrent ? 'text-[#1db954]' : 'text-white'}`}>{track.titulo}</p>
                        <p className="text-xs text-gray-400">{track.adicionado_por}</p>
                      </div>
                      {clickable && !isCurrent && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePlayTrack(track.id); }}
                          title="Tocar agora"
                          className="p-2 rounded-full text-gray-400 hover:text-white transition-colors"
                        >
                          <Play size={16} fill="currentColor" />
                        </button>
                      )}
                      {isCurrent && (
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#1db954] text-black shrink-0">
                          <Play size={14} fill="currentColor" />
                        </div>
                      )}
                      {isRadialista && (
                        <div className="flex flex-col gap-0.5 ml-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); moveTrack(track.id, -1); }}
                            disabled={index === 0}
                            className="p-1 text-gray-400 hover:text-white disabled:opacity-25 disabled:hover:text-gray-400 transition-colors"
                            title="Mover para cima"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveTrack(track.id, 1); }}
                            disabled={index === queue.length - 1}
                            className="p-1 text-gray-400 hover:text-white disabled:opacity-25 disabled:hover:text-gray-400 transition-colors"
                            title="Mover para baixo"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                            className="p-1 text-red-400/70 hover:text-red-400 transition-colors mt-1"
                            title="Remover música"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                {chat.map(msg => (
                  <div key={msg.id} className="text-sm">
                    <span className="font-bold text-[#1db954]">{msg.user_name}: </span>
                    <span className="text-gray-200">{msg.texto}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-white/5 bg-[#121212]">
            {activeTab === 'queue' ? (
              <button 
                onClick={() => setIsModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 bg-transparent border border-gray-600 hover:border-white text-white font-bold py-3 rounded-full transition-colors"
              >
                <Plus size={20} /> Adicionar
              </button>
            ) : (
              <form onSubmit={handleSendChat} className="flex gap-2">
                <input 
                  type="text" 
                  value={chatMsg}
                  onChange={e => setChatMsg(e.target.value)}
                  placeholder="Mensagem..."
                  className="flex-1 bg-[#282828] text-white rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954]"
                />
                <button type="submit" className="w-10 h-10 rounded-full bg-[#1db954] text-black flex items-center justify-center">
                  <Send size={16} />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <AddMusicModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* Pause Warning Modal */}
      {showPauseWarning && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#282828] rounded-xl max-w-md w-full shadow-2xl overflow-hidden border border-white/10 flex flex-col">
            <div className="p-6 pb-4">
              <div className="flex items-center gap-3 mb-4 text-orange-400">
                <AlertTriangle size={32} />
                <h2 className="text-xl font-bold text-white">Você tem certeza?</h2>
              </div>
              <p className="text-gray-300 text-sm mb-4 leading-relaxed">
                A sala tem outros ouvintes! Se você pausar, a música vai parar apenas para você e você <strong className="text-white">perderá o cargo de Radialista</strong> (saindo da sala) para não interromper a festa dos seus amigos.
              </p>
              <p className="text-gray-400 text-sm leading-relaxed">
                Se quiser apenas tirar o som, feche este aviso e use o botão de <strong className="text-white">Mudo</strong> no player (ícone de alto-falante).
              </p>
            </div>
            <div className="p-4 bg-black/30 border-t border-white/5 flex justify-end gap-3">
              <button 
                onClick={() => setShowPauseWarning(false)}
                className="px-4 py-2 rounded-full text-sm font-bold text-white hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmPauseAndLeave}
                className="px-4 py-2 rounded-full text-sm font-bold bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Pausar e Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
