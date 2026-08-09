# Comportamento esperado da reprodução (playback)

Este documento descreve como a reprodução sincronizada de uma sala/rádio deve se
comportar em situações-chave, para servir de referência ao implementar e revisar
o código relacionado (`api/src/server.ts`, `api/src/store.ts`,
`app/src/pages/Room.tsx`, `app/src/store/useRoomStore.ts`).

## Contexto

Não existe um "servidor de rádio" transmitindo áudio de verdade. Cada pessoa
conectada reproduz o arquivo de mídia diretamente no seu próprio navegador,
sincronizado por um estado compartilhado guardado no servidor:

```ts
playback: {
  status: 'playing' | 'paused',
  currentTrackId: string | null,
  timestamp: number,   // posição (segundos) da faixa no momento de updated_at
  updated_at: number,  // timestamp (ms) de quando esse estado foi definido
}
```

Qualquer cliente conectado calcula a posição "ao vivo" como:

```
expected = timestamp + (agora - updated_at) / 1000
```

Isso é o que permite alguém entrar numa sala já em andamento e cair no ponto
certo da música, e também corrige deriva (`drift`) continuamente enquanto o
cliente está conectado.

## Comportamento alvo: sala fica vazia

**Implementado.** Quando o último usuário sai de uma sala, a reprodução
**pausa** nesse exato ponto (`removeUserFromRoom` em `api/src/store.ts`).
Quando alguém entra numa sala que estava vazia, a música **retoma
exatamente de onde parou** (bloco `wasEmpty && room.pausedForEmptyRoom` em
`join_room`, `api/src/server.ts`) — nem reinicia do zero, nem pula para
frente como se tivesse continuado tocando sozinha.

A flag `Room.pausedForEmptyRoom` existe para diferenciar esse auto-pause de
um pause manual: se o radialista pausou de propósito antes de todo mundo
sair, a sala continua pausada quando alguém volta (não retoma sozinha).

Ou seja: **opção 2** da lista abaixo é o comportamento correto e já é o que
está em produção. As demais opções foram consideradas e descartadas, mas
ficam documentadas aqui porque já foram implementadas/discutidas em algum
momento e não devem voltar sem decisão explícita.

### Opções consideradas

1. ~~**Reiniciar do zero.**~~ Ao entrar numa sala vazia, a faixa atual volta
   para `timestamp = 0`. Foi implementado no commit `d5da876` e depois
   **substituído pela opção 2** — não é mais o comportamento desejado.
2. ✅ **Pausar e retomar do ponto exato (ALVO, implementado).** Ao ficar
   vazia, a sala pausa. Ao alguém entrar, a música continua exatamente de
   onde estava quando o último ouvinte saiu — nenhum tempo "perdido" é
   descontado nem simulado.
3. ~~**Continuar em segundo plano.**~~ O relógio do servidor segue contando
   mesmo sem ninguém conectado (como uma rádio ao vivo de verdade); quem volta
   cai no ponto "atual" calculado pelo tempo real decorrido. Rejeitado: gera
   confusão de "por que a música pulou" e não tem benefício real, já que
   ninguém estava ouvindo mesmo.
4. ~~**Avançar para a próxima.**~~ Ao ficar vazia, pula automaticamente para a
   próxima faixa da fila. Não faz sentido como reação a "sala vazia" —
   avançar de faixa deve depender só do fim natural da música (ver seção
   abaixo), não da presença de ouvintes.
5. ~~**Voltar com a rádio parada.**~~ Praticamente igual à opção 2, mas sem
   preservar a posição (fica pausado em `timestamp = 0` ou undefined). Não é o
   que foi pedido — a posição precisa ser preservada.
6. ⚠️ **(Bug observado, não é uma opção válida)** — usuário ficou ~10s fora da
   sala e voltou encontrando a mesma música, porém na marca de ~5 minutos.
   Isso não corresponde a nenhum dos comportamentos acima e indica um bug real
   a ser investigado (ver "Investigação do bug" abaixo), não uma escolha de
   design.

## Comportamento alvo: fim natural de uma faixa

Isso é independente do tópico acima e já está implementado e correto:

- Quando a faixa atual termina (detectado pelo evento `onEnded` de algum
  cliente conectado, **ou** pelo failsafe do servidor que roda mesmo sem
  ninguém conectado), a fila avança para a próxima música.
- Se a faixa que terminou era a **última** da fila, volta para a **primeira**
  (loop). Ver commit `56d23dd`.
- Este comportamento **não muda** com a decisão da seção anterior — o "pausar
  quando vazio" só se aplica à saída/entrada de usuários, não ao avanço normal
  de faixas.

## Comportamento alvo: radialista em segundo plano (app minimizado)

Já confirmado e correto, documentado aqui só para registro:

- Cada ouvinte reproduz localmente a partir da URL do arquivo, sincronizado
  pelo estado do servidor — não há transmissão ao vivo do dispositivo do
  radialista para os outros.
- Se o app do radialista para de tocar localmente (ex: navegador em segundo
  plano sendo suspenso pelo sistema operacional), isso é **puramente local**:
  nada é reportado ao servidor, o estado compartilhado continua
  `playing`, e os demais ouvintes não são afetados.
- Quando o radialista volta ao app, a correção de deriva (`drift correction`)
  do próprio cliente o recoloca na posição atual — ele não retoma de onde
  travou localmente, ele "resincroniza" como qualquer outro cliente.

## Investigação do bug (opção 6)

Sintoma relatado: sala esvaziada, ~10s fora, ao voltar a mesma faixa aparece
em ~5 minutos de progresso — incompatível com qualquer comportamento intencional.

**Causa raiz mais provável (hipótese de design, não confirmada por log ao
vivo):** a implementação anterior (opção 1) só reagia no instante exato do
`join_room`, checando `room.users.size === 0`. Mas a saída de um usuário é
detectada por dois caminhos com confiabilidade bem diferente:
- `leave_room` — explícito, disparado pelo cleanup do `useEffect` em
  `Room.tsx` (`return () => leaveRoom()`), praticamente instantâneo numa
  navegação limpa dentro do app.
- `disconnect` — implícito, via timeout de ping do Socket.IO, que pode levar
  até ~20s para uma desconexão "suja" (app indo pra segundo plano, aba
  fechada sem handshake limpo, celular travando o processo).

Se a saída e a volta aconteceram rápido o bastante por um caminho que não é
o `leave_room` limpo, o socket antigo ainda contava como conectado quando o
`join_room` novo chegou — `room.users.size` nunca bateu 0 na hora certa, o
reset da opção 1 não disparava, e o cliente caía na matemática normal de "ao
vivo" (`timestamp + tempo real decorrido desde updated_at`). Como
`updated_at` só é atualizado em eventos discretos (play/pause/seek/troca de
faixa, não continuamente), se a música estava com esse valor parado desde
bem mais cedo, o salto podia ser de vários minutos mesmo para uma ausência
real de 10 segundos.

**Por que a implementação da opção 2 resolve isso mesmo sem confirmar a
hipótese acima ao vivo:** em vez de depender de detectar "sala vazia" no
instante exato certo (que está sujeito à mesma janela de timeout do
Socket.IO), `removeUserFromRoom` congela a posição **assim que a saída for
detectada, seja por qual caminho for** — e a partir daí `status` vira
`'paused'`, o que já faz a correção de deriva do cliente e o failsafe do
servidor pararem de avançar o relógio (ambos checam `status === 'playing'`
antes de agir). O pior caso passa a ser só "mais alguns segundos de
reprodução ao vivo até a saída ser detectada" — nunca mais um salto de
vários minutos, independente de qual das hipóteses acima era a real.

Ainda vale reproduzir o cenário observando os logs do servidor ao vivo (como
fizemos para o bug do Supabase) numa próxima sessão de teste, para confirmar
empiricamente qual caminho (`leave_room` vs `disconnect`) estava envolvido —
mas isso é sobre entender a causa, não é mais bloqueante para o
comportamento estar correto.
