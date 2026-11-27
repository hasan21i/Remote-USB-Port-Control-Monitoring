// src/hooks/useSocketEvent.js
import { useEffect, useCallback } from 'react';
import useSocket from './useSocket';

// Hook للاشتراك في أحداث Socket.IO على namespace '/api/devices'
const useSocketEvent = (eventName, handler) => {
  const { subscribe } = useSocket();
  const stableHandler = useCallback(handler, [handler]);

  useEffect(() => {
    if (!eventName || typeof stableHandler !== 'function') return;
    const unsubscribe = subscribe(eventName, stableHandler, '/api/devices');
    return () => unsubscribe && unsubscribe();
  }, [eventName, stableHandler, subscribe]);
};

export default useSocketEvent;
