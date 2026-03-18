import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModelV2, EmbeddingModelV2 } from "@ai-sdk/provider";
import { embed } from "ai";
import config from "../../config";

export interface LlmConfig {
  largeModel: LanguageModelV2;
  mediumModel: LanguageModelV2;
  smallModel: LanguageModelV2;
  embeddings: EmbeddingModelV2<string>;
  dimensions: number;
}

interface TestEmbeddingConfig {
  dimensions: number;
  embedText(text: string): Promise<number[]>;
}

/**
 * Returns whether a model provider is configured.
 */
export function hasConfiguredLlm(): boolean {
  return Boolean(
    config.anthropic.API_KEY ||
      config.openai.API_KEY ||
      config.google.CREDENTIALS,
  );
}

/**
 * Creates the configured LLM based on the environment settings.
 */
function createLlm(): LlmConfig {
  let largeModel: LanguageModelV2 | null = null;
  let mediumModel: LanguageModelV2 | null = null;
  let smallModel: LanguageModelV2 | null = null;
  let embeddings: EmbeddingModelV2<string> | null = null;
  let dimensions: number | null = null;

  if (config.anthropic.API_KEY && config.anthropic.API_KEY.length > 0) {
    largeModel = createAnthropic({ apiKey: config.anthropic.API_KEY })(
      config.anthropic.LARGE_CHAT_MODEL,
    );
    mediumModel = createAnthropic({ apiKey: config.anthropic.API_KEY })(
      config.anthropic.MEDIUM_CHAT_MODEL,
    );
    smallModel = createAnthropic({ apiKey: config.anthropic.API_KEY })(
      config.anthropic.SMALL_CHAT_MODEL,
    );
  }

  if (config.openai.API_KEY && config.openai.API_KEY.length > 0) {
    const openai = createOpenAI({
      apiKey: config.openai.API_KEY,
    });

    embeddings = embeddings ?? openai.embedding(config.openai.EMBEDDINGS_MODEL);
    dimensions = dimensions ?? config.openai.EMBEDDINGS_DIMENSIONS;
    largeModel = largeModel ?? openai(config.openai.LARGE_CHAT_MODEL);
    mediumModel = mediumModel ?? openai(config.openai.MEDIUM_CHAT_MODEL);
    smallModel = smallModel ?? openai(config.openai.SMALL_CHAT_MODEL);
  }

  if (config.google.CREDENTIALS && config.google.CREDENTIALS.length > 0) {
    const vertex = createVertex({
      project: config.google.PROJECT_ID,
      location: config.google.LOCATION,
      googleAuthOptions: {
        credentials: JSON.parse(config.google.CREDENTIALS),
      },
    });

    embeddings =
      embeddings ?? vertex.textEmbeddingModel(config.google.EMBEDDINGS_MODEL);
    dimensions = dimensions ?? config.google.EMBEDDINGS_DIMENSIONS;
    largeModel = largeModel ?? vertex(config.google.LARGE_CHAT_MODEL);
    mediumModel = mediumModel ?? vertex(config.google.MEDIUM_CHAT_MODEL);
    smallModel = smallModel ?? vertex(config.google.SMALL_CHAT_MODEL);
  }

  if (!(largeModel && mediumModel && smallModel && embeddings && dimensions)) {
    throw new Error(
      "No LLM configured. Please set the appropriate environment variables for Anthropic, OpenAI, or Google Vertex AI.",
    );
  }

  return {
    largeModel,
    mediumModel,
    smallModel,
    embeddings,
    dimensions,
  };
}

let llmCache: LlmConfig | undefined;
let testEmbeddingConfig: TestEmbeddingConfig | undefined;

/**
 * Returns the configured LLM when a model-backed code path is executed.
 */
export function getLlm(): LlmConfig {
  if (!llmCache) {
    llmCache = createLlm();
  }

  return llmCache;
}

/**
 * Allows tests to bypass live embedding providers.
 */
export function setTestEmbeddingConfig(config?: TestEmbeddingConfig) {
  testEmbeddingConfig = config;
}

/**
 * Returns the active embedding dimension count.
 */
export function getEmbeddingDimensions(): number {
  return testEmbeddingConfig?.dimensions ?? getLlm().dimensions;
}

/**
 * Generates an embedding for the provided text using the configured LLM embeddings model.
 */
export async function embedText(text: string): Promise<number[]> {
  if (testEmbeddingConfig) {
    return testEmbeddingConfig.embedText(text);
  }

  const { embedding } = await embed({
    model: getLlm().embeddings,
    value: text,
  });

  return embedding;
}
