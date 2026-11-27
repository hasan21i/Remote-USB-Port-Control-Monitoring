// src/context/ReportContext.jsx

import React, { createContext, useReducer, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import { axiosInstance, scheduleReport, runReport, fetchReportHistory } from '../utils/api';

const initialState = {
  list: [],
  history: {},       // التاريخ لكل تقرير، مفهرس بمعرف التقرير
  isLoading: false,
  error: null
};

function reducer(state, action) {
  switch (action.type) {
    case 'INIT':
      return { ...state, isLoading: true, error: null };

    case 'LIST_SUCCESS':
      return { ...state, isLoading: false, list: action.payload };

    case 'SCHEDULE_SUCCESS':
      return {
        ...state,
        isLoading: false,
        list: [...state.list, action.payload]
      };

    case 'RUN_SUCCESS': {
      const updated = action.payload;
      return {
        ...state,
        isLoading: false,
        list: state.list.map(r => (r.id === updated.id ? updated : r))
      };
    }

    case 'HISTORY_SUCCESS':
      return {
        ...state,
        isLoading: false,
        history: {
          ...state.history,
          [action.meta.id]: action.payload
        }
      };

    case 'FAILURE':
      return { ...state, isLoading: false, error: action.error };

    default:
      return state;
  }
}

export const ReportContext = createContext({
  ...initialState,
  loadReports: async () => [],
  schedule: async () => null,
  run: async () => null,
  fetchHistory: async () => []
});

export const ReportProvider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { list, history, isLoading, error } = state;

  // جلب قائمة التقارير من الـ API
  const loadReports = useCallback(async (query = {}) => {
    dispatch({ type: 'INIT' });
    try {
      const resp = await axiosInstance.get('/reports/reports', { params: query });
      dispatch({ type: 'LIST_SUCCESS', payload: resp.data });
      return resp.data;
    } catch (err) {
      dispatch({ type: 'FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // جدولة تقرير جديد
  const schedule = useCallback(async (data) => {
    dispatch({ type: 'INIT' });
    try {
      const resp = await scheduleReport(data);
      dispatch({ type: 'SCHEDULE_SUCCESS', payload: resp.data });
      return resp.data;
    } catch (err) {
      dispatch({ type: 'FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // تشغيل تقرير موجود (run)
  const run = useCallback(async (id) => {
    dispatch({ type: 'INIT' });
    try {
      const resp = await runReport(id);
      dispatch({ type: 'RUN_SUCCESS', payload: resp.data });
      return resp.data;
    } catch (err) {
      dispatch({ type: 'FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // جلب تاريخ تقرير معين
  const fetchHistoryById = useCallback(async (id) => {
    dispatch({ type: 'INIT' });
    try {
      const resp = await fetchReportHistory(id);
      dispatch({ type: 'HISTORY_SUCCESS', payload: resp.data, meta: { id } });
      return resp.data;
    } catch (err) {
      dispatch({ type: 'FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // حمل التقارير مرة واحدة عند التركيب
  useEffect(() => {
    loadReports();
  }, [loadReports]);

  return (
    <ReportContext.Provider
      value={{
        list,
        history,
        isLoading,
        error,
        loadReports,
        schedule,
        run,
        fetchHistory: fetchHistoryById
      }}
    >
      {children}
    </ReportContext.Provider>
  );
};

ReportProvider.propTypes = {
  children: PropTypes.node.isRequired
};
