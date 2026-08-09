import { useState } from 'react';
import { useRoomStore } from '../store/useRoomStore';
import { useUserStore } from '../store/useUserStore';
import { previewTrack } from '../data/queue';
import { X, Search, Loader2 } from 'lucide-react';

interface AddMusicModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AddMusicModal({ isOpen, onClose }: AddMusicModalProps) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const addTrack = useRoomStore((state) => state.addTrack);
  const user = useUserStore((state) => state.user);

  if (!isOpen) return null;

  const handleSearch = async () => {
    if (!url.trim()) return;
    
    setLoading(true);
    setError('');
    setPreview(null);
    
    try {
      const data = await previewTrack(url);
      setPreview(data);
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
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

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-[#181818] w-full max-w-md rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Adicionar Música</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Cole o link do YouTube..."
              className="flex-1 bg-[#282828] text-white rounded-lg px-4 py-3 focus:outline-none focus:border-[#1db954] focus:ring-1 focus:ring-[#1db954]"
            />
            <button 
              onClick={handleSearch}
              disabled={loading}
              className="bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white p-3 rounded-lg transition-colors"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
            </button>
          </div>
          
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

          {preview && (
            <div className="mt-4 p-3 bg-[#282828] rounded-lg flex gap-3">
              <img src={preview.thumbnail_url} alt="Thumb" className="w-24 h-16 object-cover rounded" />
              <div className="flex-1">
                <h4 className="text-white font-medium text-sm line-clamp-2">{preview.titulo}</h4>
                <p className="text-xs text-gray-400 mt-1">{Math.floor(preview.duracao_seg / 60)}:{String(preview.duracao_seg % 60).padStart(2, '0')}</p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-[#121212] border-t border-white/10 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white font-medium">
            Cancelar
          </button>
          <button 
            onClick={handleAdd}
            disabled={!preview}
            className="px-6 py-2 bg-[#1db954] hover:bg-[#1ed760] disabled:bg-gray-600 disabled:text-gray-400 text-black font-bold rounded-lg transition-colors"
          >
            Adicionar à Fila
          </button>
        </div>
      </div>
    </div>
  );
}
