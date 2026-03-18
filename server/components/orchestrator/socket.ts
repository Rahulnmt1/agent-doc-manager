import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import type { Request } from "express";
import logger, { logWst } from "../../utils/log";
import expressSession from "express-session";
import { getSessionParser } from "../../utils/session";
import * as orchestrator from "./controller";
import { ctrl as projectsCtrl } from "../projects";
import { ctrl as documentsCtrl } from "../documents";

export const wss = new WebSocketServer({ noServer: true });

export type NewProjectForm = {
  cmd: "projects/new";
};

export type SwitchProjectForm = {
  cmd: "projects/switch";
  projectId: string;
};

export type StartProjectForm = {
  cmd: "projects/start";
  projectId: string;
  title: string;
  prompt: string;
};

export type OpenDocumentForm = {
  cmd: "projects/open";
  projectId: string;
  documentId: string;
  editing: "true" | "false";
};

export type CloseDocumentForm = {
  cmd: "projects/close";
  projectId: string;
  documentId: string;
  editing: "true" | "false";
};

export type DiffDocumentForm = {
  cmd: "documents/diff";
  projectId: string;
  documentId: string;
  content: string;
};

export type ConfirmChangesForm = {
  cmd: "documents/confirm";
  projectId: string;
  id: string;
  content: string;
  action: "apply_all" | "apply" | "cancel";
};

export type NewChatMessageForm = {
  cmd: "chats/messages/new";
  message: string;
};

export type NewChatForm = {
  cmd: "chats/new";
};

export type SwitchChatForm = {
  cmd: "chats/switch";
  chatId: string;
};

export type NewUserForm = {
  cmd: "users/new";
};

export type ClearProjectsForm = {
  cmd: "projects/clear";
};

export type ClearDataForm = {
  cmd: "data/clear";
};

export type OpenLogForm = {
  cmd: "logs/open";
};

export type CloseLogForm = {
  cmd: "logs/close";
};

export type MessageForm =
  | NewProjectForm
  | SwitchProjectForm
  | StartProjectForm
  | OpenDocumentForm
  | CloseDocumentForm
  | DiffDocumentForm
  | ConfirmChangesForm
  | NewChatMessageForm
  | NewChatForm
  | SwitchChatForm
  | NewUserForm
  | ClearProjectsForm
  | ClearDataForm;

export type AppSession = Pick<
  expressSession.Session & Partial<expressSession.SessionData>,
  "id" | "save" | "destroy"
> & {
  currentProjectId: string;
  currentChatId: string;
};

async function initialize() {
  await projectsCtrl.initialize();
  await documentsCtrl.initialize();
}

export async function onMessage(
  send: (message: string) => void,
  session: AppSession,
  form: MessageForm,
) {
  const userId = session.id;
  const { currentProjectId, currentChatId } = session;
  let newProjectId: string | undefined;
  let newChatId: string | undefined;

  switch (form.cmd) {
    case "projects/new":
      newProjectId = await orchestrator.newProject(send, userId);
      break;
    case "projects/switch":
      if (!form.projectId) {
        logger.warn("No projectId provided for projects/switch command", {
          userId,
        });
        return;
      }

      if (form.projectId === currentProjectId) {
        return;
      }

      newProjectId = await orchestrator.switchProject(
        send,
        userId,
        form.projectId,
      );
      break;
    case "projects/start":
      if (form.projectId !== currentProjectId) {
        logger.warn("Project ID mismatch", {
          userId,
          formProjectId: form.projectId,
          currentProjectId,
        });
        return;
      }

      const { projectId, title, prompt } = form;

      await orchestrator.startProject(send, userId, projectId, title, prompt);
      break;
    case "projects/open":
      await orchestrator.openDocument(
        send,
        userId,
        currentProjectId!,
        form.documentId,
        form.editing === "true",
      );
      break;
    case "projects/close":
      await orchestrator.closeDocument(
        send,
        userId,
        currentProjectId!,
        form.documentId,
        form.editing === "true",
      );
      break;
    case "documents/diff":
      await orchestrator.diffDocument(
        send,
        userId,
        currentProjectId!,
        form.documentId,
        form.content,
      );
      break;
    case "documents/confirm":
      await orchestrator.confirmChanges(
        send,
        userId,
        currentProjectId!,
        form.id,
        form.content,
        form.action,
      );
      break;
    case "chats/messages/new":
      newChatId = await orchestrator.newChatMessage(send, {
        userId,
        chatId: currentChatId,
        message: form.message,
      });

      break;
    case "chats/new":
      newChatId = await orchestrator.newChat(send, userId);

      break;
    case "chats/switch":
      if (!form.chatId) {
        logger.warn("No chatId provided for chats/switch command", {
          userId,
        });
        return;
      }

      if (form.chatId === currentChatId) {
        return;
      }

      newChatId = form.chatId;

      await orchestrator.switchChat(send, userId, form.chatId);
      break;
    case "users/new":
      await orchestrator.clearMemory(send, userId);

      logWst.removeUser(userId);
      session.destroy((err) => {
        if (err) {
          logger.error("Failed to regenerate session", { error: err });
          return;
        }
      });
      break;
    case "projects/clear":
      await orchestrator.clearProjects(send, userId);

      // @ts-ignore
      delete session.currentProjectId;
      session.save();
      break;
    case "data/clear":
      await orchestrator.clearMemory(send, userId);

      // @ts-ignore
      delete session.currentProjectId;
      session.save();

      // logWst.removeUser(userId);
      // session.destroy((err) => {
      //   if (err) {
      //     logger.error("Failed to regenerate session", { error: err });
      //     return;
      //   }
      // });
      break;
    default:
      logger.warn("Unknown command received", {
        cmd: (form as any).cmd,
        userId,
      });
      return;
  }

  if (typeof newProjectId === "string" && newProjectId !== currentProjectId) {
    session.currentProjectId = newProjectId;
    session.save();
  }

  if (typeof newChatId === "string" && newChatId !== currentChatId) {
    session.currentChatId = newChatId;
    session.save();
  }
}

export async function initializeSocket(
  send: (message: string) => void,
  type: "chat" | "projects",
  session: AppSession,
) {
  const userId = session.id;
  const currentProjectId = session.currentProjectId;
  const currentChatId = session.currentChatId;
  let newProjectId: string | undefined;
  let newChatId: string | undefined;

  switch (type) {
    case "projects":
      newProjectId = await orchestrator.initializeProjects(
        send,
        userId,
        currentProjectId,
      );

      if (!newProjectId) {
        // @ts-ignore
        delete session.currentProjectId;
        session.save();
      }

      break;
    case "chat":
      newChatId = await orchestrator.initializeChat(
        send,
        userId,
        currentChatId,
      );

      break;
    default:
      logger.warn("Unknown WebSocket type", { type, userId });
      return;
  }

  if (typeof newProjectId === "string" && newProjectId !== currentProjectId) {
    session.currentProjectId = newProjectId;
    session.save();
  }

  if (typeof newChatId === "string" && newChatId !== currentChatId) {
    session.currentChatId = newChatId;
    session.save();
  }
}

/**
 * Handles WebSocket connections and messages.
 */
async function onConnection(
  ws: WebSocket,
  req: Request,
  type: "chat" | "projects",
) {
  await initialize();
  const session = await getSessionParser();
  session(req, {} as any, async () => {
    await initialize();
    const userId = req.session.id;

    if (!userId) {
      return;
    }

    /**
     * Sends a response to the WebSocket client.
     */
    const send = (response: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(response);
      } else {
        logger.warn("WebSocket is not open, cannot send message", {
          userId: req.session.id,
        });
      }
    };

    logger.debug("Projects websocket connection established", {
      userId: req.session.id,
    });

    void initializeSocket(send, type, req.session as unknown as AppSession);
    ws.on("error", logger.error);
    ws.on("message", async (data: RawData) => {
      void onMessage(
        send,
        req.session as unknown as AppSession,
        JSON.parse(data.toString()) as MessageForm,
      );
    });
  });
}

wss.on("connection", onConnection);
