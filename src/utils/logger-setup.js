const winston = require("winston");
require("winston-daily-rotate-file");

// 自定义日志级别
const logLevels = {
    error: 0,
    // warn: 1,
    info: 2,
    debug: 3,
    // trace: 4
};

winston.addColors({
    error: "red",
    // warn: "yellow",
    info: "green",
    debug: "blue",
    // trace: 'grey',
})

// 创建不同级别的日志存储器
const createLogger = (level) => {
    return winston.createLogger({
        levels: logLevels,
        level,
        transports: [
            new winston.transports.DailyRotateFile({
                filename: `${level}-%DATE%.log`, // 日志文件命名
                datePattern: "YYYY-MM-DD",       // 日期格式
                dirname: `logs/${level}`,        // 存储目录
                maxSize: "100m",                  // 单个日志文件大小限制
                maxFiles: "3d",                 // 保留 3 天日志
                zippedArchive: false,             // 过期日志不压缩
                format: winston.format.combine(
                    winston.format.timestamp({
                        format: 'YYYY-MM-DD HH:mm:ss:SSS' // 自定义时间格式 (年-月-日 时:分:秒:毫秒)
                    }),
                    winston.format.printf(({ timestamp, level, message }) => {
                        return `${timestamp} ${level}: ${message}`;
                    })
                ),
            }),
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.timestamp({
                        format: 'YYYY-MM-DD HH:mm:ss:SSS' // 同样的时间格式
                    }),
                    winston.format.simple()
                ),
            }),
            // 汇总所有级别的日志到一个文件
            new winston.transports.DailyRotateFile({
                filename: 'all-%DATE%.log', // 汇总日志文件命名
                datePattern: "YYYY-MM-DD",  // 日期格式
                dirname: 'logs/summary',    // 汇总目录
                maxSize: "100m",            // 单个日志文件大小限制
                maxFiles: "3d",            // 保留 3 天日志
                zippedArchive: false,        // 过期日志压缩
                format: winston.format.combine(
                    winston.format.timestamp({
                        format: 'YYYY-MM-DD HH:mm:ss:SSS' // 时间格式
                    }),
                    winston.format.printf(({ timestamp, level, message }) => {
                        return `${timestamp} ${level}: ${message}`;
                    })
                ),
            }),
        ],
    });
};

// 创建日志记录器实例
const errorLogger = createLogger("error");
// const warnLogger = createLogger("warn");
const infoLogger = createLogger("info");
const debugLogger = createLogger("debug");
// const traceLogger = createLogger("trace");
console.error = (...args) => { const msg = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg))).join(" "); errorLogger.log('error', msg) };
// console.warn = (...args) => { const msg = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg))).join(" "); warnLogger.log('warn', msg) };
console.log = (...args) => { const msg = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg))).join(" "); infoLogger.log('info', msg) };
console.debug = (...args) => { const msg = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg))).join(" "); debugLogger.log('debug', msg) };
// console.log = (msg) => traceLogger.log('trace', msg);

// errorLogger.error("This is an error message.");
// warnLogger.warn("This is a warning message.");
// infoLogger.info("This is an info message.");
// debugLogger.debug("This is a debug message.");
// traceLogger.trace("This is a trace message.");

// console.error("This is an error message.");
// console.info("This is a warning message.");
// console.info("This is an info message.");
// console.debug("This is a debug message.");
// console.log("This is a trace message.");

const shutdownLoggingAndExit = (exitCode = 0) => {
    errorLogger.close()
    infoLogger.close()
    debugLogger.close()
    setTimeout(() => {
        process.exit(exitCode);
    }, 500)
}

module.exports = {
    shutdownLoggingAndExit
}
