import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { ctrl as chats } from "../server/components/chats";
import { ctrl as documents } from "../server/components/documents";
import { WorkingMemoryModel } from "../server/components/memory";
import { setTestEmbeddingConfig } from "../server/services/ai/ai";
import { flushTestData, getTestRedis } from "./helpers/redis";
import { setChatAiAdapterForTests } from "../server/components/chats/controller";

const ragAnswerMock = mock(
  async () => "Redis Search powers the fallback answer.",
);
const storeSemanticMock = mock(async () => {});

const VECTOR_LOOKUP: Record<string, number[]> = {
  "Hello, world!": [0, 0, 0],
  "What is Redis?": [1, 0, 0],
  "Redis is an in-memory data store.": [1, 0, 0],
  "Tell me about Redis Search": [0, 1, 0],
  "# Search\nRedis Search powers vector search.": [0, 1, 0],
};

function getEmbedding(text: string): number[] {
  return VECTOR_LOOKUP[text] ?? [0.5, 0.5, 0.5];
}

describe("Chat controller", () => {
  beforeEach(async () => {
    ragAnswerMock.mockClear();
    storeSemanticMock.mockClear();
    setTestEmbeddingConfig({
      dimensions: 3,
      embedText: async (text: string) => getEmbedding(text),
    });
    setChatAiAdapterForTests({
      answerQuestionWithRag: ragAnswerMock,
      storeSemanticMemories: storeSemanticMock,
    });
    await flushTestData();
    await documents.initialize();
  });

  afterAll(async () => {
    setChatAiAdapterForTests();
    setTestEmbeddingConfig();
    await flushTestData();
  });

  test("uses semantic memory before document search", async () => {
    const redis = await getTestRedis();
    const workingMemory = await WorkingMemoryModel.New(redis, "user-semantic", {
      vectorDimensions: 3,
      embed: async (text: string) => getEmbedding(text),
      createUid: () => crypto.randomUUID(),
    });

    await workingMemory.addSemanticMemory(
      "What is Redis?",
      "Redis is an in-memory data store.",
    );

    const updates: Array<{ content: string; role?: "user" | "assistant" }> = [];

    await chats.newChatMessage(
      (message) => {
        updates.push({
          content: message.content,
          role: message.role,
        });
      },
      {
        botChatId: "bot-semantic",
        userId: "user-semantic",
        message: "What is Redis?",
      },
    );

    expect(ragAnswerMock).not.toHaveBeenCalled();
    expect(
      updates.some(
        (message) => message.content === "Redis is an in-memory data store.",
      ),
    ).toBeTrue();
  });

  test("falls back to document search when semantic memory misses", async () => {
    await documents.createMany("user-doc-fallback", "project-fallback", [
      {
        url: "https://example.com/search",
        content: "# Search\nRedis Search powers vector search.",
      },
    ]);

    const updates: Array<{ content: string; role?: "user" | "assistant" }> = [];

    await chats.newChatMessage(
      (message) => {
        updates.push({
          content: message.content,
          role: message.role,
        });
      },
      {
        botChatId: "bot-docs",
        userId: "user-doc-fallback",
        message: "Tell me about Redis Search",
      },
    );

    expect(ragAnswerMock).toHaveBeenCalledTimes(1);
    expect(storeSemanticMock).toHaveBeenCalledTimes(1);
    expect(
      updates.some(
        (message) =>
          message.content === "Redis Search powers the fallback answer.",
      ),
    ).toBeTrue();
  });
});
