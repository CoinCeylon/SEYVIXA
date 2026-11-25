// T1.1b and T2.1, Blueprint 6.1 and 7: the API app, owner login and POST /api/agents/:id/grants. More routes
// arrive with their own cards. The owner comes only from the server-side session (getSessionOwnerId).
// Nothing in the request can name the owner, and an agent credential is never accepted here.
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { idSchema, positiveLkrAmountSchema, timestampSchema } from "@seyvixa/shared";
import type { Queryable } from "./agent-auth.ts";
import { API_GRANT_ISSUER, checkScopesForNewGrant, createGrant } from "./grants.ts";
import {
  DEMO_OWNER_ID,
  LoginLimiter,
  SESSION_TTL_MS,
  SessionStore,
  loginMatches,
  readSessionCookie,
  sessionCookieHeader,
  type OwnerLogin,
} from "./session.ts";

// Returns the session's owner id, or null when there is no valid session (T2.1, decisions D19 and D35).
export type GetSessionOwnerId = (request: FastifyRequest) => Promise<string | null>;

// Decision D33: never log the authorization or cookie headers.
export const LOG_REDACT_PATHS = ["req.headers.authorization", "req.headers.cookie"];

// Strict: owner_id, agent_id, issuer, integrity_tag or any other key in the body is rejected.
const createGrantBody = z.strictObject({
  scopes: z.array(z.string()),
  spend_limit: positiveLkrAmountSchema,
  expires_at: timestampSchema,
});
const paramsSchema = z.strictObject({ id: idSchema });
// Login body: strict, so no owner_id (or anything else) can ride along.
const loginBody = z.strictObject({ login: z.string().min(1).max(256), password: z.string().min(1).max(256) });

export type AppOptions = {
  db: Queryable;
  // The seeded demo owner login (ownerLoginFromEnv). A login with these values maps to ownerId.
  ownerLogin: OwnerLogin;
  // The seeded owner's user id. Defaults to DEMO_OWNER_ID.
  ownerId?: string;
  // Set the Secure flag on the session cookie. Defaults to true when NODE_ENV is "production".
  secureCookie?: boolean;
  integrityKey: string;
  logger?: false | { stream?: NodeJS.WritableStream; level?: string };
  now?: () => Date;
};

export function buildApp(options: AppOptions): FastifyInstance {
  const { db, integrityKey, ownerLogin } = options;
  const demoOwnerId = options.ownerId ?? DEMO_OWNER_ID;
  const secureCookie = options.secureCookie ?? process.env.NODE_ENV === "production";
  const now = options.now ?? (() => new Date());
  const sessions = new SessionStore(now);
  const limiter = new LoginLimiter(now);

  // The one source of owner identity. Reads only the session cookie and fails closed.
  const getSessionOwnerId: GetSessionOwnerId = async (request) => {
    try {
      return sessions.ownerFor(readSessionCookie(request.headers));
    } catch {
      return null;
    }
  };
  const logger =
    options.logger === false
      ? false
      : { level: "info", ...options.logger, redact: { paths: LOG_REDACT_PATHS, censor: "[Redacted]" } };
  // Fastify's default request log has no headers. Add them, so the redact paths above are doing real work
  // (and a test can fail if they are removed). authorization and cookie are replaced by "[Redacted]".
  const app = Fastify({
    logger:
      logger === false
        ? false
        : {
            ...logger,
            serializers: {
              req: (request: FastifyRequest) => ({
                method: request.method,
                url: request.url,
                headers: request.headers,
              }),
            },
          },
  });

  // Generic errors only: no stack, no database text, nothing from the request.
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "BAD_REQUEST" });
    }
    request.log.error({ err: { type: (error as Error).name } }, "request failed");
    return reply.code(500).send({ error: "INTERNAL_ERROR" });
  });

  // Owner login (T2.1). Not a product endpoint (Blueprint 7: login is not counted as a product API).
  // One generic 401 for every failure. Nothing from the request is logged.
  app.post("/api/auth/login", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const retryAfter = limiter.retryAfterSeconds();
    if (retryAfter > 0) {
      reply.header("Retry-After", String(retryAfter));
      return reply.code(429).send({ error: "TOO_MANY_ATTEMPTS" });
    }
    const body = loginBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    // Count the attempt as a failure now, before any await, so parallel requests cannot all pass the lock
    // check above before one failure is counted. A success clears the count below.
    limiter.recordFailure();
    const owner = await db.query("SELECT id FROM users WHERE id = $1", [demoOwnerId]);
    const ownerExists = owner.rows.length === 1;
    if (!loginMatches(ownerLogin, body.data) || !ownerExists) {
      request.log.warn({ event: "owner_login_failed" }, "owner login failed");
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
    }
    limiter.recordSuccess();
    const sessionId = sessions.create(demoOwnerId);
    reply.header(
      "Set-Cookie",
      sessionCookieHeader(sessionId, { secure: secureCookie, maxAgeSeconds: SESSION_TTL_MS / 1000 }),
    );
    request.log.info({ event: "owner_login", owner_id: demoOwnerId }, "owner logged in");
    return reply.code(200).send({ authenticated: true });
  });

  app.post("/api/agents/:id/grants", async (request, reply) => {
    // 1. Authenticate: owner session only. No session, no further work.
    let ownerId: string | null;
    try {
      ownerId = await getSessionOwnerId(request);
    } catch {
      ownerId = null;
    }
    if (typeof ownerId !== "string" || ownerId === "") {
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
    }

    // 2. Validate the request. The owner is never read from the body, query or URL.
    const params = paramsSchema.safeParse(request.params);
    const body = createGrantBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const problems = checkScopesForNewGrant(body.data.scopes);
    const expiresAt = new Date(body.data.expires_at);
    if (problems.length > 0) return reply.code(400).send({ error: "INVALID_SCOPES", problems });
    if (!(expiresAt.getTime() > now().getTime())) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }

    // 3. The session owner and the agent must exist.
    const owner = await db.query("SELECT id FROM users WHERE id = $1", [ownerId]);
    if (owner.rows.length !== 1) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const agent = await db.query("SELECT id FROM agents WHERE id = $1", [params.data.id]);
    if (agent.rows.length !== 1) return reply.code(404).send({ error: "NOT_FOUND" });

    // 4. Create the grant. The issuer is set here, the tag is computed here.
    const grant = await createGrant(
      db,
      {
        ownerId,
        agentId: params.data.id,
        scopes: body.data.scopes,
        spendLimit: body.data.spend_limit,
        expiresAt,
        issuer: API_GRANT_ISSUER,
      },
      integrityKey,
    );
    // Audit line (a policy_events row does not fit this event: reason_code is NOT NULL). No secrets in it.
    request.log.info(
      { event: "grant_created", grant_id: grant.id, agent_id: grant.agent_id, owner_id: grant.owner_id },
      "grant created",
    );
    return reply.code(201).send({
      id: grant.id,
      agent_id: grant.agent_id,
      owner_id: grant.owner_id,
      scopes: grant.scopes,
      spend_limit: grant.spend_limit,
      expires_at: grant.expires_at.toISOString(),
      revoked_at: null,
      issuer: grant.issuer,
    });
  });

  return app;
}
