import { useState, useEffect } from 'react';
import { useRoomStore } from '../store/useRoomStore';
import { useUserStore } from '../store/useUserStore';
import { previewTrack } from '../data/queue';
import { X, Search, Loader2, Film, Library, Play } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : 'http://127.0.0.1:3005';

const QUALITY_OPTIONS = [
  { value: '360p', label: '360p' },
  { value: '144p', label: '144p' },
  { value: 'audio', label: 'Só áudio' },
];

interface AddMusicModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AddMusicModal({ isOpen, onClose }: AddMusicModalProps) {
  const [activeTab, setActiveTab] = useState<'youtube' | 'library'>('youtube');
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState('360p');
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [libraryTracks, setLibraryTracks] = useState<any[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  
  const addTrack = useRoomStore((state) => state.addTrack);
  const user = useUserStore((state) => state.user);

  useEffect(() => {
    if (isOpen) {
      setQuality('360p');
      setPreview(null);
      setError('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === 'library') {
      fetchLibrary();
    }
  }, [isOpen, activeTab]);

  const fetchLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch(`${BACKEND_URL}/library`);
      const data = await res.json();
      setLibraryTracks(data.tracks || []);
    } catch (err) {
      console.error('Failed to fetch library', err);
    } finally {
      setLoadingLibrary(false);
    }
  };

  if (!isOpen) return null;

  const handleSearchYoutube = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      const data = await previewTrack(url, quality);
      setPreview(data);
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const handleQualityChange = (q: string) => {
    setQuality(q);
    setPreview(null);
    setError('');
  };

  const handleAddPreview = () => {
    if (preview && user) {
      addTrack({
        youtube_video_id: preview.id,
        titulo: preview.titulo,
        thumbnail_url: preview.thumbnail_url,
        duracao_seg: preview.duracao_seg,
        audio_url: preview.audio_url,
        video_url: preview.video_url,
        adicionado_por: user.name
      });
      setUrl('');
      setPreview(null);
      onClose();
    }
  };

  const handleAddLibraryTrack = (track: any) => {
    if (user) {
      addTrack({
        youtube_video_id: track.youtube_id,
        titulo: track.titulo,
        thumbnail_url: track.thumbnail_url,
        duracao_seg: track.duracao_seg,
        audio_url: track.audio_url || '',
        video_url: track.video_url || '',
        adicionado_por: user.name
      });
      onClose();
    }
  };

  const filteredLibrary = libraryTracks;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-[#181818] w-full max-w-lg rounded-2xl border border-white/5 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header & Tabs */}
        <div className="flex justify-between items-center p-4 border-b border-white/10 shrink-0">
          <h2 className="text-lg font-bold text-white">Adicionar Música</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex border-b border-white/5 shrink-0">
          <button 
            onClick={() => setActiveTab('youtube')}
            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'youtube' ? 'text-[#1db954] border-b-2 border-[#1db954]' : 'text-gray-400 hover:text-white'}`}
          >
            <Film size={16} /> YouTube
          </button>
          <button 
            onClick={() => setActiveTab('library')}
            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'library' ? 'text-[#1db954] border-b-2 border-[#1db954]' : 'text-gray-400 hover:text-white'}`}
          >
            <Library size={16} /> Biblioteca
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 overflow-y-auto">
          {activeTab === 'youtube' ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Cole o link do YouTube..."
                  className="flex-1 bg-[#282828] text-white rounded-lg px-4 py-3 focus:outline-none focus:border-[#1db954] focus:ring-1 focus:ring-[#1db954]"
                />
                <button 
                  onClick={handleSearchYoutube}
                  disabled={loading}
                  className="bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white p-3 rounded-lg transition-colors shrink-0"
                >
                  {loading ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
                </button>
              </div>

              <div className="flex gap-2">
                {QUALITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleQualityChange(opt.value)}
                    className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                      quality === opt.value
                        ? 'bg-[#1db954]/20 border-[#1db954] text-[#1db954]'
                        : 'bg-[#282828] border-white/5 text-gray-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              
              {error && <p className="text-red-400 text-sm">{error}</p>}

              {preview && (
                <div className="p-3 bg-[#282828] rounded-lg flex gap-3 items-center">
                  <img src={preview.thumbnail_url} alt="Thumb" className="w-24 h-16 object-cover rounded" />
                  <div className="flex-1">
                    <h4 className="text-white font-medium text-sm line-clamp-2">{preview.titulo}</h4>
                    <p className="text-xs text-gray-400 mt-1">
                      {Math.floor(preview.duracao_seg / 60)}:{String(preview.duracao_seg % 60).padStart(2, '0')}
                      {' · '}
                      {QUALITY_OPTIONS.find((o) => o.value === preview.quality)?.label ?? '360p'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {loadingLibrary ? (
                  <div className="flex justify-center py-8 text-gray-400">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                ) : filteredLibrary.length === 0 ? (
                  <p className="text-gray-400 text-center py-8 text-sm">Nenhuma música encontrada na biblioteca.</p>
                ) : (
                  filteredLibrary.map(track => (
                    <button
                      key={track.youtube_id}
                      onClick={() => handleAddLibraryTrack(track)}
                      className="w-full text-left p-2 rounded-lg hover:bg-white/5 transition-colors flex items-center gap-3 group"
                    >
                      <div className="relative w-12 h-12 shrink-0">
                        <img src={track.thumbnail_url} alt="" className="w-full h-full object-cover rounded group-hover:opacity-50 transition-opacity" />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play size={16} className="text-white" fill="currentColor" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-white text-sm font-medium line-clamp-1 group-hover:text-[#1db954] transition-colors">{track.titulo}</h4>
                        <p className="text-xs text-gray-400">
                          {Math.floor(track.duracao_seg / 60)}:{String(track.duracao_seg % 60).padStart(2, '0')}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {activeTab === 'youtube' && (
          <div className="p-4 bg-[#121212] border-t border-white/10 flex justify-end gap-3 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white font-medium">
              Cancelar
            </button>
            <button 
              onClick={handleAddPreview}
              disabled={!preview}
              className="px-6 py-2 bg-[#1db954] hover:bg-[#1ed760] disabled:bg-gray-600 disabled:text-gray-400 text-black font-bold rounded-lg transition-colors"
            >
              Adicionar à Fila
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
