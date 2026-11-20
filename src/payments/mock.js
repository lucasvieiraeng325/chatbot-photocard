/**
 * Provedor FALSO, só para testes: gera um "Pix" fictício e aprova sozinho
 * depois de `approveAfterSeconds` (ou na hora, se você mandar "pagar teste" no chat).
 * NUNCA use em produção.
 */
export function createMockProvider({ approveAfterSeconds = 20 } = {}) {
  const payments = new Map();
  let seq = 1000;
  return {
    name: 'mock',
    async createPix({ orderId, amount }) {
      const paymentId = String(++seq);
      payments.set(paymentId, { status: 'pending', amount, orderId, createdAt: Date.now() });
      return {
        paymentId,
        qrCode: `00020126580014BR.GOV.BCB.PIX-TESTE-${orderId}-${amount.toFixed(2)}`,
        qrCodeBase64: null,
      };
    },
    async getPayment(paymentId) {
      const p = payments.get(paymentId);
      if (!p) return { status: 'not_found' };
      if (p.status === 'pending' && approveAfterSeconds >= 0 && Date.now() - p.createdAt > approveAfterSeconds * 1000) {
        p.status = 'approved';
      }
      return { status: p.status, amount: p.amount, orderId: p.orderId };
    },
    async cancel(paymentId) {
      const p = payments.get(paymentId);
      if (p) p.status = 'cancelled';
    },
    approve(paymentId) {
      const p = payments.get(paymentId);
      if (p) p.status = 'approved';
    },
    verifyWebhook: () => true,
  };
}
