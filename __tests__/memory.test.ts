import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { ctrl as documents } from "../server/components/documents";
import { ctrl as projects } from "../server/components/projects";
import {
  LongTermMemoryModel,
  SemanticMemoryModel,
  ShortTermMemoryModel,
  WorkingMemoryModel,
} from "../server/components/memory";
import { setTestEmbeddingConfig } from "../server/services/ai/ai";
import { flushTestData, getTestRedis } from "./helpers/redis";

const VECTOR_LOOKUP: Record<string, number[]> = {
  "Hello, world!": [0, 0, 0],
  "What is Redis?": [1, 0, 0],
  "Redis stores docs fast.": [1, 0, 0],
  "Redis search reference": [1, 0, 0],
  "Markdown editing preferences": [0, 1, 0],
  "Use sentence case headings.": [0, 1, 0],
  "chat-summary": [0, 0, 1],
  "We updated the getting started page.": [0, 0, 1],
  "redis docs": [1, 0, 0],
  "# Redis\nRedis stores docs fast.": [1, 0, 0],
  "# Search\nRedis Search powers vector search.": [1, 0, 0],
};

function getEmbedding(text: string): number[] {
  return VECTOR_LOOKUP[text] ?? [0.5, 0.5, 0.5];
}

describe("Redis-backed models", () => {
  beforeEach(async () => {
    setTestEmbeddingConfig({
      dimensions: 3,
      embedText: async (text: string) => getEmbedding(text),
    });
    await flushTestData();
  });

  afterAll(async () => {
    setTestEmbeddingConfig();
    await flushTestData();
  });

  test("ShortTermMemoryModel stores and clears chat history", async () => {
    const redis = await getTestRedis();
    const chat = await ShortTermMemoryModel.New(redis, "user-short");

    await chat.push({
      role: "user",
      content: "Hello",
    });
    await chat.push({
      role: "assistant",
      content: "Hi there!",
    });

    const messages = await chat.memories();

    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe("Hello");
    expect(messages[1]?.content).toBe("Hi there!");

    await chat.clear();
    expect(await chat.memories()).toHaveLength(0);
  });

  test("SemanticMemoryModel update keeps the stored id searchable", async () => {
    const redis = await getTestRedis();
    const semanticMemory = await SemanticMemoryModel.New(redis, {
      vectorDimensions: 3,
      embed: async (text: string) => getEmbedding(text),
      createUid: () => "semantic-entry",
    });

    const id = await semanticMemory.add("What is Redis?", "Initial answer");
    await semanticMemory.update(id, "What is Redis?", "Updated answer");

    const results = await semanticMemory.search("What is Redis?");

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("semantic-entry");
    expect(results[0]?.answer).toBe("Updated answer");
  });

  test("WorkingMemoryModel merges semantic, episodic, and long-term memory", async () => {
    const redis = await getTestRedis();
    const workingMemory = await WorkingMemoryModel.New(redis, "user-memory", {
      vectorDimensions: 3,
      embed: async (text: string) => getEmbedding(text),
      createUid: () => crypto.randomUUID(),
      topK: 5,
      distanceThreshold: 0.5,
    });

    await workingMemory.addSemanticMemory(
      "What is Redis?",
      "Redis stores docs fast.",
    );
    await workingMemory.addLongTermMemory(
      "Markdown editing preferences",
      "Use sentence case headings.",
    );
    await workingMemory.addEpisodicMemory(
      "chat-summary",
      "We updated the getting started page.",
    );

    const semanticResults = await workingMemory.search("What is Redis?");
    const longTermResults = await workingMemory.search(
      "Markdown editing preferences",
    );
    const episodicResults = await workingMemory.search("chat-summary");

    expect(
      semanticResults.some((entry) => entry.type === "semantic"),
    ).toBeTrue();
    expect(
      longTermResults.some((entry) => entry.type === "long-term"),
    ).toBeTrue();
    expect(
      episodicResults.some((entry) => entry.type === "episodic"),
    ).toBeTrue();
  });

  test("Projects controller creates, updates, and reads project metadata", async () => {
    const userId = "user-projects";
    await projects.initialize();

    const project = await projects.create(userId);
    await projects.update(
      userId,
      project.projectId,
      "Redis document agent",
      "Load bundled docs into Redis.",
    );

    const reloaded = await projects.read(userId, project.projectId);
    const allProjects = await projects.all(userId);

    expect(reloaded.title).toBe("Redis document agent");
    expect(reloaded.prompt).toBe("Load bundled docs into Redis.");
    expect(allProjects).toHaveLength(1);
  });

  test("Documents controller indexes bundled docs for vector search", async () => {
    const userId = "user-docs";
    const projectId = "project-docs";

    await documents.initialize();
    const created = await documents.createMany(userId, projectId, [
      {
        url: "https://example.com/redis",
        content: "# Redis\nRedis stores docs fast.",
      },
      {
        url: "https://example.com/search",
        content: "# Search\nRedis Search powers vector search.",
      },
    ]);

    const chunks = await documents.searchChunks(userId, "redis docs");
    const results = await documents.search(userId, projectId, "redis docs");

    expect(created).toHaveLength(2);
    expect(chunks.length).toBeGreaterThan(0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.url).toContain("https://example.com/");
  });
});
