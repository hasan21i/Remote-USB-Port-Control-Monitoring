// src/components/DeviceCard.jsx

import React, { useState, useCallback, useMemo, Fragment } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import {
  FaUsb,
  FaHdd,
  FaKeyboard,
  FaMouse,
  FaCamera,
  FaHeadphones,
  FaNetworkWired,
  FaMobileAlt,
  FaPrint,
  FaBan,
  FaCheckCircle,
  FaThumbsUp,
  FaThumbsDown,
  FaEject,
  FaSpinner,
  FaExclamationCircle,
  FaLink
} from 'react-icons/fa';
import {
  controlDevice,
  addToWhitelist,
  addToBlacklist
} from '../utils/api';
import StatusBadge from './StatusBadge';
import Modal from './Modal';
import useAuth from '../hooks/useAuth';
// علق أو احذف:
// import usePolicy from '../hooks/usePolicy';
// import usePower from '../hooks/usePower';
import useSocket from '../hooks/useSocket';

// خريطة الأيقونات حسب نوع الجهاز
const ICONS = {
  storage:   <FaHdd size={40} />,
  keyboard:  <FaKeyboard size={40} />,
  mouse:     <FaMouse size={40} />,
  camera:    <FaCamera size={40} />,
  audio:     <FaHeadphones size={40} />,
  network:   <FaNetworkWired size={40} />,
  phone:     <FaMobileAlt size={40} />,
  printer:   <FaPrint size={40} />,
  unknown:   <FaUsb size={40} />
};

// خريطة badge مستوى المخاطرة
const RISK_LEVEL = {
  high:   { className: 'badge-danger',    icon: <FaExclamationCircle />, label: 'مرتفع' },
  medium: { className: 'badge-warning',   icon: <FaExclamationCircle />, label: 'متوسط' },
  low:    { className: 'badge-success',   icon: <FaCheckCircle />,     label: 'منخفض' },
  unknown:{ className: 'badge-secondary', icon: <FaUsb />,             label: 'غير معروف' }
};

const ActionButton = React.memo(({ icon, title, onClick, disabled, variant }) => (
  <button
    className={`btn btn-sm btn-outline-${variant} mx-1`}
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{ minWidth: '36px' }}
  >
    {icon}
  </button>
));
ActionButton.displayName = 'ActionButton';
ActionButton.propTypes = {
  icon: PropTypes.element.isRequired,
  title: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  variant: PropTypes.string
};
ActionButton.defaultProps = {
  disabled: false,
  variant: 'secondary'
};

const DeviceCard = React.memo(({ device, canControl }) => {
  const [modal,   setModal]   = useState({ open: false, action: '' });
  const [loading, setLoading] = useState(false);
  const { currentUser: _currentUser } = useAuth();
  // علق أو احذف:
  // const { policies } = usePolicy();
  // const { powerAnalytics } = usePower();
  useSocket('device:updated', (updated) => {
    if (updated && updated.device_id === device.device_id) {
      // يمكن هنا تحديث الحالة فورًا عبر state/context حسب البنية
      // مثال: setDevice(updated)
    }
  });

  // استخراج meta_data بشكل موحد
  const meta = useMemo(() => {
    if (typeof device.meta_data === 'string') {
      try { return JSON.parse(device.meta_data || '{}'); } catch { return {}; }
    }
    return device.meta_data || device.metadata || {};
  }, [device]);

  const serial = device.serial_number || meta.device_identifier;
  const usbPort = device.usb_port || meta.port_number || '-';
  const physicalPath = device.physical_path || meta.physical_path || '-';

  const {
    manufacturer,
    product,
    custom_name,
    status,
    whitelisted,
    blacklisted,
    risk_level,
  } = device;

  const type = meta.device_type || 'unknown';
  const displayName = custom_name || product || 'جهاز غير معروف';

  const openModal  = useCallback(action => setModal({ open: true, action }), []);
  const closeModal = useCallback(() => setModal({ open: false, action: '' }), []);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    try {
      switch (modal.action) {
        case 'disable':
        case 'enable':
        case 'eject':
        case 'reconnect':
          await controlDevice(serial, { action: modal.action });
          break;
        case 'whitelist':
          await addToWhitelist(serial);
          break;
        case 'blacklist':
          await addToBlacklist(serial);
          break;
        default:
          break;
      }
      closeModal();
    } catch (err) {
      console.error('خطأ تنفيذ الإجراء:', err);
    } finally {
      setLoading(false);
    }
  }, [serial, modal.action, closeModal]);

  const actionButtons = useMemo(() => {
    if (!canControl) return null;
    const btns = [];
    if (status === 'connected') {
      btns.push(
        <ActionButton
          key="disable"
          icon={<FaBan />}
          title="تعطيل"
          onClick={() => openModal('disable')}
          variant="warning"
        />
      );
      if (type === 'storage') {
        btns.push(
          <ActionButton
            key="eject"
            icon={<FaEject />}
            title="إخراج"
            onClick={() => openModal('eject')}
            variant="info"
          />
        );
      }
    } else if (status === 'disabled') {
      btns.push(
        <ActionButton
          key="enable"
          icon={<FaCheckCircle />}
          title="تمكين"
          onClick={() => openModal('enable')}
          variant="success"
        />
      );
    } else if (status === 'disconnected' || status === 'ejected') {
      btns.push(
        <ActionButton
          key="reconnect"
          icon={<FaLink />}
          title="إعادة التوصيل"
          onClick={() => openModal('reconnect')}
          variant="primary"
        />
      );
    }
    if (!whitelisted) {
      btns.push(
        <ActionButton
          key="whitelist"
          icon={<FaThumbsUp />}
          title="إضافة إلى القائمة البيضاء"
          onClick={() => openModal('whitelist')}
          variant="success"
        />
      );
    }
    if (!blacklisted) {
      btns.push(
        <ActionButton
          key="blacklist"
          icon={<FaThumbsDown />}
          title="إضافة إلى القائمة السوداء"
          onClick={() => openModal('blacklist')}
          variant="danger"
        />
      );
    }
    return btns;
  }, [status, type, whitelisted, blacklisted, canControl, openModal]);

  const modalConfig = {
    disable:   { title: 'تعطيل الجهاز',              msg: `هل تريد تعطيل "${displayName}"؟` },
    enable:    { title: 'تمكين الجهاز',              msg: `هل تريد تمكين "${displayName}"؟` },
    eject:     { title: 'إخراج وسائط التخزين',        msg: `هل تريد إخراج "${displayName}" بأمان؟` },
    reconnect: { title: 'إعادة توصيل الجهاز',        msg: `هل تريد إعادة توصيل "${displayName}"؟` },
    whitelist: { title: 'إضافة للقائمة البيضاء',      msg: `سيسمح "${displayName}" تلقائياً.` },
    blacklist: { title: 'إضافة للقائمة السوداء',      msg: `سيتم حظر "${displayName}".` }
  };
  const { title: modalTitle, msg: modalMessage } =
    modalConfig[modal.action] || { title: '', msg: '' };

  // استخراج استهلاك الطاقة والتنبيهات الخاصة بالجهاز
  const power = device.power_consumption || (device.metadata && device.metadata.power) || 0;
  // علق أو احذف:
  // const powerAlert = powerAnalytics && powerAnalytics.devices && powerAnalytics.devices.find(d => d.id === device.id && d.power_consumption > (powerAnalytics.threshold || 2.5));

  // استخراج السياسات المطبقة
  const appliedPolicies = useMemo(() => {
    // علق أو احذف:
    // if (!policies) return [];
    return [];
  }, [/* policies */]);

  return (
    <Fragment>
      <div className="card mb-3 shadow-sm">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">{displayName}</h5>
          <StatusBadge status={status} />
        </div>
        <div className="card-body d-flex">
          <div className="mr-3">{ICONS[type]}</div>
          <div className="flex-fill">
            <ul className="list-unstyled mb-2">
              <li><strong>الرقم التسلسلي/المعرف:</strong> {serial || '-'}</li>
              <li><strong>الشركة المصنعة:</strong> {manufacturer || '-'}</li>
              <li><strong>المنتج:</strong> {product || '-'}</li>
              <li><strong>النوع:</strong> {type}</li>
              <li><strong>رقم البورت:</strong> {usbPort}</li>
              <li><strong>المسار الفيزيائي:</strong> {physicalPath}</li>
              <li><strong>الخادم المرتبط:</strong> {device.server_name || device.server_id || '—'}</li>
              <li><strong>استهلاك الطاقة:</strong> <span className={power > 2.5 ? 'text-danger fw-bold' : ''}>{power} W</span></li>
            </ul>
            {/* علق أو احذف: */}
            {/* {powerAlert && (
              <div className="alert alert-danger py-1 px-2 mb-2">
                ⚡ استهلاك الطاقة مرتفع: {powerAlert.power_consumption}W
              </div>
            )} */}
            <div className="mb-2">
              {appliedPolicies.length > 0 && (
                <span className="badge badge-info mr-2">
                  سياسة مفعلة: {appliedPolicies.map(p => p.name).join(', ')}
                </span>
              )}
              {whitelisted && (
                <span className="badge badge-success mr-2">
                  <FaCheckCircle /> قائمة بيضاء
                </span>
              )}
              {blacklisted && (
                <span className="badge badge-danger mr-2">
                  <FaBan /> قائمة سوداء
                </span>
              )}
              <span className={`badge ${RISK_LEVEL[risk_level]?.className || RISK_LEVEL.unknown.className}`}>
                {RISK_LEVEL[risk_level]?.icon || RISK_LEVEL.unknown.icon}
                <span className="ml-1">
                  مخاطرة: {RISK_LEVEL[risk_level]?.label || RISK_LEVEL.unknown.label}
                </span>
              </span>
            </div>
            <div className="d-flex align-items-center">
              <Link to="/devices/details" className="btn btn-sm btn-primary">
                عرض التفاصيل
              </Link>
              <div className="ml-auto d-flex align-items-center">
                {actionButtons}
                {!canControl && (
                  <span className="badge badge-info ml-2">وضع قراءة فقط</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {canControl && (
        <Modal
          show={modal.open}
          title={modalTitle}
          onClose={closeModal}
          footer={
            <>
              <button
                className="btn btn-secondary"
                onClick={closeModal}
                disabled={loading}
              >
                إلغاء
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading
                  ? <FaSpinner className="spin ml-2" />
                  : 'تأكيد'
                }
              </button>
            </>
          }
        >
          <p>{modalMessage}</p>
        </Modal>
      )}
    </Fragment>
  );
});

DeviceCard.displayName = 'DeviceCard';

DeviceCard.propTypes = {
  device: PropTypes.shape({
    device_id:         PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    serial_number:     PropTypes.string,
    manufacturer:      PropTypes.string,
    product:           PropTypes.string,
    custom_name:       PropTypes.string,
    status:            PropTypes.string.isRequired,
    whitelisted:       PropTypes.bool,
    blacklisted:       PropTypes.bool,
    risk_level:        PropTypes.string,
    metadata:          PropTypes.object,
    meta_data:         PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    usb_port:          PropTypes.string,
    physical_path:     PropTypes.string,
    power_consumption: PropTypes.number,
    server_name:       PropTypes.string,
    server_id:         PropTypes.oneOfType([PropTypes.string, PropTypes.number])
  }).isRequired,
  canControl: PropTypes.bool
};

DeviceCard.defaultProps = {
  canControl: false
};

export default DeviceCard;
