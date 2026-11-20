import http from 'node:http';

/**
 * Servidor HTTP mínimo:
 *   GET  /health                 -> "ok"
 *   POST /webhook/mercadopago    -> notificações de pagamento do Mercado Pago
 */
export function startServer({ port, bot, payments, logger }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200).end('ok');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/webhook/mercadopago') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 100_000) req.destroy();
      });
      req.on('end', () => {
        res.writeHead(200).end('ok'); // responde rápido; o MP reenvia se não receber 200
        let json = {};
        try {
          json = JSON.parse(body || '{}');
        } catch {}
        const type = json.type || url.searchParams.get('type') || url.searchParams.get('topic');
        const dataId = json.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id');
        if (type !== 'payment' || !dataId) return;
        if (!payments.verifyWebhook({ headers: req.headers, dataId: url.searchParams.get('data.id') || dataId })) {
          logger.warn('webhook do Mercado Pago com assinatura inválida, ignorado');
          return;
        }
        bot.handlePaymentNotification(String(dataId)).catch((err) => logger.error({ err }, 'erro no webhook'));
      });
      return;
    }

    res.writeHead(404).end();
  });
  server.listen(port, () => logger.info(`🌐 Servidor HTTP na porta ${port} (webhook: /webhook/mercadopago)`));
  return server;
}
