import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Bar } from 'react-chartjs-2';
import { FaBolt, FaExclamationTriangle } from 'react-icons/fa';

const PowerAnalytics = ({ analytics, onAutoDisable }) => {
  const [showTable, setShowTable] = useState(false);
  
  // نقل useMemo إلى أعلى قبل أي return شرطي
  const chartData = useMemo(() => {
    if (!analytics?.devices) return { labels: [], datasets: [] };
    const { devices = [], threshold = 2.5 } = analytics;
    return {
      labels: devices.map(d => d.name || d.serial_number || d.id),
      datasets: [
        {
          label: 'استهلاك الطاقة (W)',
          data: devices.map(d => d.power_consumption || 0),
          backgroundColor: devices.map(d => (d.power_consumption || 0) > threshold ? 'rgba(220,53,69,0.7)' : 'rgba(0,123,255,0.7)'),
        },
      ],
    };
  }, [analytics]);
  
  if (!analytics) return <div>لا توجد بيانات طاقة متاحة</div>;
  const { devices = [], total_power = 0, max_device, device_count, threshold = 2.5 } = analytics;
  // أجهزة تجاوزت الحد
  const overThreshold = devices.filter(d => (d.power_consumption || 0) > threshold);
  // أجهزة غير مستخدمة (استهلاك شبه صفر)
  const unused = devices.filter(d => (d.power_consumption || 0) < 0.1);
  // بيانات الرسم البياني تم نقلها إلى أعلى
  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} W` } },
    },
    scales: {
      y: { beginAtZero: true, title: { display: true, text: 'واط (W)' } },
      x: { title: { display: true, text: 'الجهاز/المنفذ' } },
    },
  };
  return (
    <div>
      {/* ملخص الطاقة */}
      <div className="mb-3">
        <strong>إجمالي استهلاك الطاقة:</strong> <span className={total_power > threshold * device_count ? 'text-danger fw-bold' : ''}>{total_power} W</span>
        {total_power > threshold * device_count && <FaBolt className="text-danger ml-2" title="تنبيه: استهلاك مرتفع" />}
      </div>
      {/* أعلى الأجهزة/المنافذ استهلاكًا */}
      {max_device && (
        <div className="mb-2">
          <span className="badge bg-warning text-dark">أعلى استهلاك: {max_device.name || max_device.serial_number || max_device.id} ({max_device.power_consumption}W)</span>
        </div>
      )}
      {/* تنبيه الأجهزة/المنافذ التي تجاوزت الحد */}
      {overThreshold.length > 0 && (
        <div className="alert alert-danger py-2">
          <FaExclamationTriangle className="mr-2" /> أجهزة/منافذ تجاوزت الحد:
          {overThreshold.map(d => (
            <span key={d.id} className="badge badge-danger mx-1">{d.name || d.serial_number || d.id} ({d.power_consumption}W)</span>
          ))}
        </div>
      )}
      {/* رسم بياني شريطي فوري */}
      <div style={{ maxWidth: 700 }}>
        <Bar data={chartData} options={chartOptions} height={220} />
      </div>
      {/* زر عرض الجدول المفصل */}
      <div className="mt-3 mb-2">
        <button className="btn btn-outline-primary btn-sm" onClick={() => setShowTable(v => !v)}>
          {showTable ? 'إخفاء الجدول التفصيلي' : 'عرض الجدول التفصيلي لكل المنافذ'}
        </button>
      </div>
      {/* جدول مفصل لكل منفذ */}
      {showTable && (
        <div className="table-responsive mb-3">
          <table className="table table-bordered align-middle">
            <thead>
              <tr>
                <th>الخادم</th>
                <th>معرف المنفذ</th>
                <th>الجهاز المرتبط</th>
                <th>استهلاك الطاقة</th>
                <th>الحد</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id || d.port_id}>
                  <td>{d.server_name || d.server_id || '-'}</td>
                  <td>{d.port_id || '-'}</td>
                  <td>{d.name || d.serial_number || '-'}</td>
                  <td className={d.power_consumption > threshold ? 'text-danger fw-bold' : ''}>{d.power_consumption || 0} W</td>
                  <td>{threshold} W</td>
                  <td>{d.power_consumption > threshold ? <span className="badge bg-danger">تجاوز الحد</span> : <span className="badge bg-success">طبيعي</span>}</td>
                  <td>
                    {((d.power_consumption || 0) > threshold || (d.power_consumption || 0) < 0.1) && (
                      <button className="btn btn-sm btn-warning" onClick={() => onAutoDisable && onAutoDisable(d)}>
                        تعطيل تلقائي
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* الأجهزة غير المستخدمة */}
      {unused.length > 0 && (
        <div className="alert alert-info py-2">
          <FaBolt className="mr-2" /> منافذ غير مستخدمة (استهلاك شبه صفر):
          {unused.map(d => (
            <span key={d.id} className="badge badge-secondary mx-1">{d.name || d.serial_number || d.id}</span>
          ))}
        </div>
      )}
      {/* رسم بياني زمني (توضيحي) */}
      <div className="mt-4">
        <h6>رسم بياني زمني لاستهلاك الطاقة لكل منفذ</h6>
        <div className="alert alert-info">(يتطلب بيانات تاريخية من backend - يمكن ربطه لاحقًا)</div>
      </div>
    </div>
  );
};

PowerAnalytics.propTypes = {
  analytics: PropTypes.shape({
    devices: PropTypes.array,
    total_power: PropTypes.number,
    max_device: PropTypes.object,
    device_count: PropTypes.number,
    threshold: PropTypes.number,
  }),
  onAutoDisable: PropTypes.func,
};

export default PowerAnalytics; 