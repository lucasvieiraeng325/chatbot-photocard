#!/usr/bin/env bash
# Instala o chatbot-photocard numa VPS Ubuntu/Debian nova.
#
#   bash instalar.sh
#
# O que faz: instala Node.js 22, git e pm2; baixa o repositório em ~/chatbot-photocard;
# instala as dependências; cria o .env; configura o pm2 para iniciar junto com o servidor.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/lucasvieiraeng325/chatbot-photocard.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-$HOME/chatbot-photocard}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "==> Instalando pacotes do sistema (git, curl)"
$SUDO apt-get update -y
$SUDO apt-get install -y git curl ca-certificates

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Instalando Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
echo "    Node $(node -v)"

if ! command -v pm2 >/dev/null; then
  echo "==> Instalando pm2"
  $SUDO npm install -g pm2
fi

if [ -d "$DIR/.git" ]; then
  echo "==> Atualizando $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "==> Baixando o repositório em $DIR (pode levar alguns minutos, são ~900 MB de PDFs)"
  echo "    Se o repositório for privado, o git vai pedir usuário e um token do GitHub como senha."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$DIR"
fi

cd "$DIR"
echo "==> Instalando dependências"
npm ci --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  echo
  echo "==> Configuração (.env)"
  read -rp "Access Token de PRODUÇÃO do Mercado Pago (APP_USR-...): " MP
  read -rp "Números que recebem aviso de venda (separados por vírgula, pode deixar vazio): " ADM
  sed -i "s|^MP_ACCESS_TOKEN=.*|MP_ACCESS_TOKEN=${MP}|" .env
  sed -i "s|^ADMIN_NUMBERS=.*|ADMIN_NUMBERS=${ADM}|" .env
  chmod 600 .env
fi

echo "==> Iniciando o bot com pm2"
pm2 startOrReload ecosystem.config.cjs
pm2 save
$SUDO env PATH="$PATH" pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null
pm2 install pm2-logrotate >/dev/null 2>&1 || true

cat <<MSG

✅ Instalado! Agora conecte o WhatsApp:

   pm2 logs photocard-bot --raw --lines 0

Vai aparecer um QR CODE. No celular do bot: WhatsApp > Aparelhos conectados >
Conectar um aparelho, e escaneie (o QR muda a cada ~20 s; use o mais recente).
Se o QR não aparecer direito, ele também fica salvo em ~/chatbot-photocard/data/qr.png.
Quando aparecer "✅ WhatsApp conectado", aperte Ctrl+C (o bot continua rodando).

Comandos úteis:
   pm2 logs photocard-bot      # ver o que está acontecendo
   pm2 restart photocard-bot   # reiniciar (ex.: depois de mudar o catalog.json ou o .env)
   bash deploy/atualizar.sh    # baixar novidades do GitHub e reiniciar
MSG
