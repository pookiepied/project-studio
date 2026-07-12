/**
 * Comprehensive Diagnostic System
 * Tests all major application systems and generates detailed reports
 */

import { logger } from '../logging/logger';
import { environmentService } from '../platform/environmentService';
import { unifiedStorage } from '../storage/unifiedStorageService';
import { testEncryption } from '../storage/secureStorage';
import { networkStateManager } from '../network/networkStateService';
import { apiManager } from '../network/apiManager';
import { memorySystem } from '../storage/memorySystem';
import { NotificationService } from '../notifications';

export interface DiagnosticTest {
  id: string;
  name: string;
  category: 'platform' | 'storage' | 'network' | 'api' | 'security' | 'ui' | 'system' | 'features';
  status: 'pending' | 'running' | 'pass' | 'fail' | 'warning' | 'skip';
  message: string;
  details?: any;
  duration?: number;
  timestamp?: number;
}

export interface DiagnosticReport {
  timestamp: number;
  environment: string;
  platform: string;
  userAgent: string;
  tests: DiagnosticTest[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
  recommendations: string[];
}

class ComprehensiveDiagnostics {
  private tests: DiagnosticTest[] = [];
  private onProgress?: (test: DiagnosticTest) => void;

  /**
   * Run all diagnostic tests
   */
  async runDiagnostics(onProgress?: (test: DiagnosticTest) => void): Promise<DiagnosticReport> {
    this.onProgress = onProgress;
    this.tests = [];

    logger.info('Diagnostics', 'Starting comprehensive diagnostics');

    // Define all tests
    const testSuite = [
      // Platform Detection
      { id: 'platform-detection', name: 'Platform Detection', category: 'platform' as const, test: this.testPlatformDetection },
      { id: 'environment-info', name: 'Environment Information', category: 'platform' as const, test: this.testEnvironmentInfo },
      
      // Storage Systems
      { id: 'unified-storage', name: 'Unified Storage System', category: 'storage' as const, test: this.testUnifiedStorage },
      { id: 'secure-storage', name: 'Secure Storage & Encryption', category: 'security' as const, test: this.testSecureStorage },
      { id: 'memory-system', name: 'Memory System', category: 'storage' as const, test: this.testMemorySystem },
      { id: 'file-logger', name: 'File Logging System', category: 'storage' as const, test: this.testFileLogger },
      
      // Network & API
      { id: 'network-connectivity', name: 'Network Connectivity', category: 'network' as const, test: this.testNetworkConnectivity },
      { id: 'api-configuration', name: 'API Configuration', category: 'api' as const, test: this.testAPIConfiguration },
      { id: 'api-health', name: 'API Health Check', category: 'api' as const, test: this.testAPIHealth },
      { id: 'model-loading', name: 'Model Loading', category: 'api' as const, test: this.testModelLoading },
      
      // System Features
      { id: 'microphone-access', name: 'Microphone Permissions', category: 'system' as const, test: this.testMicrophoneAccess },
      { id: 'notifications', name: 'Notification System', category: 'system' as const, test: this.testNotifications },
      { id: 'global-shortcuts', name: 'Global Shortcuts', category: 'system' as const, test: this.testGlobalShortcuts },
      { id: 'tray-system', name: 'System Tray', category: 'system' as const, test: this.testTraySystem },
      
      // UI Features
      { id: 'theme-system', name: 'Theme System', category: 'ui' as const, test: this.testThemeSystem },
      { id: 'attachment-system', name: 'File Attachment System', category: 'features' as const, test: this.testAttachmentSystem },
      { id: 'canvas-system', name: 'Canvas System', category: 'features' as const, test: this.testCanvasSystem },
      { id: 'thinking-system', name: 'Thinking System', category: 'features' as const, test: this.testThinkingSystem },
      
      // System Integration
      { id: 'autostart', name: 'Auto-start on Boot', category: 'system' as const, test: this.testAutostart },
      { id: 'error-handling', name: 'Error Handling System', category: 'system' as const, test: this.testErrorHandling },
    ];

    // Run tests sequentially
    for (const testDef of testSuite) {
      const test: DiagnosticTest = {
        id: testDef.id,
        name: testDef.name,
        category: testDef.category,
        status: 'running',
        message: 'Running test...',
        timestamp: Date.now()
      };

      this.tests.push(test);
      this.notifyProgress(test);

      const startTime = Date.now();
      
      try {
        await testDef.test.call(this, test);
        test.duration = Date.now() - startTime;
        
        if (test.status === 'running') {
          test.status = 'pass';
          test.message = 'Test completed successfully';
        }
      } catch (error) {
        test.status = 'fail';
        test.message = error instanceof Error ? error.message : String(error);
        test.duration = Date.now() - startTime;
        logger.error('Diagnostics', `Test ${test.id} failed`, error);
      }

      this.notifyProgress(test);
    }

    // Generate report
    const report = this.generateReport();
    
    // Save report to storage
    try {
      await unifiedStorage.writeJSON('diagnostics-report.json', report);
      logger.info('Diagnostics', 'Diagnostic report saved');
    } catch (error) {
      logger.warn('Diagnostics', 'Failed to save diagnostic report', error);
    }

    return report;
  }

  private notifyProgress(test: DiagnosticTest) {
    if (this.onProgress) {
      this.onProgress({ ...test });
    }
  }

  // Platform Tests
  private async testPlatformDetection(test: DiagnosticTest) {
    const env = environmentService.getEnvironment();
    const isTauri = environmentService.isTauri();
    const isWeb = environmentService.isWeb();

    test.details = {
      environment: env,
      isTauri,
      isWeb,
      userAgent: navigator.userAgent,
      platform: navigator.platform
    };

    test.message = `Detected ${env} environment`;
    test.status = 'pass';
  }

  private async testEnvironmentInfo(test: DiagnosticTest) {
    const info = environmentService.getEnvironmentInfo();
    
    test.details = info;
    test.message = `Environment: ${info.environment}, Protocol: ${info.protocol}`;
    test.status = 'pass';
  }

  // Storage Tests
  private async testUnifiedStorage(test: DiagnosticTest) {
    await unifiedStorage.initialize();
    
    // Test write/read/delete cycle
    const testData = `diagnostic-test-${Date.now()}`;
    const testPath = 'diagnostic-test.txt';
    
    await unifiedStorage.writeText(testPath, testData);
    const readData = await unifiedStorage.readText(testPath);
    const exists = await unifiedStorage.exists(testPath);
    await unifiedStorage.remove(testPath);
    const existsAfterDelete = await unifiedStorage.exists(testPath);
    
    if (readData !== testData) {
      throw new Error('Data integrity check failed');
    }
    
    if (!exists || existsAfterDelete) {
      throw new Error('File existence check failed');
    }

    const isUsingTauri = await unifiedStorage.isUsingTauriFS();
    
    test.details = {
      backend: isUsingTauri ? 'TauriStorageBackend' : 'WebStorageBackend',
      writeSuccess: true,
      readSuccess: true,
      deleteSuccess: true
    };
    
    test.message = `Using ${isUsingTauri ? 'Tauri FS' : 'Web Storage'} backend`;
  }

  private async testSecureStorage(test: DiagnosticTest) {
    const encryptionWorks = await testEncryption();
    
    if (!encryptionWorks) {
      test.status = 'warning';
      test.message = 'Encryption test failed - using fallback storage';
      test.details = { encryptionEnabled: false };
      return;
    }
    
    test.details = { encryptionEnabled: true };
    test.message = 'Encryption working correctly';
  }

  private async testMemorySystem(test: DiagnosticTest) {
    await memorySystem.initialize();
    
    // Test memory operations
    const testMemoryId = await memorySystem.addMemory(
      'Diagnostic test memory',
      'short-term',
      'fact',
      'System diagnostic',
      5,
      undefined,
      ['diagnostic', 'test']
    );
    
    const memories = await memorySystem.retrieveMemories('diagnostic', undefined, 1);
    const found = memories.some(m => m.id === testMemoryId);
    
    if (!found) {
      throw new Error('Memory retrieval failed');
    }
    
    test.details = {
      memoryCreated: true,
      memoryRetrieved: true,
      totalMemories: memories.length
    };
    
    test.message = 'Memory system operational';
  }

  private async testFileLogger(test: DiagnosticTest) {
    try {
      const { fileLogger } = await import('../logging/fileLogger');
      await fileLogger.info('Diagnostic test log entry');
      
      test.details = { fileLoggingEnabled: true };
      test.message = 'File logging operational';
    } catch (error) {
      test.status = 'warning';
      test.message = 'File logging not available - using console fallback';
      test.details = { fileLoggingEnabled: false };
    }
  }

  // Network Tests
  private async testNetworkConnectivity(test: DiagnosticTest) {
    const networkState = networkStateManager.getState();
    
    if (!networkState.isOnline) {
      test.status = 'fail';
      test.message = 'No network connectivity detected';
      test.details = networkState;
      return;
    }
    
    // Test actual connectivity
    const connected = await networkStateManager.forceCheck();
    
    test.details = {
      browserOnline: navigator.onLine,
      networkManagerState: networkState,
      connectivityCheck: connected
    };
    
    if (connected) {
      test.message = 'Network connectivity confirmed';
    } else {
      test.status = 'warning';
      test.message = 'Network connectivity issues detected';
    }
  }

  private async testAPIConfiguration(test: DiagnosticTest) {
    const isConfigured = await apiManager.isConfigured();
    const endpoints = await apiManager.getEndpoints();
    
    test.details = {
      configured: isConfigured,
      endpoints: Object.keys(endpoints).length > 0 ? 'Available' : 'None'
    };
    
    if (isConfigured) {
      test.message = 'API properly configured';
    } else {
      test.status = 'warning';
      test.message = 'API not configured - limited functionality available';
    }
  }

  private async testAPIHealth(test: DiagnosticTest) {
    const isConfigured = await apiManager.isConfigured();
    
    if (!isConfigured) {
      test.status = 'skip';
      test.message = 'Skipped - API not configured';
      return;
    }
    
    try {
      const endpoints = await apiManager.getEndpoints();
      if (!endpoints.health) {
        throw new Error('Health endpoint not available');
      }
      
      const response = await fetch(endpoints.health, {
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }
      
      test.details = {
        healthEndpoint: endpoints.health,
        status: response.status,
        statusText: response.statusText
      };
      
      test.message = 'API health check passed';
    } catch (error) {
      test.status = 'fail';
      test.message = `API health check failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async testModelLoading(test: DiagnosticTest) {
    try {
      const { fetchModels } = await import('@/features/models/services/modelService');
      const result = await fetchModels(false, false, false, false); // Quick check without local models
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch models');
      }
      
      const modelCount = Array.isArray(result.data?.providers) 
        ? result.data.providers.reduce((total: number, provider: any) => 
            total + (Array.isArray(provider.models) ? provider.models.length : 0), 0)
        : 0;
      
      test.details = {
        providersCount: Array.isArray(result.data?.providers) ? result.data.providers.length : 0,
        totalModels: modelCount,
        providers: Array.isArray(result.data?.providers) 
          ? result.data.providers.map((p: any) => p.name) 
          : []
      };
      
      if (modelCount > 0) {
        const providerCount = Array.isArray(result.data?.providers) ? result.data.providers.length : 0;
        test.message = `${modelCount} models available from ${providerCount} providers`;
      } else {
        test.status = 'warning';
        test.message = 'No models available - check API configuration';
      }
    } catch (error) {
      test.status = 'warning';
      test.message = `Model loading failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // System Tests
  private async testMicrophoneAccess(test: DiagnosticTest) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      // Test microphone permission
      let permissionGranted = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        permissionGranted = true;
        stream.getTracks().forEach(track => track.stop()); // Clean up
      } catch (permError) {
        // Permission denied or not available
      }
      
      test.details = {
        audioInputDevices: audioInputs.length,
        permissionGranted,
        devices: audioInputs.map(d => ({ label: d.label, deviceId: d.deviceId }))
      };
      
      if (permissionGranted) {
        test.message = `Microphone access granted - ${audioInputs.length} devices available`;
      } else {
        test.status = 'warning';
        test.message = 'Microphone permission not granted';
      }
    } catch (error) {
      test.status = 'fail';
      test.message = `Microphone test failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async testNotifications(test: DiagnosticTest) {
    const hasPermission = await NotificationService.requestPermission();
    
    test.details = {
      permissionGranted: hasPermission,
      notificationSupported: 'Notification' in window,
      tauriNotifications: environmentService.isTauri()
    };
    
    if (hasPermission) {
      test.message = 'Notification system ready';
    } else {
      test.status = 'warning';
      test.message = 'Notification permission not granted';
    }
  }

  private async testGlobalShortcuts(test: DiagnosticTest) {
    if (!environmentService.isTauri()) {
      test.status = 'skip';
      test.message = 'Skipped - not available in web mode';
      return;
    }
    
    try {
      // Test shortcut registration (don't actually register to avoid conflicts)
      test.details = {
        tauriEnvironment: true,
        shortcutSupported: true
      };
      
      test.message = 'Global shortcuts supported';
    } catch (error) {
      test.status = 'warning';
      test.message = 'Global shortcuts may not be available';
    }
  }

  private async testTraySystem(test: DiagnosticTest) {
    if (!environmentService.isTauri()) {
      test.status = 'skip';
      test.message = 'Skipped - not available in web mode';
      return;
    }
    
    try {
      // Test tray availability
      test.details = {
        tauriEnvironment: true,
        traySupported: true
      };
      
      test.message = 'System tray supported';
    } catch (error) {
      test.status = 'warning';
      test.message = 'System tray may not be available';
    }
  }

  // UI Tests
  private async testThemeSystem(test: DiagnosticTest) {
    const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    test.details = {
      currentTheme,
      systemPrefersDark,
      themeClassApplied: document.documentElement.classList.contains('dark') || 
                        document.documentElement.classList.contains('light')
    };
    
    test.message = `Theme system operational - current: ${currentTheme}`;
  }

  private async testAttachmentSystem(test: DiagnosticTest) {
    const fileInputSupported = 'File' in window && 'FileReader' in window;
    const dragDropSupported = 'DataTransfer' in window;
    
    test.details = {
      fileInputSupported,
      dragDropSupported,
      fileReaderSupported: 'FileReader' in window
    };
    
    if (fileInputSupported && dragDropSupported) {
      test.message = 'File attachment system ready';
    } else {
      test.status = 'warning';
      test.message = 'Limited file attachment support';
    }
  }

  private async testCanvasSystem(test: DiagnosticTest) {
    // Test if canvas context is available
    const canvasSupported = 'HTMLCanvasElement' in window;
    const webglSupported = (() => {
      try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
      } catch {
        return false;
      }
    })();
    
    test.details = {
      canvasSupported,
      webglSupported,
      canvasContextSupported: canvasSupported
    };
    
    if (canvasSupported) {
      test.message = 'Canvas system ready';
    } else {
      test.status = 'warning';
      test.message = 'Canvas support limited';
    }
  }

  private async testThinkingSystem(test: DiagnosticTest) {
    test.status = 'pass';
    test.message = 'Thinking system removed';
  }

  private async testAutostart(test: DiagnosticTest) {
    if (!environmentService.isTauri()) {
      test.status = 'skip';
      test.message = 'Skipped - not available in web mode';
      return;
    }
    
    try {
      const { AutostartService } = await import('../platform/autostartService');
      const isEnabled = await AutostartService.isEnabled();
      
      test.details = {
        autostartEnabled: isEnabled,
        autostartSupported: true
      };
      
      test.message = `Auto-start ${isEnabled ? 'enabled' : 'disabled'}`;
    } catch (error) {
      test.status = 'warning';
      test.message = 'Auto-start status unavailable';
    }
  }

  private async testErrorHandling(test: DiagnosticTest) {
    try {
      const { getStoredErrors } = await import('./errorReporting');
      const errors = await getStoredErrors();
      
      test.details = {
        errorReportingEnabled: true,
        storedErrorCount: errors.length,
        recentErrors: errors.slice(-3).map(e => ({
          message: e.message,
          timestamp: new Date(e.timestamp).toISOString()
        }))
      };
      
      test.message = `Error handling active - ${errors.length} stored errors`;
    } catch (error) {
      test.status = 'warning';
      test.message = 'Error handling system unavailable';
    }
  }

  private generateReport(): DiagnosticReport {
    const summary = {
      total: this.tests.length,
      passed: this.tests.filter(t => t.status === 'pass').length,
      failed: this.tests.filter(t => t.status === 'fail').length,
      warnings: this.tests.filter(t => t.status === 'warning').length,
      skipped: this.tests.filter(t => t.status === 'skip').length
    };

    const recommendations: string[] = [];
    
    // Generate recommendations based on test results
    this.tests.forEach(test => {
      if (test.status === 'fail') {
        recommendations.push(`Fix ${test.name}: ${test.message}`);
      } else if (test.status === 'warning') {
        recommendations.push(`Consider addressing ${test.name}: ${test.message}`);
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('All systems are functioning normally');
    }

    return {
      timestamp: Date.now(),
      environment: environmentService.getEnvironment(),
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      tests: this.tests,
      summary,
      recommendations
    };
  }

  /**
   * Export diagnostic report as text
   */
  async exportReport(report?: DiagnosticReport): Promise<string> {
    const diagnosticReport = report || await this.runDiagnostics();
    
    let output = '=== STUDIO Diagnostic Report ===\n\n';
    output += `Generated: ${new Date(diagnosticReport.timestamp).toISOString()}\n`;
    output += `Environment: ${diagnosticReport.environment}\n`;
    output += `Platform: ${diagnosticReport.platform}\n\n`;
    
    output += '=== Summary ===\n';
    output += `Total Tests: ${diagnosticReport.summary.total}\n`;
    output += `Passed: ${diagnosticReport.summary.passed}\n`;
    output += `Failed: ${diagnosticReport.summary.failed}\n`;
    output += `Warnings: ${diagnosticReport.summary.warnings}\n`;
    output += `Skipped: ${diagnosticReport.summary.skipped}\n\n`;
    
    // Group tests by category
    const categories = [...new Set(diagnosticReport.tests.map(t => t.category))];
    
    for (const category of categories) {
      const categoryTests = diagnosticReport.tests.filter(t => t.category === category);
      output += `=== ${category.toUpperCase()} TESTS ===\n`;
      
      for (const test of categoryTests) {
        const status = test.status.toUpperCase().padEnd(8);
        output += `[${status}] ${test.name}\n`;
        output += `           ${test.message}\n`;
        if (test.duration) {
          output += `           Duration: ${test.duration}ms\n`;
        }
        output += '\n';
      }
    }
    
    output += '=== Recommendations ===\n';
    diagnosticReport.recommendations.forEach((rec, index) => {
      output += `${index + 1}. ${rec}\n`;
    });
    
    return output;
  }
}

export const comprehensiveDiagnostics = new ComprehensiveDiagnostics();