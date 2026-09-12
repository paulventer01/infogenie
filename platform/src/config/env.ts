// Central configuration. Values come from the environment (and a managed secret
// store in real deployments) — never hard-coded. Fail fast if a required value
// is missing rather than discovering it at first use.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  /** RLS-enforced application connection (request-path data access). */
  databaseUrl: required("DATABASE_URL"),
  /** Privileged connection for migrations and bootstrap only. */
  adminDatabaseUrl: process.env.ADMIN_DATABASE_URL ?? required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  /** Pepper mixed into one-way hashes (suppression addresses, tokens). */
  hashPepper: process.env.HASH_PEPPER ?? "local-dev-pepper-change-me",
} as const;
