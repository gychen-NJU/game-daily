#!/usr/bin/env node
/**
 * probe.mjs — 环境探测（只读）。
 *
 * 输出一份 JSON：屏幕物理尺寸、DPI 感知结果、前台窗口、启动器/游戏进程与是否提权、
 * 提权助手是否在跑，以及"该用哪个电脑操作适配器"的判定提示。
 *
 * 用法：
 *   node probe.mjs                 # 默认探测 sr（星铁）相关进程
 *   node probe.mjs --game sr --pretty
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_ROOT = join(__dirname, '..', '..')

const argv = process.argv.slice(2)
const pretty = !argv.includes('--json')
const gameArg = valOf('--game') || 'sr'

function valOf(flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : null
}

// 每个游戏模块：进程名 + 默认 state 目录
const GAMES = {
  sr: { launcher: ['HYP'], game: ['StarRail'], module: 'game-daily-sr' },
  zzz: { launcher: ['HYP', 'ZenlessZoneZeroLauncher'], game: ['ZenlessZoneZero'], module: 'game-daily-zzz' },
  hi: { launcher: ['HYP'], game: ['BH3'], module: 'game-daily-hi' },
  gi: { launcher: ['HYP'], game: ['YuanShen', 'GenshinImpact'], module: 'game-daily-gi' },
}
const cfg = GAMES[gameArg] || GAMES.sr
const stateDir = join(SKILLS_ROOT, cfg.module, 'state')

function psEscape(s) {
  return String(s).replace(/'/g, "''")
}

const outFile = join(tmpdir(), `game-daily-probe-${process.pid}.json`)

const ps = `
$ErrorActionPreference = 'Stop'
$out = '${psEscape(outFile)}'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class GDProbe {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool GetTokenInformation(IntPtr t, int cls, IntPtr info, int len, out int ret);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_ELEVATION { public int TokenIsElevated; }
  public static bool IsElevated(int pid) {
    IntPtr p = OpenProcess(0x1000, false, pid);
    if (p == IntPtr.Zero) return false;
    try {
      IntPtr t;
      if (!OpenProcessToken(p, 0x0008, out t)) return false;
      try {
        int ret;
        IntPtr buf = Marshal.AllocHGlobal(4);
        try {
          if (!GetTokenInformation(t, 20, buf, 4, out ret)) return false;
          var te = (TOKEN_ELEVATION)Marshal.PtrToStructure(buf, typeof(TOKEN_ELEVATION));
          return te.TokenIsElevated != 0;
        } finally { Marshal.FreeHGlobal(buf); }
      } finally { CloseHandle(t); }
    } finally { CloseHandle(p); }
  }
}
'@
[void][GDProbe]::SetProcessDPIAware()

$w = [GDProbe]::GetSystemMetrics(0)
$h = [GDProbe]::GetSystemMetrics(1)

$fg = [GDProbe]::GetForegroundWindow()
$fgTitle = New-Object System.Text.StringBuilder 512
[void][GDProbe]::GetWindowTextW($fg, $fgTitle, 512)
$fgRect = New-Object 'GDProbe+RECT'
[void][GDProbe]::GetWindowRect($fg, [ref]$fgRect)

function ProcInfo($names) {
  $list = @()
  foreach ($n in $names) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
      $list += [ordered]@{
        name = $_.ProcessName; pid = $_.Id
        title = $_.MainWindowTitle; hwnd = [int64]$_.MainWindowHandle
        elevated = [GDProbe]::IsElevated($_.Id)
      }
    }
  }
  return $list
}

$launcher = ProcInfo @('${cfg.launcher.map(psEscape).join("','")}')
$game = ProcInfo @('${cfg.game.map(psEscape).join("','")}')

$result = [ordered]@{
  ok = $true
  os = [System.Environment]::OSVersion.VersionString
  screen = [ordered]@{ width = $w; height = $h; dpiAware = $true }
  foreground = [ordered]@{
    title = $fgTitle.ToString()
    hwnd = [int64]$fg
    rect = [ordered]@{ x = $fgRect.L; y = $fgRect.T; w = $fgRect.R - $fgRect.L; h = $fgRect.B - $fgRect.T }
  }
  launcher = $launcher
  game = $game
}
$json = $result | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))
`

function runPowerShell(script) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], {
    stdio: 'pipe',
    windowsHide: true,
  })
}

function helperStatus() {
  const pidFile = join(stateDir, 'helper.pid')
  const hb = join(stateDir, 'heartbeat.txt')
  const has = existsSync(pidFile)
  let pid = null
  let ageSec = null
  if (has) {
    pid = Number(readFileSync(pidFile, 'utf8').trim())
  }
  if (existsSync(hb)) {
    ageSec = Math.round((Date.now() - statSync(hb).mtimeMs) / 1000)
  }
  return { running: has && ageSec !== null && ageSec <= 5, pid, heartbeatAgeSec: ageSec, stateDir }
}

function main() {
  const env = process.env
  const harness =
    env.DSH_HOME || env.DSH_PROFILE ? 'dsh' : env.CLAUDECODE || env.CLAUDE_CODE_SSE_PORT ? 'claude' : env.CODEX_HOME || env.CODEX_SANDBOX ? 'codex' : 'unknown'

  let psResult = null
  let error = null
  try {
    runPowerShell(ps)
    psResult = JSON.parse(readFileSync(outFile, 'utf8'))
  } catch (e) {
    error = String(e && e.message ? e.message : e)
  } finally {
    try { if (existsSync(outFile)) unlinkSync(outFile) } catch {}
  }

  const helper = helperStatus()
  const probe = {
    ok: !error && psResult && psResult.ok,
    error,
    platform: process.platform,
    node: process.version,
    cwd: process.cwd(),
    skillsRoot: SKILLS_ROOT,
    harness,
    ...psResult,
    gameProc: psResult.game,
    game: gameArg,
    helper,
  }

  // 适配器判定（脚本只能给提示；"我有哪些工具"必须由 agent 自己看）
  const hints = []
  hints.push({ order: 1, adapter: 'native', check: 'agent: 你的工具列表里有 computer-use / screenshot / click 类工具吗？（Claude Code、Codex 等自带）' })
  hints.push({ order: 2, adapter: 'wincu', check: 'DSH: 是否存在 mcp__wincu__windows_computer_use_health（dsh-computer-use-win）' })
  hints.push({
    order: 3,
    adapter: 'ps-helper',
    check: helper.running
      ? `提权助手在跑（pid ${helper.pid}），可直接用 scripts/run-step.mjs --ps`
      : '用 Start-Process -Verb RunAs 起 scripts/helper.ps1 -StateDir <模块 state>（会弹 1 次 UAC）',
  })
  probe.adapterHints = hints
  probe.notes = []
  if (psResult && psResult.screen) {
    if (psResult.screen.width !== 2560 || psResult.screen.height !== 1600) {
      probe.notes.push(`屏幕 ${psResult.screen.width}x${psResult.screen.height} 与模块默认 2560x1600 不一致 → 首次运行要先校准坐标（见 engine/calibration.md）`)
    }
  }
  if (!helper.running) {
    probe.notes.push('提权助手未运行：对管理员权限的游戏窗口（星铁 requireAdministrator）普通权限点击会被 UIPI 拦截')
  }

  const text = pretty ? JSON.stringify(probe, null, 2) : JSON.stringify(probe)
  process.stdout.write(text + '\n')
  process.exit(probe.ok ? 0 : 1)
}

main()
