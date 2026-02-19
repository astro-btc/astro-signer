module.exports = {
  apps: [
    {
      name: 'astro-signer', // 应用名称
      script: './bin/www', // 启动文件地址
      cwd: './', // 当前工作路径
      stop_exit_codes: [0],
      node_args: '--harmony', // node的启动模式
      env: {
        NODE_ENV: 'production', // 设置运行环境，此时process.env.NODE_ENV的值就是development
      },
      // out_file: './out.log', // 普通日志路径
      // error_file: './err.log', // 错误日志路径
      out_file: null, // 普通日志路径
      error_file: null, // 错误日志路径
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      max_memory_restart: '300M',        // 内存超过512M时自动重启
      autorestart: true,
      max_restarts: 3,      // 最多重启 3 次
      restart_delay: 3000,   // 重启延迟 3 秒（3000毫秒）
      min_uptime: 15000,      // 应用必须至少运行 15 秒才视为正常启动
      cron_restart: '39 4 * * *', // 每天凌晨4点39分重启
    },
  ],
};
