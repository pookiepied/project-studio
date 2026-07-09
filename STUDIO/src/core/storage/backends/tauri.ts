import { invoke } from '@tauri-apps/api/core';
import { homeDir, downloadDir, documentDir, desktopDir } from '@tauri-apps/api/path';
import { logger } from '../../logging/logger';
import type { StorageBackend, SystemLocation } from './types';

export class TauriStorageBackend implements StorageBackend {
  private fs: any = null;
  private pathModule: any = null;
  private available: boolean | null = null;
  private commonLocations: SystemLocation[] = [];
  private systemInitialized = false;

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      this.fs = await import("@tauri-apps/plugin-fs");
      this.pathModule = await import("@tauri-apps/api/path");
      this.available = true;
      logger.debug('Storage', 'Tauri File System initialized successfully');
      return true;
    } catch (error) {
      this.available = false;
      logger.warn('Storage', 'Tauri File System not available', error);
      return false;
    }
  }

  async readText(path: string): Promise<string | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const fullPath = await this.resolveAppDataPath(path);
      logger.debug('Storage', `Reading from Tauri FS: ${fullPath}`);
      const content = await this.fs.readTextFile(fullPath);
      logger.debug('Storage', `Successfully read from Tauri FS (${content.length} chars)`);
      return content;
    } catch (error: any) {
      if (error?.message?.includes('cannot find') || error?.message?.includes('No such file')) {
        logger.debug('Storage', `File not found (expected): ${path}`);
      } else {
        logger.warn('Storage', `Failed to read from Tauri FS: ${path}`, error);
      }
      return null;
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    if (!(await this.isAvailable())) throw new Error("Tauri FS not available");
    try {
      const fullPath = await this.resolveAppDataPath(path);
      logger.debug('Storage', `Writing to Tauri FS: ${fullPath}`);
      const lastSlash = Math.max(fullPath.lastIndexOf("\\"), fullPath.lastIndexOf("/"));
      if (lastSlash > 0) {
        await this.mkdir(fullPath.substring(0, lastSlash));
      }
      await this.fs.writeTextFile(fullPath, content);
      logger.debug('Storage', 'Successfully wrote to Tauri FS');
    } catch (error) {
      logger.error('Storage', `Failed to write to Tauri FS: ${path}`, error);
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    if (!(await this.isAvailable())) return;
    try {
      const fullPath = await this.resolveAppDataPath(path);
      await this.fs.remove(fullPath);
    } catch (error) {
      logger.warn('Storage', `Failed to remove from Tauri FS: ${path}`, error);
    }
  }

  async exists(path: string): Promise<boolean> {
    if (!(await this.isAvailable())) return false;
    try {
      const fullPath = await this.resolveAppDataPath(path);
      await this.fs.readTextFile(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    if (!(await this.isAvailable())) throw new Error("Tauri FS not available for mkdir");
    try {
      const fullPath = path.includes(":\\") || path.startsWith("\\\\")
        ? path
        : await this.resolveAppDataPath(path);
      logger.debug('Storage', `Creating directory: ${fullPath}`);
      await this.fs.mkdir(fullPath, { recursive: true });
    } catch (error) {
      logger.error('Storage', `Failed to create directory: ${path}`, error);
      throw error;
    }
  }

  private async resolveAppDataPath(path: string): Promise<string> {
    const appDataDir = await this.pathModule.appDataDir();
    const { join } = await import("@tauri-apps/api/path");
    return join(appDataDir, path.replace(/\//g, "\\"));
  }

  async createFileSystem(path: string, content = ''): Promise<string> {
    if (!(await this.isAvailable())) throw new Error("Tauri FS not available");
    try {
      const fullPath = await this.resolveSystemPath(path);
      await invoke('write_text_file', { path: fullPath, content });
      return `Created file: ${fullPath}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Storage', `Failed to create file: ${msg}`, { path });
      throw new Error(`Failed to create file: ${msg}`);
    }
  }

  async createDirectorySystem(path: string): Promise<string> {
    if (!(await this.isAvailable())) throw new Error("Tauri FS not available");
    try {
      const fullPath = await this.resolveSystemPath(path);
      await invoke('create_directory', { path: fullPath });
      return `Created directory: ${fullPath}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Storage', `Failed to create directory: ${msg}`, { path });
      throw new Error(`Failed to create directory: ${msg}`);
    }
  }

  async readFileSystem(path: string): Promise<string> {
    if (!(await this.isAvailable())) throw new Error("Tauri FS not available");
    try {
      const fullPath = await this.resolveSystemPath(path);
      return await invoke<string>('read_text_file', { path: fullPath });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Storage', `Failed to read file: ${msg}`, { path });
      throw new Error(`Failed to read file: ${msg}`);
    }
  }

  async fileExistsSystem(path: string): Promise<boolean> {
    if (!(await this.isAvailable())) return false;
    try {
      const fullPath = await this.resolveSystemPath(path);
      return await invoke<boolean>('file_exists', { path: fullPath });
    } catch {
      return false;
    }
  }

  async getCommonLocations(): Promise<SystemLocation[]> {
    await this.initSystemLocations();
    return this.commonLocations;
  }

  async resolveSystemPath(location: string): Promise<string> {
    await this.initSystemLocations();
    const found = this.commonLocations.find(
      l => l.name.toLowerCase() === location.toLowerCase()
    );
    return found ? found.path : location;
  }

  private async initSystemLocations(): Promise<void> {
    if (this.systemInitialized) return;
    try {
      const [home, downloads, documents, desktop] = await Promise.all([
        homeDir(), downloadDir(), documentDir(), desktopDir(),
      ]);
      this.commonLocations = [
        { name: 'Desktop',   path: desktop,   description: 'Your desktop folder' },
        { name: 'Downloads', path: downloads, description: 'Your downloads folder' },
        { name: 'Documents', path: documents, description: 'Your documents folder' },
        { name: 'Home',      path: home,      description: 'Your home directory' },
        { name: 'Current',   path: '.',        description: 'Current working directory' },
      ];
      this.systemInitialized = true;
    } catch (error) {
      logger.error('Storage', 'Failed to initialize system locations', { error });
      throw error;
    }
  }
}
