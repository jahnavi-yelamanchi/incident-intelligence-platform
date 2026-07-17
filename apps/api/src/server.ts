import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createQueueRuntime, createRealtimeRelay } from "@incident/queues";
import { createDatabaseClient } from "@incident/database";
import { cancelActionRequest, createActionRequest, decideActionApproval, listIncidents } from "./incidents.js";
import { generateInvestigation, listHypotheses, searchEvidence, upsertDocument } from "./investigation.js";
import { createOpenAiInvestigationProvider, unavailableInvestigationProvider } from "./investigation-provider.js";
import { createTemporalRemediationDispatcher, unavailableRemediationDispatcher } from "./remediation-dispatcher.js";
import { getIntegrationCredentials, listIntegrations, upsertIntegration } from "./integrations.js";
import { resolveWebhookIntegration } from "./webhook-integrations.js";
import { completeSlackOAuth, slackAuthorizeUrl, type SlackOAuthConfig } from "./slack-oauth.js";
import { RealtimeHub } from "./realtime.js";
import { createAuth0AccessTokenVerifier } from "./security/auth0-access-token.js";
import { processSlackEvent } from "./slack-events.js";
import { createOpaPolicyEvaluator, developmentPolicyEvaluator } from "./policy.js";
import { createInstallationToken, fetchRepositoryMarkdown } from "./github-app.js";
import { listAuditEvents } from "./audit.js";

const config = loadConfig();
const queues = createQueueRuntime(config.REDIS_URL);
const database = createDatabaseClient(config.DATABASE_URL);
const isDemoMode = config.NODE_ENV === "development" && config.DEMO_MODE === "true";
if (!isDemoMode && (!config.AUTH0_ISSUER_BASE_URL || !config.AUTH0_AUDIENCE)) {
  throw new Error("AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE are required to start the API.");
}
const authenticate = isDemoMode
  ? async (authorization: string | undefined) =>
      authorization === "Bearer aegis-demo"
        ? { subject: "demo-operator", organizationId: config.DEMO_ORGANIZATION_ID, roles: ["responder", "production-approver"] }
        : authorization === "Bearer aegis-demo-approver"
          ? { subject: "demo-approver", organizationId: config.DEMO_ORGANIZATION_ID, roles: ["production-approver"] }
        : null
  : createAuth0AccessTokenVerifier({
      issuer: config.AUTH0_ISSUER_BASE_URL!,
      audience: config.AUTH0_AUDIENCE!,
      organizationClaim: "https://incident-intelligence.example/organization_id",
      rolesClaim: "https://incident-intelligence.example/roles",
    });
const investigationProvider = config.OPENAI_API_KEY
  ? createOpenAiInvestigationProvider({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_INVESTIGATION_MODEL })
  : unavailableInvestigationProvider();
const realtimeHub = new RealtimeHub();
const evaluatePolicy = config.OPA_URL ? createOpaPolicyEvaluator(config.OPA_URL) : developmentPolicyEvaluator;
const realtimeRelay = createRealtimeRelay(config.REDIS_URL, (message) => realtimeHub.publish(message.organizationId, message.type, message.payload));
await realtimeRelay.start();
const remediationDispatcher = await createTemporalRemediationDispatcher({
  address: config.TEMPORAL_ADDRESS,
  namespace: config.TEMPORAL_NAMESPACE,
  taskQueue: config.TEMPORAL_TASK_QUEUE,
}).catch(() => unavailableRemediationDispatcher());
const slackOAuthConfig: SlackOAuthConfig | null = config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET && config.SLACK_REDIRECT_URI && config.SLACK_SIGNING_SECRET && config.INTEGRATION_OAUTH_STATE_SECRET && config.INTEGRATION_ENCRYPTION_KEY
  ? { clientId: config.SLACK_CLIENT_ID, clientSecret: config.SLACK_CLIENT_SECRET, redirectUri: config.SLACK_REDIRECT_URI, signingSecret: config.SLACK_SIGNING_SECRET, stateSecret: config.INTEGRATION_OAUTH_STATE_SECRET, encryptionKey: config.INTEGRATION_ENCRYPTION_KEY }
  : null;
const githubAppConfig = config.GITHUB_APP_ID && config.GITHUB_APP_PRIVATE_KEY ? { appId: config.GITHUB_APP_ID, privateKey: config.GITHUB_APP_PRIVATE_KEY } : null;

const app = await buildApp({
  corsOrigins: config.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
  // Production adapters are wired in the integration and queue packages.
  getIntegrationCredential: async () => null,
  publishEvents: async (events, correlationId) => {
    await queues.publishEvents(events, correlationId);
  },
  readiness: async () => {
    const ready = await queues.readiness().catch(() => false);
    const databaseReady = await database.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    return { database: databaseReady, redis: ready, queue: ready };
  },
  authenticate,
  listIncidents: (context, query) => listIncidents(database, context, query),
  createActionRequest: (context, incidentId, input, correlationId) =>
    createActionRequest(database, context, incidentId, input, correlationId, remediationDispatcher, evaluatePolicy),
  decideActionApproval: (context, actionRequestId, input, correlationId) =>
    decideActionApproval(database, context, actionRequestId, input, correlationId, remediationDispatcher),
  cancelActionRequest: (context, actionRequestId, reason, correlationId) =>
    cancelActionRequest(database, context, actionRequestId, reason, correlationId, remediationDispatcher),
  upsertDocument: (context, input, correlationId) => upsertDocument(database, context, input, correlationId),
  searchEvidence: (context, input) => searchEvidence(database, context, input),
  generateInvestigation: (context, incidentId, correlationId) =>
    generateInvestigation(database, context, incidentId, investigationProvider, correlationId),
  listHypotheses: (context, incidentId) => listHypotheses(database, context, incidentId),
  listAuditEvents: (context, query) => listAuditEvents(database, context, query),
  listIntegrations: (context) => listIntegrations(database, context),
  upsertIntegration: (context, input, correlationId) => upsertIntegration(database, context, input, config.INTEGRATION_ENCRYPTION_KEY, correlationId),
  resolveWebhookIntegration: (provider, connectionId) => resolveWebhookIntegration(database, provider, connectionId, config.INTEGRATION_ENCRYPTION_KEY),
  ...(slackOAuthConfig ? {
    beginSlackOAuth: (context: Parameters<typeof slackAuthorizeUrl>[0]) => Promise.resolve(slackAuthorizeUrl(context, slackOAuthConfig)),
    completeSlackOAuth: (input: { code: string; state: string; correlationId: string }) => completeSlackOAuth(database, input, slackOAuthConfig, input.correlationId),
  } : {}),
  processSlackEvent: (organizationId, body, correlationId) => processSlackEvent(database, organizationId, body, correlationId),
  ...(githubAppConfig ? {
    syncGitHubDocuments: async (context, connectionId, correlationId) => {
      const connection = await getIntegrationCredentials(database, context, connectionId, "github", config.INTEGRATION_ENCRYPTION_KEY);
      const installationId = typeof connection.credentials.installationId === "string" ? connection.credentials.installationId : null;
      const repository = typeof connection.credentials.repository === "string" ? connection.credentials.repository : null;
      if (!installationId || !repository) throw Object.assign(new Error("GitHub connection requires installationId and repository credentials."), { statusCode: 400 });
      const token = await createInstallationToken(githubAppConfig, installationId);
      const files = await fetchRepositoryMarkdown(token.token, repository);
      for (const file of files) await upsertDocument(database, context, { kind: "github_document", externalId: `${repository}:${file.path}`, title: `${repository}/${file.path}`, content: file.content, sourceUrl: `https://github.com/${repository}/blob/main/${file.path}`, accessControl: {} }, correlationId);
      return { synced: files.length };
    },
  } : {}),
  realtimeHub,
  publishRealtime: async (organizationId, type, payload) => {
    await realtimeRelay.publish({ organizationId, type, payload });
  },
});

const close = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await queues.close();
  await realtimeRelay.close();
  await database.$disconnect();
  process.exit(0);
};

process.once("SIGTERM", () => void close("SIGTERM"));
process.once("SIGINT", () => void close("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });
