import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const MIME = {
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Caminho da imagem de prévia de um arquivo (PDF) do repositório. */
export function previewPathForFile(absPath) {
  const rel = path.relative(config.contentDir, absPath);
  return path.join(config.previewDir, 'arquivos', slugify(rel.replace(/\.[^.]+$/, '')) + '.jpg');
}

/** Caminho do mosaico de prévia de um produto com vários arquivos. */
export function productPreviewPath(productId) {
  return path.join(config.previewDir, 'produtos', slugify(productId) + '.jpg');
}

function resolveInside(base, rel) {
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error(`Caminho fora da pasta de conteúdo: ${rel}`);
  }
  return abs;
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function expandFiles(paths, { checkFiles }) {
  const files = [];
  for (const rel of paths) {
    const abs = resolveInside(config.contentDir, rel);
    if (!fs.existsSync(abs)) {
      if (checkFiles) throw new Error(`Arquivo/pasta do catálogo não encontrado: ${rel}`);
      continue;
    }
    const list = fs.statSync(abs).isDirectory() ? listFilesRecursive(abs) : [abs];
    for (const f of list) {
      const ext = path.extname(f).toLowerCase();
      if (!MIME[ext]) continue;
      files.push({
        absPath: f,
        relPath: path.relative(config.contentDir, f),
        fileName: path.basename(f).replace(/^Cópia de (Cópia de )?/i, ''),
        mimetype: MIME[ext],
        size: fs.statSync(f).size,
      });
    }
  }
  return files;
}

function buildProduct(raw, opts) {
  if (!raw.id || !raw.nome || raw.preco === undefined) {
    throw new Error(`Produto inválido no catálogo (precisa de id, nome e preco): ${JSON.stringify(raw)}`);
  }
  const files = expandFiles(raw.arquivos || [], opts);
  if (opts.checkFiles && files.length === 0) throw new Error(`Produto "${raw.id}" não tem arquivos`);

  let previews;
  if (raw.previas?.length) {
    previews = raw.previas.map((p) => resolveInside(path.dirname(config.catalogFile), p));
  } else {
    const mosaic = productPreviewPath(raw.id);
    const covers = files.map((f) => previewPathForFile(f.absPath));
    previews = files.length > 1 ? [mosaic, ...covers.slice(0, 3)] : covers;
  }
  previews = previews.filter((p) => fs.existsSync(p));

  return {
    id: raw.id,
    name: raw.nome,
    description: raw.descricao || '',
    price: Math.round(Number(raw.preco) * 100) / 100,
    files,
    totalSize: files.reduce((s, f) => s + f.size, 0),
    previews,
  };
}

/**
 * Carrega o catalog.json. Formato:
 * { "menu": [ produto | { "categoria": "Nome", "descricao": "...", "produtos": [produto, ...] } ] }
 * produto = { "id", "nome", "descricao", "preco", "arquivos": ["pasta/ou/arquivo.pdf"], "previas"?: ["img.jpg"] }
 */
export function loadCatalog({ checkFiles = false } = {}) {
  const raw = JSON.parse(fs.readFileSync(config.catalogFile, 'utf8'));
  const products = [];
  const byId = new Map();
  const add = (p) => {
    if (byId.has(p.id)) throw new Error(`id de produto duplicado no catálogo: ${p.id}`);
    byId.set(p.id, p);
    products.push(p);
    return p;
  };

  const menu = (raw.menu || []).map((item) => {
    if (item.categoria) {
      return {
        type: 'category',
        id: slugify(item.categoria),
        name: item.categoria,
        description: item.descricao || '',
        products: item.produtos.map((p) => add(buildProduct(p, { checkFiles }))),
      };
    }
    return { type: 'product', product: add(buildProduct(item, { checkFiles })) };
  });

  return { menu, products, byId, getProduct: (id) => byId.get(id) };
}
