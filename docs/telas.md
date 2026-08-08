# Documentação de Telas (Fase 1 - Protótipo Funcional, revisado na Fase 2 - Extrator Real)

Este documento descreve as telas e os estados criados na Fase 1 do projeto (Protótipo Funcional). Revisado ao fechar as pendências da Fase 1 (camada de dados isolada, PWA shell, `/join`).

> **Camada de dados:** todas as interações passam por `app/src/data/` (`rooms.ts`, `queue.ts`, `playback.ts`, `presence.ts`, `chat.ts`), implementadas com estado em memória (máscara funcional). A assinatura desses módulos é a final — a integração real (Supabase/backend) troca apenas a implementação, sem tocar na UI.

> **Realtime demo (revisão pós-Fase 1):** o app ganhou um modo de sincronização real entre navegadores via backend Socket.IO local (`api/`, porta 3005). Ao entrar na sala, se a API estiver no ar, `data/realtime.ts` passa a alimentar fila/chat/presença/playback pelo servidor — 2 abas/navegadores vendo a mesma sala se sincronizam de verdade. Se a API estiver fora, o app cai automaticamente para o fixture em memória (funciona sozinho com `npm run dev`, só Vite). *Isso continua provisório em relação às Fases 5-6 (presença/radialista/sync reais com backend definitivo) — o servidor local é um mock do comportamento final.*

## 1. Tela de Login (`/`)
- **O que faz:** Permite o usuário inserir um nome/apelido para entrar no app. Suporta parâmetro `?code=` vindo de `/join` (após entrar, redireciona para a sala do convite).
- **Máscara Funcional:** Ao digitar e entrar, salva o nome no Zustand (`useUserStore`) e redireciona para a lista de salas (ou para o `/join?code=` pendente). Não há validação real de e-mail ou senha — **provisório**: magic link real (Supabase) entra na Fase 4.

## 2. Minhas Rádios (`/rooms`)
- **O que faz:** Lista as rádios simuladas, cria uma nova e permite entrar por código de convite.
- **Máscara Funcional:**
  - Ao clicar em "Criar Nova Rádio", adiciona a rádio no estado em memória (`data/rooms.ts`) e entra na sala instantaneamente. O código de convite é gerado aleatoriamente.
  - O campo "Código de convite..." resolve via `joinRoomByCode` e entra direto na sala. Código inválido mostra erro em vermelho.
  - Receber `state.joinError` (vindo de `/join` com código inválido) mostra o mesmo erro.

## 3. Sala Principal (`/room/:id`)
- **O que faz:** Exibe o player, a fila de músicas, a presença dos usuários e o chat.
- **Máscara Funcional & Estados Provisórios:**
  - **Presença:** ao entrar, adiciona o usuário atual + 2 ouvintes simulados (Marcos, Pri) em `data/presence.ts`. *(Provisório até integrar presence real na Fase 5.)* Com a API no ar, a presença vem do servidor (entrada/saída refletem de verdade).
  - **Radialista:** quem entra primeiro é o radialista. Apenas o radialista pode dar Play/Pause ou Pular. Se o radialista não for você, aparece um banner azul avisando que você é um ouvinte. O botão **"Dev: trocar radialista"** no cabeçalho roda a troca via evento `force_radialista` no servidor (ou localmente, se offline) — validando a UI dos dois estados. *(Provisório até a lógica real da Fase 5/6.)*
  - **Fila:** adicionar música (`data/queue.ts`) aparece na fila; a primeira faixa adicionada vira a "atual" do player. Com a API no ar, a fila sincroniza entre os membros da sala.
  - **Chat:** mensagens enviadas aparecem na lista local (`data/chat.ts`). Com a API no ar, mensagens sincronizam em tempo real entre os membros.
  - **Player:** toca o áudio da faixa real (URL de demonstração retornada pelo preview fake, ou a URL real vinda do extrator — ver seção 4).
  - **Status de conexão:** o cabeçalho mostra um indicador verde "sincronizado" / vermelho "offline" conforme o estado da conexão com a API.

## 4. Modal Adicionar Música
- **O que faz:** Busca uma música por link do YouTube.
- **Máscara Funcional (revisada na Fase 2 — extrator real):** `data/queue.ts:previewTrack(url)` chama o **extrator real** (`POST http://127.0.0.1:8000/extract`, via Docker). O extrator resolve o vídeo com yt-dlp + PoToken (servidor bgutil na porta 4416) e retorna `audio_url`, `thumbnail_url`, `duracao_seg` e `video_url` (formato de vídeo, usado no futuro). 
  - **Erros estruturados:** se o vídeo não puder ser extraído, o extrator responde `422` com `{error: {code, message}}` e o app mostra a mensagem traduzida em português no modal (ex.: "Vídeo removido ou indisponível.", "Vídeo com restrição de idade.", "Limite de requisições ao YouTube atingido..."). Sem fallback silencioso para preview fake nesses casos.
  - **Demo fallback:** só quando o container do extrator está fora do ar (fetch falha/aborta), o app cai para um preview fake após um pequeno delay de loading. O próprio extrator também pode retornar `fallback: true` (título "Faixa de Demonstração (Extração Bloqueada)") quando nenhuma fonte (yt-dlp/Piped) resolveu o stream — fica explícito na fila que é demonstração.
  - **Fila:** confirmar adiciona `audio_url` real; o player toca o áudio real do YouTube (stream .webm/opus direto do CDN do Google).

## 5. Entrada por convite (`/join?code=`)
- **O que faz:** Deep link para entrar numa rádio sem passar pela lista.
- **Máscara Funcional:** Resolve o código via `joinRoomByCode` e navega para a sala. Código inválido → redireciona para `/rooms` com `state.joinError`. Sem usuário logado → redireciona para `/` preservando o `?code=`.

## PWA (instalação)
- `manifest.webmanifest`, `sw.js` e ícones 192/512/maskable em `app/public/`. `index.html` tem meta de `theme-color`, `apple-touch-icon` e `display: standalone`.
- Testar instalação: Android Chrome "Adicionar à tela inicial" / Safari iOS "Adicionar à tela de início".
