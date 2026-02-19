require('./utils/logger-setup')
const createError = require('http-errors');
const express = require('express');
const crypto = require('crypto');
const compression = require('compression');
const morgan = require('morgan');
const helmet = require('helmet');
const config = require("./config");
const xssProtection = require('./middlewares/xssProtection');
const requestValidation = require('./middlewares/requestValidation');
const app = express();

// Hide framework fingerprint
app.disable('x-powered-by');

// Optional: trust reverse proxy (enables correct req.ip / X-Forwarded-For handling)
// Set TRUST_PROXY=1 when running behind Nginx/Cloudflare/etc.
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

// Add compression middleware before other middlewares
app.use(compression({
    // 只压缩大于 1kb 的响应
    threshold: 1024,
    // 压缩级别 0-9，越高压缩率越大，但也越耗 CPU
    level: 6
}));

// Basic parsing middleware (should be early to parse incoming requests)
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
        // Keep raw request body for signature verification (HMAC)
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({
    extended: false,
    limit: '1mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// Request ID for forensics / correlation across logs
app.use((req, res, next) => {
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
});

// Security middleware (should be as early as possible)
app.use(helmet(config.security.helmet));

// Request validation (should be before routes but after parsing)
app.use(requestValidation);

// XSS Protection (should be before routes)
app.use(xssProtection);

// Non-security middleware
// IMPORTANT: route request logs into winston (via console.log override)
// so they appear in logs/summary/all-*.log (not just stdout/journalctl).
app.use(morgan(':remote-addr :method :url :status :res[content-length] - :response-time ms', {
    stream: {
        write: (msg) => console.log(msg.trim()),
    },
}));
// app.use(cookieParser()); // 不再需要cookie解析

// Import routes
const signRouter = require('./routes/sign');
const statusRouter = require('./routes/status');

// API routes
app.use('/sign', signRouter);
app.use('/status', statusRouter);

// Error Handling (should be last)
app.use((req, res, next) => {
    next(createError(404));
});

app.use((err, req, res, next) => {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    const status = err.status || 500;
    if (status !== 404) {
        console.error(`Unhandled error: status=${status} path=${req.originalUrl} message=${err?.message || 'unknown'}`);
    }
    res.status(status).json({
        code: status,
        message: status === 404 ? 'Not Found' : 'Internal Server Error'
    });
});

process.on('uncaughtException', (err) => {
    console.error('catch uncaughtException')
    if (err instanceof Error) {
        console.error("app.js => Uncaught Exception:", err.message);
        console.error("app.js => Stack Trace:\n", err.stack);
    } else {
        console.error("app.js => Uncaught Exception (non-Error object):", err);
    }
    process.exit(1); // 退出以便 PM2 重启
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('catch unhandledRejection')
    console.error("app.js => Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1); // 退出以便 PM2 重启
});

// Check required environment variables
const requiredEnvVars = ['PORT', 'MNEMONIC', 'REMOTE_SIGNER_SECRET'];
requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
        throw new Error(`Environment variable ${envVar} is required but not set.`);
    }
});

module.exports = app;
