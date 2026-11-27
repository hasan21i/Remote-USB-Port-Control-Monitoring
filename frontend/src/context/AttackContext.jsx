// src/context/AttackContext.jsx

import React, { createContext, useReducer, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import { fetchAttacks, confirmAttack } from '../utils/api';

const initialState = {
  attacks: [],
  selected: null,
  isLoading: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'LIST_INIT':
      return { ...state, isLoading: true, error: null };
    case 'LIST_SUCCESS':
      return { ...state, isLoading: false, attacks: action.payload };
    case 'LIST_FAILURE':
      return { ...state, isLoading: false, error: action.error };

    case 'CONFIRM_INIT':
      return { ...state, isLoading: true, error: null };
    case 'CONFIRM_SUCCESS': {
      const updated = action.payload;
      return {
        ...state,
        isLoading: false,
        attacks: state.attacks.map(a =>
          a.id === updated.id ? updated : a
        ),
        selected: updated
      };
    }
    case 'CONFIRM_FAILURE':
      return { ...state, isLoading: false, error: action.error };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    default:
      return state;
  }
}

export const AttackContext = createContext({
  ...initialState,
  /** Fetch the list of attacks (returns the array) */
  fetchList: async () => [],
  /** Get a single attack from the loaded list by ID */
  fetchDetail: id => null,
  /** Confirm an attack by ID (returns the updated attack) */
  confirm: async () => null,
});

export const AttackProvider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  /**
   * Fetch the list of attacks from the backend.
   * Expects the API to return { attacks: [...] } or [...] directly.
   */
  const fetchList = useCallback(async (params = {}) => {
    dispatch({ type: 'LIST_INIT' });
    try {
      const resp = await fetchAttacks(params);
      // The API might return { attacks: [...] } or an array directly.
      let list = [];
      if (Array.isArray(resp?.data)) {
        list = resp.data;
      } else if (Array.isArray(resp?.data?.attacks)) {
        list = resp.data.attacks;
      } else if (resp?.data && typeof resp.data === 'object') {
        // Sometimes API returns {attacks: undefined} or {attacks: null}
        list = Array.isArray(resp.data.attacks) ? resp.data.attacks : [];
      }
      dispatch({ type: 'LIST_SUCCESS', payload: list });
      return list;
    } catch (err) {
      dispatch({ type: 'LIST_FAILURE', error: err.message });
      // في حالة الخطأ، أعد مصفوفة فارغة
      return [];
    }
  }, []);

  /**
   * Retrieve a single attack from the already-loaded list.
   */
  const fetchDetail = useCallback(
    id => state.attacks.find(a => a.id === id) || null,
    [state.attacks]
  );

  /**
   * Confirm an attack via the backend.
   * Expects the API to return { attack: { ...updatedAttack } } or the updated object directly.
   */
  const confirm = useCallback(async id => {
    dispatch({ type: 'CONFIRM_INIT' });
    try {
      const resp = await confirmAttack(id);
      const updated = resp.data.attack ?? resp.data;
      dispatch({ type: 'CONFIRM_SUCCESS', payload: updated });
      return updated;
    } catch (err) {
      dispatch({ type: 'CONFIRM_FAILURE', error: err.message });
      throw err;
    }
  }, []);

  // دالة لمسح الخطأ
  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  // Load attacks on mount
  useEffect(() => {
    fetchList();
  }, [fetchList]);

  return (
    <AttackContext.Provider value={{
      attacks: state.attacks,
      selected: state.selected,
      isLoading: state.isLoading,
      error: state.error,
      fetchList,
      fetchDetail,
      confirm,
      clearError
    }}>
      {children}
    </AttackContext.Provider>
  );
};

AttackProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
