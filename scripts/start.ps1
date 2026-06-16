$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  BrandDNA Analytics Dashboard" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "[1/4] Creating .venv..." -ForegroundColor Yellow
    python -m venv .venv
}

$python = if (Test-Path ".\.venv\Scripts\python.exe") {
    ".\.venv\Scripts\python.exe"
} else {
    "python"
}

Write-Host "[2/4] Installing Python dependencies..." -ForegroundColor Yellow
& $python -m pip install -r requirements.txt

Write-Host "[3/4] Installing Playwright Chromium..." -ForegroundColor Yellow
& $python -m playwright install chromium

if (-not (Test-Path ".env")) {
    Write-Host "Warning: .env is missing. AI/OCR features require OPENAI_API_KEY." -ForegroundColor Yellow
}

Write-Host "[4/4] Starting Flask app..." -ForegroundColor Green
Write-Host "Open: http://127.0.0.1:5000" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow

& $python app.py
