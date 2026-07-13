/**
 * Secure Storage Service
 * Handles encryption/decryption of sensitive data like API keys and JWT secrets
 */

import { invoke } from "@tauri-apps/api/core";
import { environmentService } from "../platform/environmentService";
import { logger } from "../logging/logger";

// Encryption key derivation from machine-specific data
let encryptionKey: string | null = null;

// Installation-specific salt (generated once per installation)
const SALT_STORAGE_KEY = 'studio_installation_salt';
let installationSalt: Uint8Array | null = null;

/**
 * Generate or retrieve installation-specific salt
 * This salt is unique per installation and persists across sessions
 */
async function getInstallationSalt(): Promise<Uint8Array> {
  if (installationSalt) {
    return installationSalt;
  }

  try {
    let storedSalt: string | null = null;

    // Try to retrieve existing salt
    if (environmentService.isTauri()) {
      try {
        storedSalt = await invoke('get_secure', { key: SALT_STORAGE_KEY }) as string;
      } catch {
        // Fallback to localStorage if Tauri secure storage fails
        storedSalt = localStorage.getItem(SALT_STORAGE_KEY);
      }
    } else {
      storedSalt = localStorage.getItem(SALT_STORAGE_KEY);
    }

    if (storedSalt) {
      // Convert hex string back to Uint8Array
      const saltArray = new Uint8Array(storedSalt.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
      installationSalt = saltArray;
      logger.debug('SecureStorage', 'Retrieved existing installation salt');
      return installationSalt;
    }

    // Generate new salt if none exists
    const newSalt = crypto.getRandomValues(new Uint8Array(32)); // 256-bit salt
    const saltHex = Array.from(newSalt).map(b => b.toString(16).padStart(2, '0')).join('');

    // Store the salt
    if (environmentService.isTauri()) {
      try {
        await invoke('store_secure', { key: SALT_STORAGE_KEY, value: saltHex });
      } catch {
        // Fallback to localStorage if Tauri secure storage fails
        localStorage.setItem(SALT_STORAGE_KEY, saltHex);
      }
    } else {
      localStorage.setItem(SALT_STORAGE_KEY, saltHex);
    }

    installationSalt = newSalt;
    logger.info('SecureStorage', 'Generated new installation-specific salt');
    return installationSalt;
  } catch (error) {
    logger.error('SecureStorage', 'Failed to get/generate installation salt', error);
    // Fallback to a deterministic but unique salt based on timestamp and random
    const fallbackData = `studio-fallback-${Date.now()}-${Math.random()}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(fallbackData));
    installationSalt = new Uint8Array(hashBuffer);
    return installationSalt;
  }
}
/**
 * Generate or retrieve encryption key based on machine fingerprint
 */
async function getEncryptionKey(): Promise<string> {
  if (encryptionKey) {
    return encryptionKey;
  }

  if (environmentService.isTauri()) {
    try {
      // Use Tauri's secure storage or generate machine-specific key
      const key = await invoke('get_machine_encryption_key') as string;
      encryptionKey = key;
      return encryptionKey;
    } catch (error) {
      logger.error('SecureStorage', 'Failed to get machine key - secure storage unavailable', error);
      // SECURITY FIX: Fail securely instead of using weak fallback
      throw new Error('Secure storage unavailable - cannot generate encryption key');
    }
  }

  // Fallback: Generate key from browser fingerprint
  const fingerprint = await generateBrowserFingerprint();
  encryptionKey = await deriveKeyFromFingerprint(fingerprint);
  return encryptionKey;
}

/**
 * Generate browser fingerprint for encryption key
 */
async function generateBrowserFingerprint(): Promise<string> {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset().toString(),
    navigator.hardwareConcurrency?.toString() || '0',
  ];

  // Add more entropy if available
  if ('deviceMemory' in navigator) {
    components.push((navigator as any).deviceMemory.toString());
  }

  const fingerprint = components.join('|');
  
  // Hash the fingerprint
  const encoder = new TextEncoder();
  const data = encoder.encode(fingerprint);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive encryption key from fingerprint using PBKDF2 with unique salt
 */
async function deriveKeyFromFingerprint(fingerprint: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(fingerprint),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // Use installation-specific salt instead of static salt
    const salt = await getInstallationSalt();
    
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['deriveKey', 'encrypt', 'decrypt']
    );

    const exportedKey = await crypto.subtle.exportKey('raw', derivedKey);
    const keyArray = Array.from(new Uint8Array(exportedKey));
    return keyArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    logger.error('SecureStorage', 'Key derivation failed', error);
    // Fallback to a simpler key generation with unique salt
    const encoder = new TextEncoder();
    const salt = await getInstallationSalt();
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const data = encoder.encode(fingerprint + saltHex);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

/** Build a 32-byte AES key buffer from a hex or raw key string. */
async function buildAesKeyBuffer(key: string): Promise<Uint8Array> {
  let buf: Uint8Array;
  if (key.length === 64) {
    buf = new Uint8Array(key.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  } else {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    buf = new Uint8Array(hashBuffer);
  }
  if (buf.length !== 32) {
    const padded = new Uint8Array(32);
    padded.set(buf.slice(0, 32));
    return padded;
  }
  return buf;
}

/**
 * Encrypt sensitive data
 */
export async function encryptData(plaintext: string): Promise<string> {
  try {
    const keyBuffer = await buildAesKeyBuffer(await getEncryptionKey());

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      cryptoKey,
      data
    );

    // Combine IV + encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Convert to base64
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    logger.error('SecureStorage', 'Encryption failed', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt sensitive data
 */
export async function decryptData(encryptedData: string): Promise<string> {
  try {
    const keyBuffer = await buildAesKeyBuffer(await getEncryptionKey());

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decode base64
    const combined = new Uint8Array(atob(encryptedData).split('').map(c => c.charCodeAt(0)));
    
    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      cryptoKey,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    logger.error('SecureStorage', 'Decryption failed', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Test encryption/decryption functionality
 */
export async function testEncryption(): Promise<boolean> {
  try {
    const testData = 'test-secret-data-' + Date.now();
    const encrypted = await encryptData(testData);
    const decrypted = await decryptData(encrypted);
    return decrypted === testData;
  } catch (error) {
    logger.error('SecureStorage', 'Encryption test failed', error);
    return false;
  }
}

/**
 * Get salt information for debugging (returns hex string, not the actual salt)
 */
export async function getSaltInfo(): Promise<{ exists: boolean; length: number; preview: string }> {
  try {
    const salt = await getInstallationSalt();
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    return {
      exists: true,
      length: salt.length,
      preview: saltHex.substring(0, 8) + '...' // Only show first 4 bytes for debugging
    };
  } catch (error) {
    return {
      exists: false,
      length: 0,
      preview: 'N/A'
    };
  }
}
