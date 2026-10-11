module.exports = {
  apps: [
    {
      name: 'cc',
      script: 'server.js',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '5600M',
      kill_timeout: 20000,
      listen_timeout: 20000,
      min_uptime: 30000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        CONCURRENCY: '1',
        ADMIN_PASS: 'Septi126789',
      },
      node_args: '--max-old-space-size=1024',
    },
  ],
};