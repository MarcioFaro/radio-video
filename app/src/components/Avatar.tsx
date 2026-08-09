interface AvatarProps {
  name: string;
  url?: string;
  size?: number;
  className?: string;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, url, size = 24, className = '' }: AvatarProps) {
  const dim = `${size}px`;
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <div
      className={`rounded-full bg-[#1db954] text-black font-bold flex items-center justify-center ${className}`}
      style={{ width: dim, height: dim, fontSize: size * 0.42 }}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
