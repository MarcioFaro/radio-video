@echo off
setlocal

set "ROOT=%~dp0"
set "DOCKER_DESKTOP=C:\Program Files\Docker\Docker\Docker Desktop.exe"
set "API_PORT=3005"
set "APP_PORT=5173"

echo ============================================================
echo   Radio Video - Reiniciando todos os servicos
echo ============================================================
echo.

REM ============================================================
REM  1) Docker Desktop
REM ============================================================
if not exist "%DOCKER_DESKTOP%" goto :no_docker

tasklist /fi "imagename eq Docker Desktop.exe" | find /i "Docker Desktop.exe" >nul 2>&1
if not errorlevel 1 goto :docker_running
echo [1/4] Iniciando Docker Desktop...
start "" "%DOCKER_DESKTOP%"
goto :wait_docker_start

:docker_running
echo [1/4] Docker Desktop ja esta em execucao.

:wait_docker_start
echo       Aguardando Docker Engine ficar pronto...
set /a tries=0
:wait_docker
ping -n 2 127.0.0.1 >nul
docker info >nul 2>&1
if not errorlevel 1 goto :docker_ready
set /a tries+=1
if %tries% geq 45 goto :no_docker
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
if errorlevel 1 goto :build_failed

echo [2/4] Extractor - iniciando container na porta 8000...
docker run -d --name radio-extractor -p 8000:8000 --restart unless-stopped radio-extractor
if errorlevel 1 goto :run_failed
echo       Extractor rodando em http://localhost:8000
goto :api_step

:build_failed
echo [AVISO] Falha ao construir a imagem do extractor. Seguindo sem ele.
goto :api_step

:run_failed
echo [AVISO] Falha ao iniciar o container radio-extractor. Seguindo sem ele.
echo.

:api_step

REM ============================================================
REM  3) API (porta %API_PORT%)
REM ============================================================
echo [3/4] API - preparando...
netstat -ano | findstr /r /c:":%API_PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 goto :api_port_busy
echo       Porta %API_PORT% livre.
goto :api_check_deps

:api_port_busy
echo [AVISO] Porta %API_PORT% ja esta em uso. A API pode nao subir.
echo         Confira se outro projeto esta usando essa porta.

:api_check_deps
if not exist "%ROOT%api\node_modules" goto :api_install
goto :api_launch

:api_install
echo       Instalando dependencias (npm install)...
pushd "%ROOT%api"
call npm install
popd

:api_launch
call :start_api
echo       API iniciada em http://localhost:%API_PORT%  (janela aberta)
echo.

REM ============================================================
REM  4) App / Painel (porta %APP_PORT%)
REM ============================================================
echo [4/4] App - preparando...
if not exist "%ROOT%app\node_modules" goto :app_install
goto :app_launch

:app_install
echo       Instalando dependencias (npm install)...
pushd "%ROOT%app"
call npm install
popd

:app_launch
call :start_app
echo       App iniciada em http://localhost:%APP_PORT%  (janela aberta)
echo.

REM ============================================================
REM  5) Abrir o painel no navegador
REM ============================================================
echo Aguardando o painel responder...
set /a tries=0
:wait_panel
ping -n 2 127.0.0.1 >nul
curl -s -o nul "http://localhost:%APP_PORT%"
if not errorlevel 1 goto :panel_ready
set /a tries+=1
if %tries% geq 30 goto :panel_timeout
goto :wait_panel

:panel_timeout
echo [ERRO] O painel nao respondeu apos 60s.
echo         Verifique a janela "Radio Video - App" que ficou aberta.
goto :done

:panel_ready
echo       Painel respondendo! Abrindo no navegador...
start "" "http://localhost:%APP_PORT%"

:done
echo.
echo ============================================================
echo   Rotina concluida. Fechando esta janela...
echo ============================================================
ping -n 2 127.0.0.1 >nul
endlocal
exit

REM ============================================================
REM  Sub-rotinas de inicializacao
REM ============================================================
:start_api
start "Radio Video - API" /D "%ROOT%api" cmd /k "npm run dev"
goto :eof

:start_app
start "Radio Video - App" /D "%ROOT%app" cmd /k "npm run dev"
goto :eof
