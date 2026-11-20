import QRCode from 'qrcode';

const NUM_EMOJI = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const num = (n) => NUM_EMOJI[n] || `*${n}.*`;
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const mb = (bytes) => `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalize = (t) =>
  (t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Extrai o número digitado ("2", "2.", "2️⃣", " 2 ") ou null. */
const parseChoice = (t) => {
  const m = /^\s*(\d{1,3})(?:\D|$)/.exec(t || '');
  return m ? Number(m[1]) : null;
};

const MENU_WORDS = new Set(['menu', 'inicio', 'oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'comecar', 'catalogo']);
const PAID_STATUSES = new Set(['approved']);

/**
 * Lógica da conversa. Não depende do WhatsApp diretamente: recebe um `sender` com
 * sendText / sendImage / sendDocument, o que permite testar com um simulador.
 */
export class Bot {
  constructor({ catalog, store, payments, sender, config, logger = console }) {
    this.catalog = catalog;
    this.store = store;
    this.payments = payments;
    this.sender = sender;
    this.config = config;
    this.log = logger;
    this.delivering = new Set();
    this.queues = new Map(); // processa mensagens de cada contato em ordem
  }

  // ------------------------------------------------------------------ entrada

  handleMessage(jid, text) {
    const prev = this.queues.get(jid) || Promise.resolve();
    const next = prev
      .then(() => this.#handle(jid, text))
      .catch((err) => {
        this.log.error({ err, jid }, 'erro ao processar mensagem');
        return this.sender
          .sendText(jid, '😕 Tive um probleminha aqui. Tente de novo em instantes ou digite *menu*.')
          .catch(() => {});
      });
    this.queues.set(jid, next);
    next.finally(() => this.queues.get(jid) === next && this.queues.delete(jid));
    return next;
  }

  async #handle(jid, rawText) {
    const text = normalize(rawText);
    const session = this.store.getSession(jid);

    // ---- comandos globais ----
    if (MENU_WORDS.has(text) || text === '#') return this.showMenu(jid, session.state === 'start');
    if (text === 'pedidos' || text === 'meus pedidos' || text === 'compras') return this.showOrders(jid);
    if (text.startsWith('reenviar')) return this.resend(jid, rawText.trim().split(/\s+/)[1]);
    if (text === 'atendente' || text === 'ajuda' || text === 'humano') return this.callHuman(jid);
    if (text === 'pagar teste' && this.payments.approve) return this.mockPay(jid);

    switch (session.state) {
      case 'category':
        return this.onCategoryInput(jid, session, text);
      case 'product':
        return this.onProductInput(jid, session, text);
      case 'awaiting_payment':
        return this.onAwaitingPaymentInput(jid, session, text);
      case 'menu':
        return this.onMenuInput(jid, text);
      default:
        return this.showMenu(jid, true);
    }
  }

  // ------------------------------------------------------------------ menus

  async showMenu(jid, greeting = false) {
    const lines = [];
    if (greeting) lines.push(`Olá! 💜 Bem-vindo(a) à *${this.config.storeName}*!`, '');
    lines.push('Escolha uma opção digitando o *número*:', '');
    this.catalog.menu.forEach((item, i) => {
      if (item.type === 'category') lines.push(`${num(i + 1)} ${item.name} ➜`);
      else lines.push(`${num(i + 1)} ${item.product.name} — *${brl(item.product.price)}*`);
    });
    lines.push('', '📦 Digite *pedidos* para ver suas compras', '🙋 Digite *atendente* para falar com uma pessoa');
    this.store.setSession(jid, { state: 'menu' });
    await this.sender.sendText(jid, lines.join('\n'));
  }

  async onMenuInput(jid, text) {
    const n = parseChoice(text);
    const item = n ? this.catalog.menu[n - 1] : null;
    if (!item) return this.invalid(jid, () => this.showMenu(jid));
    if (item.type === 'category') return this.showCategory(jid, item.id);
    return this.showProduct(jid, item.product.id, null);
  }

  async showCategory(jid, categoryId) {
    const cat = this.catalog.menu.find((m) => m.type === 'category' && m.id === categoryId);
    if (!cat) return this.showMenu(jid);
    const lines = [`*${cat.name}*`];
    if (cat.description) lines.push(cat.description);
    lines.push('');
    cat.products.forEach((p, i) => lines.push(`${num(i + 1)} ${p.name} — *${brl(p.price)}*`));
    lines.push('', `${num(0)} Voltar ao menu`);
    this.store.setSession(jid, { state: 'category', categoryId });
    await this.sender.sendText(jid, lines.join('\n'));
  }

  async onCategoryInput(jid, session, text) {
    const n = parseChoice(text);
    if (n === 0) return this.showMenu(jid);
    const cat = this.catalog.menu.find((m) => m.type === 'category' && m.id === session.categoryId);
    const product = cat?.products[n - 1];
    if (!product) return this.invalid(jid, () => this.showCategory(jid, session.categoryId));
    return this.showProduct(jid, product.id, session.categoryId);
  }

  async showProduct(jid, productId, categoryId) {
    const p = this.catalog.getProduct(productId);
    if (!p) return this.showMenu(jid);

    // prévias (imagens com marca d'água)
    for (const [i, img] of p.previews.entries()) {
      await this.sender.sendImage(jid, img, i === 0 ? `👀 Prévia — ${p.name}` : undefined);
    }

    const lines = [`*${p.name}*`];
    if (p.description) lines.push('', p.description);
    lines.push('', `📄 ${p.files.length} arquivo(s) • ${mb(p.totalSize)}`);
    if (p.files.length > 1 && p.files.length <= 15) {
      lines.push(...p.files.map((f) => `   • ${f.fileName.replace(/\.[^.]+$/, '')}`));
    }
    lines.push(`💰 *${brl(p.price)}*`, '', `${num(1)} Comprar com *Pix*`, `${num(0)} Voltar`);
    this.store.setSession(jid, { state: 'product', productId, categoryId });
    await this.sender.sendText(jid, lines.join('\n'));
  }

  async onProductInput(jid, session, text) {
    const n = parseChoice(text);
    if (n === 1 || text === 'comprar' || text === 'sim') return this.startPurchase(jid, session.productId);
    if (n === 0 || text === 'voltar') {
      return session.categoryId ? this.showCategory(jid, session.categoryId) : this.showMenu(jid);
    }
    return this.invalid(jid, () =>
      this.sender.sendText(jid, `Digite ${num(1)} para comprar ou ${num(0)} para voltar.`),
    );
  }

  async invalid(jid, reshow) {
    await this.sender.sendText(jid, '🤔 Não entendi. Responda só com o *número* da opção.');
    return reshow();
  }

  // ------------------------------------------------------------------ compra

  async startPurchase(jid, productId) {
    const product = this.catalog.getProduct(productId);
    if (!product) return this.showMenu(jid);

    // Reaproveita um Pix ainda válido do mesmo produto
    const now = Date.now();
    const existing = this.store.findOrders(
      (o) => o.jid === jid && o.productId === productId && o.status === 'pending' && Date.parse(o.expiresAt) > now + 60_000,
    )[0];
    if (existing) {
      this.store.setSession(jid, { state: 'awaiting_payment', orderId: existing.id });
      await this.sender.sendText(jid, `Você já tem um Pix em aberto para este produto (pedido *#${existing.id}*). Reenviando:`);
      return this.sendPixInstructions(jid, existing);
    }

    const order = this.store.createOrder({ jid, product });
    const expiresAt = new Date(now + this.config.pixExpirationMinutes * 60_000);
    let pix;
    try {
      pix = await this.payments.createPix({
        orderId: order.id,
        amount: product.price,
        description: `${this.config.storeName} - ${product.name}`.slice(0, 250),
        expiresAt,
      });
    } catch (err) {
      this.log.error({ err }, 'falha ao gerar Pix');
      this.store.updateOrder(order.id, { status: 'error', error: String(err.message || err) });
      await this.sender.sendText(jid, '😕 Não consegui gerar o Pix agora. Tente novamente em alguns minutos digitando *1*.');
      return;
    }

    const updated = this.store.updateOrder(order.id, {
      paymentId: pix.paymentId,
      pixCode: pix.qrCode,
      qrCodeBase64: pix.qrCodeBase64 || null,
      expiresAt: expiresAt.toISOString(),
    });
    this.store.setSession(jid, { state: 'awaiting_payment', orderId: order.id });
    await this.sendPixInstructions(jid, updated);
  }

  async sendPixInstructions(jid, order) {
    const expira = new Date(order.expiresAt).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
    const qr = order.qrCodeBase64
      ? Buffer.from(order.qrCodeBase64, 'base64')
      : await QRCode.toBuffer(order.pixCode, { width: 400, margin: 2 });

    await this.sender.sendText(
      jid,
      [
        `🧾 *Pedido #${order.id}*`,
        `${order.productName}`,
        `Valor: *${brl(order.amount)}*`,
        '',
        '💠 *Pague com Pix*: escaneie o QR code abaixo ou copie o código *Pix Copia e Cola* da próxima mensagem e cole no app do seu banco.',
        '',
        `⏰ Válido até ${expira}.`,
        '✅ Assim que o pagamento for confirmado eu envio os arquivos aqui automaticamente!',
      ].join('\n'),
    );
    await this.sender.sendImage(jid, qr, 'QR Code Pix');
    await this.sender.sendText(jid, order.pixCode);
    await this.sender.sendText(jid, `Digite *cancelar* para cancelar o pedido ou *menu* para voltar ao catálogo.`);
  }

  async onAwaitingPaymentInput(jid, session, text) {
    const order = this.store.getOrder(session.orderId);
    if (!order || order.status !== 'pending') return this.showMenu(jid);

    if (text === 'cancelar') {
      this.store.updateOrder(order.id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
      await this.payments.cancel?.(order.paymentId);
      await this.sender.sendText(jid, `Pedido *#${order.id}* cancelado.`);
      return this.showMenu(jid);
    }
    if (text === 'pix' || text === 'codigo' || text === 'qr') return this.sendPixInstructions(jid, order);

    // Usuário diz que já pagou: checa na hora
    await this.checkOrder(order);
    if (this.store.getOrder(order.id).status === 'pending') {
      await this.sender.sendText(
        jid,
        [
          `⏳ Ainda estou aguardando a confirmação do pagamento do pedido *#${order.id}*.`,
          'Assim que o banco confirmar (geralmente em segundos) eu envio os arquivos.',
          '',
          'Digite *pix* para ver o código de novo, *cancelar* para cancelar ou *menu* para o catálogo.',
        ].join('\n'),
      );
    }
  }

  // ------------------------------------------------------------------ pagamentos

  /** Confere um pedido no provedor de pagamento e entrega se estiver pago. */
  async checkOrder(order) {
    if (!order.paymentId || ['paid', 'delivered'].includes(order.status)) return;
    const payment = await this.payments.getPayment(order.paymentId);

    if (PAID_STATUSES.has(payment.status)) {
      if (payment.orderId && payment.orderId !== order.id) {
        this.log.warn({ order: order.id, payment }, 'pagamento não corresponde ao pedido');
        return;
      }
      if (Number(payment.amount) + 0.009 < order.amount) {
        this.log.warn({ order: order.id, payment }, 'valor pago menor que o do pedido');
        return;
      }
      const wasCancelled = order.status !== 'pending';
      this.store.updateOrder(order.id, { status: 'paid', paidAt: new Date().toISOString() });
      if (wasCancelled) this.log.warn({ order: order.id }, 'pedido cancelado/expirado foi pago — entregando mesmo assim');
      return this.deliver(order.id);
    }

    if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(payment.status) && order.status === 'pending') {
      this.store.updateOrder(order.id, { status: 'expired', paymentStatus: payment.status });
      await this.notifyExpired(order);
    }
  }

  /** Chamado pelo webhook do Mercado Pago. */
  async handlePaymentNotification(paymentId) {
    const order = this.store.findOrderByPaymentId(paymentId);
    if (!order) return;
    await this.checkOrder(order);
  }

  /** Varre pedidos pendentes (fallback caso o webhook não chegue / não esteja configurado). */
  async pollPendingOrders() {
    const now = Date.now();
    const graceMs = 10 * 60_000; // continua olhando pedidos cancelados/expirados por 10 min
    const orders = this.store.findOrders((o) => {
      if (!o.paymentId || !o.expiresAt) return false;
      if (o.status === 'pending') return true;
      return ['cancelled', 'expired'].includes(o.status) && Date.parse(o.expiresAt) + graceMs > now;
    });
    for (const order of orders) {
      try {
        await this.checkOrder(order);
        const fresh = this.store.getOrder(order.id);
        if (fresh.status === 'pending' && Date.parse(fresh.expiresAt) + 2 * 60_000 < now) {
          this.store.updateOrder(order.id, { status: 'expired' });
          await this.notifyExpired(fresh);
        }
      } catch (err) {
        this.log.error({ err, order: order.id }, 'erro ao consultar pagamento');
      }
    }
  }

  /** Reentrega pedidos pagos que não terminaram de ser entregues (ex.: o bot reiniciou no meio). */
  async resumePendingDeliveries() {
    for (const o of this.store.findOrders((o) => o.status === 'paid')) {
      await this.deliver(o.id).catch((err) => this.log.error({ err, order: o.id }, 'erro ao reentregar'));
    }
  }

  async notifyExpired(order) {
    const session = this.store.getSession(order.jid);
    if (session.state === 'awaiting_payment' && session.orderId === order.id) {
      this.store.setSession(order.jid, { state: 'menu' });
      await this.sender.sendText(
        order.jid,
        `⌛ O Pix do pedido *#${order.id}* expirou sem pagamento. Digite *menu* para fazer um novo pedido.`,
      );
    }
  }

  async mockPay(jid) {
    const session = this.store.getSession(jid);
    const order = session.orderId && this.store.getOrder(session.orderId);
    if (!order?.paymentId) return this.sender.sendText(jid, 'Nenhum pedido aguardando pagamento.');
    this.payments.approve(order.paymentId);
    return this.checkOrder(order);
  }

  // ------------------------------------------------------------------ entrega

  async deliver(orderId, { isResend = false } = {}) {
    if (this.delivering.has(orderId)) return;
    this.delivering.add(orderId);
    try {
      const order = this.store.getOrder(orderId);
      const product = this.catalog.getProduct(order.productId);
      const jid = order.jid;
      if (!product) {
        this.log.error({ orderId }, 'produto do pedido não existe mais no catálogo');
        await this.sender.sendText(jid, `Pagamento do pedido *#${order.id}* confirmado! Um atendente vai te enviar os arquivos em breve.`);
        await this.notifyAdmins(`⚠️ Pedido #${order.id} pago, mas o produto "${order.productId}" não está no catálogo. Envie manualmente.`);
        return;
      }

      const intro = isResend
        ? `📤 Reenviando os arquivos do pedido *#${order.id}*...`
        : `✅ *Pagamento confirmado!* Obrigado pela compra 💜\n\nEstou enviando ${product.files.length} arquivo(s) de *${product.name}*. Pode levar alguns minutinhos, não feche a conversa.`;
      await this.sender.sendText(jid, intro);

      // Continua de onde parou se o bot caiu no meio da entrega
      const start = isResend ? 0 : order.deliveredFiles || 0;
      for (let i = start; i < product.files.length; i++) {
        const f = product.files[i];
        await this.sender.sendDocument(jid, f);
        if (!isResend) this.store.updateOrder(order.id, { deliveredFiles: i + 1 });
        if (i < product.files.length - 1) await sleep(this.config.delayBetweenFilesMs);
      }

      if (!isResend) {
        this.store.updateOrder(order.id, { status: 'delivered', deliveredAt: new Date().toISOString() });
        this.store.setSession(jid, { state: 'menu' });
        await this.notifyAdmins(`💰 Venda! Pedido #${order.id} • ${product.name} • ${brl(order.amount)} • ${jid.split('@')[0]}`);
      }
      await this.sender.sendText(
        jid,
        [
          '🎉 Pronto! Todos os arquivos foram enviados.',
          '',
          `Se algum arquivo não abrir, digite *reenviar ${order.id}*.`,
          'Digite *menu* para ver mais produtos.',
        ].join('\n'),
      );
    } finally {
      this.delivering.delete(orderId);
    }
  }

  async showOrders(jid) {
    const orders = this.store
      .findOrders((o) => o.jid === jid && ['paid', 'delivered', 'pending'].includes(o.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
    if (!orders.length) {
      await this.sender.sendText(jid, 'Você ainda não tem pedidos. Digite *menu* para ver o catálogo.');
      return;
    }
    const label = { pending: '⏳ aguardando pagamento', paid: '✅ pago (enviando)', delivered: '✅ entregue' };
    const lines = ['📦 *Seus pedidos*', ''];
    for (const o of orders) lines.push(`*#${o.id}* — ${o.productName} — ${brl(o.amount)} — ${label[o.status]}`);
    lines.push('', 'Para receber os arquivos de novo: *reenviar CÓDIGO* (ex.: reenviar ' + orders[0].id + ')');
    await this.sender.sendText(jid, lines.join('\n'));
  }

  async resend(jid, code) {
    const order = code && this.store.getOrder(code.replace('#', '').toUpperCase());
    if (!order || order.jid !== jid || order.status !== 'delivered') {
      await this.sender.sendText(jid, 'Não encontrei esse pedido entregue no seu número. Digite *pedidos* para ver os códigos.');
      return;
    }
    if (order.resends >= this.config.maxResends) {
      await this.sender.sendText(jid, 'Esse pedido já atingiu o limite de reenvios. Digite *atendente* para falar com a gente.');
      return;
    }
    this.store.updateOrder(order.id, { resends: order.resends + 1 });
    await this.deliver(order.id, { isResend: true });
  }

  async callHuman(jid) {
    await this.sender.sendText(jid, '🙋 Certo! Já avisei a equipe, alguém vai te responder por aqui em breve.');
    await this.notifyAdmins(`🙋 O cliente ${jid.split('@')[0]} pediu atendimento humano.`);
  }

  async notifyAdmins(text) {
    for (const n of this.config.adminNumbers) {
      await this.sender.sendText(`${n}@s.whatsapp.net`, text).catch((err) => this.log.error({ err }, 'falha ao avisar admin'));
    }
  }
}
