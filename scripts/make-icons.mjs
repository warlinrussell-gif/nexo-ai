// Genera el icono de Nexo AI (PNG + ICO multi-resolución + icono de bandeja) a partir de SVG.
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const svg = (size = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="0.55" stop-color="#6d28d9"/>
      <stop offset="1" stop-color="#0891b2"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.22" r="0.8">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pink" cx="0.85" cy="0.9" r="0.6">
      <stop offset="0" stop-color="#f472b6" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#f472b6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e0e7ff"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="228" fill="url(#bg)"/>
  <rect x="32" y="32" width="960" height="960" rx="228" fill="url(#pink)"/>
  <rect x="32" y="32" width="960" height="960" rx="228" fill="url(#glow)"/>
  <circle cx="512" cy="512" r="238" fill="none" stroke="url(#ring)" stroke-width="84"/>
  <circle cx="512" cy="512" r="82" fill="#ffffff"/>
  <circle cx="704" cy="332" r="66" fill="#ffffff" stroke="#6d28d9" stroke-width="26"/>
  <circle cx="318" cy="700" r="46" fill="#ffffff" stroke="#0e7490" stroke-width="20"/>
</svg>`;

const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" stroke-width="7"/>
  <circle cx="32" cy="32" r="6" fill="#ffffff"/>
  <circle cx="46" cy="18" r="6" fill="#a78bfa"/>
</svg>`;

const render = (s, w) => new Resvg(s, { fitTo: { mode: 'width', value: w } }).render().asPng();

fs.mkdirSync('build', { recursive: true });
fs.mkdirSync('resources', { recursive: true });
const big = render(svg(), 1024);
fs.writeFileSync('build/icon.png', big);
fs.writeFileSync('resources/icon.png', render(svg(), 512));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => render(svg(), s));
const ico = await pngToIco(pngs);
fs.writeFileSync('build/icon.ico', ico);
fs.writeFileSync('resources/icon.ico', ico);
fs.writeFileSync('resources/tray.png', render(traySvg, 32));
fs.writeFileSync('resources/tray@2x.png', render(traySvg, 64));
console.log('Iconos generados:', fs.readdirSync('build'), fs.readdirSync('resources'));
