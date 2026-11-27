const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
    maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('toggle-maximize-window'),
    closeWindow: () => ipcRenderer.invoke('close-window'),

    // Browser automation
    launchBrowser: (url) => ipcRenderer.invoke('launch-browser', url),

    // System information
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

    // USB devices
    getUSBDevices: () => ipcRenderer.invoke('get-usb-devices'),
    scanDevices: () => ipcRenderer.invoke('scan-devices'),
    approveDevice: (deviceId) => ipcRenderer.invoke('approve-device', deviceId),
    rejectDevice: (deviceId) => ipcRenderer.invoke('reject-device', deviceId),
    denyDevice: (deviceId) => ipcRenderer.invoke('deny-device', deviceId),

    // Configuration management
    readConfig: (fileName) => ipcRenderer.invoke('read-config', fileName),
    writeConfig: (fileName, data) => ipcRenderer.invoke('write-config', fileName, data),
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),

    // Connection management
    connectToServer: (config) => ipcRenderer.invoke('connect-to-server', config),
    loginToServer: (credentials) => ipcRenderer.invoke('login-to-server', credentials),
    getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
    getConnectionInfo: () => ipcRenderer.invoke('get-connection-info'),
    saveConnectionInfo: (info) => ipcRenderer.invoke('save-connection-info', info),
    clearConnectionInfo: () => ipcRenderer.invoke('clear-connection-info'),

    // Heartbeat
    sendHeartbeat: (data) => ipcRenderer.invoke('send-heartbeat', data),

    // Supabase data saving
    saveAgentDataToSupabase: (data) => ipcRenderer.invoke('save-agent-data-to-supabase', data),
    testSupabaseConnection: () => ipcRenderer.invoke('test-supabase-connection'),
    checkDeviceExists: (data) => ipcRenderer.invoke('check-device-exists', data),

    // Auto-start controls
    getAutoStartStatus: () => ipcRenderer.invoke('get-auto-start-status'),
    setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

    // Server mode check
    checkServerMode: (userCredentials) => ipcRenderer.invoke('check-server-mode', userCredentials),
    registerSubServer: (username, password) => ipcRenderer.invoke('register-sub-server', username, password),

    // USB Command Monitoring (for sub-servers)
    startUSBMonitoring: () => ipcRenderer.invoke('start-usb-monitoring'),
    stopUSBMonitoring: () => ipcRenderer.invoke('stop-usb-monitoring'),

    // Device discovery APIs
    getDiscoveredDevices: () => ipcRenderer.invoke('get-discovered-devices'),
    startDeviceDiscovery: () => ipcRenderer.invoke('start-device-discovery'),
    stopDeviceDiscovery: () => ipcRenderer.invoke('stop-device-discovery'),
    runOnceDiscovery: () => ipcRenderer.invoke('run-once-discovery'),
    getDeviceCounts: () => ipcRenderer.invoke('get-device-counts'),

    // Central server device management
    sendDevicesToServer: (devices) => ipcRenderer.invoke('send-devices-to-server', devices),
    checkServerConnection: () => ipcRenderer.invoke('check-server-connection'),

    // Heartbeat management
    startHeartbeat: () => ipcRenderer.invoke('start-heartbeat'),
    stopHeartbeat: () => ipcRenderer.invoke('stop-heartbeat'),

    // Central Server USB Control
    sendUSBControlCommand: (serverId, commandData) => ipcRenderer.invoke('send-usb-control-command', serverId, commandData),
    getConnectedServers: () => ipcRenderer.invoke('get-connected-servers'),
    getUSBCommandHistory: (serverId) => ipcRenderer.invoke('get-usb-command-history', serverId),

    // USB Control Shortcuts for Central Server
    usbControl: {
        enablePort: (serverId, portId) =>
            ipcRenderer.invoke('send-usb-control-command', serverId, {
                command: 'enable_port',
                params: { portId }
            }),

        disablePort: (serverId, portId) =>
            ipcRenderer.invoke('send-usb-control-command', serverId, {
                command: 'disable_port',
                params: { portId }
            }),

        restartPort: (serverId, portId) =>
            ipcRenderer.invoke('send-usb-control-command', serverId, {
                command: 'restart_port',
                params: { portId }
            }),

        scanDevices: (serverId) =>
            ipcRenderer.invoke('send-usb-control-command', serverId, {
                command: 'scan_devices',
                params: {}
            }),

        getPortStatus: (serverId, portId) =>
            ipcRenderer.invoke('send-usb-control-command', serverId, {
                command: 'get_port_status',
                params: { portId }
            }),

        getAllPortsStatus: (serverId) =>
            ipcRenderer.invoke('send-usb-control-command', serverId, {
                command: 'get_all_ports_status',
                params: {}
            })
    },

    // Notifications
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),

    // System utilities
    executeCommand: (command) => ipcRenderer.invoke('execute-command', command),

    // USB Agent control
    startUSBAgent: () => ipcRenderer.invoke('start-usb-agent'),
    stopUSBAgent: () => ipcRenderer.invoke('stop-usb-agent'),
    getUSBAgentStatus: () => ipcRenderer.invoke('get-usb-agent-status'),
    connectUSBAgent: (config) => ipcRenderer.invoke('connect-usb-agent', config),
    disconnectUSBAgent: () => ipcRenderer.invoke('disconnect-usb-agent'),
    controlUSBDevice: (deviceId, action) => ipcRenderer.invoke('control-usb-device', deviceId, action),

    // Pending devices from database
    getPendingDevicesFromDB: () => ipcRenderer.invoke('get-pending-devices-from-db'),

    // Event listeners
    onConnectionStatusChanged: (callback) => ipcRenderer.on('connection-status-changed', callback),
    onUSBDeviceChanged: (callback) => ipcRenderer.on('usb-device-changed', callback),
    onDeviceUpdate: (callback) => ipcRenderer.on('device-update', callback),
    onServerMessage: (callback) => ipcRenderer.on('server-message', callback),
    onDeviceDetected: (callback) => ipcRenderer.on('device-detected', callback),
    onApprovedConnectedDevices: (callback) => ipcRenderer.on('approved-connected-devices', callback),
    onApprovedDisconnectedDevices: (callback) => ipcRenderer.on('approved-disconnected-devices', callback),
    onDevicesDiscovered: (callback) => ipcRenderer.on('devices-discovered', callback),
    onDevicesSentToServer: (callback) => ipcRenderer.on('devices-sent-to-server', callback),

    // 🆕 أحداث الموافقة والرفض من السيرفر المركزي
    onDeviceApproved: (callback) => ipcRenderer.on('device-approved', callback),
    onDeviceRejected: (callback) => ipcRenderer.on('device-rejected', callback),
    onPendingDeviceRemoved: (callback) => ipcRenderer.on('pending-device-removed', callback),

    // Remove event listeners
    removeAllListeners: (event) => ipcRenderer.removeAllListeners(event)
});
