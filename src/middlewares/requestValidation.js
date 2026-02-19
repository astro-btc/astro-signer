/**
 * Request validation middleware
 * Validates request format and size
 */
function requestValidation(req, res, next) {
    // Check Content-Type for POST/PUT requests
    if (['POST', 'PUT'].includes(req.method)) {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
            return res.status(415).json({
                code: 415,
                message: 'Unsupported Media Type - application/json required'
            });
        }
    }

    // Check request body size
    const contentLength = parseInt(req.headers['content-length'] || 0);
    if (contentLength > 1024 * 1024) { // 1MB limit
        return res.status(413).json({
            code: 413,
            message: 'Request Entity Too Large'
        });
    }

    // Validate JSON structure
    if (req.body && Object.keys(req.body).length > 0) {
        try {
            JSON.stringify(req.body);
        } catch (e) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid JSON format'
            });
        }
    }

    next();
}

module.exports = requestValidation;
