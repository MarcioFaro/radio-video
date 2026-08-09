import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/useUserStore';
import { useRoomsStore } from '../store/useRoomsStore';
import { LogOut, Plus, Users, ArrowRight, KeyRound, Mic2 } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : 'http://127.0.0.1:3005';

export default function Rooms() {
  const { user, logout } = useUserStore();
  const { rooms, createRoom, joinRoom } = useRoomsStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [isCreating, setIsCreating] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState(location.state?.joinError === true);
  const [liveRooms, setLiveRooms] = useState<Record<string, { usersCount: number, radialistaName: string | null }>>({});

  useEffect(() => {
    fetch(`${BACKEND_URL}/rooms`)
      .then(res => res.json())
      .then(data => {
        const map: Record<string, any> = {};
        if (data.rooms) {
          data.rooms.forEach((r: any) => {
            map[r.id] = r;
          });
        }
        setLiveRooms(map);
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

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    const room = joinRoom(joinCode);
    if (room) {
      navigate(`/room/${room.id}`);
    } else {
      setJoinError(true);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen p-4 max-w-3xl mx-auto">
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

      {/* Enter by invite code */}
      <form onSubmit={handleJoinByCode} className="my-6 flex gap-2">
        <div className="flex-1 flex items-center gap-2 bg-[#181818] rounded-xl border border-white/5 px-4">
          <KeyRound size={18} className="text-gray-500" />
          <input
            type="text"
            value={joinCode}
            onChange={(e) => {
              setJoinCode(e.target.value);
              setJoinError(false);
            }}
            placeholder="Código de convite..."
            className="flex-1 bg-transparent text-white py-3 focus:outline-none placeholder:text-gray-600"
          />
        </div>
        <button
          type="submit"
          className="bg-white/10 hover:bg-white/20 text-white font-bold px-6 rounded-xl transition-colors"
        >
          Entrar
        </button>
      </form>
      {joinError && (
        <p className="text-red-400 text-sm -mt-4 mb-6">
          Código de convite inválido. Confira o código e tente novamente.
        </p>
      )}

      {/* Rooms List */}
      <div>
        <h2 className="text-xl font-bold mb-4 text-white">Suas Rádios</h2>
        <div className="grid gap-3">
          {rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => navigate(`/room/${room.id}`)}
              className="flex items-center justify-between bg-[#181818] hover:bg-[#282828] p-4 rounded-xl border border-white/5 transition-all text-left group"
            >
              <div>
                <h3 className="font-bold text-lg text-white group-hover:text-[#1db954] transition-colors">{room.name}</h3>
                <div className="flex flex-col gap-1.5 mt-2 text-gray-400 text-sm">
                  <div className="flex items-center gap-2">
                    <KeyRound size={14} />
                    <span>Código: {room.codigo_convite}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users size={14} className={liveRooms[room.id]?.usersCount > 0 ? 'text-[#1db954]' : ''} />
                    <span className={liveRooms[room.id]?.usersCount > 0 ? 'text-white font-medium' : ''}>
                      {liveRooms[room.id]?.usersCount || 0} ouvintes
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mic2 size={14} />
                    <span>Radialista: {liveRooms[room.id]?.radialistaName || 'Ninguém'}</span>
                  </div>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-[#1db954] group-hover:text-black transition-colors text-gray-400">
                <ArrowRight size={20} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
