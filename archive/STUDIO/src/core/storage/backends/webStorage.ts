/**
 * Web Storage Service
 * Replaces Tauri file system with browser localStorage/indexedDB
 */

import { logger } from '@/core/logging/logger';

// Simple localStorage wrapper for web version
export const webStorageService = {
  async save(key: string, data: any): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      logger.error('WebStorage', 'Failed to save', error);
      throw error;
    }
  },

  async load(key: string): Promise<any> {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      logger.error('WebStorage', 'Failed to load', error);
      return null;
    }
  },

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      logger.error('WebStorage', 'Failed to remove', error);
      throw error;
    }
  },

  async exists(key: string): Promise<boolean> {
    return localStorage.getItem(key) !== null;
  },

  async list(): Promise<string[]> {
    return Object.keys(localStorage);
  }
};