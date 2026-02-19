const net = require('net');

function normalizeIp(ip) {
    if (!ip || typeof ip !== 'string') return '';
    // Express may return "::ffff:127.0.0.1" for IPv4-mapped IPv6
    if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
    // Localhost in IPv6
    if (ip === '::1') return '127.0.0.1';
    return ip;
}

function parseAllowlist(raw) {
    if (!raw) return [];
    return raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * Optional IPv4 allowlist middleware.
 *
 * Env:
 * - IPV4_WHITE_LIST="1.2.3.4,5.6.7.8"  (empty => disabled)
 */
function ipv4Allowlist(req, res, next) {
    const allow = parseAllowlist(process.env.IPV4_WHITE_LIST);
    if (allow.length === 0) return next();

    const ip = normalizeIp(req.ip);
    if (!net.isIPv4(ip)) {
        try {
            console.log(JSON.stringify({ event: 'ipv4_allowlist_denied', requestId: req.requestId, ip: req.ip, normalizedIp: ip, reason: 'not_ipv4', path: req.originalUrl }));
        } catch { }
        return res.status(403).json({ code: 403, message: 'Forbidden' });
    }

    if (!allow.includes(ip)) {
        try {
            console.log(JSON.stringify({ event: 'ipv4_allowlist_denied', requestId: req.requestId, ip: req.ip, normalizedIp: ip, reason: 'not_in_allowlist', path: req.originalUrl }));
        } catch { }
        return res.status(403).json({ code: 403, message: 'Forbidden' });
    }

    return next();
}

module.exports = ipv4Allowlist;

