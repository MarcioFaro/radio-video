import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  LayoutDashboard,
  Database,
  Radio,
  FileAudio,
  TerminalSquare,
  RefreshCw,
  LogOut,
  Trash2,
  Pencil,
  Search,
  Download,
  Send,
  Cpu,
  Activity,
  Plus,
  X,
  AlertTriangle,
  ArrowLeft,
  Eraser,
} from 'lucide-react';
import {
  adminApi,
  ApiError,
  getAdminToken,
  clearAdminToken,
  setAdminToken,
  downloadBackup,
} from '../services/adminApi';
import type {
  Overview,
  ActivityEntry,
  TableInfo,
  TableDetail,
  LibraryTrack,
  AdminUser,
  PushSub,
  AdminRoom,
  RoomDetail,
  MediaResponse,
  LogEntry,
} from '../services/adminApi';

// ── Helpers de formatação ────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(ts: number | string | null | undefined): string {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(Number(ts));
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Componentes de UI ────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#181818] border border-white/5 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-white font-semibold">{title}</h3>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const base =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-[#1db954] hover:bg-[#1ed760] text-black',
    ghost: 'bg-[#282828] hover:bg-[#333333] text-gray-200',
    danger: 'bg-red-600/15 hover:bg-red-600/25 text-red-400',
  };
  return (
    <button className={`${base} ${styles[variant]} ${className || ''}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: 'green' | 'red' | 'gray' | 'yellow' }) {
  const colors = {
    green: 'bg-[#1db954]/15 text-[#1db954]',
    red: 'bg-red-500/15 text-red-400',
    gray: 'bg-white/10 text-gray-400',
    yellow: 'bg-yellow-500/15 text-yellow-400',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color]}`}>{children}</span>;
}

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="bg-[#1f1f1f] border border-white/10 rounded-2xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={22} />
          <div>
            <h3 className="text-white font-semibold text-lg">{title}</h3>
            <p className="text-gray-400 text-sm mt-2">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6 justify-end">
          <Btn onClick={onCancel}>Cancelar</Btn>
          <Btn variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const emptyRow = 'text-sm text-gray-500 py-2 px-3 border-b border-white/5';
const tableHead = 'text-left text-xs uppercase tracking-wider text-gray-500 font-medium px-3 py-2 border-b border-white/10';

// ── Tela de login ────────────────────────────────────────────────────────────

function AdminGate({ onAuthed }: { onAuthed: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.login(username, password);
      setAdminToken(res.token);
      onAuthed();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'Erro ao entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-black">
      <div className="w-full max-w-sm bg-[#181818] rounded-2xl p-8 shadow-2xl border border-white/5">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-[#1db954]/10 rounded-full flex items-center justify-center mb-4">
            <Shield size={32} className="text-[#1db954]" />
          </div>
          <h1 className="text-2xl font-bold text-white">Central de Admin</h1>
          <p className="text-sm text-gray-400 mt-2 text-center">Acesso restrito ao administrador.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Usuário"
            className="w-full bg-[#282828] text-white border border-transparent rounded-lg px-4 py-3 focus:outline-none focus:border-[#1db954] focus:ring-1 focus:ring-[#1db954] transition-all placeholder:text-gray-600"
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha de administrador"
            className="w-full bg-[#282828] text-white border border-transparent rounded-lg px-4 py-3 focus:outline-none focus:border-[#1db954] focus:ring-1 focus:ring-[#1db954] transition-all placeholder:text-gray-600"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full bg-[#1db954] hover:bg-[#1ed760] disabled:opacity-40 text-black font-bold rounded-lg px-4 py-3 transition-colors"
          >
            {busy ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'banco', label: 'Banco', icon: Database },
  { id: 'radios', label: 'Rádios', icon: Radio },
  { id: 'midias', label: 'Mídias', icon: FileAudio },
  { id: 'logs', label: 'Logs', icon: TerminalSquare },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Admin() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  const [tab, setTab] = useState<TabId>('dashboard');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Dashboard
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [extractorHealth, setExtractorHealth] = useState<{ status: number; body: unknown } | null>(null);

  // Banco
  const [tableInfo, setTableInfo] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState('rooms');
  const [tableDetail, setTableDetail] = useState<TableDetail | null>(null);
  const [libQ, setLibQ] = useState('');
  const [library, setLibrary] = useState<LibraryTrack[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pushSubs, setPushSubs] = useState<PushSub[]>([]);

  // Rádios
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [roomDetail, setRoomDetail] = useState<RoomDetail | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  // Mídias
  const [media, setMedia] = useState<MediaResponse | null>(null);

  // Logs
  const [apiLogs, setApiLogs] = useState<LogEntry[]>([]);
  const [extractorLogs, setExtractorLogs] = useState<LogEntry[]>([]);
  const [logLines, setLogLines] = useState(200);
  const [logFilter, setLogFilter] = useState<'all' | LogEntry['level']>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Modais
  const [confirm, setConfirm] = useState<null | { title: string; message: string; action: () => Promise<void> }>(null);
  const [editTrack, setEditTrack] = useState<null | LibraryTrack>(null);
  const [editRoom, setEditRoom] = useState<null | AdminRoom>(null);
  const [pushModal, setPushModal] = useState(false);
  const [addTrackRoomId, setAddTrackRoomId] = useState<string | null>(null);
  const [addTrackYoutubeId, setAddTrackYoutubeId] = useState('');
  const [extractTestUrl, setExtractTestUrl] = useState('');
  const [extractTestResult, setExtractTestResult] = useState<any>(null);

  const showError = (e: unknown) => {
    setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
  };
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const run = useCallback(async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (e: any) {
      if (e?.status === 401) {
        setAuthed(false);
        return;
      }
      showError(e);
    }
  }, []);

  const loadOverview = useCallback(() => run(async () => {
    const [ov, act, ex] = await Promise.all([
      adminApi.overview(),
      adminApi.activity(50),
      adminApi.extractorHealth().catch(() => null),
    ]);
    setOverview(ov);
    setActivity(act.activity);
    setExtractorHealth(ex);
  }), [run]);

  const loadBanco = useCallback(() => run(async () => {
    const [t, lib, us, ps] = await Promise.all([
      adminApi.tables(),
      adminApi.library(),
      adminApi.users(),
      adminApi.pushSubscriptions(),
    ]);
    setTableInfo(t.tables);
    setLibrary(lib.tracks);
    setUsers(us.users);
    setPushSubs(ps.subscriptions);
  }), [run]);

  const loadTable = useCallback((name: string) => run(async () => {
    setSelectedTable(name);
    setTableDetail(await adminApi.table(name));
  }), [run]);

  const loadRooms = useCallback(() => run(async () => {
    const res = await adminApi.rooms();
    setRooms(res.rooms);
  }), [run]);

  const loadMedia = useCallback(() => run(async () => {
    setMedia(await adminApi.media());
  }), [run]);

  // Remove da biblioteca faixas cujos arquivos já foram apagados na VM (ex.:
  // vídeos excluídos pela aba Mídias antes de essa regra existir).
  const handlePruneLibrary = () => run(async () => {
    const res = await adminApi.pruneLibrary();
    await Promise.all([loadMedia(), loadBanco()]);
    showToast(
      res.removed > 0
        ? `${res.removed} faixa(s) sem arquivo removida(s) da biblioteca.`
        : 'Nenhuma faixa órfã encontrada.'
    );
  });

  const loadLogs = useCallback(() => run(async () => {
    const [api, ex] = await Promise.all([
      adminApi.logs(logLines),
      adminApi.extractorLogs().catch(() => null),
    ]);
    setApiLogs(api.logs);
    if (ex && ex.body?.logs) setExtractorLogs(ex.body.logs);
  }), [run, logLines]);

  const loadRoomDetail = useCallback((id: string) => run(async () => {
    setSelectedRoomId(id);
    try {
      setRoomDetail(await adminApi.roomDetail(id));
    } catch (e: any) {
      setRoomDetail(null);
      if (e?.status !== 404) showError(e);
    }
  }), [run]);

  const refreshAll = () => {
    if (tab === 'dashboard') loadOverview();
    if (tab === 'banco') loadBanco();
    if (tab === 'radios') loadRooms();
    if (tab === 'midias') loadMedia();
    if (tab === 'logs') loadLogs();
  };

  useEffect(() => {
    if (!authed) return;
    loadOverview();
    loadBanco();
    loadRooms();
    loadMedia();
    loadLogs();
  }, [authed, loadOverview, loadBanco, loadRooms, loadMedia, loadLogs]);

  useEffect(() => {
    if (authed && tab === 'banco') loadTable(selectedTable);
  }, [authed, tab, selectedTable, loadTable]);

  useEffect(() => {
    if (!authed) return;
    if (!autoRefresh) return;
    const t = setInterval(() => loadLogs(), 4000);
    return () => clearInterval(t);
  }, [authed, autoRefresh, loadLogs]);

  const handleLogout = async () => {
    try {
      await adminApi.logout();
    } catch {
      /* ignora */
    }
    clearAdminToken();
    setAuthed(false);
    navigate('/');
  };

  if (!authed) return <AdminGate onAuthed={() => { setAuthed(true); }} />;

  const openConfirm = (title: string, message: string, action: () => Promise<void>) =>
    setConfirm({ title, message, action });

  const filteredLogs = apiLogs.filter((l) => logFilter === 'all' || l.level === logFilter);

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-40 bg-black/90 backdrop-blur border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield className="text-[#1db954]" size={22} />
            <h1 className="font-bold">Central de Admin</h1>
          </div>
          <div className="flex items-center gap-2">
            <Btn onClick={refreshAll} title="Atualizar tudo">
              <RefreshCw size={16} />
              Atualizar
            </Btn>
            <Btn onClick={() => navigate('/rooms')}>
              <ArrowLeft size={16} />
              Voltar ao app
            </Btn>
            <Btn onClick={handleLogout} variant="danger" title="Sair">
              <LogOut size={16} />
              Sair
            </Btn>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto pb-3">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  active ? 'bg-[#1db954] text-black' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}

        {tab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card title="Salas" subtitle="Ativas no momento / no banco">
              <Kpi big={`${overview?.roomsActive ?? '—'}`} sub={`${overview?.roomsTotal ?? '—'} no Supabase · ${overview?.roomsPlaying ?? 0} tocando`} />
            </Card>
            <Card title="Biblioteca" subtitle="Músicas e filas">
              <Kpi big={`${overview?.tracksLibrary ?? '—'}`} sub={`${overview?.roomTracks ?? '—'} entradas de fila`} />
            </Card>
            <Card title="Usuários" subtitle="Cadastrados no Supabase">
              <Kpi big={`${overview?.usersTotal ?? '—'}`} sub={`${overview?.pushSubscriptions ?? 0} push subscriptions`} />
            </Card>
            <Card title="Mídias na VM" subtitle="Arquivos em /downloads">
              <Kpi big={`${overview?.media.count ?? '—'}`} sub={`${fmtBytes(overview?.media.totalBytes ?? 0)} · ${fmtBytes(overview?.media.orphanBytes ?? 0)} órfãs`} />
            </Card>

            <Card title="VM / Infra" subtitle="Métricas do servidor" actions={<Cpu size={18} className="text-gray-500" />}>
              <VmInfo vm={overview?.vm} />
            </Card>

            <Card title="Saúde dos serviços" subtitle="API e extrator">
              <div className="space-y-3">
                <ServiceRow name="API Fastify" ok={true} detail={overview ? `v${overview.vm?.nodeVersion || ''}` : '—'} />
                {extractorHealth === null ? (
                  <ServiceRow name="Extrator" ok={null} detail="consultando..." />
                ) : (
                  <ServiceRow
                    name="Extrator"
                    ok={extractorHealth.status < 300}
                    detail={JSON.stringify(extractorHealth.body) || `HTTP ${extractorHealth.status}`}
                  />
                )}
                <Btn onClick={loadOverview} className="w-full justify-center">
                  <RefreshCw size={16} /> Testar novamente
                </Btn>
              </div>
            </Card>

            <div className="xl:col-span-2">
              <Card title="Atividade recente" subtitle="Últimos eventos (logins, entradas, mensagens...)">
                <div className="max-h-80 overflow-y-auto">
                  {activity.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 py-2 border-b border-white/5 text-sm">
                      <Activity size={15} className="text-gray-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-medium text-gray-200">{eventLabel(a.type)}</span>
                        {a.detail && <span className="text-gray-500"> — {a.detail}</span>}
                      </div>
                      <span className="ml-auto text-xs text-gray-600 shrink-0">{fmtDate(a.ts)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === 'banco' && (
          <div className="space-y-4">
            <Card
              title="Tabelas do Supabase"
              subtitle="Navegador genérico de tabelas conhecidas"
              actions={
                <>
                  {tableInfo.map((t) => (
                    <Btn key={t.name} variant={selectedTable === t.name ? 'primary' : 'ghost'} onClick={() => loadTable(t.name)}>
                      {t.name} <span className="opacity-70">({t.count})</span>
                    </Btn>
                  ))}
                </>
              }
            >
              {tableDetail && (
                <div className="overflow-auto max-h-[420px] rounded-lg border border-white/5">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[#222]">
                      <tr>
                        {tableDetail.columns.map((c) => (
                          <th key={c} className={tableHead}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableDetail.rows.length === 0 && (
                        <tr><td className={emptyRow} colSpan={tableDetail.columns.length || 1}>Nenhuma linha.</td></tr>
                      )}
                      {tableDetail.rows.slice(0, 200).map((row, i) => (
                        <tr key={i} className="hover:bg-white/5">
                          {tableDetail.columns.map((c) => (
                            <td key={c} className="max-w-[280px] truncate px-3 py-2 border-b border-white/5 text-gray-300">
                              {formatCell(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Biblioteca de músicas" subtitle="Edite o título, duração ou exclua a faixa">
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={libQ}
                    onChange={(e) => setLibQ(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && run(async () => setLibrary((await adminApi.library(libQ)).tracks))}
                    placeholder="Buscar pelo título..."
                    className="w-full bg-[#282828] text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954]"
                  />
                </div>
                <Btn variant="primary" onClick={() => run(async () => setLibrary((await adminApi.library(libQ)).tracks))}>
                  <Search size={16} /> Buscar
                </Btn>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {library.map((t) => (
                  <div key={t.youtube_id} className="flex items-center gap-3 py-2 border-b border-white/5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-gray-200">{t.titulo}</p>
                      <p className="text-xs text-gray-600 truncate">
                        {t.youtube_id} · {fmtDur(t.duracao_seg)} · {t.references} ref(s)
                      </p>
                    </div>
                    <Btn onClick={() => setEditTrack(t)} title="Editar faixa">
                      <Pencil size={15} />
                    </Btn>
                    <Btn
                      variant="danger"
                      title="Excluir faixa da biblioteca"
                      onClick={() =>
                        openConfirm(
                          'Excluir faixa da biblioteca',
                          `Remover "${t.titulo}" da biblioteca e de todas as filas? Essa ação não pode ser desfeita.`,
                          async () => {
                            await adminApi.deleteTrack(t.youtube_id);
                            setLibrary((prev) => prev.filter((x) => x.youtube_id !== t.youtube_id));
                            showToast('Faixa excluída.');
                          }
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </Btn>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Usuários" subtitle="Cadastrados + favoritos + push">
                <div className="max-h-80 overflow-y-auto">
                  {users.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 py-2 border-b border-white/5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-gray-200">{u.name}</p>
                        <p className="text-xs text-gray-600 truncate">{u.id}</p>
                      </div>
                      <span className="text-xs text-gray-500">{u.favoritesCount} fav · {u.pushSubscriptions} push</span>
                      <Btn
                        variant="danger"
                        title="Excluir usuário"
                        onClick={() =>
                          openConfirm(
                            'Excluir usuário',
                            `Remover "${u.name}" (${u.id}), favoritos e push subscriptions?`,
                            async () => {
                              await adminApi.deleteUser(u.id);
                              setUsers((prev) => prev.filter((x) => x.id !== u.id));
                              showToast('Usuário excluído.');
                            }
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </Btn>
                    </div>
                  ))}
                </div>
              </Card>

              <Card
                title="Push subscriptions"
                subtitle="Inscrições de notificação"
                actions={
                  <Btn variant="primary" onClick={() => setPushModal(true)}>
                    <Send size={15} /> Teste
                  </Btn>
                }
              >
                <div className="max-h-80 overflow-y-auto">
                  {pushSubs.map((s) => (
                    <div key={s.endpoint} className="py-2 border-b border-white/5 text-sm">
                      <p className="truncate text-gray-300">{s.userId}</p>
                      <p className="text-xs text-gray-600 truncate">{s.endpoint}</p>
                    </div>
                  ))}
                  {pushSubs.length === 0 && <p className="text-sm text-gray-500 py-2">Nenhuma inscrição.</p>}
                </div>
                <div className="mt-3 flex gap-2">
                  <Btn
                    onClick={() =>
                      openConfirm('Limpar órfãs', 'Remover subscriptions cujo usuário não existe mais no banco?', async () => {
                        const r = await adminApi.clearOrphanSubs();
                        showToast(`${r.removed} removidas.`);
                        loadBanco();
                      })
                    }
                  >
                    <Trash2 size={15} /> Limpar órfãs
                  </Btn>
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === 'radios' && (
          <div className="space-y-4">
            <Card
              title="Rádios / Salas"
              subtitle="Gerencie nome, código, adicione/remova músicas ou exclua a sala"
              actions={
                <Btn onClick={() => run(async () => { await adminApi.refresh(); await loadRooms(); showToast('Salas recarregadas do Supabase.'); })}>
                  <RefreshCw size={15} /> Recarregar
                </Btn>
              }
            >
              <div className="space-y-3">
                {rooms.map((r) => (
                  <div key={r.id} className="border border-white/5 rounded-xl p-4 hover:bg-white/[0.02]">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-200 truncate">{r.name}</p>
                          {r.active && <Badge color="green">ao vivo</Badge>}
                          {r.playbackStatus === 'playing' ? <Badge color="yellow">tocando</Badge> : <Badge color="gray">pausada</Badge>}
                          {!r.inDb && <Badge color="gray">só memória</Badge>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {r.id} · Código: <span className="text-gray-300 font-mono">{r.codigo_convite}</span> ·{' '}
                          {r.usersCount} ouvindo · {r.queueCount} na fila · {r.favoritesCount} favoritos
                          {r.playingTrack ? ` · tocando: "${r.playingTrack}"` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Btn onClick={() => loadRoomDetail(r.id)}>Detalhes</Btn>
                        <Btn onClick={() => setEditRoom(r)} title="Editar rádio">
                          <Pencil size={15} />
                        </Btn>
                        <Btn variant="danger" title="Excluir sala" onClick={() =>
                          openConfirm(
                            'Excluir sala',
                            `Excluir "${r.name}" (${r.id})? Isso remove a sala, a fila e favoritos, e desconecta quem estiver dentro.`,
                            async () => {
                              await adminApi.deleteRoom(r.id);
                              setRooms((prev) => prev.filter((x) => x.id !== r.id));
                              if (selectedRoomId === r.id) setRoomDetail(null);
                              showToast('Sala excluída.');
                            }
                          )
                        }>
                          <Trash2 size={15} />
                        </Btn>
                      </div>
                    </div>
                  </div>
                ))}
                {rooms.length === 0 && <p className="text-sm text-gray-500">Nenhuma sala no banco.</p>}
              </div>
            </Card>

            <Card
              title={roomDetail ? `Sala: ${roomDetail.name}` : 'Detalhes da sala'}
              subtitle={
                roomDetail
                  ? `${roomDetail.codigo_convite} · ${roomDetail.users.length} ouvindo · radialista: ${
                      roomDetail.users.find((u) => u.id === roomDetail.radialista_id)?.name || roomDetail.radialista_id || '—'
                    }`
                  : 'Selecione uma sala na lista acima para ver fila, histórico e chat.'
              }
            >
              {roomDetail ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-400 mb-2">Fila</h4>
                    <div className="max-h-72 overflow-y-auto">
                      {roomDetail.queue.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-white/5 text-sm">
                          <span className="text-xs text-[#1db954] font-mono">{t.youtube_video_id}</span>
                          <span className="truncate flex-1 text-gray-300">{t.titulo}</span>
                          <Btn
                            variant="danger"
                            title="Remover da fila"
                            onClick={() =>
                              openConfirm('Remover música da fila', `Remover "${t.titulo}" da fila?`, async () => {
                                await adminApi.removeTrackFromRoom(roomDetail.id, t.id);
                                await loadRoomDetail(roomDetail.id);
                                showToast('Música removida da fila.');
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </Btn>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      {addTrackRoomId === roomDetail.id ? (
                        <>
                          <input
                            value={addTrackYoutubeId}
                            onChange={(e) => setAddTrackYoutubeId(e.target.value)}
                            placeholder="ID do YouTube (ex: dQw4w9WgXcQ)"
                            className="flex-1 bg-[#282828] text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954] font-mono"
                          />
                          <Btn
                            variant="primary"
                            onClick={() =>
                              run(async () => {
                                if (!addTrackYoutubeId.trim()) return;
                                await adminApi.addTrackToRoom(roomDetail.id, addTrackYoutubeId.trim());
                                setAddTrackYoutubeId('');
                                setAddTrackRoomId(null);
                                await loadRoomDetail(roomDetail.id);
                                showToast('Música adicionada à fila.');
                              })
                            }
                          >
                            <Plus size={15} /> Adicionar
                          </Btn>
                          <Btn onClick={() => setAddTrackRoomId(null)}>
                            <X size={15} />
                          </Btn>
                        </>
                      ) : (
                        <Btn variant="primary" onClick={() => setAddTrackRoomId(roomDetail.id)}>
                          <Plus size={15} /> Adicionar música
                        </Btn>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-2">Histórico</h4>
                      <div className="max-h-72 overflow-y-auto">
                        {roomDetail.history.map((t) => (
                          <div key={t.id} className="py-1.5 border-b border-white/5 text-sm truncate text-gray-300">
                            {t.titulo}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-2">Chat (últimas)</h4>
                      <div className="max-h-72 overflow-y-auto">
                        {roomDetail.chat.map((m: any) => (
                          <div key={m.id} className="py-1.5 border-b border-white/5 text-sm">
                            <span className="text-[#1db954]">{m.user_name}:</span>{' '}
                            <span className="text-gray-300">{m.texto}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  {selectedRoomId ? 'Sala sem clientes conectados agora — detalhes em tempo real indisponíveis.' : 'Nenhuma sala selecionada.'}
                </p>
              )}
            </Card>

            <Card title="Ranking — mais adicionadas" subtitle="Faixas da biblioteca com mais referências em filas">
              <div className="max-h-80 overflow-y-auto">
                {[...library]
                  .sort((a, b) => b.references - a.references)
                  .filter((t) => t.references > 0)
                  .map((t, i) => (
                    <div key={t.youtube_id} className="flex items-center gap-3 py-1.5 border-b border-white/5 text-sm">
                      <span className="w-6 text-gray-500 text-xs">{i + 1}º</span>
                      <span className="truncate flex-1 text-gray-300">{t.titulo}</span>
                      <Badge color="green">{t.references}×</Badge>
                    </div>
                  ))}
              </div>
            </Card>
          </div>
        )}

        {tab === 'midias' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card title="Total em disco" subtitle="Soma de todos os arquivos">
                <Kpi big={fmtBytes(media?.totalBytes ?? 0)} sub={`${media?.count ?? 0} arquivos`} />
              </Card>
              <Card title="Órfãos" subtitle="Arquivos sem referência no banco">
                <Kpi big={fmtBytes(media?.orphanBytes ?? 0)} sub="candidatos a exclusão" />
              </Card>
              <Card title="Em uso" subtitle="Referenciados na biblioteca/filas">
                <Kpi big={fmtBytes((media?.totalBytes ?? 0) - (media?.orphanBytes ?? 0))} sub="não devem ser apagados" />
              </Card>
            </div>

            <Card title="Análise por formato" subtitle="Distribuição do espaço">
              <div className="space-y-2">
                {media?.storage.byFormat.map((f) => {
                  const pct = media.totalBytes ? (f.size / media.totalBytes) * 100 : 0;
                  return (
                    <div key={f.ext} className="flex items-center gap-3 text-sm">
                      <span className="w-20 text-gray-400 font-mono">{f.ext}</span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-[#1db954] rounded-full" style={{ width: `${Math.max(1, pct)}%` }} />
                      </div>
                      <span className="text-gray-400 w-28 text-right">{fmtBytes(f.size)}</span>
                      <span className="text-gray-600 w-16 text-right">{f.count} arq.</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card
              title="Arquivos na VM"
              subtitle="Lista de /downloads — clique no lixo para excluir"
              actions={
                <>
                  <Btn onClick={handlePruneLibrary}>
                    <Eraser size={15} /> Limpar faixas sem arquivo
                  </Btn>
                  <Btn onClick={loadMedia}>
                    <RefreshCw size={15} /> Atualizar
                  </Btn>
                </>
              }
            >
              <div className="max-h-96 overflow-y-auto">
                <div className="flex items-center gap-3 px-3 py-2 text-xs uppercase tracking-wider text-gray-500 font-medium border-b border-white/10">
                  <span className="flex-1">Arquivo</span>
                  <span className="w-16 text-right">Qual.</span>
                  <span className="w-24 text-right">Tamanho</span>
                  <span className="w-28 text-right">Modificado</span>
                  <span className="w-20 text-right">Status</span>
                  <span className="w-10" />
                </div>
                {media?.files.map((f) => (
                  <div key={f.name} className="flex items-center gap-3 px-3 py-2 border-b border-white/5 text-sm hover:bg-white/[0.02]">
                    <span className="flex-1 min-w-0">
                      {f.title && <span className="block truncate text-white">{f.title}</span>}
                      <span className={`block truncate font-mono text-xs ${f.title ? 'text-gray-500' : 'text-gray-300'}`}>{f.name}</span>
                    </span>
                    <span className="w-16 text-right text-gray-400 text-xs shrink-0">{f.quality ?? '—'}</span>
                    <span className="w-24 text-right text-gray-400 shrink-0">{fmtBytes(f.sizeBytes)}</span>
                    <span className="w-28 text-right text-gray-500 text-xs shrink-0">{fmtDate(f.mtime)}</span>
                    <span className="w-20 text-right shrink-0">
                      {f.inUse ? <Badge color="green">em uso</Badge> : <Badge color="red">órfão</Badge>}
                    </span>
                    <span className="w-10 text-right shrink-0">
                      <Btn
                        variant="danger"
                        title="Excluir arquivo"
                        onClick={() =>
                          openConfirm(
                            'Excluir arquivo',
                            `Apagar "${f.title || f.name}" do disco? Se for o último arquivo do vídeo, a faixa também sairá da biblioteca. Se estiver em uso, o player quebrará para quem estiver tocando.`,
                            async () => {
                              await adminApi.deleteMedia(f.name);
                              setMedia((prev) =>
                                prev
                                  ? { ...prev, files: prev.files.filter((x) => x.name !== f.name), count: prev.count - 1 }
                                  : prev
                              );
                              showToast('Arquivo excluído.');
                            }
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </Btn>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {tab === 'logs' && (
          <div className="space-y-4">
            <Card
              title="Logs da API"
              subtitle="Buffer em memória + arquivo persistente (DATA_DIR/admin.log)"
              actions={
                <>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Linhas</label>
                    <select
                      value={logLines}
                      onChange={(e) => setLogLines(Number(e.target.value))}
                      className="bg-[#282828] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none"
                    >
                      {[50, 100, 200, 500, 1000].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <select
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value as any)}
                      className="bg-[#282828] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none"
                    >
                      <option value="all">todos</option>
                      <option value="info">info</option>
                      <option value="warn">warn</option>
                      <option value="error">error</option>
                    </select>
                  </div>
                  <Btn onClick={loadLogs}>
                    <RefreshCw size={15} /> Atualizar
                  </Btn>
                  <Btn variant={autoRefresh ? 'primary' : 'ghost'} onClick={() => setAutoRefresh((v) => !v)}>
                    Auto {autoRefresh ? 'ON' : 'OFF'}
                  </Btn>
                </>
              }
            >
              <LogViewer logs={filteredLogs} />
            </Card>

            <Card
              title="Logs do extrator"
              subtitle="Tail via extrator (requer EXTRACTOR_ADMIN_TOKEN configurado)"
              actions={<Btn onClick={loadLogs}><RefreshCw size={15} /> Atualizar</Btn>}
            >
              <LogViewer logs={extractorLogs} />
            </Card>

            <Card title="Ferramentas" subtitle="Ações rápidas de operação">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-white/5 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">Testar extração (só metadados)</h4>
                  <div className="flex gap-2">
                    <input
                      value={extractTestUrl}
                      onChange={(e) => setExtractTestUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="flex-1 bg-[#282828] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954]"
                    />
                    <Btn
                      variant="primary"
                      disabled={!extractTestUrl.trim()}
                      onClick={() =>
                        run(async () => {
                          setExtractTestResult(null);
                          const r = await adminApi.extractorMeta(extractTestUrl.trim());
                          setExtractTestResult(r.body);
                        })
                      }
                    >
                      <Search size={15} /> Testar
                    </Btn>
                  </div>
                  {extractTestResult && (
                    <pre className="mt-3 text-xs text-gray-300 bg-black/40 rounded-lg p-3 overflow-auto max-h-40">
                      {JSON.stringify(extractTestResult, null, 2)}
                    </pre>
                  )}
                </div>

                <div className="border border-white/5 rounded-xl p-4 space-y-3">
                  <h4 className="text-sm font-medium text-gray-300">Manutenção</h4>
                  <div className="flex flex-wrap gap-2">
                    <Btn onClick={() => run(async () => { await downloadBackup(); showToast('Backup baixado.'); })}>
                      <Download size={15} /> Baixar backup rooms.json
                    </Btn>
                    <Btn onClick={() => run(async () => { const r = await adminApi.refresh(); showToast(`Recarregadas ${r.rooms} salas do Supabase.`); loadRooms(); })}>
                      <RefreshCw size={15} /> Recarregar salas do Supabase
                    </Btn>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn onClick={() => run(async () => { const ex = await adminApi.extractorHealth(); showToast(`Extrator: HTTP ${ex.status}`); })}>
                      Ping extrator
                    </Btn>
                    <Btn onClick={() => setPushModal(true)}>
                      <Send size={15} /> Enviar push de teste
                    </Btn>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>

      {/* Modais */}
      <ConfirmModal
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) {
            await run(confirm.action);
            setConfirm(null);
          }
        }}
      />

      {editTrack && (
        <EditTrackModal
          track={editTrack}
          onClose={() => setEditTrack(null)}
          onSaved={async () => {
            setLibrary((await adminApi.library(libQ)).tracks);
          }}
          run={run}
          showToast={showToast}
        />
      )}

      {editRoom && (
        <EditRoomModal
          room={editRoom}
          onClose={() => setEditRoom(null)}
          onSaved={async (id) => {
            await loadRooms();
            if (selectedRoomId === id) await loadRoomDetail(id);
          }}
          run={run}
          showToast={showToast}
        />
      )}

      {pushModal && (
        <PushTestModal
          onClose={() => setPushModal(false)}
          run={run}
          showToast={showToast}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#1db954] text-black font-medium rounded-lg px-4 py-2 shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

function Kpi({ big, sub }: { big: string; sub: string }) {
  return (
    <div>
      <p className="text-3xl font-bold text-white">{big}</p>
      <p className="text-sm text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function ServiceRow({ name, ok, detail }: { name: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className={`w-2.5 h-2.5 rounded-full ${
          ok === null ? 'bg-gray-500 animate-pulse' : ok ? 'bg-[#1db954]' : 'bg-red-500'
        }`}
      />
      <span className="font-medium text-gray-200">{name}</span>
      <span className="ml-auto text-xs text-gray-500 truncate max-w-[220px]">{detail}</span>
    </div>
  );
}

function VmInfo({ vm }: { vm?: Overview['vm'] }) {
  if (!vm) return <p className="text-sm text-gray-500">Carregando...</p>;
  const memTotal = vm.memTotal || 0;
  const memFree = vm.memFree || 0;
  const memUsed = memTotal - memFree;
  const memPct = memTotal ? (memUsed / memTotal) * 100 : 0;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between">
        <span className="text-gray-400">Processo API ativo há</span>
        <span className="text-gray-200">{fmtDur(vm.processUptimeSec)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">Node</span>
        <span className="text-gray-200">{vm.nodeVersion}</span>
      </div>
      {vm.uptimeSec != null && (
        <div className="flex justify-between">
          <span className="text-gray-400">Uptime da VM</span>
          <span className="text-gray-200">{fmtDur(vm.uptimeSec)}</span>
        </div>
      )}
      {vm.loadAvg && (
        <div className="flex justify-between">
          <span className="text-gray-400">Load average</span>
          <span className="text-gray-200">{vm.loadAvg.map((n) => n.toFixed(2)).join(' / ')}</span>
        </div>
      )}
      {memTotal > 0 && (
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">Memória</span>
            <span className="text-gray-200">{fmtBytes(memUsed)} / {fmtBytes(memTotal)}</span>
          </div>
          <Bar pct={memPct} />
        </div>
      )}
      {vm.disk.map((d) => (
        <div key={d.mount}>
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">{d.mount}</span>
            <span className="text-gray-200">{fmtBytes(d.used)} / {fmtBytes(d.total)}</span>
          </div>
          <Bar pct={d.usePct} />
        </div>
      ))}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-yellow-500' : 'bg-[#1db954]'}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function LogViewer({ logs }: { logs: LogEntry[] }) {
  return (
    <div className="bg-black/60 rounded-lg p-3 font-mono text-xs max-h-[420px] overflow-y-auto">
      {logs.map((l, i) => (
        <div key={i} className="py-0.5 whitespace-pre-wrap break-all">
          <span className="text-gray-600">{fmtDate(l.ts)}</span>{' '}
          <span
            className={
              l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-gray-300'
            }
          >
            [{l.level.toUpperCase()}]
          </span>{' '}
          <span className={l.level === 'error' ? 'text-red-300' : 'text-gray-400'}>{l.msg}</span>
        </div>
      ))}
      {logs.length === 0 && <p className="text-gray-600">Sem logs.</p>}
    </div>
  );
}

function eventLabel(type: string): string {
  const map: Record<string, string> = {
    admin_login: 'Login admin',
    admin_login_failed: 'Login admin falhou',
    admin_action: 'Ação admin',
    user_join: 'Usuário entrou',
    user_leave: 'Usuário saiu',
    track_added: 'Música adicionada',
    chat_message: 'Mensagem no chat',
  };
  return map[type] || type;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Modal de edição de faixa
function EditTrackModal({
  track,
  onClose,
  onSaved,
  run,
  showToast,
}: {
  track: LibraryTrack;
  onClose: () => void;
  onSaved: () => Promise<void>;
  run: (fn: () => Promise<void>) => Promise<void>;
  showToast: (msg: string) => void;
}) {
  const [titulo, setTitulo] = useState(track.titulo);
  const [duracao, setDuracao] = useState(String(track.duracao_seg || ''));
  return (
    <ModalShell title="Editar faixa" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Título</label>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            className="w-full bg-[#282828] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Duração (segundos)</label>
          <input
            value={duracao}
            onChange={(e) => setDuracao(e.target.value)}
            inputMode="numeric"
            className="w-full bg-[#282828] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954]"
          />
        </div>
        <p className="text-xs text-gray-600">YouTube ID: {track.youtube_id}</p>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn
            variant="primary"
            onClick={() =>
              run(async () => {
                await adminApi.updateTrack(track.youtube_id, {
                  titulo: titulo.trim() || undefined,
                  duracao_seg: duracao ? Number(duracao) : undefined,
                });
                await onSaved();
                onClose();
                showToast('Faixa atualizada.');
              })
            }
          >
            Salvar
          </Btn>
        </div>
      </div>
    </ModalShell>
  );
}

// Modal de edição de rádio
function EditRoomModal({
  room,
  onClose,
  onSaved,
  run,
  showToast,
}: {
  room: AdminRoom;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  run: (fn: () => Promise<void>) => Promise<void>;
  showToast: (msg: string) => void;
}) {
  const [name, setName] = useState(room.name);
  const [code, setCode] = useState(room.codigo_convite);
  return (
    <ModalShell title="Editar rádio" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-[#282828] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Código de convite</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="w-full bg-[#282828] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954] font-mono"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn
            variant="primary"
            onClick={() =>
              run(async () => {
                await adminApi.updateRoom(room.id, {
                  name: name.trim() || undefined,
                  codigo_convite: code.trim() || undefined,
                });
                await onSaved(room.id);
                onClose();
                showToast('Rádio atualizada.');
              })
            }
          >
            Salvar
          </Btn>
        </div>
      </div>
    </ModalShell>
  );
}

// Modal de push de teste
function PushTestModal({
  onClose,
  run,
  showToast,
}: {
  onClose: () => void;
  run: (fn: () => Promise<void>) => Promise<void>;
  showToast: (msg: string) => void;
}) {
  const [title, setTitle] = useState('Notificação de teste');
  const [body, setBody] = useState('Central de admin');
  return (
    <ModalShell title="Enviar push de teste" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-[#282828] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Mensagem</label>
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full bg-[#282828] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1db954]"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn
            variant="primary"
            onClick={() =>
              run(async () => {
                const r = await adminApi.sendTestPush(title, body);
                onClose();
                showToast(`Push enviado para ${r.sent} dispositivo(s).`);
              })
            }
          >
            <Send size={15} /> Enviar
          </Btn>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-[#1f1f1f] border border-white/10 rounded-2xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
