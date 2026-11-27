import re

app_path = r'C:\Users\BLU\Desktop\USB-Agent-App\src\App.jsx'

with open(app_path, 'r', encoding='utf-8') as f:
    content = f.read()

new_ui = """  return (
    <div className="app-container" data-theme="dark">
      {/* Custom Title Bar for Dragging */}
      <div style={{ WebkitAppRegion: 'drag', position: 'absolute', top: 0, left: 0, right: 0, height: '30px', zIndex: 9999 }}></div>

      {currentView === 'welcome' ? (
        <div id="splash-screen" className="fullscreen-overlay active-overlay">
          <div className="splash-content">
            <div className="logo-shield large-shield"></div>
            <h1>Smart Zero-Trust Security</h1>
            <p>نظام مراقبة وحماية منافذ USB المتقدم</p>
            <button id="startBtn" className="btn btn-primary large-btn" onClick={handleStart}>
              ابدأ النظام (Start)
            </button>
            <div className="mt-4" style={{ marginTop: '20px' }}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                <strong>Developed by<br/>Hasan Ali Hasan Saleh<br/>Alpha Team - Development Department</strong>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="header" style={{ position: 'relative', zIndex: 1000 }}>
            <div className="header-logo">
              <div className="logo-shield"></div>
              <div className="header-titles">
                <h1>Smart Zero-Trust Security</h1>
                <h2>نظام إدارة USB - العميل</h2>
              </div>
            </div>
            <div className="header-controls" style={{ display: 'flex', alignItems: 'center' }}>
              <span className={`badge ${status === 'online' ? 'badge-allowed' : 'badge-blocked'}`} style={{ marginRight: '15px' }}>
                {status === 'online' ? (subServerConnected ? 'سيرفر فرعي' : 'متصل') : 'غير متصل'}
              </span>
              <button onClick={() => setCurrentView('welcome')} className="btn btn-primary" style={{ marginRight: '10px' }}>عودة للترحيب</button>
              <button style={{ WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.minimizeWindow && window.electronAPI.minimizeWindow()} className="btn-icon" title="تصغير">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <button style={{ WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.closeWindow && window.electronAPI.closeWindow()} className="btn-icon" title="إغلاق">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </header>

          {/* Login Overlay if not connected */}
          {status !== 'online' && (
             <div id="login-screen" className="fullscreen-overlay active-overlay" style={{ top: '65px', background: 'var(--bg-base)' }}>
                <div className="login-box">
                    <div className="logo-shield medium-shield" style={{ margin: '0 auto 20px' }}></div>
                    <h2>تسجيل الدخول للنظام</h2>
                    <p>يرجى إدخال البريد الإلكتروني وكلمة المرور للربط بالسيرفر المركزي</p>
                    <div className="login-form">
                        <input 
                          type="text" 
                          placeholder="البريد الإلكتروني" 
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required 
                        />
                        <input 
                          type="password" 
                          placeholder="كلمة المرور" 
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required 
                        />
                        <button 
                          id="loginSubmitBtn" 
                          className="btn btn-primary full-width"
                          onClick={handleConnect}
                          disabled={connecting || !email || !password}
                        >
                          {connecting ? 'جاري الاتصال...' : 'تسجيل الدخول'}
                        </button>
                        {loginMessage && (
                          <p id="loginErrorMsg" className="error-msg" style={{ color: loginMessage.includes('❌') ? 'var(--status-blocked)' : 'var(--status-safe)' }}>
                            {loginMessage}
                          </p>
                        )}
                    </div>
                </div>
             </div>
          )}

          {/* Main Layout if connected */}
          {status === 'online' && (
            <main className="main-content">
              {/* Sidebar */}
              <aside className="sidebar">
                <div className="status-card system-secure">
                  <div className="status-icon">✓</div>
                  <h3>حالة النظام</h3>
                  <p>مُفعل ومؤمن</p>
                </div>
                
                <nav className="side-nav">
                  <a href="#" className="nav-item active">الأجهزة المتصلة ({connectedCount ?? 0})</a>
                  <a href="#" className="nav-item" style={{ borderBottom: '1px solid var(--border-color)' }}>الأجهزة المعلقة ({pendingCount ?? 0})</a>
                  
                  {/* System Info Brief */}
                  <div className="mt-4" style={{ marginTop: '20px', padding: '10px' }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 'bold' }}>معلومات النظام:</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '5px' }}>{systemInfo?.hostname || 'جاري التحميل...'}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '5px' }}>{systemInfo?.ip || '127.0.0.1'}</div>
                    <div>
                      <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={handleRefreshSystemInfo}>تحديث العنوان</button>
                    </div>
                  </div>
                </nav>
              </aside>

              {/* Dashboard Content */}
              <section id="devices-section" className="dashboard active-section">
                
                {loginMessage && (
                  <div style={{ backgroundColor: loginMessage.includes('❌') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(212, 175, 55, 0.1)', padding: '15px', borderRadius: '8px', marginBottom: '20px', color: loginMessage.includes('❌') ? 'var(--status-blocked)' : 'var(--accent-gold)', border: loginMessage.includes('❌') ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(212, 175, 55, 0.2)' }}>
                    {loginMessage}
                  </div>
                )}

                <div className="dashboard-header d-flex justify-content-between align-items-center" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <div>
                    <h2>الأجهزة المتصلة الحالية</h2>
                    <p>قائمة بمنافذ الـ USB المعتمدة والموصولة بالخادم.</p>
                  </div>
                  <button className="btn btn-primary" onClick={async () => {
                    if (window.electronAPI?.getSystemInfo) { setSystemInfo(await window.electronAPI.getSystemInfo()); }
                    if (window.electronAPI?.runOnceDiscovery) { await window.electronAPI.runOnceDiscovery(); }
                  }}>تحديث الإحصائيات</button>
                </div>

                <div className="table-container mb-4" style={{ marginBottom: '40px' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'right' }}>معرف الجهاز (VID:PID)</th>
                        <th style={{ textAlign: 'right' }}>اسم الجهاز</th>
                        <th style={{ textAlign: 'right' }}>الفئة (Class)</th>
                        <th style={{ textAlign: 'center' }}>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedConnectedDevices && approvedConnectedDevices.length > 0 ? (
                        approvedConnectedDevices.map((device, idx) => (
                           <tr key={idx}>
                             <td dir="ltr" style={{ textAlign: 'left' }}>{device.vendor_id || '----'}:{device.product_id || '----'}</td>
                             <td>{device.name || device.device_name || 'غير معروف'}</td>
                             <td dir="ltr" style={{ textAlign: 'left' }}>{device.device_class || device.class || '-'}</td>
                             <td style={{ textAlign: 'center' }}><span className="badge badge-allowed">مسموح</span></td>
                           </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>
                            لا توجد أجهزة USB معتمدة متصلة حالياً.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="dashboard-header mt-4" style={{ marginBottom: '20px' }}>
                  <h2>الأجهزة المعلقة (غير معتمدة)</h2>
                  <p>قائمة بالأجهزة المكتشفة التي تنتظر موافقة من السيرفر المركزي.</p>
                </div>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'right' }}>معرف الجهاز (VID:PID)</th>
                        <th style={{ textAlign: 'right' }}>اسم الجهاز</th>
                        <th style={{ textAlign: 'right' }}>الرقم التسلسلي</th>
                        <th style={{ textAlign: 'center' }}>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discoveredDevicesList && discoveredDevicesList.length > 0 ? (
                         discoveredDevicesList.map((device, idx) => (
                            <tr key={idx}>
                               <td dir="ltr" style={{ textAlign: 'left' }}>{device.vendor_id || '----'}:{device.product_id || '----'}</td>
                               <td>{device.name || device.device_name || 'غير معروف'}</td>
                               <td dir="ltr" style={{ textAlign: 'left', fontFamily: 'monospace' }}>{device.serial_number || device.serial || '-'}</td>
                               <td style={{ textAlign: 'center' }}><span className="badge badge-blocked">معلق (بانتظار الموافقة)</span></td>
                            </tr>
                         ))
                      ) : (
                        <tr>
                          <td colSpan="4" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>
                            لا توجد أجهزة معلقة.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Settings Section directly in dashboard inside bottom status */}
                <div className="dashboard-header mt-4" style={{ marginBottom: '20px', marginTop: '40px' }}>
                  <h2>الإعدادات والنظام</h2>
                  <p>إعدادات الاتصال وحالة الخادم وقاعدة البيانات.</p>
                </div>
                <div className="settings-card" style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', gap: '30px' }}>
                  <div style={{ flex: 1 }}>
                      <h3 style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>حالة الخادم المركزي</h3>
                      <p style={{ color: isCentralServer || subServerConnected ? 'var(--status-safe)' : 'var(--status-blocked)' }}>
                        {isCentralServer ? 'متصل (سيرفر رئيسي)' : (subServerConnected ? 'متصل بالسيرفر الفرعي' : 'غير متصل')}
                      </p>
                  </div>
                  <div style={{ flex: 1 }}>
                      <h3 style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>حالة قاعدة البيانات</h3>
                      <p style={{ color: 'var(--status-safe)' }}>
                         متصل وقيد التشغيل
                      </p>
                  </div>
                </div>

              </section>
            </main>
          )}
        </>
      )}
    </div>
  );
}

export default App;
"""

# Find the LAST instance of `  return (` which is definitely the main render block
idx = content.rfind('  return (\n    <div className="app-container" data-theme="dark">')
if idx == -1:
    # try just `<div className="app-container" data-theme="dark">`
    idx = content.rfind('  return (\n      <div className="app-container"')
    if idx == -1:
        idx = content.rfind('  return (\n')
        
if idx != -1:
    # replace from that idx to the end
    result = content[:idx] + new_ui
    with open(app_path, 'w', encoding='utf-8') as f:
        f.write(result)
    print("UI replaced successfully")
else:
    print("Could not find start of the return block.")

