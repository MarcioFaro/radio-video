import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/useUserStore';
import { useRoomsStore } from '../store/useRoomsStore';
import { LogOut, Plus, Users, ArrowRight, Mic2, Star } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : 'http://127.0.0.1:3005';

interface LiveRoom {
  id: string;
  name: string;
  codigo_convite: string;
  usersCount: number;
  radialistaName: string | null;
}

export default function Rooms() {
  const { user, logout } = useUserStore();
  const { createRoom } = useRoomsStore();
  const navigate = useNavigate();

  const [isCreating, setIsCreating] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  
  const [liveRooms, setLiveRooms] = useState<LiveRoom[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    if (user?.id) {
      fetch(`${BACKEND_URL}/favorites/${user.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.favorites) setFavorites(data.favorites);
        })
        .catch(console.error);
    }
  }, [user]);

  useEffect(() => {
    fetch(`${BACKEND_URL}/rooms`)
      .then(res => res.json())
      .then(data => {
        if (data.rooms) {
          setLiveRooms(data.rooms);
        }
      })
      .catch(err => console.error('Error fetching live rooms:', err));
  }, []);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (newRoomName.trim() && user) {
      const room = createRoom(newRoomName, user.id);
      navigate(`/room/${room.id}`);
    }
  };


  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const toggleFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!user) return;
    
    const isFav = favorites.includes(id);
    const next = isFav ? favorites.filter(f => f !== id) : [...favorites, id];
    setFavorites(next);
    
    fetch(`${BACKEND_URL}/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, roomId: id, action: isFav ? 'remove' : 'add' })
    }).catch(console.error);
  };

  const sortedRooms = [...liveRooms].sort((a, b) => {
    const aFav = favorites.includes(a.id);
    const bFav = favorites.includes(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return b.usersCount - a.usersCount; // Critério de desempate: mais ouvintes
  });

  return (
    <div className="min-h-screen bg-[#121212] flex flex-col">

      <div className="p-4 max-w-3xl mx-auto w-full flex-1">
      {/* Header */}
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-3">
          <img src={user?.avatar_url} alt="Avatar" className="w-10 h-10 rounded-full" />
          <div>
            <p className="text-sm text-gray-400">Bem-vindo,</p>
            <p className="font-bold text-white">{user?.name}</p>
          </div>
        </div>
        <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-white transition-colors">
          <LogOut size={20} />
        </button>
      </header>

      {/* Actions */}
      <div className="my-6">
        {!isCreating ? (
          <button 
            onClick={() => setIsCreating(true)}
            className="w-full flex items-center justify-center gap-2 bg-[#1db954] hover:bg-[#1ed760] text-black font-bold py-4 rounded-xl transition-colors"
          >
            <Plus size={24} />
            Criar Nova Rádio
          </button>
        ) : (
          <form onSubmit={handleCreateRoom} className="bg-[#181818] p-4 rounded-xl border border-white/5 flex gap-2">
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Nome da Rádio..."
              autoFocus
              className="flex-1 bg-[#282828] text-white rounded-lg px-4 py-2 focus:outline-none focus:border-[#1db954] focus:ring-1 focus:ring-[#1db954]"
              required
            />
            <button type="submit" className="bg-[#1db954] text-black font-bold px-6 rounded-lg hover:bg-[#1ed760]">
              Criar
            </button>
            <button type="button" onClick={() => setIsCreating(false)} className="text-gray-400 hover:text-white px-4">
              Cancelar
            </button>
          </form>
        )}
      </div>



      {/* Rooms List */}
      <div>
        <h2 className="text-xl font-bold mb-4 text-white">Comuna-Radio - Salas Ativas</h2>
        <div className="grid gap-3">
          {sortedRooms.length === 0 ? (
            <p className="text-gray-400 text-center py-8">Nenhuma rádio ativa no momento. Crie a sua!</p>
          ) : (
            sortedRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => navigate(`/room/${room.id}`, { state: { usersCount: room.usersCount } })}
                className="flex items-center justify-between bg-[#181818] hover:bg-[#282828] p-4 rounded-xl border border-white/5 transition-all text-left group"
              >
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg text-white group-hover:text-[#1db954] transition-colors pr-4">{room.name}</h3>
                    <div 
                      onClick={(e) => toggleFavorite(e, room.id)}
                      className={`p-1.5 rounded-full hover:bg-white/10 transition-colors ${favorites.includes(room.id) ? 'text-[#1db954]' : 'text-gray-600'}`}
                      title={favorites.includes(room.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                    >
                      <Star size={18} fill={favorites.includes(room.id) ? 'currentColor' : 'none'} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 mt-2 text-gray-400 text-sm">

                    <div className="flex items-center gap-2">
                      <Users size={14} className={room.usersCount > 0 ? 'text-[#1db954]' : ''} />
                      <span className={room.usersCount > 0 ? 'text-white font-medium' : ''}>
                        {room.usersCount} ouvintes
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mic2 size={14} />
                      <span>Radialista: {room.radialistaName || 'Ninguém'}</span>
                    </div>
                  </div>
                </div>
                <div className="w-10 h-10 ml-4 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-[#1db954] group-hover:text-black transition-colors text-gray-400 shrink-0">
                  <ArrowRight size={20} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
