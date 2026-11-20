import { config } from '../config.js';
import { createMercadoPagoProvider } from './mercadopago.js';
import { createMockProvider } from './mock.js';

export function createPaymentProvider() {
  switch (config.paymentProvider) {
    case 'mercadopago':
      return createMercadoPagoProvider({
        ...config.mercadoPago,
        notificationUrl: config.publicUrl ? `${config.publicUrl}/webhook/mercadopago` : undefined,
      });
    case 'mock':
      console.warn('⚠️  PAYMENT_PROVIDER=mock: pagamentos FALSOS, aprovados automaticamente. Use só para testes!');
      return createMockProvider({ approveAfterSeconds: config.mockApproveSeconds });
    default:
      throw new Error(`PAYMENT_PROVIDER desconhecido: ${config.paymentProvider}`);
  }
}
