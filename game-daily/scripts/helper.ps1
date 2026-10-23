# helper.ps1 -- elevated input helper (ps-helper adapter backend). ASCII only on purpose.
#
# Start ONCE (one UAC):
#   Start-Process powershell -Verb RunAs -File "<path>\helper.ps1" -ArgumentList "-StateDir","<module>\state" -WindowStyle Hidden
#
# Protocol (files live in -StateDir):
#   cmd.txt        one command per line; first line "#<timestamp>" forces re-run
#                  move x y | click x y | dclick x y | rclick x y | wheel n
#                  activate <hwnd> | key <vk> | type <text> | start <exe>
#                  kill <pid|name> | sleep <ms> | exit
#   out.jsonl      one JSON line per executed command: {ts,cmd,ok,err}
#   heartbeat.txt  refreshed ~6x/sec while alive
#   helper.pid     this process id
#
# Why elevated: a medium-integrity process cannot send synthetic input to a window
# owned by an elevated process (UIPI). Games like StarRail run as administrator.
param(
  [Parameter(Mandatory = $true)][string]$StateDir
)

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class GDInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, IntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
  public const uint MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040, WHEEL = 0x0800;
}
'@
[void][GDInput]::SetProcessDPIAware()

if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
$cmdFile = Join-Path $StateDir 'cmd.txt'
$outFile = Join-Path $StateDir 'out.jsonl'
$hbFile = Join-Path $StateDir 'heartbeat.txt'
$pidFile = Join-Path $StateDir 'helper.pid'
$logFile = Join-Path $StateDir 'helper.log'

$enc = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($pidFile, [string]$PID, $enc)
function Log([string]$msg) {
  try { [IO.File]::AppendAllText($logFile, ((Get-Date).ToString('HH:mm:ss.fff') + ' ' + $msg + "`r`n"), $enc) } catch {}
}
Log "helper started pid=$PID stateDir=$StateDir"

function Emit([string]$cmd, [bool]$ok, [string]$err) {
  $obj = [ordered]@{ ts = (Get-Date).ToString('HH:mm:ss.fff'); cmd = $cmd; ok = $ok; err = $err }
  $line = ($obj | ConvertTo-Json -Compress)
  try { [IO.File]::AppendAllText($outFile, ($line + "`r`n"), $enc) } catch {}
}

function Get-FgTitle {
  $sb = New-Object System.Text.StringBuilder 512
  [void][GDInput]::GetWindowTextW([GDInput]::GetForegroundWindow(), $sb, 512)
  return $sb.ToString()
}

$lastRaw = ''
$running = $true
while ($running) {
  try { [IO.File]::WriteAllText($hbFile, (Get-Date).ToString('HH:mm:ss.fff'), $enc) } catch {}
  $raw = ''
  try { if (Test-Path $cmdFile) { $raw = [IO.File]::ReadAllText($cmdFile) } } catch {}
  if ($raw -and $raw -ne $lastRaw) {
    $lastRaw = $raw
    foreach ($line in ($raw -split "`r?`n")) {
      $t = $line.Trim()
      if (-not $t) { continue }
      if ($t.StartsWith('#')) { continue }
      $p = $t -split '\s+'
      $verb = $p[0].ToLower()
      $err = ''
      $ok = $true
      try {
        switch ($verb) {
          'move' {
            $x = [int]$p[1]; $y = [int]$p[2]
            if (-not [GDInput]::SetCursorPos($x, $y)) { $ok = $false; $err = 'SetCursorPos failed (win32 ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error() + ')' }
          }
          'click' {
            $x = [int]$p[1]; $y = [int]$p[2]
            if (-not [GDInput]::SetCursorPos($x, $y)) { $ok = $false; $err = 'SetCursorPos failed (win32 ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error() + ')' }
            else {
              Start-Sleep -Milliseconds 40
              [GDInput]::mouse_event([GDInput]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
              Start-Sleep -Milliseconds 40
              [GDInput]::mouse_event([GDInput]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
            }
          }
          'dclick' {
            $x = [int]$p[1]; $y = [int]$p[2]
            [void][GDInput]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 60
            [GDInput]::mouse_event([GDInput]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
            [GDInput]::mouse_event([GDInput]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
            Start-Sleep -Milliseconds 40
            [GDInput]::mouse_event([GDInput]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
            [GDInput]::mouse_event([GDInput]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
          }
          'rclick' {
            $x = [int]$p[1]; $y = [int]$p[2]
            [void][GDInput]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 40
            [GDInput]::mouse_event([GDInput]::RIGHTDOWN, 0, 0, 0, [IntPtr]::Zero)
            [GDInput]::mouse_event([GDInput]::RIGHTUP, 0, 0, 0, [IntPtr]::Zero)
          }
          'wheel' {
            $n = [int]$p[1]
            [GDInput]::mouse_event([GDInput]::WHEEL, 0, 0, $n, [IntPtr]::Zero)
          }
          'activate' {
            $h = [IntPtr]([int64]$p[1])
            [void][GDInput]::ShowWindow($h, 9)
            [void][GDInput]::BringWindowToTop($h)
            $fg = [GDInput]::SetForegroundWindow($h)
            Start-Sleep -Milliseconds 120
            $title = Get-FgTitle
            $ok = $true
            $err = if ($fg) { '' } else { 'SetForegroundWindow returned false; foreground=' + $title }
          }
          'key' {
            $vk = [byte][int]$p[1]
            [GDInput]::keybd_event($vk, 0, 0, [IntPtr]::Zero)
            Start-Sleep -Milliseconds 60
            [GDInput]::keybd_event($vk, 0, 2, [IntPtr]::Zero)
          }
          'type' {
            $text = ($p[1..($p.Count - 1)] -join ' ')
            [System.Windows.Forms.SendKeys]::SendWait($text)
          }
          'start' {
            $path = ($p[1..($p.Count - 1)] -join ' ')
            Start-Process -FilePath $path | Out-Null
          }
          'kill' {
            $target = $p[1]
            $n = 0
            if ($target -match '^\d+$') { Stop-Process -Id ([int]$target) -Force -ErrorAction SilentlyContinue; $n = 1 }
            else { $procs = Get-Process -Name $target -ErrorAction SilentlyContinue; $n = @($procs).Count; $procs | Stop-Process -Force -ErrorAction SilentlyContinue }
            $ok = $n -gt 0; if (-not $ok) { $err = 'no matching process' }
          }
          'sleep' { Start-Sleep -Milliseconds ([int]$p[1]) }
          'exit' { $running = $false; Emit $t $true ''; break }
          default { $ok = $false; $err = 'unknown command' }
        }
      } catch {
        $ok = $false
        $err = $_.Exception.Message
      }
      if ($verb -ne 'exit') { Emit $t $ok $err }
    }
  }
  Start-Sleep -Milliseconds 150
}

Log 'helper exiting'
try { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue } catch {}
