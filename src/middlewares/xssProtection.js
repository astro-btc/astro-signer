const xss = require('xss');

/**
 * Middleware to protect against XSS attacks
 * Sanitizes request body, query and params
 */
function xssProtection(req, res, next) {
    // Signing payloads must not be mutated (even "sanitization" can change bytes/strings)
    // Skip XSS sanitization for /sign.
    const url = typeof req.originalUrl === 'string' ? req.originalUrl : '';
    if (url === '/sign' || url.startsWith('/sign/')) return next();

    if (req.body) {
        req.body = sanitizeData(req.body);
    }

    if (req.query) {
        req.query = sanitizeData(req.query);
    }

    if (req.params) {
        req.params = sanitizeData(req.params);
    }

    next();
}

/**
 * Recursively sanitize data
 */
function sanitizeData(data) {
    if (!data) return data;

    if (typeof data === 'string') {
        return xss(data, {
            whiteList: {},          // 禁止所有 HTML 标签
            stripIgnoreTag: true,   // 去除不在白名单中的标签
            stripIgnoreTagBody: ['script', 'style'], // 去除这些标签及其内容
        });
    }

    if (Array.isArray(data)) {
        return data.map(item => sanitizeData(item));
    }

    if (typeof data === 'object') {
        const sanitized = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                sanitized[key] = sanitizeData(data[key]);
            }
        }
        return sanitized;
    }

    return data;
}

module.exports = xssProtection;
