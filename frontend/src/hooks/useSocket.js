import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';
import useAuth from './useAuth';
import { getWebSocketStatus } from '../utils/api';
import backendConfig from '../backend_config.json';

/**
 * Hook لإدارة اتصال WebSocket مع Socket.IO
 *
 * ملاحظات مهمة للمطور:
 * - إذا واجهت أخطاء "Invalid frame header" أو "ERR_NAME_NOT_RESOLVED":
 *   1. تأكد من أن الخادم يدعم WebSocket
 *   2. استخدم REACT_APP_FORCE_POLLING=true في .env للتبديل إلى polling فقط
 *   3. أو استخدم REACT_APP_DISABLE_WEBSOCKET=true لتعطيل WebSocket تماماً
 * - الـ endpoint الافتراضي هو من backend_config.json أو localhost:5000
 * - يتم تجربة polling أولاً ثم WebSocket للتوافق الأفضل
 */

const backendIp = backendConfig?.BACKEND_IP || 'localhost';
const backendPort = backendConfig?.BACKEND_PORT || 5000;

const DEFAULT_ENDPOINT =
  process.env.REACT_APP_SOCKET_ENDPOINT ||
  `http://${backendIp}:${backendPort}`;

const DEFAULT_MAX_ATTEMPTS = 3;

const useSocket = (
  endpoint = DEFAULT_ENDPOINT,
  options = {},
  disabled = process.env.REACT_APP_DISABLE_WEBSOCKET === 'true'
) => {
  const { isAuthenticated: _isAuthenticated, refreshToken: _refreshToken } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [error, setError] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [websocketConfig, setWebsocketConfig] = useState(null);

  const socketRef = useRef(null);
  const namespacesRef = useRef({});
  const MAX_ATTEMPTS = options.reconnectionAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // جلب معلومات WebSocket من الخادم
  useEffect(() => {
    const fetchWebSocketConfig = async () => {
      try {
        const config = await getWebSocketStatus();
        setWebsocketConfig(config);
      } catch (error) {
        console.warn('Failed to fetch WebSocket config, using defaults:', error);
        // استخدام إعدادات أكثر أماناً
        setWebsocketConfig({
          websocket_url: process.env.REACT_APP_API_BASE_URL?.replace('/api', '') || 'http://localhost:5000',
          namespaces: ['/api/devices', '/api/servers', '/api/logs']
        });
      }
    };

    fetchWebSocketConfig();
  }, []);

  // تحديث التوكن في socket.io auth
  const _updateSocketAuth = useCallback((token) => {
    if (socketRef.current) {
      socketRef.current.auth = { token };
    }
  }, []);

  const socketOptions = useMemo(
    () => ({
      autoConnect: false,
      // By default prefer polling to avoid 'Invalid frame header' errors when
      // the backend is running in a mode that doesn't support websocket upgrades
      transports: process.env.REACT_APP_ENABLE_WEBSOCKET === 'true'
        ? (process.env.REACT_APP_FORCE_POLLING === 'true' ? ['polling'] : ['polling', 'websocket'])
        : ['polling'],
      // Allow connecting to older Engine.IO (v3) servers when explicitly enabled
      // Set REACT_APP_ALLOW_EIO3=true to allow connecting to older python-socketio servers
      allowEIO3: process.env.REACT_APP_ALLOW_EIO3 === 'true',
      reconnection: true,
      reconnectionAttempts: MAX_ATTEMPTS,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 10000,
  timeout: 20000,
  path: process.env.REACT_APP_SOCKET_PATH || '/socket.io',
      forceNew: false,
      upgrade: true,
      rememberUpgrade: true,
      // إضافة إعدادات أمان إضافية
      rejectUnauthorized: false,
      ...options,
    }),
    [options, MAX_ATTEMPTS]
  );

  const connect = useCallback(async () => {
    if (disabled) {
      console.warn('WebSocket connection is disabled via environment variable.');
      setError('WebSocket معطل');
      return;
    }

    // التحقق من وجود endpoint صحيح
    let currentEndpoint = endpoint;
    if (!currentEndpoint || currentEndpoint === 'http://server' || currentEndpoint.includes('server')) {
      console.warn('Invalid WebSocket endpoint, using localhost fallback');
      currentEndpoint = 'http://localhost:5000';
    }

    // استخدام WebSocket config إذا كان متوفراً
    let socketEndpoint = websocketConfig?.websocket_url || currentEndpoint;

    // التأكد من أن الـ endpoint يستخدم HTTP وليس WS (socket.io يحتاج HTTP URL)
    if (socketEndpoint.startsWith('ws://')) {
      socketEndpoint = socketEndpoint.replace('ws://', 'http://');
    } else if (socketEndpoint.startsWith('wss://')) {
      socketEndpoint = socketEndpoint.replace('wss://', 'https://');
    } else if (!socketEndpoint.startsWith('http://') && !socketEndpoint.startsWith('https://')) {
      // إذا لم يبدأ بـ http أو https، أضف http://
      socketEndpoint = `http://${socketEndpoint}`;
    }

    // إزالة أي paths إضافية من الـ endpoint
    try {
      const url = new URL(socketEndpoint);
      socketEndpoint = `${url.protocol}//${url.host}`;
    } catch (e) {
      console.warn('Invalid URL format, using fallback:', socketEndpoint);
      socketEndpoint = 'http://localhost:5000';
    }

    const accessToken = localStorage.getItem('access_token');
    const auth = accessToken ? { token: accessToken } : undefined;

    if (!socketRef.current) {
      try {
        // محاولة الاتصال
        socketRef.current = io(socketEndpoint, {
          auth,
          ...socketOptions,
          // إضافة إعدادات إضافية للأمان
          forceNew: true,
          upgrade: true,
          rememberUpgrade: true,
        });

        socketRef.current.on('connect', () => {
          // WebSocket connected successfully
          setIsConnected(true);
          setError(null);
          setAttempts(0);
        });

        socketRef.current.on('disconnect', (_reason) => {
          setIsConnected(false);
          // تم قطع الاتصال
        });

        socketRef.current.on('connect_error', (error) => {
          setError(`فشل الاتصال: ${error.message}`);
          setAttempts(prev => prev + 1);

          // إذا كان الخطأ متعلق بـ WebSocket، جرب polling فقط
          if (error.message.includes('Invalid frame header') ||
              error.message.includes('WebSocket') ||
              error.message.includes('ERR_NAME_NOT_RESOLVED')) {
            if (socketRef.current) {
              socketRef.current.disconnect();
              // إعادة إنشاء الاتصال بـ polling فقط
              setTimeout(() => {
                socketRef.current = io(socketEndpoint, {
                  ...socketOptions,
                  transports: ['polling'],
                  auth,
                });
                socketRef.current.connect();
              }, 1000);
            }
          }

          if (attempts >= MAX_ATTEMPTS) {
            socketRef.current?.disconnect();
          }
        });

        socketRef.current.on('reconnect_attempt', (_attempt) => {
          // محاولة إعادة الاتصال
        });
      } catch (error) {
        console.error('Failed to create socket connection:', error);
        setError(`خطأ في إنشاء الاتصال: ${error.message}`);
      }
    }

    if (socketRef.current && !socketRef.current.connected) {
      socketRef.current.connect();
    }
  }, [disabled, websocketConfig, endpoint, socketOptions, attempts, MAX_ATTEMPTS]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const sendMessage = useCallback(
    (event, payload) => {
      if (socketRef.current && isConnected) {
        socketRef.current.emit(event, payload);
        return true;
      }
      setError('Cannot emit, socket not connected.');
      return false;
    },
    [isConnected]
  );

  const subscribe = useCallback((event, handler, namespace = '/api/devices') => {
    // أنشئ/استخدم socket خاص بالـ namespace عبر اتصال منفصل
    let nsp = namespacesRef.current[namespace];
    if (!nsp) {
      // Compute base URL from existing socket if available, otherwise fall back to configured websocket URL or default
      const baseUrl = socketRef.current?.io?.opts?.hostname
        ? `${socketRef.current.io.opts.secure ? 'https' : 'http'}://${socketRef.current.io.opts.hostname}${socketRef.current.io.opts.port ? ':' + socketRef.current.io.opts.port : ''}`
        : (websocketConfig?.websocket_url || endpoint || DEFAULT_ENDPOINT);
      const nsUrl = baseUrl ? `${baseUrl}${namespace}` : `${DEFAULT_ENDPOINT}${namespace}`;
      const accessToken = localStorage.getItem('access_token');
      nsp = io(nsUrl, { ...socketOptions, auth: accessToken ? { token: accessToken } : undefined });
      namespacesRef.current[namespace] = nsp;
    }

    // تأكد من عدم تكرار المستمعين
    nsp.off?.(event);
    nsp.on?.(event, (data) => {
      setLastMessage({ event, data, namespace });
      handler(data);
    });

    return () => {
      if (nsp?.off) {
        nsp.off(event);
      }
    };
  }, [socketOptions, websocketConfig?.websocket_url, endpoint]);

  const unsubscribe = useCallback((event) => {
    if (!socketRef.current) return false;
    socketRef.current.off(event);
    return true;
  }, []);

  useEffect(() => {
    // NOTE: we intentionally do *not* call connect() here.  previously the hook
    // would open a socket to the root namespace ("/") on every mount, which the
    // server does not support and resulted in HTTP 400 errors (seen clearly on the
    // reports page).  All real work is done by subscribe(), which creates its own
    // namespace-specific socket when an event listener is registered, so there is
    // no need for a global connection by default.
    //
    // The connect() function remains exported for callers that explicitly need to
    // form a root socket, but it will not run automatically anymore.

    // Capture current namespaces at effect creation time
    const namespacesToCleanup = namespacesRef.current;
    
    return () => {
      if (socketRef.current) {
        try { socketRef.current.off(); } catch {}
        
        // Use captured namespaces value
        Object.values(namespacesToCleanup || {}).forEach((ns) => {
          try { ns.off && ns.off(); } catch {}
        });
        
        try { socketRef.current.disconnect(); } catch {}
      }
    };
  }, [connect, disabled]);

  return {
    socket: socketRef.current,
    isConnected,
    lastMessage,
    error,
    attempts,
    connect,
    disconnect,
    sendMessage,
    subscribe,
    unsubscribe,
  };
};

export default useSocket;
