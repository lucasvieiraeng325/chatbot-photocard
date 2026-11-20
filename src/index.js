import path from 'node:path';
import pino from 'pino';
import { config } from './config.js';
import { loadCatalog } from './catalog.js';
import { Store } from './store.js';
import { createPaymentProvider } from './payments/index.js';
import { Bot } from './bot.js';
import { startWhatsApp, defaultAuthDir } from './whatsapp.js';
import { startServer } from './server.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const catalog = loadCatalog({ checkFiles: true });
logger.info(`📚 Catálogo: ${catalog.products.length} produtos`);
for (const p of catalog.products) {
  if (!p.previews.length) logger.warn(`Produto "${p.id}" sem prévia — rode "npm run previas"`);
}

const store = new Store(path.join(config.dataDir, 'db.json'));
const payments = createPaymentProvider();

let bot;
const sender = await startWhatsApp({
  authDir: defaultAuthDir(config.dataDir),
  pairingNumber: config.pairingNumber,
  logger,
  onMessage: (jid, text) => bot.handleMessage(jid, text),
});
bot = new Bot({ catalog, store, payments, sender, config, logger });

startServer({ port: config.port, bot, payments, logger });

// Consulta periódica dos Pix pendentes (funciona mesmo sem webhook/URL pública)
setInterval(() => bot.pollPendingOrders().catch((err) => logger.error({ err }, 'poll')), config.paymentPollSeconds * 1000);
setTimeout(() => bot.resumePendingDeliveries(), 15_000);
