#!/usr/bin/env node
/**
 * locate.selftest.mjs -- synthetic self-test for the game-daily visual locator.
 *
 * Fixtures are drawn with GDI+ (System.Drawing) from an inline PowerShell script,
 * so the pixels are produced by a *different* resampler than the matcher's own
 * area-average kernel -- the test cannot pass just because both sides share code.
 *
 * Fixtures:
 *   template-120x48.png   120x48 "confirm button": gold frame, navy field and an
 *                         asymmetric glyph-like stroke cluster (five filled bars of
 *                         different width/height/position). Deliberately NOT
 *                         self-similar: the old fixture used uniform blocks, and a
 *                         half-size copy of it still correlated at 0.74, which made
 *                         the test unable to prove anything.
 *   img-0.65.png          the button drawn at 0.65x (78x31)   @ (1400,780)
 *   img-1.00.png          the button drawn at 1.00x (120x48)  @ (600,300)
 *   img-1.60.png          the button drawn at 1.60x (192x77)  @ (900,640)
 *   img-similar.png       "similar but different": the same frame/size button with
 *                         a DIFFERENT stroke layout, twice (120x48 and 150x60).
 *                         This is the case that must never be clicked.
 *   img-negative.png      a busy screen without any button at all
 *   template-200x80.png   perf template (native 200x80)
 *   img-perf.png          perf image, button 1:1 @ (500,420)
 *
 * Assertions (each printed with measured values):
 *   * 0.65x / 1.00x / 1.60x  => found=true, exit 0
 *   * reported scale within 3% of the true scale
 *   * reported centre within 2 px of the true centre
 *   * similar-but-different => found=false and exit code 2
 *   * plain negative sample => found=false and exit code 2 (fail-closed)
 *   * 1920x1080 + 200x80 template => locate.ps1 elapsed < 2500 ms
 *   * -Region restricted search keeps absolute coordinates
 *   * missing template => ok=false + exit 1
 *   * real screenshots (GAME_DAILY_REAL_ROOT, default %TEMP%\hi1080):
 *     tasks.onekey_claim.png on tasks-clean.png => found with score >= 0.95,
 *     the same template on a screen without that button => exit 2.
 *     Skipped (not failed) when those files are absent.
 *
 * Run: node locate.mjs --self-test      (or: node locate.selftest.mjs)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PS_SCRIPT = join(HERE, 'locate.ps1');
export const DEFAULT_PS = process.env.DSH_POWERSHELL || 'powershell.exe';

const SCALE_TOL = 0.03; // lead requirement: reported scale within 3%
const POS_TOL = 2; // centre within 2 px
const PERF_LIMIT_MS = 2500;

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    let key = a.slice(2);
    let val;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    key = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (val === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) val = next;
    }
    if (val === undefined) out[key] = true;
    else {
      out[key] = val;
      i++;
    }
  }
  return out;
}

export function parseJsonLine(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('{')) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** Invoke locate.ps1 and return { code, json, wallMs, stderr, stdout }. */
export function runLocate(psArgs, psPath) {
  const exe = psPath || DEFAULT_PS;
  const t0 = performance.now();
  const r = spawnSync(
    exe,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, ...psArgs],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
  );
  const wallMs = performance.now() - t0;
  return {
    code: r.status === null ? 1 : r.status,
    json: parseJsonLine(r.stdout),
    wallMs,
    stderr: (r.stderr || '').trim(),
    stdout: (r.stdout || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Fixture generator (GDI+, ASCII-only PowerShell for PS 5.1 safety)
// ---------------------------------------------------------------------------
const FIXTURE_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$out = '__OUTDIR__'
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$PNG = [System.Drawing.Imaging.ImageFormat]::Png
$W = 1920
$H = 1080

function New-Bg {
    param([int]$w, [int]$h, [int]$seed)
    $bmp = [System.Drawing.Bitmap]::new($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
    $c1 = [System.Drawing.Color]::FromArgb(255, 40, 44, 52)
    $c2 = [System.Drawing.Color]::FromArgb(255, 96, 104, 118)
    $lgm = [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $c1, $c2, $lgm)
    $g.FillRectangle($bg, $rect)
    $bg.Dispose()
    $rand = [System.Random]::new($seed)
    for ($i = 0; $i -lt 50; $i++) {
        $bw = $rand.Next(20, 120)
        $bh = $rand.Next(10, 90)
        $x = $rand.Next(0, $w - $bw - 1)
        $y = $rand.Next(0, $h - $bh - 1)
        $cr = $rand.Next(30, 200)
        $cg = $rand.Next(30, 200)
        $cb = $rand.Next(30, 200)
        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, $cr, $cg, $cb))
        $g.FillRectangle($brush, $x, $y, $bw, $bh)
        $brush.Dispose()
    }
    $g.Dispose()
    return $bmp
}

# variant 0 = the template button; variant 1 = a different button in the same
# frame at the same size (the "similar but different" trap).
function New-Btn {
    param([int]$w, [int]$h, [int]$variant)
    $bmp = [System.Drawing.Bitmap]::new($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(255, 18, 40, 96))
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $f = $w / 120.0
    $pad = [int][Math]::Round(3 * $f)
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 252, 236, 156), [single](4.0 * $f))
    $g.DrawRectangle($pen, $pad, $pad, $w - 2 * $pad, $h - 2 * $pad)
    $pen.Dispose()
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 245, 248, 255))
    if ($variant -eq 0) {
        $g.FillRectangle($white, [single](22 * $f), [single](13 * $f), [single](9 * $f), [single](22 * $f))
        $g.FillRectangle($white, [single](38 * $f), [single](9 * $f), [single](6 * $f), [single](30 * $f))
        $g.FillRectangle($white, [single](52 * $f), [single](16 * $f), [single](11 * $f), [single](16 * $f))
        $g.FillRectangle($white, [single](22 * $f), [single](26 * $f), [single](40 * $f), [single](5 * $f))
        $g.FillRectangle($white, [single](74 * $f), [single](14 * $f), [single](8 * $f), [single](20 * $f))
        $g.FillRectangle($white, [single](70 * $f), [single](26 * $f), [single](34 * $f), [single](6 * $f))
    }
    else {
        $g.FillRectangle($white, [single](16 * $f), [single](20 * $f), [single](34 * $f), [single](7 * $f))
        $g.FillRectangle($white, [single](16 * $f), [single](31 * $f), [single](30 * $f), [single](7 * $f))
        $g.FillRectangle($white, [single](60 * $f), [single](12 * $f), [single](6 * $f), [single](26 * $f))
        $g.FillRectangle($white, [single](78 * $f), [single](12 * $f), [single](6 * $f), [single](26 * $f))
        $g.FillRectangle($white, [single](60 * $f), [single](22 * $f), [single](24 * $f), [single](6 * $f))
    }
    $white.Dispose()
    $g.Dispose()
    return $bmp
}

$tpl = New-Btn 120 48 0
$tpl.Save((Join-Path $out 'template-120x48.png'), $PNG)

$scales = @(0.65, 1.00, 1.60)
$posX = @(1400, 600, 900)
$posY = @(780, 300, 640)
for ($i = 0; $i -lt $scales.Count; $i++) {
    $s = $scales[$i]
    $px = $posX[$i]
    $py = $posY[$i]
    $tw = [int][Math]::Round(120 * $s)
    $th = [int][Math]::Round(48 * $s)
    $img = New-Bg -w $W -h $H -seed ([int]($s * 100) + 7)
    $g = [System.Drawing.Graphics]::FromImage($img)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($tpl, $px, $py, $tw, $th)
    $g.Dispose()
    $name = 'img-' + $s.ToString('0.00', $inv) + '.png'
    $img.Save((Join-Path $out $name), $PNG)
    $img.Dispose()
    Write-Output ('CASE ' + $s.ToString('0.0000', $inv) + ' ' + $px + ' ' + $py + ' ' + $tw + ' ' + $th)
}
$tpl.Dispose()

$neg = New-Bg -w $W -h $H -seed 424242
$neg.Save((Join-Path $out 'img-negative.png'), $PNG)
$neg.Dispose()

$other = New-Btn 120 48 1
$sim = New-Bg -w $W -h $H -seed 515151
$g = [System.Drawing.Graphics]::FromImage($sim)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($other, 600, 300, 120, 48)
$g.DrawImage($other, 1300, 700, 150, 60)
$g.Dispose()
$sim.Save((Join-Path $out 'img-similar.png'), $PNG)
$sim.Dispose()
$other.Dispose()

$big = New-Btn 200 80 0
$big.Save((Join-Path $out 'template-200x80.png'), $PNG)
$perf = New-Bg -w $W -h $H -seed 909090
$g = [System.Drawing.Graphics]::FromImage($perf)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($big, 500, 420, 200, 80)
$g.Dispose()
$perf.Save((Join-Path $out 'img-perf.png'), $PNG)
$perf.Dispose()
$big.Dispose()

Write-Output 'PERF 500 420 200 80'
Write-Output 'FIXTURES-DONE'
`;

function buildFixtures(dir, ps) {
  const scriptPath = join(dir, 'make-fixtures.ps1');
  const body = FIXTURE_PS.replace('__OUTDIR__', dir.replace(/'/g, "''"));
  writeFileSync(scriptPath, body, 'utf8');
  const r = spawnSync(
    ps,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
  );
  const stdout = r.stdout || '';
  const cases = [];
  let perf = null;
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'CASE' && t.length >= 6) {
      cases.push({
        scale: Number(t[1]),
        px: Number(t[2]),
        py: Number(t[3]),
        tw: Number(t[4]),
        th: Number(t[5]),
      });
    } else if (t[0] === 'PERF' && t.length >= 5) {
      perf = { px: Number(t[1]), py: Number(t[2]), tw: Number(t[3]), th: Number(t[4]) };
    }
  }
  return {
    ok: r.status === 0 && /\bFIXTURES-DONE\b/.test(stdout) && cases.length === 3 && !!perf,
    cases,
    perf,
    stdout,
    stderr: (r.stderr || '').trim(),
    code: r.status === null ? 1 : r.status,
  };
}

// ---------------------------------------------------------------------------
// Self test
// ---------------------------------------------------------------------------
export function runSelfTest(opts = {}) {
  const ps = opts.ps || DEFAULT_PS;
  const log = opts.quiet ? () => {} : (line) => console.log(line);
  const checks = [];
  const check = (ok, label, detail) => {
    checks.push({ ok, label, detail });
    return ok;
  };
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : 'n/a');

  if (!existsSync(PS_SCRIPT)) {
    console.error(`locate.ps1 not found next to locate.selftest.mjs: ${PS_SCRIPT}`);
    return 1;
  }

  const keep = Boolean(opts.keep);
  const dir = opts.dir || mkdtempSync(join(tmpdir(), 'locate-selftest-'));
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(`cannot create fixture dir ${dir}: ${e && e.message ? e.message : e}`);
    return 1;
  }
  log(`self-test: fixtures -> ${dir}`);
  log(`self-test: powershell -> ${ps}`);
  log(`self-test: locate.ps1 -> ${PS_SCRIPT}`);
  log('');

  let exitCode = 0;
  let perfMs = 0;
  let perfWall = 0;
  try {
    let fx;
    try {
      fx = buildFixtures(dir, ps);
    } catch (e) {
      console.error(`fixture generation threw: ${e && e.message ? e.message : e}`);
      return 1;
    }
    if (!fx.ok) {
      console.error(`fixture generation failed (exit ${fx.code})${fx.stderr ? ': ' + fx.stderr : ''}`);
      console.error(fx.stdout.slice(-2000));
      return 1;
    }

    // ---- positives: 0.65x / 1.00x / 1.60x ---------------------------------
    const tpl = join(dir, 'template-120x48.png');
    for (const c of fx.cases) {
      const imgPath = join(dir, `img-${c.scale.toFixed(2)}.png`);
      const expCx = c.px + c.tw / 2;
      const expCy = c.py + c.th / 2;
      const r = runLocate(['-Image', imgPath, '-Template', tpl, '-Json'], ps);
      const j = r.json || {};
      const found = r.code === 0 && j.ok === true && j.found === true;
      const scaleErr = found ? Math.abs(Number(j.scale) - c.scale) / c.scale : NaN;
      const dx = found ? Math.abs(Number(j.cx) - expCx) : NaN;
      const dy = found ? Math.abs(Number(j.cy) - expCy) : NaN;
      const okScale = found && scaleErr <= SCALE_TOL;
      const okPos = found && dx <= POS_TOL && dy <= POS_TOL;
      const pass = found && okScale && okPos;

      let line = `[${pass ? 'PASS' : 'FAIL'}] scale ${c.scale.toFixed(2)}  found=${j.found} `;
      line += `score=${num(j.score, 4)} scale=${num(j.scale, 4)} (err ${found ? (scaleErr * 100).toFixed(2) : 'n/a'}%) `;
      line += `center=(${j.cx},${j.cy}) want=(${expCx},${expCy}) dev=(${found ? dx.toFixed(1) : 'n/a'},${found ? dy.toFixed(1) : 'n/a'})px `;
      line += `size=${j.w}x${j.h} want=${c.tw}x${c.th} uniqueness=${num(j.uniqueness, 3)} `;
      line += `exit=${r.code} locate=${j.elapsedMs}ms wall=${Math.round(r.wallMs)}ms`;
      log(line);
      if (!pass) log(`        json=${JSON.stringify(j)} stderr=${r.stderr.slice(0, 400)}`);

      check(found, `scale ${c.scale.toFixed(2)}: found`, `exit=${r.code} found=${j.found} score=${j.score}`);
      check(okScale, `scale ${c.scale.toFixed(2)}: reported scale within ${SCALE_TOL * 100}%`, `${found ? (scaleErr * 100).toFixed(2) + '%' : 'n/a'} (got ${j.scale}, want ${c.scale})`);
      check(okPos, `scale ${c.scale.toFixed(2)}: centre within ${POS_TOL}px`, `dx=${found ? dx.toFixed(2) : 'n/a'} dy=${found ? dy.toFixed(2) : 'n/a'}`);
    }

    // ---- similar but different: must not be clicked ------------------------
    {
      const imgPath = join(dir, 'img-similar.png');
      const r = runLocate(['-Image', imgPath, '-Template', tpl, '-Json'], ps);
      const j = r.json || {};
      const sc = Number(j.score);
      const okSim = r.code === 2 && j.ok === true && j.found === false;
      log(
        `[${okSim ? 'PASS' : 'FAIL'}] similar      same frame+size, different glyphs => found=${j.found} score=${num(sc, 4)} threshold=${j.found ? 'n/a' : '0.72'} ambiguous=${j.ambiguous} uniqueness=${num(j.uniqueness, 3)} exit=${r.code} (must be exit 2 / found=false)`
      );
      if (!okSim) log(`        json=${JSON.stringify(j)} stderr=${r.stderr.slice(0, 400)}`);
      check(okSim, 'similar-but-different button: fail-closed (found=false + exit 2)', `found=${j.found} score=${j.score} exit=${r.code}`);
    }

    // ---- plain negative: nothing to find ----------------------------------
    {
      const imgPath = join(dir, 'img-negative.png');
      const r = runLocate(['-Image', imgPath, '-Template', tpl, '-Json'], ps);
      const j = r.json || {};
      const okNeg = r.code === 2 && j.ok === true && j.found === false;
      log(
        `[${okNeg ? 'PASS' : 'FAIL'}] negative     no button on screen => found=${j.found} score=${num(j.score, 4)} uniqueness=${num(j.uniqueness, 3)} exit=${r.code} (must be exit 2 / found=false)`
      );
      if (!okNeg) log(`        json=${JSON.stringify(j)} stderr=${r.stderr.slice(0, 400)}`);
      check(okNeg, 'negative sample: fail-closed (found=false + exit 2)', `found=${j.found} score=${j.score} exit=${r.code}`);
    }

    // ---- worst case: 1920x1080, 200x80 template ---------------------------
    {
      const imgPath = join(dir, 'img-perf.png');
      const tplBig = join(dir, 'template-200x80.png');
      const r = runLocate(['-Image', imgPath, '-Template', tplBig, '-Json'], ps);
      const j = r.json || {};
      perfMs = Number(j.elapsedMs) || 0;
      perfWall = r.wallMs;
      const fits = Math.abs(Number(j.x) - fx.perf.px) <= POS_TOL && Math.abs(Number(j.y) - fx.perf.py) <= POS_TOL;
      const okPerf = r.code === 0 && j.found === true && perfMs > 0 && perfMs < PERF_LIMIT_MS && fits;
      log(
        `[${okPerf ? 'PASS' : 'FAIL'}] worstcase    1920x1080 + 200x80 template found=${j.found} score=${num(j.score, 4)} scale=${num(j.scale, 3)} pos=(${j.x},${j.y}) want=(${fx.perf.px},${fx.perf.py}) locate=${perfMs}ms wall=${Math.round(perfWall)}ms limit=${PERF_LIMIT_MS}ms`
      );
      if (!okPerf) log(`        exit=${r.code} json=${JSON.stringify(j)} stderr=${r.stderr.slice(0, 400)}`);
      check(okPerf, `worst case 1920x1080 + 200x80 template < ${PERF_LIMIT_MS}ms`, `locate=${perfMs}ms wall=${Math.round(perfWall)}ms pos=(${j.x},${j.y})`);

      // ---- -Region: restricted search, absolute coordinates out -----------
      const rx = 400;
      const ry = 320;
      const rw = 700;
      const rh = 400;
      const r2 = runLocate(['-Image', imgPath, '-Template', tplBig, '-Region', `${rx},${ry},${rw},${rh}`, '-Json'], ps);
      const j2 = r2.json || {};
      const inside =
        j2.ok === true &&
        j2.found === true &&
        j2.region &&
        j2.region.x === rx &&
        j2.region.y === ry &&
        j2.region.w === rw &&
        j2.region.h === rh &&
        j2.x >= rx &&
        j2.y >= ry &&
        j2.x + j2.w <= rx + rw &&
        j2.y + j2.h <= ry + rh;
      const okRegion = r2.code === 0 && inside;
      log(
        `[${okRegion ? 'PASS' : 'FAIL'}] region       found=${j2.found} pos=(${j2.x},${j2.y}) want=(${fx.perf.px},${fx.perf.py}) region=${j2.region ? `${j2.region.x},${j2.region.y},${j2.region.w},${j2.region.h}` : 'n/a'} locate=${j2.elapsedMs}ms (coords stay absolute)`
      );
      if (!okRegion) log(`        exit=${r2.code} json=${JSON.stringify(j2)} stderr=${r2.stderr.slice(0, 400)}`);
      check(okRegion, '-Region: restricted search + absolute coordinates', `pos=(${j2.x},${j2.y}) region=${JSON.stringify(j2.region)}`);

      // ---- fail-closed on a parameter error -------------------------------
      const r3 = runLocate(['-Image', imgPath, '-Template', join(dir, 'does-not-exist.png'), '-Json'], ps);
      const j3 = r3.json || {};
      const okErr = r3.code === 1 && j3.ok === false && typeof j3.error === 'string' && j3.error.length > 0;
      log(`[${okErr ? 'PASS' : 'FAIL'}] badparam     exit=${r3.code} (must be 1) ok=${j3.ok} error="${j3.error || ''}"`);
      check(okErr, 'parameter error: ok=false + exit 1', `exit=${r3.code} error=${j3.error}`);

      // ---- real material regression (skipped, not failed, when absent) ----
      const realRoot =
        process.env.GAME_DAILY_REAL_ROOT || join(process.env.TEMP || tmpdir(), 'hi1080');
      const realImg = join(realRoot, 'shots', 'tasks-clean.png');
      const realTpl = join(realRoot, 'templates', 'tasks.onekey_claim.png');
      const realNeg = join(realRoot, 'shots', 's02-after-claim.png');
      if (!existsSync(realImg) || !existsSync(realTpl) || !existsSync(realNeg)) {
        log(`[SKIP] real        real screenshots not found under ${realRoot} (set GAME_DAILY_REAL_ROOT)`);
      } else {
        const rp = runLocate(['-Image', realImg, '-Template', realTpl, '-Json'], ps);
        const jp = rp.json || {};
        const okReal = rp.code === 0 && jp.found === true && Number(jp.score) >= 0.95;
        log(
          `[${okReal ? 'PASS' : 'FAIL'}] real-hit    1920x1080 tasks-clean + onekey_claim found=${jp.found} score=${num(jp.score, 4)} scale=${num(jp.scale, 3)} center=(${jp.cx},${jp.cy}) box=${jp.x},${jp.y},${jp.w},${jp.h} uniqueness=${num(jp.uniqueness, 4)} exit=${rp.code} locate=${jp.elapsedMs}ms (need found=true, score>=0.95)`
        );
        if (!okReal) log(`        json=${JSON.stringify(jp)} stderr=${rp.stderr.slice(0, 400)}`);
        check(
          okReal,
          'real screenshot: onekey_claim found with score >= 0.95',
          `found=${jp.found} score=${jp.score} exit=${rp.code}`
        );

        const rn = runLocate(['-Image', realNeg, '-Template', realTpl, '-Json'], ps);
        const jn = rn.json || {};
        const okRealNeg = rn.code === 2 && jn.found === false;
        log(
          `[${okRealNeg ? 'PASS' : 'FAIL'}] real-miss   same template on a screen without that button found=${jn.found} score=${num(jn.score, 4)} uniqueness=${num(jn.uniqueness, 4)} exit=${rn.code} (must be 2)`
        );
        if (!okRealNeg) log(`        json=${JSON.stringify(jn)} stderr=${rn.stderr.slice(0, 400)}`);
        check(
          okRealNeg,
          'real screenshot without the button: fail-closed (exit 2)',
          `found=${jn.found} score=${jn.score} exit=${rn.code}`
        );
      }
    }
  } finally {
    if (keep) log(`\nfixtures kept in ${dir}`);
    else {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  log('');
  if (failed > 0) {
    log('failed checks:');
    for (const c of checks) if (!c.ok) log(`  - ${c.label}: ${c.detail}`);
  }
  log(`SELF-TEST ${failed === 0 ? 'PASS' : 'FAIL'}: ${passed}/${checks.length} checks passed`);
  log(`worst-case locate.ps1 time: ${perfMs}ms (wall ${Math.round(perfWall)}ms incl. powershell startup + Add-Type compile)`);
  exitCode = failed === 0 ? 0 : 1;
  return exitCode;
}

// Allow standalone use: node locate.selftest.mjs [--keep] [--ps <exe>] [--dir <dir>]
const isMain = (() => {
  try {
    return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
})();
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  process.exitCode = runSelfTest(opts);
}
