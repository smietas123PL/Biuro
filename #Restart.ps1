# ==============================================================================
# BRUTAL PLATFORM RESET & REBUILD (Node.js + Docker + Edge)
# Ten skrypt czysci wszystko i kompiluje projekt od zera.
# ==============================================================================

$Url = "http://localhost:3000/"
$ErrorActionPreference = "SilentlyContinue"

Write-Host "--- KROK 1: ZAKONCZENIE PROCESOW ---" -ForegroundColor Yellow
# Zatrzymywanie przegladarki, kontenerow i dockera
Get-Process msedge | Stop-Process -Force
docker compose down --remove-orphans -v 2>$null
Get-Process -Name "*docker*" | Stop-Process -Force
Stop-Service -Name com.docker.service -Force

Write-Host "--- KROK 2: CZYSZCZENIE PLIKOW LOKALNYCH ---" -ForegroundColor Red
# Usuwanie starych kompilacji (wymuszenie nowej kompilacji w kontenerze)
Remove-Item -Path "packages/server/dist" -Recurse -Force
Remove-Item -Path "packages/dashboard/dist" -Recurse -Force

# Czyszczenie danych przegladarki
$edgePaths = @("$env:LOCALAPPDATA\Microsoft\Edge\User Data", "$env:APPDATA\Microsoft\Edge")
foreach ($path in $edgePaths) {
    if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}

Write-Host "--- KROK 3: TWARDY RESTART WSL ---" -ForegroundColor Yellow
wsl --shutdown
Write-Host "Oczekiwanie 8s na zwolnienie zasobow..." -ForegroundColor Gray
Start-Sleep -Seconds 8

Write-Host "--- KROK 4: START USLUGI DOCKER ---" -ForegroundColor Green
Start-Service -Name com.docker.service
$dockerPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (Test-Path $dockerPath) {
    Start-Process -FilePath $dockerPath
    
    # Czekanie na gotowosc silnika Docker Desktop
    Write-Host "Czekanie na gotowosc silnika Docker..." -ForegroundColor Yellow
    do {
        Start-Sleep -Seconds 3
        $status = docker ps 2>$null
    } while ($null -eq $status)
    
    Write-Host "--- KROK 5: KOMPILACJA I BUDOWANIE (NO-CACHE) ---" -ForegroundColor Cyan
    # Budowanie obrazow od zera (to jest moment kompilacji Twojego kodu)
    docker compose build --no-cache
    
    Write-Host "Uruchamianie kontenerow..." -ForegroundColor Green
    docker compose up -d
    
    Write-Host "--- KROK 6: OTWIERANIE PRZEGLADARKI ---" -ForegroundColor Green
    $edgeExe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    if (-not (Test-Path $edgeExe)) { $edgeExe = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
    
    if (Test-Path $edgeExe) {
        Write-Host "Uruchamianie Edge InPrivate pod adresem $Url" -ForegroundColor Cyan
        Start-Process $edgeExe -ArgumentList "--inprivate `"$Url`""
    }
} else {
    Write-Host "BLAD: Nie znaleziono sciezki do Docker Desktop!" -ForegroundColor Red
}

Write-Host "`n--- RESTART ZAKONCZONY ---" -ForegroundColor Green -BackgroundColor Black
Read-Host "Nacisnij dowolny klawisz, aby zamknac to okno..."
