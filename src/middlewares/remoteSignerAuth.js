const crypto = require('crypto');

const NONCE_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_SKEW_SECONDS = 60;
const NONCE_TTL_SECONDS = 120;
const NONCE_MAX_ENTRIES = 10000;

function logAuth(event, req, extra) {
    // Structured log for forensics; do NOT log secret or full signature
    try {
        const ip = req.ip;
        const rid = req.requestId;
        const path = req.originalUrl;
        console.log(JSON.stringify({
            event,
            requestId: rid,
            ip,
            method: req.method,
            path,
            ...extra,
        }));
    } catch {
        // ignore
    }
}

function getHeader(req, name) {
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
}

function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function hmacSha256Hex(secret, message) {
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqualHex(aHex, bHex) {
    try {
        const a = Buffer.from(aHex, 'hex');
        const b = Buffer.from(bHex, 'hex');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

function parseSignature(sig) {
    if (!sig || typeof sig !== 'string') return '';
    // accept "v1=<hex>" or "<hex>"
    const trimmed = sig.trim();
    const idx = trimmed.indexOf('=');
    if (idx !== -1) return trimmed.slice(idx + 1).trim();
    return trimmed;
}

// In-memory nonce store (best-effort). For multi-instance deployments, replace with Redis.
const usedNonces = new Map(); // nonce -> expiresAtMs
let seen = 0;

function cleanupExpired(nowMs) {
    for (const [nonce, exp] of usedNonces.entries()) {
        if (exp <= nowMs) usedNonces.delete(nonce);
    }
}

/**
 * Remote signer authentication middleware.
 *
 * Requires HMAC signature + nonce + timestamp:
 * - X-Remote-Signer-Timestamp: unix seconds
 * - X-Remote-Signer-Nonce: 16-128 chars base64url-like
 * - X-Remote-Signer-Signature: hex or "v1=<hex>"
 *
 * Signature string (v1):
 * v1\n{timestamp}\n{nonce}\n{method}\n{path}\n{bodySha256Hex}
 *
 * Env:
 * - REMOTE_SIGNER_SECRET (required)
 */
function remoteSignerAuth(req, res, next) {
    const secret = process.env.REMOTE_SIGNER_SECRET;
    if (!secret) {
        return res.status(500).json({ code: 500, message: 'Server misconfigured: REMOTE_SIGNER_SECRET missing' });
    }

    const tsRaw = getHeader(req, 'x-remote-signer-timestamp');
    const nonce = getHeader(req, 'x-remote-signer-nonce');
    const sigRaw = getHeader(req, 'x-remote-signer-signature');

    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || !Number.isInteger(ts) || ts <= 0) {
        logAuth('remote_signer_auth_denied', req, { reason: 'bad_timestamp' });
        return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }
    if (!nonce || typeof nonce !== 'string' || !NONCE_REGEX.test(nonce)) {
        logAuth('remote_signer_auth_denied', req, { reason: 'bad_nonce' });
        return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > MAX_SKEW_SECONDS) {
        logAuth('remote_signer_auth_denied', req, { reason: 'timestamp_skew', ts, nowSec });
        return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const sig = parseSignature(sigRaw);
    if (!sig) {
        logAuth('remote_signer_auth_denied', req, { reason: 'missing_signature' });
        return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const bodyBuf = req.rawBody && Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from('');
    const bodyHash = sha256Hex(bodyBuf);
    const canonical = `v1\n${ts}\n${nonce}\n${req.method.toUpperCase()}\n${req.originalUrl}\n${bodyHash}`;
    const expected = hmacSha256Hex(secret, canonical);

    if (!safeEqualHex(sig, expected)) {
        logAuth('remote_signer_auth_denied', req, {
            reason: 'bad_signature',
            ts,
            nonce,
            bodySha256: bodyHash,
            sigLen: String(sig).length,
            sigPrefix: String(sig).slice(0, 12),
        });
        return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    // Replay protection (store nonce only after auth succeeds, to reduce nonce-poisoning DoS)
    const nowMs = Date.now();
    const expiresAt = nowMs + NONCE_TTL_SECONDS * 1000;
    const existingExp = usedNonces.get(nonce);
    if (existingExp && existingExp > nowMs) {
        logAuth('remote_signer_auth_denied', req, { reason: 'replay', ts, nonce, bodySha256: bodyHash });
        return res.status(409).json({ code: 409, message: 'Replay detected' });
    }
    usedNonces.set(nonce, expiresAt);

    // Best-effort cleanup / memory cap
    seen += 1;
    if (seen % 200 === 0) cleanupExpired(nowMs);
    while (usedNonces.size > NONCE_MAX_ENTRIES) {
        const oldest = usedNonces.keys().next().value;
        if (!oldest) break;
        usedNonces.delete(oldest);
    }

    // Attach for downstream logging/correlation
    req.remoteSigner = { ts, nonce, bodySha256: bodyHash };
    logAuth('remote_signer_auth_ok', req, { ts, nonce, bodySha256: bodyHash });
    return next();
}

module.exports = remoteSignerAuth;

