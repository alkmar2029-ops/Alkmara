// PM2 ecosystem config — keeps the Next.js production server running
// even after PC reboot, with automatic restart on crash.
//
// Usage on the school PC (Windows):
//   1. Build once:                npm run build
//   2. Install PM2 globally:      npm i -g pm2 pm2-windows-startup
//   3. Register Windows startup:  pm2-startup install
//   4. Start the app:             pm2 start ecosystem.config.js
//   5. Persist across reboots:    pm2 save
//
// Useful PM2 commands:
//   pm2 status            list processes
//   pm2 logs zkt          tail logs
//   pm2 restart zkt       restart after pulling new code
//   pm2 stop zkt          stop
//   pm2 delete zkt        remove from PM2

module.exports = {
  apps: [
    {
      name: 'zkt',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3000',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      // Restart strategy — handle device-pull stalls without a runaway loop.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 3000,
      // Limit log size; old logs roll automatically.
      max_memory_restart: '700M',
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
