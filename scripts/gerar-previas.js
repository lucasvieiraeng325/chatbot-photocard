#!/usr/bin/env node
// Gera UMA imagem de prévia por produto: um mosaico compacto com marca d'água "PRÉVIA".
//   - produto com vários PDFs  -> 1ª página "boa" de cada PDF (até 9, grade 3x3)
//   - produto com um só PDF    -> até 4 páginas desse PDF (grade 2x2)
// Páginas de texto (ex.: "Aviso de uso e direitos autorais") são puladas.
//
//   npm run previas            -> gera só as prévias que ainda não existem
//   npm run previas -- --force -> regera todas
//
// Requer o `pdftoppm`/`pdftotext` (poppler-utils no Linux, `brew install poppler` no Mac).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { loadCatalog, productPreviewPath, slugify } from '../src/catalog.js';
import { config } from '../src/config.js';

const force = process.argv.includes('--force');
const CACHE = path.join(config.previewDir, '.cache'); // páginas renderizadas (fora do git)
const CEL_W = 400;
const CEL_H = 560;
const PAGINAS_ANALISADAS = 6;
const MAX_POR_PDF = 4;

const pageCount = (pdf) => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf]).toString())?.[1] || 1);
const pageText = (pdf, p) =>
  execFileSync('pdftotext', ['-f', String(p), '-l', String(p), pdf, '-']).toString().replace(/\s/g, '');

function renderPage(pdf, p) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'previa-'));
  try {
    execFileSync('pdftoppm', ['-f', String(p), '-l', String(p), '-scale-to', String(CEL_H * 2), '-jpeg', pdf, path.join(tmp, 'p')]);
    const f = fs.readdirSync(tmp).find((x) => x.endsWith('.jpg'));
    return fs.readFileSync(path.join(tmp, f));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Fração de pixels quase brancos — página de texto/aviso tem quase tudo branco. */
async function whiteFraction(img) {
  const { data } = await sharp(img).resize(80, 112, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let w = 0;
  for (const v of data) if (v > 230) w++;
  return w / data.length;
}

/** Retorna até `max` páginas "boas" (com imagens) do PDF, com cache em disco. */
async function goodPages(pdf, max) {
  const dir = path.join(CACHE, slugify(path.relative(config.contentDir, pdf).replace(/\.pdf$/i, '')));
  const meta = path.join(dir, 'paginas.json');
  if (!force && fs.existsSync(meta)) {
    const cached = JSON.parse(fs.readFileSync(meta, 'utf8'));
    return cached.pages.slice(0, max).map((f) => fs.readFileSync(path.join(dir, f)));
  }
  fs.mkdirSync(dir, { recursive: true });
  const total = pageCount(pdf);
  const good = [];
  let first = null;
  for (let p = 1; p <= Math.min(total, PAGINAS_ANALISADAS) && good.length < MAX_POR_PDF; p++) {
    const img = renderPage(pdf, p);
    const name = `p${p}.jpg`;
    await sharp(img).resize(CEL_W, CEL_H, { fit: 'cover', position: 'top' }).jpeg({ quality: 80 }).toFile(path.join(dir, name));
    first ??= name;
    const isText = pageText(pdf, p).length > 300 || (await whiteFraction(img)) > 0.8;
    if (!isText) good.push(name);
  }
  if (!good.length) good.push(first); // PDF só de texto: usa a 1ª página mesmo
  fs.writeFileSync(meta, JSON.stringify({ pages: good }));
  return good.slice(0, max).map((f) => fs.readFileSync(path.join(dir, f)));
}

function watermark(width, height) {
  const t = [];
  for (let y = -height; y < height * 2; y += 170) for (let x = -width; x < width * 2; x += 330) t.push(`<text x="${x}" y="${y}">PRÉVIA</text>`);
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-30 ${width / 2} ${height / 2})" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="bold"
       fill="#ffffff" fill-opacity="0.5" stroke="#000000" stroke-opacity="0.3" stroke-width="1.5">${t.join('')}</g></svg>`);
}

async function mosaic(tiles, destino) {
  const cols = tiles.length >= 5 ? 3 : tiles.length >= 2 ? 2 : 1;
  const used = tiles.slice(0, cols === 3 ? 9 : cols === 2 ? 4 : 1);
  const rows = Math.ceil(used.length / cols);
  const W = cols * CEL_W;
  const H = rows * CEL_H;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite([
      ...used.map((input, i) => ({ input, left: (i % cols) * CEL_W, top: Math.floor(i / cols) * CEL_H })),
      { input: watermark(W, H) },
    ])
    .jpeg({ quality: 72 })
    .toFile(destino);
}

const catalog = loadCatalog({ checkFiles: true });
let n = 0;
for (const p of catalog.products) {
  const destino = productPreviewPath(p.id);
  if (!force && fs.existsSync(destino)) continue;
  const pdfs = p.files.filter((f) => f.mimetype === 'application/pdf');
  if (!pdfs.length) continue;
  try {
    const tiles =
      pdfs.length === 1
        ? await goodPages(pdfs[0].absPath, 4)
        : (await Promise.all(pdfs.slice(0, 12).map((f) => goodPages(f.absPath, 1)))).flat().slice(0, 9);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    await mosaic(tiles, destino);
    n++;
    console.log('✔', p.id);
  } catch (err) {
    console.error('✘', p.id, '-', err.message);
  }
}
console.log(`\n${n} prévia(s) gerada(s) em ${path.relative(process.cwd(), path.dirname(productPreviewPath('x')))}`);
