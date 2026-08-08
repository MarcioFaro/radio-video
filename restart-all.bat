@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
set "DOCKER_DESKTOP=C:\Program Files\Docker\Docker\Docker Desktop.exe"

echo ============================================================
echo   Radio Video - Reiniciando todos os servicos
echo ============================================================
echo.

REM ============================================================
REM  1) Docker Desktop
REM ============================================================
if not exist "%DOCKER_DESKTOP%" (
    echo [AVISO] Docker Desktop nao encontrado. Pulando...
    goto :no_docker
)

tasklist /fi "imagename eq Docker Desktop.exe" | find /i "Docker Desktop.exe" >nul 2>&1
if errorlevel 1 (
    echo [1/4] Iniciando Docker Desktop...
    start "" "%DOCKER_DESKTOP%"
) else (
    echo [1/4] Docker Desktop ja esta em execucao.
)

echo       Aguardando Docker Engine ficar pronto...
set /a tries=0
:wait_docker
timeout /t 2 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto :docker_ready
set /a tries+=1
if %tries% geq 45 (
    echo [ERRO] Docker Engine nao respondeu a tempo. Abortando.
    pause
    exit /b 1
)
goto :wait_docker
:docker_ready
echo       Docker Engine pronto.
echo.

:no_docker

REM ============================================================
REM  2) Extractor (build + restart via Docker)
REM ============================================================
echo [2/4] Extractor - removendo container antigo...
docker rm -f radio-extractor >nul 2>&1

echo [2/4] Extractor - construindo imagem...
docker build -t radio-extractor "%ROOT%extractor"

if errorlevel 1 (
    echo [ERRO] Falha ao construir a imagem do extractor.
    pause
    exit /b 1
)

echo [2/4] Extractor - iniciando container na porta 8000...
docker run -d --name radio-extractor -p 8000:8000 --restart unless-stopped radio-extractor
if errorlevel 1 (
    echo [ERRO] Falha ao iniciar o container radio-extractor.
    pause
    exit /b 1
)
echo       Extractor rodando em http://localhost:8000
echo.

REM ============================================================
REM  3) API (porta 3001)
REM ============================================================
echo [3/4] API - preparando...
if not exist "%ROOT%api\node_modules" (
    echo       Instalando dependencias (npm install)...
    pushd "%ROOT%api"
    call npm install
    popd
)
start "Radio Video - API" /D "%ROOT%api" cmd /k "npm run dev"
echo       API iniciada em http://localhost:3001
echo.

REM ============================================================
REM  4) App / Painel (porta 5173)
REM ============================================================
echo [4/4] App - preparando...
if not exist "%ROOT%app\node_modules" (
    echo       Instalando dependencias (npm install)...
    pushd "%ROOT%app"
    call npm install
    popd
)
start "Radio Video - App" /D "%ROOT%app" cmd /k "npm run dev"
echo       App iniciada em http://localhost:5173
echo.

REM ============================================================
REM  5) Abrir o painel no navegador
REM ============================================================
echo Aguardando o painel responder...
set /a tries=0
:wait_panel
timeout /t 2 /nobreak >nul
curl -s -o nul http://localhost:5173
if not errorlevel 1 goto :panel_ready
set /a tries+=1
if %tries% geq 30 (
    echo [AVISO] O painel ainda nao respondeu, abrindo mesmo assim...
    goto :open_panel
)
goto :wait_panel
:panel_ready
:open_panel
echo Abrindo painel no navegador...
start "" "http://localhost:5173"

echo.
echo ============================================================
echo   Todos os servicos iniciados. Fechando esta janela...
echo ============================================================
timeout /t 2 /nobreak >nul
endlocal
exit
