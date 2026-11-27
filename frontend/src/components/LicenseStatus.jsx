import React from 'react';
import PropTypes from 'prop-types';
import { FaCheckCircle, FaExclamationTriangle, FaKey } from 'react-icons/fa';

const LicenseStatus = ({ status }) => {
  if (!status) return <div>لا توجد بيانات ترخيص متاحة</div>;
  const { active, license, features, expires_at, status: licStatus } = status;
  const isExpired = licStatus === 'expired' || (expires_at && new Date(expires_at) < new Date());
  const isNearExpiry = expires_at && !isExpired && (new Date(expires_at) - new Date() < 1000 * 60 * 60 * 24 * 14); // أقل من 14 يوم
  return (
    <div className="card shadow-sm mb-3">
      <div className="card-body">
        <div className="d-flex align-items-center mb-2">
          <FaKey className="text-primary mr-2" size={22} />
          <strong>حالة الترخيص:</strong>
          <span className={`ml-2 badge ${active && !isExpired ? 'badge-success' : 'badge-danger'}`}>{active && !isExpired ? 'مفعّل' : 'غير مفعّل'}</span>
        </div>
        {license && (
          <>
            <div className="mb-2"><strong>نوع الرخصة:</strong> <span className="badge badge-info ml-2">{license.license_type}</span></div>
            <div className="mb-2"><strong>تاريخ الانتهاء:</strong> <span className={isExpired ? 'text-danger' : isNearExpiry ? 'text-warning' : ''}>{expires_at ? new Date(expires_at).toLocaleString() : 'غير محدد'}</span></div>
            <div className="mb-2"><strong>الميزات المفعلة:</strong> {features && Object.keys(features).length > 0 ? (
              <ul className="list-inline mb-0">
                {Object.entries(features).map(([k, v]) => (
                  <li key={k} className="list-inline-item badge badge-secondary mx-1">{k}: {String(v)}</li>
                ))}
              </ul>
            ) : <span className="text-muted">لا توجد ميزات مفعلة</span>}</div>
            <div className="mb-2"><strong>عدد الخوادم المسموح:</strong> {license.max_servers}</div>
            <div className="mb-2"><strong>عدد المستخدمين المسموح:</strong> {license.max_users}</div>
            <div className="mb-2"><strong>الحالة:</strong> <span className={isExpired ? 'text-danger' : 'text-success'}>{licStatus}</span></div>
          </>
        )}
        {isExpired && (
          <div className="alert alert-danger mt-2"><FaExclamationTriangle className="mr-2" /> انتهت صلاحية الترخيص! الرجاء التجديد فورًا.</div>
        )}
        {isNearExpiry && !isExpired && (
          <div className="alert alert-warning mt-2"><FaExclamationTriangle className="mr-2" /> تنبيه: الترخيص سينتهي قريبًا.</div>
        )}
      </div>
    </div>
  );
};

LicenseStatus.propTypes = {
  status: PropTypes.shape({
    active: PropTypes.bool,
    license: PropTypes.object,
    features: PropTypes.object,
    expires_at: PropTypes.string,
    status: PropTypes.string,
  }),
};

export default LicenseStatus; 