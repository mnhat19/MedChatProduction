@echo off
setlocal
echo ==========================================
echo   Mocha Medical Training App - Setup
echo ==========================================

REM ── 1. Frontend .env.local ──────────────────────────────────────────────────
if not exist ".env.local" (
    echo [1/5] Creating .env.local from .env.example...
    copy .env.example .env.local >nul
    echo       ^> Edit .env.local and set VITE_GEMINI_API_KEY
) else (
    echo [1/5] .env.local already exists. Skipping.
)

REM ── 2. Backend .env ──────────────────────────────────────────────────────────
if not exist "rag_project\.env" (
    echo [2/5] Creating rag_project\.env from .env.example...
    copy rag_project\.env.example rag_project\.env >nul
    echo       ^> Edit rag_project\.env and set GOOGLE_API_KEY
) else (
    echo [2/5] rag_project\.env already exists. Skipping.
)

REM ── 3. NPM install ────────────────────────────────────────────────────────────
echo [3/5] Installing frontend dependencies...
call npm install
if errorlevel 1 ( echo [ERROR] npm install failed & exit /b 1 )

REM ── 4. Python packages ────────────────────────────────────────────────────────
echo [4/5] Installing backend dependencies...
cd rag_project
pip install -r requirements_api.txt
if errorlevel 1 ( echo [ERROR] pip install failed & cd .. & exit /b 1 )
cd ..

REM ── 5. FAISS index ────────────────────────────────────────────────────────────
if not exist "rag_project\faiss_cache\faiss_index" (
    echo [5/5] Building FAISS index (first-time only, may take several minutes)...
    cd rag_project
    python src\build_faiss.py
    if errorlevel 1 ( echo [ERROR] build_faiss.py failed & cd .. & exit /b 1 )
    cd ..
) else (
    echo [5/5] FAISS index already built. Skipping.
)

echo.
echo ==========================================
echo   Setup complete!
echo ==========================================
echo   Run the app:   npm run dev
echo   Frontend:      http://localhost:3000
echo   Backend API:   http://localhost:8001
echo   API Docs:      http://localhost:8001/docs
echo ==========================================
endlocal
