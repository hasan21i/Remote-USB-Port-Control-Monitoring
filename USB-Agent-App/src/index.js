import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

window.onerror = function(message, source, lineno, colno, error) {
  document.body.innerHTML = `<div style="color:red; padding:20px; font-family:sans-serif; background:white; z-index:9999; position:absolute; top:0; left:0; width:100%; height:100%;">
    <h2>Global Error Caught</h2>
    <p>${message}</p>
    <pre>${error ? error.stack : ''}</pre>
  </div>`;
};
window.onunhandledrejection = function(event) {
  document.body.innerHTML += `<div style="color:red; padding:20px; font-family:sans-serif; background:white; z-index:9999; position:absolute; top:50%; left:0; width:100%; height:50%;">
    <h2>Unhandled Promise Rejection</h2>
    <pre>${event.reason ? event.reason.stack || event.reason : event}</pre>
  </div>`;
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: '20px', background: 'white', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 9999 }}>
          <h2>React Render Error Caught</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.error && this.state.error.stack}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
