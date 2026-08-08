# Spec — Rádio Digital Colaborativa (projeto pessoal/estudo)

## 1. Objetivo

App para um grupo fechado de amigos onde qualquer membro pode criar uma "rádio" (canal), montar uma fila de músicas a partir de links do YouTube, e ouvir/assistir junto — sem anúncio, com reprodução em segundo plano (tela apagada).

Escopo: uso pessoal, grupo limitado, sem distribuição em loja pública, sem monetização.

## 2. Decisões de escopo

**Dentro do MVP:**
- Criar conta simples (convite fechado, sem cadastro público)
- Criar rádio/canal
- Convidar amigos para uma rádio
- Adicionar música colando link do YouTube
- Fila de reprodução compartilhada
- Reprodução sem anúncio (extração direta do stream)
- Reprodução em segundo plano com controles na tela de bloqueio
- **Sincronização "ao vivo"**: todos os membros presentes na sala ouvem o mesmo timestamp da faixa atual (decisão revisada em 08/08/2026 — ver seção 8)
- **Radialista dinâmico**: quem está presente na sala continuamente há mais tempo controla a reprodução (play/pause/pular); os demais só adicionam música à fila e ouvem
- **Chat da sala**: mensagens de texto simples entre os membros presentes

**Fora do MVP (avaliar depois):**
- Download/armazenamento offline dos vídeos — não recomendado nem depois; risco legal desproporcional ao ganho, e o app já resolve isso via streaming sob demanda
- Votação de próxima música, reações, Chromecast
- Publicação em loja de apps

## 3. Telas do app (MVP)

1. **Login** — magic link por e-mail ou entrada por código de convite; sem cadastro público.
2. **Minhas Rádios** — lista das salas de que participo; criar rádio nova; entrar em rádio por código/link de convite.
3. **Sala (Rádio)** — tela principal: player (vídeo em primeiro plano / áudio em segundo plano), fila de músicas, lista de presença (com indicação de quem é o radialista atual), chat, botão para adicionar música.
4. **Adicionar Música** — colar link do YouTube, ver preview (thumbnail/título/duração) antes de confirmar a entrada na fila.

> Nota de escopo: "entrar por código/link de convite" pode reaproveitar a tela de Login (deep link `/join?code=XYZ`) em vez de ser uma tela isolada — decisão de UI a confirmar na implementação.

> **Entrada na sala é direta, sem aprovação**: quem tem um código/link de convite válido entra na sala imediatamente — não há passo de aprovação pelo dono ou pelo radialista. O controle de acesso é só "tem o código ou não".

> **Documentação de detalhe**: cada tela, seus estados (vazio/carregando/erro/sucesso e variações) e o comportamento de cada interação são documentados em `docs/telas.md`, produzido e aprovado na Fase 1 de implementação (ver seção 10).

## 4. Arquitetura (visão geral)

```
[App mobile RN]  <-- REST/Realtime -->  [Supabase: Postgres + Auth + Realtime]
       |                                          |
       | pede stream de um vídeo                  | guarda: users, rooms, tracks, queue, playback_state
       v
[Serviço de extração] --(yt-dlp)--> resolve URL direta do stream --> devolve pro app
       |
       v
[YouTube] (só como fonte do stream, nunca via player oficial)
```

O app nunca carrega o player embutido do YouTube. Ele pede ao backend a URL direta do stream de um vídeo (áudio+vídeo ou só áudio), e toca essa URL num player nativo — por isso não há anúncio e o background play funciona como qualquer outro app de mídia.

> **Nota:** o app precisa agora manter um "relógio" autoritativo por sala ativa no backend (não em nenhum cliente específico), já que a reprodução passou a ser sincronizada entre todos os presentes — ver seção 9 (revisão) e `PLANO-IMPLEMENTACAO.md` para o desenho detalhado.

## 5. Stack recomendada

| Camada | Ferramenta | Por quê |
|---|---|---|
| Extração de stream | **yt-dlp** + `bgutil-ytdlp-pot-provider` | Mantido ativamente, resolve o bloqueio por PoToken/SABR que o YouTube introduziu em 2025-2026. Roda como microserviço Python separado. |
| Backend/API | **Node.js (Fastify) ou Supabase Edge Functions** | Camada fina: recebe link do YouTube, valida, chama o serviço de extração, grava fila no banco. |
| Banco + Auth + Realtime | **Supabase** (Postgres gerenciado) | Um único serviço cobre banco relacional, autenticação (magic link ou convite por código) e canais realtime — evita montar WebSocket próprio pra sincronizar a fila entre os membros da sala. |
| App mobile | **React Native + Expo (dev client)** | Cross-platform (Android/iOS) com um único código. Precisa do dev client (não Expo Go puro) por causa dos módulos nativos de player em segundo plano. |
| Player em background | **react-native-track-player** | Feito exatamente pra isso: media session, controles na lock screen/notificação, áudio contínuo com app minimizado ou tela apagada. |
| Vídeo em primeiro plano | **react-native-video** | Mostra o vídeo quando o app está aberto; ao minimizar, troca pra stream de áudio via track-player. |
| Hospedagem do serviço de extração | **Fly.io / Railway / VPS pequena** | Precisa rodar 24/7 com IP estável; contas gratuitas costumam bastar pro volume de um grupo de amigos. |
| Build e distribuição do app | **EAS Build (Expo)** | Gera APK/IPA pra instalar direto nos celulares dos amigos (sideload/TestFlight interno), sem passar por loja pública. |
| Busca de música (opcional) | **YouTube Data API v3** | Usada só pra buscar título/thumbnail/duração ao adicionar uma música — esse uso é totalmente dentro dos termos oficiais, diferente da extração de stream. |

## 6. Modelo de dados

```
users
  id, nome, avatar_url, criado_em

rooms (rádios/canais)
  id, nome, owner_id, codigo_convite, criado_em

room_members
  room_id, user_id, papel (owner | membro)

tracks
  id, room_id, youtube_video_id, titulo, thumbnail_url,
  duracao_seg, adicionado_por, adicionado_em

queue
  room_id, track_id, posicao

playback_state
  room_id, current_track_id, posicao_seg, status (playing|paused),
  radialista_user_id,        -- quem controla agora (derivado de presença, validado no backend)
  server_started_at,         -- timestamp de referência p/ calcular deriva nos clientes
  atualizado_em

room_sessions                -- NOVO: espelha a presença por sala p/ decidir o radialista sem confiar no cliente
  room_id, user_id, entrou_em, ultimo_heartbeat

messages                     -- NOVO: chat da sala
  id, room_id, user_id, texto, criado_em
```

Eventos realtime (via canal Supabase por `room_id`): `track_added`, `track_removed`, `queue_reordered`, `playback_play`, `playback_pause`, `now_playing_changed`, `radialista_changed`, `message_added`.

**Modelo de reprodução (revisado):** todos os membros presentes na sala ouvem a mesma faixa, na mesma posição — não é mais "cada um toca por conta própria". Ver seção 9 para o desenho de sincronização e do papel de radialista.

## 7. Riscos técnicos a considerar

- **Extração instável por natureza**: o YouTube mudou a extração em 2025-2026 (tokens PoToken, streams SABR). O yt-dlp segue ativo mas quebra e é corrigido em ciclos — espere manutenção periódica, não trate como "resolvido de vez".
- **Bloqueio por IP**: uso concentrado do serviço de extração pode ser sinalizado. Baixo risco pra um grupo pequeno, mas monitore.
- **URLs de stream expiram** (minutos a poucas horas) — o backend precisa re-resolver sob demanda, não cachear por muito tempo.
- **Sem distribuição em loja**: Google/Apple removem apps que extraem stream do YouTube fora da API oficial. Distribuição fica limitada a instalação direta (APK) ou grupo de teste interno.
- **Deriva de clock entre dispositivos**: cada celular tem seu próprio relógio; a posição "esperada" precisa ser calculada a partir do tempo do servidor, não do horário local do aparelho.
- **Corrida no handoff do radialista**: se a troca de radialista depender só do cliente, dois membros podem se achar "no controle" ao mesmo tempo após uma reconexão rápida — o backend precisa validar, a cada comando, se quem mandou é de fato o radialista atual.
- **Radialista fantasma**: uma queda de conexão sem "saída" explícita da sala não pode travar o controle indefinidamente — precisa de heartbeat com timeout curto pra transferir o papel automaticamente.
- **Buffering ao entrar no meio de uma faixa**: quem entra numa sala já tocando precisa carregar o stream e pular pro segundo certo antes de tocar — UX precisa comunicar isso ("sincronizando...").

## 8. Fases sugeridas

> Ordem revisada em 08/08/2026 (v3) — frontend completo primeiro, construção real depois. Ver seção 10.

1. **Fundação mínima** — repositório, projeto Supabase, auth configurada.
2. **Spike: background audio no iOS** — validar cedo o maior risco técnico do projeto, antes de investir no resto.
3. **Frontend completo (protótipo com máscara funcional + docs)** — as 4 telas, casca do player, UI de presença/radialista/chat, PWA shell, polish — tudo contra dados fixture que reagem de verdade às ações do usuário. Termina com `docs/telas.md` aprovado.
4. **Extração funcionando isolada** — script/serviço que recebe um link do YouTube e devolve a URL do stream (validado localmente).
5. **Backend + infraestrutura** — Supabase, VM, domínio, endpoint que cria sala e adiciona música na fila.
6. **Integração de dados reais + background play real** — troca as fixtures da Fase 3 por dados de verdade, sem tocar na UI já aprovada.
7. **Presença + radialista dinâmico (lógica real)** — canal de presença por sala, atribuição automática do papel de radialista por antiguidade, transferência ao sair/cair.
8. **Sincronização ao vivo (lógica real)** — relógio autoritativo no backend, correção de deriva no cliente, entrada sincronizada no meio da faixa, comandos de transporte restritos ao radialista.
9. **Chat da sala (lógica real)** — mensagens em tempo real entre presentes.
10. **Deploy final + hardening + polish restante** — convites por link, avatares, reordenar fila, remover música, endurecimento de produção.

## 9. Revisão de escopo — 08/08/2026

Decisão tomada com o dono do projeto: trazer a sincronização "ao vivo" (antes fora do MVP) para dentro do MVP, junto com um papel dinâmico de "radialista" e um chat de sala. Motivação: a experiência de "entrar numa sala que um amigo já está e ouvir junto" é mais valiosa pro objetivo do projeto do que uma fila tocada independentemente por cada um.

Regra do radialista: quem está presente na sala continuamente há mais tempo controla a reprodução (play/pause/pular). Se sair, o papel passa para o próximo mais antigo presente. Ao reentrar, perde a antiguidade (volta pro fim da fila de prioridade). Qualquer membro pode adicionar músicas à fila independente de ser o radialista.

Esta decisão aumenta o escopo técnico de forma relevante — ver `PLANO-IMPLEMENTACAO.md` seção 6 para o desenho de implementação e o impacto no cronograma.

## 10. Revisão de processo — 08/08/2026 (v3)

Decisão tomada com o dono do projeto: inverter a ordem de construção. Antes de qualquer integração real (extração, backend, sincronização), constrói-se o **frontend completo** — todas as telas, botões, visual — com documentação de cada funcionalidade, para revisão e aprovação.

O protótipo não é estático como uma imagem: cada ação do usuário (tocar play, adicionar música, mandar mensagem no chat, entrar na sala) precisa produzir um resultado visível de verdade, simulado localmente por uma camada de dados isolada (`app/src/data/`) que depois é trocada por chamadas reais sem tocar na UI. Não há, porém, simulação automática de eventos passando o tempo sozinha (ninguém entra na sala ou manda mensagem sem uma ação do usuário disparar isso).

Ressalva importante: os estados da tela **Sala** ligados a sincronização ao vivo, radialista e buffering são aprovados como **provisórios** — a UX real desses comportamentos só se confirma depois que a fase de Sincronização ao Vivo (a mais arriscada tecnicamente) estiver implementada com lógica real.

Ver `PLANO-IMPLEMENTACAO.md` seções 0.2 e 6 para o desenho detalhado e o cronograma na nova ordem.
