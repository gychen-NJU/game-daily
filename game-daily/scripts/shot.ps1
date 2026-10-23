# shot.ps1 -- full-screen (or region) capture with DPI awareness. ASCII only on purpose.
#
# Usage:
#   powershell -NoProfile -File shot.ps1 -Out C:\path\shot.png
#   powershell -NoProfile -File shot.ps1 -Out shot.png -RedactUid
#   powershell -NoProfile -File shot.ps1 -Out shot.png -X 0 -Y 0 -W 1280 -H 800
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [switch]$RedactUid
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class GDShot {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
}
'@
[void][GDShot]::SetProcessDPIAware()

if ($W -le 0) { $W = [GDShot]::GetSystemMetrics(0) }
if ($H -le 0) { $H = [GDShot]::GetSystemMetrics(1) }

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($W, $H)))
} finally {
  $g.Dispose()
}

if ($RedactUid) {
  # bottom-left UID strip: ~13% width x 4.6% height
  $rw = [int]($W * 0.13)
  $rh = [int]($H * 0.046)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
  $rg = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $rg.FillRectangle($brush, 0, ($H - $rh), $rw, $rh)
  } finally {
    $rg.Dispose(); $brush.Dispose()
  }
}

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$info = [ordered]@{
  ok = $true
  path = (Resolve-Path $Out).Path
  width = $W
  height = $H
  bytes = (Get-Item $Out).Length
  redactUid = [bool]$RedactUid
}
$info | ConvertTo-Json -Compress
