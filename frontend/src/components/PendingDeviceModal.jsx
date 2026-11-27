// src/components/PendingDeviceModal.jsx

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Modal from './Modal';

const PendingDeviceModal = ({ 
  show, 
  device, 
  onClose, 
  onApprove, 
  onDeny, 
  loading = false 
}) => {
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [blockDevice, setBlockDevice] = useState(false);

  const handleApprove = () => {
    onApprove(device, notes);
    setNotes('');
  };

  const handleDeny = () => {
    onDeny(device, reason, blockDevice);
    setReason('');
    setBlockDevice(false);
  };

  const handleClose = () => {
    setNotes('');
    setReason('');
    setBlockDevice(false);
    onClose();
  };

  if (!device) return null;

  return (
    <Modal show={show} onClose={handleClose} size="lg">
      <div className="modal-header">
        <h5 className="modal-title">
          <i className="fas fa-clock text-warning me-2" />
          جهاز معلق بانتظار الموافقة
        </h5>
        <button type="button" className="btn-close" onClick={handleClose}></button>
      </div>
      
      <div className="modal-body">
        <div className="row">
          <div className="col-md-6">
            <h6 className="text-primary mb-3">معلومات الجهاز</h6>
            <div className="mb-2">
              <strong>الاسم:</strong> {device.name || device.product || 'جهاز غير معروف'}
            </div>
            <div className="mb-2">
              <strong>الرقم التسلسلي:</strong> {device.serial_number || 'غير متوفر'}
            </div>
            <div className="mb-2">
              <strong>الشركة:</strong> {device.manufacturer || 'غير معروف'}
            </div>
            <div className="mb-2">
              <strong>النوع:</strong> {device.device_class || 'غير معروف'}
            </div>
            <div className="mb-2">
              <strong>المنفذ:</strong> {device.usb_port || 'غير معروف'}
            </div>
            {device.connection_time && (
              <div className="mb-2">
                <strong>وقت الاكتشاف:</strong> {new Date(device.connection_time).toLocaleString('ar-EG')}
              </div>
            )}
          </div>
          
          <div className="col-md-6">
            <h6 className="text-success mb-3">الموافقة</h6>
            <div className="mb-3">
              <label className="form-label">ملاحظات (اختياري):</label>
              <textarea
                className="form-control"
                rows="3"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أضف ملاحظات حول سبب الموافقة..."
              />
            </div>
            <button
              className="btn btn-success w-100"
              onClick={handleApprove}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  جاري المعالجة...
                </>
              ) : (
                <>
                  <i className="fas fa-check me-2" />
                  موافقة
                </>
              )}
            </button>
          </div>
        </div>
        
        <hr className="my-4" />
        
        <div className="row">
          <div className="col-12">
            <h6 className="text-danger mb-3">الرفض</h6>
            <div className="mb-3">
              <label className="form-label">سبب الرفض:</label>
              <textarea
                className="form-control"
                rows="3"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="اذكر سبب رفض الجهاز..."
              />
            </div>
            <div className="mb-3">
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="blockDevice"
                  checked={blockDevice}
                  onChange={(e) => setBlockDevice(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="blockDevice">
                  حظر الجهاز من الاتصال مستقبلاً
                </label>
              </div>
            </div>
            <button
              className="btn btn-danger w-100"
              onClick={handleDeny}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  جاري المعالجة...
                </>
              ) : (
                <>
                  <i className="fas fa-times me-2" />
                  رفض
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

PendingDeviceModal.propTypes = {
  show: PropTypes.bool.isRequired,
  device: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onApprove: PropTypes.func.isRequired,
  onDeny: PropTypes.func.isRequired,
  loading: PropTypes.bool
};

export default PendingDeviceModal; 