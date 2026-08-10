# 🚀 Documentação de Deploy - Radio Video

O projeto foi dividido em duas partes hospedadas separadamente para garantir a melhor performance e o menor custo possível.

## 1. Frontend (Site Visual)
- **Onde está hospedado:** Vercel (Conectado à sua conta do GitHub)
- **Tecnologia:** Vite / React
- **Como funciona:** A Vercel "escuta" o seu repositório no GitHub. Toda vez que um código novo chega lá (via um `git push`), a Vercel compila a pasta `app` sozinha em servidores no mundo todo e coloca a versão nova no ar na mesma hora.

### 🛠️ Como atualizar o Frontend (Site)?
Toda vez que você mexer em qualquer coisa visual na pasta `app` no seu computador:
1. Dê dois cliques no script **`deploy-prod.bat`** (ele vai perguntar o que você mudou e enviar o código para o GitHub automaticamente).
2. **Pronto!** Só precisa esperar 1 a 2 minutos e a Vercel já terá atualizado o seu site no ar. Você não precisa fazer absolutamente nada no Google Cloud.

---

## 2. Backend (API Node + Extrator Python + Proxy Caddy)
- **Onde está hospedado:** Máquina Virtual (VM) no Google Cloud Compute Engine (`e2-micro`)
- **IP do Servidor:** `http://34.57.127.190`
- **Como funciona:** O servidor usa o **Docker Compose** para rodar a sua API e o Extrator em conjunto e manter eles ligados 24h por dia.

### 🛠️ Como atualizar o Backend (API/Extrator)?
A configuração está **100% Automatizada via GitHub Actions**!
Toda vez que você quiser mudar a API, Extrator ou Caddy:
1. Dê dois cliques no script **`deploy-prod.bat`** para enviar as mudanças para o GitHub.
2. O servidor do GitHub (Actions) vai acessar a sua máquina do Google Cloud silenciosamente, baixar o código novo e reiniciar a sua API sozinho. Você não precisa fazer nada!

---

## Dicas Rápidas
- **Vendo os logs de erro da API na nuvem:**
  Se a API parar de funcionar, abra o SSH do Google Cloud, digite `cd radio-video` e depois rode `sudo docker-compose logs api` para ver onde deu erro.
- **O Site parou de comunicar com a API:**
  Verifique na Vercel (aba *Settings* -> *Environment Variables*) se a variável `VITE_API_URL` está configurada corretamente para `http://34.57.127.190`.

---

## 3. Central de Administrador (`/admin`)

A página **Central de Admin** (`/admin`) permite ver tabelas do Supabase, gerenciar rádios, músicas, usuários, mídias do disco e logs.

### ⚠️ Passo obrigatório ANTES do primeiro deploy com admin (1x na VM)
O Docker Compose agora lê duas variáveis novas do `.env` da VM. Sem elas, a central responde **503 (desabilitada)**. No SSH da VM, dentro de `radio-video`, edite o `.env` e adicione:

```bash
# Senha da Central de Admin (escolha uma senha forte)
ADMIN_PASSWORD=SUA_SENHA_FORTE

# Token interno para a API consultar logs/extração no extrator (qualquer string longa)
EXTRACTOR_ADMIN_TOKEN=SEU_TOKEN_LONGO_ALEATORIO
```

Depois recrie os containers:
```bash
sudo docker-compose down
sudo docker-compose up -d --build
```

### O que dá para fazer
- **Dashboard:** KPIs, métricas da VM (uptime, memória, disco), saúde da API/extrator e atividade recente.
- **Banco:** navegar tabelas do Supabase, editar/excluir faixas da biblioteca, excluir usuários, limpar push subscriptions órfãs e enviar push de teste.
- **Rádios:** editar nome/código, adicionar/remover músicas da fila, ver fila/histórico/chat ao vivo e excluir salas (desconecta quem está dentro).
- **Mídias:** listar arquivos de `/downloads` com status *em uso/órfão*, análise por formato e excluir arquivos do disco.
- **Logs & Ferramentas:** logs da API e do extrator (auto-refresh), testar extração de URL, baixar backup do `rooms.json` e recarregar salas do Supabase.

### Segurança
- Todas as rotas admin exigem token de sessão (24h) obtido com a senha; login com rate-limit.
- O socket do Docker **não** é exposto; métricas da VM vêm de `/proc` + `df`.
- Exclusões exigem confirmação no corpo (`{ "confirm": true }`) e na interface.
