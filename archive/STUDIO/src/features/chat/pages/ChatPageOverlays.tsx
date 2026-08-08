import type { ChangeEventHandler, RefObject } from "react";
import { ContextAutocomplete, type AppMention } from "@/features/chat/components/ContextAutocomplete";
import { RenameModal } from "@/features/chat/components/RenameModal";
import { DocumentStorageModal } from "@/features/artifacts";
import { ModelLibraryPanel } from "@/features/models";

const ACCEPTED_ATTACHMENT_TYPES =
  "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.markdown,.csv,.log,.json,.xml,.yaml,.yml,.toml,.html,.htm,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.c,.cpp,.cs,.rb,.php,.sh";

export function ChatPageOverlays({
  fileInputRef,
  onFileSelect,
  pendingFiles,
  isDocUploading,
  onConfirmDocUpload,
  onCancelDocUpload,
  libraryOpen,
  onCloseLibrary,
  onSelectModel,
  selectedModel,
  renameOpen,
  titleInput,
  onTitleChange,
  onSaveTitle,
  onCancelRename,
  atMentionVisible,
  closeAtMention,
  atMentionQuery,
  atMentionPos,
  availableApps,
  onSelectApp,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: ChangeEventHandler<HTMLInputElement>;
  pendingFiles: File[];
  isDocUploading: boolean;
  onConfirmDocUpload: (mode: boolean | null) => void;
  onCancelDocUpload: () => void;
  libraryOpen: boolean;
  onCloseLibrary: () => void;
  onSelectModel: (id: string) => void;
  selectedModel: string;
  renameOpen: boolean;
  titleInput: string;
  onTitleChange: (title: string) => void;
  onSaveTitle: () => void;
  onCancelRename: () => void;
  atMentionVisible: boolean;
  closeAtMention: () => void;
  atMentionQuery: string;
  atMentionPos: { x: number; y: number };
  availableApps: AppMention[];
  onSelectApp: (app: AppMention) => void;
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_ATTACHMENT_TYPES}
        onChange={onFileSelect}
        className="hidden"
      />

      <DocumentStorageModal
        files={pendingFiles}
        isOpen={pendingFiles.length > 0}
        isUploading={isDocUploading}
        onPermanent={() => onConfirmDocUpload(true)}
        onTemporary={() => onConfirmDocUpload(false)}
        onSkip={() => onConfirmDocUpload(null)}
        onCancel={onCancelDocUpload}
      />

      <ModelLibraryPanel
        isOpen={libraryOpen}
        onClose={onCloseLibrary}
        onSelectModel={onSelectModel}
        selectedModel={selectedModel}
      />

      <RenameModal
        isOpen={renameOpen}
        titleInput={titleInput}
        onTitleChange={onTitleChange}
        onSave={onSaveTitle}
        onCancel={onCancelRename}
      />

      <ContextAutocomplete
        isVisible={atMentionVisible}
        onClose={closeAtMention}
        searchQuery={atMentionQuery}
        position={atMentionPos}
        apps={availableApps}
        onSelectApp={onSelectApp}
      />
    </>
  );
}
