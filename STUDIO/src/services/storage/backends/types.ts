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
  // Real filesystem access (Tauri only; throws in web/cloud)
  createFileSystem(path: string, content: string): Promise<string>;
  createDirectorySystem(path: string): Promise<string>;
  readFileSystem(path: string): Promise<string>;
  fileExistsSystem(path: string): Promise<boolean>;
  getCommonLocations(): Promise<SystemLocation[]>;
  resolveSystemPath(location: string): Promise<string>;
}
