@echo off
setlocal ENABLEDELAYEDEXPANSION
set "REPO_ROOT=%~dp0"
pushd "%REPO_ROOT%"
set "PY=%REPO_ROOT%.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo [ERROR] Could not find venv python at "%PY%".
  echo         Create venv:  py -m venv .venv
  echo         Install deps: .\.venv\Scripts\pip install fastapi "uvicorn[standard]"
  popd
  exit /b 1
)
set "PYTHONPATH=%REPO_ROOT%"
if "%HOST%"=="" set "HOST=127.0.0.1"
if "%PORT%"=="" set "PORT=8000"
"%PY%" -c "import importlib,sys,os; sys.path.insert(0, os.environ['REPO_ROOT']); m=importlib.import_module('backend'); ok=hasattr(m,'app'); print('[check] backend imported, has app:', ok); raise SystemExit(0 if ok else 2)"
if errorlevel 2 (
  echo [ERROR] Import check failed. See Python error above.
  popd
  exit /b 2
)
"%PY%" -m uvicorn backend.main:app --host %HOST% --port %PORT% --reload
set EXITCODE=%ERRORLEVEL%
popd
endlocal & exit /b %EXITCODE%
