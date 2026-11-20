#!/usr/bin/env bash
# Baixa as novidades do GitHub (novos PDFs, preços, código) e reinicia o bot.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci --omit=dev
pm2 restart photocard-bot
echo "✅ Atualizado e reiniciado."
