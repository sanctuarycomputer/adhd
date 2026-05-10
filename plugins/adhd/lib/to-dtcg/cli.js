#!/usr/bin/env node
'use strict';

/**
 * ADHD to-dtcg converter.
 *
 * Usage:
 *   node cli.js --source css --input <path> [--tailwind-theme <path|none>]
 *   node cli.js --source figma --input <path>
 *
 * Output: DTCG-formatted JSON to stdout (keys sorted, 2-space indent, trailing newline).
 * Exit codes: 0 = success, 1 = parse error, 2 = bad arguments.
 *
 * Spec: docs/superpowers/specs/2026-05-09-adhd-restructure-design.md
 */

// ============================================================
// OKLCH → hex conversion (vendored from colorjs.io, MIT)
// ============================================================
//
// Pipeline: OKLCH → OKLab → linear sRGB → companded sRGB → 8-bit hex.

function oklchToOklab(L, C, h) {
  const hRad = (h * Math.PI) / 180;
  return {
    L,
    a: C * Math.cos(hRad),
    b: C * Math.sin(hRad),
  };
}

function oklabToLinearSrgb({ L, a, b }) {
  // Inverse of OKLab forward matrix from Björn Ottosson's paper.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function linearToCompandedSrgb(c) {
  // sRGB transfer function (gamma encoding).
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function clamp01(c) {
  return Math.max(0, Math.min(1, c));
}

function channelToHex(c) {
  const v = Math.round(clamp01(c) * 255);
  return v.toString(16).padStart(2, '0');
}

function oklchToHex(L, C, h) {
  const lab = oklchToOklab(L, C, h);
  const lin = oklabToLinearSrgb(lab);
  const r = linearToCompandedSrgb(lin.r);
  const g = linearToCompandedSrgb(lin.g);
  const b = linearToCompandedSrgb(lin.b);
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function parseArgs(argv) {
  const out = { source: undefined, input: undefined, tailwindTheme: undefined };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--source') { out.source = value; i++; }
    else if (flag === '--input') { out.input = value; i++; }
    else if (flag === '--tailwind-theme') { out.tailwindTheme = value; i++; }
    else { throw new Error(`Unknown argument: ${flag}`); }
  }
  if (!out.source) throw new Error('--source is required (must be "css" or "figma")');
  if (out.source !== 'css' && out.source !== 'figma') {
    throw new Error('--source must be "css" or "figma"');
  }
  if (!out.input) throw new Error('--input is required');
  return out;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`cli.js: ${err.message}\n`);
    process.exit(2);
  }
  // TODO: dispatch by args.source — implemented in later tasks.
  process.stderr.write('cli.js: source dispatch not yet implemented\n');
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { parseArgs, oklchToHex };
