import crypto from 'node:crypto';

const API = 'https://api.mercadopago.com';

/** Formata a data no fuso de Brasília (UTC-3), formato aceito pelo Mercado Pago. */
function toMpDate(date) {
  const local = new Date(date.getTime() - 3 * 3600 * 1000);
  return local.toISOString().replace('Z', '-03:00');
}

/**
 * Pix via API de Pagamentos do Mercado Pago.
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/payment-methods/receiving-payment-by-pix
 */
export function createMercadoPagoProvider({ accessToken, payerEmail, notificationUrl, webhookSecret }) {
  if (!accessToken) throw new Error('Defina MP_ACCESS_TOKEN no .env (credencial de produção ou de teste do Mercado Pago)');

  async function request(method, url, body, extraHeaders = {}) {
    const res = await fetch(API + url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Mercado Pago ${method} ${url} -> ${res.status}: ${json.message || JSON.stringify(json)}`);
    }
    return json;
  }

  return {
    name: 'mercadopago',

    async createPix({ orderId, amount, description, expiresAt }) {
      const payment = await request(
        'POST',
        '/v1/payments',
        {
          transaction_amount: amount,
          description,
          payment_method_id: 'pix',
          external_reference: orderId,
          date_of_expiration: toMpDate(expiresAt),
          payer: { email: payerEmail },
          ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        },
        { 'X-Idempotency-Key': `pedido-${orderId}` },
      );
      const tx = payment.point_of_interaction?.transaction_data || {};
      return {
        paymentId: String(payment.id),
        qrCode: tx.qr_code,
        qrCodeBase64: tx.qr_code_base64,
        ticketUrl: tx.ticket_url,
      };
    },

    /** Retorna { status: 'approved' | 'pending' | 'rejected' | 'cancelled' | ..., amount, orderId } */
    async getPayment(paymentId) {
      const p = await request('GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
      return { status: p.status, amount: p.transaction_amount, orderId: p.external_reference };
    },

    async cancel(paymentId) {
      await request('PUT', `/v1/payments/${encodeURIComponent(paymentId)}`, { status: 'cancelled' }).catch(() => {});
    },

    /**
     * Valida a assinatura x-signature do webhook (opcional: o pagamento é sempre
     * reconsultado na API antes de liberar o PDF, então um webhook falso não libera nada).
     */
    verifyWebhook({ headers, dataId }) {
      if (!webhookSecret) return true;
      const sig = headers['x-signature'] || '';
      const requestId = headers['x-request-id'] || '';
      const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
      if (!parts.ts || !parts.v1) return false;
      const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
      const expected = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');
      return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
    },
  };
}
