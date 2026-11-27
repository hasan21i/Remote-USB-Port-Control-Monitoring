// src/hooks/useAuth.js

import { useContext, useMemo } from 'react';
import { AuthContext } from '../context/AuthContext';


const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  const {
    currentUser,
    isAuthenticated,
    isLoading,
    error,
    login,
    register,
    logout,
    requestPasswordReset,
    resetUserPassword,
    updateUser,
    checkAuthStatus
  } = context;

  return useMemo(
    () => ({
      currentUser,
      isAuthenticated,
      isLoading,
      error,
      login,
      register,
      logout,
      requestPasswordReset,
      resetUserPassword,
      updateUser,
      checkAuthStatus
    }),
    [
      currentUser,
      isAuthenticated,
      isLoading,
      error,
      login,
      register,
      logout,
      requestPasswordReset,
      resetUserPassword,
      updateUser,
      checkAuthStatus
    ]
  );
};

export default useAuth;

