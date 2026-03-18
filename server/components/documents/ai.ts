import { z } from "zod";
import { getLlm } from "../../services/ai/ai";
import { generateObject } from "ai";

const ChunkedFileSchema = z.object({
  chunks: z.array(z.string()).describe("An array of content chunks"),
});

export type ChunkedFile = z.infer<typeof ChunkedFileSchema>;

export async function modifyContent(
  content: string,
  prompt: string,
  url: string,
) {
  const llm = getLlm();
  const ModificationSchema = z.object({
    modifiedContent: z.string(),
  });

  const response = await generateObject({
    model: llm.mediumModel,
    messages: [
      {
        role: "system",
        content: `
          You are an AI assistant that modifies markdown based on user instructions.
          You will respond with a JSON object containing the modified content.
          Given the original content and user instructions, you must always respond with a JSON object that matches the following schema:

          {
            "modifiedContent": "<the modified content>"
          }

          The modified content should reflect the user's instructions while preserving the original meaning as much as possible.

          If you are instructed to generate something using the URL, here is the URL: ${url}
        `,
      },
      {
        role: "user",
        content: `
          Original Content:
          """
          ${content}
          """

          Instructions:
          """
          ${prompt}
          """

          Please provide the modified content.
        `,
      },
    ],
    schema: ModificationSchema,
  });

  return response.object.modifiedContent;
}

export async function matchPromptToUrl(prompt: string, urls: string[]) {
  if (urls.length === 0) {
    return "";
  }

  const llm = getLlm();
  const UrlMatchSchema = z.object({
    matchedUrl: z
      .string()
      .describe("A single URL that matches the user's prompt"),
  });

  const response = await generateObject({
    model: llm.smallModel,
    messages: [
      {
        role: "system",
        content: `
          You are an AI assistant that matches user prompts to relevant URLs.
          You will respond with a JSON object containing an array of URLs that are relevant to the user's prompt.

          Only include the URL that is directly relevant to the user's prompt. If none are relevant, respond with an empty string.
        `,
      },
      {
        role: "user",
        content: `
          User Prompt:
          """
          ${prompt}
          """

          Available URLs:
          """
          ${urls.join("\n")}
          """

          Please provide the matched URL.
        `,
      },
    ],
    schema: UrlMatchSchema,
  });

  return response.object.matchedUrl;
}

export async function chunkFile(content: string, maxChunkSize: number = 1000) {
  const llm = getLlm();
  const response = await generateObject({
    model: llm.smallModel,
    messages: [
      {
        role: "system",
        content: `
          You are an AI assistant that breaks down markdown files into smaller chunks.
          Break down the markdown content based on natural sections, such as headings, lists, and paragraphs.

          The maximum size of each chunk should be ${maxChunkSize} characters.
          Ensure that chunks do not exceed this size, but try to keep them as large as possible without breaking the flow of the content.
        `,
      },
      {
        role: "user",
        content: `
          Original Content:
          """
          ${content}
          """

          Please provide the content broken down into smaller chunks.
        `,
      },
    ],
    schema: ChunkedFileSchema,
  });

  return response.object;
}

const DocumentDiffSchema = z.object({
  actions: z
    .array(z.string())
    .describe(
      "A list of generic actions to apply to other documents based on the changes made to this document",
    ),
});

export type DocumentDiff = z.infer<typeof DocumentDiffSchema>;

export async function getDiffSummary(
  oldText: string,
  newText: string,
  url: string,
) {
  const llm = getLlm();
  const response = await generateObject({
    model: llm.largeModel,
    messages: [
      {
        role: "system",
        content: `
        You are an AI assistant that summarizes the differences between two versions of a text document.

        The document has been modified slightly, and your job is to identify those modifications generically so they can be applied to severl other documents.

        Don't worry about the specific content, just focus on the types of changes made and similar actions that can be taken to edit other documents accordingly.

        If in the changes you notice text similar to "generate X from Y" this specifying an action.

        Examples of actions include:
        - "Add fenced code blocks for all code snippets and supply the language for the code blocks."
        - "Remove empty sections"
        - "Remove sections up to the first major heading (H1)."
        - "Convert inline code snippets to fenced code blocks."
        - "Make sure fenced code blocks have a language specified."
        - "Adjust fenced code blocks to not have line numbers."
        - "Remove outdated sections that are no longer relevant."

        For reference, the document is located at the following URL: ${url}
      `,
      },
      {
        role: "user",
        content: `
        Here is the old version of the text:
        """
        ${oldText}
        """

        Here is the new version of the text:
        """
        ${newText}
        """

        Please summarize the differences between these two versions.
      `,
      },
    ],
    schema: DocumentDiffSchema,
  });

  return response.object;
}
