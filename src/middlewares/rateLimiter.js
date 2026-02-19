const rateLimit = require('express-rate-limit');
const config = require('../config');

// 通用的限频器创建函数
const createRateLimiter = (options = {}) => {
    const defaultOptions = {
        windowMs: 5 * 60 * 1000, // 默认5分钟窗口
        max: 100, // 默认100次请求
        message: 'Too many requests, please try again later.',
        standardHeaders: 'draft-6', // 使用标准的速率限制头
        legacyHeaders: false, // 禁用旧版头
        skipFailedRequests: false, // 失败的请求也计数
        skipSuccessfulRequests: false // 成功的请求也计数
    };

    return rateLimit({
        ...defaultOptions,
        ...options,
        handler: (req, res) => {
            try {
                console.log(JSON.stringify({
                    event: 'rate_limited',
                    requestId: req.requestId,
                    ip: req.ip,
                    method: req.method,
                    path: req.originalUrl,
                }));
            } catch { }
            res.status(429).json(
                {
                    code: -1,
                    message: 'Too many requests, please try again later.',
                }
            );
        }
    });
};

// 预定义的限频器
const limiters = {
    // API通用限频器
    api: createRateLimiter(config.rateLimits.api),

    // 严格限频器
    strict: createRateLimiter(config.rateLimits.strict)
};

module.exports = {
    limiters
};
