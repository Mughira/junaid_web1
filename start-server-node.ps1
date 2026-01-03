# PowerShell script to start Node.js web server
Write-Host "Starting Node.js web server..." -ForegroundColor Green
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js is not installed!" -ForegroundColor Red
    Write-Host "Download Node.js from: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit
}

# Change to the script's directory
Set-Location $PSScriptRoot

# Start Node.js server
node server.js

