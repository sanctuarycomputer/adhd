'use strict';

const OKLCH_RE = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/;

function oklchStringToRgb(input) {
  const m = OKLCH_RE.exec(input.trim());
  if (!m) throw new Error('Not an oklch string: ' + input);
  let L = parseFloat(m[1]);
  if (m[1].endsWith('%')) L = L / 100;
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  let A = 1;
  if (m[4]) {
    A = parseFloat(m[4]);
    if (m[4].endsWith('%')) A = A / 100;
  }

  // OKLCh → OKLab
  const a_ = C * Math.cos(H * Math.PI / 180);
  const b_ = C * Math.sin(H * Math.PI / 180);

  // OKLab → linear sRGB
  const l_ = L + 0.3963377774 * a_ + 0.2158037573 * b_;
  const m_ = L - 0.1055613458 * a_ - 0.0638541728 * b_;
  const s_ = L - 0.0894841775 * a_ - 1.2914855480 * b_;

  const l = l_ * l_ * l_;
  const m_cubed = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr =  4.0767416621 * l - 3.3077115913 * m_cubed + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m_cubed - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m_cubed + 1.7076147010 * s;

  // linear sRGB → sRGB (gamma)
  const gamma = (x) =>
    x >= 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x;

  return {
    r: Math.max(0, Math.min(1, gamma(lr))),
    g: Math.max(0, Math.min(1, gamma(lg))),
    b: Math.max(0, Math.min(1, gamma(lb))),
    a: A,
  };
}

function oklchStringToHex(input) {
  const { r, g, b, a } = oklchStringToRgb(input);
  const to2 = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  let hex = '#' + to2(r) + to2(g) + to2(b);
  if (a < 1) hex += to2(a);
  return hex.toLowerCase();
}

module.exports = { oklchStringToRgb, oklchStringToHex };
