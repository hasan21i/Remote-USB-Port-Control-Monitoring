// src/context/ServerContext.jsx

import React, {
  createContext,
  useReducer,
  useCallback,
  useEffect,
} from 'react';
import PropTypes from 'prop-types';
import {
  fetchServers,    // GET    /api/servers
  fetchServer,     // GET    /api/servers/:id
  registerServer,  // POST   /api/servers
  serverHeartbeat, // POST   /api/servers/heartbeat
  serverSync,      // POST   /api/servers/sync
} from '../utils/api';
import { axiosInstance } from '../utils/api';

const initialState = {
  servers: [],
  isLoading: false,
  error: null,
  lastHeartbeatUpdate: null,
  apiKey: localStorage.getItem('server_api_key') || null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_INIT':
    case 'ADD_SERVER_INIT':
    case 'UPDATE_SERVER_INIT':
    case 'DELETE_SERVER_INIT':
    case 'HEARTBEAT_INIT':
      return { ...state, isLoading: true, error: null };

    case 'FETCH_SUCCESS':
      return { ...state, isLoading: false, servers: action.payload };

    case 'ADD_SERVER_SUCCESS':
      return {
        ...state,
        isLoading: false,
        servers: [...state.servers, action.payload],
      };

    case 'UPDATE_SERVER_SUCCESS':
      return {
        ...state,
        isLoading: false,
        servers: state.servers.map(s =>
          s.id === action.payload.id ? action.payload : s
        ),
      };

    case 'DELETE_SERVER_SUCCESS':
      return {
        ...state,
        isLoading: false,
        servers: state.servers.filter(s => s.id !== action.payload),
      };

    case 'HEARTBEAT_SUCCESS':
      return {
        ...state,
        isLoading: false,
        lastHeartbeatUpdate: Date.now(),
        servers: state.servers.map(s =>
          s.id === action.payload.id
            ? { ...s, lastHeartbeat: action.payload.lastHeartbeat }
            : s
        ),
      };

    case 'FETCH_FAILURE':
    case 'ADD_SERVER_FAILURE':
    case 'UPDATE_SERVER_FAILURE':
    case 'DELETE_SERVER_FAILURE':
    case 'HEARTBEAT_FAILURE':
      return { ...state, isLoading: false, error: action.error };

    default:
      return state;
  }
}

export const ServerContext = createContext({
  ...initialState,
  getServers: () => Promise.resolve([]),
  getServer: _id => Promise.resolve(null),
  addServer: _data => Promise.resolve(null),
  updateServer: (_id, _data) => Promise.resolve(null),
  deleteServer: _id => Promise.resolve(),
  heartbeat: _id => Promise.resolve(null),
  syncServer: _id => Promise.resolve(null),
});

export const ServerProvider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  // 1. جلب قائمة الخوادم
  const getServers = useCallback(async () => {
    dispatch({ type: 'FETCH_INIT' });
    try {
      const resp = await fetchServers();
      const list = (resp && resp.servers) ? resp.servers : [];
      dispatch({ type: 'FETCH_SUCCESS', payload: list });
      return list;
    } catch (err) {
      dispatch({ type: 'FETCH_FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // 2. جلب تفاصيل خادم واحد
  const getServer = useCallback(async id => {
    dispatch({ type: 'FETCH_INIT' });
    try {
      const resp = await fetchServer(id);
      return resp?.server || resp?.data?.server || null;
    } catch (err) {
      dispatch({ type: 'FETCH_FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // 3. إنشاء خادم جديد
  const addServer = useCallback(async data => {
    dispatch({ type: 'ADD_SERVER_INIT' });
    try {
      const resp = await registerServer(data);
      const newSrv = resp?.server || resp?.data?.server || resp;
      if (resp.api_key) {
        localStorage.setItem('server_api_key', resp.api_key);
        state.apiKey = resp.api_key;
      }
      dispatch({ type: 'ADD_SERVER_SUCCESS', payload: newSrv });
      return newSrv;
    } catch (err) {
      dispatch({ type: 'ADD_SERVER_FAILURE', error: err.message });
      throw err;
    }
  }, [state]);

  // 4. تحديث خادم موجود
  const updateServer = useCallback(async (id, data) => {
    dispatch({ type: 'UPDATE_SERVER_INIT' });
    try {
      const resp = await axiosInstance.put(`/servers/${id}`, data);
      const updated = resp?.data?.server || resp?.server || resp?.data;
      dispatch({ type: 'UPDATE_SERVER_SUCCESS', payload: updated });
      return updated;
    } catch (err) {
      dispatch({ type: 'UPDATE_SERVER_FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // 5. حذف خادم
  const deleteServer = useCallback(async id => {
    dispatch({ type: 'DELETE_SERVER_INIT' });
    try {
      await axiosInstance.delete(`/servers/${id}`);
      dispatch({ type: 'DELETE_SERVER_SUCCESS', payload: id });
    } catch (err) {
      dispatch({ type: 'DELETE_SERVER_FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // 6. إرسال نبضة حياة وتحديث الحالة
  const heartbeat = useCallback(async id => {
    dispatch({ type: 'HEARTBEAT_INIT' });
    try {
      const apiKey = state.apiKey || localStorage.getItem('server_api_key');
      await serverHeartbeat(id, apiKey);
      const lastHeartbeat = new Date().toISOString();
      dispatch({
        type: 'HEARTBEAT_SUCCESS',
        payload: { id, lastHeartbeat },
      });
      return lastHeartbeat;
    } catch (err) {
      dispatch({ type: 'HEARTBEAT_FAILURE', error: err.message });
      throw err;
    }
  }, [state.apiKey]);

  // 7. مزامنة الخادم
  const syncServer = useCallback(async id => {
    try {
      const apiKey = state.apiKey || localStorage.getItem('server_api_key');
      const resp = await serverSync(id, apiKey);
      return resp;
    } catch (err) {
      throw err;
    }
  }, [state.apiKey]);

  // إعادة جلب القائمة عند التهيئة وبعد كل نبضة حياة
  useEffect(() => {
    getServers();
  }, [getServers, state.lastHeartbeatUpdate]);

  return (
    <ServerContext.Provider
      value={{
        servers: state.servers,
        isLoading: state.isLoading,
        error: state.error,
        getServers,
        getServer,
        addServer,
        updateServer,
        deleteServer,
        heartbeat,
        syncServer,
      }}
    >
      {children}
    </ServerContext.Provider>
  );
};

ServerProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
