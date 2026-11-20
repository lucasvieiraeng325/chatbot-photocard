# chatbot-photocard

Atendimento virtual no **WhatsApp** para venda de photocards e outros artigos em PDF.

1. O cliente manda qualquer mensagem e recebe o **menu** com os produtos e preços.
2. Ao escolher um produto, recebe **prévias** (imagens com marca d'água "PRÉVIA") e a descrição.
3. Ao confirmar, o bot gera um **Pix** (QR code + Pix Copia e Cola) pelo Mercado Pago.
4. Quando o pagamento é **confirmado**, o bot envia automaticamente os **PDFs completos** que estão neste repositório.

```
👤 oi
🤖 Olá! 💜 Bem-vindo(a) à Photocards K-pop!
   1️⃣ ⭐ Pacote Premium Completo — R$ 29,90
   2️⃣ Pack Photocards K-pop — R$ 19,90
   3️⃣ Pack BTS Tour Arirang — R$ 12,90
   4️⃣ Photocards avulsos (por grupo) ➜
👤 3
🖼️ [prévias]  🤖 Pack BTS Tour Arirang … 💰 R$ 12,90   1️⃣ Comprar com Pix
👤 1
🤖 Pedido #C0FB3BE1 … 🖼️ [QR code]  🤖 00020126…(copia e cola)
   … cliente paga …
🤖 ✅ Pagamento confirmado!  📎 PDF  📎 PDF  📎 PDF …
```

Comandos que o cliente pode digitar a qualquer momento: `menu`, `pedidos`, `reenviar CÓDIGO`, `atendente`, `cancelar`, `pix`.

## Requisitos

- **Node.js 20+**
- Um número de WhatsApp para o bot (de preferência um chip só para a loja; funciona com WhatsApp Business)
- Conta no **Mercado Pago** com chave Pix cadastrada
- `pdftoppm` (poppler) **apenas** se for gerar novas prévias

## Como rodar

```bash
git clone https://github.com/lucasvieiraeng325/chatbot-photocard.git
```

```bash
cd chatbot-photocard
```

```bash
npm install
```

```bash
cp .env.example .env
```

Edite o `.env` e coloque o seu `MP_ACCESS_TOKEN` (Mercado Pago > Seu negócio > Configurações > Credenciais). Depois:

```bash
npm start
```

Na primeira vez aparece um **QR code** no terminal: no celular do bot abra *WhatsApp > Aparelhos conectados > Conectar um aparelho* e escaneie. A sessão fica salva em `data/auth/`, então nas próximas vezes conecta sozinho.

### Testar sem WhatsApp e sem pagar

```bash
npm run simular
```

Abre uma conversa no terminal com Pix falso (aprova sozinho em ~10 s, ou digite `pagar teste`).

```bash
npm test
```

Para testar no WhatsApp de verdade sem cobrar, use `PAYMENT_PROVIDER=mock` no `.env` (o Pix é falso e é aprovado automaticamente após `MOCK_APPROVE_SECONDS`, ou com `pagar teste`) — **nunca deixe assim em produção**.

## Produtos, preços e prévias

Tudo fica no [`catalog.json`](catalog.json):

```jsonc
{
  "menu": [
    {
      "id": "pack-bts-tour",                  // identificador único
      "nome": "Pack BTS Tour Arirang",
      "descricao": "Photocards especiais da turnê…",
      "preco": 12.90,                          // em reais
      "arquivos": ["PACOTE PREMIUM/BÔNUS/BTS TOUR ARIRIRANG"]  // pastas ou arquivos do repositório
    },
    {
      "categoria": "Photocards avulsos (por grupo)",   // submenu
      "produtos": [ { "id": "pc-bts", "nome": "Photocards BTS", "preco": 3.99, "arquivos": ["PACOTE PREMIUM/PHOTOCARDS KPOP/photocard - BTS.pdf"] } ]
    }
  ]
}
```

- **Os preços atuais são sugestões — ajuste antes de começar a vender.**
- Uma pasta em `arquivos` inclui tudo dentro dela (PDFs e o vídeo `.mp4`).
- **Para adicionar um produto**: suba o PDF no repositório, adicione a entrada no `catalog.json` e gere as prévias:

```bash
npm run previas
```

As prévias ficam em `previas/produtos/`: **uma imagem por produto**, um mosaico compacto com marca d'água (até 4 páginas para um PDF avulso; a 1ª página de cada PDF, até 9, para pacotes). Páginas só de texto, como o aviso de direitos autorais, são puladas. Para usar imagens próprias, coloque `"previas": ["previas/minha-imagem.jpg"]` no produto. Depois de alterar o catálogo, reinicie o bot.

## Como a confirmação do pagamento funciona

- O bot consulta o Mercado Pago a cada `PAYMENT_POLL_SECONDS` (15 s) para cada Pix pendente — **funciona sem precisar de domínio/URL pública**.
- Opcional: com `PUBLIC_URL` definido, o Mercado Pago avisa na hora em `POST /webhook/mercadopago` (confirmação instantânea). Configure `MP_WEBHOOK_SECRET` para validar a assinatura.
- Em qualquer caso, o PDF só é liberado depois de o bot **consultar o pagamento na API do Mercado Pago** e conferir status `approved`, o número do pedido e o valor — um aviso falso não libera nada.
- Se o bot reiniciar no meio de uma entrega, ela continua de onde parou ao voltar.
- Pedidos e conversas ficam em `data/db.json`.

## Hospedagem

O bot precisa ficar ligado 24h. Opções: uma VPS (Contabo, Hostinger, DigitalOcean, Oracle Cloud free tier…), Railway, Render (com disco persistente) etc. Precisa de disco persistente para `data/` (sessão do WhatsApp e pedidos). Para manter rodando numa VPS:

```bash
npm install -g pm2
```

```bash
pm2 start src/index.js --name photocard-bot && pm2 save
```

Para publicar novos PDFs: dê `git pull` no servidor e reinicie (`pm2 restart photocard-bot`).

## Observações importantes

- O bot usa o [Baileys](https://github.com/WhiskeySockets/Baileys) (conexão igual ao WhatsApp Web, pelo QR code). É a forma mais simples e gratuita, mas **não é a API oficial**: envio em massa ou spam pode levar ao bloqueio do número. O bot só responde quem manda mensagem, o que reduz esse risco. Se quiser migrar para a API oficial (WhatsApp Cloud API da Meta), basta trocar `src/whatsapp.js` — a lógica da conversa (`src/bot.js`) é independente.
- O Pacote Premium Completo tem ~860 MB em 58 arquivos; o envio leva alguns minutos e ocupa espaço no celular do cliente.
- Respeite os direitos autorais/de imagem do conteúdo que você vende.

## Estrutura

```
catalog.json            produtos, preços e arquivos
previas/                imagens de prévia (geradas por npm run previas)
PACOTE PREMIUM/         os PDFs que são vendidos
src/index.js            inicialização
src/bot.js              fluxo da conversa, pedidos, entrega
src/whatsapp.js         conexão com o WhatsApp (Baileys)
src/payments/           Mercado Pago (Pix) e provedor falso para testes
src/server.js           webhook do Mercado Pago
src/catalog.js          leitura do catálogo
src/store.js            pedidos/sessões em data/db.json
scripts/                gerar prévias, simulador de conversa
test/                   testes automatizados
```
