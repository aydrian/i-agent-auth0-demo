import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { createDocument } from "./ai/tools/create-document";
import type { getWeather } from "./ai/tools/get-weather";
import type { gmailSearch } from "./ai/tools/gmail-search";
import type { requestSuggestions } from "./ai/tools/request-suggestions";
import type { updateDocument } from "./ai/tools/update-document";
import type { watchlistAdd } from "./ai/tools/watchlist-add";
import type { watchlistList } from "./ai/tools/watchlist-list";
import type { watchlistRemove } from "./ai/tools/watchlist-remove";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type gmailSearchTool = InferUITool<typeof gmailSearch>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type watchlistAddTool = InferUITool<ReturnType<typeof watchlistAdd>>;
type watchlistListTool = InferUITool<ReturnType<typeof watchlistList>>;
type watchlistRemoveTool = InferUITool<ReturnType<typeof watchlistRemove>>;

export type ChatTools = {
  getWeather: weatherTool;
  gmailSearch: gmailSearchTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  watchlistAdd: watchlistAddTool;
  watchlistList: watchlistListTool;
  watchlistRemove: watchlistRemoveTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
