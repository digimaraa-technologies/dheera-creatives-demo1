import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  // Matches the raw (non percent-encoded) password form used in the local .env.
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\/\S+$/)
    .required()
    .messages({
      'string.pattern.base':
        'DATABASE_URL must be a postgresql:// connection string',
    }),
  SESSION_TTL_HOURS: Joi.number().integer().min(1).max(720).default(8),
  // Inactivity timeout. Shorter than the absolute session lifetime.
  SESSION_IDLE_TTL_MINUTES: Joi.number().integer().min(1).max(720).default(30),
  // Comma-separated list of browser origins allowed to call the API with cookies.
  ADMIN_FRONTEND_ORIGIN: Joi.string().default('http://localhost:5173'),
  UPLOAD_DIR: Joi.string().default('uploads'),
  // Network interface to listen on. The default exposes the app on every
  // interface, which is only safe in development; production sets this
  // explicitly (127.0.0.1 behind a local reverse proxy).
  BIND_HOST: Joi.string()
    .pattern(/^[A-Za-z0-9.:-]+$/)
    .default('0.0.0.0')
    .messages({
      'string.pattern.base':
        'BIND_HOST must be an IP address or hostname (letters, digits, dots, colons, dashes)',
    }),
  // Number of reverse-proxy hops Express should trust, or false when the app is
  // reached directly. Wrong values make the login limiter see the proxy's IP.
  TRUST_PROXY: Joi.alternatives()
    .try(Joi.number().integer().min(0).max(10), Joi.boolean())
    .default(0),
});

/**
 * Validates the environment and refuses to start in production when a setting
 * whose default is only safe for development was left at that default. The
 * defaults stay in place for development and tests.
 */
export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const { error, value } = envValidationSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (error) {
    throw new Error(`Invalid environment configuration: ${error.message}`);
  }

  if (value.NODE_ENV === 'production') {
    // Defaulting to 0 would silently rate-limit every admin as the proxy IP.
    if (config.TRUST_PROXY === undefined || config.TRUST_PROXY === '') {
      throw new Error(
        'TRUST_PROXY must be set explicitly in production (0 when not behind a proxy, or the number of proxy hops).',
      );
    }

    // Trusting every proxy lets a client forge X-Forwarded-For and dodge the
    // login limiter, so production requires an explicit hop count.
    if (value.TRUST_PROXY === true) {
      throw new Error(
        'TRUST_PROXY must be a hop count (0-10) in production, not true.',
      );
    }

    // The development default listens on every interface; production must say
    // which one, so the app is not accidentally exposed next to nginx.
    if (config.BIND_HOST === undefined || config.BIND_HOST === '') {
      throw new Error(
        'BIND_HOST must be set explicitly in production (127.0.0.1 behind a local reverse proxy, or the private interface address).',
      );
    }

    const origins = String(value.ADMIN_FRONTEND_ORIGIN)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (origins.length === 0 || origins.some((origin) => !origin.startsWith('https://'))) {
      throw new Error(
        'ADMIN_FRONTEND_ORIGIN must list https:// origins in production.',
      );
    }
  }

  return value;
}
