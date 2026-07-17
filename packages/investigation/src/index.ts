import { createHash } from "node:crypto";

export type TextChunk = {
  ordinal: number;
  content: string;
  tokenCount: number;
};

const normalize = (value: string) => value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();

/**
 * Keeps paragraph boundaries whenever possible so evidence can be cited without
 * manufacturing context across unrelated runbook steps.
 */
export function chunkDocument(content: string, maximumCharacters = 1_400): TextChunk[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map(normalize)
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maximumCharacters) {
      if (current) chunks.push(current);
      current = "";
      for (let start = 0; start < paragraph.length; start += maximumCharacters) {
        chunks.push(paragraph.slice(start, start + maximumCharacters));
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maximumCharacters && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((chunk, ordinal) => ({
    ordinal,
    content: chunk,
    tokenCount: Math.ceil(chunk.split(/\s+/).filter(Boolean).length * 1.3),
  }));
}

export function documentChecksum(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function lexicalScore(query: string, content: string) {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_-]{2,}/g) ?? [])];
  if (terms.length === 0) return 0;
  const normalizedContent = content.toLowerCase();
  return terms.reduce((score, term) => score + (normalizedContent.match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "g"))?.length ?? 0), 0) / terms.length;
}
