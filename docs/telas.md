# Documentação de Telas (Fase 1 - Protótipo Funcional)

Este documento descreve as telas e os estados criados na Fase 1 do projeto (Protótipo Funcional). Revisado ao fechar as pendências da Fase 1 (camada de dados isolada, PWA shell, `/join`).

> **Camada de dados:** todas as interações passam por `app/src/data/` (`rooms.ts`, `queue.ts`, `playback.ts`, `presence.ts`, `chat.ts`), implementadas com estado em memória (máscara funcional). A assinatura desses módulos é a final — a integração real (Supabase/backend) troca apenas a implementação, sem tocar na UI. O app roda sozinho com `npm run dev` (só Vite), sem precisar da API nem do Docker.

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
  - **Presença:** ao entrar, adiciona o usuário atual + 2 ouvintes simulados (Marcos, Pri) em `data/presence.ts`. *(Provisório até integrar presence real na Fase 5.)*
  - **Radialista:** quem entra primeiro é o radialista. Apenas o radialista pode dar Play/Pause ou Pular. Se o radialista não for você, aparece um banner azul avisando que você é um ouvinte. Há um botão **"Dev: trocar radialista"** no cabeçalho que simula a transferência do papel (para validar a UI dos dois estados). *(Provisório até a lógica real da Fase 5/6.)*
  - **Fila:** adicionar música (`data/queue.ts`) aparece na fila; a primeira faixa adicionada vira a "atual" do player.
  - **Chat:** mensagens enviadas aparecem na lista local (`data/chat.ts`). Funciona apenas na mesma aba.
  - **Player:** toca o áudio da faixa real (URL de demonstração retornada pelo preview fake).

## 4. Modal Adicionar Música
- **O que faz:** Busca uma música por link do YouTube.
- **Máscara Funcional:** Na Fase 1 não há extrator real. `data/queue.ts:previewTrack(url)` retorna um preview fake (título/thumbnail/duração simulados) após um pequeno delay de loading. Confirmar adiciona na fila para ver como a UI reage. *(Extração real reconecta na Fase 4.)*

## 5. Entrada por convite (`/join?code=`)
- **O que faz:** Deep link para entrar numa rádio sem passar pela lista.
- **Máscara Funcional:** Resolve o código via `joinRoomByCode` e navega para a sala. Código inválido → redireciona para `/rooms` com `state.joinError`. Sem usuário logado → redireciona para `/` preservando o `?code=`.

## PWA (instalação)
- `manifest.webmanifest`, `sw.js` e ícones 192/512/maskable em `app/public/`. `index.html` tem meta de `theme-color`, `apple-touch-icon` e `display: standalone`.
- Testar instalação: Android Chrome "Adicionar à tela inicial" / Safari iOS "Adicionar à tela de início".
