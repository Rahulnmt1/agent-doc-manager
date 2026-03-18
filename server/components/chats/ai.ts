import { generateText, stepCountIs } from "ai";
import type { Tool } from "ai";
import { getLlm } from "../../services/ai/ai";
import type { ShortTermMemory, Tools } from "../../components/memory";
import type { Command } from "../parser";
import type { DocumentChunk } from "../documents";
import { addSemanticMemoryToolInput } from "../memory/tools";

export async function answerPrompt(
  messages: ShortTermMemory[],
  tools: Tools,
): Promise<string> {
  const llm = getLlm();
  const { addMemoryTool, searchTool, updateMemoryTool } = tools.getTools();

  const response = await generateText({
    model: llm.largeModel,
    messages: [
      {
        role: "system",
        content: `
            Answer the latest user question to the best of your ability. The following tools are available to you:
            - Call the \`${searchTool.name}\` tool if you need to search user memory for relevant information.
                - Appropriate times to use the \`${searchTool.name}\` tool include:
                    - If you cannot answer the prompt without information that is based on the user's past interactions.
                    - If the user has asked a prompt that requires context from previous interactions.
                    - If are unable to answer the prompt based on the current context, but you think the answer could exist in memory.
                - Types of user memory include:
                    - **long-term**: Contains relevant information about the user such as their preferences and settings.
                    - **semantic**: Contains general knowledge that is relevant to all users such as, "Why is the sky blue?".
                    - **episodic**: Contains summaries of past interactions with the user.
                - Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
            - Call the \`${addMemoryTool.name}\` to add a memory that you might want to lookup later based on the prompt. The memory can be stored in:
                - **long-term**: If the memory is relevant to the user and can help in future interactions across different sessions.
                - **semantic**: If the memory is relevant to all users and can help in future interactions across all sessions.
                - Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
                - Don't translate pronouns when answering the question, only when storing in memory.
            - Call the \`${updateMemoryTool.name}\` to update an existing memory obtained from \`${searchTool.name}\` with a new value. The memory can be stored in:
                - **long-term**: If the memory is relevant to the user and can help in future interactions across different sessions.
                - **semantic**: If the memory is general knowledge relevant to anyone and can help in future interactions. You _must_ use semantic memory if possible.
                - Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
                - Don't translate pronouns when answering the question, only when storing in memory.

            - When answering the prompt, if you have obtained relevant information from memory using the \`${searchTool.name}\` tool, use that information to construct your answer.
            - Make sure you add any relevant information from the prompt to either "semantic" or "long-term" memory using the \`${addMemoryTool.name}\` tool so that you can lookup that information in future interactions.
            - Only add memories based on the latest message, do not add memories for prior messages.
          `,
      },
      ...messages,
    ],
    tools: {
      [searchTool.name]: searchTool,
      [addMemoryTool.name]: addMemoryTool,
      [updateMemoryTool.name]: updateMemoryTool,
    },
    stopWhen: [stepCountIs(10)],
  });

  return response.text;
}

export async function answerQuestionWithRag(
  session: ShortTermMemory[],
  documentChunks: DocumentChunk[],
  documentChunkSearchTool: Tool & { name: string },
) {
  const llm = getLlm();
  const response = await generateText({
    model: llm.largeModel,
    messages: [
      {
        role: "system",
        content: `
        You are an assistant that can answer questions based on information provided from the following documents:

        Use the information from the following documents to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.

        Tools:
        - Call the \`${documentChunkSearchTool.name}\` tool if you need to search the document database for relevant information.
            - Appropriate times to use the \`${documentChunkSearchTool.name}\` tool include:
                - If you cannot answer the prompt without additional information.
                - If are unable to answer the prompt based on the current context, but you think the answer could exist in the document database.
                - Based on the user's latest prompt there might not have been enough context to pull all the documents

        Document Chunks:
        - The following document chunks might be helpful for you
        ${documentChunks.map((chunk) => `\`\`\`md\n${chunk.content}\n\`\`\``).join("\n\n")}
        `,
      },
      ...session,
    ],
    tools: {
      [documentChunkSearchTool.name]: documentChunkSearchTool,
    },
    stopWhen: [stepCountIs(10)],
  });

  if (!response.text) {
    throw new Error("No response from AI");
  }

  return response.text;
}

export async function storeSemanticMemories(
  query: string,
  response: string,
  tools: Tools,
) {
  const llm = getLlm();
  const { addSemanticMemoryTool } = tools.getTools();

  await generateText({
    model: llm.mediumModel,
    system: `
      You are an AI assistant that creates memory entries to store in semantic memory.
      Create memory entries based on the following criteria:
      - The memory should be relevant to all users, not just a specific user.
      - The memory should be general knowledge that could help in future interactions with any user.
      - The memory should be concise and to the point.
      - The memory should not contain any personal information about the user.
      - The memory should be something that could be useful to remember in the future.

      - Call the \`${addSemanticMemoryTool.name}\` tool to store the memory.
      `,
    prompt: `
      INITIAL QUERY:
      ${query}

      RESPONSE:
      ${response}
      `,
    tools: {
      [addSemanticMemoryTool.name]: addSemanticMemoryTool,
    },
    stopWhen: [stepCountIs(5)],
  });
}
