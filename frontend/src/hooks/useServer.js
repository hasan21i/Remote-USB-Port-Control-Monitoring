// src/hooks/useServer.js

import { useContext, useCallback, useMemo } from 'react';
import { ServerContext } from '../context/ServerContext';

/**
 * Hook للاطلاع على بيانات الخوادم والتعامل معها.
 *
 * Must be used within a <ServerProvider>.
 *
 * @returns {{
 *   servers: Array<Object>,
 *   isLoading: boolean,
 *   error: string | null,
 *   lastHeartbeatUpdate: number | null,
 *   fetchServers: () => Promise<Array<Object>>,
 *   fetchServer: (id: number|string) => Promise<Object>,
 *   createServer: (data: Object) => Promise<Object>,
 *   updateServer: (id: number|string, data: Object) => Promise<Object>,
 *   deleteServer: (id: number|string) => Promise<void>,
 *   sendHeartbeat: (id: number|string) => Promise<string>
 * }}
 */
const useServer = () => {
  const context = useContext(ServerContext);
  if (!context) {
    throw new Error('useServer must be used within a ServerProvider');
  }

  const {
    servers,
    isLoading,
    error,
    lastHeartbeatUpdate,
    getServers,
    getServer,
    addServer,
    updateServer,
    deleteServer,
    heartbeat,
  } = context;

  // أغلفة ثابتة بالإعتماد على التوابع من السياق
  const fetchServers = useCallback(
    () => getServers(),
    [getServers]
  );

  const fetchServer = useCallback(
    (id) => getServer(id),
    [getServer]
  );

  const createServer = useCallback(
    (data) => addServer(data),
    [addServer]
  );

  const modifyServer = useCallback(
    (id, data) => updateServer(id, data),
    [updateServer]
  );

  const removeServer = useCallback(
    (id) => deleteServer(id),
    [deleteServer]
  );

  const sendHeartbeat = useCallback(
    (id) => heartbeat(id),
    [heartbeat]
  );

  // تجميع القيم والإجراءات معًا
  return useMemo(() => ({
    servers,
    isLoading,
    error,
    lastHeartbeatUpdate,
    fetchServers,
    fetchServer,
    createServer,
    updateServer: modifyServer,
    deleteServer: removeServer,
    sendHeartbeat,
  }), [
    servers,
    isLoading,
    error,
    lastHeartbeatUpdate,
    fetchServers,
    fetchServer,
    createServer,
    modifyServer,
    removeServer,
    sendHeartbeat,
  ]);
};

export default useServer;
