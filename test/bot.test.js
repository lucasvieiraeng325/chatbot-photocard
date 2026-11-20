import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { loadCatalog } from '../src/catalog.js';
import { Store } from '../src/store.js';
import { createMockProvider } from '../src/payments/mock.js';
import { Bot } from '../src/bot.js';

const JID = '5511988887777@s.whatsapp.net';

function setup() {
  const out = [];
  const sender = {
    sendText: async (jid, text) => out.push({ jid, type: 'text', text }),
    sendImage: async (jid, img, caption) => out.push({ jid, type: 'image', img, caption }),
    sendDocument: async (jid, file) => out.push({ jid, type: 'doc', file }),
  };
  const payments = createMockProvider({ approveAfterSeconds: -1 }); // só aprova manualmente
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-')), 'db.json'));
  const catalog = loadCatalog({ checkFiles: true });
  const bot = new Bot({
    catalog,
    store,
    payments,
    sender,
    config: { ...config, delayBetweenFilesMs: 0, adminNumbers: ['5511000000000'] },
    logger: { info() {}, warn() {}, error: console.error },
  });
  const say = async (t) => {
    out.length = 0;
    await bot.handleMessage(JID, t);
    return [...out];
  };
  return { bot, store, payments, catalog, say, out };
}

test('catálogo carrega e todos os arquivos existem', () => {
  const catalog = loadCatalog({ checkFiles: true });
  assert.ok(catalog.products.length > 5);
  for (const p of catalog.products) {
    assert.ok(p.files.length > 0, p.id);
    assert.ok(p.previews.length > 0, `${p.id} sem prévia`);
    for (const f of p.files) assert.ok(fs.existsSync(f.absPath));
  }
  // um item de menu para cada PDF, todos a R$ 5
  assert.equal(catalog.products.length, 56);
  for (const p of catalog.products) {
    assert.equal(p.files.length, 1, p.id);
    assert.equal(p.price, 5, p.id);
  }
});

test('fluxo completo: menu -> produto -> Pix -> pagamento -> entrega do PDF', async () => {
  const { say, store, payments, bot, out } = setup();

  let r = await say('oi');
  assert.match(r[0].text, /Bem-vindo/);
  assert.match(r[0].text, /BTS Arirang Tour/);

  // categoria de grupos -> primeiro grupo
  r = await say('1');
  assert.match(r[0].text, /grupos/);
  r = await say('1');
  assert.equal(r[0].type, 'image');
  assert.match(r[0].caption, /Prévia/);
  const info = r.at(-1).text;
  assert.match(info, /R\$/);
  assert.match(info, /Comprar/);

  // compra
  r = await say('1');
  assert.match(r[0].text, /Pedido #/);
  assert.equal(r[1].type, 'image'); // QR code
  assert.ok(Buffer.isBuffer(r[1].img));
  assert.match(r[2].text, /BR\.GOV\.BCB\.PIX/); // copia e cola
  const order = store.findOrders((o) => o.jid === JID)[0];
  assert.equal(order.status, 'pending');

  // ainda não pagou
  r = await say('já paguei');
  assert.match(r[0].text, /aguardando/);

  // pagamento aprovado -> polling entrega
  payments.approve(order.paymentId);
  out.length = 0;
  await bot.pollPendingOrders();
  assert.match(out[0].text, /Pagamento confirmado/);
  const docs = out.filter((m) => m.type === 'doc' && m.jid === JID);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].file.mimetype, 'application/pdf');
  assert.ok(out.some((m) => m.jid.startsWith('5511000000000') && /Venda/.test(m.text)));
  assert.equal(store.getOrder(order.id).status, 'delivered');

  // não entrega duas vezes
  out.length = 0;
  await bot.pollPendingOrders();
  await bot.handlePaymentNotification(order.paymentId);
  assert.equal(out.length, 0);

  // pedidos e reenvio
  r = await say('pedidos');
  assert.match(r[0].text, new RegExp(order.id));
  r = await say(`reenviar ${order.id}`);
  assert.equal(r.filter((m) => m.type === 'doc').length, 1);
});

test('cancelar pedido e opção inválida', async () => {
  const { say, store } = setup();
  await say('menu');
  let r = await say('99');
  assert.match(r[0].text, /Não entendi/);
  await say('3');
  await say('1');
  await say('1');
  r = await say('cancelar');
  assert.match(r[0].text, /cancelado/);
  assert.equal(store.findOrders((o) => o.jid === JID)[0].status, 'cancelled');
});

test('pagamento com valor menor não libera o PDF', async () => {
  const { say, store, payments, bot, out } = setup();
  await say('menu');
  await say('3');
  await say('2');
  await say('1');
  const order = store.findOrders((o) => o.jid === JID)[0];
  payments.approve(order.paymentId);
  store.updateOrder(order.id, { amount: order.amount + 10 });
  out.length = 0;
  await bot.pollPendingOrders();
  assert.equal(out.filter((m) => m.type === 'doc').length, 0);
});
