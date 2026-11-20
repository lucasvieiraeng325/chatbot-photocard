#!/usr/bin/env node
// Simula o chatbot no terminal, sem WhatsApp e com Pix FALSO (aprovado em ~10s
// ou na hora digitando "pagar teste"). Útil para testar menus e preços.
//
//   npm run simular

import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { config } from '../src/config.js';
import { loadCatalog } from '../src/catalog.js';
import { Store } from '../src/store.js';
import { createMockProvider } from '../src/payments/mock.js';
import { Bot } from '../src/bot.js';

const JID = '5511999999999@s.whatsapp.net';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-'));
const rel = (p) => path.relative(process.cwd(), p);

const sender = {
  async sendText(_jid, text) {
    console.log(`\n🤖 ${text.replace(/\n/g, '\n   ')}`);
  },
  async sendImage(_jid, img, caption) {
    console.log(`\n🖼️  [imagem: ${Buffer.isBuffer(img) ? 'QR code gerado' : rel(img)}]${caption ? ' ' + caption : ''}`);
  },
  async sendDocument(_jid, file) {
    console.log(`📎 [arquivo: ${file.fileName} — ${(file.size / 1048576).toFixed(1)} MB]`);
  },
};

const bot = new Bot({
  catalog: loadCatalog({ checkFiles: true }),
  store: new Store(path.join(tmp, 'db.json')),
  payments: createMockProvider({ approveAfterSeconds: 10 }),
  sender,
  config: { ...config, delayBetweenFilesMs: 0, adminNumbers: [] },
  logger: { info() {}, warn: console.warn, error: console.error },
});

setInterval(() => bot.pollPendingOrders(), 2000).unref();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Simulador do chatbot. Digite mensagens como se fosse o cliente (Ctrl+C para sair).');
rl.setPrompt('\n👤 ');
rl.prompt();
rl.on('line', async (line) => {
  await bot.handleMessage(JID, line);
  rl.prompt();
});
rl.on('close', () => process.exit(0));
