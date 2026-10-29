#requires -Version 5.1
<#
  locate.ps1 -- multi-scale ZNCC (zero-normalized cross correlation) template matcher.

  Purpose: give the "game daily" skills a "see it before you click it" primitive.
  Zero third-party dependencies. Windows PowerShell 5.1 + System.Drawing only.

  CLI:
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File locate.ps1 `
        -Image shot.png -Template btn.png [-Region "x,y,w,h"] [-MinScale 0.5] [-MaxScale 2.5] `
        [-ScaleSteps 12] [-Threshold 0.72] [-Json] [-Window "<window title substring>"]

  Output (-Json => exactly ONE json line on stdout):
    {"ok":true,"found":true,"score":0.93,"scale":1.02,"x":123,"y":456,"w":88,"h":40,
     "cx":167,"cy":476,"region":{"x":0,"y":0,"w":1920,"h":1080},
     "template":{"w":88,"h":40},"image":{"w":1920,"h":1080},
     "scalesTried":30,"runnerUp":0.4123,"uniqueness":0.5231,"ambiguous":false,
     "elapsedMs":420}

  Exit codes (fail-closed is a hard requirement -- callers refuse to click on exit 2):
    0 = ok and found        (score >= threshold AND the match is unique)
    2 = ok but NOT found    (score < threshold, OR an equally good match exists
                             elsewhere -> "ambiguous", which must never be clicked)
    1 = parameter / file / runtime error  (also emits {"ok":false,"error":"..."})

  Ambiguity guard: every match position the search sees is remembered, and
  uniqueness = score - (best score from a position far enough away to be a
  DIFFERENT match). A duplicate-looking button (two identical "OK" buttons, or a
  similar-but-different button on another panel scoring just as high) makes
  uniqueness small; below 0.05 the result is reported found=false even when the
  raw score clears the threshold, because there is no evidence-backed place to
  click.

  Coordinates: x/y are the top-left of the matched (scaled) template in FULL-IMAGE
  pixels (region offset already added back). cx/cy = x + w/2, y + h/2.
  With -Window, the image is the window CLIENT area, so all coordinates are
  relative to the client-area top-left corner.

  Algorithm (all heavy lifting is compiled C#, so no per-pixel PS overhead):
    * grayscale (0.299R + 0.587G + 0.114B)
    * ZNCC over a box-downsampled pyramid (factors 2/4/8/16) for the coarse pass
    * per scale, pick the cheapest pyramid level whose coarse template still has
      enough pixels to be distinctive (~>= 84 samples), exhaustive search there
    * keep the 8 best separated coarse peaks, cascade each one down the pyramid
      (window +-3 at every halving), then a final +-2 px full-resolution refine
    * scales: geometric series min..max with at least 16 points (<ScaleSteps> is a
      floor), the point nearest 1.0 snapped onto exactly 1.0, then the two best
      separated candidates are refined in log-scale space (halving steps, local
      +-radius window only) down to ~0.5% resolution
    * each run also records every candidate position, which powers the uniqueness
      guard described above
#>
[CmdletBinding()]
param(
    [string]$Image,
    [string]$Template,
    [string]$Region,
    [double]$MinScale = 0.5,
    [double]$MaxScale = 2.5,
    [int]$ScaleSteps = 12,
    [double]$Threshold = 0.72,
    [string]$Window,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$script:CI = [System.Globalization.CultureInfo]::InvariantCulture

# Force UTF-8 on stdout: callers (node, python) decode our single json line as
# UTF-8, while a zh-CN console defaults to GBK and would turn any non-ASCII
# (a chinese window title, a chinese error string) into mojibake.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

function Out-Line([string]$Text) {
    [Console]::Out.WriteLine($Text)
    [Console]::Out.Flush()
}

# Innermost exception message: a C# throw surfaces as a localized
# MethodInvocationException wrapper ("Exception calling ..."), which is both
# useless to the caller and non-ASCII in a zh-CN session.
function Get-RootMessage([System.Management.Automation.ErrorRecord]$Rec) {
    if ($null -eq $Rec) { return 'unknown error' }
    $e = $Rec.Exception
    if ($null -eq $e) { return [string]$Rec }
    while ($null -ne $e.InnerException) { $e = $e.InnerException }
    if ([string]::IsNullOrWhiteSpace($e.Message)) { return [string]$Rec }
    return $e.Message
}

function Exit-Failure([string]$Message) {
    $m = [string]$Message
    if ([string]::IsNullOrWhiteSpace($m)) { $m = 'unknown error' }
    $m = $m.Replace('\', '\\')
    $m = $m.Replace('"', '\"')
    $m = $m.Replace("`t", ' ')
    $m = $m.Replace("`r", ' ')
    $m = $m.Replace("`n", ' ')
    Out-Line ('{"ok":false,"error":"' + $m + '"}')
    exit 1
}

function Fmt-Num([double]$Value, [string]$Pattern) {
    return ([double]$Value).ToString($Pattern, $script:CI)
}

function Fmt-Int([double]$Value) {
    return ([long][Math]::Round([double]$Value)).ToString($script:CI)
}

# ---------------------------------------------------------------------------
# Core matcher (always compiled; no Win32 capture code here so the hot path
# compiles faster).
# ---------------------------------------------------------------------------
$script:CsCore = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace DshLocate
{
    public sealed class DsLevel
    {
        public int F;
        public int W;
        public int H;
        public float[] Pix;
        public double[] Sum;
        public double[] SumSq;
    }

    public sealed class DsResult
    {
        public bool Found;
        public double Score;
        public double Scale;
        public int X;
        public int Y;
        public int W;
        public int H;
        public int ScalesTried;
        public double ElapsedMs;
        public double RunnerUp;
        public bool Ambiguous;
        public string Error;
    }

    public static class DsImg
    {
        public static Bitmap LoadBitmap(string path)
        {
            byte[] raw = System.IO.File.ReadAllBytes(path);
            using (System.IO.MemoryStream ms = new System.IO.MemoryStream(raw))
            {
                using (Image im = Image.FromStream(ms))
                {
                    Bitmap copy = new Bitmap(im.Width, im.Height, PixelFormat.Format32bppArgb);
                    using (Graphics g = Graphics.FromImage(copy))
                    {
                        g.DrawImage(im, new Rectangle(0, 0, im.Width, im.Height));
                    }
                    return copy;
                }
            }
        }

        public static Bitmap Crop(Bitmap src, int x, int y, int w, int h)
        {
            if (x < 0) { w += x; x = 0; }
            if (y < 0) { h += y; y = 0; }
            if (x + w > src.Width) { w = src.Width - x; }
            if (y + h > src.Height) { h = src.Height - y; }
            if (w < 1) { w = 1; }
            if (h < 1) { h = 1; }
            Bitmap dst = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(dst))
            {
                g.DrawImage(src, new Rectangle(0, 0, w, h), new Rectangle(x, y, w, h), GraphicsUnit.Pixel);
            }
            return dst;
        }

        public static byte[] Gray(Bitmap src)
        {
            int w = src.Width;
            int h = src.Height;
            Bitmap work = src;
            bool owned = false;
            if (src.PixelFormat != PixelFormat.Format32bppArgb)
            {
                work = new Bitmap(w, h, PixelFormat.Format32bppArgb);
                using (Graphics g = Graphics.FromImage(work))
                {
                    g.DrawImage(src, new Rectangle(0, 0, w, h));
                }
                owned = true;
            }
            byte[] gray = new byte[w * h];
            BitmapData bd = work.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                int stride = bd.Stride;
                byte[] buf = new byte[stride * h];
                Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
                for (int y = 0; y < h; y++)
                {
                    int off = y * stride;
                    int go = y * w;
                    for (int x = 0; x < w; x++)
                    {
                        int i = off + x * 4;
                        gray[go + x] = (byte)((buf[i + 2] * 77 + buf[i + 1] * 151 + buf[i] * 28) >> 8);
                    }
                }
            }
            finally
            {
                work.UnlockBits(bd);
                if (owned) { work.Dispose(); }
            }
            return gray;
        }
    }

    public static class DsMatcher
    {
        // ----- pyramid level -------------------------------------------------
        static DsLevel BuildLevel(byte[] gray, int w, int h, int f)
        {
            int W = w / f;
            int H = h / f;
            float[] pix = new float[W * H];
            double inv = 1.0 / (double)(f * f);
            for (int y = 0; y < H; y++)
            {
                int sy = y * f;
                for (int x = 0; x < W; x++)
                {
                    int sx = x * f;
                    int acc = 0;
                    for (int j = 0; j < f; j++)
                    {
                        int ro = (sy + j) * w + sx;
                        for (int i = 0; i < f; i++) { acc += gray[ro + i]; }
                    }
                    pix[y * W + x] = (float)(acc * inv);
                }
            }
            int w1 = W + 1;
            double[] sum = new double[w1 * (H + 1)];
            double[] sumSq = new double[w1 * (H + 1)];
            for (int y = 0; y < H; y++)
            {
                int rowBase = y * W;
                int cur = (y + 1) * w1;
                int prev = y * w1;
                double rs = 0.0;
                double rs2 = 0.0;
                for (int x = 0; x < W; x++)
                {
                    double v = pix[rowBase + x];
                    rs += v;
                    rs2 += v * v;
                    sum[cur + x + 1] = sum[prev + x + 1] + rs;
                    sumSq[cur + x + 1] = sumSq[prev + x + 1] + rs2;
                }
            }
            DsLevel L = new DsLevel();
            L.F = f; L.W = W; L.H = H; L.Pix = pix; L.Sum = sum; L.SumSq = sumSq;
            return L;
        }

        static DsLevel GetLevel(List<DsLevel> levels, int f)
        {
            for (int i = 0; i < levels.Count; i++) { if (levels[i].F == f) { return levels[i]; } }
            return null;
        }

        // ----- template resampling (area average when shrinking, bilinear when growing)
        static float[] Resample(byte[] src, int sw, int sh, int dw, int dh)
        {
            float[] dst = new float[dw * dh];
            if (dw == sw && dh == sh)
            {
                for (int i = 0; i < dst.Length; i++) { dst[i] = src[i]; }
                return dst;
            }
            if (dw <= sw && dh <= sh)
            {
                for (int y = 0; y < dh; y++)
                {
                    double y0 = (double)y * sh / dh;
                    double y1 = (double)(y + 1) * sh / dh;
                    int iy0 = (int)Math.Floor(y0);
                    int iy1 = (int)Math.Ceiling(y1);
                    if (iy0 < 0) { iy0 = 0; }
                    if (iy1 > sh) { iy1 = sh; }
                    if (iy1 <= iy0) { iy1 = iy0 + 1; }
                    for (int x = 0; x < dw; x++)
                    {
                        double x0 = (double)x * sw / dw;
                        double x1 = (double)(x + 1) * sw / dw;
                        int ix0 = (int)Math.Floor(x0);
                        int ix1 = (int)Math.Ceiling(x1);
                        if (ix0 < 0) { ix0 = 0; }
                        if (ix1 > sw) { ix1 = sw; }
                        if (ix1 <= ix0) { ix1 = ix0 + 1; }
                        double acc = 0.0;
                        int cnt = 0;
                        for (int j = iy0; j < iy1; j++)
                        {
                            int ro = j * sw;
                            for (int i = ix0; i < ix1; i++) { acc += src[ro + i]; cnt++; }
                        }
                        dst[y * dw + x] = (cnt > 0) ? (float)(acc / cnt) : 0f;
                    }
                }
                return dst;
            }
            for (int y = 0; y < dh; y++)
            {
                double sy = ((y + 0.5) * sh / dh) - 0.5;
                if (sy < 0) { sy = 0; }
                if (sy > sh - 1) { sy = sh - 1; }
                int y0 = (int)sy;
                int y1 = (y0 + 1 < sh) ? y0 + 1 : y0;
                double fy = sy - y0;
                for (int x = 0; x < dw; x++)
                {
                    double sx = ((x + 0.5) * sw / dw) - 0.5;
                    if (sx < 0) { sx = 0; }
                    if (sx > sw - 1) { sx = sw - 1; }
                    int x0 = (int)sx;
                    int x1 = (x0 + 1 < sw) ? x0 + 1 : x0;
                    double fx = sx - x0;
                    double v =
                        src[y0 * sw + x0] * (1 - fx) * (1 - fy) +
                        src[y0 * sw + x1] * fx * (1 - fy) +
                        src[y1 * sw + x0] * (1 - fx) * fy +
                        src[y1 * sw + x1] * fx * fy;
                    dst[y * dw + x] = (float)v;
                }
            }
            return dst;
        }

        static float[] Downsample(float[] src, int sw, int sh, int f)
        {
            int W = sw / f;
            int H = sh / f;
            if (W < 1) { W = 1; }
            if (H < 1) { H = 1; }
            float[] dst = new float[W * H];
            double inv = 1.0 / (double)(f * f);
            for (int y = 0; y < H; y++)
            {
                for (int x = 0; x < W; x++)
                {
                    double acc = 0.0;
                    for (int j = 0; j < f; j++)
                    {
                        int ro = (y * f + j) * sw;
                        for (int i = 0; i < f; i++) { acc += src[ro + x * f + i]; }
                    }
                    dst[y * W + x] = (float)(acc * inv);
                }
            }
            return dst;
        }

        // ----- score maps ----------------------------------------------------
        static float[] ComputeScores(DsLevel L, float[] t, int tw2, int th2,
                                     int x0, int y0, int x1, int y1,
                                     out int ox, out int oy, out int ow, out int oh)
        {
            ox = 0; oy = 0; ow = 0; oh = 0;
            int maxX = L.W - tw2;
            int maxY = L.H - th2;
            if (maxX < 0 || maxY < 0 || tw2 < 2 || th2 < 2) { return null; }
            if (x0 < 0) { x0 = 0; }
            if (y0 < 0) { y0 = 0; }
            if (x1 > maxX) { x1 = maxX; }
            if (y1 > maxY) { y1 = maxY; }
            if (x1 < x0 || y1 < y0) { return null; }
            ox = x0; oy = y0; ow = x1 - x0 + 1; oh = y1 - y0 + 1;
            float[] sc = new float[ow * oh];
            int n = tw2 * th2;
            double sumT = 0.0;
            double sumT2 = 0.0;
            for (int i = 0; i < n; i++) { double v = t[i]; sumT += v; sumT2 += v * v; }
            double varT = n * sumT2 - sumT * sumT;
            if (varT <= 1e-6)
            {
                for (int i = 0; i < sc.Length; i++) { sc[i] = -1f; }
                return sc;
            }
            float[] pix = L.Pix;
            double[] sum = L.Sum;
            double[] sumSq = L.SumSq;
            int w1 = L.W + 1;
            int lw = L.W;
            int oi = 0;
            for (int py = y0; py <= y1; py++)
            {
                int rowBase = py * lw;
                for (int px = x0; px <= x1; px++)
                {
                    double sIT = 0.0;
                    int ri = rowBase + px;
                    for (int j = 0; j < th2; j++)
                    {
                        int r = ri + j * lw;
                        int rt = j * tw2;
                        for (int i = 0; i < tw2; i++) { sIT += (double)pix[r + i] * (double)t[rt + i]; }
                    }
                    int a = py * w1 + px;
                    int b = a + tw2;
                    int c = (py + th2) * w1 + px;
                    int d = c + tw2;
                    double sI = sum[d] - sum[b] - sum[c] + sum[a];
                    double sI2 = sumSq[d] - sumSq[b] - sumSq[c] + sumSq[a];
                    double varI = n * sI2 - sI * sI;
                    if (varI <= 1e-6) { sc[oi] = -1f; oi++; continue; }
                    double cov = n * sIT - sI * sumT;
                    sc[oi] = (float)(cov / Math.Sqrt(varI * varT));
                    oi++;
                }
            }
            return sc;
        }

        static float[] ComputeDirectScores(byte[] gray, int iw, int ih, float[] t, int Tw, int Th,
                                           int x0, int y0, int x1, int y1,
                                           out int ox, out int oy, out int ow, out int oh)
        {
            ox = 0; oy = 0; ow = 0; oh = 0;
            int maxX = iw - Tw;
            int maxY = ih - Th;
            if (maxX < 0 || maxY < 0 || Tw < 2 || Th < 2) { return null; }
            if (x0 < 0) { x0 = 0; }
            if (y0 < 0) { y0 = 0; }
            if (x1 > maxX) { x1 = maxX; }
            if (y1 > maxY) { y1 = maxY; }
            if (x1 < x0 || y1 < y0) { return null; }
            ox = x0; oy = y0; ow = x1 - x0 + 1; oh = y1 - y0 + 1;
            float[] sc = new float[ow * oh];
            int n = Tw * Th;
            double sumT = 0.0;
            double sumT2 = 0.0;
            for (int i = 0; i < n; i++) { double v = t[i]; sumT += v; sumT2 += v * v; }
            double varT = n * sumT2 - sumT * sumT;
            if (varT <= 1e-6)
            {
                for (int i = 0; i < sc.Length; i++) { sc[i] = -1f; }
                return sc;
            }
            int oi = 0;
            for (int py = y0; py <= y1; py++)
            {
                for (int px = x0; px <= x1; px++)
                {
                    double sI = 0.0;
                    double sI2 = 0.0;
                    double sIT = 0.0;
                    for (int j = 0; j < Th; j++)
                    {
                        int r = (py + j) * iw + px;
                        int rt = j * Tw;
                        for (int i = 0; i < Tw; i++)
                        {
                            double g = gray[r + i];
                            sI += g;
                            sI2 += g * g;
                            sIT += g * (double)t[rt + i];
                        }
                    }
                    double varI = n * sI2 - sI * sI;
                    if (varI <= 1e-6) { sc[oi] = -1f; oi++; continue; }
                    double cov = n * sIT - sI * sumT;
                    sc[oi] = (float)(cov / Math.Sqrt(varI * varT));
                    oi++;
                }
            }
            return sc;
        }

        static bool ArgMax(float[] sc, int w, int h, out double best, out int bx, out int by)
        {
            best = -2.0; bx = 0; by = 0;
            bool any = false;
            for (int y = 0; y < h; y++)
            {
                int o = y * w;
                for (int x = 0; x < w; x++)
                {
                    float v = sc[o + x];
                    if (v > best) { best = v; bx = x; by = y; any = true; }
                }
            }
            return any;
        }

        // up to K peaks separated by at least sep pixels (Chebyshev) -- keeps a
        // bad coarse pick from killing the whole scale.
        static List<int[]> TopPeaks(float[] sc, int w, int h, int K, int sep)
        {
            List<int[]> res = new List<int[]>();
            for (int k = 0; k < K; k++)
            {
                double best = -2.0;
                int bx = -1;
                int by = -1;
                for (int y = 0; y < h; y++)
                {
                    int o = y * w;
                    for (int x = 0; x < w; x++)
                    {
                        float v = sc[o + x];
                        if (v <= best) { continue; }
                        bool ok = true;
                        for (int j = 0; j < res.Count; j++)
                        {
                            if (Math.Abs(res[j][0] - x) <= sep && Math.Abs(res[j][1] - y) <= sep) { ok = false; break; }
                        }
                        if (!ok) { continue; }
                        best = v; bx = x; by = y;
                    }
                }
                if (bx < 0 || best <= 0.0) { break; }
                res.Add(new int[] { bx, by });
            }
            return res;
        }

        static void ChooseFactor(List<DsLevel> levels, int Tw, int Th, out DsLevel chosen, out int twF, out int thF)
        {
            chosen = null; twF = 0; thF = 0;
            double bestCost = double.MaxValue;
            for (int i = 0; i < levels.Count; i++)
            {
                DsLevel L = levels[i];
                int a = Tw / L.F;
                int b = Th / L.F;
                if (a < 6 || b < 4) { continue; }
                if (a * b < 84) { continue; }
                if (L.W - a < 4 || L.H - b < 4) { continue; }
                double cost = (double)(L.W - a + 1) * (double)(L.H - b + 1) * (double)a * (double)b;
                if (cost < bestCost) { bestCost = cost; chosen = L; twF = a; thF = b; }
            }
        }

        static void CascadeToFull(byte[] gray, int iw, int ih, List<DsLevel> levels,
                                  float[] tFull, int Tw, int Th, int fStart, int px, int py,
                                  out double score, out int fx, out int fy)
        {
            score = -1.0;
            int f = fStart;
            int cx = px;
            int cy = py;
            double cur = -1.0;
            while (f > 2)
            {
                int fn = f / 2;
                DsLevel L = GetLevel(levels, fn);
                if (L == null) { break; }
                int twn = Tw / fn;
                int thn = Th / fn;
                if (twn < 4 || thn < 3) { break; }
                float[] tl = Downsample(tFull, Tw, Th, fn);
                int gx = cx * f;
                int gy = cy * f;
                int wx = gx / fn;
                int wy = gy / fn;
                int ox, oy, ow, oh;
                float[] sc = ComputeScores(L, tl, twn, thn, wx - 3, wy - 3, wx + 3, wy + 3, out ox, out oy, out ow, out oh);
                if (sc == null) { break; }
                double bsc;
                int ix, iy;
                if (!ArgMax(sc, ow, oh, out bsc, out ix, out iy)) { break; }
                cur = bsc;
                cx = ox + ix;
                cy = oy + iy;
                f = fn;
            }
            int fxx = cx * f;
            int fyy = cy * f;
            int ux, uy, uw, uh;
            float[] fine = ComputeDirectScores(gray, iw, ih, tFull, Tw, Th, fxx - 2, fyy - 2, fxx + 2, fyy + 2, out ux, out uy, out uw, out uh);
            if (fine != null)
            {
                double bsc2;
                int ix2, iy2;
                if (ArgMax(fine, uw, uh, out bsc2, out ix2, out iy2))
                {
                    cur = bsc2;
                    fxx = ux + ix2;
                    fyy = uy + iy2;
                }
            }
            score = cur;
            fx = fxx;
            fy = fyy;
        }

        // Two-phase search at one scale. Phase 1 (~1/8 of the pixels) finds the
        // best coarse peaks; phase 2 is a full-resolution ZNCC scan of a small
        // window around each peak (+-2 px at the end). A local window (wx0 >= 0)
        // restricts phase 1, which is what makes the scale refinement cheap.
        static void EvalAll(byte[] gray, int iw, int ih, byte[] tg, int tw, int th, double s,
                            List<DsLevel> levels, int wx0, int wy0, int wx1, int wy1, DsBest acc,
                            out double score, out int fx, out int fy, out int outTw, out int outTh)
        {
            score = -1.0; fx = 0; fy = 0; outTw = 0; outTh = 0;
            int Tw = (int)Math.Round(tw * s);
            int Th = (int)Math.Round(th * s);
            if (Tw < 3) { Tw = 3; }
            if (Th < 3) { Th = 3; }
            if (Tw > iw || Th > ih) { return; }
            outTw = Tw; outTh = Th;
            float[] tFull = Resample(tg, tw, th, Tw, Th);

            int maxX = iw - Tw;
            int maxY = ih - Th;
            bool local = (wx0 >= 0);
            if (local)
            {
                if (wx0 < 0) { wx0 = 0; }
                if (wy0 < 0) { wy0 = 0; }
                if (wx1 > maxX) { wx1 = maxX; }
                if (wy1 > maxY) { wy1 = maxY; }
                if (wx1 < wx0 || wy1 < wy0) { local = false; }
            }

            DsLevel cl;
            int twF, thF;
            ChooseFactor(levels, Tw, Th, out cl, out twF, out thF);

            if (cl != null)
            {
                float[] tc = Downsample(tFull, Tw, Th, cl.F);
                int lx0 = 0;
                int ly0 = 0;
                int lx1 = cl.W - twF;
                int ly1 = cl.H - thF;
                if (local)
                {
                    lx0 = wx0 / cl.F;
                    ly0 = wy0 / cl.F;
                    lx1 = wx1 / cl.F;
                    ly1 = wy1 / cl.F;
                    if (lx1 > cl.W - twF) { lx1 = cl.W - twF; }
                    if (ly1 > cl.H - thF) { ly1 = cl.H - thF; }
                    if (lx1 < lx0 || ly1 < ly0)
                    {
                        lx0 = 0; ly0 = 0; lx1 = cl.W - twF; ly1 = cl.H - thF;
                    }
                }
                int ox, oy, ow, oh;
                float[] sc = ComputeScores(cl, tc, twF, thF, lx0, ly0, lx1, ly1, out ox, out oy, out ow, out oh);
                if (sc == null && local)
                {
                    sc = ComputeScores(cl, tc, twF, thF, 0, 0, cl.W - twF, cl.H - thF, out ox, out oy, out ow, out oh);
                }
                if (sc == null) { return; }
                int sep = Math.Max(3, Math.Min(twF, thF) / 3);
                // Keep more coarse peaks than strictly needed: box-downsampling the
                // image by a factor that does not divide the object position smears
                // the true peak's phase, so a background region can outrank it. The
                // cascade plus the full-resolution refine is cheap, the coarse pass
                // is not -- so breadth here buys robustness for free.
                List<int[]> peaks = TopPeaks(sc, ow, oh, 8, sep);
                if (peaks.Count == 0) { return; }
                double best = -2.0;
                int bfx = 0;
                int bfy = 0;
                // Breadth costs real time only through the cascade's +-2 full-resolution
                // refine, whose price is the template area. Big templates (dialog
                // buttons, 400x100 and up) therefore cascade only their top few peaks;
                // small icons keep the full set.
                long tarea = (long)Tw * (long)Th;
                int keep = 8;
                if (tarea > 24000) { keep = 3; }
                else if (tarea > 12000) { keep = 5; }
                if (keep > peaks.Count) { keep = peaks.Count; }
                for (int i = 0; i < keep; i++)
                {
                    int px = ox + peaks[i][0];
                    int py = oy + peaks[i][1];
                    double csc;
                    int cfx, cfy;
                    CascadeToFull(gray, iw, ih, levels, tFull, Tw, Th, cl.F, px, py, out csc, out cfx, out cfy);
                    if (acc != null) { acc.AddPeak(csc, cfx, cfy); }
                    if (csc > best) { best = csc; bfx = cfx; bfy = cfy; }
                }
                score = best;
                fx = bfx;
                fy = bfy;
                return;
            }

            // fallback: no pyramid level usable (tiny image / huge template) ->
            // exhaustive full-resolution search (windowed when local).
            int dx0 = 0;
            int dy0 = 0;
            int dx1 = maxX;
            int dy1 = maxY;
            if (local) { dx0 = wx0; dy0 = wy0; dx1 = wx1; dy1 = wy1; }
            int dox, doy, dow, doh;
            float[] ds = ComputeDirectScores(gray, iw, ih, tFull, Tw, Th, dx0, dy0, dx1, dy1, out dox, out doy, out dow, out doh);
            if (ds == null) { return; }
            double dbest;
            int dix, diy;
            if (!ArgMax(ds, dow, doh, out dbest, out dix, out diy)) { return; }
            if (acc != null) { acc.AddPeak(dbest, dox + dix, doy + diy); }
            score = dbest;
            fx = dox + dix;
            fy = doy + diy;
        }

        // Running best over all evaluations, plus every distinct match position the
        // engine has seen. The positions are what make the uniqueness test possible:
        // a winner is only trustworthy when nothing else in the image comes close.
        sealed class DsBest
        {
            public double Score = -2.0;
            public double Scale = 0.0;
            public int X;
            public int Y;
            public int W;
            public int H;
            public int Tried;
            public List<double> PeakScores = new List<double>();
            public List<int> PeakXs = new List<int>();
            public List<int> PeakYs = new List<int>();

            public void AddPeak(double sc, int x, int y)
            {
                if (PeakScores.Count >= 4000) { return; }
                PeakScores.Add(sc);
                PeakXs.Add(x);
                PeakYs.Add(y);
            }

            public void Offer(double sc, double s, int x, int y, int w, int h)
            {
                Tried++;
                if (sc > Score) { Score = sc; Scale = s; X = x; Y = y; W = w; H = h; }
            }

            // best score seen at a position far enough from the winner to be a
            // genuinely different match (Chebyshev distance >= sepDist).
            public double RunnerUp(int sepDist)
            {
                double best = -2.0;
                for (int i = 0; i < PeakScores.Count; i++)
                {
                    int dx = Math.Abs(PeakXs[i] - X);
                    int dy = Math.Abs(PeakYs[i] - Y);
                    if (dx < sepDist && dy < sepDist) { continue; }
                    if (PeakScores[i] > best) { best = PeakScores[i]; }
                }
                return best;
            }
        }

        static void EvalOne(byte[] gray, int iw, int ih, byte[] tg, int tw, int th,
                            List<DsLevel> levels, double s, double minScale, double maxScale,
                            int wx0, int wy0, int wx1, int wy1, DsBest acc)
        {
            if (s < minScale - 1e-9 || s > maxScale + 1e-9) { return; }
            if (s <= 0.0) { return; }
            double sc;
            int fx, fy, Tw, Th;
            EvalAll(gray, iw, ih, tg, tw, th, s, levels, wx0, wy0, wx1, wy1, acc,
                    out sc, out fx, out fy, out Tw, out Th);
            if (Tw <= 0) { return; }
            acc.Offer(sc, s, fx, fy, Tw, Th);
        }

        // Refine one candidate in log-scale space: halve the step every round and
        // only look locally around the current position (a scale nudge does not move
        // the object), which makes these evaluations far cheaper than a full pass.
        static void Ladder(byte[] gray, int iw, int ih, byte[] tg, int tw, int th,
                           List<DsLevel> levels, double s0, int x0, int y0, double score0,
                           double logSpan, int radius, double minScale, double maxScale, DsBest acc)
        {
            double curS = s0;
            int curX = x0;
            int curY = y0;
            double curScore = score0;
            double d = logSpan;
            for (int round = 0; round < 4; round++)
            {
                double roundS = curS;
                int roundX = curX;
                int roundY = curY;
                double roundScore = curScore;
                for (int u = -1; u <= 1; u += 2)
                {
                    double s2 = curS * Math.Exp(d * (double)u);
                    if (s2 < minScale - 1e-9 || s2 > maxScale + 1e-9) { continue; }
                    int wx0 = curX - radius;
                    int wy0 = curY - radius;
                    double sc2;
                    int fx2, fy2, Tw2, Th2;
                    EvalAll(gray, iw, ih, tg, tw, th, s2, levels, wx0, wy0, curX + radius, curY + radius, acc,
                            out sc2, out fx2, out fy2, out Tw2, out Th2);
                    if (Tw2 <= 0) { continue; }
                    acc.Offer(sc2, s2, fx2, fy2, Tw2, Th2);
                    if (sc2 > roundScore) { roundScore = sc2; roundS = s2; roundX = fx2; roundY = fy2; }
                }
                curS = roundS;
                curX = roundX;
                curY = roundY;
                curScore = roundScore;
                d *= 0.5;
            }
        }

        public static DsResult Run(byte[] gray, int iw, int ih, byte[] tgray, int tw, int th,
                                   double minScale, double maxScale, int steps, double threshold)
        {
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            DsResult r = new DsResult();
            r.Score = -1.0;
            try
            {
                if (iw < 8 || ih < 8) { throw new Exception("search area too small: " + iw + "x" + ih); }
                if (tw < 3 || th < 3) { throw new Exception("template too small: " + tw + "x" + th); }
                if (tw > iw || th > ih) { throw new Exception("template " + tw + "x" + th + " larger than search area " + iw + "x" + ih); }
                if (steps < 1) { steps = 1; }
                if (minScale <= 0.0) { minScale = 0.1; }
                if (maxScale <= 0.0) { maxScale = 1.0; }
                if (maxScale < minScale)
                {
                    double tmp = minScale;
                    minScale = maxScale;
                    maxScale = tmp;
                }

                List<DsLevel> levels = new List<DsLevel>();
                int[] fs = new int[] { 2, 4, 8, 16 };
                for (int i = 0; i < fs.Length; i++)
                {
                    if (iw / fs[i] < 16 || ih / fs[i] < 16) { break; }
                    levels.Add(BuildLevel(gray, iw, ih, fs[i]));
                }

                // Coarse scale grid, at least 16 points: over [minScale,maxScale] a
                // 16-point geometric series leaves at most ~9% between neighbours,
                // and a few percent of size error already pushes a hard-edged UI
                // icon below any useful ZNCC threshold. The point closest to 1.0 is
                // snapped onto exactly 1.0 because the normal case is a template
                // captured at the screenshot's own resolution.
                int coarse = steps;
                if (coarse < 16) { coarse = 16; }
                double ratio = 1.0;
                if (coarse > 1 && maxScale > minScale)
                {
                    ratio = Math.Pow(maxScale / minScale, 1.0 / (double)(coarse - 1));
                }
                double[] grid = new double[coarse];
                for (int k = 0; k < coarse; k++)
                {
                    grid[k] = (coarse == 1) ? minScale : minScale * Math.Pow(ratio, k);
                    if (grid[k] < minScale) { grid[k] = minScale; }
                    if (grid[k] > maxScale) { grid[k] = maxScale; }
                }
                if (coarse >= 3 && minScale <= 1.0 && maxScale >= 1.0)
                {
                    int snapAt = 0;
                    double snapDist = double.MaxValue;
                    for (int k = 0; k < coarse; k++)
                    {
                        double dd = Math.Abs(Math.Log(grid[k]));
                        if (dd < snapDist) { snapDist = dd; snapAt = k; }
                    }
                    grid[snapAt] = 1.0;
                }

                DsBest acc = new DsBest();
                List<double> gs = new List<double>();
                List<double> gsv = new List<double>();
                List<int> gx = new List<int>();
                List<int> gy = new List<int>();
                for (int k = 0; k < coarse; k++)
                {
                    double s = grid[k];
                    double sc;
                    int fx, fy, Tw, Th;
                    EvalAll(gray, iw, ih, tgray, tw, th, s, levels, -1, 0, 0, 0, acc,
                            out sc, out fx, out fy, out Tw, out Th);
                    if (Tw <= 0) { continue; }
                    acc.Offer(sc, s, fx, fy, Tw, Th);
                    gs.Add(s);
                    gsv.Add(sc);
                    gx.Add(fx);
                    gy.Add(fy);
                }

                if (gs.Count == 0)
                {
                    throw new Exception("no usable scale: template " + tw + "x" + th + " never fits " + iw + "x" + ih + " within [" + minScale + "," + maxScale + "]");
                }

                if (ratio > 1.0000001)
                {
                    double logStep = Math.Log(ratio);
                    // Refine the two best separated coarse candidates: one alone is
                    // fragile, because at its own nearest grid scale the true match
                    // can be beaten by a background region.
                    int n = gs.Count;
                    int[] idx = new int[n];
                    for (int i = 0; i < n; i++) { idx[i] = i; }
                    for (int i = 0; i < n; i++)
                    {
                        for (int j = i + 1; j < n; j++)
                        {
                            if (gsv[idx[j]] > gsv[idx[i]]) { int t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
                        }
                    }
                    List<int> pick = new List<int>();
                    for (int i = 0; i < n && pick.Count < 2; i++)
                    {
                        bool distinct = true;
                        for (int j = 0; j < pick.Count; j++)
                        {
                            if (Math.Abs(Math.Log(gs[idx[i]] / gs[pick[j]])) < logStep * 0.5) { distinct = false; }
                        }
                        if (distinct) { pick.Add(idx[i]); }
                    }
                    int radius = (int)Math.Round(0.12 * (double)tw);
                    if (radius < 24) { radius = 24; }
                    for (int i = 0; i < pick.Count; i++)
                    {
                        int k = pick[i];
                        Ladder(gray, iw, ih, tgray, tw, th, levels, gs[k], gx[k], gy[k], gsv[k],
                               logStep * 0.5, radius, minScale, maxScale, acc);
                    }
                }

                int sepDist = Math.Min(tw, th) / 3;
                if (sepDist < 8) { sepDist = 8; }
                r.Score = acc.Score;
                r.Scale = acc.Scale;
                r.X = acc.X;
                r.Y = acc.Y;
                r.W = acc.W;
                r.H = acc.H;
                r.ScalesTried = acc.Tried;
                r.RunnerUp = acc.RunnerUp(sepDist);
                r.Ambiguous = ((r.Score - r.RunnerUp) < 0.05);
                r.Found = (r.Score >= threshold) && !r.Ambiguous;
            }
            catch (Exception ex)
            {
                r.Error = ex.Message;
            }
            sw.Stop();
            r.ElapsedMs = sw.Elapsed.TotalMilliseconds;
            return r;
        }
    }
}
'@

# ---------------------------------------------------------------------------
# Window capture (compiled only when -Window is used, keeps the hot path lean).
# ---------------------------------------------------------------------------
$script:CsCapture = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace DshLocate
{
    public delegate bool DsEnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct DsRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DsPoint
    {
        public int X;
        public int Y;
    }

    public sealed class DsCapture
    {
        public Bitmap Bmp;
        public string Method;
        public int WinX;
        public int WinY;
        public int WinW;
        public int WinH;
        public int CliX;
        public int CliY;
        public int CliW;
        public int CliH;
    }

    public static class DsWin32
    {
        [DllImport("user32.dll")]
        static extern bool EnumWindows(DsEnumWindowsProc cb, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetWindowTextLengthW(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetWindowTextW(IntPtr hWnd, StringBuilder sb, int maxCount);

        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool GetClientRect(IntPtr hWnd, out DsRect r);

        [DllImport("user32.dll")]
        static extern bool GetWindowRect(IntPtr hWnd, out DsRect r);

        [DllImport("user32.dll")]
        static extern bool ClientToScreen(IntPtr hWnd, ref DsPoint p);

        [DllImport("user32.dll")]
        static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);

        [DllImport("user32.dll")]
        static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);

        public static IntPtr FindByTitle(string title)
        {
            IntPtr exact = IntPtr.Zero;
            IntPtr partial = IntPtr.Zero;
            DsEnumWindowsProc cb = delegate(IntPtr h, IntPtr lp)
            {
                if (!IsWindowVisible(h)) { return true; }
                if (GetWindow(h, 4u) != IntPtr.Zero) { return true; }
                int len = GetWindowTextLengthW(h);
                if (len <= 0) { return true; }
                StringBuilder sb = new StringBuilder(len + 2);
                GetWindowTextW(h, sb, sb.Capacity);
                string t = sb.ToString();
                if (t.Length == 0) { return true; }
                if (string.Equals(t, title, StringComparison.OrdinalIgnoreCase)) { exact = h; return false; }
                if (partial == IntPtr.Zero && t.IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0) { partial = h; }
                return true;
            };
            EnumWindows(cb, IntPtr.Zero);
            if (exact != IntPtr.Zero) { return exact; }
            return partial;
        }

        static bool AllBlack(Bitmap b)
        {
            int w = b.Width;
            int h = b.Height;
            BitmapData bd = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                int stride = bd.Stride;
                byte[] buf = new byte[stride * h];
                Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
                for (int y = 0; y < h; y++)
                {
                    int off = y * stride;
                    for (int x = 0; x < w; x++)
                    {
                        int i = off + x * 4;
                        if (buf[i] != 0 || buf[i + 1] != 0 || buf[i + 2] != 0) { return false; }
                    }
                }
            }
            finally
            {
                b.UnlockBits(bd);
            }
            return true;
        }

        public static DsCapture CaptureClient(string title)
        {
            IntPtr h = FindByTitle(title);
            if (h == IntPtr.Zero) { throw new Exception("window not found (title substring): " + title); }
            DsRect cr;
            if (!GetClientRect(h, out cr)) { throw new Exception("GetClientRect failed for window: " + title); }
            int cw = cr.Right - cr.Left;
            int ch = cr.Bottom - cr.Top;
            if (cw < 8 || ch < 8) { throw new Exception("window client area too small: " + cw + "x" + ch); }
            DsPoint p = new DsPoint();
            p.X = 0;
            p.Y = 0;
            ClientToScreen(h, ref p);
            DsRect wr;
            GetWindowRect(h, out wr);

            DsCapture res = new DsCapture();
            res.CliX = p.X; res.CliY = p.Y; res.CliW = cw; res.CliH = ch;
            res.WinX = wr.Left; res.WinY = wr.Top;
            res.WinW = wr.Right - wr.Left; res.WinH = wr.Bottom - wr.Top;
            res.Method = "printwindow";

            Bitmap bmp = new Bitmap(cw, ch, PixelFormat.Format32bppArgb);
            bool printed = false;
            using (Graphics g = Graphics.FromImage(bmp))
            {
                IntPtr hdc = g.GetHdc();
                try
                {
                    printed = PrintWindow(h, hdc, 2u);
                }
                finally
                {
                    g.ReleaseHdc(hdc);
                }
            }
            if (!printed || AllBlack(bmp))
            {
                bmp.Dispose();
                bmp = new Bitmap(cw, ch, PixelFormat.Format32bppArgb);
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(p.X, p.Y, 0, 0, new Size(cw, ch));
                }
                res.Method = "screen";
            }
            res.Bmp = bmp;
            return res;
        }
    }
}
'@

function Invoke-Locate {
    if ([string]::IsNullOrWhiteSpace($Template)) { Exit-Failure '-Template is required' }
    if (-not $Window -and [string]::IsNullOrWhiteSpace($Image)) { Exit-Failure 'either -Image or -Window is required' }
    if (-not [System.IO.File]::Exists($Template)) { Exit-Failure ('template file not found: ' + $Template) }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    $null = Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    if (-not ('DshLocate.DsMatcher' -as [type])) {
        $refs = @('System.dll', 'System.Core.dll', 'System.Drawing.dll')
        Add-Type -TypeDefinition $script:CsCore -ReferencedAssemblies $refs -Language CSharp -ErrorAction Stop | Out-Null
    }

    $cap = $null
    $imgBmp = $null
    if (-not [string]::IsNullOrWhiteSpace($Window)) {
        if (-not ('DshLocate.DsWin32' -as [type])) {
            $refs = @('System.dll', 'System.Core.dll', 'System.Drawing.dll')
            Add-Type -TypeDefinition $script:CsCapture -ReferencedAssemblies $refs -Language CSharp -ErrorAction Stop | Out-Null
        }
        $cap = [DshLocate.DsWin32]::CaptureClient($Window)
        $imgBmp = $cap.Bmp
    }
    else {
        if (-not [System.IO.File]::Exists($Image)) { Exit-Failure ('image file not found: ' + $Image) }
        $imgBmp = [DshLocate.DsImg]::LoadBitmap($Image)
    }

    $iw = $imgBmp.Width
    $ih = $imgBmp.Height

    $rx = 0
    $ry = 0
    $rw = $iw
    $rh = $ih
    if (-not [string]::IsNullOrWhiteSpace($Region)) {
        $parts = @($Region -split ',')
        if ($parts.Count -ne 4) { Exit-Failure ('-Region must be "x,y,w,h" (got: ' + $Region + ')') }
        try {
            $rx = [int][Math]::Round([double]$parts[0].Trim())
            $ry = [int][Math]::Round([double]$parts[1].Trim())
            $rw = [int][Math]::Round([double]$parts[2].Trim())
            $rh = [int][Math]::Round([double]$parts[3].Trim())
        }
        catch {
            Exit-Failure ('-Region must be numeric "x,y,w,h" (got: ' + $Region + ')')
        }
        if ($rw -le 0 -or $rh -le 0) { Exit-Failure ('-Region has non-positive size: ' + $rw + 'x' + $rh) }
        if ($rx -lt 0) { $rw = $rw + $rx; $rx = 0 }
        if ($ry -lt 0) { $rh = $rh + $ry; $ry = 0 }
        if ($rx -ge $iw -or $ry -ge $ih) { Exit-Failure ('-Region origin outside image: ' + $rx + ',' + $ry + ' (image ' + $iw + 'x' + $ih + ')') }
        if ($rx + $rw -gt $iw) { $rw = $iw - $rx }
        if ($ry + $rh -gt $ih) { $rh = $ih - $ry }
        if ($rw -lt 8 -or $rh -lt 8) { Exit-Failure ('-Region too small after clipping: ' + $rw + 'x' + $rh) }
    }

    $tplBmp = [DshLocate.DsImg]::LoadBitmap($Template)
    if ($tplBmp.Width -lt 3 -or $tplBmp.Height -lt 3) {
        Exit-Failure ('template too small: ' + $tplBmp.Width + 'x' + $tplBmp.Height)
    }

    # The search window must be able to contain the template itself: when the
    # layout prior window is narrower than the button, grow it around the window
    # center (then clamp back into the image). A prior only says "look here";
    # it must not fail the locate just because it is smaller than the target.
    if ($rw -lt $tplBmp.Width -or $rh -lt $tplBmp.Height) {
        $needW = [int][Math]::Min($iw, [Math]::Max($rw, $tplBmp.Width + 24))
        $needH = [int][Math]::Min($ih, [Math]::Max($rh, $tplBmp.Height + 24))
        $cxWin = $rx + [int]($rw / 2)
        $cyWin = $ry + [int]($rh / 2)
        $rx = [int][Math]::Max(0, [Math]::Min($iw - $needW, $cxWin - [int]($needW / 2)))
        $ry = [int][Math]::Max(0, [Math]::Min($ih - $needH, $cyWin - [int]($needH / 2)))
        $rw = $needW
        $rh = $needH
        if ($rx + $rw -gt $iw) { $rw = $iw - $rx }
        if ($ry + $rh -gt $ih) { $rh = $ih - $ry }
    }

    $work = $imgBmp
    $ownsWork = $false
    if ($rx -ne 0 -or $ry -ne 0 -or $rw -ne $iw -or $rh -ne $ih) {
        $work = [DshLocate.DsImg]::Crop($imgBmp, $rx, $ry, $rw, $rh)
        $ownsWork = $true
    }

    $grayImg = [DshLocate.DsImg]::Gray($work)
    $grayTpl = [DshLocate.DsImg]::Gray($tplBmp)

    $res = [DshLocate.DsMatcher]::Run($grayImg, $rw, $rh, $grayTpl, $tplBmp.Width, $tplBmp.Height, $MinScale, $MaxScale, $ScaleSteps, $Threshold)

    $sw.Stop()
    if ($res.Error) { Exit-Failure $res.Error }

    $ax = $res.X + $rx
    $ay = $res.Y + $ry
    $cx = $ax + [int]($res.W / 2)
    $cy = $ay + [int]($res.H / 2)
    $elapsed = $sw.Elapsed.TotalMilliseconds
    $runner = $res.RunnerUp
    if ($runner -lt 0.0) { $runner = 0.0 }
    $uniq = $res.Score - $runner
    if ($uniq -gt 1.0) { $uniq = 1.0 }

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"ok":true,"found":')
    if ($res.Found) { [void]$sb.Append('true') } else { [void]$sb.Append('false') }
    [void]$sb.Append(',"score":').Append((Fmt-Num $res.Score '0.######'))
    [void]$sb.Append(',"scale":').Append((Fmt-Num $res.Scale '0.######'))
    [void]$sb.Append(',"x":').Append($ax)
    [void]$sb.Append(',"y":').Append($ay)
    [void]$sb.Append(',"w":').Append($res.W)
    [void]$sb.Append(',"h":').Append($res.H)
    [void]$sb.Append(',"cx":').Append($cx)
    [void]$sb.Append(',"cy":').Append($cy)
    [void]$sb.Append(',"region":{"x":').Append($rx).Append(',"y":').Append($ry).Append(',"w":').Append($rw).Append(',"h":').Append($rh).Append('}')
    [void]$sb.Append(',"template":{"w":').Append($tplBmp.Width).Append(',"h":').Append($tplBmp.Height).Append('}')
    [void]$sb.Append(',"image":{"w":').Append($iw).Append(',"h":').Append($ih).Append('}')
    [void]$sb.Append(',"scalesTried":').Append($res.ScalesTried)
    [void]$sb.Append(',"runnerUp":').Append((Fmt-Num $runner '0.0000'))
    [void]$sb.Append(',"uniqueness":').Append((Fmt-Num $uniq '0.0000'))
    [void]$sb.Append(',"ambiguous":')
    if ($res.Ambiguous) { [void]$sb.Append('true') } else { [void]$sb.Append('false') }
    [void]$sb.Append(',"elapsedMs":').Append((Fmt-Int $elapsed))
    if ($null -ne $cap) {
        [void]$sb.Append(',"capture":{"method":"').Append($cap.Method).Append('"')
        [void]$sb.Append(',"window":{"x":').Append($cap.WinX).Append(',"y":').Append($cap.WinY).Append(',"w":').Append($cap.WinW).Append(',"h":').Append($cap.WinH).Append('}')
        [void]$sb.Append(',"clientOrigin":{"x":').Append($cap.CliX).Append(',"y":').Append($cap.CliY).Append('}}')
    }
    [void]$sb.Append('}')
    $jsonLine = $sb.ToString()

    if ($ownsWork) { $work.Dispose() }
    $work = $null
    if ($null -ne $cap) { $cap.Bmp.Dispose() }
    else { $imgBmp.Dispose() }
    $tplBmp.Dispose()

    if ($Json) {
        Out-Line $jsonLine
    }
    else {
        $best = Fmt-Num $res.Score '0.0000'
        $sc = Fmt-Num $res.Scale '0.0000'
        if ($res.Found) {
            Out-Line ('FOUND score=' + $best + ' scale=' + $sc + ' pos=' + $ax + ',' + $ay + ' size=' + $res.W + 'x' + $res.H + ' center=' + $cx + ',' + $cy + ' uniqueness=' + (Fmt-Num $uniq '0.0000') + ' region=' + $rx + ',' + $ry + ',' + $rw + ',' + $rh + ' scales=' + $res.ScalesTried + ' elapsed=' + (Fmt-Int $elapsed) + 'ms')
        }
        else {
            $why = 'score<threshold'
            if ($res.Ambiguous -and $res.Score -ge $Threshold) { $why = 'ambiguous(duplicate match)' }
            Out-Line ('NOT-FOUND reason=' + $why + ' score=' + $best + ' threshold=' + (Fmt-Num $Threshold '0.00') + ' runnerUp=' + (Fmt-Num $runner '0.0000') + ' uniqueness=' + (Fmt-Num $uniq '0.0000') + ' bestScale=' + $sc + ' bestPos=' + $ax + ',' + $ay + ' scales=' + $res.ScalesTried + ' elapsed=' + (Fmt-Int $elapsed) + 'ms')
        }
    }

    if ($res.Found) { exit 0 }
    exit 2
}

try {
    Invoke-Locate
}
catch {
    Exit-Failure ('unexpected: ' + (Get-RootMessage $_))
}
