import { logger } from '../../logging/logger';
import type { StorageBackend, SystemLocation } from './types';

export class CloudStorageBackend implements StorageBackend {
  private workerUrl: string;
  private getToken: () => Promise<string | null>;

  constructor(workerUrl: string, getToken: () => Promise<string | null>) {
    this.workerUrl = workerUrl;
    this.getToken = getToken;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getToken()) !== null;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    if (!token) throw new Error('Not authenticated');
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  // chatHistoryService uses paths like "chats/chat-index.json".
  // Strip the "chats/" prefix to avoid the redundant "user/chats/chats/..." double-segment.
  private toApiPath(path: string): string {
    return path.startsWith('chats/') ? path.slice(6) : path;
  }

  async readText(path: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.workerUrl}/${this.toApiPath(path)}`, {
        headers: await this.authHeaders(),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Cloud read failed: ${res.status}`);
      return await res.text();
    } catch (error) {
      logger.warn('Storage', `Cloud read failed for ${path}`, error);
      return null;
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    const res = await fetch(`${this.workerUrl}/${this.toApiPath(path)}`, {
      method: 'PUT',
      headers: await this.authHeaders(),
      body: content,
    });
    if (!res.ok) throw new Error(`Cloud write failed: ${res.status}`);
  }

  async remove(path: string): Promise<void> {
    try {
      const res = await fetch(`${this.workerUrl}/${this.toApiPath(path)}`, {
        method: 'DELETE',
        headers: await this.authHeaders(),
      });
      if (!res.ok && res.status !== 404) {
        logger.warn('Storage', `Cloud delete failed for ${path}: ${res.status}`);
      }
    } catch (error) {
      logger.warn('Storage', `Cloud delete error for ${path}`, error);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.workerUrl}/${this.toApiPath(path)}`, {
        method: 'HEAD',
        headers: await this.authHeaders(),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async mkdir(_path: string): Promise<void> {
    // R2 has no directory concept
  }

  async createFileSystem(_path: string, _content: string): Promise<string> {
    throw new Error('Real filesystem access not available in cloud mode');
  }
  async createDirectorySystem(_path: string): Promise<string> {
    throw new Error('Real filesystem access not available in cloud mode');
  }
  async readFileSystem(_path: string): Promise<string> {
    throw new Error('Real filesystem access not available in cloud mode');
  }
  async fileExistsSystem(_path: string): Promise<boolean> {
    return false;
  }
  async getCommonLocations(): Promise<SystemLocation[]> {
    return [];
  }
  async resolveSystemPath(location: string): Promise<string> {
    return location;
  }
  async describePath(path: string): Promise<string> {
    return `Cloud storage — ${path}`;
  }
}
