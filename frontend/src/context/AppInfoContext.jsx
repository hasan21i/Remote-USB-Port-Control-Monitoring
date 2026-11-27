import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import { axiosInstance } from '../utils/api';
import pkg from '../../package.json';

const AppInfoContext = createContext({
  companyName: pkg.name,
  version: pkg.version,
  buildTime: process.env.REACT_APP_BUILD_TIME || new Date().toISOString(),
  loading: true,
  error: null,
});

export const AppInfoProvider = ({ children }) => {
  const [info, setInfo] = useState({
    companyName: pkg.name,
    version: pkg.version,
    buildTime: process.env.REACT_APP_BUILD_TIME || new Date().toISOString(),
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;
    axiosInstance
      .get('/app/info')
      .then(({ data }) => {
        if (!mounted) return;
        setInfo({
          companyName: data.companyName || pkg.name,
          version: data.version || pkg.version,
          buildTime: data.buildTime || process.env.REACT_APP_BUILD_TIME || new Date().toISOString(),
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        console.error('Failed to fetch app info:', err);
        if (!mounted) return;
        setInfo((prev) => ({
          ...prev,
          loading: false,
          error: err.message || 'خطأ في جلب معلومات التطبيق',
        }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(() => info, [info]);

  return (
    <AppInfoContext.Provider value={value}>
      {children}
    </AppInfoContext.Provider>
  );
};

AppInfoProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useAppInfo = () => {
  const context = useContext(AppInfoContext);
  if (!context) {
    throw new Error('useAppInfo must be used within an AppInfoProvider');
  }
  return context;
};

export default AppInfoContext;
