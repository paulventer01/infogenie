// services/security/validate.js — Zod request-body validation helper.
//
// Scaffold: wrap route handlers with `validateBody(schema)` so new endpoints
// get typed, fail-closed input checks. Existing routes migrate incrementally.
'use strict';

let _zod;
function zod() {
  if (!_zod) _zod = require('zod');
  return _zod;
}

/**
 * @param {import('zod').ZodTypeAny} schema
 * @param {{ source?: 'body'|'query'|'params' }} [opts]
 */
function validate(schema, opts = {}) {
  const source = opts.source || 'body';
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join('.') || source,
        message: i.message,
      }));
      return res.status(400).json({
        ok: false,
        error: 'validation_failed',
        issues,
      });
    }
    req[source] = parsed.data;
    return next();
  };
}

/** Convenience schemas used by auth scaffolding. */
function authSchemas() {
  const { z } = zod();
  return {
    login: z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }),
    signup: z.object({
      email: z.string().email(),
      password: z.string().min(1),
      name: z.string().max(200).optional().default(''),
      next: z.string().optional(),
    }),
    requestReset: z.object({
      email: z.string().email(),
    }),
  };
}

module.exports = { validate, authSchemas, zod };
