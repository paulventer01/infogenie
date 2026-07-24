import express, { type NextFunction, type Request, type Response } from "express";
import { appPool } from "./db/pool.js";
import { verifyPassword } from "./lib/hash.js";
import { createSession, resolveSession } from "./modules/identity/service.js";
import { resolveTenantAccess, roleHasPermission } from "./modules/identity/rbac.js";
import { withTenant } from "./db/tenantContext.js";
import { isReachable, type Channel } from "./modules/consent/service.js";
import { appendWith } from "./modules/audit/service.js";

// Request augmented with the resolved principal and tenant context.
interface Ctx {
  userId: string;
  tenantId: string;
  roleKey: string;
}
type CtxRequest = Request & { ctx?: Partial<Ctx> };

/** Authenticate the bearer token into req.ctx.userId. */
async function authenticate(req: CtxRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = token ? await resolveSession(token) : null;
  if (!session) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  req.ctx = { userId: session.userId };
  next();
}

/**
 * Establish the tenant context for the request. The tenant is named in the
 * X-Tenant-Id header; access is resolved through membership, agency-parent, or
 * a JIT grant. This is where an agency operator "enters" a client context — and
 * where a request with no permitted access is refused before any query runs.
 */
function withTenantContext(req: CtxRequest, res: Response, next: NextFunction) {
  const tenantId = req.header("x-tenant-id") ?? "";
  if (!tenantId) {
    res.status(400).json({ error: "X-Tenant-Id header required" });
    return;
  }
  resolveTenantAccess(req.ctx!.userId!, tenantId)
    .then((access) => {
      if (!access.allowed) {
        res.status(403).json({ error: "no access to this tenant" });
        return;
      }
      req.ctx!.tenantId = tenantId;
      req.ctx!.roleKey = access.roleKey;
      next();
    })
    .catch(next);
}

/** Require a permission on the resolved role. */
function requirePermission(permission: string) {
  return (req: CtxRequest, res: Response, next: NextFunction) => {
    roleHasPermission(req.ctx!.roleKey!, permission)
      .then((ok) => {
        if (!ok) {
          res.status(403).json({ error: `missing permission: ${permission}` });
          return;
        }
        next();
      })
      .catch(next);
  };
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true, phase: 0 }));

  app.post("/auth/login", (req, res, next) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "email and password required" });
      return;
    }
    appPool
      .query("select id, password_hash from users where email = $1 and disabled_at is null", [email])
      .then(async ({ rows }) => {
        const user = rows[0];
        if (!user?.password_hash || !verifyPassword(password, user.password_hash)) {
          res.status(401).json({ error: "invalid credentials" });
          return;
        }
        const token = await createSession(user.id);
        res.json({ token });
      })
      .catch(next);
  });

  // Example governed, tenant-scoped route: chained auth → tenant context →
  // permission, then all data access runs inside withTenant (RLS-isolated),
  // and the consequential read is written to the audit rail.
  app.get(
    "/api/persons/:id/reachability",
    authenticate as express.RequestHandler,
    withTenantContext as express.RequestHandler,
    requirePermission("consent:read") as express.RequestHandler,
    ((req: CtxRequest, res: Response, next: NextFunction) => {
      const { id } = req.params;
      const channel = (req.query.channel as Channel) ?? "email";
      const purpose = (req.query.purpose as string) ?? "marketing";
      withTenant(req.ctx!.tenantId!, async (client) => {
        const result = await isReachable(client, { personId: id!, channel, purpose });
        await appendWith(client, {
          actorType: "user",
          actorId: req.ctx!.userId,
          action: "consent.reachability_check",
          resourceType: "person",
          resourceId: id,
          evidence: { channel, purpose, reachable: result.reachable, reason: result.reason },
          outcome: result.reachable ? "reachable" : "not_reachable",
        });
        return result;
      })
        .then((result) => res.json(result))
        .catch(next);
    }) as express.RequestHandler,
  );

  // Fail-closed error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
