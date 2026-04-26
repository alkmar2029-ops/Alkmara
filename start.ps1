# ZKTeco Attendance — single-PC start script.
#
# Steps when you double-click start.bat (or run this directly):
#   1. cd into this script's folder
#   2. verify Node.js + .env.local
#   3. install dependencies if missing
#   4. open the browser at http://localhost:3000
#   5. run `npm run dev`
#
# Direct usage:
#   PowerShell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Step($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "  [OK]  $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "  [!]   $m" -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host "  [X]   $m" -ForegroundColor Red }

Write-Host "================================================" -ForegroundColor DarkGray
Write-Host "   نظام حضور الطلاب — تشغيل" -ForegroundColor White
Write-Host "================================================" -ForegroundColor DarkGray

# 1. Node.js
Write-Step "التحقق من Node.js"
try {
    $nodeVer = & node -v 2>$null
    Write-Ok "Node.js $nodeVer"
} catch {
    Write-Err "Node.js غير مثبّت — حمّله من https://nodejs.org ثم أعد التشغيل"
    Read-Host "اضغط Enter للخروج"
    exit 1
}

# 2. .env.local
Write-Step "التحقق من ملف .env.local"
if (-not (Test-Path -Path ".\.env.local")) {
    Write-Err ".env.local غير موجود — انسخه من المشروع الأصلي قبل التشغيل"
    Read-Host "اضغط Enter للخروج"
    exit 1
}
Write-Ok "تم العثور على .env.local"

# 3. node_modules
Write-Step "التحقق من المكتبات (node_modules)"
if (-not (Test-Path -Path ".\node_modules")) {
    Write-Warn "غير موجود — جارٍ التثبيت (قد يستغرق دقائق)..."
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "فشل npm install"
        Read-Host "اضغط Enter للخروج"
        exit 1
    }
    Write-Ok "تم التثبيت"
} else {
    Write-Ok "موجود"
}

# 4. Open the browser shortly after the server starts (background job).
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 5
    Start-Process "http://localhost:3000"
} | Out-Null

Write-Step "سيُفتح المتصفح تلقائياً خلال ثوانٍ على"
Write-Host "  http://localhost:3000" -ForegroundColor Yellow

# 5. Run dev (blocks — keep this window open).
Write-Step "تشغيل التطبيق (لا تغلق هذه النافذة)"
Write-Host "  اضغط Ctrl+C للإيقاف" -ForegroundColor DarkGray
Write-Host ""

& npx next dev -H 127.0.0.1 -p 3000
