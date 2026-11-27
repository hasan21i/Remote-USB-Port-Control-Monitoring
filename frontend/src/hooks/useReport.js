// src/hooks/useReport.js

import { useContext, useCallback, useMemo } from 'react';
import { ReportContext } from '../context/ReportContext';

/**
 * Hook للتعامل مع تعريفات التقارير وسجل تشغيلها.
 *
 * يجب أن يُستخدم داخل <ReportProvider>.
 *
 * @returns {{
 *   reports: Array<Object>,
 *   history: Array<Object>,
 *   isLoading: boolean,
 *   error: string | null,
 *   fetchReports: (filters?: Object) => Promise<Array<Object>>,
 *   fetchReportHistory: (reportId: string|number, opts?: {limit?: number, offset?: number}) => Promise<Array<Object>>,
 *   scheduleReport: (data: Object) => Promise<Object>,
 *   runReport: (reportId: string|number) => Promise<Object>,
 *   clearError: () => void
 * }}
 *
 * @throws {Error} إذا لم يُستخدم داخل <ReportProvider>
 */
const useReport = () => {
  const context = useContext(ReportContext);
  if (!context) {
    throw new Error('useReport must be used within a ReportProvider');
  }

  const {
    reports,
    history,
    isLoading,
    error,
    schedule,      // from ReportContext: schedules a new report
    run,           // from ReportContext: runs a report immediately
    fetchHistory,  // from ReportContext: fetches run history
    clearError,    // from ReportContext: clears any error
  } = context;

  // fetchReports: تمرير فلتر إلى scheduleَ / runَ / fetchHistoryَ غير مطلوب
  const fetchReports = useCallback(
    (_filters = {}) => {
      // if you actually have an endpoint that lists all report definitions
      // you'd call it here; if not, simply return the current array:
      return Promise.resolve(reports);
    },
    [reports]
  );

  const fetchReportHistory = useCallback(
    (reportId, { limit = 20, offset = 0 } = {}) =>
      fetchHistory(reportId, limit, offset),
    [fetchHistory]
  );

  const scheduleReport = useCallback(
    (data) => schedule(data),
    [schedule]
  );

  const runReport = useCallback(
    (reportId) => run(reportId),
    [run]
  );

  const dismissError = useCallback(
    () => clearError && clearError(),
    [clearError]
  );

  return useMemo(() => ({
    reports,
    history,
    isLoading,
    error,
    fetchReports,
    fetchReportHistory,
    scheduleReport,
    runReport,
    clearError: dismissError,
  }), [
    reports, history, isLoading, error,
    fetchReports, fetchReportHistory,
    scheduleReport, runReport, dismissError
  ]);
};

export default useReport;
