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
