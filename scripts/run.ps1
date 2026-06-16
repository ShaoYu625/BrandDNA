param(
    [int]$Port = 5000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

$pythonCandidates = @(
    ".\.venv\Scripts\python.exe",
    "python"
)

$python = $pythonCandidates | Where-Object {
    ($_ -eq "python") -or (Test-Path $_)
} | Select-Object -First 1

$env:PORT = "$Port"
& $python app.py
