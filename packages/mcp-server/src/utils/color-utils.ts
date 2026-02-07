export interface NormalizedColor {
  l: number; // Lightness (0-1)
  a: number; // a-axis (cyan-green to pink-magenta)
  b: number; // b-axis (blue to yellow)
  alpha: number; // Alpha channel (0-1)
  raw: string; // The original string
}

const NAMED_COLORS: Record<string, string> = {
  aliceblue: "#f0f8ff",
  antiquewhite: "#faebd7",
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  black: "#000000",
  blanchedalmond: "#ffebcd",
  blue: "#0000ff",
  blueviolet: "#8a2be2",
  brown: "#a52a2a",
  burlywood: "#deb887",
  cadetblue: "#5f9ea0",
  chartreuse: "#7fff00",
  chocolate: "#d2691e",
  coral: "#ff7f50",
  cornflowerblue: "#6495ed",
  cornsilk: "#fff8dc",
  crimson: "#dc143c",
  cyan: "#00ffff",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9",
  darkgreen: "#006400",
  darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f",
  darkorange: "#ff8c00",
  darkorchid: "#9932cc",
  darkred: "#8b0000",
  darksalmon: "#e9967a",
  darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1",
  darkviolet: "#9400d3",
  deeppink: "#ff1493",
  deepskyblue: "#00bfff",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1e90ff",
  firebrick: "#b22222",
  floralwhite: "#fffaf0",
  forestgreen: "#228b22",
  fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  gold: "#ffd700",
  goldenrod: "#daa520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#adff2f",
  grey: "#808080",
  honeydew: "#f0fff0",
  hotpink: "#ff69b4",
  indianred: "#cd5c5c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd",
  lightblue: "#add8e6",
  lightcoral: "#f08080",
  lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3",
  lightgreen: "#90ee90",
  lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1",
  lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0",
  lime: "#00ff00",
  limegreen: "#32cd32",
  linen: "#faf0e6",
  magenta: "#ff00ff",
  maroon: "#800000",
  mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd",
  mediumorchid: "#ba55d3",
  mediumpurple: "#9370db",
  mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585",
  midnightblue: "#191970",
  mintcream: "#f5fffa",
  mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5",
  navajowhite: "#ffdead",
  navy: "#000080",
  oldlace: "#fdf5e6",
  olive: "#808000",
  olivedrab: "#6b8e23",
  orange: "#ffa500",
  orangered: "#ff4500",
  orchid: "#da70d6",
  palegoldenrod: "#eee8aa",
  palegreen: "#98fb98",
  paleturquoise: "#afeeee",
  palevioletred: "#db7093",
  papayawhip: "#ffefd5",
  peachpuff: "#ffdab9",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  powderblue: "#b0e0e6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#ff0000",
  rosybrown: "#bc8f8f",
  royalblue: "#4169e1",
  saddlebrown: "#8b4513",
  salmon: "#fa8072",
  sandybrown: "#f4a460",
  seagreen: "#2e8b57",
  seashell: "#fff5ee",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  skyblue: "#87ceeb",
  slateblue: "#6a5acd",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#fffafa",
  springgreen: "#00ff7f",
  steelblue: "#4682b4",
  tan: "#d2b48c",
  teal: "#008080",
  thistle: "#d8bfd8",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  white: "#ffffff",
  whitesmoke: "#f5f5f5",
  yellow: "#ffff00",
  yellowgreen: "#9acd32",
};

export function parseColor(colorStr: string): NormalizedColor {
  const trimmed = colorStr.trim().toLowerCase();

  // 0. color-mix() - Dynamic Interpolation
  if (trimmed.startsWith("color-mix(")) {
    return parseColorMix(trimmed);
  }

  // 1. Named Colors
  if (NAMED_COLORS[trimmed]) {
    return parseHex(NAMED_COLORS[trimmed]!);
  }

  // 2. Hex
  if (trimmed.startsWith("#")) {
    return parseHex(trimmed);
  }

  // 3. RGB / RGBA
  if (trimmed.startsWith("rgb")) {
    return parseRgb(trimmed);
  }

  // 4. HSL / HSLA / HWB
  if (trimmed.startsWith("hsl")) return parseHsl(trimmed);
  if (trimmed.startsWith("hwb")) return parseHwb(trimmed);

  // 5. LAB / LCH / OKLAB / OKLCH
  if (trimmed.startsWith("oklch")) return parseOklch(trimmed);
  if (trimmed.startsWith("oklab")) return parseOklab(trimmed);
  if (trimmed.startsWith("lch")) return parseLch(trimmed);
  if (trimmed.startsWith("lab")) return parseLab(trimmed);

  // 6. Generic color() notation
  if (trimmed.startsWith("color(")) return parseGenericColor(trimmed);

  // // 7. Channel Values (for recursive mix parsing)
  // if (!isNaN(parseFloat(trimmed))) {
  //     const val = parseNumericValue(trimmed);
  //     return { l: val, a: 0, b: 0, alpha: 1, raw: colorStr };
  // }

  // Fallback to Transparent Black
  return { l: 0, a: 0, b: 0, alpha: 0, raw: colorStr };
}

function parseNumericValue(val: string | undefined, scale: number = 1): number {
  if (!val || val === "none") return 0;
  const trimmed = val.trim().toLowerCase();
  if (trimmed.endsWith("%")) return (parseFloat(trimmed) / 100) * scale;
  if (trimmed.endsWith("deg")) return parseFloat(trimmed);
  if (trimmed.endsWith("rad")) return (parseFloat(trimmed) * 180) / Math.PI;
  if (trimmed.endsWith("grad")) return parseFloat(trimmed) * 0.9;
  if (trimmed.endsWith("turn")) return parseFloat(trimmed) * 360;
  return parseFloat(trimmed);
}

function parseHex(hex: string): NormalizedColor {
  let r = 0,
    g = 0,
    b = 0,
    a = 1;
  if (hex.length === 4) {
    r = parseInt(hex[1]! + hex[1], 16);
    g = parseInt(hex[2]! + hex[2], 16);
    b = parseInt(hex[3]! + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  } else if (hex.length === 9) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
    a = parseInt(hex.slice(7, 9), 16) / 255;
  }
  return rgbToNormalized(r, g, b, a, hex);
}

function parseRgb(rgb: string): NormalizedColor {
  // 1. Unified regex for legacy (comma) and modern (space/slash)
  // Matches: rgb(255 0 0), rgb(255, 0, 0), rgba(255, 0, 0, 0.5), rgb(100% 0% 0% / 50%)
  const parts =
    rgb
      .match(/rgba?\(([^)]+)\)/i)?.[1]
      ?.split(/[\s,#/]+/)
      .filter(Boolean) || [];
  if (parts.length < 3) return { l: 0, a: 0, b: 0, alpha: 1, raw: rgb };

  const r = parseNumericValue(parts[0], 255);
  const g = parseNumericValue(parts[1], 255);
  const b = parseNumericValue(parts[2], 255);
  const a = parts[3] ? parseNumericValue(parts[3], 1) : 1;

  return rgbToNormalized(r, g, b, a, rgb);
}

function parseHsl(hsl: string): NormalizedColor {
  const parts =
    hsl
      .match(/hsla?\(([^)]+)\)/i)?.[1]
      ?.split(/[\s,#/]+/)
      .filter(Boolean) || [];
  if (parts.length < 3) return { l: 0, a: 0, b: 0, alpha: 1, raw: hsl };

  // Hue: deg normalized to 0-1 (internally we use 360 scale then / 360)
  const h = parseNumericValue(parts[0], 360) / 360;
  const s = parseNumericValue(parts[1], 1);
  const l = parseNumericValue(parts[2], 1);
  const a = parts[3] ? parseNumericValue(parts[3], 1) : 1;

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  return rgbToNormalized(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a, hsl);
}

function hueToRgb(pVal: number, qVal: number, normalizedHue: number) {
  if (normalizedHue < 0) normalizedHue += 1;
  if (normalizedHue > 1) normalizedHue -= 1;
  if (normalizedHue < 1 / 6) return pVal + (qVal - pVal) * 6 * normalizedHue;
  if (normalizedHue < 1 / 2) return qVal;
  if (normalizedHue < 2 / 3) return pVal + (qVal - pVal) * (2 / 3 - normalizedHue) * 6;
  return pVal;
}

function parseHwb(hwb: string): NormalizedColor {
  const parts =
    hwb
      .match(/hwb\(([^)]+)\)/i)?.[1]
      ?.split(/[\s,#/]+/)
      .filter(Boolean) || [];
  if (parts.length < 3) return { l: 0, a: 0, b: 0, alpha: 1, raw: hwb };

  const h = parseNumericValue(parts[0], 360) / 360;
  let w = parseNumericValue(parts[1], 1);
  let b = parseNumericValue(parts[2], 1);
  const a = parts[3] ? parseNumericValue(parts[3], 1) : 1;

  // 1. Normalize Whiteness and Blackness
  if (w + b > 1) {
    const sum = w + b;
    w /= sum;
    b /= sum;
  }

  // 2. Convert Hue to base RGB (S=1, L=0.5)
  const r_base = hueToRgb(0, 1, h + 1 / 3);
  const g_base = hueToRgb(0, 1, h);
  const b_base = hueToRgb(0, 1, h - 1 / 3);

  // 3. Linearly interpolate: base * (1 - W - B) + W
  const factor = 1 - w - b;
  const r = r_base * factor + w;
  const g = g_base * factor + w;
  const b_final = b_base * factor + w;

  return rgbToNormalized(r * 255, g * 255, b_final * 255, a, hwb);
}

function parseLab(lab: string): NormalizedColor {
  const parts =
    lab
      .match(/lab\(([^)]+)\)/i)?.[1]
      ?.split(/[\s,#/]+/)
      .filter(Boolean) || [];
  if (parts.length < 3) return { l: 0, a: 0, b: 0, alpha: 1, raw: lab };

  const L = parseNumericValue(parts[0], 100);
  const A = parseNumericValue(parts[1], 125);
  const B = parseNumericValue(parts[2], 125);
  const alpha = parts[3] ? parseNumericValue(parts[3], 1) : 1;

  // CIELAB (D50) to XYZ (D50)
  const y = (L + 16) / 116;
  const x = A / 500 + y;
  const z = y - B / 200;

  const [X50, Y50, Z50] = [f_inv(x) * 0.96422, f_inv(y) * 1.0, f_inv(z) * 0.82521];

  // XYZ (D50) to XYZ (D65) Bradford Transform
  const X65 = X50 * 0.9555766 + Y50 * -0.0230393 + Z50 * 0.0631636;
  const Y65 = X50 * -0.0282895 + Y50 * 1.0099416 + Z50 * 0.0210077;
  const Z65 = X50 * 0.0122982 + Y50 * -0.020483 + Z50 * 1.3299098;

  return xyzToOklab(X65, Y65, Z65, alpha, lab);
}

function f_inv(t: number): number {
  return t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29);
}

function parseLch(lch: string): NormalizedColor {
  const parts =
    lch
      .match(/lch\(([^)]+)\)/i)?.[1]
      ?.split(/[\s,#/]+/)
      .filter(Boolean) || [];
  if (parts.length < 3) return { l: 0, a: 0, b: 0, alpha: 1, raw: lch };

  const L = parseNumericValue(parts[0], 100);
  const C = parseNumericValue(parts[1], 150);
  const H = parseNumericValue(parts[2], 1);
  const alpha = parts[3] ? parseNumericValue(parts[3], 1) : 1;

  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  return parseLab(`lab(${L} ${a} ${b} / ${alpha})`);
}

function parseOklab(oklab: string): NormalizedColor {
  const parts =
    oklab
      .match(/oklab\(([^)]+)\)/i)?.[1]
      ?.split(/[\s,#/]+/)
      .filter(Boolean) || [];
  if (parts.length < 3) return { l: 0, a: 0, b: 0, alpha: 1, raw: oklab };
  return {
    l: parseNumericValue(parts[0], 1),
    a: parseNumericValue(parts[1], 0.4),
    b: parseNumericValue(parts[2], 0.4),
    alpha: parts[3] ? parseNumericValue(parts[3], 1) : 1,
    raw: oklab,
  };
}

function parseOklch(oklch: string): NormalizedColor {
  const parts =
    oklch
      .match(/oklch\(([^)]+)\)/i)?.[1]
      ?.split(/[\s,#/]+/)
      .filter(Boolean) || [];
  if (parts.length < 3) return { l: 0, a: 0, b: 0, alpha: 1, raw: oklch };

  const L = parseNumericValue(parts[0], 1);
  const C = parseNumericValue(parts[1], 1);
  const H = parseNumericValue(parts[2], 1); // Native hue for OKLCH is degrees
  const A = parts[3] ? parseNumericValue(parts[3], 1) : 1;

  // Convert OKLCH to OKLAB
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  return { l: L, a, b, alpha: A, raw: oklch };
}

function parseGenericColor(str: string): NormalizedColor {
  // color(display-p3 1 0 0.5 / 0.5)
  const match = str.match(/color\(([^ ]+) ([^)]+)\)/i);
  if (!match) return { l: 0, a: 0, b: 0, alpha: 1, raw: str };

  const space = match[1]!.toLowerCase();
  const parts = match[2]!.split(/[\s/]+/).filter(Boolean);
  const c1 = parseNumericValue(parts[0], 1);
  const c2 = parseNumericValue(parts[1], 1);
  const c3 = parseNumericValue(parts[2], 1);
  const a = parts[3] ? parseNumericValue(parts[3], 1) : 1;

  if (space === "display-p3") {
    return p3ToNormalized(c1, c2, c3, a, str);
  }

  if (space === "srgb") {
    return rgbToNormalized(c1 * 255, c2 * 255, c3 * 255, a, str);
  }

  // Default hub-normalization for other spaces
  return rgbToNormalized(c1 * 255, c2 * 255, c3 * 255, a, str);
}

function parseColorMix(str: string): NormalizedColor {
  // color-mix(in oklab, red 30%, blue)
  const match = str.match(/color-mix\(in ([^,]+),\s*([^,]+),\s*([^)]+)\)/i);
  if (!match) return { l: 0, a: 0, b: 0, alpha: 0, raw: str };

  const space = match[1]!.trim().toLowerCase();
  const c1Str = match[2]!.trim();
  const c2Str = match[3]!.trim();

  // Parse percentages
  const p1Match = c1Str.match(/(.+)\s+(\d+(\.\d+)?%)/);
  const p2Match = c2Str.match(/(.+)\s+(\d+(\.\d+)?%)/);

  const c1 = parseColor(p1Match ? p1Match[1]! : c1Str);
  const c2 = parseColor(p2Match ? p2Match[1]! : c2Str);

  let weight = 0.5;
  if (p1Match) weight = parseFloat(p1Match[2]!) / 100;
  else if (p2Match) weight = 1 - parseFloat(p2Match[2]!) / 100;

  // Interpolate in the requested space
  return {
    l: c1.l * weight + c2.l * (1 - weight),
    a: c1.a * weight + c2.a * (1 - weight),
    b: c1.b * weight + c2.b * (1 - weight),
    alpha: c1.alpha * weight + c2.alpha * (1 - weight),
    raw: str,
  };
}

function xyzToOklab(x: number, y: number, z: number, alpha: number, raw: string): NormalizedColor {
  // Canonicalize invisible colors to avoid noise in comparisons
  if (alpha === 0) return { l: 0, a: 0, b: 0, alpha: 0, raw };

  // Standard LMS cone response transform
  const lValue = 0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z;
  const mValue = 0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z;
  const sValue = 0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z;

  const lCubeRoot = Math.cbrt(lValue);
  const mCubeRoot = Math.cbrt(mValue);
  const sCubeRoot = Math.cbrt(sValue);

  return {
    l: 0.2104542553 * lCubeRoot + 0.793617785 * mCubeRoot - 0.0040720403 * sCubeRoot,
    a: 1.9779984951 * lCubeRoot - 2.428592205 * mCubeRoot + 0.4505937099 * sCubeRoot,
    b: 0.0259040371 * lCubeRoot + 0.7827717662 * mCubeRoot - 0.808675766 * sCubeRoot,
    alpha,
    raw,
  };
}

function rgbToNormalized(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  raw: string
): NormalizedColor {
  // 1. RGB to Linear RGB (SDR)
  const linearRed = pivotRgb(red / 255);
  const linearGreen = pivotRgb(green / 255);
  const linearBlue = pivotRgb(blue / 255);

  // 2. Linear RGB to XYZ (D65)
  const x = 0.4124564 * linearRed + 0.3575761 * linearGreen + 0.1804375 * linearBlue;
  const y = 0.2126729 * linearRed + 0.7151522 * linearGreen + 0.072175 * linearBlue;
  const z = 0.0193339 * linearRed + 0.119192 * linearGreen + 0.9503041 * linearBlue;

  return xyzToOklab(x, y, z, alpha, raw);
}

function p3ToNormalized(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  raw: string
): NormalizedColor {
  // 1. P3 Gamma to Linear Display-P3
  const lp3 = (val: number) => (val > 0.04045 ? Math.pow((val + 0.055) / 1.055, 2.4) : val / 12.92);
  const linearRed = lp3(red);
  const linearGreen = lp3(green);
  const linearBlue = lp3(blue);

  // 2. Linear Display-P3 to XYZ (D65)
  // Absolute P3-D65 to XYZ matrix
  const x = 0.4865709 * linearRed + 0.2656677 * linearGreen + 0.1982119 * linearBlue;
  const y = 0.2289748 * linearRed + 0.6917385 * linearGreen + 0.0592867 * linearBlue;
  const z = 0.0 * linearRed + 0.0451104 * linearGreen + 1.0439444 * linearBlue;

  return xyzToOklab(x, y, z, alpha, raw);
}

function pivotRgb(colorValue: number) {
  return colorValue > 0.04045 ? Math.pow((colorValue + 0.055) / 1.055, 2.4) : colorValue / 12.92;
}

export function calculateDeltaE(color1: NormalizedColor, color2: NormalizedColor): number {
  const deltaL = color1.l - color2.l;
  const deltaA = color1.a - color2.a;
  const deltaB = color1.b - color2.b;
  const deltaAlpha = color1.alpha - color2.alpha;

  // Weighted distance: L, a, b + alpha weight
  return Math.sqrt(
    deltaL * deltaL + deltaA * deltaA + deltaB * deltaB + deltaAlpha * deltaAlpha * 0.5
  );
}

/**
 * Converts a NormalizedColor back to a CSS color string (rgb or rgba)
 */
export function serializeColor(color: NormalizedColor): string {
  if (color.alpha === 0) return "transparent";

  // Oklab to LMS'
  const lmsPrimeL = color.l + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const lmsPrimeM = color.l - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const lmsPrimeS = color.l - 0.0894841775 * color.a - 1.291485548 * color.b;

  // LMS' to LMS
  const lmsL = lmsPrimeL * lmsPrimeL * lmsPrimeL;
  const lmsM = lmsPrimeM * lmsPrimeM * lmsPrimeM;
  const lmsS = lmsPrimeS * lmsPrimeS * lmsPrimeS;

  // LMS to Linear RGB
  const linearR = +4.0767416621 * lmsL - 3.3077115913 * lmsM + 0.2309699292 * lmsS;
  const linearG = -1.2684380046 * lmsL + 2.6097574011 * lmsM - 0.3413193965 * lmsS;
  const linearB = -0.0041960863 * lmsL - 0.7034186147 * lmsM + 1.707612701 * lmsS;

  // Linear RGB to sRGB
  const red = Math.min(255, Math.max(0, Math.round(unpivotRgb(linearR) * 255)));
  const green = Math.min(255, Math.max(0, Math.round(unpivotRgb(linearG) * 255)));
  const blue = Math.min(255, Math.max(0, Math.round(unpivotRgb(linearB) * 255)));

  if (color.alpha >= 0.999) {
    return `rgb(${red}, ${green}, ${blue})`;
  }
  return `rgba(${red}, ${green}, ${blue}, ${Number(color.alpha.toFixed(3))})`;
}

function unpivotRgb(c: number): number {
  return c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
}

/**
 * Converts a NormalizedColor (Oklab) back to sRGB components (0-1 range).
 */
function oklabToSrgbComponents(color: NormalizedColor): {
  red: number;
  green: number;
  blue: number;
} {
  // Oklab to LMS'
  const lmsPrimeL = color.l + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const lmsPrimeM = color.l - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const lmsPrimeS = color.l - 0.0894841775 * color.a - 1.291485548 * color.b;

  // LMS' to LMS
  const lmsL = lmsPrimeL * lmsPrimeL * lmsPrimeL;
  const lmsM = lmsPrimeM * lmsPrimeM * lmsPrimeM;
  const lmsS = lmsPrimeS * lmsPrimeS * lmsPrimeS;

  // LMS to Linear RGB
  const linearR = +4.0767416621 * lmsL - 3.3077115913 * lmsM + 0.2309699292 * lmsS;
  const linearG = -1.2684380046 * lmsL + 2.6097574011 * lmsM - 0.3413193965 * lmsS;
  const linearB = -0.0041960863 * lmsL - 0.7034186147 * lmsM + 1.707612701 * lmsS;

  // Linear RGB to sRGB (clamped 0-1)
  return {
    red: Math.min(1, Math.max(0, unpivotRgb(linearR))),
    green: Math.min(1, Math.max(0, unpivotRgb(linearG))),
    blue: Math.min(1, Math.max(0, unpivotRgb(linearB))),
  };
}

/**
 * Calculates the relative luminance of a color per WCAG 2.1.
 * Input: NormalizedColor (Oklab internal representation)
 * Output: Luminance value between 0 (black) and 1 (white)
 */
export function getLuminance(color: NormalizedColor): number {
  const { red, green, blue } = oklabToSrgbComponents(color);

  // sRGB to linear (gamma expand)
  const rLin = red <= 0.04045 ? red / 12.92 : Math.pow((red + 0.055) / 1.055, 2.4);
  const gLin = green <= 0.04045 ? green / 12.92 : Math.pow((green + 0.055) / 1.055, 2.4);
  const bLin = blue <= 0.04045 ? blue / 12.92 : Math.pow((blue + 0.055) / 1.055, 2.4);

  // WCAG luminance formula
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Calculates the WCAG 2.1 contrast ratio between two colors.
 * Returns a value between 1 (no contrast) and 21 (max contrast).
 */
export function calculateContrastRatio(fg: NormalizedColor, bg: NormalizedColor): number {
  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}
