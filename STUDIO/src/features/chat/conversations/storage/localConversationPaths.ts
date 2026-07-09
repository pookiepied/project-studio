import {
  getStudioConversationHome,
  joinStudioPath,
} from "@/core/platform/studioPaths";

export async function getStudioConversationRoot(): Promise<string> {
  return getStudioConversationHome();
}

export async function getLocalConversationIndexPath(): Promise<string> {
  return joinStudioPath(await getStudioConversationRoot(), "index.json");
}

export async function getLocalConversationDir(id: string): Promise<string> {
  return joinStudioPath(await getStudioConversationRoot(), id);
}

export async function getLocalConversationSnapshotPath(id: string): Promise<string> {
  return joinStudioPath(await getLocalConversationDir(id), "conversation.json");
}

export async function getLocalConversationMessagesPath(id: string): Promise<string> {
  return joinStudioPath(await getLocalConversationDir(id), "messages.jsonl");
}

export async function getLocalConversationTranscriptPath(id: string): Promise<string> {
  return joinStudioPath(await getLocalConversationDir(id), "transcript.md");
}
