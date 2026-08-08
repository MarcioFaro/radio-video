import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoomStore } from '../store/useRoomStore';
import { useUserStore } from '../store/useUserStore';
import { useRoomsStore } from '../store/useRoomsStore';
import AddMusicModal from '../components/AddMusicModal';
import { Play, Pause, SkipForward, Plus, MessageCircle, Users, ChevronLeft, Send, Video } from 'lucide-react';

export default function Room() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useUserStore(s => s.user);
  const localRooms = useRoomsStore(s => s.rooms);
  
  const { 
    roomName, queue, presence, chat, playback, radialista_id, connected,
    joinRoom, leaveRoom, setPlaybackStatus, sendMessage, simulateRadialistaChange 
  } = useRoomStore();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [chatMsg, setChatMsg] = useState('');
  const [activeTab, setActiveTab] = useState<'queue' | 'chat'>('queue');
  const [showVideo, setShowVideo] = useState(false);
  
  const playerRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  useEffect(() => {
    if (user && id) {
      // Pega o nome da sala do mock local se não existir
      const rn = localRooms.find(r => r.id === id)?.name || `Sala ${id}`;
      joinRoom(id, rn, user);
    }
    return () => leaveRoom();
  }, [id, user]);

  const currentTrack = queue.find(t => t.id === playback.currentTrackId) || queue[0];
  const isRadialista = radialista_id === user?.id;

  // Sincroniza o player HTML com o estado do Zustand (via Sockets)
  useEffect(() => {
    if (playerRef.current && currentTrack?.audio_url) {
      if (playerRef.current.src !== currentTrack.audio_url) {
        playerRef.current.src = currentTrack.audio_url;
      }
      
      if (playback.status === 'playing') {
        playerRef.current.play().catch(e => console.log('Autoplay blocked:', e));
      } else {
        playerRef.current.pause();
      }
    }
  }, [playback.status, playback.currentTrackId, currentTrack]);

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
    const newStatus = playback.status === 'playing' ? 'paused' : 'playing';
    const currentTime = playerRef.current ? playerRef.current.currentTime : 0;
    setPlaybackStatus(newStatus, currentTrack.id, currentTime);
  };

  const handleNextTrack = () => {
    if (!isRadialista) return;
    const currentIndex = queue.findIndex(t => t.id === currentTrack?.id);
    if (currentIndex >= 0 && currentIndex < queue.length - 1) {
      const nextId = queue[currentIndex + 1].id;
      setPlaybackStatus('playing', nextId, 0);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#121212]">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-[#181818] border-b border-white/5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/rooms')} className="p-2 text-gray-400 hover:text-white">
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white">{roomName || 'Sala'}</h1>
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Users size={12} /> {presence.length} ouvindo agora
              <span className={connected ? 'text-[#1db954]' : 'text-red-400'}>
                {'\u2022'} {connected ? 'sincronizado' : 'offline'}
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={simulateRadialistaChange}
          title="Modo dev: simula troca de radialista"
          className="text-[11px] px-2 py-1 rounded-full bg-white/5 border border-white/10 text-gray-400 hover:text-white transition-colors"
        >
          Dev: trocar radialista
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left Side: Player & Info */}
        <div className="flex-1 flex flex-col p-4 lg:p-8 overflow-y-auto">
          
          {/* Video Player Area */}
          <div className="w-full aspect-video bg-black rounded-xl overflow-hidden relative shadow-2xl group flex items-center justify-center">
            {currentTrack ? (
              <>
                {/* Imagem de Fundo (Blur) */}
                <img src={currentTrack.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30 blur-xl" />
                
                {/* Elemento de Áudio/Vídeo Real */}
                {showVideo ? (
                  <video ref={playerRef as any} className="relative w-full h-full object-contain z-10" playsInline />
                ) : (
                  <>
                    <img src={currentTrack.thumbnail_url} alt="Cover" className="relative h-full object-contain z-10 shadow-2xl rounded-lg" />
                    <audio ref={playerRef as any} className="hidden" />
                  </>
                )}
                
                {/* Overlay Controls */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity z-20 flex items-center justify-center gap-4">
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

                {/* Botão para mostrar vídeo (Minimap feature future proof) */}
                <button 
                  onClick={() => setShowVideo(!showVideo)}
                  className="absolute bottom-4 right-4 z-30 p-2 bg-black/50 text-white rounded hover:bg-black/80 transition-colors"
                  title="Ativar/Desativar Vídeo"
                >
                  <Video size={16} className={showVideo ? 'text-[#1db954]' : 'text-white'} />
                </button>
              </>
            ) : (
              <p className="text-gray-500 relative z-10">Fila Vazia</p>
            )}
          </div>

          <div className="mt-6 flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white line-clamp-1">{currentTrack?.titulo || 'Nada tocando'}</h2>
              <p className="text-gray-400 mt-1">Adicionado por {currentTrack?.adicionado_por || '-'}</p>
            </div>
          </div>
          
          {!isRadialista && (
            <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg text-blue-200 text-sm">
              Você é um ouvinte. Apenas o Radialista pode pausar ou pular a música.
            </div>
          )}
        </div>

        {/* Right Side: Sidebar */}
        <div className="w-full lg:w-96 bg-[#181818] border-l border-white/5 flex flex-col h-[50vh] lg:h-full">
          <div className="flex border-b border-white/5">
            <button 
              onClick={() => setActiveTab('queue')}
              className={`flex-1 p-4 font-bold text-sm border-b-2 transition-colors ${activeTab === 'queue' ? 'border-[#1db954] text-[#1db954]' : 'border-transparent text-gray-400'}`}
            >
              Fila
            </button>
            <button 
              onClick={() => setActiveTab('chat')}
              className={`flex-1 p-4 font-bold text-sm border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === 'chat' ? 'border-[#1db954] text-[#1db954]' : 'border-transparent text-gray-400'}`}
            >
              <MessageCircle size={16} /> Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'queue' ? (
              <div className="space-y-3">
                {queue.map((track) => (
                  <div key={track.id} className={`flex gap-3 items-center p-2 rounded-lg ${playback.currentTrackId === track.id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                    <img src={track.thumbnail_url} alt="" className="w-12 h-12 object-cover rounded" />
                    <div className="flex-1 overflow-hidden">
                      <p className={`text-sm font-medium line-clamp-1 ${playback.currentTrackId === track.id ? 'text-[#1db954]' : 'text-white'}`}>{track.titulo}</p>
                      <p className="text-xs text-gray-400">{track.adicionado_por}</p>
                    </div>
                  </div>
                ))}
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
    </div>
  );
}
