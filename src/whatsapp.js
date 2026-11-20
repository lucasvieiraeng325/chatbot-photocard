import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  jidNormalizedUser,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

function extractText(message) {
  if (!message) return null;
  const m = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  );
}

/**
 * Conecta ao WhatsApp via Baileys (WhatsApp Web). Na primeira execução mostra um QR
 * code no terminal (ou um código de pareamento, se WHATSAPP_PAIRING_NUMBER estiver
 * definido). A sessão fica salva em data/auth.
 */
export async function startWhatsApp({ authDir, pairingNumber, logger, onMessage }) {
  let sock;

  const sender = {
    async sendText(jid, text) {
      await sock.sendMessage(jid, { text });
    },
    async sendImage(jid, image, caption) {
      const img = Buffer.isBuffer(image) ? image : { url: image };
      await sock.sendMessage(jid, { image: img, caption });
    },
    async sendDocument(jid, file) {
      await sock.sendMessage(jid, {
        document: { url: file.absPath },
        mimetype: file.mimetype,
        fileName: file.fileName,
      });
    },
  };

  async function connect() {
    fs.mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    sock = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ module: 'baileys' }, { level: 'warn' }),
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingRequested = false;
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        if (pairingNumber && !state.creds.registered && !pairingRequested) {
          pairingRequested = true;
          const code = await sock.requestPairingCode(pairingNumber);
          console.log(`\n📱 No celular: WhatsApp > Aparelhos conectados > Conectar com número de telefone\n   Código: ${code}\n`);
        } else if (!pairingNumber) {
          console.log('\n📱 Escaneie o QR code abaixo em WhatsApp > Aparelhos conectados > Conectar um aparelho:\n');
          qrcode.generate(qr, { small: true });
        }
      }
      if (connection === 'open') logger.info('✅ WhatsApp conectado');
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          logger.error('Sessão do WhatsApp encerrada (logout). Apague a pasta data/auth e rode de novo para escanear o QR.');
          process.exit(1);
        }
        logger.warn({ code }, 'conexão fechada, reconectando...');
        setTimeout(connect, code === DisconnectReason.restartRequired ? 0 : 3000);
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        const { remoteJid, remoteJidAlt, fromMe } = msg.key;
        if (fromMe || !remoteJid) continue;
        if (isJidGroup(remoteJid) || isJidBroadcast(remoteJid) || isJidNewsletter(remoteJid)) continue;
        const text = extractText(msg.message);
        if (!text) continue;
        // Prefere o JID do número de telefone (estável) ao invés do LID, quando disponível
        const jid = jidNormalizedUser(
          remoteJid.endsWith('@lid') && remoteJidAlt?.endsWith('@s.whatsapp.net') ? remoteJidAlt : remoteJid,
        );
        sock.readMessages([msg.key]).catch(() => {});
        onMessage(jid, text);
      }
    });
  }

  await connect();
  return sender;
}

export const defaultAuthDir = (dataDir) => path.join(dataDir, 'auth');
