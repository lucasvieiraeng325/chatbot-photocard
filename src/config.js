import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, def) => (v === undefined || v === '' ? def : Number(v));
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  // Pasta onde estão os PDFs (por padrão, a raiz deste repositório)
  contentDir: path.resolve(ROOT, process.env.CONTENT_DIR || '.'),
  catalogFile: path.resolve(ROOT, process.env.CATALOG_FILE || 'catalog.json'),
  previewDir: path.resolve(ROOT, process.env.PREVIEW_DIR || 'previas'),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),

  storeName: process.env.STORE_NAME || 'Photocards K-pop',

  // WhatsApp
  // Número do WhatsApp do bot (só dígitos, com DDI). Se definido, o login é feito por
  // "código de pareamento" em vez do QR code.
  pairingNumber: (process.env.WHATSAPP_PAIRING_NUMBER || '').replace(/\D/g, ''),
  // Números (com DDI, só dígitos) que recebem aviso de cada venda
  adminNumbers: list(process.env.ADMIN_NUMBERS).map((n) => n.replace(/\D/g, '')),

  // Pagamentos
  paymentProvider: (process.env.PAYMENT_PROVIDER || 'mercadopago').toLowerCase(),
  mercadoPago: {
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    webhookSecret: process.env.MP_WEBHOOK_SECRET || '',
    payerEmail: process.env.MP_PAYER_EMAIL || 'comprador@email.com',
  },
  pixExpirationMinutes: num(process.env.PIX_EXPIRATION_MINUTES, 30),
  paymentPollSeconds: num(process.env.PAYMENT_POLL_SECONDS, 15),
  mockApproveSeconds: num(process.env.MOCK_APPROVE_SECONDS, 20),

  // Servidor HTTP (webhook do Mercado Pago + health check)
  port: num(process.env.PORT, 3000),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),

  // Entrega
  delayBetweenFilesMs: num(process.env.DELAY_BETWEEN_FILES_MS, 1500),
  maxResends: num(process.env.MAX_RESENDS, 3),
};
