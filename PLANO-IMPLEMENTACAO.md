# Plano de Implementação — Rádio Digital Colaborativa (PWA)

> Documento de planejamento para implementação futura. Decisões alinhadas com o dono do projeto em 08/08/2026. **Revisão v2 (mesma data):** adiciona sincronização de reprodução ao vivo, papel de radialista dinâmico e chat de sala — ver seção 0.1. **Revisão v3 (mesma data):** inverte a ordem de construção — frontend completo (todas as telas, com máscara funcional em cima de dados fixture) primeiro e aprovado, integração real depois — ver seção 0.2. **Revisão v4 (09/08/2026):** app já está em produção (`comunaradio.duckdns.org`) com dados reais — Fases 2 a 8 substancialmente concluídas. Sessão de estabilização pós-integração registrada na seção 10.

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
> **Status (09/08/2026): concluída, com desvios de ferramenta registrados abaixo.**
- [x] VM: usuário/SSH configurados (Google Cloud e2-micro) — **desvio:** proxy é **Caddy** (não nginx), rodando via Docker Compose junto com `api` e `extractor` (não pm2) — ver `docker-compose.yml`, `Caddyfile`
- [x] Domínio → **desvio:** DuckDNS gratuito (`comunaradio.duckdns.org`), não domínio comprado
- [x] Certificado HTTPS automático (Caddy resolve isso sozinho, equivalente ao certbot do plano original)
- [ ] ~~pm2~~ — não se aplica; processos gerenciados pelo Docker Compose (`restart: unless-stopped`)
- [ ] Healthcheck externo (UptimeRobot ou similar) — **não configurado**, pendente
- [x] `api/`: Fastify + pino (`logger: true`) + cors — **atenção:** `origin: '*'` hoje, sem allowlist (ver Fase 9/pendências)
- [ ] Guarda de autenticação Bearer JWT — **não implementado**. Ver nota abaixo.
- [ ] Rate limit em `/extract` — **não implementado**
- [x] `GET /health`
- [x] Módulo push: `web-push` + VAPID, `sendPushToRoom` implementado e em uso (nova música, chat)
- [x] `POST /push/unsubscribe` e `POST /push/subscribe`, `POST /push/settings` (mute por sala)
- [ ] Cron de limpeza de `push_subscriptions` órfãs — não verificado
- **Gate:** ✅ atingido em produção, com as ressalvas acima.

> **Nota importante sobre autenticação (09/08/2026):** o plano original previa Supabase Auth (magic link) + guarda JWT nas rotas da API. Isso **não foi implementado** — a tela de "Login" (`app/src/pages/Login.tsx`) só pede um nome de exibição, guardado em `localStorage`, sem verificação de identidade nenhuma. Qualquer pessoa com o link da sala entra livremente, e nada impede alguém de se passar por outro nome. Para o escopo atual (uso pessoal entre amigos, sem publicação em loja), isso foi uma simplificação aceitável na prática, mas é uma divergência real do plano que vale registrar caso o projeto cresça de escopo.

### Fase 4 — Integração de dados reais + background play real (3–5 dias, NOVO v3)
> Troca as fixtures da Fase 1 por dados reais, sem tocar na UI já aprovada.
> **Status (09/08/2026): concluída e em produção**, com uma reformulação grande de arquitetura de dados (ver nota).
- [x] Fila/salas com dados reais — **desvio de arquitetura:** em vez do cliente falar direto com Supabase (`postgres_changes`), toda a integração real passou a ser **mediada pelo backend Fastify via Socket.IO** (`app/src/data/realtime.ts` + `api/src/server.ts`), que por sua vez persiste no Supabase. O cliente nunca recebe credenciais do Supabase.
- [x] Tela Adicionar Música chama `/extract` real (extrator Python rodando em produção)
- [x] Fila atualiza ao vivo entre dispositivos (via eventos Socket.IO, não `postgres_changes`)
- [x] Player toca `audio_url`/`video_url` reais (arquivos servidos em `comunaradio.duckdns.org/media/`)
- [x] Background play — trabalhado extensivamente em 09/08/2026 (Media Session, Picture-in-Picture automático, recuperação ao voltar do segundo plano). **Resultado real:** funciona bem no que o navegador permite; gerenciadores de bateria agressivos de fabricante (MIUI confirmado) ainda podem matar o processo por completo, fora do alcance de qualquer ajuste em JS — ver seção 10.
- [ ] Tratamento de URL de mídia expirada (re-resolve automático) — não verificado/implementado nesta sessão
- [ ] Confirmação formal em iOS real — não testado (sem dispositivo disponível)
- **Gate:** ✅ atingido — múltiplas salas reais em uso, música tocando de verdade, sincronizada.

### Fase 5 — Presença + radialista dinâmico: lógica real (2–4 dias)
> **Status (09/08/2026): concluída**, com arquitetura mais simples que a planejada (ver nota).
- [x] Presença real — **desvio:** não usa o canal de Presence do Supabase nem a tabela `room_sessions` planejada na seção 3. A fonte de verdade é simplesmente o `Map` de sockets conectados em memória no processo Node (`room.users`), o que já resolve o mesmo problema de "cliente não pode forjar presença" (a conexão socket em si é a prova de presença) com bem menos peças móveis.
- [ ] Heartbeat de aplicação (15s) / timeout (45s) — **não existe**; a detecção de saída depende só do `leave_room` explícito ou do `disconnect` do Socket.IO, cujo timeout de ping pode levar até ~20s numa desconexão "suja". Esse foi exatamente o mecanismo por trás do bug de salto de posição investigado e corrigido em 09/08/2026 (ver seção 10 e `docs/comportamento-playback.md`).
- [x] Radialista = usuário presente há mais tempo (`pickRadialista`, por `entrou_em`), recalculado em toda entrada/saída
- [x] `radialista_changed` broadcast real
- **Gate:** ✅ atingido em produção.

### Fase 6 — Sincronização ao vivo: lógica real (5–8 dias, CRÍTICO)
> **Status (09/08/2026): concluída**, nomenclatura diferente da planejada mas mesmo conceito.
- [x] Posição calculada por relógio — implementado como `playback.timestamp` + `playback.updated_at` (equivalente ao `server_started_at` planejado)
- [x] Sincronização de relógio cliente↔servidor — implementado via evento Socket.IO `get_time` (equivalente ao `GET /time` planejado)
- [x] Comandos de transporte só aceitos do radialista atual — **validado no servidor** (`user.id === room.radialista_id`), nunca confiado do cliente
- [x] Cliente corrige deriva real (`timeupdate` + comparação com posição esperada, seek se desvio > 2s)
- [x] Entrada no meio da faixa: seek real pro ponto certo
- [x] Backend avança a fila sozinho quando a faixa termina, com failsafe por `setInterval` mesmo sem nenhum cliente conectado — **e agora também volta pra primeira música ao terminar a última** (loop, adicionado 09/08/2026)
- [x] Reconexão após sala ficar vazia — **decisão revista em 09/08/2026**: em vez de "sempre pular pro ponto atual" (como o plano original previa), a sala agora **pausa** exatamente no momento em que fica vazia e **retoma do ponto congelado** quando alguém volta. Documentado em detalhe, com as alternativas descartadas e a causa raiz do bug relacionado, em `docs/comportamento-playback.md`.
- [ ] Teste formal com 3+ dispositivos em redes diferentes medindo desvio — não executado como teste formal, mas validado organicamente em uso real
- [ ] Revisar `docs/telas.md` com o comportamento real da Sala — pendente
- **Gate:** ✅ considerado atingido pelo uso real; falta só o teste formal de desvio.

### Fase 7 — Chat da sala: lógica real (2–3 dias)
> **Status (09/08/2026): concluída**, mesma arquitetura mediada pelo backend da Fase 4 (não Supabase Realtime direto).
- [x] Chat real via Socket.IO (`send_message`/`chat_message`), persistido no estado da sala (memória + `rooms.json`)
- [x] Lista atualiza ao vivo de verdade
- [x] Push de nova mensagem quando alguém está fora da sala (`sendPushToRoom` no handler de `send_message`)
- [x] **Novo, além do plano original (09/08/2026):** mensagens expiram após 24h (`pruneOldChatMessages`), e badge de "não lida" na aba Chat
- **Gate:** ✅ atingido em produção.

### Fase 8 — Push notifications (2–4 dias)
> **Status (09/08/2026): concluída.**
- [x] VAPID keys geradas e em uso
- [x] Service Worker (`sw.js`) trata `push` e `notificationclick`
- [x] Fluxo de permissão contextual na sala (botão "Alertas")
- [x] Backend notifica em `track_added` e em `send_message`
- [x] Endpoint de unsubscribe
- [ ] Matriz de teste formal nos 5 navegadores/SOs alvo — não executada de forma sistemática
- **Gate:** ✅ atingido nos ambientes testados (Chrome Android confirmado extensivamente); demais navegadores não testados formalmente.

### Fase 9 — Deploy final + hardening + polish restante (5–7 dias)
> Absorve o que sobrava das antigas Fases 9 e 10 que dependia de dados reais.
> **Status (09/08/2026): parcialmente concluída** — ver seção 9 (Pendências) para a lista consolidada do que falta.
- [x] Sleep timer (15/30/60 min)
- [ ] Histórico / recentes na sala — **não tem UI** (o backend já guarda `room.history`, só falta expor na interface)
- [x] Reordenar/remover músicas da fila
- [ ] Sentry (ou equivalente) para erros — não implementado
- [x] Settings por sala: toggle de silenciar notificações
- [x] Proxy final servindo PWA + `/api` + extrator, com HTTPS — via Caddy (não nginx, ver Fase 3)
- [ ] Revisão de RLS do Supabase — **nota:** como o cliente nunca fala direto com o Supabase (tudo mediado pelo backend, Fase 4), a superfície de risco mudou: o ponto crítico real hoje é que o backend usa a **service_role_key** (que ignora RLS por completo) — arquitetura correta desde que essa chave nunca vaze para o cliente (não vaza), mas ela está em texto puro no `docker-compose.yml`, **commitada no histórico do git** — ver seção 9.
- [ ] Rate limiting global, CORS restrito (hoje `origin: '*'`), `robots.txt` — nenhum implementado
- [ ] Backups / revisão de healthcheck — não configurado
- [ ] Runbook formal em `docs/` — parcialmente coberto por `docs/comportamento-playback.md`, mas não há um runbook operacional (como atualizar, reiniciar, diagnosticar)
- [ ] Onboarding dos amigos — não formalizado (não é bloqueante, dado que não há publicação em loja)
- **Gate:** parcialmente atingido — app funcionando establemente em produção para o grupo fechado, mas vários itens de segurança/observabilidade da lista de hardening seguem pendentes (seção 9).

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

1. **Background audio não sustenta de forma confiável em Android com gerenciador de bateria agressivo de fabricante** (confirmado no MIUI/Xiaomi) — risco real e **confirmado em produção** em 09/08/2026, não só teórico. Mitigado até o teto que a plataforma web permite: Media Session API, elemento `<video>` único com `autoPictureInPicture`, recuperação automática ao voltar de segundo plano, e sincronização de controles nativos (PiP) de volta pro estado da sala. Quando o SO mata o processo por completo, nenhum desses ajustes evita — só liberar o app nas configurações de bateria do aparelho resolve por completo. iOS segue não testado (sem dispositivo disponível). Considerado, e descartado por falta de necessidade, o caminho de empacotar com Capacitor para ganhar background audio nativo de verdade (custo/benefício não compensa pro escopo atual de projeto pessoal/estudo).
2. **yt-dlp quebra com mudanças do YouTube** — fallback Piped implementado (Fase 2); runbook formal de atualização ainda não escrito.
3. **Deriva de clock / dessincronização perceptível entre dispositivos** — mitigado com relógio autoritativo no backend (`playback.timestamp` + `updated_at`), correção periódica de deriva no cliente. Validado organicamente em uso real; teste formal com múltiplos dispositivos em redes diferentes ainda pendente.
4. **Corrida no handoff do radialista** — mitigado validando no backend, a cada comando, se o remetente é o `radialista_id` atual (nunca confiado do cliente) — confirmado no código (`update_playback`, `seek_playback`).
5. **Radialista fantasma / detecção de saída lenta** — **não existe** o heartbeat de aplicação (15s/45s) previsto na Fase 5; a detecção depende do `leave_room` explícito (rápido) ou do timeout de ping do Socket.IO (pode levar ~20s numa desconexão "suja", ex.: app morto em segundo plano). Esse foi exatamente o mecanismo por trás de um bug real de salto de posição investigado e corrigido em 09/08/2026 — a correção aplicada (congelar a posição assim que a saída for detectada, não importa quando) torna o sistema tolerante a essa latência em vez de eliminá-la. Ver `docs/comportamento-playback.md`.
6. **Caveats de iOS**: Media Session/background exigem PWA instalado e 1º play com gesto — não validado com dispositivo real ainda.
7. **Autoplay policy** (Chrome bloqueia autoplay com som) — mitigado pelo primeiro play sempre ser por gesto do usuário; overlay "Áudio Bloqueado" cobre o caso de falha.
8. **URLs de stream expiram** — re-resolve automático **não confirmado como implementado**; risco em aberto, não validado nesta sessão.
9. **ToS do YouTube** — uso pessoal de grupo fechado, sem loja, sem monetização (tolerado na prática; nunca distribuir publicamente). Confirmado nesta sessão que não há intenção de publicar em lojas.
10. **Endpoints de push mudam** — cleanup de subs obsoletas no envio (implementado na Fase 3).
11. **VM sem monitoramento externo** — healthcheck externo (ex.: UptimeRobot) **não configurado**; segue pendente.
12. **Segurança/observabilidade de produção em aberto** (novo, 09/08/2026; credenciais rotacionadas em 10/08/2026 — ver seção 9): sem autenticação real de usuário, CORS totalmente aberto (`origin: '*'`), sem rate limiting.

## 9. Pendências conhecidas (levantamento de 09/08/2026)

Lista consolidada do que ficou de fora depois da sessão de estabilização da seção 10 — nada aqui é urgente pro uso atual (grupo fechado, sem publicação em loja), mas fica registrado pra não se perder:

**Segurança / infraestrutura**
- ✅ **Resolvido em 10/08/2026**: chave SSH de deploy e credenciais do Supabase rotacionadas. A chave SSH antiga foi revogada do `authorized_keys` da VM; a `service_role_key`/`anon key` legadas foram desativadas no painel do Supabase (migrado para o sistema novo de `publishable`/`secret` keys). `docker-compose.yml` não tem mais segredos em texto puro — lê de um `.env` na VM (fora do git). Os arquivos `github-deploy-key`/`.pub` foram removidos do repositório (não do histórico — decisão consciente de não reescrever o histórico do git, já que a chave antiga está revogada e portanto inofensiva mesmo visível no `git log`).
- CORS totalmente aberto (`origin: '*'`) na API e no Socket.IO — segue pendente.
- Sem rate limiting em nenhuma rota (`/extract` incluso).
- Sem autenticação real de usuário (login é só um nome de exibição local — ver nota na Fase 3).
- Sem healthcheck externo monitorando a VM.

**Funcionalidades do plano original ainda não feitas**
- Tela/UI de histórico de músicas tocadas (o backend já guarda `room.history`, falta expor).
- Heartbeat de aplicação para detecção de saída de sala mais rápida que o timeout do Socket.IO (mitigado, não eliminado — ver risco 5).
- Re-resolve automático de URL de mídia expirada — não confirmado.
- Teste formal de deriva com 3+ dispositivos em redes diferentes.
- Matriz de teste formal de push em todos os navegadores/SOs alvo.
- Sentry (ou equivalente) para observabilidade de erros em produção.
- Runbook operacional formal (`docs/`).
- Validação em dispositivo iOS real (nunca testado).

**Não é considerado pendente** (decisão consciente): publicação em loja, app nativo via Capacitor, onboarding formal de amigos — descartados ou fora de escopo pra um projeto pessoal/de estudo, conforme conversa de 09/08/2026.

## 10. Sessão de estabilização pós-integração (09/08/2026)

Sessão longa e contínua de bugs relatados em uso real + melhorias, depois que o app já estava rodando em produção com dados reais. Registrado aqui porque vários desses achados corrigiram suposições erradas do plano original (ex.: riscos 1, 5 e 8 acima), não só "bugs pontuais". Ordem cronológica resumida:

1. **Aba Biblioteca vazia/quebrada no popup de adicionar música** — mismatch de nomes de campo entre frontend e o schema real do Supabase (`title`/`duration` vs `titulo`/`duracao_seg`).
2. **Causa raiz mais profunda do mesmo bug**: um commit feito direto na VM (nunca enviado ao GitHub) deixou o `git pull` do deploy automático travado silenciosamente por horas — a VM rodava código antigo sem a `SUPABASE_SERVICE_ROLE_KEY`, e todas as gravações no Supabase eram bloqueadas por RLS sem nenhum erro visível. Corrigido o desalinhamento do git da VM e adicionado log de erro real nas escritas do Supabase (antes, várias falhavam em silêncio).
3. **Mesma causa raiz encontrada de novo, duas vezes**: a sala seedada (`comuna-roots`) nunca tinha sido persistida na tabela `rooms` do Supabase (só salas criadas pelo fluxo normal recebiam isso) — quebrava silenciosamente qualquer feature com chave estrangeira pra `rooms.id`: primeiro descoberto via `room_tracks`/biblioteca, depois de novo via favoritos (`user_favorite_rooms`). Corrigido na origem (`seedRooms` agora grava no Supabase) e com backfill manual dos dados já existentes.
4. **Fila "riscando" músicas já tocadas** — removido, a pedido, o estilo visual que fazia a fila parecer "consumida".
5. **Player minimizado no mobile não ficava do tamanho certo, controles não escondiam sozinhos, player não encolhia ao rolar a tela pra ver a fila** — três ajustes de UI/CSS separados.
6. **Áudio parava ao minimizar o app no celular** — a investigação mais longa da sessão. Passou por: Media Session API com action handlers reais (antes só tinha metadata), elemento `<audio>` dedicado pro modo só-áudio (depois revertido), e finalmente Picture-in-Picture automático com um único `<video>` sempre ativo — a abordagem que realmente aproveita a proteção do SO contra apps mortos em segundo plano. Identificado que o MIUI (Xiaomi) mata o processo mesmo assim, fora do alcance de qualquer ajuste em JS; documentado o caminho de configurações de bateria como mitigação real.
7. **Comportamento de sala vazia** — decisão de produto revista de "reiniciar do zero" para "pausar e retomar do ponto exato", documentada com as alternativas descartadas em `docs/comportamento-playback.md`. Encontrado e corrigido, no processo, um bug real de salto de posição de vários minutos (causa raiz: latência de detecção de desconexão do Socket.IO).
8. **Fila volta para a primeira música ao terminar a última** (loop), tanto no avanço reportado pelo cliente quanto no failsafe do servidor.
9. **Popup com lista de usuários na sala** — texto "X ouvindo" virou clicável.
10. **Badge de mensagem não lida no chat** — implementado, e depois corrigido um falso positivo (mensagens antigas já lidas contando como novas por uma corrida entre conexão do socket e chegada do histórico real).
11. **Mensagens de chat expiram após 24h** — decisão de não guardar histórico de chat indefinidamente.
12. **Busca de música mostrava uma faixa falsa fixa no código em vez de erro** — sobra de modo demo/desenvolvimento que mascarava falhas reais de rede/timeout do extrator.
13. **Menus de Configurações/Sleep Timer renderizando atrás do player** — bug de contexto de empilhamento CSS (`z-index`) no cabeçalho da sala.
14. **Botão de voltar música** adicionado no player e no Picture-in-Picture (só existia o de avançar).
15. **Exploração descartada**: empacotar o app com Capacitor para ganhar background audio nativo de verdade — tecnicamente viável e reaproveitaria todo o código React/TS, mas descartado por não compensar o esforço pro escopo de projeto pessoal/estudo sem intenção de publicar em loja.
