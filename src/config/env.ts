import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  TRUST_PROXY: booleanFlag.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: csv.default([]),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  ARGON2_MEMORY_COST_KIB: z.coerce.number().int().min(1024).default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  server: { host: string; port: number; trustProxy: boolean };
  logLevel: Env['LOG_LEVEL'];
  http: { corsOrigins: string[] };
  databaseUrl: string;
  auth: AuthConfig;
}

export interface AuthConfig {
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  rateLimit: { max: number; windowSeconds: number };
  argon2: { memoryCost: number; timeCost: number };
}

/**
 * Parses and validates environment variables. Fails fast with a readable
 * message so a misconfigured deployment never starts half-working.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    server: { host: env.HOST, port: env.PORT, trustProxy: env.TRUST_PROXY },
    logLevel: env.LOG_LEVEL,
    http: { corsOrigins: env.CORS_ORIGINS },
    databaseUrl: env.DATABASE_URL,
    auth: {
      accessTokenSecret: env.JWT_ACCESS_SECRET,
      accessTokenTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
      rateLimit: {
        max: env.AUTH_RATE_LIMIT_MAX,
        windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
      },
      argon2: { memoryCost: env.ARGON2_MEMORY_COST_KIB, timeCost: env.ARGON2_TIME_COST },
    },
  };
}
