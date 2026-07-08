/**
 * Offline Context
 * Manages offline state and network monitoring
 */

import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from "react";
import { networkService, NetworkStatus } from "../services/network/networkService";

interface OfflineContextType {
  isOffline: boolean;
  showOfflineModal: boolean;
  dismissOfflineModal: () => void;
  continueOffline: () => void;
  checkConnectivity: () => Promise<void>;
  forceShowOffline: () => void;
}

const OfflineContext = createContext<OfflineContextType | null>(null);

interface OfflineProviderProps {
  children: ReactNode;
}

export const OfflineProvider = ({ children }: OfflineProviderProps) => {
  const [isOffline, setIsOffline] = useState(false);
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [hasUserDismissedModal, setHasUserDismissedModal] = useState(false);

  // Check connectivity
  const checkConnectivity = useCallback(async () => {
    const status = networkService.getStatus();
    const wasOffline = isOffline;
    
    // Only consider offline if BOTH browser AND API are unreachable
    // This prevents false positives from temporary API hiccups
    const browserOffline = !status.isOnline;
    const apiUnreachable = !status.apiReachable;
    
    // Require BOTH to fail for offline state
    const nowOffline = browserOffline && apiUnreachable;
    
    setIsOffline(nowOffline);
    
    if (wasOffline && !nowOffline) {
      // Connection restored
    }
    
    if (!wasOffline && nowOffline && !hasUserDismissedModal) {
      setShowOfflineModal(true);
    }
  }, [isOffline, hasUserDismissedModal]);

  // Initial connectivity check
  useEffect(() => {
    checkConnectivity();
  }, [checkConnectivity]);

  // Subscribe to network status changes
  useEffect(() => {
    const unsubscribe = networkService.subscribe((status: NetworkStatus) => {
      const wasOffline = isOffline;
      
      // Only consider offline if BOTH browser AND API are unreachable
      const browserOffline = !status.isOnline;
      const apiUnreachable = !status.apiReachable;
      const nowOffline = browserOffline && apiUnreachable;
      
      setIsOffline(nowOffline);
      
      if (wasOffline && !nowOffline) {
        setShowOfflineModal(false);
      }
      
      if (!wasOffline && nowOffline && !hasUserDismissedModal) {
        setShowOfflineModal(true);
      }
    });

    return unsubscribe;
  }, [isOffline, hasUserDismissedModal]);

  // Start periodic network monitoring (every 30 seconds)
  useEffect(() => {
    networkService.startMonitoring(30000); // 30 seconds
    
    return () => {
      networkService.stopMonitoring();
    };
  }, []);

  const dismissOfflineModal = useCallback(() => {
    setShowOfflineModal(false);
    setHasUserDismissedModal(true);
  }, []);

  const continueOffline = useCallback(() => {
    dismissOfflineModal();
  }, [dismissOfflineModal]);

  const forceShowOffline = useCallback(() => {
    setHasUserDismissedModal(false);
    setShowOfflineModal(true);
  }, []);

  return (
    <OfflineContext.Provider
      value={{
        isOffline,
        showOfflineModal,
        dismissOfflineModal,
        continueOffline,
        checkConnectivity,
        forceShowOffline,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
};

export const useOffline = (): OfflineContextType => {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error("useOffline must be used within OfflineProvider");
  }
  return context;
};
