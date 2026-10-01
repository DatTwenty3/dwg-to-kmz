<#
.SYNOPSIS
  Kiem tra mot file .dxf co mo/luu duoc trong AutoCAD (accoreconsole) hay khong. Khong chay trong CI.

.DESCRIPTION
  Chay: accoreconsole.exe /i <dxf> /s <script>  voi script:
      FILEDIA
      0
      _.SAVEAS
      2018
      <out.dwg>
  (CRLF, ASCII; dong cuoi ket thuc bang dung mot CRLF, KHONG co dong trong thua - dong trong thua se chay lai SAVEAS va treo.)
  Timeout 120 s, qua han thi kill accoreconsole. Bao cao co ghi duoc DWG hay khong.

.EXAMPLE
  powershell -File scripts\verify-dxf-autocad.ps1 -Dxf C:\tmp\out.dxf
#>
param(
  [Parameter(Mandatory = $true)][string]$Dxf,
  [string]$OutDwg = '',
  [string]$AcCore = 'C:\Program Files\Autodesk\AutoCAD 2024\accoreconsole.exe',
  [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $AcCore)) { Write-Error "Khong tim thay accoreconsole: $AcCore"; exit 2 }
if (-not (Test-Path -LiteralPath $Dxf)) { Write-Error "Khong tim thay file DXF: $Dxf"; exit 2 }

$Dxf = (Resolve-Path -LiteralPath $Dxf).Path
if ($OutDwg -eq '') { $OutDwg = [System.IO.Path]::ChangeExtension($Dxf, '.dwg') }
$OutDwg = [System.IO.Path]::GetFullPath($OutDwg)
if (Test-Path -LiteralPath $OutDwg) { Remove-Item -LiteralPath $OutDwg -Force }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ('dxfcheck_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$scr = Join-Path $work 'save.scr'
$log = Join-Path $work 'console.log'
$err = Join-Path $work 'console.err'

# Chi dung ASCII, CRLF. Dong cuoi (duong dan DWG) phai ket thuc bang DUNG MOT CRLF (thieu thi console cho Enter
# va treo; them dong trong thu hai thi SAVEAS chay lai).
$text = (@('FILEDIA', '0', '_.SAVEAS', '2018', $OutDwg) -join "`r`n") + "`r`n"
[System.IO.File]::WriteAllText($scr, $text, [System.Text.Encoding]::ASCII)

Write-Host "DXF: $Dxf"
Write-Host "DWG: $OutDwg"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $AcCore -ArgumentList @('/i', "`"$Dxf`"", '/s', "`"$scr`"") `
  -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError $err

$finished = $p.WaitForExit($TimeoutSec * 1000)
if (-not $finished) {
  Write-Host "TIMEOUT sau $TimeoutSec s - kill accoreconsole."
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
  Get-Process -Name accoreconsole -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $p.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
}
$sw.Stop()

$ok = $false
if (Test-Path -LiteralPath $OutDwg) {
  $len = (Get-Item -LiteralPath $OutDwg).Length
  if ($len -gt 0) { $ok = $true }
}

Write-Host ('--- console (' + [math]::Round($sw.Elapsed.TotalSeconds, 1) + ' s) ---')
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -Last 40 }
if (Test-Path -LiteralPath $err) { Get-Content -LiteralPath $err -ErrorAction SilentlyContinue | Select-Object -Last 10 }
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue

if ($ok) {
  Write-Host "OK: da ghi DWG ($len bytes): $OutDwg"
  exit 0
}
Write-Host 'LOI: khong co file DWG duoc ghi.'
exit 1
