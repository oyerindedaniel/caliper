export const shimmer = (w: number, h: number) => `
<svg width="${w}" height="${h}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect width="${w}" height="${h}" fill="#0d0d0d" />
  <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop stop-color="#0d0d0d" offset="20%" />
    <stop stop-color="#1a1a1a" offset="50%" />
    <stop stop-color="#0d0d0d" offset="70%" />
  </linearGradient>
  <rect width="${w}" height="${h}" fill="url(#g)">
    <animate attributeName="x" from="-${w}" to="${w}" dur="2s" repeatCount="indefinite" />
  </rect>
</svg>`;

export const toBase64 = (str: string) =>
  typeof window === "undefined" ? Buffer.from(str).toString("base64") : window.btoa(str);

export const getShimmerDataUrl = (w: number, h: number) =>
  `data:image/svg+xml;base64,${toBase64(shimmer(w, h))}`;
