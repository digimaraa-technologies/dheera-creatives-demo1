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
  // Comma-separated list of browser origins allowed to call the API with cookies.
  ADMIN_FRONTEND_ORIGIN: Joi.string().default('http://localhost:5173'),
  UPLOAD_DIR: Joi.string().default('uploads'),
});
