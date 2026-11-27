import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Badge, Alert, Modal, Form } from 'react-bootstrap';

const DeviceManager = ({ isConnected, connectionInfo }) => {
    const [devices, setDevices] = useState([]);
    const [usbPorts, setUsbPorts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showControlModal, setShowControlModal] = useState(false);
    const [selectedPort, setSelectedPort] = useState(null);
    const [controlAction, setControlAction] = useState('');

    useEffect(() => {
        if (isConnected) {
            loadDevicesAndPorts();
            
            // Refresh devices every 10 seconds
            const interval = setInterval(loadDevicesAndPorts, 10000);
            return () => clearInterval(interval);
        }
    }, [isConnected]);

    const loadDevicesAndPorts = async () => {
        try {
            setError(null);
            
            // Get USB devices from system
            const systemDevices = await window.electronAPI.getUSBDevices();
            setDevices(systemDevices);

            // Get USB ports from server if connected
            if (isConnected && connectionInfo?.serverId) {
                const connectionData = await window.electronAPI.getConnectionInfo();
                
                if (connectionData && connectionData.token) {
                    const response = await fetch(`${connectionData.serverUrl}/api/servers/${connectionInfo.serverId}/usb-ports`, {
                        headers: {
                            'Authorization': `Bearer ${connectionData.token}`
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        setUsbPorts(data.usb_ports || []);
                    }
                }
            }

            setIsLoading(false);
        } catch (error) {
            console.error('Error loading devices and ports:', error);
            setError('فشل في تحميل الأجهزة والمنافذ');
            setIsLoading(false);
        }
    };

    const handlePortControl = async (portId, action, deviceData = null) => {
        try {
            const connectionData = await window.electronAPI.getConnectionInfo();
            
            if (!connectionData || !connectionData.token) {
                setError('لا يوجد اتصال صالح بالخادم');
                return;
            }

            const endpoint = action === 'enable' ? 'connect' : 'disconnect';
            const url = `${connectionData.serverUrl}/api/usb-ports/${portId}/${endpoint}`;
            
            const requestBody = action === 'enable' && deviceData ? {
                device_id: deviceData.id,
                device_name: deviceData.name
            } : {};

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${connectionData.token}`
                },
                body: JSON.stringify(requestBody)
            });

            if (response.ok) {
                // Refresh the ports list
                await loadDevicesAndPorts();
                setShowControlModal(false);
                setSelectedPort(null);
            } else {
                const errorData = await response.json();
                setError(errorData.message || 'فشل في التحكم بالمنفذ');
            }

        } catch (error) {
            console.error('Error controlling port:', error);
            setError('فشل في التحكم بالمنفذ');
        }
    };

    const openControlModal = (port, action) => {
        setSelectedPort(port);
        setControlAction(action);
        setShowControlModal(true);
    };

    const getDeviceStatusBadge = (device) => {
        if (device.isConnected) {
            return <Badge bg="success">متصل</Badge>;
        } else {
            return <Badge bg="secondary">غير متصل</Badge>;
        }
    };

    const getPortStatusBadge = (port) => {
        switch (port.connection_status) {
            case 'connected':
                return <Badge bg="success">متصل</Badge>;
            case 'disconnected':
                return <Badge bg="secondary">غير متصل</Badge>;
            case 'disabled':
                return <Badge bg="danger">معطل</Badge>;
            default:
                return <Badge bg="warning">غير محدد</Badge>;
        }
    };

    if (!isConnected) {
        return (
            <Card>
                <Card.Body className="text-center">
                    <i className="bi bi-exclamation-circle text-warning" style={{fontSize: '3rem'}}></i>
                    <h5 className="mt-3">غير متصل بالخادم</h5>
                    <p className="text-muted">
                        يرجى الاتصال بالخادم الرئيسي أولاً لإدارة أجهزة USB
                    </p>
                </Card.Body>
            </Card>
        );
    }

    if (isLoading) {
        return (
            <div className="text-center p-4">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">جاري التحميل...</span>
                </div>
                <p className="mt-2">جاري تحميل الأجهزة والمنافذ...</p>
            </div>
        );
    }

    return (
        <div className="device-manager">
            <h4 className="mb-4">
                <i className="bi bi-usb-symbol me-2"></i>
                إدارة أجهزة USB
            </h4>

            {error && (
                <Alert variant="danger" dismissible onClose={() => setError(null)}>
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    {error}
                </Alert>
            )}

            <div className="row g-3">
                {/* Connected USB Devices */}
                <div className="col-lg-6">
                    <Card>
                        <Card.Header>
                            <i className="bi bi-usb me-2"></i>
                            الأجهزة المتصلة ({devices.length})
                        </Card.Header>
                        <Card.Body>
                            {devices.length > 0 ? (
                                <Table responsive size="sm">
                                    <thead>
                                        <tr>
                                            <th>اسم الجهاز</th>
                                            <th>النوع</th>
                                            <th>الحالة</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {devices.map((device, index) => (
                                            <tr key={index}>
                                                <td>
                                                    <div>
                                                        <strong>{device.name}</strong>
                                                        {device.manufacturer && (
                                                            <small className="d-block text-muted">
                                                                {device.manufacturer}
                                                            </small>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <Badge bg="info">{device.deviceClass || 'غير محدد'}</Badge>
                                                </td>
                                                <td>{getDeviceStatusBadge(device)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            ) : (
                                <p className="text-muted text-center">لا توجد أجهزة USB متصلة</p>
                            )}
                        </Card.Body>
                    </Card>
                </div>

                {/* USB Ports Management */}
                <div className="col-lg-6">
                    <Card>
                        <Card.Header className="d-flex justify-content-between align-items-center">
                            <span>
                                <i className="bi bi-outlet me-2"></i>
                                منافذ USB ({usbPorts.length})
                            </span>
                            <Button 
                                variant="outline-primary" 
                                size="sm"
                                onClick={loadDevicesAndPorts}
                            >
                                <i className="bi bi-arrow-clockwise me-1"></i>
                                تحديث
                            </Button>
                        </Card.Header>
                        <Card.Body>
                            {usbPorts.length > 0 ? (
                                <Table responsive size="sm">
                                    <thead>
                                        <tr>
                                            <th>المنفذ</th>
                                            <th>الجهاز</th>
                                            <th>الحالة</th>
                                            <th>التحكم</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {usbPorts.map((port) => (
                                            <tr key={port.id}>
                                                <td>
                                                    <strong>{port.port_name}</strong>
                                                    <small className="d-block text-muted">
                                                        {port.physical_location}
                                                    </small>
                                                </td>
                                                <td>
                                                    {port.device_info ? (
                                                        <div>
                                                            <strong>{port.device_info.name}</strong>
                                                            <small className="d-block text-muted">
                                                                ID: {port.device_info.id}
                                                            </small>
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted">غير متصل</span>
                                                    )}
                                                </td>
                                                <td>{getPortStatusBadge(port)}</td>
                                                <td>
                                                    <div className="btn-group btn-group-sm">
                                                        {port.connection_status === 'connected' ? (
                                                            <Button
                                                                variant="outline-danger"
                                                                size="sm"
                                                                onClick={() => openControlModal(port, 'disable')}
                                                            >
                                                                <i className="bi bi-stop"></i>
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                variant="outline-success"
                                                                size="sm"
                                                                onClick={() => openControlModal(port, 'enable')}
                                                            >
                                                                <i className="bi bi-play"></i>
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            ) : (
                                <p className="text-muted text-center">لا توجد منافذ USB مُسجلة</p>
                            )}
                        </Card.Body>
                    </Card>
                </div>
            </div>

            {/* Control Modal */}
            <Modal show={showControlModal} onHide={() => setShowControlModal(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>
                        {controlAction === 'enable' ? 'تفعيل المنفذ' : 'تعطيل المنفذ'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {selectedPort && (
                        <div>
                            <p>
                                <strong>المنفذ:</strong> {selectedPort.port_name}
                            </p>
                            <p>
                                <strong>الموقع:</strong> {selectedPort.physical_location}
                            </p>
                            
                            {controlAction === 'enable' ? (
                                <div>
                                    <p>هل تريد تفعيل هذا المنفذ؟</p>
                                    {devices.length > 0 && (
                                        <Form.Group className="mt-3">
                                            <Form.Label>اختيار الجهاز للربط (اختياري):</Form.Label>
                                            <Form.Select id="deviceSelect">
                                                <option value="">-- بدون ربط --</option>
                                                {devices.map((device, index) => (
                                                    <option key={index} value={JSON.stringify({id: device.id, name: device.name})}>
                                                        {device.name} ({device.manufacturer})
                                                    </option>
                                                ))}
                                            </Form.Select>
                                        </Form.Group>
                                    )}
                                </div>
                            ) : (
                                <p>هل تريد تعطيل هذا المنفذ؟</p>
                            )}
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowControlModal(false)}>
                        إلغاء
                    </Button>
                    <Button 
                        variant={controlAction === 'enable' ? 'success' : 'danger'}
                        onClick={() => {
                            let deviceData = null;
                            if (controlAction === 'enable') {
                                const deviceSelect = document.getElementById('deviceSelect');
                                if (deviceSelect && deviceSelect.value) {
                                    deviceData = JSON.parse(deviceSelect.value);
                                }
                            }
                            handlePortControl(selectedPort.id, controlAction, deviceData);
                        }}
                    >
                        {controlAction === 'enable' ? 'تفعيل' : 'تعطيل'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
};

export default DeviceManager;
