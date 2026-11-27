import React, { useState, useEffect } from 'react';
import { Card, Row, Col, ProgressBar, Badge, Table } from 'react-bootstrap';

const SystemInfo = ({ onSystemInfoUpdate }) => {
    const [systemInfo, setSystemInfo] = useState({
        hostname: '',
        platform: '',
        arch: '',
        cpu: {
            model: '',
            cores: 0,
            usage: 0
        },
        memory: {
            total: 0,
            used: 0,
            free: 0,
            usage: 0
        },
        disk: {
            total: 0,
            used: 0,
            free: 0,
            usage: 0
        },
        network: {
            interfaces: []
        },
        uptime: 0
    });

    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Get system info from main process
        getSystemInfo();
        
        // Update system info every 5 seconds
        const interval = setInterval(getSystemInfo, 5000);
        
        return () => clearInterval(interval);
    }, []);

    const getSystemInfo = async () => {
        try {
            const info = await window.electronAPI.getSystemInfo();
            setSystemInfo(info);
            setIsLoading(false);
            
            // Send system info to parent component for server registration
            if (onSystemInfoUpdate) {
                onSystemInfoUpdate(info);
            }
        } catch (error) {
            console.error('Error getting system info:', error);
            setIsLoading(false);
        }
    };

    const formatBytes = (bytes) => {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    };

    const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${days}d ${hours}h ${minutes}m`;
    };

    const getUsageVariant = (usage) => {
        if (usage < 50) return 'success';
        if (usage < 80) return 'warning';
        return 'danger';
    };

    if (isLoading) {
        return (
            <div className="text-center p-4">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">جاري التحميل...</span>
                </div>
                <p className="mt-2">جاري جمع معلومات النظام...</p>
            </div>
        );
    }

    return (
        <div className="system-info">
            <h4 className="mb-4">
                <i className="bi bi-cpu me-2"></i>
                معلومات النظام
            </h4>

            <Row className="g-3">
                {/* Basic System Info */}
                <Col md={6}>
                    <Card className="h-100">
                        <Card.Header>
                            <i className="bi bi-info-circle me-2"></i>
                            معلومات أساسية
                        </Card.Header>
                        <Card.Body>
                            <Table borderless size="sm">
                                <tbody>
                                    <tr>
                                        <td><strong>اسم الجهاز:</strong></td>
                                        <td>{systemInfo.hostname}</td>
                                    </tr>
                                    <tr>
                                        <td><strong>نظام التشغيل:</strong></td>
                                        <td>{systemInfo.platform}</td>
                                    </tr>
                                    <tr>
                                        <td><strong>معمارية المعالج:</strong></td>
                                        <td>{systemInfo.arch}</td>
                                    </tr>
                                    <tr>
                                        <td><strong>وقت التشغيل:</strong></td>
                                        <td>{formatUptime(systemInfo.uptime)}</td>
                                    </tr>
                                </tbody>
                            </Table>
                        </Card.Body>
                    </Card>
                </Col>

                {/* CPU Info */}
                <Col md={6}>
                    <Card className="h-100">
                        <Card.Header>
                            <i className="bi bi-cpu me-2"></i>
                            المعالج (CPU)
                        </Card.Header>
                        <Card.Body>
                            <div className="mb-2">
                                <small className="text-muted">النوع:</small>
                                <div>{systemInfo.cpu.model}</div>
                            </div>
                            <div className="mb-2">
                                <small className="text-muted">عدد الأنوية:</small>
                                <div>{systemInfo.cpu.cores} نواة</div>
                            </div>
                            <div className="mb-2">
                                <small className="text-muted">الاستخدام:</small>
                                <ProgressBar 
                                    now={systemInfo.cpu.usage} 
                                    label={`${systemInfo.cpu.usage.toFixed(1)}%`}
                                    variant={getUsageVariant(systemInfo.cpu.usage)}
                                />
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                {/* Memory Info */}
                <Col md={6}>
                    <Card className="h-100">
                        <Card.Header>
                            <i className="bi bi-memory me-2"></i>
                            الذاكرة (RAM)
                        </Card.Header>
                        <Card.Body>
                            <div className="mb-2">
                                <small className="text-muted">الإجمالي:</small>
                                <div>{formatBytes(systemInfo.memory.total)}</div>
                            </div>
                            <div className="mb-2">
                                <small className="text-muted">المستخدم:</small>
                                <div>{formatBytes(systemInfo.memory.used)}</div>
                            </div>
                            <div className="mb-2">
                                <small className="text-muted">الاستخدام:</small>
                                <ProgressBar 
                                    now={systemInfo.memory.usage} 
                                    label={`${systemInfo.memory.usage.toFixed(1)}%`}
                                    variant={getUsageVariant(systemInfo.memory.usage)}
                                />
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                {/* Disk Info */}
                <Col md={6}>
                    <Card className="h-100">
                        <Card.Header>
                            <i className="bi bi-hdd me-2"></i>
                            مساحة التخزين
                        </Card.Header>
                        <Card.Body>
                            <div className="mb-2">
                                <small className="text-muted">الإجمالي:</small>
                                <div>{formatBytes(systemInfo.disk.total)}</div>
                            </div>
                            <div className="mb-2">
                                <small className="text-muted">المستخدم:</small>
                                <div>{formatBytes(systemInfo.disk.used)}</div>
                            </div>
                            <div className="mb-2">
                                <small className="text-muted">الاستخدام:</small>
                                <ProgressBar 
                                    now={systemInfo.disk.usage} 
                                    label={`${systemInfo.disk.usage.toFixed(1)}%`}
                                    variant={getUsageVariant(systemInfo.disk.usage)}
                                />
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                {/* Network Interfaces */}
                <Col xs={12}>
                    <Card>
                        <Card.Header>
                            <i className="bi bi-ethernet me-2"></i>
                            واجهات الشبكة
                        </Card.Header>
                        <Card.Body>
                            {systemInfo.network.interfaces.length > 0 ? (
                                <div className="row g-2">
                                    {systemInfo.network.interfaces.map((interface_, index) => (
                                        <div key={index} className="col-md-6">
                                            <div className="border rounded p-3">
                                                <div className="d-flex justify-content-between align-items-center mb-2">
                                                    <strong>{interface_.name}</strong>
                                                    <Badge bg={interface_.isUp ? 'success' : 'secondary'}>
                                                        {interface_.isUp ? 'نشط' : 'غير نشط'}
                                                    </Badge>
                                                </div>
                                                {interface_.addresses.map((addr, addrIndex) => (
                                                    <div key={addrIndex} className="text-small">
                                                        <span className="text-muted">{addr.family}:</span> {addr.address}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-muted text-center">لا توجد واجهات شبكة متاحة</p>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};

export default SystemInfo;
