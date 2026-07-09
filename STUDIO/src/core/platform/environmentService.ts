/**
 * Environment Detection Service
 * Determines if we're running in Tauri (desktop) or Web (browser) mode
 */

// Global environment flags (set by build system)
declare global {
  const __WEB_VERSION__: boolean | undefined;
  const __TAURI__: boolean | undefined;
}

export type Environment = 'tauri' | 'web';

class EnvironmentService {
  private _environment: Environment | null = null;

  /**
   * Detect current environment
   */
  getEnvironment(): Environment {
    if (this._environment) return this._environment;

    // Check build-time flags first
    if (typeof __WEB_VERSION__ !== 'undefined' && __WEB_VERSION__) {
      this._environment = 'web';
      return this._environment;
    }

    if (typeof __TAURI__ !== 'undefined' && __TAURI__) {
      this._environment = 'tauri';
      return this._environment;
    }

    // Runtime detection fallback
    if (typeof window !== 'undefined') {
      // Check for Tauri-specific globals
      if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__) {
        this._environment = 'tauri';
        return this._environment;
      }

      // Check for web-specific indicators
      if ('serviceWorker' in navigator || window.location.protocol.startsWith('http')) {
        this._environment = 'web';
        return this._environment;
      }
    }

    // Default to web if uncertain
    this._environment = 'web';
    return this._environment;
  }

  /**
   * Check if running in Tauri (desktop)
   */
  isTauri(): boolean {
    return this.getEnvironment() === 'tauri';
  }

  /**
   * Check if running in web (browser)
   */
  isWeb(): boolean {
    return this.getEnvironment() === 'web';
  }

  /**
   * Get environment info for debugging
   */
  getEnvironmentInfo() {
    const env = this.getEnvironment();
    return {
      environment: env,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      protocol: typeof window !== 'undefined' ? window.location.protocol : 'unknown',
      hasTauri: typeof window !== 'undefined' && !!(window as any).__TAURI__,
      hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      buildFlags: {
        __WEB_VERSION__: typeof __WEB_VERSION__ !== 'undefined' ? __WEB_VERSION__ : undefined,
        __TAURI__: typeof __TAURI__ !== 'undefined' ? __TAURI__ : undefined,
      }
    };
  }
}

export const environmentService = new EnvironmentService();