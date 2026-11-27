// src/index.jsx
import React, { Suspense } from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import './styles/main.css';
import './styles/components.css';
import './styles/utilities.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100">
          <h1 className="text-2xl font-semibold mb-3">حدث خطأ غير متوقع</h1>
          <p className="mb-4">نأسف لذلك. الرجاء إعادة تحميل الصفحة أو المحاولة لاحقًا.</p>
          <button
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
            onClick={() => window.location.reload()}
          >
            إعادة تحميل
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
};

(function applyInitialTheme() {
  const stored = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (stored === 'dark' || (!stored && prefersDark)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
})();

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <Suspense
            fallback={
              <div className="flex items-center justify-center min-h-screen bg-white dark:bg-gray-900">
                {/* Built-in spinner rather than a missing component */}
                <div className="spinner-border" role="status" />
                <span className="ms-2">جارٍ التحميل…</span>
              </div>
            }
          >
            <App />
          </Suspense>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
