import {
  RediSearchSchema,
  SCHEMA_FIELD_TYPE,
  SCHEMA_VECTOR_FIELD_ALGORITHM,
  SearchReply,
} from "redis";
import config from "../../config";
import getClient from "../../redis";
import {
  embedText,
  getEmbeddingDimensions,
  hasConfiguredLlm,
} from "../../services/ai/ai";
import { randomUlid } from "../../utils/uid";
import * as ai from "./ai";
import * as tools from "./tools";
import { MarkdownTextSplitter } from "@langchain/textsplitters";
import {
  base64ToUrl,
  escapeDashes,
  float32ToBuffer,
  urlToBase64,
} from "../../utils/convert";
import logger from "../../utils/log";

const DEFAULT_TTL = config.redis.DEFAULT_TTL || -1;

export interface Document {
  id: string;
  userId: string;
  projectId: string;
  url: string;
  content: string;
}

export interface DocumentChunk {
  documentId: string;
  userId: string;
  projectId: string;
  content: string;
  embedding: number[];
}

export async function initialize() {
  if (!hasConfiguredLlm()) {
    logger.warn(
      "Skipping document index initialization because no LLM provider is configured.",
      {
        noStream: true,
      },
    );
    return;
  }

  await createIndexIfNotExists();
}

export async function createIndexIfNotExists() {
  const vectorDimensions = getEmbeddingDimensions();
  const chunkSchema: RediSearchSchema = {
    "$.embedding": {
      type: SCHEMA_FIELD_TYPE.VECTOR,
      TYPE: "FLOAT32",
      ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.HNSW,
      DIM: vectorDimensions,
      DISTANCE_METRIC: "COSINE",
      AS: "embedding",
    },
    "$.documentId": {
      type: SCHEMA_FIELD_TYPE.TAG,
      AS: "documentId",
    },
    "$.userId": {
      type: SCHEMA_FIELD_TYPE.TAG,
      AS: "userId",
    },
    "$.projectId": {
      type: SCHEMA_FIELD_TYPE.TAG,
      AS: "projectId",
    },
    "$.content": {
      type: SCHEMA_FIELD_TYPE.TEXT,
      AS: "content",
    },
  };
  const documentSchema: RediSearchSchema = {
    "$.id": {
      type: SCHEMA_FIELD_TYPE.TAG,
      AS: "id",
    },
    "$.userId": {
      type: SCHEMA_FIELD_TYPE.TAG,
      AS: "userId",
    },
    "$.projectId": {
      type: SCHEMA_FIELD_TYPE.TAG,
      AS: "projectId",
    },
    "$.url": {
      type: SCHEMA_FIELD_TYPE.TAG,
      AS: "url",
    },
    "$.content": {
      type: SCHEMA_FIELD_TYPE.TEXT,
      AS: "content",
    },
  };

  const db = await getClient();
  let indexName = "idx-documents";
  try {
    await db.ft.info(indexName);
  } catch (error) {
    await db.ft.create(indexName, documentSchema, {
      ON: "JSON",
      PREFIX: "documents:",
    });
  }

  indexName = "idx-document-chunks";
  try {
    await db.ft.info(indexName);
  } catch (error) {
    await db.ft.create(indexName, chunkSchema, {
      ON: "JSON",
      PREFIX: "document-chunks:",
    });
  }
}

async function split(document: Document): Promise<DocumentChunk[]> {
  const chunkSize = 10;

  logger.debug(
    `Splitting document ${document.url} for user ${document.userId}`,
  );
  const splitter = new MarkdownTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 0,
  });
  const chunks = await splitter.splitText(document.content);
  // const { chunks } = await chunkFile(document.content);
  logger.debug(`File split into ${chunks.length} chunks`);

  const allChunks: DocumentChunk[] = [];

  for (let i = 0; i < chunks.length; i += chunkSize) {
    const chunkGroup = chunks.slice(i, i + chunkSize);
    const chunkEmbeddings = await Promise.all(
      chunkGroup.map(async (chunk) => {
        return {
          documentId: document.id,
          userId: document.userId,
          content: chunk,
          embedding: await embedText(chunk),
        } as DocumentChunk;
      }),
    );

    allChunks.push(...chunkEmbeddings);
  }

  return allChunks;
}

export async function createMany(
  userId: string,
  projectId: string,
  documents: { url: string; content: string }[],
): Promise<Document[]> {
  if (documents.length === 0) {
    return [];
  }

  const allDocuments: Document[] = [];
  const allChunks: DocumentChunk[] = [];

  for (const document of documents) {
    const mdFile = {
      id: randomUlid(),
      userId,
      projectId,
      url: document.url,
      content: document.content,
    };

    allDocuments.push(mdFile);
    allChunks.push(...(await split(mdFile)));
  }

  const db = await getClient();

  logger.debug(
    `Setting ${allDocuments.length} documents for user ${userId} and project ${projectId} in Redis`,
    {
      userId,
    },
  );

  const allKeys = allDocuments.map((d) => `documents:${d.id}`);

  await db.json.mSet(
    allDocuments.map((document) => {
      return {
        key: `documents:${document.id}`,
        path: "$",
        value: {
          ...document,
          url: urlToBase64(document.url),
        } as any,
      };
    }),
  );

  logger.info(
    `Found ${allDocuments.length} documents, transformed into ${allChunks.length} chunks for vector search.`,
    {
      userId,
    },
  );

  const jsonChunks = allChunks.map((chunk) => {
    return {
      key: `document-chunks:${randomUlid()}`,
      path: "$",
      value: chunk as any,
    };
  });

  allKeys.push(...jsonChunks.map((c) => c.key));

  await db.json.mSet(jsonChunks);

  if (DEFAULT_TTL > 0) {
    for (const key of allKeys) {
      await db.expire(key, DEFAULT_TTL);
    }
  }

  return allDocuments;
}

export async function create(
  userId: string,
  projectId: string,
  url: string,
  content: string,
): Promise<Document> {
  const documents = await createMany(userId, projectId, [{ url, content }]);

  return documents[0];
}

export async function allUrls(
  userId: string,
  projectId: string,
): Promise<string[]> {
  const db = await getClient();

  logger.debug(
    `Fetching all document URLs for user ${userId} and project ${projectId}`,
  );

  const results = await db.ft.search(
    "idx-documents",
    `@userId:{${escapeDashes(userId)}} @projectId:{${escapeDashes(projectId)}}`,
    {
      RETURN: ["url"],
      LIMIT: {
        from: 0,
        size: 1000,
      },
      SORTBY: "url",
    },
  );

  const urls = results.documents.map((doc) =>
    base64ToUrl((doc.value as any).url),
  );

  logger.debug(
    `Found ${urls.length} URLs for user ${userId} and project ${projectId}`,
  );

  return urls;
}

export async function searchChunks(
  userId: string,
  query: string,
): Promise<DocumentChunk[]> {
  logger.debug(`Searching documents for user ${userId} with query: ${query}`);

  const db = await getClient();
  const embedding = await embedText(query);

  let results = await db.ft.search(
    "idx-document-chunks",
    `(@userId:{${escapeDashes(userId)}})=>[KNN 100 @embedding $BLOB AS vector_score]`,
    {
      PARAMS: {
        BLOB: float32ToBuffer(embedding),
      },
      RETURN: ["documentId", "userId", "projectId", "content", "vector_score"],
      SORTBY: "vector_score",
      DIALECT: 2,
    },
  );

  if (results.total === 0) {
    return [];
  }

  const chunks = results.documents
    .filter((doc) => {
      return (doc.value as any).vector_score < 0.3;
    })
    .map((doc) => doc.value);

  return chunks as unknown as DocumentChunk[];
}

export async function getChunkSearchTool(userId: string) {
  return tools.getSearchDocumentChunksTool(async ({ query }) => {
    logger.info(`LLM searching for document chunks to match query`, {
      userId,
    });
    const chunks = await searchChunks(userId, query);

    if (chunks.length === 0) {
      return "No relevant document chunks found.";
    }

    logger.info(`LLM found ${chunks.length} relevant document chunks.`, {
      userId,
    });

    return chunks
      .map((chunk) => {
        return chunk.content;
      })
      .join("\n\n");
  });
}

export async function search(
  userId: string,
  projectId: string,
  query: string,
): Promise<Document[]> {
  const db = await getClient();
  const chunks = await searchChunks(userId, query);
  let results: Awaited<ReturnType<typeof db.ft.search>> = {
    total: 0,
    documents: [],
  };

  if (chunks.length > 0) {
    const documentIds = Array.from(
      new Set(chunks.map((doc) => doc.documentId)),
    );

    if (documentIds.length > 0) {
      results = await db.ft.search(
        "idx-documents",
        `@userId:{${escapeDashes(userId)}} @id:{${escapeDashes(documentIds.join("|"))}}`,
        {
          SORTBY: "url",
        },
      );
    } else {
      results = {
        total: 0,
        documents: [],
      };
    }
  }

  if (results.total === 0) {
    logger.debug(`No similar documents found, falling back to URL matching`);

    const matchedUrl = await ai.matchPromptToUrl(
      query,
      await allUrls(userId, projectId),
    );

    logger.debug(`Matched URL: ${matchedUrl}`);

    if (matchedUrl && matchedUrl.length > 0) {
      results = await db.ft.search(
        "idx-documents",
        `@userId:{${escapeDashes(userId)}} @url:{${escapeDashes(urlToBase64(matchedUrl))}}`,
        {
          SORTBY: "url",
        },
      );
    }
  }

  if (results.total === 0) {
    return [];
  }

  return results.documents.map((doc) => {
    return {
      ...doc.value,
      url: base64ToUrl((doc.value as any).url),
    } as Document;
  });
}

export async function all(
  userId: string,
  projectId?: string,
): Promise<Document[]> {
  const db = await getClient();

  let search = `@userId:{${escapeDashes(userId)}}`;

  if (projectId && projectId.length > 0) {
    search += ` @projectId:{${escapeDashes(projectId)}}`;
  }

  const results = await db.ft.search("idx-documents", search, {
    LIMIT: {
      from: 0,
      size: 50,
    },
    SORTBY: "url",
  });

  if (results.total === 0) {
    return [];
  }

  return results.documents.map((doc) => {
    return {
      ...doc.value,
      url: base64ToUrl((doc.value as any).url),
    } as Document;
  });
}

export async function byUrl(
  userId: string,
  projectId: string,
  url: string,
): Promise<Document | null> {
  const db = await getClient();

  const results = await db.ft.search(
    "idx-documents",
    `@userId:{${escapeDashes(userId)}} @projectId:{${escapeDashes(projectId)}} @url:{${escapeDashes(urlToBase64(url))}}`,
    {
      LIMIT: {
        from: 0,
        size: 1,
      },
    },
  );

  if (results.total === 0) {
    return null;
  }

  return {
    ...results.documents[0].value,
    url: base64ToUrl((results.documents[0].value as any).url),
  } as Document;
}

export async function read(
  userId: string,
  documentId: string,
): Promise<Document | null> {
  const db = await getClient();
  const documentKey = `documents:${documentId}`;
  let document = await db.json.get(documentKey, {
    path: "$",
  });

  if (Array.isArray(document)) {
    document = document[0];
  }

  if (!document) {
    logger.error(
      `Document \`${documentId}\` not found for user \`${userId}\``,
      {
        documentId,
        userId,
      },
    );
    return null;
  }

  return {
    ...(document as any),
    url: base64ToUrl((document as any).url),
  } as Document;
}

export async function modifyContent(document: Document, prompt: string) {
  logger.debug(`Modifying content for document ${document.id}`, {
    userId: document.userId,
  });
  const newContent = await ai.modifyContent(
    document.content,
    prompt,
    document.url,
  );
  const db = await getClient();

  document.content = newContent;

  logger.debug(
    `Splitting document with new content into chunks for ${document.id}`,
    {
      userId: document.userId,
    },
  );

  const chunks = await split(document);
  let existingChunks: SearchReply;

  logger.debug(`Removing existing chunks for document ${document.id}`, {
    userId: document.userId,
  });
  do {
    existingChunks = await db.ft.search(
      "idx-document-chunks",
      `@documentId:{${escapeDashes(document.id)}}`,
      {
        RETURN: ["documentId"],
        LIMIT: {
          from: 0,
          size: 1000,
        },
      },
    );

    if (existingChunks.total > 0) {
      await db.del(existingChunks.documents.map((doc) => doc.id));
    }
  } while (existingChunks.total > 0);

  logger.debug(`Updating document ${document.id} content in Redis`, {
    userId: document.userId,
  });

  await db.json.set(`documents:${document.id}`, "$", {
    ...document,
    url: urlToBase64(document.url),
  } as any);

  if (DEFAULT_TTL > 0) {
    await db.expire(`documents:${document.id}`, DEFAULT_TTL);
  }

  logger.debug(
    `Adding ${chunks.length} new chunks for document ${document.id} in Redis`,
    {
      userId: document.userId,
    },
  );

  const jsonChunks = chunks.map((chunk) => {
    return {
      key: `document-chunks:${randomUlid()}`,
      path: "$",
      value: chunk as any,
    };
  });

  await db.json.mSet(jsonChunks);

  if (DEFAULT_TTL > 0) {
    for (const key of jsonChunks.map((c) => c.key)) {
      await db.expire(key, DEFAULT_TTL);
    }
  }

  return document;
}

export async function diff(
  userId: string,
  documentId: string,
  newContent: string,
) {
  const document = await read(userId, documentId);

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const diffSummary = await ai.getDiffSummary(
    document.content,
    newContent,
    document.url,
  );

  logger.info(
    `Found ${diffSummary?.actions?.length ?? 0} desired actions based on document edits.`,
    {
      userId,
    },
  );

  return diffSummary;
}

export async function applyToOne(
  userId: string,
  documentId: string,
  actions: string,
) {
  const document = await read(userId, documentId);
  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  return modifyContent(document, actions);
}

export async function applyToAll(
  progress: (document: Document) => void,
  userId: string,
  projectId: string,
  actions: string,
) {
  const documents = await all(userId, projectId);

  const chunks = 15;

  for (let i = 0; i < documents.length; i += chunks) {
    const chunk = documents.slice(i, i + chunks);
    await Promise.all(
      chunk.map(async (document) => {
        const updatedDocument = await modifyContent(document, actions);
        progress(updatedDocument);
      }),
    );
  }

  logger.debug(`Completed applying actions to all documents`, {
    userId,
  });
}

export async function removeAllForUser(userId: string) {
  const db = await getClient();
  const documents = await all(userId);
  const keys = documents.map((d) => `documents:${d.id}`);

  if (keys.length === 0) {
    return;
  }

  let allChunks: SearchReply;
  do {
    allChunks = await db.ft.search(
      "idx-document-chunks",
      `@userId:{${escapeDashes(userId)}}`,
      {
        RETURN: ["documentId"],
        LIMIT: {
          from: 0,
          size: 1000,
        },
      },
    );

    if (allChunks.total > 0) {
      await db.del(allChunks.documents.map((doc) => doc.id));
    }
  } while (allChunks.total > 0);

  do {
    await db.del(keys.splice(0, 1000));
  } while (keys.length > 0);

  logger.debug(`Deleted all documents and chunks for user ${userId}`, {
    userId,
  });
}
