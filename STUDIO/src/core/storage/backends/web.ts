import { webStorageService } from './webStorage';
import { logger } from '../../logging/logger';
import type { StorageBackend, SystemLocation } from './types';

export class WebStorageBackend implements StorageBackend {
  async isAvailable(): Promise<boolean> {
    return typeof localStorage !== 'undefined';
  }

  async readText(path: string): Promise<string | null> {
    try {
      logger.debug('Storage', `Reading from Web Storage: ${path}`);
      const content = await webStorageService.load(path);
      if (content && typeof content === 'string') {
        logger.debug('Storage', `Successfully read from Web Storage (${content.length} chars)`);
        return content;
      }
      return null;
    } catch (error) {
      logger.warn('Storage', `Failed to read from Web Storage: ${path}`, error);
      return null;
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    try {
      logger.debug('Storage', `Writing to Web Storage: ${path}`);
      await webStorageService.save(path, content);
      logger.debug('Storage', 'Successfully wrote to Web Storage');
    } catch (error) {
      logger.error('Storage', `Failed to write to Web Storage: ${path}`, error);
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await webStorageService.remove(path);
    } catch (error) {
      logger.warn('Storage', `Failed to remove from Web Storage: ${path}`, error);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await webStorageService.exists(path);
    } catch {
      return false;
    }
  }

  async mkdir(_path: string): Promise<void> {
    logger.debug('Storage', `Web Storage mkdir (no-op): ${_path}`);
  }

  async createFileSystem(_path: string, _content = ''): Promise<string> {
    throw new Error("Real file system access not available in web mode");
  }
  async createDirectorySystem(_path: string): Promise<string> {
    throw new Error("Real file system access not available in web mode");
  }
  async readFileSystem(_path: string): Promise<string> {
    throw new Error("Real file system access not available in web mode");
  }
  async fileExistsSystem(_path: string): Promise<boolean> {
    return false;
  }
  async getCommonLocations(): Promise<SystemLocation[]> {
    return [{ name: 'Browser', path: 'browser-storage', description: 'Browser storage (not real files)' }];
  }
  async resolveSystemPath(location: string): Promise<string> {
    return location;
  }
}
