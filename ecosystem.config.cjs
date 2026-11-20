// Configuração do pm2 (mantém o bot ligado e reinicia sozinho se cair ou se o servidor reiniciar)
//   pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'photocard-bot',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1, // NUNCA mais de 1: a sessão do WhatsApp não pode ser usada por dois processos
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      max_memory_restart: '700M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
