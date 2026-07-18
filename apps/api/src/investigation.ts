import type { EvidenceSearch, DocumentUpsert } from "@incident/contracts";
import { chunkDocument, documentChecksum, lexicalScore } from "@incident/investigation";
import { Prisma, type DatabaseClient, withTenant } from "@incident/database";
import type { ApiAuthContext } from "./security/auth0-access-token.js";
import type { InvestigationProvider } from "./investigation-provider.js";

export type DocumentCitation = {
  id: string;
  documentId: string;
  ordinal: number;
  title: string;
  kind: string;
  excerpt: string;
  sourceUrl: string | null;
  indexedAt: string | null;
  score: number;
};

function canManageEvidence(context: ApiAuthContext) {
  return context.roles.includes("responder") || context.roles.includes("incident-commander");
}

export async function upsertDocument(
  database: DatabaseClient,
  context: ApiAuthContext,
  input: DocumentUpsert,
  correlationId: string,
) {
  if (!canManageEvidence(context)) throw Object.assign(new Error("Responder role required."), { statusCode: 403 });
  const checksum = documentChecksum(input.content);
  const chunks = chunkDocument(input.content);
  if (chunks.length === 0) throw Object.assign(new Error("Document has no indexable content."), { statusCode: 400 });

  return withTenant(database, context.organizationId, async (transaction) => {
    const existing = await transaction.document.findUnique({
      where: { organizationId_kind_externalId: { organizationId: context.organizationId, kind: input.kind, externalId: input.externalId } },
    });
    const document = existing
      ? await transaction.document.update({
          where: { id: existing.id },
          data: {
            title: input.title,
            sourceUrl: input.sourceUrl ?? null,
            checksum,
            accessControl: input.accessControl as Prisma.InputJsonValue,
            indexedAt: new Date(),
          },
        })
      : await transaction.document.create({
          data: {
            organizationId: context.organizationId,
            kind: input.kind,
            externalId: input.externalId,
            title: input.title,
            sourceUrl: input.sourceUrl ?? null,
            checksum,
            accessControl: input.accessControl as Prisma.InputJsonValue,
            indexedAt: new Date(),
          },
        });
    await transaction.documentChunk.deleteMany({ where: { documentId: document.id } });
    await transaction.documentChunk.createMany({
      data: chunks.map((chunk) => ({
        organizationId: context.organizationId,
        documentId: document.id,
        ordinal: chunk.ordinal,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        metadata: { checksum },
      })),
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorType: "user",
        actorId: context.subject,
        action: existing ? "document.reindexed" : "document.indexed",
        resourceType: "document",
        resourceId: document.id,
        correlationId,
        metadata: { kind: input.kind, externalId: input.externalId, chunkCount: chunks.length, checksum },
      },
    });
    return { id: document.id, checksum, chunkCount: chunks.length, indexedAt: document.indexedAt?.toISOString() ?? new Date().toISOString() };
  });
}

export async function listDocuments(database: DatabaseClient, context: ApiAuthContext) {
  return withTenant(database, context.organizationId, async (transaction) => {
    const documents = await transaction.document.findMany({ orderBy: { updatedAt: "desc" }, take: 100, include: { _count: { select: { chunks: true } } } });
    return documents.map((document) => ({ id: document.id, title: document.title, kind: document.kind, sourceUrl: document.sourceUrl, indexedAt: document.indexedAt?.toISOString() ?? null, chunkCount: document._count.chunks }));
  });
}

/** Tenant-scoped lexical retrieval. Embedding retrieval can be merged into this ranked set once an embedding provider is configured. */
export async function searchEvidence(database: DatabaseClient, context: ApiAuthContext, input: EvidenceSearch): Promise<DocumentCitation[]> {
  return withTenant(database, context.organizationId, async (transaction) => {
    const chunks = await transaction.documentChunk.findMany({
      where: input.kinds ? { document: { kind: { in: input.kinds } } } : {},
      include: { document: true },
      orderBy: { document: { updatedAt: "desc" } },
      take: 300,
    });
    return chunks
      .map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        ordinal: chunk.ordinal,
        title: chunk.document.title,
        kind: chunk.document.kind,
        excerpt: chunk.content.slice(0, 1_000),
        sourceUrl: chunk.document.sourceUrl,
        indexedAt: chunk.document.indexedAt?.toISOString() ?? null,
        score: lexicalScore(input.query, `${chunk.document.title}\n${chunk.content}`),
      }))
      .filter((citation) => citation.score > 0)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, input.limit);
  });
}

export async function generateInvestigation(
  database: DatabaseClient,
  context: ApiAuthContext,
  incidentId: string,
  provider: InvestigationProvider,
  correlationId: string,
) {
  if (!canManageEvidence(context)) throw Object.assign(new Error("Responder role required."), { statusCode: 403 });
  if (!provider.available) throw Object.assign(new Error("Investigation provider is not configured."), { statusCode: 503 });

  const incidentAndEvidence = await withTenant(database, context.organizationId, async (transaction) => {
    const incident = await transaction.incident.findUnique({
      where: { id: incidentId },
      include: { service: true },
    });
    if (!incident) throw Object.assign(new Error("Incident not found."), { statusCode: 404 });
    const query = `${incident.title} ${incident.summary ?? ""} ${incident.service.displayName}`;
    const chunks = await transaction.documentChunk.findMany({
      include: { document: true },
      orderBy: { document: { updatedAt: "desc" } },
      take: 300,
    });
    const evidence = chunks
      .map((chunk) => ({
        id: chunk.id,
        title: chunk.document.title,
        kind: chunk.document.kind,
        excerpt: chunk.content.slice(0, 1_000),
        sourceUrl: chunk.document.sourceUrl,
        indexedAt: chunk.document.indexedAt?.toISOString() ?? null,
        score: lexicalScore(query, `${chunk.document.title}\n${chunk.content}`),
      }))
      .filter((citation) => citation.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 12);
    return { incident, evidence };
  });
  if (incidentAndEvidence.evidence.length === 0) {
    throw Object.assign(new Error("No relevant indexed evidence is available for this incident."), { statusCode: 409 });
  }
  const generated = await provider.generate({
    incidentTitle: incidentAndEvidence.incident.title,
    incidentSummary: incidentAndEvidence.incident.summary,
    evidence: incidentAndEvidence.evidence,
  });
  const evidenceById = new Map(incidentAndEvidence.evidence.map((citation) => [citation.id, citation]));
  for (const hypothesis of generated.hypotheses) {
    if (hypothesis.citationIds.some((citationId) => !evidenceById.has(citationId))) {
      throw Object.assign(new Error("Investigation provider cited evidence outside its retrieval set."), { statusCode: 502 });
    }
  }

  return withTenant(database, context.organizationId, async (transaction) => {
    const hypotheses = await Promise.all(generated.hypotheses.map(async (hypothesis) => {
      const supportingEvidence = hypothesis.citationIds.map((citationId) => evidenceById.get(citationId)!);
      return transaction.hypothesis.create({
        data: {
          organizationId: context.organizationId,
          incidentId,
          statement: hypothesis.statement,
          confidence: hypothesis.confidence,
          supportingEvidence: supportingEvidence as unknown as Prisma.InputJsonValue,
          conflictingEvidence: hypothesis.conflictingEvidence as unknown as Prisma.InputJsonValue,
          recommendedChecks: hypothesis.recommendedChecks as unknown as Prisma.InputJsonValue,
          model: provider.model,
          promptVersion: "investigation-v1",
        },
      });
    }));
    await transaction.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorType: "user",
        actorId: context.subject,
        action: "investigation.generated",
        resourceType: "incident",
        resourceId: incidentId,
        correlationId,
        metadata: { model: provider.model, evidenceCount: incidentAndEvidence.evidence.length, hypothesisCount: hypotheses.length },
      },
    });
    return {
      items: hypotheses.map((hypothesis, index) => ({
        id: hypothesis.id,
        statement: hypothesis.statement,
        confidence: Number(hypothesis.confidence),
        citations: generated.hypotheses[index]?.citationIds.map((citationId) => evidenceById.get(citationId)!),
        conflictingEvidence: generated.hypotheses[index]?.conflictingEvidence ?? [],
        recommendedChecks: generated.hypotheses[index]?.recommendedChecks ?? [],
        generatedAt: hypothesis.generatedAt.toISOString(),
      })),
    };
  });
}

export async function listHypotheses(database: DatabaseClient, context: ApiAuthContext, incidentId: string) {
  return withTenant(database, context.organizationId, async (transaction) => {
    const hypotheses = await transaction.hypothesis.findMany({ where: { incidentId }, orderBy: { generatedAt: "desc" }, take: 10 });
    return hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      statement: hypothesis.statement,
      confidence: Number(hypothesis.confidence),
      citations: hypothesis.supportingEvidence,
      conflictingEvidence: hypothesis.conflictingEvidence,
      recommendedChecks: hypothesis.recommendedChecks,
      generatedAt: hypothesis.generatedAt.toISOString(),
    }));
  });
}
