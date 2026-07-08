export interface DocumentStorageMetadata {
  purpose:    "doc-upload-permanent" | "doc-upload-temp";
  fileName:   string;
  mimeType:   string;
  fileSize:   string;
  userId:     string;
  createdAt:  string;
  expiresAt?: string; // only present for temp uploads
}

export interface StoredDocumentResult {
  docId:      string;
  key:        string;
  permanent:  boolean;
  expiresAt?: number; // unix ms — only for temp uploads
}
