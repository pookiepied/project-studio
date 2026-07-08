import { environmentService } from '../platform/environmentService';
import { logger } from '../logging/logger';
import { TauriStorageBackend } from './backends/tauri';
import { WebStorageBackend } from './backends/web';
import { CloudStorageBackend } from './backends/cloud';
import type { StorageBackend } from './backends/types';

export type { SystemLocation } from './backends/types';
export type { StorageBackend } from './backends/types';

class UnifiedStorageManager {
  private backend: StorageBackend | null = null;
  private cloudBackend: CloudStorageBackend | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const env = environmentService.getEnvironment();
    logger.debug('Storage', `Initializing for environment: ${env}`);

    if (env === 'tauri') {
      this.backend = new TauriStorageBackend();
      if (!(await this.backend.isAvailable())) {
        logger.warn('Storage', 'Tauri FS not available, falling back to web storage');
        this.backend = new WebStorageBackend();
      }
    } else {
      this.backend = new WebStorageBackend();
    }

    if (!(await this.backend.isAvailable())) {
      throw new Error("No storage backend available");
    }

    if (this.backend instanceof TauriStorageBackend) {
      try {
        const pathModule = await import("@tauri-apps/api/path");
        const appDataDir = await pathModule.appDataDir();
        await this.backend.mkdir(appDataDir);
      } catch (error) {
        logger.warn('Storage', 'Failed to create base directory (might already exist)', error);
      }
    }

    this.initialized = true;
    logger.info('Storage', `Initialized - Using ${this.backend.constructor.name}`);
  }

  private async getBackend(): Promise<StorageBackend> {
    if (!this.initialized) await this.initialize();
    if (!this.backend) throw new Error("Storage backend not initialized");
    return this.backend;
  }

  /** Route chats/* to cloud when enabled; all other paths always use local. */
  private async getBackendForPath(path: string): Promise<StorageBackend> {
    if (this.cloudBackend && path.startsWith('chats/')) return this.cloudBackend;
    return this.getBackend();
  }

  async readText(path: string): Promise<string | null> {
    return (await this.getBackendForPath(path)).readText(path);
  }

  async writeText(path: string, content: string): Promise<void> {
    return (await this.getBackendForPath(path)).writeText(path, content);
  }

  async remove(path: string): Promise<void> {
    return (await this.getBackendForPath(path)).remove(path);
  }

  async exists(path: string): Promise<boolean> {
    return (await this.getBackendForPath(path)).exists(path);
  }

  async mkdir(path: string): Promise<void> {
    return (await this.getBackendForPath(path)).mkdir(path);
  }

  async readJSON<T>(path: string): Promise<T | null> {
    const content = await this.readText(path);
    if (!content) return null;
    try {
      return JSON.parse(content) as T;
    } catch (error) {
      logger.error('Storage', `Failed to parse JSON from ${path}`, error);
      return null;
    }
  }

  async writeJSON<T>(path: string, data: T): Promise<void> {
    await this.writeText(path, JSON.stringify(data, null, 2));
  }

  /**
   * Enable cloud storage for chats/*.
   * On first enable: migrates local chats to R2, then deletes local copies.
   */
  async enableCloudStorage(
    workerUrl: string,
    getToken: () => Promise<string | null>
  ): Promise<void> {
    if (this.cloudBackend) return;

    const localBackend = await this.getBackend();
    const cloudBackend = new CloudStorageBackend(workerUrl, getToken);

    try {
      const cloudIndex = await cloudBackend.readText('chats/chat-index.json');
      if (!cloudIndex) {
        const localIndex = await localBackend.readText('chats/chat-index.json');
        if (localIndex) {
          await cloudBackend.writeText('chats/chat-index.json', localIndex);
          const index = JSON.parse(localIndex) as { conversations?: Array<{ id: string }> };
          for (const conv of (index.conversations ?? [])) {
            const chatContent = await localBackend.readText(`chats/${conv.id}.json`);
            if (chatContent) await cloudBackend.writeText(`chats/${conv.id}.json`, chatContent);
            await localBackend.remove(`chats/${conv.id}.json`);
          }
          await localBackend.remove('chats/chat-index.json');
          logger.info('Storage', `Migrated and cleaned ${index.conversations?.length ?? 0} local conversations`);
        }
      }
    } catch (error) {
      logger.warn('Storage', 'Cloud migration check failed, proceeding without migration', error);
    }

    this.cloudBackend = cloudBackend;
    logger.info('Storage', 'Cloud storage enabled for chats/* paths');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('studio:storage-ready'));
    }
  }

  /** Disable cloud storage (called on logout). */
  disableCloudStorage(): void {
    if (!this.cloudBackend) return;
    this.cloudBackend = null;
    logger.info('Storage', 'Cloud storage disabled — local backend active for all paths');
  }

  async isUsingTauriFS(): Promise<boolean> {
    return (await this.getBackend()) instanceof TauriStorageBackend;
  }

  // Real filesystem access (Tauri only)
  async createFileSystem(path: string, content = ''): Promise<string> {
    return (await this.getBackend()).createFileSystem(path, content);
  }
  async createDirectorySystem(path: string): Promise<string> {
    return (await this.getBackend()).createDirectorySystem(path);
  }
  async readFileSystem(path: string): Promise<string> {
    return (await this.getBackend()).readFileSystem(path);
  }
  async fileExistsSystem(path: string): Promise<boolean> {
    return (await this.getBackend()).fileExistsSystem(path);
  }
  async getCommonLocations() {
    return (await this.getBackend()).getCommonLocations();
  }
  async resolveSystemPath(location: string): Promise<string> {
    return (await this.getBackend()).resolveSystemPath(location);
  }
}

export const unifiedStorage = new UnifiedStorageManager();
