import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useUserStore } from '../store/useUserStore';
import { Radio, ShieldCheck } from 'lucide-react';

export default function Login() {
  const [name, setName] = useState(localStorage.getItem('lastUsername') || '');
  const user = useUserStore((state) => state.user);
  const login = useUserStore((state) => state.login);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (user) {
      const code = searchParams.get('code');
      navigate(code ? `/join?code=${encodeURIComponent(code)}` : '/rooms', { replace: true });
    }
  }, [user, navigate, searchParams]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      localStorage.setItem('lastUsername', name.trim());
      login(name);
      const code = searchParams.get('code');
      navigate(code ? `/join?code=${encodeURIComponent(code)}` : '/rooms');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#181818] rounded-2xl p-8 shadow-2xl border border-white/5">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-[#1db954]/10 rounded-full flex items-center justify-center mb-4">
            <Radio size={32} className="text-[#1db954]" />
          </div>
          <h1 className="text-2xl font-bold text-white">Rádio Colaborativa</h1>
          <p className="text-sm text-gray-400 mt-2 text-center">
            Ouça músicas sincronizadas com seus amigos.
          </p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Como quer ser chamado?
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome ou apelido"
              className="w-full bg-[#282828] text-white border border-transparent rounded-lg px-4 py-3 focus:outline-none focus:border-[#1db954] focus:ring-1 focus:ring-[#1db954] transition-all placeholder:text-gray-600"
              required
            />
          </div>
          
          <button
            type="submit"
            className="w-full bg-[#1db954] hover:bg-[#1ed760] text-black font-bold rounded-lg px-4 py-3 mt-2 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#181818]"
          >
            Entrar
          </button>
        </form>

        <Link
          to="/admin"
          className="mt-6 flex items-center justify-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          <ShieldCheck size={14} />
          Central de Admin
        </Link>
      </div>
    </div>
  );
}
