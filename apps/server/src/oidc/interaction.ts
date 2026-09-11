/**
 * OIDC interaction contract endpoints (Task 4c, review M3) — mounted at
 * /oidc/interaction/:uid (Fastify routes; the provider hijack hook exempts
 * this prefix so bodies are parsed and app.authenticate applies).
 *
 * GET  /oidc/interaction/:uid → { success, data: { clientName, requestedScopes, promptName, uid } }
 * POST /oidc/interaction/:uid body { decision: 'approve' | 'deny' }
 *
 * Auth posture (binding): both endpoints require the AccessBase bearer JWT.
 * On consent prompts the interaction's session accountId must equal the token
 * subject. On login prompts there is no session accountId yet — the bearer
 * user IS the authenticated subject. Bearer is CSRF-immune; the provider's
 * _interaction cookie is SameSite=lax httpOnly (site-wide path set in
 * provider.ts so it survives the /login + /consent frontend destinations).
 *
 * Login-approve extension (M7 glue): approve on a login prompt completes the
 * provider login step with the bearer user's id — this is the server half of
 * the frontend Login page's OIDC redirect param flow (Task 6).
 */
import type { FastifyInstance } from 'fastify';
import type Provider from 'oidc-provider';

interface InteractionLike {
  uid: string;
  params: Record<string, string>;
  prompt: { name: string; scopes?: string[] };
  session?: { accountId?: string } | undefined;
}

function requestedScopes(interaction: InteractionLike): string[] {
  return String(interaction.params['scope'] ?? '')
    .split(' ')
    .filter(Boolean);
}

export async function registerInteractionRoutes(
  app: FastifyInstance,
  opts: { provider: Provider; clientNameLookup: (clientId: string) => Promise<string | undefined> },
): Promise<void> {
  const { provider, clientNameLookup } = opts;

  app.addHook('preHandler', app.authenticate);

  app.get<{ Params: { uid: string } }>(
    '/interaction/:uid',
    {
      schema: {
        description: 'OIDC interaction details for the frontend login/consent pages',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['uid'],
          properties: { uid: { type: 'string' } },
        },
      },
    },
    async (request) => {
      const interaction = (await provider.interactionDetails(
        request.raw,
        // interactionDetails is read-only — it never touches the response.
        request.raw as unknown as import('node:http').ServerResponse,
      )) as unknown as InteractionLike;
      const clientId = String(interaction.params['client_id'] ?? '');
      // The provider's Client wrapper drops non-schema fields like `name`,
      // so the display name comes from the registry via clientNameLookup.
      const clientName = (await clientNameLookup(clientId)) ?? clientId;
      const scopes = requestedScopes(interaction);
      return {
        success: true as const,
        data: {
          clientName,
          requestedScopes: scopes,
          promptName: interaction.prompt['name'] ?? interaction.prompt.name,
          uid: interaction.uid,
        },
      };
    },
  );

  app.post<{ Params: { uid: string }; Body: { decision?: string } }>(
    '/interaction/:uid',
    {
      schema: {
        description: 'Approve or deny the OIDC interaction (login/consent step)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['uid'],
          properties: { uid: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const decision = request.body?.decision;
      if (decision !== 'approve' && decision !== 'deny') {
        return reply.status(400).send({
          success: false,
          error: { code: 'OIDC_001', message: "decision must be 'approve' or 'deny'" },
        });
      }

      reply.hijack();
      const res = reply.raw;
      let interaction: InteractionLike;
      try {
        interaction = (await provider.interactionDetails(
          request.raw,
          res as unknown as import('node:http').ServerResponse,
        )) as unknown as InteractionLike;
      } catch {
        // reply.hijack() means Fastify's error handler is out of the picture —
        // without this catch a missing/expired interaction cookie would hang
        // the socket. Answer with the JSON envelope and end the response.
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            success: false,
            error: { code: 'OIDC_003', message: 'Interaction not found or expired' },
          }),
        );
        return;
      }

      const subject = (request.user as { sub: string }).sub;
      if (interaction.session?.accountId && interaction.session.accountId !== subject) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            success: false,
            error: { code: 'OIDC_002', message: 'Interaction belongs to a different user' },
          }),
        );
        return;
      }

      const scopes = interaction.prompt.scopes ?? requestedScopes(interaction);

      if (interaction.prompt.name === 'login' && decision === 'approve') {
        await provider.interactionFinished(request.raw, res, { login: { accountId: subject } });
        return;
      }
      if (interaction.prompt.name === 'consent' && decision === 'approve') {
        const grant = new provider.Grant({ accountId: subject, clientId: interaction.params['client_id'] });
        grant.addOIDCScope(scopes.join(' '));
        const grantId = await grant.save();
        await provider.interactionFinished(request.raw, res, { consent: { grantId } });
        return;
      }
      if (decision === 'deny') {
        // Deny uses the error-result shape: resume.js maps result.error through
        // errorMap and redirects to the RP with error=access_denied (spec-
        // correct deny). rejectedScopes alone would keep re-prompting consent.
        await provider.interactionFinished(request.raw, res, {
          error: 'access_denied',
          error_description: 'end-user denied authorization',
        });
        return;
      }

      res.statusCode = 400;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          success: false,
          error: { code: 'OIDC_003', message: `decision ${decision} not valid for prompt ${interaction.prompt.name}` },
        }),
      );
    },
  );
}
