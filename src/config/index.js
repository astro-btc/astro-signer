module.exports = {
    app: {
        adminPrefix: ''
    },
    rateLimits: {
        api: {
            windowMs: 60 * 1000, // 1 minute
            max: 120
        },
        strict: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 30
        }
    },
    security: {
        helmet: {
            // API 不需要 CSP（CSP 主要用于 HTML 页面）
            contentSecurityPolicy: false,

            // 禁止被 iframe 嵌入（API 服务通常不需要被嵌入）
            frameguard: { action: 'deny' },

            // 避免开启跨源隔离相关策略导致意外兼容性问题（对 API 也没必要）
            crossOriginEmbedderPolicy: false,
            crossOriginOpenerPolicy: false,

            // Remote signer 可能被不同域/不同项目调用，这里保持宽松
            crossOriginResourcePolicy: { policy: 'cross-origin' },

            // HTTP 自部署：不发送 HSTS（HSTS 仅对 HTTPS 有意义，避免造成误解）
            hsts: false,

            // 更严格的隐私默认值（API 一般不需要 referrer）
            referrerPolicy: {
                policy: "no-referrer"
            }
        }
    }
};
