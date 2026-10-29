#!/usr/bin/env node
/**
 * locate.mjs -- thin Node wrapper around locate.ps1 (the game-daily visual locator).
 *
 * Zero third-party dependencies (Node >= 18). All matching happens in locate.ps1
 * (PowerShell 5.1 + System.Drawing); this file only:
 *   * forwards CLI flags to locate.ps1,
 *   * parses its single-line JSON result and echoes it,
 *   * passes its exit code through unchanged:
 *       0 = ok + found
 *       2 = ok + NOT found  (fail-closed: callers MUST refuse to click)
 *       1 = parameter / file / runtime error
 *
 * Usage:
 *   node locate.mjs --image shot.png --template btn.png [--region x,y,w,h]
 *                   [--threshold 0.72] [--min-scale 0.5] [--max-scale 2.5]
 *                   [--scales 12] [--window "<window title>"] [--json] [--quiet]
 *   node locate.mjs --self-test [--keep] [--ps powershell.exe]
 *
 * --json   print ONLY the JSON line (machine consumption)
 * --quiet  print nothing, just exit with the status code
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PS_SCRIPT = join(HERE, 'locate.ps1');
export const DEFAULT_PS = process.env.DSH_POWERSHELL || 'powershell.exe';

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

/** Build the locate.ps1 argument list from wrapper options. */
export function psArgs(opts) {
  const args = [];
  if (opts.image) args.push('-Image', String(opts.image));
  if (opts.template) args.push('-Template', String(opts.template));
  if (opts.region) args.push('-Region', String(opts.region));
  if (opts.window) args.push('-Window', String(opts.window));
  if (opts.threshold !== undefined) args.push('-Threshold', String(opts.threshold));
  if (opts.minScale !== undefined) args.push('-MinScale', String(opts.minScale));
  if (opts.maxScale !== undefined) args.push('-MaxScale', String(opts.maxScale));
  if (opts.scales !== undefined) args.push('-ScaleSteps', String(opts.scales));
  args.push('-Json');
  return args;
}

/** Run locate.ps1; returns { code, json, wallMs, stderr, stdout }. */
export function runLocate(args, psPath) {
  const exe = psPath || DEFAULT_PS;
  const t0 = performance.now();
  const r = spawnSync(
    exe,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, ...args],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
  );
  return {
    code: r.status === null ? 1 : r.status,
    json: parseJsonLine(r.stdout),
    wallMs: performance.now() - t0,
    stderr: (r.stderr || '').trim(),
    stdout: (r.stdout || '').trim(),
  };
}

export function humanLine(j) {
  if (!j || j.ok !== true) {
    return 'locate failed: ' + (j && j.error ? j.error : 'unparseable output');
  }
  const s = Number(j.score);
  const sc = Number(j.scale);
  const head = j.found
    ? `FOUND score=${s.toFixed(4)} scale=${sc.toFixed(4)} center=(${j.cx},${j.cy})`
    : `NOT-FOUND score=${s.toFixed(4)} bestScale=${sc.toFixed(4)}`;
  const body = `box=${j.x},${j.y},${j.w},${j.h} region=${j.region.x},${j.region.y},${j.region.w},${j.region.h} scales=${j.scalesTried} elapsed=${j.elapsedMs}ms`;
  // Append the verdict fields only when locate.ps1 supplied them, so the
  // original one-line skeleton stays byte-identical for line parsers.
  const extra = [];
  const reason = typeof j.reason === 'string' && j.reason
    ? j.reason
    : !j.found
      ? j.ambiguous === true
        ? 'ambiguous(duplicate match)'
        : 'score<threshold'
      : '';
  if (reason) extra.push(`reason=${reason}`);
  if (typeof j.uniqueness === 'number') extra.push(`uniqueness=${j.uniqueness.toFixed(4)}`);
  return extra.length ? `${head} ${body} ${extra.join(' ')}` : `${head} ${body}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.selfTest) {
    const mod = await import('./locate.selftest.mjs');
    process.exitCode = mod.runSelfTest(opts);
    return;
  }

  if (!existsSync(PS_SCRIPT)) {
    console.error(`locate.ps1 not found next to locate.mjs: ${PS_SCRIPT}`);
    process.exitCode = 1;
    return;
  }

  const r = runLocate(psArgs(opts), opts.ps);
  if (!r.json) {
    console.error(`locate.ps1 produced no JSON (exit ${r.code})${r.stderr ? ': ' + r.stderr : ''}`);
    process.exitCode = 1;
    return;
  }
  if (opts.quiet) {
    /* nothing on stdout */
  } else if (opts.json) {
    process.stdout.write(JSON.stringify(r.json) + '\n');
  } else {
    console.log(humanLine(r.json));
  }
  process.exitCode = r.code === 0 || r.code === 2 ? r.code : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
