export interface SystemLocation {
  name: string;
  path: string;
  description: string;
}

export interface StorageBackend {
  isAvailable(): Promise<boolean>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /**
   * Human-readable location of a logical storage path, for display only.
   *
   * Must be derived from whatever this backend actually resolves in readText/
   * writeText — never a hardcoded string. Only a backend knows where its own
   * data lands, and a backend that stores no files must say so rather than
   * inventing a filesystem path.
   */
  describePath(path: string): Promise<string>;
  // Real filesystem access (Tauri only; throws in web/cloud)
  createFileSystem(path: string, content: string): Promise<string>;
  createDirectorySystem(path: string): Promise<string>;
  readFileSystem(path: string): Promise<string>;
  fileExistsSystem(path: string): Promise<boolean>;
  getCommonLocations(): Promise<SystemLocation[]>;
  resolveSystemPath(location: string): Promise<string>;
}
