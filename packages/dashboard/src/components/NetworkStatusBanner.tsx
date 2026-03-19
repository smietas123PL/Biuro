import { useEffect, useState } from 'react';

export function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(() => window.navigator.onLine);
  const [showRecovered, setShowRecovered] = useState(false);

  useEffect(() => {
    let recoveryTimer: number | null = null;

    const handleOffline = () => {
      if (recoveryTimer !== null) {
        window.clearTimeout(recoveryTimer);
        recoveryTimer = null;
      }
      setShowRecovered(false);
      setIsOnline(false);
    };

    const handleOnline = () => {
      setIsOnline(true);
      setShowRecovered(true);
      recoveryTimer = window.setTimeout(() => {
        setShowRecovered(false);
      }, 4000);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (recoveryTimer !== null) {
        window.clearTimeout(recoveryTimer);
      }
    };
  }, []);

  if (!isOnline) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Network connection lost. We will keep the current screen open and retry safe requests when
        the connection comes back.
      </div>
    );
  }

  if (!showRecovered) {
    return null;
  }

  return (
    <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      Connection restored. The dashboard is back online.
    </div>
  );
}
