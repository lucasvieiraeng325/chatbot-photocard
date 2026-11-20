# Colocar o bot no ar 24h (VPS)

## 1. Escolher o servidor

O bot é leve: **1 vCPU, 1 GB de RAM e 10 GB de disco** bastam (o repositório com os PDFs ocupa ~1 GB).
Escolha uma VPS com **Ubuntu 24.04** (ou 22.04):

| Opção | Custo aprox. | Observação |
|---|---|---|
| **Hostinger VPS KVM 1** | ~R$ 30–40/mês | Painel em português, servidor no Brasil, suporte em PT — **recomendado para começar** |
| Contabo Cloud VPS S | ~US$ 5–7/mês | Muito recurso pelo preço; servidor no Brasil disponível |
| DigitalOcean / Vultr | US$ 6/mês | Simples e confiável; pagamento em dólar |
| Oracle Cloud Free Tier | grátis | Passo a passo em [`ORACLE-CLOUD.md`](ORACLE-CLOUD.md) |

> Preços mudam — confira no site. Evite hospedagens "serverless" (Vercel, Netlify): o bot precisa ficar ligado o tempo todo e guardar a sessão do WhatsApp em disco.

## 2. Acessar o servidor

Depois de contratar, o painel mostra o **IP** e a **senha de root**. No seu computador (Windows: PowerShell; Mac/Linux: Terminal):

```bash
ssh root@IP_DO_SERVIDOR
```

## 3. Instalar (um comando)

Já dentro do servidor:

```bash
curl -fsSL https://raw.githubusercontent.com/lucasvieiraeng325/chatbot-photocard/main/deploy/instalar.sh -o instalar.sh
```

```bash
bash instalar.sh
```

O script instala tudo, baixa o repositório e pergunta:
- o **Access Token de produção do Mercado Pago**;
- o **número do WhatsApp do bot** (com 55 + DDD);
- os números que recebem **aviso de venda** (opcional).

> **Repositório privado?** O `curl` acima não funciona; copie o conteúdo de `deploy/instalar.sh` para o servidor (ex.: `nano instalar.sh`, colar, salvar). Na hora do download o git pede **usuário** e **senha**: a senha é um *token* do GitHub (GitHub > Settings > Developer settings > Personal access tokens > Fine-grained, com acesso de leitura a este repositório).

## 4. Conectar o WhatsApp

```bash
pm2 logs photocard-bot
```

Aparece um **código de 8 letras**. No celular do bot: *WhatsApp > Aparelhos conectados > Conectar um aparelho > Conectar com número de telefone* e digite o código. Quando aparecer **"✅ WhatsApp conectado"**, aperte `Ctrl+C` (o bot continua rodando).

> ⚠️ Desconecte qualquer outra instância do bot antes (o mesmo número não pode estar ligado em dois servidores ao mesmo tempo).

## 5. Pronto. Dia a dia

| Para… | Comando (dentro de `~/chatbot-photocard`) |
|---|---|
| ver o que está acontecendo | `pm2 logs photocard-bot` |
| mudar preços/nomes | editar `catalog.json` (`nano catalog.json`) e `pm2 restart photocard-bot` |
| publicar PDFs/mudanças que estão no GitHub | `bash deploy/atualizar.sh` |
| ver pedidos | `cat data/db.json` |
| trocar o token do Mercado Pago | `nano .env` e `pm2 restart photocard-bot` |

O bot volta sozinho se cair ou se o servidor reiniciar.

**Backup:** a pasta `data/` guarda a sessão do WhatsApp e os pedidos. Se mudar de servidor, copie ela junto para não precisar reconectar.

## Opcional: confirmação instantânea (webhook)

Sem nada a mais, o bot confere os Pix a cada 15 segundos. Para confirmação na hora, aponte um domínio para o servidor, coloque HTTPS (ex.: Caddy) com proxy para a porta 3000 e defina `PUBLIC_URL=https://seu-dominio` no `.env`.
