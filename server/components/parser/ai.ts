import { z } from "zod";
import { getLlm } from "../../services/ai/ai";
import { generateObject, generateText } from "ai";
import { ShortTermMemory } from "../memory";

const CommandsEnumSchema = z.enum([
  "crawl_pages",
  "modify_text",
  "answer_question",
  "download_page",
  "none",
]);

export type CommandEnum = z.infer<typeof CommandsEnumSchema>;

const UrlAndInstructionsSchema = z.object({
  url: z.string().describe("The URL described in the prompt"),
  instructions: z.string().describe("The instructions described in the prompt"),
});

export type UrlAndInstructions = z.infer<typeof UrlAndInstructionsSchema>;

export async function getUrlAndInstructions(
  prompt: string,
): Promise<UrlAndInstructions> {
  const llm = getLlm();
  const response = await generateObject({
    model: llm.smallModel,
    messages: [
      {
        role: "system",
        content: `
          You are an AI assistant that extracts a URL and instructions from a user prompt.

          - The URL should be a valid URL starting with http:// or https://.
          - The instructions should be a concise summary of what to do with the URL.
          - If no URL is found, return an empty string for the URL and instructions.
          Examples:
          1. Prompt: "Find all tutorial pages from https://example.com/tutorials"
             Response: {
               "url": "https://example.com/tutorials",
               "instructions": "Find all tutorial pages."
             }

          2. Prompt: "Extract the main content from http://blog.example.com"
              Response: {
                "url": "http://blog.example.com",
                "instructions": "Extract the main content."
              }

          3. Prompt: "Hello, how are you today?"
              Response: {
                "url": "",
                "instructions": ""
              }
        `,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    schema: UrlAndInstructionsSchema,
  });

  return response.object;
}

const CommandSchema = z.object({
  command: CommandsEnumSchema.describe("The command to execute"),
  pageName: z
    .string()
    .optional()
    .describe("Name of the page to save or modify"),
  url: z.string().optional().describe("URL to extract pages from"),
  instructions: z
    .string()
    .optional()
    .describe("Instructions for extracting or modifying text"),
});

export type Command = z.infer<typeof CommandSchema>;

export async function getCommand(messages: ShortTermMemory[]) {
  const llm = getLlm();
  const response = await generateObject({
    model: llm.smallModel,
    messages: [
      {
        role: "system",
        content: `
          You are an AI assistant that converts a user prompt intent into an actionable command.

          - You do not take action on the command or instructions.
          - All you need to do is take the input messages, parse the latest message, and return the JSON according to the description below.

          The available commands are:
          - "crawl_pages": Extract pages from a given URL. Requires the "url" and "instructions" arguments.
          - "modify_text": Modify the text of an already extracted page. Requires the "pageName" and "instructions" arguments.
          - "answer_question": Answer a question based on the extracted pages. No additional arguments required.
          - "download_page": Download a specific page. Requires the "pageName" argument.
          - "none": No action is required. This is used when the prompt does not require any of the above commands.

          The arguments for each command are:
          - "url": The URL to extract pages from (string).
          - "pageName": The name of the page to modify (string).
          - "instructions": Instructions for modifying the extracted text (string).
              - Don't add anything to the instructions that isn't in the prompt.

          Examples:
          1. Prompt: "Find all tutorial pages from https://example.com/tutorials"
             Response: {
               "command": "crawl_pages",
               "url": "https://example.com/tutorials",
               "instructions": "Find all tutorial pages."
             }

          2. Prompt: "Update the introduction section of the 'Getting Started' page to include more details about installation."
             Response: {
               "command": "modify_text",
               "pageName": "Getting Started",
               "instructions": "Update the introduction section to include more details."
             }

          3. Prompt: "What are the main topics covered in the extracted tutorials?"
             Response: {
               "command": "answer_question"
             }

          4. Prompt: "I want to download all the pages we've extracted so far."
             Response: {
               "command": "download_pages"
             }

          5. Prompt: "Hello, how are you today?"
             Response: {
               "command": "none"
             }
        `,
      },
      ...messages,
    ],
    schema: CommandSchema,
  });

  return response.object;
}

export async function mergeText(text: string[]) {
  const llm = getLlm();
  const response = await generateText({
    model: llm.mediumModel,
    messages: [
      {
        role: "system",
        content: `
          You are an AI assistant that merges text.

          - The text is provided in chronological order, with the newest text last.
          - Ensure the merged text is coherent and maintains the original meaning.
          - If there are any contradictions between the texts, prioritize the newest text.
          - Preserve important details from both texts.
          - Maintain a consistent tone and style throughout the merged text.
          - Your output should only be the merged text, without any additional commentary or explanation.
        `,
      },
      {
        role: "user",
        content: `
          Please provide the merged text.
          Texts to merge:
          ${text.map((t, i) => `Text ${i + 1}:\n"""\n${t}\n"""`).join("\n\n")}
        `,
      },
    ],
  });

  return response.text;
}
