import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Armazenamento simples em arquivo JSON (pedidos e estado das conversas).
 * Suficiente para uma loja pequena; troque por um banco de dados se o volume crescer.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { orders: {}, sessions: {} };
    if (fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // ---- sessões (estado da conversa por contato) ----
  getSession(jid) {
    return this.data.sessions[jid] || { state: 'start' };
  }

  setSession(jid, session) {
    this.data.sessions[jid] = { ...session, updatedAt: new Date().toISOString() };
    this.save();
  }

  // ---- pedidos ----
  createOrder({ jid, product }) {
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const order = {
      id,
      jid,
      productId: product.id,
      productName: product.name,
      amount: product.price,
      status: 'pending', // pending -> paid -> delivered | expired | cancelled
      createdAt: new Date().toISOString(),
      resends: 0,
    };
    this.data.orders[id] = order;
    this.save();
    return order;
  }

  getOrder(id) {
    return this.data.orders[id];
  }

  updateOrder(id, patch) {
    Object.assign(this.data.orders[id], patch);
    this.save();
    return this.data.orders[id];
  }

  findOrders(pred) {
    return Object.values(this.data.orders).filter(pred);
  }

  findOrderByPaymentId(paymentId) {
    return this.findOrders((o) => String(o.paymentId) === String(paymentId))[0];
  }
}
