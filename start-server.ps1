# PowerShell script to start a local web server
Write-Host "Starting local web server..." -ForegroundColor Green
Write-Host ""
Write-Host "Your site will be available at: http://localhost:8000" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Change to the script's directory
Set-Location $PSScriptRoot

# Start Python HTTP server
python -m http.server 8000

