import type { EvidenceSearch, DocumentUpsert } from "@incident/contracts";
import { chunkDocument, documentChecksum, lexicalScore } from "@incident/investigation";
import { Prisma, type DatabaseClient, withTenant } from "@incident/database";
import type { ApiAuthContext } from "./security/auth0-access-token.js";

type DocumentCitation = {
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
