import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUserStore } from '../store/useUserStore';
import { joinRoomByCode } from '../data/rooms';

export default function Join() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);

  useEffect(() => {
    const code = searchParams.get('code') || '';
    if (!user) {
      navigate(`/?code=${encodeURIComponent(code)}`, { replace: true });
      return;
    }
    const room = joinRoomByCode(code);
    if (room) {
      navigate(`/room/${room.id}`, { replace: true });
    } else {
      navigate('/rooms', { replace: true, state: { joinError: true } });
    }
  }, [user, searchParams, navigate]);

  return null;
}
