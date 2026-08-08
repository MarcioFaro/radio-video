# Plano de Implementação — Rádio Digital Colaborativa (PWA)

> Documento de planejamento para implementação futura. Decisões alinhadas com o dono do projeto em 08/08/2026. **Revisão v2 (mesma data):** adiciona sincronização de reprodução ao vivo, papel de radialista dinâmico e chat de sala — ver seção 0.1. **Revisão v3 (mesma data):** inverte a ordem de construção — frontend completo (todas as telas, com máscara funcional em cima de dados fixture) primeiro e aprovado, integração real depois — ver seção 0.2.

## 0. Mudanças de decisão vs spec original

| Ponto | Spec original | Novo plano | Motivo |
|---|---|---|---|
| Plataforma | React Native + Expo | **PWA (React + Vite + TS)** | Grátis, sem loja, sem conta Apple, instala no celular via navegador |
| Player background | react-native-track-player | **Media Session API** (audio element) | Equivalente web: controles na lock screen, tela apagada |
| Push | (não existia) | **Web Push + VAPID** | Firebase FCM Web não suporta Safari iOS; Web Push é universal |
| Distribuição | EAS Build (APK/IPA) | **Hospedagem web + "Adicionar à tela de início"** | Zero custo, sem assinatura |
| Backend | Supabase Edge/Node | **Supabase cloud + backend Fastify na VM do dono** | VM já existe; Supabase cobre banco/auth/realtime |

> **Nota sobre Firebase:** a escolha inicial `@react-native-firebase/messaging` não existe para web. Para PWA, o caminho correto (aprovado) é Web Push + VAPID via `web-push` no backend. Firebase pode entrar depois, opcionalmente, para Analytics/Crashlytics web — não é necessário no MVP.

> **Sobre a VM:** o serviço de extração ocupa ~200–400 MB e **não guarda mídia**. VM atual (1 vCPU / 1 GB / 20 GB) comporta extrator + backend + PWA estática.

## 0.1. Mudanças de decisão v2 (08/08/2026)

| Ponto | v1 (plano original) | v2 (revisado) | Motivo |
|---|---|---|---|
| Reprodução | Fila compartilhada, cada app toca por conta própria | **Sincronizada** — todos presentes ouvem o mesmo timestamp | Valor real do produto é "entrar na sala e ouvir junto", não só ver a mesma fila |
| Controle de playback | Qualquer membro (implícito) | **Radialista dinâmico** — quem está presente há mais tempo controla; perde antiguidade ao sair e reentrar | Evita comandos concorrentes de play/pause/skip; papel simples de calcular a partir da presença |
| Comunicação na sala | Não existia (fora do MVP) | **Chat de texto** | Pedido explícito do dono do projeto; reaproveita infraestrutura realtime já planejada |
| Entrada na sala | — | **Direta, sem aprovação** — quem tem o código/link entra na hora | Controle de acesso é só posse do código, sem fricção de aprovação manual |
| Telas | Implícitas no texto | **Explicitadas**: Login, Minhas Rádios, Sala, Adicionar Música | Clareza de escopo de UI antes de começar a implementação |
| VM ligada 24/7 | Assumido necessário | **Mantido ligado** (desligar/religar sob demanda não compensa: VM já é custo zero, e o novo relógio de sincronização por sala já liga/desliga sozinho *dentro* do processo, via presença) | Ver discussão de arquitetura — desligar a VM inteira adicionaria complexidade de cold-start sem economia real |

> Impacto no cronograma: estimativa total sobe de ~4-6 semanas para **~10-14 semanas** (seção 6). O item de maior risco técnico novo é a sincronização ao vivo (Fase 6) — mais arriscado até que a extração do YouTube.

## 0.2. Mudanças de decisão v3 (08/08/2026) — ordem de construção

| Ponto | v2 | v3 (revisado) | Motivo |
|---|---|---|---|
| Ordem das fases | Extração → Backend → Telas → Player → Presença → Sync → Chat → Push → Melhorias → Deploy | **Frontend completo (todas as telas, aprovado e documentado) primeiro; construção real (extração, backend, sync) depois** | Reduz risco de retrabalho de UI; dá algo concreto pra aprovar com os amigos cedo, sem depender do backend mais arriscado estar pronto |
| Natureza do protótipo | — | **Estático por estado, mas com máscara funcional**: sem eventos automáticos passando o tempo sozinhos, mas toda ação do usuário (play, adicionar música, mandar mensagem, entrar na sala) reage de verdade contra uma camada de dados fixture em memória | Dá a sensação real de uso sem exigir extração/backend/sync prontos; evita "protótipo de imagem" que não serve pra validar interação |
| Camada de dados | Chamadas ao Supabase espalhadas nos componentes | **Isolada por recurso** (`app/src/data/{rooms,queue,playback,presence,chat}.ts`), fixture agora, real depois — mesma assinatura | Troca de fixture pra dado real nas fases de integração sem tocar a UI já aprovada |
| Tela Sala (sync/radialista/chat) | Definida junto com a lógica real | **Aprovada como provisória** — documentada como sujeita a revisão depois que a Fase 6 (sync real) validar o comportamento de verdade | A UX de deriva/buffering/handoff só se confirma com sync real rodando; não faz sentido travar a aprovação nisso |
| VM/domínio/nginx | Provisionados na Fase 0 | **Adiados para a Fase 3** (Backend API) | Frontend (Fase 1) e extração local (Fase 2) não precisam de servidor público ainda |

> A reordenação não muda o escopo nem a estimativa total (~10-14 semanas) — ver seção 6 para as fases detalhadas na nova ordem.

## 1. Arquitetura revisada

```
[PWA (React + Vite)] <──REST/Realtime──> [Supabase cloud: Postgres + Auth + Realtime]
      │                                        │
      │ GET /extract?url=...                   │ users, rooms, tracks, queue,
      │ (Bearer JWT)                           │ playback_state, push_subscriptions
      ▼                                        ▼
[Backend Fastify (sua VM)] ──▶ [Extrator Python (yt-dlp + PoToken)] ──▶ YouTube
      │
      └── Web Push (VAPID) ──▶ notificações para assinantes (service worker)
```

- O PWA fala **direto com o Supabase** para auth/dados/realtime (padrão nativo).
- O backend da VM faz 3 coisas agora: **extração**, **envio de push** e **arbitragem de reprodução ao vivo** (relógio autoritativo por sala ativa — ver seção 6, Fase 6).
- O app toca a URL direta do stream num `<audio>`/`<video>` — sem player do YouTube, sem anúncio.

> **Nota (revisão v2, 08/08/2026):** o escopo cresceu para incluir sincronização real de playback entre membros presentes, um papel dinâmico de "radialista" e chat de sala. Isso muda o backend de "camada fina" para um serviço com estado por sala ativa — ver seção 6 (Fases 5-7) para o desenho completo. `spec-radio-colaborativa.md` seção 9 tem o resumo da decisão de produto.

## 2. Stack revisada

| Camada | Ferramenta | Observação |
|---|---|---|
| Frontend PWA | React 18 + Vite + TypeScript + Tailwind | SPA, mobile-first, dark theme |
| Rotas/estado | react-router + zustand (ou React Query) | zustand p/ player state |
| Banco/Auth/Realtime | Supabase JS client (cloud free) | Magic link + convite por código |
| Backend | Node 20 + Fastify + pino | VM, pm2 ou systemd |
| Extração | Python + FastAPI + `yt-dlp` + `bgutil-ytdlp-pot-provider` | Microserviço na porta 8000 |
| Push | `web-push` (VAPID) + Service Worker | Todo navegador moderno |
| Deploy | nginx + certbot (Let's Encrypt) na VM | Serve PWA estática + proxy API/extrator |
| Domain | Domínio barato (ex.: ~US$1–10/ano) | Obrigatório para PWA + push (precisa HTTPS) |

## 3. Modelo de dados

```
users
  id, nome, avatar_url, criado_em

rooms
  id, nome, owner_id, codigo_convite (unique), criado_em

room_members
  room_id, user_id, papel (owner | membro)

tracks
  id, room_id, youtube_video_id, titulo, thumbnail_url,
  duracao_seg, adicionado_por, adicionado_em

queue
  room_id, track_id, posicao

playback_state
  room_id, current_track_id, posicao_seg, status (playing|paused),
  radialista_user_id,         -- NOVO: quem controla agora
  server_started_at,          -- NOVO: referência de tempo p/ calcular deriva
  atualizado_em

push_subscriptions
  id, user_id, endpoint (unique), p256dh, auth, user_agent, criado_em

room_sessions                 -- NOVO: presença espelhada no backend (fonte de verdade p/ radialista)
  room_id, user_id, entrou_em, ultimo_heartbeat

messages                      -- NOVO: chat da sala
  id, room_id, user_id, texto, criado_em
```

Eventos realtime (canal por `room_id`): `track_added`, `track_removed`, `queue_reordered`, `playback_play`, `playback_pause`, `now_playing_changed`, `radialista_changed`, `message_added`.

**Por que `room_sessions` além do Presence do Supabase?** O Presence do Supabase Realtime é client-driven e efêmero (vive na memória do serviço realtime, um cliente mal-intencionado poderia forjar seu próprio `joined_at`). Como o radialista tem poder real (controla o que todo mundo ouve), o backend precisa ser a fonte de verdade: ele também assina o canal de presence de cada sala ativa (via service key) e espelha entradas/saídas em `room_sessions`, com heartbeat curto (ex.: 15s). O radialista é sempre `MIN(entrou_em)` entre as sessões com heartbeat recente — decidido no backend, nunca confiado do cliente.

## 4. Web Push — fluxo implementado

1. SW `sw.js` registrado; permissão pedida de forma contextual (ao entrar na sala).
2. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <chave pública VAPID> })` → subscription salva em `push_subscriptions`.
3. Eventos disparam envio pelo backend: `track_added` (avisa os demais membros), convite aceito, (opcional) `now_playing_changed`.
4. SW recebe `push` → `showNotification()`; `notificationclick` → abre o deep link da sala.
5. `410 Gone`/permissão revogada → remove subscription obsoleta.

## 5. Melhorias que agregam valor (priorizadas)

> **Nota (revisão v2):** sincronização ao vivo, radialista e presença deixaram de ser "melhorias" — viraram core do MVP (seção 6, Fases 5-6). Chat também virou core (Fase 7). Não aparecem mais nesta lista porque já estão no corpo do plano, não como extra.

**Alta prioridade (incluídas no plano):**
1. **Web Push** (track adicionada, convites, mensagens de chat) — coesão do grupo.
2. **Deep links de convite** (`/join?code=XYZ`) — convidar é só mandar o link.
3. **Auto-avanço + re-resolve de stream expirada** — música nunca "morre" no meio.
4. **Metadados via yt-dlp/oEmbed** — sem chave de YouTube Data API.
5. **Fallback de extração (Piped)** — resiliência *best-effort* quando yt-dlp quebrar (instâncias públicas do Piped também caem e mudam de disponibilidade com frequência — não é uma garantia, é uma tentativa a mais).

**Média prioridade (v1.1):**
6. Sleep timer · 7. Histórico/recentes · 8. Reordenar músicas na fila · 9. Sentry (free) para erros · 10. Settings por sala (toggles de notificação, inclusive de chat).

**Stretch (fora do MVP):**
- Votação de próxima música, Chromecast, reações no chat.

## 6. Plano de execução granular

> Estimativa total: **~10–14 semanas** (dedicando meio período) — permanece na mesma faixa da v2; a v3 reordena as fases (frontend completo antes da integração real), não muda o escopo total. Entre parênteses: dias de trabalho.

### Fase 0 — Fundação mínima (1 dia)
- [ ] `git init` monorepo: `app/` (PWA), `api/` (Fastify), `extractor/` (Python), `docs/`
- [ ] Criar projeto Supabase (cloud free), anotar URL + anon/service keys
- [ ] Configurar Supabase Auth (magic link) — é a única peça de backend que a Fase 1 precisa de verdade
- **Nota (v3):** VM, domínio, nginx, certbot, pm2 e healthcheck externo passam para a Fase 3 (Backend API) — não bloqueiam o frontend, que não precisa de servidor próprio até a integração real.

### Fase 0.5 — Spike: background audio no iOS (1 dia, CRÍTICO)
> Maior risco técnico do projeto depois da extração — vale validar antes de construir tudo em cima. Independente do trabalho visual da Fase 1, roda em paralelo ou logo antes dela.
- [ ] Página estática mínima: `<audio>` + Media Session API + Service Worker registrado
- [ ] Instalar na tela de início de um iPhone real (Safari), testar: tela apagada mantém áudio tocando? controles aparecem na lock screen? sobrevive a alguns minutos em background?
- [ ] Repetir teste rápido no Android Chrome (menor risco, mas confirmar)
- **Gate:** se falhar de forma feia no iOS, reavaliar antes de seguir (aceitar iOS como "best effort" documentado, ou reconsiderar abordagem pro background).

### Fase 1 — Frontend completo: protótipo com máscara funcional + docs (7–10 dias, NOVA POSIÇÃO v3)
> Absorve as telas (antiga Fase 3), a casca do player/Media Session (antiga Fase 4), a UI de presença/radialista (antiga Fase 5) e de chat (antiga Fase 7), e o polish visual (antiga Fase 9) — tudo construído contra uma camada de dados fixture, **antes** de qualquer integração real. Cada interação do usuário funciona de verdade (muda estado em memória) — não é um mockup estático de imagem, só não há eventos automáticos passando o tempo sozinhos.
- [ ] Camada de dados isolada por recurso em `app/src/data/` (`rooms.ts`, `queue.ts`, `playback.ts`, `presence.ts`, `chat.ts`) — cada módulo com a assinatura final que será usada com Supabase/backend depois, implementada por enquanto com estado local em memória (a "máscara/fachada")
- [ ] Scaffold Vite + React + TS + Tailwind; rotas: `/` (Login), `/rooms` (Minhas Rádios), `/room/:id` (Sala), `/join?code=`
- [ ] **Tela Login** — magic link real via Supabase Auth (já funcional, não depende do backend Fastify nem do extrator)
- [ ] **Tela Minhas Rádios** — listar salas, criar rádio nova, entrar por código/link (entrada imediata, sem aprovação) — via `data/rooms.ts`; criar/entrar realmente altera a lista em memória
- [ ] **Tela Sala** — fila (`data/queue.ts`), player (casca com Media Session ligada a um áudio de teste local; play/pause/skip realmente mudam o estado visual), lista de presença + tag de radialista (`data/presence.ts`, com um seletor dev pra simular troca de radialista e validar a UI), indicador "sincronizando..." como estado visual
- [ ] **Tela/modal Adicionar Música** — colar URL, preview fake de thumbnail/título/duração, confirmar → realmente aparece na fila em memória
- [ ] **Chat da sala** — lista de mensagens + input; enviar realmente aparece na lista (`data/chat.ts`)
- [ ] PWA shell: `manifest.webmanifest` (ícones 192/512 + maskable), SW registrado, `display: standalone`, `theme_color`, prompt de instalação Android + banner iOS
- [ ] Polish: empty states, loading states, error states, skeletons, dark theme final, transições
- [ ] `docs/telas.md`: para cada tela, o que faz, quais estados existem, e pra cada interação se é fachada funcional (mexe no estado local) ou só visual — marcando os estados de sincronização/radialista/chat da Sala como **provisórios, sujeitos a revisão nas Fases 6-7**
- **Gate:** dono do projeto e amigos revisam e aprovam todas as telas + `docs/telas.md` antes de seguir pra construção real.

### Fase 2 — Extração funcionando (CRÍTICO, 2–3 dias)
> Desenvolvimento local (sem depender da VM ainda).
- [x] `extractor/`: FastAPI + uvicorn; venv com `yt-dlp` e `bgutil-ytdlp-pot-provider`
- [x] Validar no CLI: `yt-dlp -f "ba*" --extractor-args "youtube:player_client=ios,tv" <url>` com PoToken ativo — **obs.: clientes `web`/`web_embedded` retornam formats DRM-only e quebram a seleção; usar cliente padrão (android_vr) ou `tv_embedded` + PoToken**
- [x] Validar **extração de áudio e vídeo**: itag 140 (m4a) / 251 (opus) p/ áudio; 137/299 p/ vídeo (ok também 313/2160p)
- [x] Endpoint `POST /extract {url}` → valida ID do YouTube → resolve → retorna `{id, titulo, duracao_seg, thumbnail_url, audio_url, video_url}`
- [x] Cache curto em memória por video_id (TTL 10 min) — URLs expiram
- [x] Tratamento de erros estruturado: vídeo privado, bloqueio regional, age-gate, "Sign in to confirm you're not a bot", 429
- [x] **Fallback Piped API** quando yt-dlp falhar
- [x] Teste de fumaça: 20 vídeos variados, medir latência (1ª resolução ~3–8s, seguintes rápidas) e taxa de sucesso (>80%)
- **Gate:** extração estável ≥ 80% antes de seguir. ✅ **APROVADO** — 18/20 = 90% (média 1.3s), `extractor/smoke_test.py` reproduzível via `docker exec radio-extractor python smoke_test.py`

### Fase 3 — Backend API + infraestrutura (5–7 dias)
> Absorve a infraestrutura da antiga Fase 0 (VM, domínio, nginx) que não era necessária antes desta fase.
- [ ] VM: criar usuário, instalar Node 20, Python 3.11, `uv`, nginx, certbot; configurar SSH
- [ ] Comprar/apontar domínio → DNS A para o IP da VM
- [ ] nginx: certificado Let's Encrypt, página "em manutenção"
- [ ] Decidir gerenciador de processos: **pm2** (mais simples) — instalar
- [ ] Healthcheck externo simples (ex.: UptimeRobot free) apontando pro `/health`
- [ ] `api/`: Fastify + pino + cors (allowlist do domínio) + dotenv
- [ ] Guarda de autenticação: validar Bearer JWT do Supabase em todas as rotas
- [ ] `POST /extract` (proxy p/ extrator) com rate limit por usuário/IP (ex.: 30/min)
- [ ] `GET /health`
- [ ] Módulo push: `web-push`, VAPID privado em env; `sendToRoom(roomId, payload)` → busca subs dos membros → `sendAll`, remove endpoints com erro 410
- [ ] Endpoints auxiliares: `POST /push/unsubscribe` (limpeza ao sair/revogar)
- [ ] Cron diário: limpar `push_subscriptions` órfãs
- [ ] Testes com curl/Postman + push para subscription de teste
- **Gate:** extração + push funcionando via API com JWT, extrator e backend rodando na VM atrás do domínio real.

### Fase 4 — Integração de dados reais + background play real (3–5 dias, NOVO v3)
> Troca as fixtures da Fase 1 por dados reais, sem tocar na UI já aprovada.
- [ ] `data/rooms.ts` e `data/queue.ts` → chamadas reais ao Supabase (`rooms`, `room_members`, `tracks`, `queue`)
- [ ] Tela Adicionar Música passa a chamar `/extract` de verdade (backend real da Fase 3)
- [ ] Realtime `postgres_changes` → fila atualiza ao vivo entre dispositivos (testar com 2 navegadores)
- [ ] Player passa a tocar `audio_url`/`video_url` reais (não mais o áudio de teste da Fase 1)
- [ ] `visibilitychange`: ao minimizar → troca p/ stream de áudio real — revalida o resultado da Fase 0.5 agora com stream de verdade, não arquivo de teste
- [ ] Tratamento de URL expirada: erro de rede/HTTP 403 no media → re-resolve via `/extract` e retoma
- [ ] iOS: confirmar 1º play por gesto do usuário com stream real; revisar onboarding
- **Gate:** login + sala + fila sincronizada entre 2 dispositivos, música tocando de verdade, background play confirmado nos 2 SOs com stream real.

### Fase 5 — Presença + radialista dinâmico: lógica real (2–4 dias)
> UI já existe e já foi aprovada na Fase 1 — aqui entra a lógica de verdade por trás.
- [ ] `data/presence.ts` → canal de Presence real do Supabase por `room_id`
- [ ] Backend também assina o canal de presence (service key) e espelha em `room_sessions` (entrou_em, ultimo_heartbeat)
- [ ] Heartbeat curto (ex.: 15s) do cliente; timeout (ex.: 45s sem heartbeat) → remove sessão, recalcula radialista
- [ ] Lógica: radialista = `MIN(entrou_em)` entre sessões ativas da sala; recalcular em toda entrada/saída/timeout
- [ ] Evento `radialista_changed` broadcast real pro canal da sala — remove o seletor dev de simulação da Fase 1
- **Gate:** dois navegadores mostram o mesmo radialista de verdade; fechar a aba do radialista transfere o papel em poucos segundos.

### Fase 6 — Sincronização ao vivo: lógica real (5–8 dias, CRÍTICO)
- [ ] `playback_state` ganha `server_started_at`; backend calcula posição esperada = `now() - server_started_at`
- [ ] Endpoint de sincronização de relógio (`GET /time`) — cliente mede offset local↔servidor (round-trip simples, tipo NTP simplificado)
- [ ] Comandos de transporte (`play`, `pause`, `skip`, `seek`) só aceitos do `radialista_user_id` atual — validado no backend, nunca confiado do cliente
- [ ] Cliente corrige deriva real: compara `audio.currentTime` esperado vs. real a cada poucos segundos; seek se desvio > limiar (~1-2s)
- [ ] Entrada no meio da faixa: buffer + seek real pro ponto certo — aqui o estado "sincronizando..." da Fase 1 (até então só visual) passa a refletir tempo real de buffer
- [ ] Backend avança a fila sozinho quando a faixa termina (baseado em `duracao_seg`), independente de qualquer cliente estar aberto; broadcast `now_playing_changed`
- [ ] Reconexão após queda: cliente sempre pula pro ponto atual (não tenta retomar de onde parou)
- [ ] Teste com 3+ dispositivos em redes diferentes (wifi + 4G) medindo desvio real
- [ ] Revisar `docs/telas.md`: atualizar os estados da Sala marcados como "provisórios" com o comportamento real validado aqui
- **Gate:** 3 dispositivos ouvindo a mesma faixa com desvio perceptível < 2s; troca de radialista não trava a sala.

### Fase 7 — Chat da sala: lógica real (2–3 dias)
- [ ] Tabela `messages`; `data/chat.ts` → insert/realtime reais via Supabase client (RLS: só membros da sala)
- [ ] Realtime `postgres_changes` em `messages` → lista atualiza ao vivo de verdade
- [ ] (Opcional) Push de nova mensagem quando o app está em background — reaproveita módulo de push da Fase 3
- **Gate:** mensagem enviada por um membro aparece em tempo real pros demais, de verdade.

### Fase 8 — Push notifications (2–4 dias)
- [ ] Gerar VAPID keys (`npx web-push generate-vapid-keys`); pública no app, privada na VM
- [ ] SW: handlers `push` (notificação com ícone + deep link) e `notificationclick` (foca/abre a sala)
- [ ] Fluxo de permissão contextual: botão "Receber notificações" na sala → subscribe → gravar em `push_subscriptions`
- [ ] Backend: notificar demais membros em `track_added`; notificar convidado em convite
- [ ] Limpeza: permissão revogada → unsubscribe endpoint
- [ ] Matriz de teste: Chrome Android, Chrome desktop, Firefox, Edge, Safari iOS (instalado)
- **Gate:** push recebido nos 5 alvos e deep link abre a sala correta.

### Fase 9 — Deploy final + hardening + polish restante (5–7 dias)
> Absorve o que sobrava das antigas Fases 9 e 10 que dependia de dados reais.
- [ ] Sleep timer (15/30/60 min)
- [ ] Histórico / recentes na sala
- [ ] Reordenar/remover músicas da fila
- [ ] Sentry web (free) para erros + endpoint de log no VM
- [ ] Settings por sala: toggles de notificação
- [ ] nginx final: serve build estática + reverse proxy `/api` (Fastify) e `/extractor`; headers de segurança + CSP
- [ ] Revisar RLS do Supabase: membros leem a sala, dono administra; **service key nunca no PWA**
- [ ] Rate limiting global, CORS restrito, `robots.txt` (bloquear indexação)
- [ ] Backups (Supabase free tem daily) + revisão do healthcheck já configurado na Fase 3
- [ ] Runbook em `docs/`: como atualizar yt-dlp, reiniciar pm2, falhas comuns e respostas
- [ ] Onboarding dos amigos: instruções de instalação PWA, permissão de notificação, convites por link
- **Gate:** app publicamente acessível (pro grupo fechado) via domínio próprio, com todas as fases anteriores validadas em conjunto.

## 7. Custos estimados

| Item | Custo |
|---|---|
| Supabase cloud free | US$ 0 |
| VM que já existe | US$ 0 (adicional) |
| Domínio | ~US$ 1–10/ano |
| Push/VAPID | US$ 0 |
| Sentry free | US$ 0 |
| **Total** | **~US$ 1–10/ano** |

## 8. Riscos atualizados (mais importantes primeiro)

1. **Background audio no iOS não sustenta de forma confiável** — maior risco do projeto depois da extração; validado cedo via spike (Fase 0.5), antes de investir no resto da stack.
2. **yt-dlp quebra com mudanças do YouTube** — mitigado com fallback Piped (best-effort) + runbook de atualização + testar na Fase 2 antes de integrar ao resto.
3. **Deriva de clock / dessincronização perceptível entre dispositivos** — mitigado com relógio autoritativo no backend (`server_started_at`), correção periódica de deriva no cliente e re-sync forçado ao reconectar (Fase 6).
4. **Corrida no handoff do radialista** — dois clientes se acharem "no controle" ao mesmo tempo; mitigado validando no backend, a cada comando, se o remetente é o `radialista_user_id` atual (nunca confiar no cliente).
5. **Radialista fantasma** (queda de conexão sem saída explícita) — mitigado com heartbeat curto (15s) e timeout (45s) que força recálculo do radialista (Fase 5).
6. **Caveats de iOS**: Media Session/background exigem PWA instalado e 1º play com gesto — mitigado com UX de onboarding.
7. **Autoplay policy** (Chrome bloqueia autoplay com som) — mitigado pelo primeiro play sempre ser por gesto do usuário.
8. **URLs de stream expiram** — re-resolve transparente implementado.
9. **ToS do YouTube** — uso pessoal de grupo fechado, sem loja, sem monetização (tolerado na prática; nunca distribuir publicamente).
10. **Endpoints de push mudam** — cleanup de subs obsoletas no envio.
11. **VM sem monitoramento** — mitigado com healthcheck externo configurado já na Fase 3 (quando a VM entra em cena), não deixado pro fim.
