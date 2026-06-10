import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const logFile = process.env.LOG_FILE || 'logs/railflow.log';

const transport = isProduction
  ? { target: 'pino/file', options: { destination: logFile, mkdir: true } }
  : { target: 'pino/file', options: { destination: 1 } };

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
  redact: {
    paths: ['password', 'mfaToken', 'secret', 'cvv', 'aadhaar', 'cardNumber'],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      ip: req.ip,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
});

export default logger;
