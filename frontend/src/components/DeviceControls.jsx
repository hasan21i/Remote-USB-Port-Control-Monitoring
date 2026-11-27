import React, { useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  FaCheckCircle,
  FaBan,
  FaShieldAlt,
  FaCheckSquare,
  FaSearch,
  FaSpinner,
  FaInfoCircle
} from 'react-icons/fa';
import Modal from './Modal';
import { useDevice } from '../hooks/useDevice';
import StatusBadge from './StatusBadge';

// تعريف كل الإجراءات المتاحة مرة واحدة
const ACTIONS = [
  {
    id: 'enable',
    label: 'تمكين',
    icon: <FaCheckCircle />,
    variant: 'success',
    visible: status => ['disabled', 'blocked', 'disconnected'].includes(status),
    confirm: name => `هل أنت متأكد من رغبتك في تمكين "${name}"؟`
  },
  {
    id: 'disable',
    label: 'تعطيل',
    icon: <FaBan />,
    variant: 'warning',
    visible: status => ['connected', 'whitelisted'].includes(status),
    confirm: name => `هل أنت متأكد من رغبتك في تعطيل "${name}"؟`
  },
  {
    id: 'block',
    label: 'حظر',
    icon: <FaShieldAlt />,
    variant: 'danger',
    visible: status => status !== 'blacklisted',
    confirm: name => `هل أنت متأكد من رغبتك في حظر "${name}"؟`
  },
  {
    id: 'whitelist',
    label: 'قائمة بيضاء',
    icon: <FaCheckSquare />,
    variant: 'info',
    visible: status => status !== 'whitelisted',
    confirm: name => `هل أنت متأكد من إضافته إلى القائمة البيضاء: "${name}"؟`
  },
  {
    id: 'scan',
    label: 'فحص',
    icon: <FaSearch />,
    variant: 'primary',
    visible: () => true,
    confirm: name => `هل تريد بدء فحص شامل لـ "${name}"؟`
  }
];

const DeviceControls = React.memo(({ device, onActionComplete }) => {
  const [modal, setModal] = useState({ open: false, action: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { controlDeviceAction } = useDevice();

  // تحديد الحالة الفعلية للجهاز
  const status = useMemo(() => {
    if (device.blacklisted) return 'blacklisted';
    if (device.whitelisted) return 'whitelisted';
    return device.status || 'unknown';
  }, [device]);

  const displayName = device.custom_name || device.name || device.serial_number;

  // إجراءات متاحة بناءً على الحالة
  const available = useMemo(
    () => ACTIONS.filter(a => a.visible(status)),
    [status]
  );

  const openModal = useCallback(action => {
    setError('');
    setModal({ open: true, action });
  }, []);

  const closeModal = useCallback(() => {
    if (!loading) setModal({ open: false, action: null });
  }, [loading]);

  const execute = useCallback(async () => {
    if (!modal.action) return;
    setLoading(true);
    setError('');
    try {
      await controlDeviceAction(device.serial_number, modal.action.id);
      closeModal();
      onActionComplete?.(modal.action.id);
    } catch (err) {
      console.error(err);
      setError(err.message || 'حدث خطأ أثناء تنفيذ الإجراء');
    } finally {
      setLoading(false);
    }
  }, [modal, device.serial_number, controlDeviceAction, closeModal, onActionComplete]);

  return (
    <>
      <div className="device-controls p-3 border rounded">
        <h5 className="mb-3">التحكم بالجهاز</h5>
        <StatusBadge status={status} className="mb-3" />

        {error && (
          <div className="alert alert-danger d-flex align-items-center">
            <FaInfoCircle className="ml-2" /> {error}
          </div>
        )}

        <div className="d-flex flex-wrap">
          {available.map(a => (
            <button
              key={a.id}
              className={`btn btn-${a.variant} m-1 flex-fill d-flex align-items-center justify-content-center`}
              onClick={() => openModal(a)}
              disabled={loading}
            >
              {a.icon}
              <span className="mr-2">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {modal.open && (
        <Modal
          show
          title="تأكيد الإجراء"
          onClose={closeModal}
          footer={
            <>
              <button className="btn btn-secondary" onClick={closeModal} disabled={loading}>
                إلغاء
              </button>
              <button
                className={`btn btn-${modal.action.variant} ml-2`}
                onClick={execute}
                disabled={loading}
              >
                {loading ? <FaSpinner className="spin ml-2" /> : modal.action.label}
              </button>
            </>
          }
        >
          <p>{modal.action.confirm(displayName)}</p>
          <ul className="list-unstyled text-muted small">
            <li><strong>الرقم التسلسلي:</strong> {device.serial_number}</li>
            {device.manufacturer && <li><strong>الشركة المصنعة:</strong> {device.manufacturer}</li>}
            {device.product && <li><strong>المنتج:</strong> {device.product}</li>}
          </ul>
        </Modal>
      )}
    </>
  );
});

DeviceControls.propTypes = {
  device: PropTypes.shape({
    serial_number: PropTypes.string.isRequired,
    name: PropTypes.string,
    custom_name: PropTypes.string,
    manufacturer: PropTypes.string,
    product: PropTypes.string,
    status: PropTypes.string,
    whitelisted: PropTypes.bool,
    blacklisted: PropTypes.bool
  }).isRequired,
  onActionComplete: PropTypes.func
};
DeviceControls.defaultProps = {
  onActionComplete: null
};

export default DeviceControls;
