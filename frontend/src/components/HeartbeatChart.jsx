// src/components/HeartbeatChart.jsx

import React, { useEffect, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import PropTypes from 'prop-types';

// تسجيل مكونات Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const HeartbeatChart = ({ serverName, isActive, onClose, isDarkMode }) => {
  const [heartbeatData, setHeartbeatData] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const intervalRef = useRef(null);
  const chartRef = useRef(null);

  // بيانات النبض الحقيقية - تشبه نبضات القلب الطبيعية
  const heartbeatPattern = useRef([
    0, 0, 0, 10, 50, 100, 80, 40, 20, 10, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 20, 40, 30, 15, 5, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ]).current;

  // تحديث بيانات النبض بشكل مستمر
  useEffect(() => {
    if (!isActive) return;

    const updateHeartbeat = () => {
      const now = Date.now();
      
      // إضافة تنويع عشوائي للنبض لجعله أكثر واقعية
      const baseValue = heartbeatPattern[currentTime % heartbeatPattern.length];
      const randomVariation = (Math.random() - 0.5) * 10; // تنويع ±5
      const finalValue = Math.max(0, Math.min(120, baseValue + randomVariation));
      
      const newDataPoint = {
        time: now,
        value: finalValue,
        label: new Date(now).toLocaleTimeString('ar-SA', { 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      };

      setHeartbeatData(prev => {
        const updated = [...prev, newDataPoint];
        // الاحتفاظ بآخر 60 نقطة فقط (6 ثوان بمعدل 10 نقاط/ثانية)
        return updated.slice(-60);
      });

      setCurrentTime(prev => prev + 1);
    };

    // تحديث النبض كل 100ms للحصول على حركة سلسة (10 مرات في الثانية)
    intervalRef.current = setInterval(updateHeartbeat, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive, currentTime, heartbeatPattern]);

  // بيانات المخطط
  const chartData = {
    labels: heartbeatData.map(point => point.label),
    datasets: [
      {
        label: `نبض ${serverName}`,
        data: heartbeatData.map(point => point.value),
        borderColor: 'var(--danger-color)',
        backgroundColor: 'rgba(244, 67, 54, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointBackgroundColor: 'var(--danger-color)',
        pointBorderColor: 'var(--white)',
        pointBorderWidth: 2
      }
    ]
  };

  // إعدادات المخطط
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0 // إزالة الحركة لجعلها أكثر سلاسة
    },
    interaction: {
      intersect: false,
      mode: 'index'
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: isDarkMode ? 'var(--white)' : 'var(--black)',
          font: {
            family: 'Tajawal, Arial, sans-serif',
            size: 14,
            weight: 'bold'
          }
        }
      },
      title: {
        display: true,
        text: `مراقبة نبض الخادم - ${serverName}`,
        color: isDarkMode ? 'var(--white)' : 'var(--black)',
        font: {
          family: 'Tajawal, Arial, sans-serif',
          size: 18,
          weight: 'bold'
        }
      },
      tooltip: {
        backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
        titleColor: isDarkMode ? 'var(--white)' : 'var(--black)',
        bodyColor: isDarkMode ? 'var(--white)' : 'var(--black)',
        borderColor: 'var(--danger-color)',
        borderWidth: 1,
        titleFont: {
          family: 'Tajawal, Arial, sans-serif'
        },
        bodyFont: {
          family: 'Tajawal, Arial, sans-serif'
        }
      }
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'الوقت',
          color: isDarkMode ? 'var(--white)' : 'var(--black)',
          font: {
            family: 'Tajawal, Arial, sans-serif',
            size: 12,
            weight: 'bold'
          }
        },
        ticks: {
          color: isDarkMode ? '#var(--mid)' : '#var(--gray)',
          maxTicksLimit: 10,
          font: {
            family: 'Tajawal, Arial, sans-serif'
          }
        },
        grid: {
          color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          drawBorder: false
        }
      },
      y: {
        display: true,
        title: {
          display: true,
          text: 'شدة النبض',
          color: isDarkMode ? 'var(--white)' : 'var(--black)',
          font: {
            family: 'Tajawal, Arial, sans-serif',
            size: 12,
            weight: 'bold'
          }
        },
        min: 0,
        max: 120,
        ticks: {
          color: isDarkMode ? '#var(--mid)' : '#var(--gray)',
          stepSize: 20,
          font: {
            family: 'Tajawal, Arial, sans-serif'
          }
        },
        grid: {
          color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          drawBorder: false
        }
      }
    }
  };

  // تأثيرات بصرية للنبض
  const heartbeatStyle = {
    background: isDarkMode ? 
      'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)' :
      'linear-gradient(135deg, var(--light) 0%, var(--white) 100%)',
    border: `2px solid ${isDarkMode ? 'var(--dark-gray)' : 'var(--mid)'}`,
    borderRadius: '15px',
    boxShadow: isDarkMode ?
      '0 10px 25px rgba(0, 0, 0, 0.3)' :
      '0 10px 25px rgba(0, 0, 0, 0.1)',
    position: 'relative',
    overflow: 'hidden'
  };

  const pulseStyle = {
    position: 'absolute',
    top: '10px',
    right: '20px',
    width: '20px',
    height: '20px',
    backgroundColor: isActive ? 'var(--danger-color)' : 'var(--gray)',
    borderRadius: '50%',
    animation: isActive ? 'pulse 1s ease-in-out infinite' : 'none',
    boxShadow: `0 0 10px ${isActive ? 'var(--danger-color)' : 'var(--gray)'}`
  };

  return (
    <div className="position-fixed top-0 start-0 w-100 h-100" style={{ zIndex: 1050, backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="d-flex justify-content-center align-items-start h-100 p-3" style={{ paddingTop: '2rem' }}>
        <div className="w-100" style={{ maxWidth: '1000px', maxHeight: '650px', marginTop: '20px' }}>
          <div className="p-4" style={heartbeatStyle}>
            {/* رأس النافذة */}
            <div className="d-flex justify-content-between align-items-center mb-3">
              <div className="d-flex align-items-center">
                <i className="fas fa-heartbeat text-danger me-2 fs-4"></i>
                <h4 className={`mb-0 ${isDarkMode ? 'text-white' : 'text-dark'}`}>
                  مخطط نبض الخادم المباشر
                </h4>
              </div>
              
              {/* أزرار التحكم في الرأس */}
              <div className="d-flex align-items-center gap-2">
                <div className="d-flex align-items-center me-3">
                  <span className={`badge ${isActive ? 'bg-success' : 'bg-secondary'} me-2`}>
                    {isActive ? 'نشط' : 'متوقف'}
                  </span>
                  <span className={`small ${isDarkMode ? 'text-light' : 'text-muted'}`}>
                    نقاط البيانات: {heartbeatData.length}
                  </span>
                </div>
                
                {/* زر إعادة تعيين */}
                <button
                  type="button"
                  className={`btn btn-sm ${isDarkMode ? 'btn-outline-info' : 'btn-outline-info'} me-2`}
                  onClick={() => {
                    setHeartbeatData([]);
                    setCurrentTime(0);
                  }}
                  title="إعادة تعيين البيانات"
                >
                  <i className="fas fa-refresh me-1"></i>
                  إعادة تعيين
                </button>
                
                {/* زر الإغلاق */}
                <button
                  type="button"
                  className={`btn btn-sm ${isDarkMode ? 'btn-outline-danger' : 'btn-outline-danger'}`}
                  onClick={onClose}
                  title="إغلاق المخطط"
                >
                  <i className="fas fa-times me-1"></i>
                  إغلاق
                </button>
              </div>
            </div>

            {/* مؤشر النبض */}
            <div style={pulseStyle}></div>

            {/* معلومات الخادم */}
            <div className="row mb-3">
              <div className="col-md-6">
                <div className={`p-3 rounded ${isDarkMode ? 'bg-dark' : 'bg-light'}`}>
                  <h6 className={`mb-2 ${isDarkMode ? 'text-white' : 'text-dark'}`}>
                    <i className="fas fa-server me-2"></i>
                    بيانات الخادم
                  </h6>
                  <p className={`mb-1 ${isDarkMode ? 'text-light' : 'text-muted'}`}>
                    <strong>الاسم:</strong> {serverName}
                  </p>
                  <p className={`mb-1 ${isDarkMode ? 'text-light' : 'text-muted'}`}>
                    <strong>الحالة:</strong> 
                    <span className={`ms-2 ${isActive ? 'text-success' : 'text-danger'}`}>
                      {isActive ? 'متصل ونشط' : 'غير متصل'}
                    </span>
                  </p>
                  <p className={`mb-0 ${isDarkMode ? 'text-light' : 'text-muted'}`}>
                    <strong>وقت البدء:</strong> {new Date().toLocaleString('ar-SA')}
                  </p>
                </div>
              </div>
              <div className="col-md-6">
                <div className={`p-3 rounded ${isDarkMode ? 'bg-dark' : 'bg-light'}`}>
                  <h6 className={`mb-2 ${isDarkMode ? 'text-white' : 'text-dark'}`}>
                    <i className="fas fa-chart-line me-2"></i>
                    إحصائيات النبض
                  </h6>
                  <p className={`mb-1 ${isDarkMode ? 'text-light' : 'text-muted'}`}>
                    <strong>معدل التحديث:</strong> 10 نبضة/ثانية
                  </p>
                  <p className={`mb-1 ${isDarkMode ? 'text-light' : 'text-muted'}`}>
                    <strong>نمط النبض:</strong> طبيعي
                  </p>
                  <p className={`mb-0 ${isDarkMode ? 'text-light' : 'text-muted'}`}>
                    <strong>المدة:</strong> {Math.floor(heartbeatData.length / 10)} ثانية
                  </p>
                </div>
              </div>
            </div>

            {/* المخطط البياني */}
            <div style={{ height: '300px', position: 'relative' }}>
              <Line ref={chartRef} data={chartData} options={chartOptions} />
            </div>
          </div>
        </div>
      </div>

      {/* CSS للرسوم المتحركة */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes pulse {
            0% {
              transform: scale(1);
              opacity: 1;
            }
            50% {
              transform: scale(1.2);
              opacity: 0.7;
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          }
          
          .btn:hover {
            transform: scale(1.05);
            transition: transform 0.2s ease;
          }
        `
      }} />
    </div>
  );
};

HeartbeatChart.propTypes = {
  serverName: PropTypes.string.isRequired,
  isActive: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  isDarkMode: PropTypes.bool
};

HeartbeatChart.defaultProps = {
  isDarkMode: false
};

export default HeartbeatChart;
