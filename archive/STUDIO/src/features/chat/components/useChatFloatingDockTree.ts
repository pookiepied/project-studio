import { useMemo } from "react";
import type { ProjectEntry } from "@/core/projects";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";

export function normPath(path?: string | null): string {
  return path?.trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase() ?? "";
}

interface ProjectGroup {
  project?: ProjectEntry;
  name: string;
  path: string;
  conversations: ConversationMetadata[];
}

interface UseChatFloatingDockTreeOptions {
  conversations: ConversationMetadata[];
  projects: ProjectEntry[];
  query: string;
  isSearching: boolean;
}

export function useChatFloatingDockTree({
  conversations,
  projects,
  query,
  isSearching,
}: UseChatFloatingDockTreeOptions) {
  const treeData = useMemo(() => {
    const q = query.trim().toLowerCase();
    let convs = conversations;
    if (q) {
      convs = conversations.filter((conversation) =>
        `${conversation.title} ${conversation.projectName ?? ""} ${conversation.storageScope ?? ""}`
          .toLowerCase()
          .includes(q),
      );
    }

    const byProject = new Map<string, ProjectGroup>();
    const loose: ConversationMetadata[] = [];

    if (!isSearching) {
      for (const project of projects) {
        const key = normPath(project.path);
        if (!byProject.has(key)) {
          byProject.set(key, {
            project,
            name: project.name,
            path: project.path,
            conversations: [],
          });
        }
      }
    }

    for (const conversation of convs) {
      const key = normPath(conversation.projectPath);
      if (key) {
        let group = byProject.get(key);
        if (!group) {
          group = {
            name: conversation.projectName ?? conversation.projectPath ?? "Project",
            path: conversation.projectPath!,
            conversations: [],
          };
          byProject.set(key, group);
        }
        group.conversations.push(conversation);
      } else {
        loose.push(conversation);
      }
    }

    for (const group of byProject.values()) {
      group.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    loose.sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      loose,
      projectList: Array.from(byProject.values()),
    };
  }, [conversations, projects, query, isSearching]);

  const allMatchingConversations = useMemo(() => {
    if (!isSearching) return [];
    return [
      ...treeData.loose,
      ...treeData.projectList.flatMap((group) => group.conversations),
    ];
  }, [treeData, isSearching]);

  return { treeData, allMatchingConversations };
}
