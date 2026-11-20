#!/usr/bin/env node
// Gera imagens de prévia (com marca d'água "PRÉVIA") para os PDFs do catálogo.
//
//   npm run previas            -> gera só as prévias que ainda não existem
//   npm run previas -- --force -> regera todas
//
// Requer o `pdftoppm` (pacote poppler-utils no Linux, `brew install poppler` no Mac).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { loadCatalog, previewPathForFile, productPreviewPath } from '../src/catalog.js';
import { config } from '../src/config.js';

const force = process.argv.includes('--force');
const LARGURA = 600;

function watermark(width, height) {
  const linhas = [];
  for (let y = -height; y < height * 2; y += 140) {
    for (let x = -width; x < width * 2; x += 260) {
      linhas.push(`<text x="${x}" y="${y}">PRÉVIA</text>`);
    }
  }
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-30 ${width / 2} ${height / 2})"
         font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="bold"
         fill="#ffffff" fill-opacity="0.55" stroke="#000000" stroke-opacity="0.35" stroke-width="1.5">
        ${linhas.join('')}
      </g>
    </svg>`);
}

async function renderPrimeiraPagina(pdf) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'previa-'));
  try {
    const prefixo = path.join(tmp, 'p');
    execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-scale-to', String(LARGURA * 2), '-jpeg', pdf, prefixo]);
    const gerado = fs.readdirSync(tmp).find((f) => f.endsWith('.jpg'));
    if (!gerado) throw new Error('pdftoppm não gerou imagem');
    return fs.readFileSync(path.join(tmp, gerado));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function comMarcaDagua(input) {
  const img = sharp(input).resize({ width: LARGURA, height: LARGURA * 1.5, fit: 'inside' });
  const { width, height } = await img.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
  return img.composite([{ input: watermark(width, height) }]).jpeg({ quality: 70 }).toBuffer();
}

async function mosaico(imagens, destino) {
  const cols = imagens.length >= 9 ? 3 : imagens.length >= 4 ? 2 : imagens.length;
  const usadas = imagens.slice(0, cols * cols);
  const cel = 400;
  const altura = Math.round(cel * 1.4);
  const linhas = Math.ceil(usadas.length / cols);
  const tiles = await Promise.all(
    usadas.map(async (img, i) => ({
      input: await sharp(img).resize(cel, altura, { fit: 'cover', position: 'top' }).toBuffer(),
      left: (i % cols) * cel,
      top: Math.floor(i / cols) * altura,
    })),
  );
  const W = cols * cel;
  const H = linhas * altura;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite([...tiles, { input: watermark(W, H) }])
    .jpeg({ quality: 70 })
    .toFile(destino);
}

const catalog = loadCatalog({ checkFiles: true });
const pdfs = new Set();
for (const p of catalog.products) for (const f of p.files) if (f.mimetype === 'application/pdf') pdfs.add(f.absPath);

let geradas = 0;
for (const pdf of pdfs) {
  const destino = previewPathForFile(pdf);
  if (!force && fs.existsSync(destino)) continue;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    fs.writeFileSync(destino, await comMarcaDagua(await renderPrimeiraPagina(pdf)));
    geradas++;
    console.log('✔', path.relative(config.contentDir, pdf));
  } catch (err) {
    console.error('✘', path.relative(config.contentDir, pdf), '-', err.message);
  }
}

for (const p of catalog.products) {
  const capas = p.files.map((f) => previewPathForFile(f.absPath)).filter((f) => fs.existsSync(f));
  if (capas.length < 2) continue;
  const destino = productPreviewPath(p.id);
  if (!force && fs.existsSync(destino)) continue;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  await mosaico(capas, destino);
  geradas++;
  console.log('✔ mosaico', p.id);
}

console.log(`\n${geradas} prévia(s) gerada(s) em ${path.relative(process.cwd(), config.previewDir) || '.'}`);
