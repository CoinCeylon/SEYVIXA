// T1.1b, T2.1 and T1.2a, Blueprint 6.1, 6.2 and 7: the API app, owner login, POST /api/agents/:id/grants and
// POST /api/actions/evaluate. More routes arrive with their own cards. The owner comes only from the server-side session (getSessionOwnerId).
// Nothing in the request can name the owner, and an agent credential is never accepted here.
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  gatewayRequestSchema,
  gatewayResponseSchema,
  idSchema,
  positiveLkrAmountSchema,
  timestampSchema,
} from "@seyvixa/shared";
import {
  InvalidActionRequest,
  createsActionRecord,
  insertActionWithEvent,
  prepareAction,
  type EscrowConfig,
  type PreparedAction,
} from "./actions.ts";
import { authenticateAgent, type Queryable } from "./agent-auth.ts";
import { createTicket } from "./tickets.ts";
import { API_GRANT_ISSUER, checkScopesForNewGrant, createGrant } from "./grants.ts";
import { DENY_MESSAGES, POLICY_VERSION, checkPolicy, isEscrowAction, recordPolicyEvent, type PolicyResult } from "./policy.ts";
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
  // Fixed demo escrow values (T1.2b). Without them, evaluate cannot build an escrow or purchase action and answers 500.
  escrow?: EscrowConfig;
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

  // Evaluate (T1.2a, Blueprint 6.2, decisions D17 and D36). The caller comes from the credential or the session,
  // never from the body. An Authorization header means an agent; without one the owner session is used, and
  // the owner may only ask for escrow actions. Every decision writes a policy_events row before the response.
  // A decision is data, not an HTTP status: DENY and the others answer 200, and a client must treat anything
  // but ALLOW as "not allowed". ALLOW and APPROVAL_REQUIRED answer 501 until the action record and ticket exist
  // (T1.2b, T1.2c): nothing is allowed yet. Nothing from the request body is logged.
  app.post("/api/actions/evaluate", async (request, reply) => {
    let caller: { kind: "agent"; agentId: string } | { kind: "owner"; ownerId: string };
    let inactiveAgentId: string | null = null;
    if (request.headers.authorization !== undefined) {
      const auth = await authenticateAgent(request, db);
      if (auth.ok) caller = { kind: "agent", agentId: auth.agentId };
      else if (auth.kind === "AGENT_INACTIVE") {
        caller = { kind: "agent", agentId: auth.agentId };
        inactiveAgentId = auth.agentId;
      } else return reply.code(401).send({ error: "UNAUTHENTICATED" });
    } else {
      let ownerId: string | null;
      try {
        ownerId = await getSessionOwnerId(request);
      } catch {
        ownerId = null;
      }
      if (typeof ownerId !== "string" || ownerId === "") return reply.code(401).send({ error: "UNAUTHENTICATED" });
      const owner = await db.query("SELECT id FROM users WHERE id = $1", [ownerId]);
      if (owner.rows.length !== 1) return reply.code(401).send({ error: "UNAUTHENTICATED" });
      caller = { kind: "owner", ownerId };
    }

    const body = gatewayRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const { tool, resource, parameters } = body.data;
    // The owner session is for escrow actions only. An agent's PROPOSE_PURCHASE must carry its total.
    if (caller.kind === "owner" && !isEscrowAction(tool)) return reply.code(400).send({ error: "INVALID_REQUEST" });
    if (tool === "PROPOSE_PURCHASE" && !positiveLkrAmountSchema.safeParse(parameters.total_lkr).success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }

    const result: PolicyResult =
      inactiveAgentId !== null
        ? { decision: "DENY", reasonCode: "AGENT_INACTIVE" }
        : await checkPolicy(db, { caller, tool, resource, parameters }, integrityKey, now());
    // An owner caller only ever gets APPROVAL_REQUIRED or a 400 above, so a DENY always has an agent.
    const agentId = caller.kind === "agent" ? caller.agentId : null;
    const logDecision = () =>
      request.log.info(
        {
          event: "policy_decision",
          decision: result.decision,
          reason_code: result.decision === "DENY" ? result.reasonCode : undefined,
          agent_id: agentId,
          tool,
        },
        "policy decision",
      );

    if (result.decision === "DENY") {
      await recordPolicyEvent(db, { agentId, tool, resource, result });
      logDecision();
      const response = gatewayResponseSchema.parse({
        decision: "DENY",
        reason_code: result.reasonCode,
        agent_id: agentId ?? "",
        requested_resource: resource,
        message: DENY_MESSAGES[result.reasonCode],
      });
      return reply.code(200).send(response);
    }
    // Read tools create no action record; they get their ticket in T1.2c, so they still answer 501.
    if (!createsActionRecord(tool)) {
      await recordPolicyEvent(db, { agentId, tool, resource, result });
      logDecision();
      return reply.code(501).send({ error: "NOT_IMPLEMENTED" });
    }

    // T1.2b: build and store the immutable action record (Blueprint 6.5). A request that cannot build a valid
    // action is a 400 and writes no event and no action, like the other 400s; it never says why.
    let prepared: PreparedAction;
    try {
      prepared = await prepareAction(db, { caller, tool, decision: result.decision, parameters }, options.escrow, now());
    } catch (error) {
      if (error instanceof InvalidActionRequest) return reply.code(400).send({ error: "INVALID_REQUEST" });
      request.log.error({ event: "action_prepare_failed" }, "could not prepare the action");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
    // T1.2c: an ALLOW gets a short-lived, single-use ticket bound to the action hash, the caller and the policy
    // version. Only its binding tag is stored; the ticket itself is returned once and never logged. Escrow
    // actions get theirs when the owner approves (T2.3).
    const ticket =
      result.decision === "ALLOW"
        ? createTicket({ actionHash: prepared.actionHash, caller, policyVersion: POLICY_VERSION }, now())
        : undefined;
    const actionId = await insertActionWithEvent(db, prepared, { agentId, tool, resource, decision: result.decision }, now(), ticket);
    logDecision();
    if (result.decision === "APPROVAL_REQUIRED") {
      const response = gatewayResponseSchema.parse({
        decision: "APPROVAL_REQUIRED",
        action_id: actionId,
        action_hash: prepared.actionHash,
        message: "Owner approval is required for this exact action.",
      });
      return reply.code(200).send(response);
    }
    const allowed = gatewayResponseSchema.parse({
      decision: "ALLOW",
      action_id: actionId,
      action_hash: prepared.actionHash,
      ticket: ticket!.ticket,
      ticket_expires_at: ticket!.expiresAt.toISOString(),
    });
    return reply.code(200).send(allowed);
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
