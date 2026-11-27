import React, { useState, useEffect } from 'react';
import { Card, Form, Button, Alert, Spinner, Badge, Table } from 'react-bootstrap';

const ServerConnection = ({ systemInfo, onConnectionChange }) => {
    const [connectionConfig, setConnectionConfig] = useState({
        serverUrl: 'http://192.168.56.1:5000',
        email: '',
        password: '',
        agentName: '',
        autoConnect: true,
        autoStart: true
    });

    const [connectionStatus, setConnectionStatus] = useState({
        isConnected: false,
        isConnecting: false,
        lastHeartbeat: null,
        serverId: null,
        agentId: null,
        error: null,
        userInfo: null
    });

    const [serverInfo, setServerInfo] = useState(null);

    useEffect(() => {
        // Load saved configuration
        loadConfiguration();
        
        // Load auto-start status
        loadAutoStartStatus();
        
        // Check connection status
        checkConnectionStatus();
        
        // Setup heartbeat interval
        const heartbeatInterval = setInterval(() => {
            if (connectionStatus.isConnected) {
                sendHeartbeat();
            }
        }, 30000); // Send heartbeat every 30 seconds

        return () => clearInterval(heartbeatInterval);
    }, []);

    useEffect(() => {
        // Auto-connect if enabled and configuration is complete
        if (connectionConfig.autoConnect && 
            connectionConfig.serverUrl && 
            connectionConfig.username && 
            connectionConfig.password &&
            !connectionStatus.isConnected &&
            !connectionStatus.isConnecting) {
            connectToServer();
        }
    }, [connectionConfig]);

    const loadConfiguration = async () => {
        try {
            const config = await window.electronAPI.getConfig();
            if (config) {
                setConnectionConfig(prev => ({
                    ...prev,
                    ...config
                }));
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    };

    const saveConfiguration = async () => {
        try {
            await window.electronAPI.saveConfig(connectionConfig);
        } catch (error) {
            console.error('Error saving configuration:', error);
        }
    };

    const checkConnectionStatus = async () => {
        try {
            const status = await window.electronAPI.getConnectionStatus();
            setConnectionStatus(prev => ({
                ...prev,
                ...status
            }));
        } catch (error) {
            console.error('Error checking connection status:', error);
        }
    };

    const loadAutoStartStatus = async () => {
        try {
            const autoStartEnabled = await window.electronAPI.getAutoStartStatus();
            setConnectionConfig(prev => ({
                ...prev,
                autoStart: autoStartEnabled
            }));
        } catch (error) {
            console.error('Error loading auto-start status:', error);
        }
    };

    const handleAutoStartChange = async (enabled) => {
        try {
            await window.electronAPI.setAutoStart(enabled);
            setConnectionConfig(prev => ({
                ...prev,
                autoStart: enabled
            }));
        } catch (error) {
            console.error('Error setting auto-start:', error);
        }
    };

    const connectToServer = async () => {
        if (!connectionConfig.serverUrl || !connectionConfig.email || !connectionConfig.password) {
            setConnectionStatus(prev => ({
                ...prev,
                error: 'يرجى إدخال جميع البيانات المطلوبة'
            }));
            return;
        }

        setConnectionStatus(prev => ({
            ...prev,
            isConnecting: true,
            error: null
        }));

        try {
            // First, authenticate with the server using email
            const authResponse = await fetch(`${connectionConfig.serverUrl}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: connectionConfig.email,
                    password: connectionConfig.password
                })
            });

            if (!authResponse.ok) {
                const errorData = await authResponse.json();
                throw new Error(errorData.message || 'فشل في المصادقة مع الخادم');
            }

            const authData = await authResponse.json();
            const token = authData.access_token;
            const userInfo = authData.user;

            // Register this agent with the server
            const agentData = {
                agent_name: connectionConfig.agentName || systemInfo?.hostname || 'USB-Agent',
                system_info: systemInfo,
                agent_version: '1.0.0',
                capabilities: ['usb_control', 'system_monitoring', 'remote_command']
            };

            const registerResponse = await fetch(`${connectionConfig.serverUrl}/api/servers/agent/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(agentData)
            });

            if (!registerResponse.ok) {
                throw new Error('فشل في تسجيل الوكيل مع الخادم');
            }

            const registerData = await registerResponse.json();

            // حفظ البيانات في Supabase
            try {
                const supabaseData = {
                    agent_id: registerData.agent_id || `agent_${Date.now()}`,
                    name: connectionConfig.agentName || systemInfo?.hostname || 'USB-Agent',
                    ip_address: systemInfo?.network?.ip || 'unknown',
                    os: systemInfo?.platform || 'unknown',
                    cpu: systemInfo?.cpu || 'unknown',
                    ram: systemInfo?.memory || 'unknown',
                    status: 'active'
                };

                await window.electronAPI.saveAgentDataToSupabase(supabaseData);
                console.log('تم حفظ بيانات الـ agent في Supabase');
            } catch (supabaseError) {
                console.error('خطأ في حفظ البيانات في Supabase:', supabaseError);
                // لا نتوقف عن الاتصال بسبب خطأ Supabase
            }

            // Save connection info
            await window.electronAPI.saveConnectionInfo({
                token,
                serverId: registerData.server_id,
                agentId: registerData.agent_id,
                serverUrl: connectionConfig.serverUrl,
                userInfo: userInfo,
                email: connectionConfig.email
            });

            setConnectionStatus({
                isConnected: true,
                isConnecting: false,
                lastHeartbeat: new Date().toISOString(),
                serverId: registerData.server_id,
                agentId: registerData.agent_id,
                userInfo: userInfo,
                error: null
            });

            setServerInfo(registerData.server_info);

            // Save configuration
            await saveConfiguration();

            // Notify parent component
            if (onConnectionChange) {
                onConnectionChange(true, registerData);
            }

            // Start heartbeat
            sendHeartbeat();

        } catch (error) {
            console.error('Connection error:', error);
            setConnectionStatus(prev => ({
                ...prev,
                isConnecting: false,
                error: error.message || 'فشل في الاتصال بالخادم'
            }));
        }
    };

    const disconnectFromServer = async () => {
        try {
            if (connectionStatus.serverId && connectionStatus.agentId) {
                const connectionInfo = await window.electronAPI.getConnectionInfo();
                
                if (connectionInfo && connectionInfo.token) {
                    // Notify server about disconnection
                    await fetch(`${connectionConfig.serverUrl}/api/servers/agent/disconnect`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${connectionInfo.token}`
                        },
                        body: JSON.stringify({
                            server_id: connectionStatus.serverId,
                            agent_id: connectionStatus.agentId
                        })
                    });
                }
            }

            // Clear connection info
            await window.electronAPI.clearConnectionInfo();

            setConnectionStatus({
                isConnected: false,
                isConnecting: false,
                lastHeartbeat: null,
                serverId: null,
                agentId: null,
                error: null
            });

            setServerInfo(null);

            // Notify parent component
            if (onConnectionChange) {
                onConnectionChange(false, null);
            }

        } catch (error) {
            console.error('Disconnect error:', error);
        }
    };

    const sendHeartbeat = async () => {
        try {
            const connectionInfo = await window.electronAPI.getConnectionInfo();
            
            if (!connectionInfo || !connectionInfo.token) {
                return;
            }

            const heartbeatData = {
                server_id: connectionStatus.serverId,
                agent_id: connectionStatus.agentId,
                system_info: systemInfo
            };

            const response = await fetch(`${connectionConfig.serverUrl}/api/servers/agent/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${connectionInfo.token}`
                },
                body: JSON.stringify(heartbeatData)
            });

            if (response.ok) {
                setConnectionStatus(prev => ({
                    ...prev,
                    lastHeartbeat: new Date().toISOString(),
                    error: null
                }));
            }

        } catch (error) {
            console.error('Heartbeat error:', error);
            setConnectionStatus(prev => ({
                ...prev,
                error: 'فقد الاتصال مع الخادم'
            }));
        }
    };

    const handleConfigChange = (field, value) => {
        setConnectionConfig(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const getConnectionStatusBadge = () => {
        if (connectionStatus.isConnecting) {
            return <Badge bg="warning">جاري الاتصال...</Badge>;
        } else if (connectionStatus.isConnected) {
            return <Badge bg="success">متصل</Badge>;
        } else {
            return <Badge bg="danger">غير متصل</Badge>;
        }
    };

    return (
        <div className="server-connection">
            <h4 className="mb-4">
                <i className="bi bi-server me-2"></i>
                اتصال الخادم
                <span className="ms-2">{getConnectionStatusBadge()}</span>
            </h4>

            {connectionStatus.error && (
                <Alert variant="danger" className="mb-3">
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    {connectionStatus.error}
                </Alert>
            )}

            <Card className="mb-3">
                <Card.Header>
                    <i className="bi bi-gear me-2"></i>
                    إعدادات الاتصال
                </Card.Header>
                <Card.Body>
                    <Form>
                        <div className="row g-3">
                            <div className="col-md-6">
                                <Form.Group>
                                    <Form.Label>عنوان الخادم</Form.Label>
                                    <Form.Control
                                        type="url"
                                        value={connectionConfig.serverUrl}
                                        onChange={(e) => handleConfigChange('serverUrl', e.target.value)}
                                        placeholder="http://192.168.56.1:5000"
                                        disabled={connectionStatus.isConnected}
                                    />
                                </Form.Group>
                            </div>
                            <div className="col-md-6">
                                <Form.Group>
                                    <Form.Label>اسم الوكيل</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={connectionConfig.agentName}
                                        onChange={(e) => handleConfigChange('agentName', e.target.value)}
                                        placeholder={systemInfo?.hostname || 'USB-Agent'}
                                        disabled={connectionStatus.isConnected}
                                    />
                                </Form.Group>
                            </div>
                            <div className="col-md-6">
                                <Form.Group>
                                    <Form.Label>البريد الإلكتروني</Form.Label>
                                    <Form.Control
                                        type="email"
                                        value={connectionConfig.email}
                                        onChange={(e) => handleConfigChange('email', e.target.value)}
                                        placeholder="user@example.com"
                                        disabled={connectionStatus.isConnected}
                                    />
                                </Form.Group>
                            </div>
                            <div className="col-md-6">
                                <Form.Group>
                                    <Form.Label>كلمة المرور</Form.Label>
                                    <Form.Control
                                        type="password"
                                        value={connectionConfig.password}
                                        onChange={(e) => handleConfigChange('password', e.target.value)}
                                        placeholder="••••••••"
                                        disabled={connectionStatus.isConnected}
                                    />
                                </Form.Group>
                            </div>
                            <div className="col-12">
                                <Form.Check
                                    type="checkbox"
                                    label="الاتصال التلقائي عند بدء التشغيل"
                                    checked={connectionConfig.autoConnect}
                                    onChange={(e) => handleConfigChange('autoConnect', e.target.checked)}
                                />
                            </div>
                            <div className="col-12">
                                <Form.Check
                                    type="checkbox"
                                    label="التشغيل التلقائي مع Windows"
                                    checked={connectionConfig.autoStart}
                                    onChange={(e) => handleConfigChange('autoStart', e.target.checked)}
                                />
                            </div>
                        </div>
                    </Form>
                </Card.Body>
                <Card.Footer>
                    <div className="d-flex gap-2">
                        {!connectionStatus.isConnected ? (
                            <Button 
                                variant="primary" 
                                onClick={connectToServer}
                                disabled={connectionStatus.isConnecting}
                            >
                                {connectionStatus.isConnecting ? (
                                    <>
                                        <Spinner size="sm" className="me-2" />
                                        جاري الاتصال...
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-power me-2"></i>
                                        اتصال
                                    </>
                                )}
                            </Button>
                        ) : (
                            <Button 
                                variant="outline-danger" 
                                onClick={disconnectFromServer}
                            >
                                <i className="bi bi-power me-2"></i>
                                قطع الاتصال
                            </Button>
                        )}
                        <Button 
                            variant="outline-secondary" 
                            onClick={saveConfiguration}
                        >
                            <i className="bi bi-save me-2"></i>
                            حفظ الإعدادات
                        </Button>
                    </div>
                </Card.Footer>
            </Card>

            {connectionStatus.isConnected && serverInfo && (
                <Card>
                    <Card.Header>
                        <i className="bi bi-info-circle me-2"></i>
                        معلومات الاتصال
                    </Card.Header>
                    <Card.Body>
                        <Table borderless size="sm">
                            <tbody>
                                <tr>
                                    <td><strong>معرف الخادم:</strong></td>
                                    <td>{connectionStatus.serverId}</td>
                                </tr>
                                <tr>
                                    <td><strong>معرف الوكيل:</strong></td>
                                    <td>{connectionStatus.agentId}</td>
                                </tr>
                                <tr>
                                    <td><strong>آخر نبضة حياة:</strong></td>
                                    <td>
                                        {connectionStatus.lastHeartbeat ? 
                                            new Date(connectionStatus.lastHeartbeat).toLocaleString('ar-SA') : 
                                            'غير متاح'
                                        }
                                    </td>
                                </tr>
                                <tr>
                                    <td><strong>حالة الخادم:</strong></td>
                                    <td>
                                        <Badge bg="success">نشط</Badge>
                                    </td>
                                </tr>
                            </tbody>
                        </Table>
                    </Card.Body>
                </Card>
            )}
        </div>
    );
};

export default ServerConnection;
