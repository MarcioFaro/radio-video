@echo off
setlocal

echo ============================================================
echo   Radio Video - Atualizar Producao (GitHub + Vercel + VM)
echo ============================================================
echo.

set /p commit_msg="O que voce alterou no projeto? (Digite a mensagem): "
echo.

echo [1/3] Salvando e enviando todo o codigo para o GitHub...
git add .
git commit -m "%commit_msg%"
git push

echo.
echo ============================================================
echo   [SUCESSO] Codigo enviado para o GitHub!
echo ============================================================
echo.
echo [FRONTEND] A Vercel detectou essa mudanca e ja esta atualizando o site sozinho!
echo [BACKEND] O GitHub Actions ja esta se conectando no Google Cloud pra atualizar a API!
echo.
echo Voce nao precisa fazer mais nada. Relaxe e aguarde 1 a 2 minutinhos.
echo.
echo ============================================================
pause
