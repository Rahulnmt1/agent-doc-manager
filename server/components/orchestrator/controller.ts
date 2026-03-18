import logger from "../../utils/log";
import { embedText, getEmbeddingDimensions } from "../../services/ai/ai";
import config from "../../config";
import getClient from "../../redis";
import { WorkingMemoryModel } from "../memory";
import { randomUlid } from "../../utils/uid";
import { ctrl as parser } from "../parser";
import { ctrl as crawler } from "../crawl";
import { ctrl as documents } from "../documents";
import { ctrl as projects } from "../projects";
import { ctrl as chats } from "../chats";
import * as view from "./view";
import type { Document } from "../documents";

async function getWorkingMemory(userId: string) {
  const redis = await getClient();

  return WorkingMemoryModel.New(redis, userId, {
    createUid: randomUlid,
    vectorDimensions: getEmbeddingDimensions(),
    embed: embedText,
    ttl: config.redis.DEFAULT_TTL,
  });
}

/**
 * Initializes the chat by sending all previous messages to the WebSocket client.
 */
export async function initializeProjects(
  send: (message: string) => void,
  userId: string,
  currentProjectId?: string,
) {
  try {
    logger.debug(`Initializing projects for user \`${userId}\``, {
      userId,
    });

    const allProjects = await projects.all(userId);

    if (!currentProjectId && allProjects.length > 0) {
      currentProjectId = allProjects[0].projectId;
    }

    send(
      view.renderProjects({
        projects: allProjects,
        currentProjectId,
      }),
    );

    if (currentProjectId) {
      try {
        await projects.read(userId, currentProjectId);
      } catch (error) {
        return undefined;
      }

      await switchProject(send, userId, currentProjectId);
    }

    return currentProjectId;
  } catch (error) {
    logger.error(`Failed to initialize project for user \`${userId}\`:`, {
      error,
      userId,
    });
  }
}

export async function newProject(
  send: (message: string) => void,
  userId: string,
) {
  try {
    logger.debug(`Creating new project for user \`${userId}\``, {
      userId,
    });

    const project = await projects.create(userId);

    const allProjects = await projects.all(userId);

    send(
      view.renderProjects({
        projects: allProjects,
        currentProjectId: project.projectId,
      }),
    );

    send(
      view.renderInstructions({
        instructions:
          "Add a title and a working brief. In local demo mode, the app loads bundled docs into Redis so you can start exploring right away.",
      }),
    );

    send(view.renderNewProjectForm(project));

    return project.projectId;
  } catch (error) {
    logger.error(`Failed to create new project for user \`${userId}\`:`, {
      error,
      userId,
    });
    throw error;
  }
}

export async function switchProject(
  send: (message: string) => void,
  userId: string,
  projectId: string,
) {
  const project = await projects.read(userId, projectId);

  if (!project) {
    logger.warn(`Project not found: ${projectId}`, {
      userId,
      projectId,
    });
    return;
  }

  const allProjects = await projects.all(userId);

  send(
    view.renderProjects({
      projects: allProjects,
      currentProjectId: project.projectId,
    }),
  );

  const docs = await documents.all(userId, projectId);

  if (docs.length === 0) {
    send(
      view.renderInstructions({
        instructions:
          "Add a title and a working brief. In local demo mode, the app loads bundled docs into Redis so you can start exploring right away.",
      }),
    );

    send(view.renderNewProjectForm(project));
  } else {
    send(
      view.renderDocumentsList({
        documents: docs,
      }),
    );
  }

  return project.projectId;
}

export async function startProject(
  send: (message: string) => void,
  userId: string,
  projectId: string,
  title: string,
  prompt: string,
) {
  send(
    view.renderInstructions({
      instructions: "Loading your Redis document workspace...",
      progress: true,
    }),
  );

  send(view.renderNewProjectForm());
  await projects.update(userId, projectId, title, prompt);

  const allProjects = await projects.all(userId);
  send(
    view.renderProjects({
      projects: allProjects,
      currentProjectId: projectId,
    }),
  );

  await crawlPages(send, userId, projectId, prompt);

  const workingMemory = await getWorkingMemory(userId);
  const editMemories = await workingMemory.search(
    "Markdown editing preferences",
  );

  if (editMemories.length > 0 && editMemories[0].type === "long-term") {
    logger.info(
      `Insight: Identified long-term memory, "Markdown editing preferences"`,
      {
        userId,
      },
    );
    send(
      view.renderPopupForm({
        show: true,
        label: "💡 Insight: Apply your markdown editing preferences?",
        cmd: "documents/confirm",
        content: editMemories[0].answer,
      }),
    );
  }
  send(
    view.renderInstructions({
      instructions: "",
      progress: false,
    }),
  );
}

export async function crawlPages(
  send: (message: string) => void,
  userId: string,
  projectId: string,
  prompt: string,
) {
  const { url, instructions } = await parser.extractUrlAndInstructions(prompt);

  let docs: Document[] = [];
  if (config.crawl.SOURCE === "local" || (url && instructions)) {
    logger.info(`Extracted instructions=[${instructions}] and url=[${url}]`, {
      userId,
    });

    docs = await crawler.crawlUrl(
      userId,
      projectId,
      url ?? "",
      instructions ?? "",
    );

    docs.sort((a, b) => a.url.localeCompare(b.url));

    logger.debug(`Crawl tool result: ${docs.length} URLs found`, {
      userId,
      projectId,
    });
  } else {
    logger.warn(`No URL provided for crawl_pages command`, {
      userId,
      projectId,
    });
  }

  send(
    view.renderDocumentsList({
      documents: docs,
    }),
  );
}

export async function openDocument(
  send: (message: string) => void,
  userId: string,
  projectId: string,
  documentId: string,
  editing: boolean,
) {
  const doc = await documents.read(userId, documentId);

  if (!doc) {
    logger.warn(`Document not found: ${documentId}`, {
      userId,
      documentId,
    });
    return;
  }

  logger.debug(`Enabling edit mode for document \`${documentId}\``, {
    userId,
    documentId,
  });

  send(
    view.renderDocument({
      ...doc,
      selected: true,
      editing,
    }),
  );
}

export async function closeDocument(
  send: (message: string) => void,
  userId: string,
  projectId: string,
  documentId: string,
  editing: boolean,
) {
  const doc = await documents.read(userId, documentId);

  if (!doc) {
    logger.warn(`Document not found: ${documentId}`, {
      userId,
      documentId,
    });
    return;
  }

  logger.debug(`Disabling edit mode for document \`${documentId}\``, {
    userId,
    documentId,
  });

  send(
    view.renderDocument({
      ...doc,
      selected: false,
      editing,
    }),
  );
}

export async function diffDocument(
  send: (message: string) => void,
  userId: string,
  projectId: string,
  documentId: string,
  newContent: string,
) {
  send(
    view.renderInstructions({
      instructions:
        "Synthesizing the changes you made and how they can be applied to other documents...",
      progress: true,
    }),
  );

  const { actions } = await documents.diff(userId, documentId, newContent);

  logger.debug(`Generated diff for document \`${documentId}\``, {
    userId,
    documentId,
    actions,
  });

  send(
    view.renderInstructions({
      instructions: "",
      progress: false,
    }),
  );

  send(
    view.renderPopupForm({
      show: true,
      id: documentId,
      label:
        "🛠️ Changes synthesized! Apply to the rest of this document or all documents?",
      cmd: "documents/confirm",
      content: actions.join("\n\n"),
    }),
  );
}

export async function confirmChanges(
  send: (message: string) => void,
  userId: string,
  projectId: string,
  documentId: string,
  actions: string,
  action: "apply_all" | "apply" | "cancel",
) {
  send(
    view.renderPopupForm({
      show: false,
      label: "",
      cmd: "",
      content: "",
    }),
  );

  send(
    view.renderInstructions({
      instructions: "Processing your request...",
      progress: true,
    }),
  );

  if (action === "cancel") {
    logger.debug(`User cancelled changes`, {
      userId,
    });

    if (!documentId) {
      send(
        view.renderInstructions({
          instructions: "",
          progress: false,
        }),
      );
      return;
    }

    const doc = await documents.read(userId, documentId);

    if (doc) {
      send(
        view.renderDocument({
          ...doc!,
          selected: false,
        }),
      );
    }

    send(
      view.renderInstructions({
        instructions: "",
        progress: false,
      }),
    );
    return;
  }

  const workingMemory = await getWorkingMemory(userId);
  const existingMemory = (
    await workingMemory.search("Markdown editing preferences")
  )[0];

  if (existingMemory && existingMemory.type === "long-term") {
    logger.info(
      `Merging existing long-term memory, "Markdown editing preferences" with approved actions.`,
      {
        userId,
      },
    );
    let mergedMemory = await parser.mergeText([existingMemory.answer, actions]);

    await workingMemory.updateLongTermMemory(
      existingMemory.id,
      "Markdown editing preferences",
      mergedMemory,
    );
    logger.debug(`Updated working memory with new editing preferences`, {
      userId,
      documentId,
    });
  } else {
    logger.info(
      `Adding new long-term memory, "Markdown editing preferences" with approved actions.`,
      {
        userId,
      },
    );

    await workingMemory.addLongTermMemory(
      "Markdown editing preferences",
      actions,
    );
  }

  send(
    view.renderInstructions({
      instructions:
        action === "apply_all"
          ? "Applying changes to all documents..."
          : "Applying changes to the current document...",
      progress: true,
    }),
  );

  const allDocs = await documents.all(userId, projectId);

  if (action === "apply_all") {
    send(
      view.renderDocumentsList({
        documents: allDocs.map((doc) => {
          return {
            ...doc,
            selected: false,
            editing: true,
          };
        }),
      }),
    );

    logger.info(`Applying actions to ${allDocs.length} documents.`, {
      userId,
    });

    await documents.applyToAll(
      (document) => {
        logger.debug(`Applied changes to document \`${document.id}\``, {
          userId,
        });

        send(
          view.renderDocument({
            ...document,
            editing: false,
          }),
        );
      },
      userId,
      projectId,
      actions,
    );
  } else if (action === "apply") {
    const doc = await documents.read(userId, documentId);

    send(
      view.renderDocument({
        ...doc!,
        selected: false,
        editing: true,
      }),
    );

    logger.info(`Applying actions to one document`, {
      userId,
    });
    await documents.applyToOne(userId, documentId, actions);
  } else {
    logger.warn(`Document not found: ${documentId}`, {
      userId,
      documentId,
    });
  }

  send(
    view.renderDocumentsList({
      documents: allDocs,
    }),
  );

  send(
    view.renderInstructions({
      instructions: "",
      progress: false,
    }),
  );
}

/**
 * Clears all messages for a given user.
 */
export async function clearChat(
  send: (message: string) => void,
  userId: string,
  chatId: string,
) {
  try {
    logger.debug(`Clearing messages for user \`${userId}\``, {
      userId: userId,
    });

    await chats.clearChat(userId, chatId);
    send(view.clearMessages());
  } catch (error) {
    logger.error(`Failed to delete messages for user ${userId}:`, {
      error,
      userId: userId,
    });
    throw error;
  }
}

/**
 * Handles incoming chat messages from the client.
 */
export async function newChatMessage(
  send: (message: string) => void,
  info: { userId: string; chatId?: string; message: string },
): Promise<string | undefined> {
  const botChatId = `bot-${randomUlid()}`;

  try {
    return chats.newChatMessage(
      (message: {
        replaceId?: string;
        id: string;
        content: string;
        role?: "user" | "assistant";
      }) => {
        send(view.renderMessage(message));
      },
      {
        ...info,
        botChatId,
      },
    );
  } catch (error) {
    logger.error(`Error handling message:`, {
      error,
      userId: info.userId,
    });

    send(
      view.renderMessage({
        id: botChatId,
        content: "An error occurred while processing your message.",
        role: "assistant",
      }),
    );
  }
}

/**
 * Creates a new chat user.
 */
export async function newChat(
  send: (message: string) => void,
  userId: string,
): Promise<string> {
  try {
    logger.debug(`Creating new chat for user \`${userId}\``, {
      userId,
    });
    const newChatId = await chats.newChat(userId);
    const allChats = await chats.getChatsWithTopMessage(userId);

    send(
      view.renderChats({
        chats: allChats,
        currentChatId: newChatId,
      }),
    );

    send(
      view.clearMessages({
        placeholder: true,
      }),
    );

    return newChatId;
  } catch (error) {
    logger.error(`Failed to create new chat for user \`${userId}\`:`, {
      error,
      userId,
    });
    throw error;
  }
}

/**
 * Switches the current chat user to a different chat.
 */
export async function switchChat(
  send: (message: string) => void,
  userId: string,
  chatId: string,
) {
  try {
    logger.debug(`Switching to chat \`${chatId}\` for user \`${userId}\``, {
      userId,
    });

    send(
      view.renderChats({
        chats: await chats.getChatsWithTopMessage(userId),
        currentChatId: chatId,
      }),
    );

    const chat = await chats.getChatSession(userId, chatId);
    const memories = await chat.memories();

    send(
      view.clearMessages({
        placeholder: memories.length === 0,
      }),
    );

    for (const memory of memories) {
      send(view.renderMessage(memory));
    }
  } catch (error) {
    logger.error(`Failed to switch chat for user \`${userId}\`:`, {
      error,
      userId,
    });
    throw error;
  }
}

/**
 * Initializes the chat by sending all previous messages to the WebSocket client.
 */
export async function initializeChat(
  send: (message: string) => void,
  userId: string,
  chatId?: string,
) {
  try {
    logger.debug(`Initializing chat for user \`${userId}\``, {
      userId,
    });

    if (!chatId) {
      const allChats = await chats.getChatsWithTopMessage(userId);

      if (allChats.length === 0) {
        chatId = await chats.newChat(userId);
      } else {
        chatId = allChats[0].chatId;
      }
    }

    await switchChat(send, userId, chatId);

    return chatId;
  } catch (error) {
    logger.error(`Failed to initialize chat for user \`${userId}\`:`, {
      error,
      userId,
    });
  }
}

/**
 * Clears the entire store.
 */
export async function clearProjects(
  send: (message: string) => void,
  userId: string,
) {
  try {
    logger.debug("Clearing Redis", {
      userId,
    });

    await projects.removeAllForUser(userId);
    await documents.removeAllForUser(userId);
  } catch (error) {
    logger.error("Failed to clear memory:", {
      error,
      userId,
    });
    throw error;
  }
}

/**
 * Clears the entire store.
 */
export async function clearMemory(
  send: (message: string) => void,
  userId: string,
) {
  try {
    logger.debug("Clearing Redis", {
      userId,
    });

    const db = await getClient();
    const allKeys = await db.keys(`users:u${userId}:*`);

    if (Array.isArray(allKeys) && allKeys.length > 0) {
      await db.del(allKeys);
    }

    await projects.removeAllForUser(userId);
    await documents.removeAllForUser(userId);
    // const allKeys = await db.keys("users:*");
    // const sessions = await db.keys("session:*");
    // const semantic = await db.keys("semantic-memory:*");
    // const chunks = await db.keys("document-chunks:*");
    // const docs = await db.keys("documents:*");
    // const allProjects = await dFb.keys("projects:*");

    // allKeys.push("ERROR_STREAM", "LOG_STREAM");

    // if (Array.isArray(allProjects) && allProjects.length > 0) {
    //   allKeys.push(...allProjects);
    // }

    // if (Array.isArray(sessions) && sessions.length > 0) {
    //   allKeys.push(...sessions);
    // }

    // if (Array.isArray(docs) && docs.length > 0) {
    //   allKeys.push(...docs);
    // }

    // if (Array.isArray(chunks) && chunks.length > 0) {
    //   allKeys.push(...chunks);
    // }

    // if (Array.isArray(semantic) && semantic.length > 0) {
    //   allKeys.push(...semantic);
    // }

    // if (Array.isArray(allKeys) && allKeys.length > 0) {
    //   await db.del(allKeys);
    // }

    // const indexes = await db.ft._list();

    // await Promise.all(
    //   indexes
    //     .filter((index) => {
    //       return (
    //         index.includes("users") ||
    //         index.includes("semantic-memory") ||
    //         index.includes("projects") ||
    //         index.includes("documents") ||
    //         index.includes("document-chunks")
    //       );
    //     })
    //     .map(async (index) => {
    //       await db.ft.dropIndex(index);
    //     }),
    // );

    // await projects.initialize();
    // await documents.initialize();
  } catch (error) {
    logger.error("Failed to clear memory:", {
      error,
      userId,
    });
    throw error;
  }
}
