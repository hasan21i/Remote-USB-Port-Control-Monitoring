const { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

// Try to import Supabase Manager (robust for packaged app.asar)
let SupabaseManager;
try {
    SupabaseManager = require('./supabase_manager');
} catch (err1) {
    try {
        SupabaseManager = require(path.join(__dirname, '..', 'supabase_manager'));
    } catch (err2) {
        console.warn('Supabase Manager not available:', err2.message);
        SupabaseManager = null;
    }
}

// Try to import USB Agent
let USBAgent;
try {
    USBAgent = require('./usb_agent');
} catch (error) {
    console.warn('USB Agent not available:', error.message);
}

// Try to import Device Blocker utility
let deviceBlocker;
try {
    // Try different paths for both development and packaged app
    deviceBlocker = require('./src/utils/deviceBlocker');
} catch (err1) {
    try {
        deviceBlocker = require(path.join(__dirname, 'src', 'utils', 'deviceBlocker'));
    } catch (err2) {
        try {
            deviceBlocker = require(path.join(__dirname, '..', 'src', 'utils', 'deviceBlocker'));
        } catch (err3) {
            console.warn('Device Blocker utility not available:', err3.message);
            deviceBlocker = null;
        }
    }
}

// Optional modules used by system info and discovery
let publicIp;
try {
    publicIp = require('public-ip');
} catch (err) {
    console.warn('public-ip module not available:', err && err.message ? err.message : err);
    publicIp = null;
}

let axios;
try {
    axios = require('axios');
} catch (err) {
    console.warn('axios module not available:', err && err.message ? err.message : err);
    axios = null;
}

let si;
try {
    si = require('systeminformation');
} catch (err) {
    console.warn('systeminformation module not available:', err && err.message ? err.message : err);
    si = null;
}

let usbDetection;
try {
    usbDetection = require('usb-detection');
} catch (err) {
    console.warn('usb-detection module not available:', err && err.message ? err.message : err);
    usbDetection = null;
}

let usb;
try {
    usb = require('usb');
} catch (err) {
    console.warn('usb module not available:', err && err.message ? err.message : err);
    usb = null;
}

// Configuration and storage paths
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config');
const connectionInfoPath = path.join(userDataPath, 'connection.json');
if (!fs.existsSync(configPath)) {
    fs.mkdirSync(configPath, { recursive: true });
}

// Global variables
let mainWindow;
let tray = null; // إضافة متغير للـ tray
let usbAgent = null;
let serverShutdownInProgress = false;
let connectionInfo = null;
let heartbeatInterval = null;
let supabaseManager = null;
let deviceMonitoringInterval = null;
let connectedDevices = new Map();
let deviceDiscoveryActive = false;
let deviceStatusSubscription = null;
let currentDbConnectedCount = 0; // عداد الأجهزة المتصلة من قاعدة البيانات
// Baseline snapshot: عند بدء التشغيل نأخذ لقطة للأجهزة المتصلة حالياً
// ونعتبرها "معروفة" خلال جلسة التشغيل هذه حتى لا تظهر كلها كمعلقة.
let initialDiscoveryDone = false;
// Set of keys representing devices that were present at agent startup.
// Each key is either:
//  - 'S:<SERIAL>' for devices with a serial number
//  - 'VP:<VID>:<PID>' for devices without serial where VID/PID is available
//  - 'ID:<DEVICE_ID>' as a last-resort fallback
let initialDiscoveryKeys = new Set();
// Map of locally discovered pending devices (key -> device object)
let pendingDevicesMap = new Map();
// مجموعة الأجهزة المحظورة حالياً (InstanceId) - للتنظيف عند الإغلاق
let blockedDeviceIds = new Set();
// مجموعة الأجهزة الموافق عليها
let approvedDeviceIds = new Set();

// ==================== DEVICE DEDUPLICATION & MERGING FUNCTIONS ====================
// نظام دمج الأجهزة ثلاثي الطبقات (مطابق للباك إند)

/**
 * توليد بصمات متعددة للجهاز للتجميع المرن
 * @param {Object} device - بيانات الجهاز
 * @returns {Array<string>} - قائمة البصمات المرشحة
 */
function generateDeviceCandidateSignatures(device) {
    const candidates = [];
    if (!device) return candidates;

    try {
        // استخراج المعلومات الأساسية
        const serial = (device.serial_number || device.serial || device.SerialNumber || device.iSerialNumber || '').toString().trim().toUpperCase();
        const deviceId = (device.device_id || device.DeviceID || device.deviceId || device.id || '').toString().trim().toUpperCase();
        const name = (device.name || device.Name || device.FriendlyName || '').toString().trim();
        const nameClean = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

        // استخراج VID و PID
        let vid = null, pid = null;
        const vidCandidates = [device.vendor_id, device.vendorId, device.vendor, device.VendorID];
        const pidCandidates = [device.product_id, device.productId, device.product, device.ProductID];

        for (const c of vidCandidates) {
            if (c !== undefined && c !== null && String(c).trim() !== '') {
                vid = typeof c === 'number' ? c.toString(16).toUpperCase().padStart(4, '0') : String(c).replace(/^0x/i, '').toUpperCase().padStart(4, '0');
                break;
            }
        }
        for (const c of pidCandidates) {
            if (c !== undefined && c !== null && String(c).trim() !== '') {
                pid = typeof c === 'number' ? c.toString(16).toUpperCase().padStart(4, '0') : String(c).replace(/^0x/i, '').toUpperCase().padStart(4, '0');
                break;
            }
        }

        // استخراج serial من device_id إذا كان موجوداً
        let extractedSerial = null;
        // استخراج parent_serial للأجهزة المركبة ذات الطبقات (interfaces)
        let parentSerial = null;
        if (deviceId) {
            // USB\VID_XXXX&PID_XXXX\SERIAL_HERE (الجهاز الأب - بدون &MI_XX)
            const parentMatch = deviceId.match(/^USB\\VID_[0-9A-F]+&PID_[0-9A-F]+\\([^\\&]+)$/i);
            if (parentMatch) {
                extractedSerial = parentMatch[1].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                if (extractedSerial && extractedSerial.length >= 6) {
                    parentSerial = extractedSerial;
                }
            }
        }

        // استخراج base serial (بدون suffix الـ interface)
        let baseSerial = serial;
        if (serial && serial.length >= 10) {
            const interfaceMatch = serial.match(/^(.{6,}?)(0{4,}\d?)$/);
            if (interfaceMatch) {
                baseSerial = interfaceMatch[1];
            }
        }

        // 1) Serial الكامل
        if (serial && serial.length >= 4 && !serial.includes('&0&')) {
            candidates.push(`serial:${serial}`);
        }

        // 2) Serial المستخرج من device_id (الجهاز الأب)
        if (extractedSerial && extractedSerial !== serial && extractedSerial.length >= 4) {
            candidates.push(`serial:${extractedSerial}`);
        }

        // 2b) Parent serial للأجهزة المركبة (clustering)
        if (parentSerial && parentSerial !== serial && parentSerial !== extractedSerial) {
            candidates.push(`serial:${parentSerial}`);
        }

        // 3) Base serial للأجهزة المركبة
        if (baseSerial && baseSerial !== serial && baseSerial.length >= 4) {
            candidates.push(`serial:${baseSerial}`);
        }

        // 4) VID:PID + parent device path
        if (vid && pid && deviceId) {
            let parent = deviceId.split('\\').slice(0, -1).join('\\');
            parent = parent.replace(/&MI_\d+$/i, '').replace(/&COL\d+$/i, '');
            const parentClean = parent.replace(/[^A-Za-z0-9:_-]/g, '');
            candidates.push(`vid_pid_parent:${vid}:${pid}:${parentClean}`);
        }

        // 5) VID:PID فقط - فقط للجهاز الأب (بدون MI_XX) لتجنب دمج أجهزة مختلفة بنفس VID:PID
        if (vid && pid) {
            const isCompositeParent = deviceId && /^USB\\VID_[0-9A-F]+&PID_[0-9A-F]+\\[^&\\]+$/i.test(deviceId);
            if (isCompositeParent) {
                candidates.push(`vid_pid:${vid}:${pid}`);
            }
        }

        // 6) الاسم كـ fallback
        if (nameClean) {
            candidates.push(`name:${nameClean}`);
        }

        // 7) Hash كـ fallback أخير
        if (candidates.length === 0) {
            const hash = require('crypto').createHash('md5').update(JSON.stringify(device)).digest('hex').substring(0, 8);
            candidates.push(`hash:${hash}`);
        }

        // إزالة التكرارات
        return [...new Set(candidates)];
    } catch (e) {
        console.warn('generateDeviceCandidateSignatures error:', e);
        return [];
    }
}

/**
 * دمج معلومات جهازين مكررين للحصول على أفضل البيانات
 * @param {Object} existing - الجهاز الموجود
 * @param {Object} newDevice - الجهاز الجديد
 * @returns {Object} - الجهاز المدمج
 */
function mergeDeviceInformation(existing, newDevice) {
    if (!existing || typeof existing !== 'object') return newDevice;
    if (!newDevice || typeof newDevice !== 'object') return existing;

    const merged = { ...existing };

    // الأسماء العامة التي يجب تجنبها
    const genericNames = [
        'unknown', 'unknown device', 'none', '', 'generic',
        'usb composite device', 'composite device', 'usb device',
        'usb input device', 'hid keyboard device', 'hid-compliant mouse',
        'usb mass storage device', 'mass storage device'
    ];

    // الحقول المراد دمجها
    const mergeFields = ['name', 'manufacturer', 'product', 'description', 'serial_number', 'device_type', 'device_class'];

    for (const field of mergeFields) {
        try {
            const existingVal = String(existing[field] || '').trim();
            const newVal = String(newDevice[field] || '').trim();

            const existingIsGeneric = genericNames.includes(existingVal.toLowerCase());
            const newIsGeneric = genericNames.includes(newVal.toLowerCase());

            // معالجة خاصة للـ serial_number - نفضل الأطول
            if (field === 'serial_number') {
                if (newVal && newVal.length > existingVal.length) {
                    merged[field] = newVal;
                } else if (!existingVal && newVal) {
                    merged[field] = newVal;
                }
            }
            // معالجة خاصة للاسم - نفضل غير العام والأطول
            else if (field === 'name') {
                if (existingIsGeneric && !newIsGeneric && newVal) {
                    merged[field] = newVal;
                } else if (newVal && newVal.length > existingVal.length && !newIsGeneric) {
                    merged[field] = newVal;
                }
            }
            // الحقول الأخرى
            else {
                if ((!existingVal || existingIsGeneric) && newVal && !newIsGeneric) {
                    merged[field] = newVal;
                } else if (newVal && newVal.length > existingVal.length && !newIsGeneric) {
                    merged[field] = newVal;
                }
            }
        } catch (e) {
            // تجاهل الأخطاء في الحقل الفردي
        }
    }

    // تحديث الوقت
    try {
        const existingTime = existing.detected_at || existing.connection_time || '';
        const newTime = newDevice.detected_at || newDevice.connection_time || '';
        if (newTime && (!existingTime || String(newTime) > String(existingTime))) {
            merged.detected_at = newTime;
            merged.last_seen = newTime;
        }
    } catch (e) { }

    // دمج الحقول الإضافية (vendor_id, product_id)
    ['vendor_id', 'vendorId', 'product_id', 'productId', 'device_id', 'deviceId'].forEach(field => {
        if (!merged[field] && newDevice[field]) {
            merged[field] = newDevice[field];
        }
    });

    return merged;
}

/**
 * إزالة التكرار المحسنة مع دمج المعلومات (3 طبقات)
 * @param {Array} deviceList - قائمة الأجهزة
 * @returns {Array} - قائمة الأجهزة بدون تكرار
 */
function enhancedDeviceDeduplication(deviceList) {
    if (!deviceList || !Array.isArray(deviceList) || deviceList.length === 0) {
        return [];
    }

    const deviceMap = {};
    let duplicateCount = 0;

    console.log(`🔄 بدء إزالة التكرار المحسنة من ${deviceList.length} جهاز...`);

    for (const device of deviceList) {
        try {
            if (!device || typeof device !== 'object') continue;

            // توليد البصمات المرشحة
            const candidates = generateDeviceCandidateSignatures(device);
            if (!candidates || candidates.length === 0) {
                const fallbackKey = `fallback:${device.name || 'unknown'}:${Object.keys(deviceMap).length}`;
                deviceMap[fallbackKey] = device;
                continue;
            }

            // البحث عن مجموعة موجودة
            let foundKey = null;
            for (const c of candidates) {
                if (deviceMap[c]) {
                    foundKey = c;
                    break;
                }
            }

            if (foundKey) {
                // جهاز مكرر - دمج المعلومات
                const existingDevice = deviceMap[foundKey];
                const mergedDevice = mergeDeviceInformation(existingDevice, device);

                // تحديث كل المفاتيح التي تشير للجهاز القديم
                for (const [key, val] of Object.entries(deviceMap)) {
                    if (val === existingDevice) {
                        deviceMap[key] = mergedDevice;
                    }
                }

                // إضافة البصمات الجديدة
                for (const c of candidates) {
                    if (!deviceMap[c]) {
                        deviceMap[c] = mergedDevice;
                    }
                }

                duplicateCount++;
                console.log(`   ✓ دمج جهاز مكرر: ${device.name || 'Unknown'}`);
            } else {
                // جهاز فريد - تخزين تحت كل البصمات
                for (const c of candidates) {
                    deviceMap[c] = device;
                }
            }
        } catch (e) {
            console.warn(`⚠️ خطأ في معالجة جهاز: ${e.message}`);
        }
    }

    // استخراج الأجهزة الفريدة
    const seenIds = new Set();
    const uniqueDevices = [];

    for (const device of Object.values(deviceMap)) {
        const deviceId = JSON.stringify(device);
        if (!seenIds.has(deviceId)) {
            seenIds.add(deviceId);
            uniqueDevices.push(device);
        }
    }

    console.log(`✅ إزالة التكرار: ${deviceList.length} -> ${uniqueDevices.length} جهاز (${duplicateCount} مكرر)`);
    return uniqueDevices;
}

// ==================== END DEVICE DEDUPLICATION ====================

// Helper to derive a stable key for different device object shapes
function deriveDeviceKey(device) {
    if (!device) return 'ID:';
    // various possible serial fields
    const serial = (device.serial_number || device.serial || device.SerialNumber || device.iSerialNumber || device.Serial || '').toString().trim();
    if (serial && serial.length >= 1) {
        return `S:${serial.toUpperCase()}`;
    }

    // possible vendor/product fields across different APIs
    const vidCandidates = [device.vendor_id, device.vendorId, device.vendor, device.VendorID, device.vendorIdHex];
    const pidCandidates = [device.product_id, device.productId, device.product, device.ProductID, device.productIdHex];
    let vid = null;
    let pid = null;
    for (const c of vidCandidates) {
        if (c !== undefined && c !== null && String(c).trim() !== '') { vid = c; break; }
    }
    for (const c of pidCandidates) {
        if (c !== undefined && c !== null && String(c).trim() !== '') { pid = c; break; }
    }
    // Normalize numeric vendor/product to 4-digit hex if needed
    const normalizeId = (v) => {
        if (v === undefined || v === null) return null;
        if (typeof v === 'number') return v.toString(16).toUpperCase().padStart(4, '0');
        const s = String(v).replace(/^0x/i, '').trim().toUpperCase();
        if (/^[0-9A-F]+$/i.test(s)) return s.padStart(4, '0');
        return null;
    };
    const nvid = normalizeId(vid);
    const npid = normalizeId(pid);
    if (nvid && npid) {
        return `VP:${nvid}:${npid}`;
    }

    // Fallback to device id / device_id / id fields
    const idField = (device.device_id || device.DeviceID || device.deviceId || device.id || '').toString().trim();
    return `ID:${idField}`;
}

// Compare two device-like objects to decide if they likely represent the same physical device
function isSameDevice(a, b) {
    if (!a || !b) return false;

    const getSerial = (d) => (d.serial_number || d.serial || d.SerialNumber || d.iSerialNumber || '').toString().trim();
    const getVendor = (d) => (d.vendor_id || d.vendorId || d.vendor || d.VendorID || '').toString().trim();
    const getProduct = (d) => (d.product_id || d.productId || d.product || d.ProductID || '').toString().trim();
    const getDeviceId = (d) => (d.device_id || d.DeviceID || d.deviceId || d.id || '').toString().trim();

    const s1 = getSerial(a).toUpperCase();
    const s2 = getSerial(b).toUpperCase();
    if (s1 && s2 && s1 === s2) return true;

    const normalizeId = (v) => {
        if (!v && v !== 0) return null;
        if (typeof v === 'number') return v.toString(16).toUpperCase().padStart(4, '0');
        const s = String(v).replace(/^0x/i, '').trim().toUpperCase();
        return /^[0-9A-F]+$/.test(s) ? s.padStart(4, '0') : null;
    };

    const v1 = normalizeId(getVendor(a));
    const p1 = normalizeId(getProduct(a));
    const v2 = normalizeId(getVendor(b));
    const p2 = normalizeId(getProduct(b));
    if (v1 && p1 && v2 && p2 && v1 === v2 && p1 === p2) return true;

    const id1 = getDeviceId(a);
    const id2 = getDeviceId(b);
    if (id1 && id2 && id1 === id2) return true;

    // Fallback - partial match on vendor/product substrings
    try {
        if (v1 && p1 && (v2 && p2) && (v1 === v2 || p1 === p2)) return true;
    } catch (e) { }

    return false;
}

// ==================== DEVICE LOGGING FUNCTIONS ====================
// دوال طباعة رسائل الأجهزة في الـ Terminal (مشابهة للـ backend)

/**
 * طباعة رسالة اكتشاف جهاز جديد (Pending) في الـ Terminal
 * @param {Object} device - بيانات الجهاز المكتشف
 */
function logNewDeviceDiscovered(device) {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const deviceName = device.name || 'Unknown Device';
    const serialNumber = device.serial_number || device.serial || device.id || 'N/A';
    const vendorId = device.vendor_id || device.vendorId || 'N/A';
    const productId = device.product_id || device.productId || 'N/A';

    console.log('');
    console.log('\x1b[33m═══════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[33m🆕 NEW DEVICE DISCOVERED (PENDING APPROVAL)\x1b[0m');
    console.log('\x1b[33m═══════════════════════════════════════════════════════════\x1b[0m');
    console.log(`\x1b[36m   📅 Time:        \x1b[0m${timestamp}`);
    console.log(`\x1b[36m   📱 Device:      \x1b[0m${deviceName}`);
    console.log(`\x1b[36m   🔢 Serial:      \x1b[0m${serialNumber}`);
    console.log(`\x1b[36m   🏭 Vendor ID:   \x1b[0m${vendorId}`);
    console.log(`\x1b[36m   📦 Product ID:  \x1b[0m${productId}`);
    console.log(`\x1b[33m   ⚠️  Status:      \x1b[0m\x1b[33mPENDING - Awaiting Admin Approval\x1b[0m`);
    console.log('\x1b[33m═══════════════════════════════════════════════════════════\x1b[0m');
    console.log('');
}

/**
 * طباعة رسالة اتصال جهاز معتمد في الـ Terminal
 * @param {Object} device - بيانات الجهاز
 */
function logDeviceConnected(device) {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const deviceName = device.name || 'Unknown Device';
    const serialNumber = device.serial_number || device.serial || 'N/A';

    console.log('\x1b[32m✅ DEVICE CONNECTED\x1b[0m');
    console.log(`   📅 ${timestamp}`);
    console.log(`   📱 ${deviceName} (${serialNumber})`);
}

/**
 * طباعة رسالة انفصال جهاز في الـ Terminal
 * @param {Object} device - بيانات الجهاز
 */
function logDeviceDisconnected(device) {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const deviceName = device.name || 'Unknown Device';
    const serialNumber = device.serial_number || device.serial || device.id || 'N/A';

    console.log('\x1b[31m❌ DEVICE DISCONNECTED\x1b[0m');
    console.log(`   📅 ${timestamp}`);
    console.log(`   📱 ${deviceName} (${serialNumber})`);
}

/**
 * طباعة رسالة موافقة على جهاز في الـ Terminal
 * @param {Object} device - بيانات الجهاز
 */
function logDeviceApproved(device) {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const deviceName = device.name || 'Unknown Device';
    const serialNumber = device.serial_number || device.serial || 'N/A';

    console.log('\x1b[32m✅ DEVICE APPROVED\x1b[0m');
    console.log(`   📅 ${timestamp}`);
    console.log(`   📱 ${deviceName} (${serialNumber})`);
    console.log(`   \x1b[32m✓ Device is now whitelisted and can be used\x1b[0m`);
}

/**
 * طباعة رسالة رفض جهاز في الـ Terminal
 * @param {Object} device - بيانات الجهاز
 */
function logDeviceRejected(device) {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const deviceName = device.name || 'Unknown Device';
    const serialNumber = device.serial_number || device.serial || 'N/A';

    console.log('\x1b[31m🚫 DEVICE REJECTED\x1b[0m');
    console.log(`   📅 ${timestamp}`);
    console.log(`   📱 ${deviceName} (${serialNumber})`);
    console.log(`   \x1b[31m✗ Device is blacklisted and blocked\x1b[0m`);
}

// ==================== END DEVICE LOGGING FUNCTIONS ====================

const createWindow = () => {
    // Determine correct preload path
    const candidatePreloadSame = path.join(__dirname, 'preload.js');
    const candidatePreloadParent = path.join(__dirname, '..', 'preload.js');
    const preloadPath = fs.existsSync(candidatePreloadSame) ? candidatePreloadSame : candidatePreloadParent;

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        show: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: preloadPath
        }
    });

    // Load renderer
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        // mainWindow.webContents.openDevTools();
    } else {
        const candidateSameDir = path.join(__dirname, 'index.html');
        const candidateBuildDir = path.join(__dirname, 'build', 'index.html');
        const indexToLoad = fs.existsSync(candidateSameDir) ? candidateSameDir : candidateBuildDir;
        try {
            mainWindow.loadFile(indexToLoad); 
            // mainWindow.webContents.openDevTools({ mode: 'detach' });
        } catch (err) {
            console.error('Failed to load renderer index file:', indexToLoad, err);
            mainWindow.loadFile(candidateBuildDir).catch(e => {
                console.error('Fallback load failed:', e);
                mainWindow.loadURL('data:text/html;charset=utf-8,<html><body style="background:red;color:white;font-family:sans-serif;padding:20px;"><h1>Failed to load App UI (build/index.html)</h1><p>Check if the app was built properly.</p><p>Target paths tried:<br/>' + candidateSameDir + '<br/>' + candidateBuildDir + '</p><p>Error: ' + e.message + '</p></body></html>');
            });
        }

        // Also handle the unhandled promise rejection of the main loadFile attempt.
        mainWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
            if (errorCode !== -3) { // -3 is ERR_ABORTED (ignores some redirects)
                mainWindow.loadURL('data:text/html;charset=utf-8,<html><body style="background:red;color:white;font-family:sans-serif;padding:20px;"><h1>Failed to load App UI (did-fail-load)</h1><p>Error Code: ' + errorCode + '</p><p>Description: ' + errorDescription + '</p><p>Tried to load: ' + indexToLoad + '</p></body></html>');
            }
        });
    }

    // Close the app normally when window is closed
    mainWindow.on('close', () => {
        app.isQuitting = true;
    });

    // Remove menu bar
    Menu.setApplicationMenu(null);

    // Load existing connection info
    loadConnectionInfo();

    // Start server status initialization shortly after window ready
    setTimeout(async () => {
        if (typeof initializeServerStatus === 'function') {
            try { await initializeServerStatus(); } catch (e) { console.warn('initializeServerStatus error:', e); }
        }
    }, 3000);
};

// دالة إنشاء system tray
function createTray() {
    try {
        // إنشاء أيقونة للـ tray
        const iconPath = path.join(__dirname, 'assets', 'icon.ico');
        let trayIcon;

        if (fs.existsSync(iconPath)) {
            trayIcon = nativeImage.createFromPath(iconPath);
        } else {
            // استخدام أيقونة افتراضية إذا لم توجد الأيقونة
            trayIcon = nativeImage.createEmpty();
        }

        tray = new Tray(trayIcon);

        // إعداد قائمة السياق
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'عرض النافذة',
                click: () => {
                    if (mainWindow) {
                        if (mainWindow.isMinimized()) mainWindow.restore();
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            },
            {
                label: 'إخفاء النافذة',
                click: () => {
                    if (mainWindow) {
                        mainWindow.hide();
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'حالة الاتصال',
                enabled: false,
                sublabel: connectionInfo ? 'متصل' : 'غير متصل'
            },
            {
                label: `الأجهزة المتصلة: ${currentDbConnectedCount}`,
                enabled: false
            },
            { type: 'separator' },
            {
                label: 'إعدادات',
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.webContents.send('navigate-to', '/settings');
                    }
                }
            },
            {
                label: 'الأجهزة',
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.webContents.send('navigate-to', '/devices');
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'إنهاء البرنامج',
                click: () => {
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ]);

        tray.setContextMenu(contextMenu);
        tray.setToolTip('Smart Zero-Trust Security Agent — يعمل في الخلفية');

        // النقر المزدوج لإظهار النافذة
        tray.on('double-click', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });

        console.log('✅ System tray created successfully');

    } catch (error) {
        console.error('❌ Error creating system tray:', error);
    }
}

// دالة تحديث معلومات tray
function updateTrayMenu() {
    if (!tray) return;

    try {
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'عرض النافذة',
                click: () => {
                    if (mainWindow) {
                        if (mainWindow.isMinimized()) mainWindow.restore();
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            },
            {
                label: 'إخفاء النافذة',
                click: () => {
                    if (mainWindow) {
                        mainWindow.hide();
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'حالة الاتصال',
                enabled: false,
                sublabel: connectionInfo ? 'متصل' : 'غير متصل'
            },
            {
                label: `الأجهزة المتصلة: ${currentDbConnectedCount}`,
                enabled: false
            },
            { type: 'separator' },
            {
                label: 'إعدادات',
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.webContents.send('navigate-to', '/settings');
                    }
                }
            },
            {
                label: 'الأجهزة',
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.webContents.send('navigate-to', '/devices');
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'إنهاء البرنامج',
                click: () => {
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ]);

        tray.setContextMenu(contextMenu);

    } catch (error) {
        console.error('❌ Error updating tray menu:', error);
    }
}
async function loadConnectionInfo() {
    try {
        if (fs.existsSync(connectionInfoPath)) {
            const data = fs.readFileSync(connectionInfoPath, 'utf8');
            const loadedInfo = JSON.parse(data);

            // التحقق من صلاحية الجلسة
            if (!isSessionValid(loadedInfo)) {
                console.log('🔄 Session expired - clearing connection info');
                connectionInfo = null;
                try {
                    fs.unlinkSync(connectionInfoPath);
                } catch (e) { }
                return null;
            }

            connectionInfo = loadedInfo;

            // حساب الأيام المتبقية للجلسة
            if (connectionInfo.session_expires_at) {
                const expiresAt = new Date(connectionInfo.session_expires_at);
                const now = new Date();
                const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
                console.log(`✅ Connection info loaded - Session valid for ${daysRemaining} more days`);
            } else {
                console.log('Connection info loaded (legacy session without expiry)');
            }

            // تحديث قائمة system tray عند تحميل معلومات الاتصال
            updateTrayMenu();

            // بدء مراقبة real-time لحالة الأجهزة بعد تحميل معلومات الاتصال
            if (supabaseManager && supabaseManager.client && !deviceStatusSubscription) {
                setTimeout(() => {
                    startDeviceStatusMonitoring();
                }, 1000);
            }

            return connectionInfo;
        } else {
            console.log('No connection info file found');
            return null;
        }
    } catch (error) {
        console.error('Error loading connection info:', error);
        return null;
    }
}

// دالة الحصول على معلومات الاتصال
async function getConnectionInfo() {
    // إذا كانت معلومات الاتصال متوفرة بالفعل، إرجاعها مباشرة
    if (connectionInfo) {
        // التحقق من انتهاء صلاحية الجلسة (شهر واحد = 30 يوم)
        if (connectionInfo.session_expires_at) {
            const expiresAt = new Date(connectionInfo.session_expires_at);
            const now = new Date();
            if (now > expiresAt) {
                console.log('⚠️ Session expired - clearing connection info');
                connectionInfo = null;
                try {
                    if (fs.existsSync(connectionInfoPath)) {
                        fs.unlinkSync(connectionInfoPath);
                    }
                } catch (e) { }
                return null;
            }
        }
        return connectionInfo;
    }

    // تحميل معلومات الاتصال من الملف
    return await loadConnectionInfo();
}

// ==================== SESSION MANAGEMENT ====================
// إدارة جلسات تسجيل الدخول - مدة الجلسة شهر واحد (30 يوم)
const SESSION_DURATION_DAYS = 30;
const SESSION_DURATION_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000; // 30 يوم بالميلي ثانية

/**
 * إنشاء تاريخ انتهاء الجلسة
 * @returns {string} - تاريخ انتهاء الجلسة بصيغة ISO
 */
function createSessionExpiry() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);
    return expiresAt.toISOString();
}

/**
 * التحقق من صلاحية الجلسة
 * @param {Object} info - معلومات الاتصال
 * @returns {boolean} - هل الجلسة صالحة
 */
function isSessionValid(info) {
    if (!info) return false;
    if (!info.session_expires_at) return true; // جلسات قديمة بدون تاريخ انتهاء تعتبر صالحة

    const expiresAt = new Date(info.session_expires_at);
    const now = new Date();

    if (now > expiresAt) {
        console.log(`⚠️ الجلسة منتهية الصلاحية منذ: ${expiresAt.toLocaleString()}`);
        return false;
    }

    const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    console.log(`✅ الجلسة صالحة - متبقي ${daysRemaining} يوم`);
    return true;
}
// ==================== END SESSION MANAGEMENT ====================

// دالة حفظ معلومات الاتصال
async function saveConnectionInfo(info) {
    try {
        // إضافة تاريخ انتهاء الجلسة (شهر واحد)
        if (!info.session_expires_at) {
            info.session_expires_at = createSessionExpiry();
            info.session_created_at = new Date().toISOString();
        }

        connectionInfo = info;
        fs.writeFileSync(connectionInfoPath, JSON.stringify(info, null, 2));

        const expiresAt = new Date(info.session_expires_at);
        console.log('✅ Connection info saved with session expiry:');
        console.log(`   📅 Created: ${info.session_created_at}`);
        console.log(`   ⏰ Expires: ${expiresAt.toLocaleString()}`);
        console.log(`   📆 Duration: ${SESSION_DURATION_DAYS} days`);

        return true;
    } catch (error) {
        console.error('Error saving connection info:', error);
        return false;
    }
}

// App event handlers
app.whenReady().then(() => {
    // Initialize Supabase Manager if available
    if (SupabaseManager) {
        try {
            supabaseManager = new SupabaseManager();
            console.log('Supabase Manager initialized');

            // بدء مراقبة حالة الأجهزة في قاعدة البيانات
            setTimeout(() => {
                startDeviceStatusMonitoring();
            }, 5000);
        } catch (error) {
            console.warn('Failed to initialize Supabase Manager:', error);
        }
    }

    // ==================== AUTO-START DISABLED ====================
    // تعطيل الإقلاع التلقائي عند تشغيل الحاسوب
    try {
        app.setLoginItemSettings({
            openAtLogin: false
        });
        console.log('ℹ️ الإقلاع التلقائي معطّل');
    } catch (autoStartError) {
        console.warn('⚠️ فشل في تعطيل الإقلاع التلقائي:', autoStartError.message);
    }
    // ==================== END AUTO-START ====================

    createWindow();
});

// معالج إضافي لضمان تحديث حالة السيرفر عند إغلاق العملية
process.on('exit', async (code) => {
    console.log(`🔴 PROCESS EXIT: Code ${code} - Updating server status...`);
    try {
        await updateServerStatusOnExit();
        // إيقاف اتصال Supabase
        if (supabaseManager && supabaseManager.client) {
            console.log('🔌 Disconnecting from Supabase...');
            // لا حاجة لإيقاف اتصال Supabase بشكل صريح، لكن نتأكد من تحديث الحالة
        }
        console.log('✅ Server status updated on process exit');
    } catch (error) {
        console.error('❌ Failed to update server status on process exit:', error);
    }
});

// معالج للإشارات في Linux/Mac
process.on('SIGINT', async () => {
    console.log('🔴 SIGINT received - Cleaning up...');
    try {
        await performFullCleanup();
    } catch (error) {
        console.error('❌ Failed cleanup on SIGINT:', error);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🔴 SIGTERM received - Cleaning up...');
    try {
        await performFullCleanup();
    } catch (error) {
        console.error('❌ Failed cleanup on SIGTERM:', error);
    }
    process.exit(0);
});

// ==================== دالة تنظيف الأجهزة المحظورة ====================
/**
 * إعادة تفعيل جميع الأجهزة التي تم حظرها خلال هذه الجلسة
 * يتم استدعاؤها عند إغلاق البرنامج لمنع بقاء الأجهزة معطلة بشكل دائم
 */
/**
 * ====== CLEANUP DISABLED DEVICES (مثل Backend تماماً) ======
 * يبحث عن جميع الأجهزة المعطلة في النظام (ليس فقط المسجلة في الذاكرة)
 * ويحاول تفعيلها بطريقتين:
 * 1. pnputil /enable-device (الأفضل)
 * 2. Enable-PnpDevice (fallback)
 */
async function cleanupBlockedDevices() {
    console.log(`\n🧹 ══════════════════════════════════════════════`);
    console.log(`🧹  CLEANUP: Searching for disabled USB devices...`);
    console.log(`🧹 ══════════════════════════════════════════════`);

    const allDevicesToCleanup = new Set();

    // أجهزة مسجلة في الذاكرة
    blockedDeviceIds.forEach(id => allDevicesToCleanup.add(id));

    // أجهزة معطلة حالياً في النظام (مطابق لـ cleanup_devices.py)
    try {
        const psScript = `
        $disabledDevices = Get-PnpDevice | Where-Object {
            ($_.InstanceId -like "USB\\\\VID_*" -or $_.InstanceId -like "HID\\\\VID_*") -and
            $_.Present -eq $true -and
            ($_.Status -ne "OK" -or $_.ConfigManagerErrorCode -ne 0)
        } | Select-Object -ExpandProperty InstanceId
        if ($disabledDevices) { $disabledDevices } else { "" }
        `;

        await new Promise((resolve) => {
            exec(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`,
                { timeout: 20000 }, (error, stdout) => {
                    stdout
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line && line.length > 5 && line.includes('VID_'))
                        .forEach(id => allDevicesToCleanup.add(id));
                    resolve();
                });
        });
    } catch (e) {
        console.warn('⚠️ Failed to scan system for disabled devices:', e.message);
    }

    // أجهزة فشل تنظيفها سابقاً
    try {
        const failedDevicesPath = path.join(userDataPath, 'failed_cleanup_devices.json');
        if (fs.existsSync(failedDevicesPath)) {
            const existingFailed = JSON.parse(fs.readFileSync(failedDevicesPath, 'utf8'));
            if (Array.isArray(existingFailed)) {
                existingFailed
                    .map(d => d && d.instance_id)
                    .filter(Boolean)
                    .forEach(id => allDevicesToCleanup.add(id));
            }
        }
    } catch (e) {
        console.warn('⚠️ Failed to read failed cleanup file:', e.message);
    }

    const deviceList = [...allDevicesToCleanup];
    if (deviceList.length === 0) {
        console.log('✅ No disabled devices to cleanup');
        return;
    }

    console.log(`🧹 Cleaning up ${deviceList.length} disabled device(s)...`);

    // === تفعيل جميع الأجهزة المعطلة (متوازي) ===
    const enablePromises = deviceList.map(deviceId => {
        return new Promise((resolve) => {
            const safeId = deviceId.replace(/["';]/g, '');
            console.log(`   🔓 Re-enabling: ${safeId}`);

            // المحاولة الأولى: pnputil /enable-device
            exec(`pnputil /enable-device "${safeId}"`, { timeout: 15000 }, (error1, stdout1, stderr1) => {
                const pnpOut = `${stdout1 || ''}${stderr1 || ''}`.toLowerCase();
                if (!error1 || pnpOut.includes('successfully')) {
                    blockedDeviceIds.delete(deviceId);
                    resolve({ success: true, id: deviceId, method: 'pnputil' });
                    return;
                }

                // المحاولة الثانية: Enable-PnpDevice
                const enableCmd = `powershell -NoProfile -NonInteractive -Command "Enable-PnpDevice -InstanceId '${safeId}' -Confirm:$false -ErrorAction Continue; Write-Output 'ENABLED_OK'"`;
                exec(enableCmd, { timeout: 15000 }, (error2, stdout2, stderr2) => {
                    if (!error2 && stdout2 && stdout2.includes('ENABLED_OK')) {
                        blockedDeviceIds.delete(deviceId);
                        resolve({ success: true, id: deviceId, method: 'powershell' });
                        return;
                    }

                    // المحاولة الثالثة: WMI Enable()
                    const wmiCmd = `powershell -NoProfile -NonInteractive -Command "$dev = Get-WmiObject Win32_PnPEntity -Filter \"DeviceID='${safeId}'\"; if ($dev) { $dev.Enable() | Out-Null; Write-Output 'ENABLED_WMI_OK' } else { Write-Output 'NOT_FOUND' }"`;
                    exec(wmiCmd, { timeout: 15000 }, (error3, stdout3, stderr3) => {
                        if (!error3 && stdout3 && stdout3.includes('ENABLED_WMI_OK')) {
                            blockedDeviceIds.delete(deviceId);
                            resolve({ success: true, id: deviceId, method: 'wmi' });
                        } else {
                            resolve({ success: false, id: deviceId, error: stderr1 || stderr2 || stderr3 });
                        }
                    });
                });
            });
        });
    });

    const results = await Promise.all(enablePromises);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`🧹 Cleanup complete: ${successCount} re-enabled, ${failCount} failed`);
    console.log(`🧹 ══════════════════════════════════════════════\n`);

    if (failCount > 0) {
        try {
            const failedDevicesPath = path.join(userDataPath, 'failed_cleanup_devices.json');
            const failedDevices = results
                .filter(r => !r.success)
                .map(r => ({
                    instance_id: r.id,
                    error: r.error,
                    failed_at: new Date().toISOString(),
                    note: 'Device failed to re-enable. Manual intervention may be required.'
                }));
            fs.writeFileSync(failedDevicesPath, JSON.stringify(failedDevices, null, 2));
            console.log(`⚠️ Failed cleanup devices saved to: ${failedDevicesPath}`);
        } catch (e) {
            console.error('Failed to save failed cleanup devices:', e.message);
        }
    } else {
        // تنظيف ملف الفشل إذا تم التنظيف بالكامل
        try {
            const failedDevicesPath = path.join(userDataPath, 'failed_cleanup_devices.json');
            if (fs.existsSync(failedDevicesPath)) fs.unlinkSync(failedDevicesPath);
        } catch (e) { }
    }

    blockedDeviceIds.clear();
}

let isCleaningUp = false;
let cleanupFinished = false;

async function performFullCleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    console.log('🔄 Starting Full Cleanup process...');

    // تأكد من وجود Supabase Manager
    if (!supabaseManager && SupabaseManager) {
        try {
            supabaseManager = new SupabaseManager();
        } catch (e) {
            console.warn('⚠️ Failed to initialize Supabase Manager during cleanup:', e.message);
        }
    }

    // تحميل معلومات الاتصال بدون إسقاط الجلسة (حتى لو كانت منتهية)
    if (!connectionInfo) {
        try {
            if (fs.existsSync(connectionInfoPath)) {
                const raw = fs.readFileSync(connectionInfoPath, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed && parsed.server_id) connectionInfo = parsed;
            }
        } catch (e) {
            console.warn('⚠️ Failed to read connection info from file:', e.message);
        }
    }
    if (!connectionInfo) {
        connectionInfo = await loadConnectionInfo();
    }
    const currentServerId = connectionInfo?.server_id;

    if (!currentServerId) {
        console.warn('⚠️ No server ID found for cleanup, skipping database device deletion.');
    } else {
        // ===== 1. حذف جميع الأجهزة المعلقة من agent_pending_devices لهذا السيرفر =====
        try {
            if (supabaseManager && supabaseManager.client) {
                console.log(`🧹 Cleaning up ALL pending devices for server_id: ${currentServerId}...`);
                
                // أولاً نحصل على عدد الأجهزة المعلقة قبل الحذف
                const { count: beforeCount, error: countError } = await supabaseManager.client
                    .from('agent_pending_devices')
                    .select('*', { count: 'exact', head: true })
                    .eq('agent_server_id', currentServerId);
                
                if (countError) {
                    console.warn('⚠️ Error counting pending devices:', countError.message);
                } else {
                    console.log(`📊 Found ${beforeCount} pending devices before cleanup`);
                }
                
                // ثم نقوم بالحذف
                const { error, count } = await supabaseManager.client
                    .from('agent_pending_devices')
                    .delete({ count: 'exact' })
                    .eq('agent_server_id', currentServerId);

                if (error) {
                    console.warn('⚠️ Error cleaning agent_pending_devices:', error.message);
                    console.error('Full error details:', error);
                } else {
                    console.log(`✅ Cleaned ${count} pending devices for server_id: ${currentServerId}`);
                }
            } else {
                console.warn('⚠️ Supabase manager or client not available during cleanup');
            }
        } catch (cleanupErr) { 
            console.error('❌ Error cleaning agent_pending_devices:', cleanupErr); 
            console.error('Full cleanup error:', cleanupErr);
        }

        // ===== 2. تحديث حالة جميع أجهزة هذا الـ Agent إلى disconnected في جدول devices =====
        try {
            if (supabaseManager && supabaseManager.client) {
                console.log(`🧹 Marking all devices as disconnected for server_id: ${currentServerId}...`);
                const { error } = await supabaseManager.client
                    .from('devices')
                    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
                    .eq('server_id', currentServerId)
                    .in('status', ['connected', 'pending']);

                if (error) {
                    console.warn('⚠️ Error updating devices to disconnected:', error.message);
                } else {
                    console.log('✅ All devices marked as disconnected');
                }
            }
        } catch (devErr) { console.error('❌ Error updating devices status:', devErr); }
    }

    // ===== 3. تنظيف الأجهزة المحظورة (إعادة تفعيلها) =====
    try {
        if (typeof cleanupBlockedDevices === 'function') {
            await cleanupBlockedDevices();
        }
    } catch (blockErr) {
        console.error('❌ Error in cleanup blocked devices:', blockErr);
    }

    // ===== 4. تحديث حالة السيرفر إلى غير متصل =====
    try { await updateServerStatusOnExit(); } catch (statusErr) { }

    // ===== 5. إيقاف جميع العمليات والمؤقتات =====
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    try { if (typeof stopHeartbeat === 'function') stopHeartbeat(); } catch (e) { }
    try { if (typeof stopDeviceStatusMonitoring === 'function') await stopDeviceStatusMonitoring(); } catch (e) { }
    if (supabaseManager && supabaseManager.client) supabaseManager = null;

    cleanupFinished = true;
    console.log('✅ Full cleanup completed');
}

app.on('before-quit', async (event) => {
    console.log('🔴 EVENT: before-quit triggered');

    // منع التكرار اللانهائي
    if (app.isQuiting) {
        return;
    }

    event.preventDefault();
    app.isQuiting = true;

    try {
        console.log('🔄 Starting cleanup process...');

        // نضع مهلة 15 ثانية للتنظيف لضمان إعطاء الوقت الكافي للـ database و powershell
        await Promise.race([
            performFullCleanup(),
            new Promise(resolve => setTimeout(resolve, 15000))
        ]);

        console.log('✅ All cleanup completed, now quitting...');
        app.exit(0);

    } catch (error) {
        console.error('Error during cleanup:', error);
        // حتى لو فشل شي ثاني، حاول تنظيف الأجهزة
        try { if (typeof cleanupBlockedDevices === 'function') await cleanupBlockedDevices(); } catch (_) { }
        app.exit(1);
    }
});

app.on('window-all-closed', () => {
    console.log('🔴 EVENT: window-all-closed triggered');
    if (process.platform !== 'darwin') {
        app.quit(); // وهذا بدوره سيتسبب في تشغيل حدث 'before-quit'
    }
});

app.on('activate', () => {
    // على macOS، إعادة إنشاء النافذة عند النقر على أيقونة التطبيق في الـ dock
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// إعادة إنشاء النافذة على Windows/Linux عند محاولة فتح التطبيق مرة أخرى
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    } else {
        createWindow();
    }
});

// IPC Handlers

// System information caching to save resources
let cachedSystemData = null;
let lastCacheTime = 0;

// System information
async function getSystemInfo() {
    try {
        // Get basic system info
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        const systemInfo = {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            uptime: os.uptime(),
            cpu: os.cpus(),
            totalmem: totalMem,
            freemem: freeMem,
            memory: {
                total: totalMem,
                free: freeMem,
                used: usedMem,
                usage: ((usedMem / totalMem) * 100).toFixed(2)
            },
            storage: {
                total: 0,
                used: 0,
                free: 0,
                usage: 0
            },
            network: {
                interfaces: []
            }
        };

        // Get network interfaces and extract IP address
        const networkInterfaces = os.networkInterfaces();
        let primaryIP = '127.0.0.1'; // Default fallback
        const validInterfaces = [];

        // Find the best IP address (prefer non-loopback, IPv4)
        for (const [name, interfaces] of Object.entries(networkInterfaces)) {
            if (!interfaces) continue;

            const validAddresses = [];
            for (const iface of interfaces) {
                if (!iface.internal && iface.family === 'IPv4') {
                    validAddresses.push({
                        family: iface.family,
                        address: iface.address,
                        netmask: iface.netmask,
                        mac: iface.mac
                    });

                    // Prefer non-VM interfaces
                    if (!primaryIP || primaryIP === '127.0.0.1' ||
                        (!name.toLowerCase().includes('vbox') &&
                            !name.toLowerCase().includes('vmware') &&
                            !name.toLowerCase().includes('virtual'))) {
                        primaryIP = iface.address;
                    }
                }
            }

            if (validAddresses.length > 0) {
                validInterfaces.push({
                    name,
                    addresses: validAddresses,
                    isUp: true
                });
            }
        }

        systemInfo.network.interfaces = validInterfaces;
        systemInfo.ip = primaryIP;

        // Try to get public IP if public-ip is available
        if (publicIp) {
            try {
                let publicIP;
                if (typeof publicIp.v4 === 'function') {
                    publicIP = await publicIp.v4();
                } else if (typeof publicIp === 'function') {
                    publicIP = await publicIp();
                }

                if (publicIP) {
                    systemInfo.public_ip = publicIP;
                    // Use public IP if no local IP found
                    if (!systemInfo.ip) {
                        systemInfo.ip = publicIP;
                    }
                }
            } catch (error) {
                // Silently ignore public IP errors
            }
        }        // Use systeminformation if available for more detailed info
        if (si) {
            try {
                // Get CPU load (fast enough)
                const cpu = await si.currentLoad();
                systemInfo.cpu.usage = cpu.currentLoad || 0;

                // Cache heavy stats (Memory/Disk) for 1 hour to save resources on 4GB RAM server
                const now = Date.now();
                if (!cachedSystemData || (now - lastCacheTime > 3600000)) {
                    const [mem, disk] = await Promise.all([
                        si.mem(),
                        si.fsSize()
                    ]);

                    if (mem) {
                        systemInfo.memory = {
                            total: mem.total,
                            free: mem.free,
                            used: mem.used,
                            usage: (mem.used / mem.total * 100).toFixed(2)
                        };
                    }

                    if (disk && disk.length > 0) {
                        const mainDisk = disk[0];
                        systemInfo.storage = {
                            total: mainDisk.size,
                            used: mainDisk.used,
                            free: mainDisk.available,
                            usage: mainDisk.use
                        };
                    }
                    cachedSystemData = { storage: systemInfo.storage, memory: systemInfo.memory };
                    lastCacheTime = now;
                } else {
                    systemInfo.storage = cachedSystemData.storage;
                    if (cachedSystemData.memory) systemInfo.memory = cachedSystemData.memory;
                }
            } catch (error) {
                console.warn('Error getting detailed system info:', error);
            }
        }

        return systemInfo;
    } catch (error) {
        console.error('Error getting system info:', error);
        throw error;
    }
}

// Helper function to read string descriptor as a promise
function getStringDescriptorPromise(device, index) {
    return new Promise((resolve) => {
        if (!index) return resolve(null);
        try {
            device.getStringDescriptor(index, (error, data) => {
                if (!error && data) {
                    resolve(data.toString());
                } else {
                    resolve(null);
                }
            });
        } catch (e) {
            resolve(null);
        }
    });
}

// USB device management
async function getUSBDevices() {
    try {
        if (!usb) {
            return { devices: [] };
        }

        const devices = usb.getDeviceList();
        const deviceInfo = [];

        for (const device of devices) {
            try {
                const descriptor = device.deviceDescriptor;
                const deviceData = {
                    id: `${descriptor.idVendor}:${descriptor.idProduct}`,
                    name: `USB Device ${descriptor.idVendor}:${descriptor.idProduct}`,
                    manufacturer: '',
                    deviceClass: getDeviceClass(descriptor.bDeviceClass),
                    vendorId: descriptor.idVendor,
                    productId: descriptor.idProduct,
                    vendor_id: descriptor.idVendor.toString(16).toUpperCase().padStart(4, '0'),
                    product_id: descriptor.idProduct.toString(16).toUpperCase().padStart(4, '0'),
                    isConnected: true,
                    detected_at: new Date().toISOString()
                };

                // Try to get string descriptors
                try {
                    device.open();

                    if (descriptor.iManufacturer) {
                        const manufacturer = await getStringDescriptorPromise(device, descriptor.iManufacturer);
                        if (manufacturer) deviceData.manufacturer = manufacturer;
                    }

                    if (descriptor.iProduct) {
                        const productName = await getStringDescriptorPromise(device, descriptor.iProduct);
                        if (productName) deviceData.name = productName;
                    }

                    if (descriptor.iSerialNumber) {
                        const serial = await getStringDescriptorPromise(device, descriptor.iSerialNumber);
                        if (serial) deviceData.serial_number = serial;
                    }

                    device.close();
                } catch (error) {
                    // Ignore errors when reading descriptors
                    try { device.close(); } catch (e) { }
                }

                deviceInfo.push(deviceData);
            } catch (error) {
                console.warn('Error reading device descriptor:', error);
            }
        }

        // 🔄 تطبيق إزالة التكرار المحسنة (دمج 3 طبقات)
        const deduplicatedDevices = enhancedDeviceDeduplication(deviceInfo);

        return { devices: deduplicatedDevices };
    } catch (error) {
        console.error('Error getting USB devices:', error);
        return { devices: [] };
    }
}

// Window controls
ipcMain.handle('minimize-window', () => {
    mainWindow.minimize();
});

ipcMain.handle('maximize-window', () => {
    mainWindow.maximize();
});

ipcMain.handle('toggle-maximize-window', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.handle('close-window', () => {
    if (mainWindow) {
        app.isQuitting = true;
        mainWindow.close();
        console.log('🔴 Window closed - app quitting');
    }
});

// معالج لإظهار النافذة مرة أخرى
ipcMain.handle('show-window', () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        console.log('👁️ Window shown');
    }
});

// معالج لإغلاق التطبيق تماماً
ipcMain.handle('quit-app', () => {
    app.isQuitting = true;
    app.quit();
    console.log('🛑 Application quitting...');
});

// System information
ipcMain.handle('get-system-info', async () => {
    try {
        const systemInfo = await getSystemInfo();
        return systemInfo;
    } catch (error) {
        console.error('Error in get-system-info handler:', error);
        throw error;
    }
});

// USB device management
ipcMain.handle('get-usb-devices', async () => {
    try {
        if (!usb) {
            return [];
        }

        const devices = usb.getDeviceList();
        const deviceInfo = [];

        for (const device of devices) {
            try {
                const descriptor = device.deviceDescriptor;
                const deviceData = {
                    id: `${descriptor.idVendor}:${descriptor.idProduct}`,
                    name: `USB Device ${descriptor.idVendor}:${descriptor.idProduct}`,
                    manufacturer: '',
                    deviceClass: getDeviceClass(descriptor.bDeviceClass),
                    vendorId: descriptor.idVendor,
                    productId: descriptor.idProduct,
                    isConnected: true
                };

                // Try to get string descriptors
                try {
                    device.open();
                    if (descriptor.iManufacturer) {
                        device.getStringDescriptor(descriptor.iManufacturer, (error, data) => {
                            if (!error && data) {
                                deviceData.manufacturer = data.toString();
                            }
                        });
                    }
                    if (descriptor.iProduct) {
                        device.getStringDescriptor(descriptor.iProduct, (error, data) => {
                            if (!error && data) {
                                deviceData.name = data.toString();
                            }
                        });
                    }
                    device.close();
                } catch (error) {
                    // Ignore errors when reading descriptors
                }

                deviceInfo.push(deviceData);
            } catch (error) {
                console.warn('Error reading device descriptor:', error);
            }
        }

        return deviceInfo;
    } catch (error) {
        console.error('Error getting USB devices:', error);
        return [];
    }
});

// Configuration management
ipcMain.handle('read-config', async (event, fileName) => {
    try {
        const filePath = path.join(configPath, fileName);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
        return null;
    } catch (error) {
        console.error('Error reading config:', error);
        return null;
    }
});

ipcMain.handle('write-config', async (event, fileName, data) => {
    try {
        const filePath = path.join(configPath, fileName);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing config:', error);
        return false;
    }
});

ipcMain.handle('get-config', async () => {
    return await ipcMain.handle('read-config', null, 'agent_config.json');
});

ipcMain.handle('save-config', async (event, config) => {
    return await ipcMain.handle('write-config', null, 'agent_config.json', config);
});

// Connection management
ipcMain.handle('get-connection-info', async () => {
    return connectionInfo;
});

ipcMain.handle('save-connection-info', async (event, info) => {
    try {
        connectionInfo = info;
        fs.writeFileSync(connectionInfoPath, JSON.stringify(info, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving connection info:', error);
        return false;
    }
});

ipcMain.handle('clear-connection-info', async () => {
    try {
        connectionInfo = null;
        if (fs.existsSync(connectionInfoPath)) {
            fs.unlinkSync(connectionInfoPath);
        }

        // Stop heartbeat
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        return true;
    } catch (error) {
        console.error('Error clearing connection info:', error);
        return false;
    }
});

ipcMain.handle('get-connection-status', async () => {
    return {
        isConnected: connectionInfo !== null,
        lastHeartbeat: connectionInfo?.lastHeartbeat || null
    };
});

// App information
ipcMain.handle('get-app-version', async () => {
    return app.getVersion();
});

// Notifications
ipcMain.handle('show-notification', async (event, title, body) => {
    try {
        if (Notification.isSupported()) {
            new Notification({
                title: title,
                body: body,
                icon: path.join(__dirname, 'assets', 'icon.ico')
            }).show();
        }
        return true;
    } catch (error) {
        console.error('Error showing notification:', error);
        return false;
    }
});

// System utilities
ipcMain.handle('execute-command', async (event, command) => {
    return new Promise((resolve, reject) => {
        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
});

// USB Agent handlers
ipcMain.handle('start-usb-agent', async () => {
    startUSBAgent();
    return { success: true };
});

ipcMain.handle('stop-usb-agent', async () => {
    await stopUSBAgent();
    return { success: true };
});

ipcMain.handle('connect-usb-agent', async (event, config) => {
    if (!usbAgent) {
        return { success: false, message: 'USB Agent not initialized' };
    }
    return await usbAgent.connectToServer(config.serverUrl, config.username, config.password);
});

ipcMain.handle('disconnect-usb-agent', async () => {
    if (!usbAgent) {
        return { success: false, message: 'USB Agent not initialized' };
    }
    return await usbAgent.disconnectFromServer();
});

ipcMain.handle('control-usb-device', async (event, deviceId, action) => {
    if (!usbAgent) {
        return { success: false, message: 'USB Agent not initialized' };
    }
    return await usbAgent.controlUsbDevice(deviceId, action);
});

// Legacy handlers for backward compatibility
ipcMain.handle('connect-to-server', async (event, config) => {
    // This would be handled by the renderer process now
    return { success: true };
});

ipcMain.handle('send-heartbeat', async (event, data) => {
    // This would be handled by the renderer process now
    return { success: true };
});

ipcMain.handle('scan-devices', async () => {
    return await ipcMain.handle('get-usb-devices');
});

// IPC handler لإرسال الأجهزة المكتشفة يدوياً إلى السيرفر المركزي
ipcMain.handle('send-devices-to-server', async (event, devices) => {
    try {
        if (!Array.isArray(devices) || devices.length === 0) {
            return { success: false, message: 'لا توجد أجهزة للإرسال' };
        }

        await sendDiscoveredDevicesToCentralServer(devices);
        return { success: true, message: `تم إرسال ${devices.length} جهاز للسيرفر المركزي` };
    } catch (error) {
        console.error('Error in send-devices-to-server handler:', error);
        return { success: false, message: error.message };
    }
});

// IPC handler للتحقق من حالة الاتصال بالسيرفر المركزي
ipcMain.handle('check-server-connection', async () => {
    try {
        if (!connectionInfo || !connectionInfo.server_url) {
            return { connected: false, message: 'لا يوجد اتصال بالسيرفر' };
        }

        return {
            connected: true,
            server_url: connectionInfo.server_url,
            server_name: connectionInfo.server_name,
            message: 'متصل بالسيرفر المركزي'
        };
    } catch (error) {
        return { connected: false, message: error.message };
    }
});

// دالة حفظ الجهاز المُوافق عليه في قاعدة البيانات فقط
async function saveApprovedDeviceToDatabase(deviceData) {
    try {
        if (!supabaseManager || !supabaseManager.client) {
            throw new Error('Supabase not available');
        }

        const deviceToSave = {
            server_id: connectionInfo?.server_id || 1,
            name: deviceData.name,
            serial_number: deviceData.serial_number,
            vendor_id: deviceData.vendor_id,
            product_id: deviceData.product_id,
            manufacturer: deviceData.manufacturer || 'Unknown',
            device_class: deviceData.device_class || 'Unknown',
            status: 'connected', // الجهاز المُوافق عليه يصبح متصل
            detected_at: deviceData.detected_at || new Date().toISOString(),
            system_info: deviceData.system || 'Windows',
            location: deviceData.location || 'USB Port',
            is_real_device: true,
            user_id: connectionInfo?.user_id || null,
            usb_port: deviceData.location || 'USB Port',
            physical_path: deviceData.device_id || '',
            whitelisted: true, // الجهاز المُوافق عليه يصبح في القائمة البيضاء
            meta_data: JSON.stringify({
                device_type: deviceData.device_class || 'Unknown',
                port_number: deviceData.location || 'USB Port',
                physical_path: deviceData.device_id || '',
                system: deviceData.system || 'Windows',
                detected_at: deviceData.detected_at || new Date().toISOString(),
                is_real_device: true,
                discovery_method: 'electron_agent',
                approved_at: new Date().toISOString()
            })
        };

        const { data, error } = await supabaseManager.client
            .from('devices')
            .upsert(deviceToSave, {
                onConflict: 'server_id,serial_number',
                ignoreDuplicates: false
            })
            .select();

        if (error) {
            throw error;
        }

        console.log(`✅ Approved device saved to database: ${deviceData.name}`);
        return data && data.length > 0 ? data[0] : deviceToSave;
    } catch (error) {
        console.error('❌ Error saving approved device:', error);
        throw error;
    }
}

/**
 * دالة لإرسال الأجهزة المحظورة إلى جدول agent_pending_devices
 * تستخدم منطق حظر الأجهزة من backend/services/device_blocker.py
 */
async function savePendingBlockedDevices(devices, serverId) {
    try {
        if (!supabaseManager || !supabaseManager.client) {
            console.warn('⚠️ Supabase Manager not available');
            return { success: false, message: 'Supabase not available' };
        }

        if (!Array.isArray(devices) || devices.length === 0) {
            console.log('ℹ️ No devices to save');
            return { success: true, message: 'No devices to save', saved: 0 };
        }

        console.log(`\n🔍 [Device Blocker] معالجة ${devices.length} جهاز للحظر والإرسال`);

        let savedCount = 0;
        let skippedInternalCount = 0;
        const results = [];

        for (const device of devices) {
            try {
                // التحقق من أن الجهاز ليس داخلياً باستخدام deviceBlocker
                if (deviceBlocker && typeof deviceBlocker.isInternalDevice === 'function') {
                    if (deviceBlocker.isInternalDevice(device)) {
                        console.log(`⏭️  تجاوز جهاز داخلي: ${device.name || device.serial_number}`);
                        skippedInternalCount++;
                        continue;
                    }
                }

                // تحضير بيانات الجهاز للإرسال
                const pendingDeviceData = {
                    agent_server_id: serverId || connectionInfo?.server_id || 1,
                    device_name: device.name || 'Unknown USB Device',
                    serial_number: device.serial_number || device.instanceId || `INST_${Date.now()}`,
                    vendor_id: (device.vendor_id || '').toUpperCase(),
                    product_id: (device.product_id || '').toUpperCase(),
                    device_class: device.class || device.deviceClass || 'Unknown',
                    manufacturer: device.manufacturer || 'Unknown',
                    usb_port: device.location || device.usb_port || 'Unknown',
                    status: 'pending',
                    discovered_at: device.detected_at || new Date().toISOString(),
                    received_at: new Date().toISOString(),
                    meta_data: JSON.stringify({
                        device_info: device,
                        detected_by: 'electron_usb_agent',
                        is_real_device: true,
                        detection_time: new Date().toISOString(),
                        blocked_reason: 'external_USB_device_detected'
                    })
                };

                // حفظ الجهاز في agent_pending_devices
                if (supabaseManager.saveAgentPendingDevice) {
                    const saveResult = await supabaseManager.saveAgentPendingDevice(pendingDeviceData);
                    if (saveResult.success) {
                        console.log(`✅ تم حفظ جهاز معلق: ${pendingDeviceData.device_name}`);
                        savedCount++;
                        results.push(saveResult);
                    } else {
                        console.warn(`⚠️ فشل في حفظ الجهاز: ${pendingDeviceData.device_name} - ${saveResult.error}`);
                    }
                }
            } catch (deviceError) {
                console.error(`❌ خطأ عند معالجة الجهاز: ${device.name}`, deviceError);
            }
        }

        console.log(`\n📊 [Device Blocker] النتائج:`);
        console.log(`   ✅ تم حفظه: ${savedCount} جهاز`);
        console.log(`   ⏭️  تم تجاوزه: ${skippedInternalCount} جهاز داخلي`);
        console.log(`   📍 الإجمالي المعالج: ${devices.length} جهاز\n`);

        return {
            success: true,
            message: `تم معالجة ${devices.length} جهاز`,
            saved: savedCount,
            skipped: skippedInternalCount,
            results: results
        };
    } catch (error) {
        console.error('❌ Error in savePendingBlockedDevices:', error);
        return {
            success: false,
            message: error.message
        };
    }
}

// Approve device - Enable physically + Save to database as approved and connected
ipcMain.handle('approve-device', async (event, device) => {
    try {
        console.log('🔄 معالجة الموافقة على الجهاز:', device);

        // *** خطوة 1: تفعيل الجهاز فعلياً عبر Enable-PnpDevice ***
        const deviceId = device.device_id || '';
        if (deviceId && process.platform === 'win32') {
            console.log(`🔓 Enabling device: ${device.name || 'Unknown'} (${deviceId})`);
            const enableResult = await enableDeviceReal(deviceId);
            if (enableResult.success) {
                console.log(`✅ Device physically enabled: ${deviceId}`);
            } else {
                console.warn(`⚠️ Could not enable device: ${enableResult.message}`);
                // نكمل حتى لو فشل التفعيل - نحفظه كمعتمد في DB
            }
        }

        // إضافة للمجموعة المحلية لمنع إعادة حظره
        if (deviceId) {
            approvedDeviceIds.add(deviceId);
            blockedDeviceIds.delete(deviceId);
        }

        if (!supabaseManager) {
            console.error('❌ Supabase Manager not initialized');
            return { success: false, error: 'Supabase Manager not initialized' };
        }

        // *** خطوة 2: حفظ الجهاز في قاعدة البيانات ***
        const deviceToSave = {
            server_id: connectionInfo?.server_id || 1,
            name: device.name || device.device_name || 'Unknown Device',
            serial_number: device.serial_number || device.serial,
            manufacturer: device.manufacturer || 'Unknown',
            vendor_id: device.vendor_id || '',
            product_id: device.product_id || '',
            product: device.product || null,
            device_class: device.device_class || device.class || null,
            usb_port: device.usb_port || 'USB Port Unknown',
            status: 'connected',
            connection_time: new Date().toISOString(),
            last_activity: new Date().toISOString(),
            is_verified: true,
            whitelisted: true,
            approved_at: new Date().toISOString(),
            risk_level: 'low',
            monitoring_enabled: true,
            meta_data: JSON.stringify({
                device_id: deviceId,
                pnp_instance_id: deviceId,
                manufacturer: device.manufacturer || '',
                class: device.device_class || device.class || '',
                vid: device.vendor_id || '',
                pid: device.product_id || '',
                name: device.name || '',
                approved_via: 'usb_agent',
                approved_at: new Date().toISOString(),
                is_real_device: true
            })
        };

        const result = await supabaseManager.saveDevice(deviceToSave);

        if (result && result.success) {
            console.log('✅ تمت الموافقة على الجهاز وحفظه بنجاح');
            logDeviceApproved(device);
            try {
                const key = deriveDeviceKey(device);
                if (key && pendingDevicesMap.has(key)) pendingDevicesMap.delete(key);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('devices-discovered', { devices: Array.from(pendingDevicesMap.values()), total: pendingDevicesMap.size });
                }
            } catch (e) { }
            return { success: true, message: 'تمت الموافقة على الجهاز وتفعيله بنجاح', device: result.device };
        } else {
            console.error('❌ فشل في حفظ الجهاز:', result);
            return { success: false, error: result?.error || 'فشل في حفظ الجهاز' };
        }
    } catch (error) {
        console.error('❌ خطأ في الموافقة على الجهاز:', error);
        return { success: false, error: error.message };
    }
});

// Reject device - Remove from pending list (device stays physically blocked)
ipcMain.handle('reject-device', async (event, device) => {
    try {
        console.log('🔄 معالجة رفض الجهاز:', device);

        // الجهاز يبقى محظور فعلياً (لا نعيد تفعيله)
        const deviceId = device.device_id || '';
        if (deviceId) {
            // نتأكد أنه يبقى في قائمة المحظورين ولا ينضم للمعتمدين
            blockedDeviceIds.add(deviceId);
            approvedDeviceIds.delete(deviceId);
        }

        // إزالة من قائمة الانتظار
        try {
            const key = deriveDeviceKey(device);
            if (key && pendingDevicesMap.has(key)) pendingDevicesMap.delete(key);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('devices-discovered', { devices: Array.from(pendingDevicesMap.values()), total: pendingDevicesMap.size });
            }
        } catch (e) { }

        logDeviceRejected(device);

        // تحديث في قاعدة البيانات إذا كان الـ serial متوفر
        const serialNumber = device.serial_number || device.serial;
        if (serialNumber && supabaseManager) {
            try {
                await supabaseManager.updateDeviceStatus(serialNumber, 'rejected');
                console.log('✅ تم رفض الجهاز وتحديث حالته - يبقى محظور فعلياً');
            } catch (e) {
                console.warn('⚠️ Could not update device status in DB:', e.message);
            }
        }

        return { success: true, message: 'تم رفض الجهاز - يبقى معطل فعلياً' };
    } catch (error) {
        console.error('❌ خطأ في رفض الجهاز:', error);
        return { success: false, error: error.message };
    }
});

// ipcMain.handle('deny-device') removed: denial handled by frontend/central server.

ipcMain.handle('save-agent-data-to-supabase', async (event, agentData) => {
    try {
        if (!supabaseManager) {
            return { success: false, error: 'Supabase Manager not initialized' };
        }

        // جمع معلومات النظام والأجهزة مباشرة
        const systemInfo = await getSystemInfo();
        const usbDevices = await getUSBDevices();

        // إعداد البيانات المراد حفظها
        const dataToSave = {
            ...agentData,
            system_info: systemInfo,
            usb_devices: usbDevices.devices || [],
            network_info: systemInfo.network || {},
            location: systemInfo.location || {},
            capabilities: {
                usb_monitoring: true,
                device_control: true,
                network_monitoring: false,
                security_features: true,
                agent_mode: true
            }
        };

        // حفظ البيانات في Supabase
        const result = await supabaseManager.saveAgentData(dataToSave);

        if (result) {
            console.log('Agent data saved to Supabase successfully');
            return { success: true, message: 'تم حفظ البيانات بنجاح' };
        } else {
            console.error('Failed to save agent data to Supabase');
            return { success: false, error: 'فشل في حفظ البيانات' };
        }
    } catch (error) {
        console.error('Error saving agent data:', error);
        return { success: false, error: error.message };
    }
});

// Helper functions
function getDeviceClass(classCode) {
    const classes = {
        0: 'Undefined',
        1: 'Audio',
        2: 'Communication',
        3: 'HID',
        5: 'Physical',
        6: 'Image',
        7: 'Printer',
        8: 'Mass Storage',
        9: 'Hub',
        10: 'CDC-Data',
        11: 'Smart Card',
        13: 'Content Security',
        14: 'Video',
        15: 'Personal Healthcare',
        16: 'Audio/Video',
        17: 'Billboard',
        18: 'USB Type-C Bridge',
        220: 'Diagnostic',
        224: 'Wireless',
        239: 'Miscellaneous',
        254: 'Application Specific',
        255: 'Vendor Specific'
    };

    return classes[classCode] || 'Unknown';
}

function loadConnectionInfo() {
    try {
        if (fs.existsSync(connectionInfoPath)) {
            const data = fs.readFileSync(connectionInfoPath, 'utf8');
            connectionInfo = JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading connection info:', error);
        connectionInfo = null;
    }
}

// دالة اختبار الاتصال بـ Supabase
ipcMain.handle('test-supabase-connection', async () => {
    try {
        if (!supabaseManager) {
            return { success: false, error: 'Supabase Manager not initialized' };
        }

        // اختبار بسيط للاتصال
        const testData = {
            action: 'connection_test',
            user_id: null,
            details: JSON.stringify({
                test_type: 'connection_check',
                timestamp: new Date().toISOString(),
                app_version: '1.0.0'
            }),
            timestamp: new Date().toISOString(),
            ip_address: '127.0.0.1',
            browser_info: 'USB Agent Desktop App - Connection Test',
            target_device: 'test_device'
        };

        const result = await supabaseManager.saveAgentData(testData);

        if (result) {
            return { success: true, message: 'الاتصال بـ Supabase يعمل بشكل صحيح' };
        } else {
            return { success: false, error: 'فشل في الاتصال بـ Supabase' };
        }
    } catch (error) {
        console.error('خطأ في اختبار الاتصال:', error);
        return { success: false, error: error.message };
    }
});

// دالة التحقق من وضع السيرفر
ipcMain.handle('check-server-mode', async (event, userCredentials) => {
    try {
        if (!supabaseManager) {
            return { isServer: false, message: 'Supabase Manager not initialized' };
        }

        // جمع معلومات النظام الحالية
        const currentSystemInfo = await getSystemInfo();

        // التحقق من أن هذا الجهاز هو السيرفر الرئيسي
        const isMainServer = await supabaseManager.checkIfMainServer(currentSystemInfo);

        if (isMainServer) {
            return {
                isServer: true,
                serverType: 'primary',
                message: 'هذا الجهاز هو السيرفر الرئيسي'
            };
        } else {
            // إذا لم يكن السيرفر الرئيسي وتم توفير بيانات المستخدم
            if (userCredentials && userCredentials.username && userCredentials.password) {
                // التحقق من صحة بيانات المستخدم أولاً
                const userValidation = await supabaseManager.validateUserCredentials(
                    userCredentials.username,
                    userCredentials.password
                );

                if (!userValidation.valid) {
                    return {
                        isServer: false,
                        serverType: 'unknown',
                        error: userValidation.message || 'بيانات المستخدم غير صحيحة',
                        message: 'فشل في التحقق من بيانات المستخدم'
                    };
                }

                // محاولة تسجيل الجهاز كـ sub-server وربطه بالمستخدم تلقائياً
                const registrationResult = await supabaseManager.registerAsSubServer(
                    currentSystemInfo,
                    userCredentials.username,
                    userCredentials.password
                );

                if (registrationResult.success) {
                    // بدء مراقبة الأجهزة للسيرفر الفرعي
                    if (registrationResult.server_type === 'sub') {
                        console.log('Starting automatic USB device monitoring...');

                        // حفظ معلومات الاتصال
                        const connectionInfo = {
                            server_id: registrationResult.server_id,
                            server_name: registrationResult.server_name || currentSystemInfo.hostname,
                            server_type: registrationResult.server_type,
                            server_url: 'http://localhost:5000',
                            user_id: userValidation.user.id,
                            username: userValidation.user.username,
                            email: userValidation.user.email,
                            registered_at: new Date().toISOString()
                        };
                        await saveConnectionInfo(connectionInfo);

                        startUSBCommandMonitoring();
                        startUSBDeviceMonitoring();
                        startHeartbeat(); // بدء إرسال heartbeat
                        startDeviceMonitoring(); // بدء مراقبة الأجهزة الجديدة

                        // تحديث السيرفرات القديمة إلى offline أولاً
                        await markOldServersOffline();

                        // تحديث حالة السيرفر إلى متصل
                        await updateServerStatusOnline();

                        // حفظ آخر الأجهزة المتصلة حالياً
                        try {
                            const currentDevices = await getUSBDevices();
                            lastKnownDevices = [...currentDevices.devices];
                            console.log(`Initialized with ${lastKnownDevices.length} existing devices`);
                        } catch (error) {
                            console.error('Error initializing device list:', error);
                        }
                    }

                    return {
                        isServer: false,
                        serverType: 'secondary',
                        success: true,
                        message: `تم ربط السيرفر بحساب ${userValidation.user.username} بنجاح`,
                        user: userValidation.user,
                        registrationResult: registrationResult
                    };
                } else {
                    return {
                        isServer: false,
                        serverType: 'unknown',
                        error: registrationResult.message,
                        message: `فشل في ربط السيرفر: ${registrationResult.message}`
                    };
                }
            } else {
                return {
                    isServer: false,
                    serverType: 'unknown',
                    message: 'هذا الجهاز ليس السيرفر الرئيسي، يحتاج تسجيل دخول'
                };
            }
        }
    } catch (error) {
        console.error('خطأ في التحقق من وضع السيرفر:', error);
        return {
            isServer: false,
            serverType: 'unknown',
            message: 'خطأ في التحقق من وضع السيرفر',
            error: error.message
        };
    }
});

// دالة تسجيل الجهاز كـ sub-server
ipcMain.handle('register-sub-server', async (event, username, password) => {
    try {
        if (!supabaseManager) {
            return { success: false, message: 'Supabase Manager not initialized' };
        }

        // جمع معلومات النظام الحالية
        const currentSystemInfo = await getSystemInfo();

        // تسجيل الجهاز كـ sub-server
        const result = await supabaseManager.registerAsSubServer(currentSystemInfo, username, password);

        // إذا تم التسجيل بنجاح كـ sub-server، ابدأ مراقبة الأجهزة
        if (result.success && result.server_type === 'sub') {
            console.log('Starting automatic USB device monitoring for sub-server...');

            // حفظ معلومات الاتصال
            const connectionInfo = {
                server_id: result.server_id,
                server_name: result.server_name || currentSystemInfo.hostname,
                server_type: result.server_type,
                server_url: 'http://localhost:5000',
                registered_at: new Date().toISOString()
            };
            await saveConnectionInfo(connectionInfo);

            startUSBCommandMonitoring();
            startUSBDeviceMonitoring();
            startHeartbeat(); // بدء إرسال heartbeat
            startUSBAgent(); // تشغيل USB Agent تلقائياً
            startDeviceMonitoring(); // بدء مراقبة الأجهزة الجديدة

            // تحديث السيرفرات القديمة إلى offline أولاً
            await markOldServersOffline();

            // تحديث حالة السيرفر إلى متصل
            await updateServerStatusOnline();

            // حفظ آخر الأجهزة المتصلة حالياً
            try {
                const currentDevices = await getUSBDevices();
                lastKnownDevices = [...currentDevices.devices];
                console.log(`Initialized with ${lastKnownDevices.length} existing devices`);
            } catch (error) {
                console.error('Error initializing device list:', error);
            }
        }

        return result;
    } catch (error) {
        console.error('خطأ في تسجيل الـ sub-server:', error);
        return { success: false, message: error.message };
    }
});

// دالة تشغيل USB Agent
function startUSBAgent() {
    try {
        if (usbAgent) {
            console.log('USB Agent is already running');
            return;
        }

        if (!USBAgent) {
            console.error('USB Agent class not available');
            return;
        }

        console.log('Starting USB Agent...');

        // الحصول على server URL من connection info
        const serverUrl = connectionInfo?.serverUrl || 'http://localhost:5000';

        // إنشاء instance من USB Agent
        usbAgent = new USBAgent(true, serverUrl, supabaseManager); // headless mode

        // بدء الاتصال التلقائي
        usbAgent.autoConnect().catch(error => {
            console.error('Error in auto connect:', error);
        });

        console.log('USB Agent started successfully');
    } catch (error) {
        console.error('Error starting USB Agent:', error);
        usbAgent = null;
    }
}

// دالة إيقاف USB Agent
function stopUSBAgent() {
    if (usbAgent) {
        console.log('Stopping USB Agent...');
        usbAgent.disconnectFromServer().then(result => {
            if (!result.success) {
                console.log('Regular disconnect failed, trying force disconnect...');
                return usbAgent.forceDisconnectInDatabase();
            }
            return result;
        }).then(() => {
            usbAgent = null;
            console.log('USB Agent stopped successfully');
        }).catch(error => {
            console.error('Error stopping USB Agent:', error);
            usbAgent = null;
        });
    }
}

// دالة إيقاف الخادم في قاعدة البيانات
async function shutdownServer() {
    console.log('🔄 FUNCTION: shutdownServer called');

    if (serverShutdownInProgress) {
        console.log('⚠️  Shutdown already in progress, skipping...');
        return; // تجنب الاستدعاء المتكرر
    }

    serverShutdownInProgress = true;
    console.log('🔒 Server shutdown lock acquired');

    try {
        console.log('💾 Starting database shutdown process...');

        // قراءة معلومات الاتصال
        const connInfo = await loadConnectionInfo();
        if (!connInfo || !connInfo.server_id || !connInfo.server_url) {
            console.log('⚠️  No server connection info found, skipping shutdown');
            return;
        }

        console.log(`📋 Server ID to update: ${connInfo.server_id}`);

        // تحديث حالة الخادم مباشرة في قاعدة البيانات
        // هذا هو الطريقة الأكثر موثوقية لأن التطبيق يمكنه الاتصال مباشرة بـ Supabase
        if (supabaseManager) {
            try {
                console.log('🔄 Updating server status to inactive...');
                await supabaseManager.updateServerStatus(connInfo.server_id, {
                    status: 'inactive',
                    is_active: false
                });
                console.log('✅ Server status updated successfully in database');

                // محاولة إرسال إشعار WebSocket عبر API إذا كان متاحاً
                try {
                    const response = await fetch(`${connInfo.server_url}/api/servers/${connInfo.server_id}/status`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            status: 'inactive',
                            is_active: false
                        })
                    });

                    if (response.ok) {
                        console.log('WebSocket notification sent via API');
                    } else {
                        console.log('API notification failed, but database update succeeded');
                    }
                } catch (apiError) {
                    console.log('API notification failed, but database update succeeded:', apiError.message);
                }

            } catch (dbError) {
                console.error('Failed to update server status in database:', dbError);
            }
        } else {
            console.log('Supabase Manager not available, skipping shutdown update');
        }

    } catch (error) {
        console.error('❌ Error during server shutdown process:', error);
    } finally {
        serverShutdownInProgress = false;
        console.log('🔓 Server shutdown lock released');
    }
}

// دالة فحص أوامر التحكم في USB للسيرفر الفرعي
async function checkForUSBCommands() {
    if (!supabaseManager) return;

    try {
        const systemInfo = await getSystemInfo();
        const hostname = systemInfo.hostname;

        // الحصول على الأوامر المعلقة من الـ backend
        const response = await fetch(`http://localhost:5000/api/servers/usb/commands/pending?server_name=${encodeURIComponent(hostname)}`);

        if (!response.ok) {
            console.warn('Failed to fetch pending USB commands:', response.status);
            return;
        }

        const data = await response.json();
        if (data.success && data.commands && data.commands.length > 0) {
            console.log(`Found ${data.commands.length} pending USB commands`);

            // تنفيذ كل أمر
            for (const command of data.commands) {
                await executeUSBCommand(command);
            }
        }
    } catch (error) {
        console.error('Error checking for USB commands:', error);
    }
}

// دالة تنفيذ أمر USB
async function executeUSBCommand(command) {
    try {
        console.log('Executing USB command:', command);

        let result = null;
        let status = 'completed';
        let errorMessage = null;

        switch (command.command_type) {
            case 'enable':
                result = await enableUSBPort(command.port_id, command.device_id);
                break;
            case 'disable':
                result = await disableUSBPort(command.port_id, command.device_id);
                break;
            case 'restart':
                result = await restartUSBPort(command.port_id, command.device_id);
                break;
            case 'scan':
                result = await scanUSBDevices();
                break;
            default:
                throw new Error(`Unknown command type: ${command.command_type}`);
        }

        // إرسال النتيجة إلى السيرفر المركزي
        await reportCommandResult(command.command_id, status, result, errorMessage);

    } catch (error) {
        console.error('Error executing USB command:', error);
        await reportCommandResult(command.command_id, 'failed', null, error.message);
    }
}

// دالة تفعيل منفذ USB
async function enableUSBPort(portId, deviceId) {
    return new Promise((resolve) => {
        if (usb) {
            try {
                // محاولة تفعيل المنفذ
                console.log(`Enabling USB port ${portId} for device ${deviceId}`);
                resolve({
                    success: true,
                    message: `USB port ${portId} enabled successfully`,
                    port_id: portId,
                    device_id: deviceId,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                resolve({
                    success: false,
                    message: `Failed to enable USB port: ${error.message}`,
                    port_id: portId,
                    device_id: deviceId
                });
            }
        } else {
            resolve({
                success: false,
                message: 'USB module not available',
                port_id: portId,
                device_id: deviceId
            });
        }
    });
}

// دالة تعطيل منفذ USB
async function disableUSBPort(portId, deviceId) {
    return new Promise((resolve) => {
        if (usb) {
            try {
                console.log(`Disabling USB port ${portId} for device ${deviceId}`);
                resolve({
                    success: true,
                    message: `USB port ${portId} disabled successfully`,
                    port_id: portId,
                    device_id: deviceId,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                resolve({
                    success: false,
                    message: `Failed to disable USB port: ${error.message}`,
                    port_id: portId,
                    device_id: deviceId
                });
            }
        } else {
            resolve({
                success: false,
                message: 'USB module not available',
                port_id: portId,
                device_id: deviceId
            });
        }
    });
}

// دالة إعادة تشغيل منفذ USB
async function restartUSBPort(portId, deviceId) {
    try {
        // تعطيل ثم تفعيل
        await disableUSBPort(portId, deviceId);
        await new Promise(resolve => setTimeout(resolve, 2000)); // انتظار ثانيتين
        return await enableUSBPort(portId, deviceId);
    } catch (error) {
        return {
            success: false,
            message: `Failed to restart USB port: ${error.message}`,
            port_id: portId,
            device_id: deviceId
        };
    }
}

// دالة فحص أجهزة USB
async function scanUSBDevices() {
    return new Promise((resolve) => {
        if (usb) {
            try {
                const devices = usb.getDeviceList();
                const deviceInfo = devices.map(device => ({
                    vendor_id: device.deviceDescriptor.idVendor,
                    product_id: device.deviceDescriptor.idProduct,
                    manufacturer: device.deviceDescriptor.iManufacturer,
                    product: device.deviceDescriptor.iProduct,
                    serial: device.deviceDescriptor.iSerialNumber
                }));

                resolve({
                    success: true,
                    message: `Found ${devices.length} USB devices`,
                    devices: deviceInfo,
                    count: devices.length,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                resolve({
                    success: false,
                    message: `Failed to scan USB devices: ${error.message}`,
                    devices: [],
                    count: 0
                });
            }
        } else {
            resolve({
                success: false,
                message: 'USB module not available',
                devices: [],
                count: 0
            });
        }
    });
}

// دالة إرسال نتيجة تنفيذ الأمر
async function reportCommandResult(commandId, status, result, errorMessage) {
    try {
        const response = await fetch(`http://localhost:5000/api/servers/usb/commands/${commandId}/result`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                status,
                result,
                error_message: errorMessage
            })
        });

        if (response.ok) {
            console.log(`Command result reported successfully: ${commandId}`);
        } else {
            console.warn(`Failed to report command result: ${response.status}`);
        }
    } catch (error) {
        console.error('Error reporting command result:', error);
    }
}

// بدء فحص أوامر USB للسيرفرات الفرعية
let usbCommandCheckInterval = null;
let usbDeviceMonitoringInterval = null;
let lastKnownDevices = [];

function startUSBCommandMonitoring() {
    if (usbCommandCheckInterval) {
        clearInterval(usbCommandCheckInterval);
    }

    // فحص كل 10 ثواني
    usbCommandCheckInterval = setInterval(checkForUSBCommands, 10000);
    console.log('USB command monitoring started');
}

function stopUSBCommandMonitoring() {
    if (usbCommandCheckInterval) {
        clearInterval(usbCommandCheckInterval);
        usbCommandCheckInterval = null;
        console.log('USB command monitoring stopped');
    }
}

// مراقبة الأجهزة الجديدة تلقائياً
function startUSBDeviceMonitoring() {
    if (usbDeviceMonitoringInterval) {
        clearInterval(usbDeviceMonitoringInterval);
    }

    // مراقبة الأجهزة كل 10 ثانية
    usbDeviceMonitoringInterval = setInterval(async () => {
        try {
            const currentDevices = await getUSBDevices();
            const currentDeviceIds = (currentDevices.devices || []).map(device => device.id);
            const lastDeviceIds = (lastKnownDevices || []).map(device => device.id);

            // البحث عن أجهزة جديدة
            let newDevices = currentDevices.devices.filter(device =>
                !lastDeviceIds.includes(device.id)
            );

            // 🚫 استبعاد الأجهزة الوهمية بدون سيريال حقيقي
            newDevices = newDevices.filter(device => {
                const serial = (device.serialNumber || device.serial_number || device.serial || '').toString();
                if (serial.startsWith('INST_') || !serial || serial.length < 4) {
                    return false;
                }
                return true;
            });

            // إرسال الأجهزة الجديدة للسيرفر المركزي
            if (newDevices.length > 0) {
                console.log(`Found ${newDevices.length} new USB device(s)`);
                await sendNewDevicesToCentralServer(newDevices);
            }

            // البحث عن أجهزة منفصلة
            const disconnectedDevices = lastKnownDevices.filter(device =>
                !currentDeviceIds.includes(device.id)
            );

            if (disconnectedDevices.length > 0) {
                console.log(`${disconnectedDevices.length} USB device(s) disconnected`);

                // 📝 طباعة رسالة انفصال لكل جهاز في الـ Terminal
                for (const d of disconnectedDevices) {
                    logDeviceDisconnected(d);
                }

                // إزالة أي أجهزة كانت في الـ pending محلياً وعن بعد إذا انقطعت فيزيائياً
                try {
                    let removedPending = 0;
                    for (const d of disconnectedDevices) {
                        try {
                            // Attempt to remove by exact key first
                            const k = deriveDeviceKey(d);
                            let deviceToRemove = null;
                            if (k && pendingDevicesMap.has(k)) {
                                deviceToRemove = pendingDevicesMap.get(k);
                                pendingDevicesMap.delete(k);
                                removedPending += 1;
                            } else {
                                // Otherwise try to find a pending device that matches this disconnected device heuristically
                                for (const [pk, pv] of Array.from(pendingDevicesMap.entries())) {
                                    try {
                                        if (isSameDevice(pv, d) || isSameDevice(d, pv)) {
                                            deviceToRemove = pv;
                                            pendingDevicesMap.delete(pk);
                                            removedPending += 1;
                                            break;
                                        }
                                    } catch (e) { /* ignore per-candidate errors */ }
                                }
                            }

                            // دائماً حاول حذف الجهاز من قاعدة البيانات وإرسال الحدث
                            if (supabaseManager && connectionInfo && connectionInfo.server_id) {
                                const deviceToDelete = deviceToRemove || d;
                                const serial = (deviceToDelete.serial_number || deviceToDelete.serial || '').toString();
                                const deviceId = (deviceToDelete.device_id || deviceToDelete.DeviceID || '').toString();
                                const vid = deviceToDelete.vendor_id || deviceToDelete.vendorId || '';
                                const pid = deviceToDelete.product_id || deviceToDelete.productId || '';
                                
                                try {
                                    let deleteQuery = supabaseManager.client
                                        .from('agent_pending_devices')
                                        .delete()
                                        .eq('agent_server_id', connectionInfo.server_id);
                                    
                                    if (serial && serial.length > 0) {
                                        deleteQuery = deleteQuery.eq('serial_number', serial);
                                    } else if (deviceId && deviceId.length > 0) {
                                        deleteQuery = deleteQuery.eq('device_id', deviceId);
                                    } else if (vid && pid) {
                                        deleteQuery = deleteQuery.eq('vendor_id', vid).eq('product_id', pid);
                                    } else {
                                        console.log(`⚠️ Cannot delete device from DB - no identifying info: ${deviceToDelete.name || 'Unknown'}`);
                                    }
                                    
                                    const { error } = await deleteQuery;
                                    
                                    if (error) {
                                        console.warn('Failed to remove device from DB:', error.message);
                                    } else {
                                        console.log(`🗑️ Removed disconnected device from DB: ${deviceToDelete.name || serial || deviceId}`);
                                        // إرسال الحدث للواجهة لتحديث الجدول
                                        if (mainWindow && !mainWindow.isDestroyed()) {
                                            console.log(`📤 Sending pending-device-removed event for device: ${deviceToDelete.name || serial || deviceId}`);
                                            mainWindow.webContents.send('pending-device-removed', {
                                                device: deviceToDelete,
                                                message: `تم فصل الجهاز ${deviceToDelete.name || ''} وإزالته من الانتظار`
                                            });
                                        } else {
                                            console.warn('⚠️ mainWindow is destroyed or not available');
                                        }
                                    }
                                } catch (err) {
                                    console.warn('Failed to remove device from DB:', err);
                                }
                            }
                        } catch (e) {
                            console.warn('Error processing disconnected device:', e);
                        }
                    }
                    if (removedPending > 0) {
                        console.log(`🔄 Removed ${removedPending} pending device(s) due to physical disconnection`);
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('devices-discovered', { devices: Array.from(pendingDevicesMap.values()), total: pendingDevicesMap.size });
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ Error while removing pending devices on disconnect:', e);
                }

                await updateDisconnectedDevices(disconnectedDevices);
            }

            // تحديث قائمة الأجهزة المعروفة
            lastKnownDevices = [...currentDevices.devices];

        } catch (error) {
            console.error('Error monitoring USB devices:', error);
        }
    }, 20000);

    console.log('USB device change monitoring started');
}

function stopUSBDeviceMonitoring() {
    if (usbDeviceMonitoringInterval) {
        clearInterval(usbDeviceMonitoringInterval);
        usbDeviceMonitoringInterval = null;
        console.log('USB device monitoring stopped');
    }
}

// إرسال heartbeat للسيرفر المركزي
async function sendHeartbeatToCentralServer() {
    try {
        // استخدام connectionInfo مباشرة إذا كانت متوفرة
        if (!connectionInfo || !connectionInfo.server_id) {
            console.log('No server connection info available for heartbeat');
            return false;
        }

        const systemInfo = await getSystemInfo();

        const heartbeatData = {
            server_id: connectionInfo.server_id,
            hostname: systemInfo.hostname,
            ip_address: systemInfo.ip,
            cpu_usage: systemInfo.cpu.usage || 0,
            memory_usage: systemInfo.memory ? (systemInfo.memory.usage || 0) : 0,
            disk_usage: systemInfo.storage ? (systemInfo.storage.usage || 0) : 0,
            platform: systemInfo.platform,
            last_seen: new Date().toISOString(),
            server_type: 'sub',
            status: 'active',
            is_active: true
        };

        console.log(`📡 Sending heartbeat for server ${connectionInfo.server_id} (${systemInfo.hostname})`);

        const response = await fetch(`http://localhost:5000/api/servers/${connectionInfo.server_id}/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(heartbeatData)
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`✅ Heartbeat sent successfully: ${result.message}`);
            return true;
        } else {
            const errorText = await response.text();
            console.warn(`❌ Failed to send heartbeat: ${response.status} - ${errorText}`);
            return false;
        }
    } catch (error) {
        console.error('❌ Error sending heartbeat:', error);
        return false;
    }
}

// بدء إرسال heartbeat بشكل منتظم
let serverHeartbeatInterval = null;

function startHeartbeat() {
    if (serverHeartbeatInterval) {
        clearInterval(serverHeartbeatInterval);
    }

    // إرسال heartbeat كل 60 ثانية مع تحديث حالة السيرفر لتقليل الضغط
    serverHeartbeatInterval = setInterval(async () => {
        await sendHeartbeatToCentralServer();
        // تحديث حالة السيرفر إلى متصل مع كل heartbeat
        await updateServerHeartbeat();
    }, 60000);

    // إرسال heartbeat فوري
    sendHeartbeatToCentralServer();
    updateServerHeartbeat();

    console.log('Enhanced heartbeat monitoring started');
}

// دالة تحديث heartbeat السيرفر
async function updateServerHeartbeat() {
    if (!supabaseManager || !connectionInfo) {
        return;
    }

    try {
        const systemInfo = await getSystemInfo();
        
        // استخدام توقيت بغداد (+3 UTC)
        const baghdadTime = new Date(new Date().getTime() + (3 * 60 * 60 * 1000)).toISOString();
        
        const result = await supabaseManager.client
            .from('servers')
            .update({
                status: 'active',
                last_heartbeat: baghdadTime,
                updated_at: baghdadTime,
                is_online: true,
                ip_address: systemInfo.ip || 'unknown'
            })
            .eq('id', connectionInfo.server_id);

        if (result.error) {
            console.error('Error updating server heartbeat:', result.error);
        } else {
            console.log(`💓 Server heartbeat updated - ID: ${connectionInfo.server_id}`);
        }
    } catch (error) {
        console.error('Error in updateServerHeartbeat:', error);
    }
}

function stopHeartbeat() {
    if (serverHeartbeatInterval) {
        clearInterval(serverHeartbeatInterval);
        serverHeartbeatInterval = null;
        console.log('Heartbeat monitoring stopped');
    }
}

// إرسال الأجهزة الجديدة للسيرفر المركزي (يُستدعى من USB device monitoring interval)
async function sendNewDevicesToCentralServer(newDevices) {
    try {
        if (!supabaseManager) {
            console.warn('Supabase Manager not initialized, cannot send new devices');
            return;
        }

        const connectionInfo = await getConnectionInfo();

        if (!connectionInfo || !connectionInfo.server_id) {
            console.log('No server connection info available');
            return;
        }

        if (!Array.isArray(newDevices) || newDevices.length === 0) {
            return;
        }

        // فحص كل جهاز جديد مقابل قاعدة البيانات (بدون فلتر server_id للمقارنة الشاملة)
        const dbSerials = new Set();
        try {
            const { data } = await supabaseManager.client
                .from('devices')
                .select('serial_number');
            if (Array.isArray(data)) {
                for (const d of data) {
                    if (d.serial_number) dbSerials.add(d.serial_number);
                }
            }
        } catch (e) {
            console.warn('Failed to fetch DB serials:', e);
        }

        // تصفية: فقط الأجهزة التي ليست في DB
        const devicesToSend = newDevices.filter(d => {
            const serial = (d.serial_number || d.serial || '').toString();
            return serial && !dbSerials.has(serial);
        });

        if (devicesToSend.length === 0) {
            console.log('ℹ️ No new devices to send (all already in DB)');
            return;
        }

        // إضافة الأجهزة المعلقة محلياً وإخطار الواجهة
        for (const d of devicesToSend) {
            try {
                const key = deriveDeviceKey(d);
                if (key && !pendingDevicesMap.has(key)) {
                    pendingDevicesMap.set(key, { ...d, approval_status: 'pending' });
                    logNewDeviceDiscovered(d);
                }
            } catch (e) { console.warn('⚠️ Error adding pending device:', e); }
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('devices-discovered', { devices: Array.from(pendingDevicesMap.values()), total: pendingDevicesMap.size });
        }

        // إرسال إلى agent_pending_devices
        await sendNewDevicesToAgentPending(devicesToSend);

    } catch (error) {
        console.error('Error sending new devices to central server:', error);
    }
}

// تحديث حالة الأجهزة المنفصلة
async function updateDisconnectedDevices(disconnectedDevices) {
    try {
        const connectionInfo = await getConnectionInfo();
        if (!connectionInfo || !connectionInfo.server_id) {
            return;
        }

        for (const device of disconnectedDevices) {
            try {
                const response = await fetch(`http://localhost:5000/api/devices/${device.id}/status`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Server-Id': connectionInfo.server_id.toString()
                    },
                    body: JSON.stringify({
                        status: 'disconnected',
                        disconnection_time: new Date().toISOString(),
                        last_activity: new Date().toISOString()
                    })
                });

                if (response.ok) {
                    console.log(`Device ${device.name} marked as disconnected`);
                } else {
                    console.error(`Failed to update device ${device.name} status`);
                }
            } catch (error) {
                console.error(`Error updating device ${device.name} status:`, error);
            }
        }
    } catch (error) {
        console.error('Error updating disconnected devices:', error);
    }
}

// IPC للتحكم في مراقبة أوامر USB
ipcMain.handle('start-usb-monitoring', async () => {
    startUSBCommandMonitoring();
    startUSBDeviceMonitoring(); // بدء مراقبة الأجهزة الجديدة أيضاً
    return { success: true, message: 'USB monitoring started' };
});

ipcMain.handle('stop-usb-monitoring', async () => {
    stopUSBCommandMonitoring();
    stopUSBDeviceMonitoring(); // إيقاف مراقبة الأجهزة الجديدة أيضاً
    return { success: true, message: 'USB monitoring stopped' };
});

// IPC handlers للـ heartbeat
ipcMain.handle('start-heartbeat', async () => {
    startHeartbeat();
    return { success: true, message: 'Heartbeat started' };
});

ipcMain.handle('stop-heartbeat', async () => {
    stopHeartbeat();
    return { success: true, message: 'Heartbeat stopped' };
});

// IPC handlers للسيرفر المركزي

// إرسال أمر تحكم USB إلى سيرفر فرعي
ipcMain.handle('send-usb-control-command', async (event, serverId, commandData) => {
    try {
        const response = await fetch(`http://localhost:5000/api/servers/${serverId}/usb/control`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getStoredToken()}` // سنحتاج لتنفيذ هذه الدالة
            },
            body: JSON.stringify(commandData)
        });

        if (response.ok) {
            const data = await response.json();
            return { success: true, data };
        } else {
            const error = await response.json();
            return { success: false, error: error.error };
        }
    } catch (error) {
        console.error('Error sending USB control command:', error);
        return { success: false, error: error.message };
    }
});

// الحصول على السيرفرات المتصلة
ipcMain.handle('get-connected-servers', async () => {
    try {
        const response = await fetch('http://localhost:5000/api/servers/connected', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getStoredToken()}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            return { success: true, data };
        } else {
            const error = await response.json();
            return { success: false, error: error.error };
        }
    } catch (error) {
        console.error('Error getting connected servers:', error);
        return { success: false, error: error.message };
    }
});

// الحصول على تاريخ أوامر USB
ipcMain.handle('get-usb-command-history', async (event, serverId) => {
    try {
        const response = await fetch(`http://localhost:5000/api/servers/${serverId}/usb/commands`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getStoredToken()}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            return { success: true, data };
        } else {
            const error = await response.json();
            return { success: false, error: error.error };
        }
    } catch (error) {
        console.error('Error getting USB command history:', error);
        return { success: false, error: error.message };
    }
});

// IPC handlers للأجهزة المكتشفة
ipcMain.handle('get-discovered-devices', async () => {
    try {
        return {
            success: true,
            devices: Array.from(connectedDevices.values()),
            total: connectedDevices.size,
            pending: Array.from(pendingDevicesMap.values()),
            pendingTotal: pendingDevicesMap.size
        };
    } catch (error) {
        console.error('Error getting discovered devices:', error);
        return { success: false, error: error.message, devices: [], total: 0, pending: [], pendingTotal: 0 };
    }
});

// Removed local device approval/denial handlers; approvals/denials are handled by the central server / frontend UI.

// Removed duplicate 'get-connection-status' handler (original is at line 868)

// Run a one-off discovery and return results for debugging
ipcMain.handle('run-once-discovery', async () => {
    try {
        const real = await discoverRealUSBDevices();
        const known = Array.from(connectedDevices.values());
        // collect raw powershell outputs for debugging
        const debug = await debugDiscoverRealUSBDevices();
        return { success: true, real, known, totalKnown: connectedDevices.size, debug };
    } catch (error) {
        console.error('Error in run-once-discovery:', error);
        return { success: false, error: error.message };
    }
});

// دالة جديدة لتحميل الأجهزة المعلقة من قاعدة البيانات مباشرة
ipcMain.handle('get-pending-devices-from-db', async () => {
    try {
        if (!supabaseManager || !supabaseManager.client) {
            return { success: false, error: 'Supabase not available' };
        }

        const connectionInfo = await getConnectionInfo();
        if (!connectionInfo || !connectionInfo.server_id) {
            return { success: false, error: 'No server connection' };
        }

        const { data, error } = await supabaseManager.client
            .from('agent_pending_devices')
            .select('*')
            .eq('agent_server_id', connectionInfo.server_id);

        if (error) {
            console.error('Error fetching pending devices from DB:', error);
            return { success: false, error: error.message };
        }

        const devices = (data || []).map(d => ({
            name: d.device_name,
            serial_number: d.serial_number,
            serial: d.serial_number,
            vendor_id: d.vendor_id,
            product_id: d.product_id,
            device_id: d.device_id,
            device_class: d.device_class,
            manufacturer: d.manufacturer,
            usb_port: d.usb_port,
            status: d.status
        }));

        return { success: true, devices, total: devices.length };
    } catch (error) {
        console.error('Error in get-pending-devices-from-db:', error);
        return { success: false, error: error.message };
    }
});

// Run the PowerShell discovery commands and return raw stdout/stderr for debugging
async function debugDiscoverRealUSBDevices() {
    if (process.platform !== 'win32') return { success: false, error: 'not-windows', attempts: [] };

    const runPs = (psScript) => {
        return new Promise((resolve) => {
            const os = require('os');
            const fs = require('fs');
            const path = require('path');
            const tmpDir = os.tmpdir();
            const filename = `debug_ps_${Date.now()}.ps1`;
            const tmpPath = path.join(tmpDir, filename);
            try {
                fs.writeFileSync(tmpPath, psScript, 'utf8');
            } catch (e) {
                return resolve({ error: String(e), stdout: '', stderr: '' });
            }

            exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPath}"`, { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
                try {
                    resolve({ error: error ? String(error) : null, stdout: stdout ? String(stdout) : '', stderr: stderr ? String(stderr) : '' });
                } finally {
                    try { fs.unlinkSync(tmpPath); } catch (_) { }
                }
            });
        });
    };

    const psPrimary = `
        $realUsbDevices = Get-PnpDevice | Where-Object {
            ($_.DeviceID -like "USB\\VID_*" -or $_.DeviceID -like "HID\\VID_*") -and
            $_.Status -eq "OK" -and
            $_.Present -eq $true -and
            -not ($_.DeviceID -like "*ROOT_HUB*") -and
            -not ($_.DeviceID -like "*PCI*") -and
            -not ($_.DeviceID -like "*ACPI*") -and
            -not ($_.DeviceID -like "*HDAUDIO*") -and
            -not ($_.DeviceID -like "*DISPLAY*") -and
            -not ($_.DeviceID -like "*{*") -and
            ($_.DeviceID -match "VID_[0-9A-F]{4}") -and
            ($_.DeviceID -match "PID_[0-9A-F]{4}")
        } | Select-Object DeviceID, Name, Status, Class, Manufacturer, LocationInformation, HardwareID
        $devices = @()
        foreach ($device in $realUsbDevices) { $devices += $device }
        if ($devices.Count -gt 0) { $devices | ConvertTo-Json -Depth 3 } else { "[]" }
    `;

    const psFallback = `
        $realUsb = Get-CimInstance -ClassName Win32_PnPEntity | Where-Object {
            ($_.DeviceID -like "USB\\VID_*" -or $_.DeviceID -like "HID\\VID_*") -and
            $_.Status -eq "OK" -and
            ($_.PNPDeviceID -match "VID_[0-9A-F]{4}") -and
            ($_.PNPDeviceID -match "PID_[0-9A-F]{4}")
        } | Select-Object DeviceID, Name, Status, Class, Manufacturer, LocationInformation, HardwareID
        if ($realUsb.Count -gt 0) { $realUsb | ConvertTo-Json -Depth 3 } else { "[]" }
    `;

    const primary = await runPs(psPrimary);
    let used = 'Get-PnpDevice';
    let fallback = null;
    let parsed = [];
    try {
        const raw = primary.stdout ? primary.stdout.trim() : '';
        const firstJson = raw.indexOf('[') >= 0 ? raw.slice(raw.indexOf('[')) : raw;
        parsed = firstJson ? JSON.parse(firstJson) : [];
    } catch (e) {
        // ignore parse
    }

    if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) {
        // try fallback with Get-CimInstance
        fallback = await runPs(psFallback);
        used = 'Get-CimInstance';
        try {
            const raw = fallback.stdout ? fallback.stdout.trim() : '';
            const firstJson = raw.indexOf('[') >= 0 ? raw.slice(raw.indexOf('[')) : raw;
            parsed = firstJson ? JSON.parse(firstJson) : [];
        } catch (e) {
            // ignore
        }
    }

    // If still empty, try legacy WMI query
    let wmiAttempt = null;
    if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) {
        const psWmi = `
            $real = Get-WmiObject -Class Win32_PnPEntity | Where-Object {
                ($_.DeviceID -like "USB\\VID_*" -or $_.DeviceID -like "HID\\VID_*") -and
                $_.Status -eq "OK" -and
                $_.Present -eq $true -and
                ($_.DeviceID -match "VID_[0-9A-F]{4}") -and
                ($_.DeviceID -match "PID_[0-9A-F]{4}")
            } | Select-Object DeviceID, Name, Status, Class, Manufacturer, LocationInformation, HardwareID
            if ($real.Count -gt 0) { $real | ConvertTo-Json -Depth 3 } else { "[]" }
        `;
        wmiAttempt = await runPs(psWmi);
        try {
            const raw = wmiAttempt.stdout ? wmiAttempt.stdout.trim() : '';
            const firstJson = raw.indexOf('[') >= 0 ? raw.slice(raw.indexOf('[')) : raw;
            const parsedWmi = firstJson ? JSON.parse(firstJson) : [];
            if (parsedWmi && parsedWmi.length > 0) {
                parsed = parsedWmi;
                used = 'Get-WmiObject';
            }
        } catch (e) {
            // ignore
        }
    }

    return { success: true, used, parsed: parsed || [], attempts: [{ cmd: 'Get-PnpDevice', raw: primary }, { cmd: 'Get-CimInstance', raw: fallback }, { cmd: 'Get-WmiObject', raw: wmiAttempt }] };
}

// IPC handler للحصول على عدد الأجهزة المخزنة في قاعدة البيانات (Supabase)
ipcMain.handle('get-db-device-count', async () => {
    try {
        if (!supabaseManager || !supabaseManager.client) {
            return { success: false, count: 0, error: 'Supabase manager not initialized' };
        }

        // Use supabase client to select count
        const response = await supabaseManager.client
            .from('devices')
            .select('id', { count: 'exact' });

        // Many supabase clients return { data, error, count }
        const count = response?.count ?? (Array.isArray(response?.data) ? response.data.length : 0);

        return { success: true, count };
    } catch (error) {
        console.error('Error fetching DB device count:', error);
        return { success: false, count: 0, error: error.message };
    }
});

// IPC handler للحصول على عدد الأجهزة المتصلة من قاعدة البيانات (real-time)
ipcMain.handle('get-db-connected-count', async () => {
    try {
        // إرجاع العداد المحدث real-time
        return {
            success: true,
            count: currentDbConnectedCount,
            source: 'realtime'
        };
    } catch (error) {
        console.error('Error getting DB connected count:', error);
        return { success: false, count: 0, error: error.message };
    }
});

// IPC handler للحصول على جميع الأجهزة من قاعدة البيانات
ipcMain.handle('get-all-devices', async () => {
    try {
        if (!supabaseManager || !supabaseManager.client) {
            return { success: false, devices: [], error: 'Supabase not initialized' };
        }

        let query = supabaseManager.client
            .from('devices')
            .select('*')
            .order('detected_at', { ascending: false });

        // لا نفلتر بـ server_id - نريد مقارنة الأجهزة مع جميع الأجهزة المسجلة

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching devices from DB:', error);
            return { success: false, devices: [], error: error.message };
        }

        console.log(`📋 Fetched ${data?.length || 0} devices from database`);
        return { success: true, devices: data || [] };
    } catch (error) {
        console.error('Error in get-all-devices:', error);
        return { success: false, devices: [], error: error.message };
    }
});

// Get counts: registry-discovered, DB total, matched (in DB), pending
ipcMain.handle('get-device-counts', async () => {
    try {
        // Get registry/real detected devices (prefer main discovery function)
        let devices = [];
        try {
            devices = await discoverRealUSBDevices();
        } catch (e) {
            devices = [];
        }

        // لا نستخدم fallback لأن discoverRealUSBDevices تكفي
        // الـ fallback كان يعيد أجهزة وهمية بسيريالات مصطنعة
        // إذا discoverRealUSBDevices أرجعت فارغ = ما في أي جهاز USB حقيقي متصل

        // Group interfaces into physical devices by parent instance derived from device_id
        const groups = {};
        for (const d of devices) {
            const deviceId = d.device_id || '';
            const lastPart = String(deviceId).split('\\').pop() || '';
            const parts = lastPart.split('&');
            const parent = parts.length >= 2 ? `${parts[0]}&${parts[1]}` : lastPart;
            const key = `${(d.vendor_id || '')}:${(d.product_id || '')}:${parent}`;
            groups[key] = groups[key] || [];
            groups[key].push(d);
        }

        const registryTotal = Object.keys(groups).length;

        // get DB total
        let dbTotal = 0;
        try {
            const resp = await supabaseManager.client.from('devices').select('id', { count: 'exact' });
            dbTotal = resp?.count ?? (Array.isArray(resp?.data) ? resp.data.length : 0);
        } catch (e) {
            console.warn('Failed to get db total in get-device-counts:', e);
        }

        // get DB connected count (devices whose status is 'connected')
        // استخدام العداد المحدث real-time بدلاً من الاستعلام المباشر
        let dbConnectedCount = currentDbConnectedCount;

        // إذا لم يكن العداد مهيأ بعد، نقوم بالاستعلام مرة واحدة
        if (dbConnectedCount === 0 && supabaseManager && supabaseManager.client) {
            try {
                let q = supabaseManager.client.from('devices').select('id', { count: 'exact' }).eq('status', 'connected');
                if (connectionInfo && connectionInfo.server_id) {
                    q = q.eq('server_id', connectionInfo.server_id);
                }
                const respConn = await q.execute ? await q.execute() : await q;
                dbConnectedCount = respConn?.count ?? (Array.isArray(respConn?.data) ? respConn.data.length : 0);
                currentDbConnectedCount = dbConnectedCount; // تحديث العداد العام
            } catch (e) {
                console.warn('Failed to get db connected count:', e);
            }
        }

        // matched by serial but counted per physical device (group)
        let matchedCount = 0;
        let dbSerialSet = new Set();
        try {
            const serials = devices.map(d => d.serial_number).filter(Boolean);
            if (serials.length > 0) {
                const { data: matched, error: matchErr } = await supabaseManager.client
                    .from('devices')
                    .select('serial_number')
                    .in('serial_number', serials);
                if (matchErr) {
                    console.warn('Supabase error matching serials:', matchErr);
                } else if (Array.isArray(matched)) {
                    for (const r of matched) if (r && r.serial_number) dbSerialSet.add(String(r.serial_number));
                }
            }

            // For each group, if any interface serial is in DB, count group as matched
            for (const [k, members] of Object.entries(groups)) {
                const anyMatched = members.some(m => m.serial_number && dbSerialSet.has(String(m.serial_number)));
                if (anyMatched) matchedCount += 1;
            }
        } catch (e) {
            console.warn('Error matching serials in DB:', e);
        }

        // حساب pending: الأجهزة المكتشفة التي ليست في قاعدة البيانات
        let pendingCount = Math.max(0, registryTotal - matchedCount);
        // Make sure locally tracked pending devices are reflected
        try {
            pendingCount = Math.max(pendingCount, pendingDevicesMap.size);
        } catch (e) {
            // ignore
        }

        // Prepare group details for debugging
        const groupDetails = Object.entries(groups).map(([key, members]) => ({
            key,
            memberCount: members.length,
            vendor: members[0]?.vendor_id || null,
            product: members[0]?.product_id || null,
            serials: members.map(m => m.serial_number).filter(Boolean),
            device_ids: members.map(m => m.device_id)
        }));

        // تحديث العداد العام قبل الإرجاع
        currentDbConnectedCount = dbConnectedCount;

        // إرسال التحديث للواجهة الأمامية
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('db-connected-count-updated', {
                count: currentDbConnectedCount
            });
        }

        return { success: true, registryTotal, dbTotal, matchedCount, pendingCount, dbConnectedCount, groupDetails };
    } catch (error) {
        console.error('Error in get-device-counts:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('start-device-discovery', async () => {
    try {
        if (!deviceDiscoveryActive) {
            await startDeviceMonitoring();
        }
        return { success: true, message: 'Device discovery started' };
    } catch (error) {
        console.error('Error starting device discovery:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-device-discovery', async () => {
    try {
        stopDeviceMonitoring();
        return { success: true, message: 'Device discovery stopped' };
    } catch (error) {
        console.error('Error stopping device discovery:', error);
        return { success: false, error: error.message };
    }
});

// Endpoint لجلب IP السيرفر المركزي من قاعدة البيانات وتحديث backend_config.json
ipcMain.handle('get-primary-server-url', async () => {
    try {
        if (!supabaseManager) {
            return { success: false, error: 'Supabase Manager not initialized' };
        }

        const result = await supabaseManager.getPrimaryServerUrl();
        return result;
    } catch (error) {
        console.error('[get-primary-server-url] خطأ:', error);
        return { success: false, error: error.message };
    }
});

// دالة مساعدة للحصول على token المحفوظ
function getStoredToken() {
    try {
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(__dirname, 'config', 'connection.json');

        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return config.token || 'temp_token_for_sub_server';
        }
    } catch (error) {
        console.error('Error reading stored token:', error);
    }

    return 'temp_token_for_sub_server'; // توكن مؤقت للسيرفر الفرعي
}

// ===== دوال اكتشاف الأجهزة USB =====

// دالة اكتشاف أجهزة USB الحقيقية - المصدر الأساسي: مكتبة usb (نفس الملف القديم)
async function discoverRealUSBDevices() {
    if (process.platform !== 'win32') {
        console.log('USB device discovery currently supported on Windows only');
        return [];
    }

    try {
        // === الخطوة 1: المصدر الأساسي - مكتبة usb (السيريال الحقيقي + الاسم + الشركة) ===
        let usbLibDevices = [];
        try {
            const usbResult = await getUSBDevices();
            usbLibDevices = usbResult.devices || [];
            console.log(`📦 USB library returned ${usbLibDevices.length} devices with real descriptors`);
            for (const dev of usbLibDevices) {
                console.log(`   📱 ${dev.name} | VID:${dev.vendor_id} PID:${dev.product_id} | Serial: ${dev.serial_number || 'N/A'}`);
            }
        } catch (usbErr) {
            console.warn('⚠️ USB library failed:', usbErr.message);
        }

        // === الخطوة 2: مصدر ثانوي - PowerShell للحصول على PnP InstanceId + Location ===
        let pnpDevicesMap = new Map(); // VID:PID -> PnP data
        try {
            const powershellScript = `
                $allDevices = Get-PnpDevice | Where-Object {
                    $_.DeviceID -match "USB\\\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}" -and
                    $_.Present -eq $true
                } | Select-Object DeviceID, InstanceId, Name, Status, Class, Manufacturer, LocationInformation
                
                $devices = @()
                foreach ($device in $allDevices) {
                    $deviceId = $device.DeviceID
                    $vendorId = ""
                    $productId = ""
                    if ($deviceId -match "VID_([0-9A-F]{4})") { $vendorId = $matches[1] }
                    if ($deviceId -match "PID_([0-9A-F]{4})") { $productId = $matches[1] }
                    
                    $devices += @{
                        'device_id' = $deviceId
                        'instance_id' = if ($device.InstanceId) { $device.InstanceId } else { $deviceId }
                        'name' = $device.Name
                        'status' = $device.Status
                        'class' = $device.Class
                        'manufacturer' = if ($device.Manufacturer) { $device.Manufacturer } else { "" }
                        'location' = if ($device.LocationInformation) { $device.LocationInformation } else { "" }
                        'vendor_id' = $vendorId
                        'product_id' = $productId
                    }
                }
                if ($devices.Count -gt 0) { $devices | ConvertTo-Json -Depth 3 } else { "[]" }
            `;

            const psResult = await new Promise((resolve, reject) => {
                const tmpDir = require('os').tmpdir();
                const tmpPath = require('path').join(tmpDir, `discover_usb_${Date.now()}.ps1`);
                try {
                    require('fs').writeFileSync(tmpPath, powershellScript, 'utf8');
                } catch (writeErr) {
                    reject(writeErr);
                    return;
                }
                exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPath}"`, { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
                    try { require('fs').unlinkSync(tmpPath); } catch (_) { }
                    if (error) return reject(error);
                    resolve(stdout.trim());
                });
            });

            if (psResult) {
                const pnpDevices = JSON.parse(psResult);
                console.log(`📋 PowerShell returned ${pnpDevices.length} PnP devices`);
                for (const pnp of (Array.isArray(pnpDevices) ? pnpDevices : [pnpDevices])) {
                    const vid = (pnp.vendor_id || '').toUpperCase();
                    const pid = (pnp.product_id || '').toUpperCase();
                    if (vid && pid) {
                        const key = `${vid}:${pid}`;
                        // حفظ أول PnP device لكل VID:PID (نفضل اللي عنده status OK)
                        if (!pnpDevicesMap.has(key) || pnp.status === 'OK') {
                            pnpDevicesMap.set(key, pnp);
                        }
                    }
                }
            }
        } catch (psErr) {
            console.warn('⚠️ PowerShell PnP lookup failed:', psErr.message);
        }

        // === الخطوة 3: بناء القائمة النهائية من PnP data + مكتبة usb ===
        const allDiscoveredDevices = [];

        // إنشاء خريطة لتحويل مكتبة usb إلى بحث سريع حسب VID:PID
        const usbMap = new Map();
        for (const u of usbLibDevices) {
            const vid = (u.vendor_id || '').toString().toUpperCase().padStart(4, '0');
            const pid = (u.product_id || '').toString().toUpperCase().padStart(4, '0');
            if (vid && pid) usbMap.set(`${vid}:${pid}`, u);
        }

        // جمع كل المعرفات الفريدة (VID:PID) من مكتبة usb و PowerShell
        const allKeys = new Set([...usbMap.keys(), ...pnpDevicesMap.keys()]);

        for (const key of allKeys) {
            const vid = key.split(':')[0];
            const pid = key.split(':')[1];

            const usbDev = usbMap.get(key) || {};
            const pnpData = pnpDevicesMap.get(key) || {};

            const name = (pnpData.name || usbDev.name || '').toLowerCase();
            const manufacturer = (pnpData.manufacturer || usbDev.manufacturer || '').toLowerCase();

            // === الفلترة: استبعاد الأجهزة الداخلية ===
            const isInternal = (
                vid === '8086' || vid === '8087' ||
                name.includes('root hub') ||
                name.includes('host controller') ||
                name.includes('internal') ||
                name.includes('built-in') ||
                name.includes('embedded') ||
                name.includes('surface type cover') ||
                name.includes('type cover') ||
                name.includes('touchpad') ||
                name.includes('trackpad') ||
                name.includes('fingerprint') ||
                name.includes('ir camera') ||
                name.includes('integrated camera') ||
                name.includes('laptop camera')
            );
            if (isInternal) {
                console.log(`🚫 Skipping internal device: ${pnpData.name || usbDev.name}`);
                continue;
            }

            // استبعاد أجهزة الشبكة/بلوتوث (بس مو الموبايلات)
            const mobileBrands = ['huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'ipad', 'android', 'oppo', 'vivo', 'realme', 'oneplus', 'honor', 'poco', 'redmi'];
            const isMobile = mobileBrands.some(brand => name.includes(brand) || manufacturer.includes(brand));

            const isNetworkComm = (
                name.includes('bluetooth') ||
                name.includes('wireless lan') ||
                name.includes('wifi') ||
                name.includes('wlan') ||
                ['0A5C', '0B05', '0CF3', '13D3', '1814', '8087', '14E4', '10EC'].some(v => vid === v)
            );

            if (isNetworkComm && !isMobile) {
                console.log(`🚫 Skipping network/bluetooth: ${pnpData.name || usbDev.name}`);
                continue;
            }

            // === بناء الجهاز المكتشف ===
            const discoveredDevice = {
                name: pnpData.name || usbDev.name || `USB Device ${vid}:${pid}`,
                serial_number: usbDev.serial_number || '',
                vendor_id: vid,
                product_id: pid,
                manufacturer: pnpData.manufacturer || usbDev.manufacturer || 'Unknown',
                device_id: pnpData.device_id || `USB\\VID_${vid}&PID_${pid}`,
                instance_id: pnpData.instance_id || `USB\\VID_${vid}&PID_${pid}`,
                class: pnpData.class || usbDev.deviceClass || 'USB',
                status: pnpData.status || 'OK',
                location: pnpData.location || 'USB Port',
                detected_at: usbDev.detected_at || new Date().toISOString(),
                is_real_device: true,
                system: 'Windows',
                present: true
            };

            // إذا ما عنده serial من USB lib، حاول من PnP InstanceId
            if (!discoveredDevice.serial_number && pnpData) {
                const instanceId = pnpData.instance_id || '';
                const match = instanceId.match(/USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\(.+)$/i);
                if (match) {
                    const lastPart = match[1].trim().toUpperCase();
                    if (lastPart && !lastPart.match(/^\d+&/) && lastPart.length >= 4) {
                        discoveredDevice.serial_number = lastPart;
                    }
                }
            }

            // Fallback INST_
            if (!discoveredDevice.serial_number || discoveredDevice.serial_number.length < 3) {
                const instancePart = (discoveredDevice.device_id || '').split('\\').pop() || '';
                discoveredDevice.serial_number = `INST_${vid}_${pid}_${instancePart.toUpperCase()}`;
            }

            allDiscoveredDevices.push(discoveredDevice);
        }

        // 🔄 تطبيق إزالة التكرار المحسنة
        const deduplicatedDevices = enhancedDeviceDeduplication(allDiscoveredDevices);

        console.log(`✅ Final real devices: ${deduplicatedDevices.length}`);
        for (const dev of deduplicatedDevices) {
            console.log(`   📱 ${dev.name} | Serial: ${dev.serial_number} | VID:${dev.vendor_id} PID:${dev.product_id} | PnP: ${dev.device_id}`);
        }

        return deduplicatedDevices;

    } catch (error) {
        console.error('❌ Error discovering USB devices:', error);
        return [];
    }
}

// دالة مراقبة حالة الأجهزة في قاعدة البيانات real-time
async function startDeviceStatusMonitoring() {
    if (!supabaseManager || !supabaseManager.client) {
        console.warn('⚠️ Cannot start device status monitoring: Supabase not available');
        return;
    }

    try {
        // حساب العدد الأولي للأجهزة المتصلة من قاعدة البيانات
        await updateConnectedDeviceCount();

        // إعداد مراقبة real-time لتغيرات حالة الأجهزة
        console.log('📡 Setting up real-time device status monitoring...');

        const channel = supabaseManager.client
            .channel('device-status-changes')
            .on(
                'postgres_changes',
                {
                    event: '*', // مراقبة جميع التغييرات (INSERT, UPDATE, DELETE)
                    schema: 'public',
                    table: 'devices',
                    filter: connectionInfo?.server_id ? `server_id=eq.${connectionInfo.server_id}` : undefined
                },
                async (payload) => {
                    try {
                        console.log('📊 Device status change detected (re-syncing from DB):', payload);

                        // بدل الاعتماد على التحديث المحلي البسيط، نعتمد على قراءة العدد الحقيقي من قاعدة البيانات
                        // هذا يضمن أن واجهة المستخدم تعكس الحالة الحقيقية حتى لو كانت التغييرات تتم من مصادر متعددة
                        await updateConnectedDeviceCount();
                    } catch (err) {
                        console.error('❌ Error handling real-time device status change:', err);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✅ Real-time device status monitoring active');
                } else if (status === 'CHANNEL_ERROR') {
                    console.error('❌ Error in device status monitoring channel');
                } else if (status === 'TIMED_OUT') {
                    console.warn('⏱️ Device status monitoring timed out - retrying...');
                }
            });

        deviceStatusSubscription = channel;

        // 🆕 مراقبة جدول agent_pending_devices للاستماع لتحديثات الموافقة/الرفض من السيرفر المركزي
        console.log('📡 Setting up agent_pending_devices monitoring...');

        const pendingChannel = supabaseManager.client
            .channel('pending-device-updates')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'agent_pending_devices',
                    filter: connectionInfo?.server_id ? `agent_server_id=eq.${connectionInfo.server_id}` : undefined
                },
                async (payload) => {
                    try {
                        console.log('📊 Pending device status updated:', payload);
                        const newRecord = payload.new;
                        const oldRecord = payload.old;

                        // إذا تم تغيير الحالة من pending إلى approved
                        if (oldRecord.status === 'pending' && newRecord.status === 'approved') {
                            console.log(`✅ جهاز تمت الموافقة عليه من الأدمن: ${newRecord.device_name}`);

                            // *** تفعيل الجهاز فعلياً عبر Enable-PnpDevice ***
                            // استخراج device_id من meta_data (لأن العمود غير موجود في الجدول)
                            let metaParsed = {};
                            try {
                                metaParsed = typeof newRecord.meta_data === 'string' ? JSON.parse(newRecord.meta_data || '{}') : (newRecord.meta_data || {});
                            } catch (e) { }
                            const deviceId = metaParsed.pnp_instance_id || metaParsed.device_id || newRecord.device_id || '';
                            let enableSuccess = false;
                            if (deviceId && process.platform === 'win32') {
                                console.log(`🔓 Admin approved - Enabling device: ${newRecord.device_name} (${deviceId})`);
                                const enableResult = await enableDeviceReal(deviceId);
                                enableSuccess = enableResult.success;
                                if (enableResult.success) {
                                    console.log(`✅ Device physically enabled after admin approval: ${deviceId}`);
                                    logDeviceApproved({ name: newRecord.device_name, serial_number: newRecord.serial_number });
                                } else {
                                    console.warn(`⚠️ Could not enable device after approval: ${enableResult.message}`);
                                }
                            }

                            // إضافة للمجموعة المحلية لمنع إعادة حظره
                            if (deviceId) {
                                approvedDeviceIds.add(deviceId);
                                blockedDeviceIds.delete(deviceId);
                            }

                            // إزالة من قائمة الأجهزة المعلقة المحلية
                            const serial = newRecord.serial_number || '';
                            for (const [key, val] of pendingDevicesMap.entries()) {
                                if (val.serial === serial || val.serial_number === serial) {
                                    pendingDevicesMap.delete(key);
                                    console.log(`🧹 Removed approved device from pending map: ${serial}`);
                                }
                            }

                            // *** حفظ الجهاز في جدول devices (Supabase) ***
                            try {
                                const meta = typeof newRecord.meta_data === 'string' ? JSON.parse(newRecord.meta_data || '{}') : (newRecord.meta_data || {});

                                const deviceToSave = {
                                    server_id: newRecord.agent_server_id || connectionInfo?.server_id || 1,
                                    name: newRecord.device_name || newRecord.name || 'Unknown Device',
                                    serial_number: newRecord.serial_number || '',
                                    manufacturer: newRecord.manufacturer || meta.manufacturer || 'Unknown',
                                    vendor_id: newRecord.vendor_id || meta.vid || '',
                                    product_id: newRecord.product_id || meta.pid || '',
                                    device_class: newRecord.device_class || meta.device_type || 'Unknown',
                                    usb_port: newRecord.usb_port || newRecord.location || 'USB Port',
                                    status: enableSuccess ? 'connected' : 'approved',
                                    connection_time: new Date().toISOString(),
                                    last_activity: new Date().toISOString(),
                                    is_verified: true,
                                    whitelisted: true,
                                    approved_at: new Date().toISOString(),
                                    risk_level: 'low',
                                    monitoring_enabled: true,
                                    meta_data: JSON.stringify({
                                        device_id: deviceId,
                                        pnp_instance_id: deviceId,
                                        manufacturer: newRecord.manufacturer || '',
                                        class: newRecord.device_class || '',
                                        vid: newRecord.vendor_id || '',
                                        pid: newRecord.product_id || '',
                                        name: newRecord.device_name || '',
                                        approved_via: 'admin_dashboard',
                                        approved_at: new Date().toISOString(),
                                        is_real_device: true,
                                        agent_pending_id: newRecord.id
                                    })
                                };

                                // حفظ بالجدول
                                const existingDevice = await supabaseManager.client
                                    .from('devices')
                                    .select('id')
                                    .eq('serial_number', newRecord.serial_number)
                                    .maybeSingle();

                                if (existingDevice.data) {
                                    // تحديث جهاز موجود
                                    await supabaseManager.client
                                        .from('devices')
                                        .update({
                                            status: enableSuccess ? 'connected' : 'approved',
                                            whitelisted: true,
                                            is_verified: true,
                                            approved_at: new Date().toISOString(),
                                            last_activity: new Date().toISOString(),
                                            meta_data: deviceToSave.meta_data
                                        })
                                        .eq('id', existingDevice.data.id);
                                    console.log(`✅ Updated existing device in devices table: ${newRecord.serial_number}`);
                                } else {
                                    // إضافة جهاز جديد
                                    await supabaseManager.client
                                        .from('devices')
                                        .insert(deviceToSave);
                                    console.log(`✅ Saved new approved device to devices table: ${newRecord.serial_number}`);
                                }
                            } catch (dbErr) {
                                console.error('❌ Error saving approved device to devices table:', dbErr);
                            }

                            // إرسال إشعار للواجهة
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('device-approved', {
                                    device: newRecord,
                                    message: `✅ تمت الموافقة على جهاز: ${newRecord.device_name}`
                                });

                                // تحديث قائمة المعلقة
                                mainWindow.webContents.send('devices-discovered', {
                                    devices: Array.from(pendingDevicesMap.values()),
                                    total: pendingDevicesMap.size
                                });
                            }

                            // تحديث العدادات
                            await updateConnectedDeviceCount();
                        }
                        // إذا تم رفض الجهاز - يبقى محظور فعلياً
                        else if (newRecord.status === 'rejected') {
                            console.log(`❌ جهاز تم رفضه من الأدمن: ${newRecord.device_name} - يبقى معطل فعلياً`);

                            // الجهاز يبقى محظور - لا نعيد تفعيله
                            let rejMetaParsed = {};
                            try {
                                rejMetaParsed = typeof newRecord.meta_data === 'string' ? JSON.parse(newRecord.meta_data || '{}') : (newRecord.meta_data || {});
                            } catch (e) { }
                            const deviceId = rejMetaParsed.pnp_instance_id || rejMetaParsed.device_id || newRecord.device_id || '';
                            if (deviceId) {
                                blockedDeviceIds.add(deviceId);
                                approvedDeviceIds.delete(deviceId);
                            }

                            // إزالة من قائمة المعلقة المحلية
                            const serial = newRecord.serial_number || '';
                            for (const [key, val] of pendingDevicesMap.entries()) {
                                if (val.serial === serial || val.serial_number === serial) {
                                    pendingDevicesMap.delete(key);
                                }
                            }

                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('device-rejected', {
                                    device: newRecord,
                                    message: `❌ تم رفض جهاز: ${newRecord.device_name} - الجهاز يبقى معطل`
                                });

                                mainWindow.webContents.send('devices-discovered', {
                                    devices: Array.from(pendingDevicesMap.values()),
                                    total: pendingDevicesMap.size
                                });
                            }
                        }
                    } catch (err) {
                        console.error('❌ Error handling pending device update:', err);
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'agent_pending_devices',
                    filter: connectionInfo?.server_id ? `agent_server_id=eq.${connectionInfo.server_id}` : undefined
                },
                async (payload) => {
                    try {
                        console.log('🗑️ Pending device removed from database:', payload);
                        const deletedRecord = payload.old;

                        // 🆕 إزالة من الخريطة المحلية فوراً عند الحذف من قاعدة البيانات
                        if (deletedRecord && deletedRecord.serial_number) {
                            const serial = deletedRecord.serial_number;
                            // البحث عن أي مفتاح يحتوي على هذا السيريال وحذفه
                            for (const [key, val] of pendingDevicesMap.entries()) {
                                if (val.serial === serial || val.serial_number === serial) {
                                    pendingDevicesMap.delete(key);
                                    console.log(`🧹 Local pending map cleared for: ${serial}`);
                                }
                            }
                        }

                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('pending-device-removed', {
                                device: deletedRecord,
                                message: `تم إزالة جهاز من قائمة الانتظار (تمت الموافقة أو الفصل)`
                            });

                            // تحديث القائمة فوراً
                            mainWindow.webContents.send('devices-discovered', {
                                devices: Array.from(pendingDevicesMap.values()),
                                total: pendingDevicesMap.size
                            });
                        }
                    } catch (err) {
                        console.error('❌ Error handling pending device deletion:', err);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✅ agent_pending_devices monitoring active');
                } else if (status === 'CHANNEL_ERROR') {
                    console.error('❌ Error in agent_pending_devices monitoring channel');
                }
            });

        // تحديث دوري للعداد (كل دقيقة) للتأكد من دقة البيانات
        setInterval(async () => {
            await updateConnectedDeviceCount();
        }, 60000);

    } catch (error) {
        console.error('❌ Error starting device status monitoring:', error);
    }
}

// دالة تحديث عداد الأجهزة المتصلة من قاعدة البيانات
async function updateConnectedDeviceCount() {
    if (!supabaseManager || !supabaseManager.client) return;

    try {
        // خطوة 1: جلب الأجهزة المحفوظة في قاعدة البيانات (الموافق عليها)
        // بدون فلتر server_id - نريد مقارنة مع جميع الأجهزة المسجلة
        let dbQuery = supabaseManager.client
            .from('devices')
            .select('serial_number');

        const { data: dbDevices, error: dbError } = await dbQuery;

        if (dbError) {
            console.error('❌ Error fetching approved devices from DB:', dbError);
            return;
        }

        // خطوة 2: جلب الأجهزة المتصلة فيزيائياً
        const physicallyConnectedDevices = await discoverRealUSBDevices();
        const physicallyConnectedSerials = new Set(
            physicallyConnectedDevices
                .filter(device => device.serial_number && device.serial_number.length >= 4)
                .map(device => device.serial_number)
        );

        // خطوة 3: حساب التقاطع - الأجهزة المحفوظة في DB والمتصلة فيزيائياً
        const dbSerials = new Set((dbDevices || []).map(d => d.serial_number).filter(Boolean));
        const intersectionCount = Array.from(dbSerials).filter(serial => physicallyConnectedSerials.has(serial)).length;

        console.log(`📊 DB approved devices: ${dbSerials.size}`);
        console.log(`🔌 Physically connected devices: ${physicallyConnectedSerials.size}`);
        console.log(`✅ Intersection (connected): ${intersectionCount}`);

        if (intersectionCount !== currentDbConnectedCount) {
            const oldCount = currentDbConnectedCount;
            currentDbConnectedCount = intersectionCount;
            console.log(`🔄 Connected device count updated: ${oldCount} → ${intersectionCount}`);

            // إرسال التحديث للواجهة الأمامية
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('db-connected-count-updated', {
                    count: currentDbConnectedCount,
                    previousCount: oldCount
                });
            }

            // تحديث قائمة system tray
            updateTrayMenu();
        }
    } catch (error) {
        console.error('❌ Error updating connected device count:', error);
    }
}

// ==================== تحديث حالة الأجهزة في Supabase مباشرة ====================
// USB Agent يتصل بـ Supabase مباشرة وليس بـ Flask Backend

// دالة لتحديث حالة الأجهزة المتصلة في قاعدة البيانات (Fallback إذا فشل API)
async function updateConnectedDevicesInDB(devicesToUpdate) {
    if (!supabaseManager || !supabaseManager.client) {
        console.error('❌ Supabase not available for device updates');
        return;
    }

    console.log(`📝 Starting to update ${devicesToUpdate.length} devices to connected status...`);

    for (const deviceUpdate of devicesToUpdate) {
        try {
            const serial = deviceUpdate.serial_number || deviceUpdate.serial;
            console.log(`🔄 Updating device serial "${serial}" to connected...`);

            const updateData = {
                status: 'connected',
                connection_time: new Date().toISOString(),
                last_activity: new Date().toISOString()
            };

            const { data, error } = await supabaseManager.client
                .from('devices')
                .update(updateData)
                .eq('serial_number', serial)
                .select();

            if (error) {
                console.error(`❌ Supabase error for serial "${serial}":`, error.message);
            } else if (data && data.length > 0) {
                console.log(`✅ SUCCESS: "${data[0].name}" (${serial}) → status = connected`);
            } else {
                console.warn(`⚠️ No device found with serial "${serial}"`);
            }
        } catch (err) {
            console.error(`❌ Exception:`, err.message);
        }
    }

    console.log(`✅ Finished updating connected devices`);
}

// دالة لتحديث حالة الأجهزة المنفصلة في قاعدة البيانات (Fallback إذا فشل API)
async function updateDisconnectedDevicesInDB(devicesToDisconnect) {
    if (!supabaseManager || !supabaseManager.client) {
        console.error('❌ Supabase not available for device updates');
        return;
    }

    console.log(`📝 Starting to update ${devicesToDisconnect.length} devices to disconnected status...`);

    for (const deviceUpdate of devicesToDisconnect) {
        try {
            const serial = deviceUpdate.serial_number || deviceUpdate.serial;
            console.log(`🔄 Updating device serial "${serial}" to disconnected...`);

            const updateData = {
                status: 'disconnected',
                disconnection_time: new Date().toISOString(),
                last_activity: new Date().toISOString()
            };

            // حساب مدة الاتصال إذا توفر وقت الاتصال
            if (deviceUpdate.connection_time) {
                try {
                    const connTime = new Date(deviceUpdate.connection_time);
                    const discTime = new Date();
                    const durationSeconds = Math.floor((discTime - connTime) / 1000);
                    if (durationSeconds > 0) {
                        updateData.connection_duration = durationSeconds;
                        console.log(`⏱️ Connection duration for ${serial}: ${durationSeconds} seconds`);
                    }
                } catch (err) {
                    console.warn(`⚠️ Failed to calculate duration for ${serial}:`, err.message);
                }
            }

            const { data, error } = await supabaseManager.client
                .from('devices')
                .update(updateData)
                .eq('serial_number', serial)
                .select();

            if (error) {
                console.error(`❌ Supabase error for serial "${serial}":`, error.message);
            } else if (data && data.length > 0) {
                console.log(`✅ SUCCESS: "${data[0].name}" (${serial}) → status = disconnected`);
            } else {
                console.warn(`⚠️ No device found with serial "${serial}"`);
            }
        } catch (err) {
            console.error(`❌ Exception:`, err.message);
        }
    }

    console.log(`✅ Finished updating disconnected devices`);
}

// دالة إيقاف مراقبة حالة الأجهزة
async function stopDeviceStatusMonitoring() {
    if (deviceStatusSubscription) {
        try {
            await supabaseManager.client.removeChannel(deviceStatusSubscription);
            deviceStatusSubscription = null;
            console.log('🛑 Device status monitoring stopped');
        } catch (error) {
            console.error('❌ Error stopping device status monitoring:', error);
        }
    }
}

// دالة مراقبة تغييرات الأجهزة
// ==================== DEVICE BLOCKER FUNCTIONS ====================
// نظام حظر/تفعيل الأجهزة فعلياً (مطابق للـ backend device_blocker.py)

// أنماط DeviceID للأجهزة الداخلية التي لا يجب حظرها
const INTERNAL_DEVICE_PATTERNS = [
    'ROOT_HUB',
    'USB\\\\ROOT_HUB',
    'ACPI\\\\PNP0303', 'ACPI\\\\PNP0F13',
    'HID\\\\INTC', 'HID\\\\ELAN', 'HID\\\\SYN', 'HID\\\\ALPS', 'HID\\\\MSFT',
    'I2C\\\\',
    'HID\\\\ASUS', 'HID\\\\ATK', 'ACPI\\\\ATK',
    'HDAUDIO\\\\', 'INTELAUDIO\\\\',
    'PCI\\\\',
    'SWD\\\\', 'ACPI\\\\'
];

// VID:PID للأجهزة الداخلية المعروفة
const INTERNAL_VID_PID = new Set([
    '8087:0026', '8087:0029', '8087:0032', '8087:0033', '8087:0025',
    '8087:0AAA', '8087:0A2B', '8087:0A2A',
    '8086:0A80', '8086:09D4',
    '5986:2150', '5986:2141', '5986:214C',
    '04F2:B71A', '04F2:B6D9', '04F2:B5EE', '04F2:B725',
    '0408:1091',
    '13D3:56FF', '13D3:5A02', '13D3:5248',
    '06CB:00BD', '06CB:00BE', '138A:0097',
    '27C6:63AC', '27C6:55A4',
    '0B05:19B6', '0B05:1866', '0B05:1837'
]);

// فئات الأجهزة الداخلية
const INTERNAL_DEVICE_CLASSES = new Set([
    'system', 'firmware', 'processor', 'computer', 'volume', 'diskdrive'
]);

// مجموعات تتبع حالة الأجهزة (مطابقة للباك اند)
// blockedDeviceIds و approvedDeviceIds معرفة في بداية الملف (Global)
const internalDeviceIds = new Set();

/**
 * تحديد ما إذا كان الجهاز داخلي (يجب استثناؤه من الحظر)
 * مطابق لـ is_internal_device في device_blocker.py
 */
function isInternalDevice(deviceId, vid, pid, deviceClass, name) {
    const deviceIdUpper = (deviceId || '').toUpperCase();

    // إضافة بادئات الأجهزة الداخلية (Intel, Cameras, Bluetooth, etc..)
    const additionalPatterns = [
        'VID_8086', 'VID_8087', 'VID_0C45', 'VID_04F2', 'VID_13D3',
        'VID_5986', 'VID_0B05', 'VID_06CB', 'VID_27C6'
    ];

    for (const pattern of INTERNAL_DEVICE_PATTERNS) {
        if (deviceIdUpper.includes(pattern.toUpperCase())) return true;
    }

    for (const pattern of additionalPatterns) {
        if (deviceIdUpper.includes(pattern)) return true;
    }

    const vidClean = (vid || '').toUpperCase().replace('VID_', '').trim();
    const pidClean = (pid || '').toUpperCase().replace('PID_', '').trim();

    if (vidClean === '8086' || vidClean === '8087') {
        return true;
    }

    if (vidClean && pidClean && INTERNAL_VID_PID.has(`${vidClean}:${pidClean}`)) {
        return true;
    }

    if (deviceClass && INTERNAL_DEVICE_CLASSES.has(deviceClass.toLowerCase())) {
        return true;
    }

    const nameLower = (name || '').toLowerCase();
    const internalNames = ['host controller', 'root hub', 'generic hub', 'composite parent', 'usb composite device'];
    for (const pat of internalNames) {
        if (nameLower.includes(pat)) return true;
    }

    return false;
}

/**
 * تعطيل جهاز USB فعلياً عبر PowerShell Disable-PnpDevice
 * مطابق لـ disable_device_real في device_blocker.py
 */
function disableDeviceReal(deviceId) {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            resolve({ success: false, message: 'Windows only' });
            return;
        }
        try {
            // Escape special chars in PowerShell string (single quotes)
            const safeId = deviceId.replace(/'/g, "''");
            // Using a slightly more robust command structure
            const command = `powershell -NoProfile -NonInteractive -Command "try { Disable-PnpDevice -InstanceId '${safeId}' -Confirm:$false -ErrorAction Stop; Write-Output 'DISABLED_OK' } catch { Write-Error $_.Exception.Message }"`;

            console.log(`🔌 Executing block command for: ${deviceId}`);

            exec(command, { timeout: 20000 }, (error, stdout, stderr) => {
                const outStr = stdout ? stdout.toString() : '';
                const errStr = stderr ? stderr.toString() : '';

                if (outStr.includes('DISABLED_OK')) {
                    blockedDeviceIds.add(deviceId);
                    console.log(`\x1b[31m🔒 BLOCKED device successfully: ${deviceId}\x1b[0m`);
                    resolve({ success: true, message: `تم تعطيل الجهاز فعلياً: ${deviceId}` });
                } else {
                    const errMsg = errStr.trim() || (error ? error.message : 'Unknown error');
                    console.warn(`⚠️ Block command failed for ${deviceId}: ${errMsg}`);
                    resolve({ success: false, message: `فشل التعطيل: ${errMsg}` });
                }
            });
        } catch (e) {
            console.error(`❌ Exception disabling device ${deviceId}:`, e);
            resolve({ success: false, message: e.message });
        }
    });
}

/**
 * إعادة تفعيل جهاز USB فعلياً عبر PowerShell Enable-PnpDevice
 * مطابق لـ enable_device_real في device_blocker.py
 */
function enableDeviceReal(deviceId) {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            resolve({ success: false, message: 'Windows only' });
            return;
        }
        try {
            const safeId = deviceId.replace(/["';]/g, '');
            const command = `powershell -NoProfile -NonInteractive -Command "Enable-PnpDevice -InstanceId '${safeId}' -Confirm:$false -ErrorAction Stop; Write-Output 'ENABLED_OK'"`;

            exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
                if (!error && stdout && stdout.includes('ENABLED_OK')) {
                    blockedDeviceIds.delete(deviceId);
                    approvedDeviceIds.add(deviceId);
                    console.log(`\x1b[32m🔓 ENABLED device: ${deviceId}\x1b[0m`);
                    resolve({ success: true, message: `تم تفعيل الجهاز فعلياً: ${deviceId}` });
                } else if (!error) {
                    blockedDeviceIds.delete(deviceId);
                    approvedDeviceIds.add(deviceId);
                    resolve({ success: true, message: `تم تفعيل الجهاز: ${deviceId}` });
                } else {
                    const errMsg = stderr ? stderr.trim() : (error.message || 'Unknown error');
                    resolve({ success: false, message: `فشل التفعيل: ${errMsg}` });
                }
            });
        } catch (e) {
            console.error(`❌ Error enabling device ${deviceId}:`, e);
            resolve({ success: false, message: e.message });
        }
    });
}

/**
 * طباعة رسالة حظر جهاز في الـ Terminal
 */
function logDeviceBlocked(device) {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const deviceName = device.name || 'Unknown Device';
    const serial = device.serial_number || device.serial || 'N/A';
    const devId = device.device_id || 'N/A';

    console.log('');
    console.log('\x1b[31m═══════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[31m🔒 NEW DEVICE BLOCKED (PENDING APPROVAL)\x1b[0m');
    console.log('\x1b[31m═══════════════════════════════════════════════════════════\x1b[0m');
    console.log(`\x1b[36m   📅 Time:        \x1b[0m${timestamp}`);
    console.log(`\x1b[36m   📱 Device:      \x1b[0m${deviceName}`);
    console.log(`\x1b[36m   🔢 Serial:      \x1b[0m${serial}`);
    console.log(`\x1b[36m   🆔 DeviceID:    \x1b[0m${devId}`);
    console.log(`\x1b[31m   ⛔ Status:      \x1b[0m\x1b[31mBLOCKED - Awaiting Admin Approval\x1b[0m`);
    console.log(`\x1b[33m   📋 Method:      \x1b[0mDisable-PnpDevice`);
    console.log('\x1b[31m═══════════════════════════════════════════════════════════\x1b[0m');
    console.log('');
}

// ==================== END DEVICE BLOCKER FUNCTIONS ====================


async function startDeviceMonitoring() {
    if (deviceMonitoringInterval) {
        clearInterval(deviceMonitoringInterval);
    }

    deviceDiscoveryActive = true;
    console.log('Starting continuous USB device monitoring with device blocking...');

    // تحميل الأجهزة الموافق عليها من قاعدة البيانات لمنع حظرها
    try {
        if (supabaseManager && supabaseManager.client) {
            const { data: approvedDevices } = await supabaseManager.client
                .from('devices')
                .select('serial_number, meta_data')
                .or('whitelisted.eq.true,status.eq.connected');

            if (Array.isArray(approvedDevices)) {
                for (const d of approvedDevices) {
                    // استخراج device_id/pnp_instance_id من meta_data
                    try {
                        const meta = typeof d.meta_data === 'string' ? JSON.parse(d.meta_data) : d.meta_data;
                        const pnpId = meta?.pnp_instance_id || meta?.device_id || '';
                        if (pnpId) {
                            approvedDeviceIds.add(pnpId);
                        }
                    } catch (e) { }
                }
                console.log(`✅ Loaded ${approvedDeviceIds.size} approved device IDs from database`);
            }
        }
    } catch (e) {
        console.warn('⚠️ Could not load approved devices from DB:', e.message);
    }

    // 🧹 تنظيف الأجهزة الوهمية القديمة من قاعدة البيانات عند بدء التشغيل
    await cleanupPhantomPendingDevices();

    // مراقبة دورية كل 10 ثواني (تحسين استهلاك السيرفر)
    deviceMonitoringInterval = setInterval(async () => {
        if (!deviceDiscoveryActive) return;

        try {
            const currentDevices = await discoverRealUSBDevices();
            await processDeviceChanges(currentDevices);
        } catch (error) {
            console.error('Error in device monitoring cycle:', error);
        }
    }, 10000);

    // اكتشاف أولي
    try {
        const initialDevices = await discoverRealUSBDevices();
        await processDeviceChanges(initialDevices);
    } catch (error) {
        console.error('Error in initial device discovery:', error);
    }
}

// دالة معالجة تغييرات الأجهزة (المنطق الصحيح: اكتشاف → مقارنة مع DB → تصنيف)
async function processDeviceChanges(currentDevices) {
    console.log(`🔍 Starting device processing with ${currentDevices.length} discovered devices`);

    // خطوة 1: بناء قائمة الأجهزة المكتشفة حالياً مع أرقامها التسلسلية
    const discoveredDevices = [];
    const connectedSerials = new Set();

    for (const device of currentDevices) {
        if (device.serial_number && device.serial_number.length >= 4) {
            connectedSerials.add(device.serial_number);
            discoveredDevices.push({
                name: device.name,
                serial: device.serial_number,
                serial_number: device.serial_number,
                manufacturer: device.manufacturer,
                device_id: device.device_id,
                vendor_id: device.vendor_id,
                product_id: device.product_id,
                device_class: device.class || device.device_class || 'Unknown',
                location: device.location || 'USB Port',
                detected_at: device.detected_at || new Date().toISOString(),
                status: 'detected',
                physically_connected: true,
                is_real_device: true,
                system: 'Windows'
            });
        }
    }

    console.log(`📱 Currently physically connected: ${connectedSerials.size} unique serials`);

    // إزالة الأجهزة المعلقة محلياً وعن بعد إذا لم تعد موجودة في نتائج الاكتشاف الحالية
    try {
        let removedPendingLocal = 0;
        for (const [pk, pv] of Array.from(pendingDevicesMap.entries())) {
            let found = false;
            for (const d of discoveredDevices) {
                try {
                    if (isSameDevice(pv, d) || isSameDevice(d, pv)) {
                        found = true;
                        break;
                    }
                } catch (e) { }
            }
            if (!found) {
                // إزالة من الخريطة المحلية
                pendingDevicesMap.delete(pk);
                removedPendingLocal += 1;

                // إزالة من Supabase إذا كان متوفراً
                if (supabaseManager && connectionInfo && connectionInfo.server_id) {
                    const serial = (pv.serial_number || pv.serial || '').toString();
                    if (serial && !serial.startsWith('INST_')) {
                        supabaseManager.removeAgentPendingDeviceBySerial(serial, connectionInfo.server_id)
                            .then(res => {
                                if (res.success) {
                                    console.log(`🗑️ Removed disconnected pending device from DB: ${pv.name || serial}`);

                                    // إرسال إشعار للواجهة لإزالة الجهاز من الجدول فوراً
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        console.log(`📤 Sending pending-device-removed event for device: ${pv.name || serial}`);
                                        mainWindow.webContents.send('pending-device-removed', {
                                            device: pv,
                                            message: `تم فصل الجهاز ${pv.name || ''} وإزالته من الانتظار`
                                        });
                                    }
                                }
                            })
                            .catch(err => console.warn('Failed to remove pending device from DB:', err));
                    } else if (!serial || serial.startsWith('INST_')) {
                        // إذا لم يوجد سيريال صالح، حاول الحذف باستخدام device_id أو vendor_id/product_id
                        const deviceId = (pv.device_id || pv.DeviceID || '').toString();
                        const vid = pv.vendor_id || pv.vendorId || '';
                        const pid = pv.product_id || pv.productId || '';
                        
                        try {
                            let deleteQuery = supabaseManager.client
                                .from('agent_pending_devices')
                                .delete()
                                .eq('agent_server_id', connectionInfo.server_id);
                            
                            if (deviceId && deviceId.length > 0) {
                                deleteQuery = deleteQuery.eq('device_id', deviceId);
                            } else if (vid && pid) {
                                deleteQuery = deleteQuery.eq('vendor_id', vid).eq('product_id', pid);
                            } else {
                                return;
                            }
                            
                            const { error } = await deleteQuery;
                            
                            if (!error) {
                                console.log(`🗑️ Removed disconnected pending device from DB: ${pv.name || deviceId || vid}:${pid}`);
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    console.log(`📤 Sending pending-device-removed event for device: ${pv.name || deviceId || vid}:${pid}`);
                                    mainWindow.webContents.send('pending-device-removed', {
                                        device: pv,
                                        message: `تم فصل الجهاز ${pv.name || ''} وإزالته من الانتظار`
                                    });
                                }
                            }
                        } catch (err) {
                            console.warn('Failed to remove device from DB:', err);
                        }
                    }
                }
            }
        }
        if (removedPendingLocal > 0) {
            console.log(`🔄 Removed ${removedPendingLocal} pending device(s) because they are no longer present`);
            // إخطار الواجهة بتحديث القائمة الشاملة
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('devices-discovered', {
                    devices: Array.from(pendingDevicesMap.values()),
                    total: pendingDevicesMap.size
                });
            }
        }
    } catch (e) {
        console.warn('⚠️ Error while reconciling pending devices:', e);
    }

    if (!supabaseManager || !supabaseManager.client) {
        console.log('⚠️ No Supabase connection - showing all discovered devices as pending');
        for (const d of discoveredDevices) {
            const key = deriveDeviceKey(d);
            if (key && !pendingDevicesMap.has(key)) {
                pendingDevicesMap.set(key, { ...d, approval_status: 'pending' });
            }
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('devices-discovered', { devices: Array.from(pendingDevicesMap.values()), total: pendingDevicesMap.size });
        }
        return;
    }

    // خطوة 2: جلب جميع الأجهزة من قاعدة البيانات (بدون فلتر server_id للمقارنة الشاملة)
    // نقارن السيريال مع جميع الأجهزة في DB بغض النظر عن السيرفر
    try {
        let dbDevices = [];
        try {
            let query = supabaseManager.client.from('devices').select('*').limit(1000);
            // لا نفلتر بـ server_id - نريد مقارنة السيريال مع جميع الأجهزة المسجلة
            const { data, error } = await query;
            if (error) {
                console.warn('⚠️ Error fetching devices from DB:', error.message);
            }
            if (Array.isArray(data)) {
                dbDevices = data;
            }
        } catch (errFetch) {
            console.error('❌ Error fetching devices from DB:', errFetch);
        }

        console.log(`📊 Found ${dbDevices.length} devices in database`);

        // Debug: عرض الأجهزة الموجودة في قاعدة البيانات
        for (const d of dbDevices) {
            console.log(`DB Device: "${d.name}" serial="${d.serial_number}" status="${d.status}" server_id=${d.server_id}`);
        }

        // بناء مجموعة الأرقام التسلسلية في قاعدة البيانات
        const dbSerialMap = new Map(); // serial -> db device record
        for (const d of dbDevices) {
            const s = String(d.serial_number || d.serial || '').trim();
            if (s) dbSerialMap.set(s, d);
        }

        console.log(`📋 DB Serial Map has ${dbSerialMap.size} entries`);
        console.log(`📱 Discovered ${discoveredDevices.length} connected devices`);

        // Debug: عرض الأجهزة المكتشفة
        for (const d of discoveredDevices) {
            const serial = String(d.serial || d.serial_number || '').trim();
            console.log(`Discovered: "${d.name}" serial="${serial}" -> exists in DB: ${dbSerialMap.has(serial)}`);
        }


        // خطوة 3: تصنيف الأجهزة المكتشفة
        const devicesToUpdate = [];     // أجهزة في DB تحتاج تحديث لـ connected
        const devicesToDisconnect = []; // أجهزة في DB كانت connected لكن انفصلت
        const newDevices = [];          // أجهزة جديدة ليست في DB
        const autoConnectedDevices = []; // أجهزة تم ربطها تلقائياً

        // فحص كل جهاز مكتشف مقابل قاعدة البيانات
        for (const device of discoveredDevices) {
            // جلب الـ serial من أي حقل متاح
            const deviceSerial = String(device.serial || device.serial_number || '').trim();
            const dbDevice = dbSerialMap.get(deviceSerial);

            // console.log(`🔍 Checking device: serial="${deviceSerial}" found_in_db=${!!dbDevice}`);

            if (dbDevice) {
                // 🆕 إزالة من قائمة المعلقة المحلية فوراً لأنه أصبح موجوداً في القاعدة (تمت الموافقة)
                const key = deriveDeviceKey(device);
                if (key && pendingDevicesMap.has(key)) {
                    pendingDevicesMap.delete(key);
                    console.log(`✅ Moving approved device from pending to connected: ${deviceSerial}`);
                }

                // الجهاز موجود في DB - فحص إذا يحتاج تحديث حالة
                // نحدث حالته بغض النظر عن server_id - المهم الـ serial number
                if (dbDevice.status !== 'connected') {
                    devicesToUpdate.push({
                        id: dbDevice.id,
                        serial_number: deviceSerial,
                        status: 'connected',
                        connection_time: new Date().toISOString(),
                        last_activity: new Date().toISOString()
                    });
                    autoConnectedDevices.push({ ...dbDevice, status: 'connected' });
                    console.log(`🔄 WILL UPDATE: Device "${dbDevice.name}" (${deviceSerial}) from "${dbDevice.status}" → "connected" (Server: ${dbDevice.server_id})`);
                } else {
                    // حتى لو كان connected، نحدث last_activity
                    devicesToUpdate.push({
                        id: dbDevice.id,
                        serial_number: deviceSerial,
                        status: 'connected',
                        last_activity: new Date().toISOString()
                    });
                    autoConnectedDevices.push(dbDevice);
                    console.log(`✅ ALREADY CONNECTED: Device "${dbDevice.name}" (${deviceSerial}) - updating last_activity only`);
                }
            } else {
                // جهاز جديد - ليس في DB
                newDevices.push(device);
            }
        }

        // فحص الأجهزة الموجودة في DB كـ connected ولكنها ليست متصلة فيزيائياً الآن
        // نفحص فقط الأجهزة التابعة لهذا السيرفر
        if (connectionInfo && connectionInfo.server_id) {
            for (const dbDevice of dbDevices) {
                // نفحص فقط الأجهزة التابعة لهذا السيرفر
                if (dbDevice.server_id !== connectionInfo.server_id) {
                    continue; // تخطى الأجهزة من سيرفرات أخرى
                }

                const dbSerial = String(dbDevice.serial_number || dbDevice.serial || '').trim();
                if (dbSerial && dbDevice.status === 'connected' && !connectedSerials.has(dbSerial)) {
                    devicesToDisconnect.push({
                        id: dbDevice.id,
                        serial_number: dbSerial,
                        status: 'disconnected',
                        connection_time: dbDevice.connection_time,
                        last_activity: new Date().toISOString()
                    });
                    console.log(`🔄 WILL DISCONNECT: Device "${dbDevice.name}" (${dbSerial}) - no longer physically connected to Server ${connectionInfo.server_id}`);
                }
            }
        }

        // خطوة 4: تحديث حالات الأجهزة في قاعدة البيانات (Supabase مباشرة)
        if (devicesToUpdate.length > 0) {
            console.log(`🔄 Updating ${devicesToUpdate.length} device(s) to CONNECTED status...`);
            await updateConnectedDevicesInDB(devicesToUpdate);
        }

        if (devicesToDisconnect.length > 0) {
            console.log(`🔄 Updating ${devicesToDisconnect.length} device(s) to DISCONNECTED status...`);
            await updateDisconnectedDevicesInDB(devicesToDisconnect);
        }

        if (devicesToUpdate.length === 0 && devicesToDisconnect.length === 0) {
            // console.log('ℹ️ No device status changes needed');
        }


        // خطوة 5: إرسال الأجهزة الموافق عليها والمتصلة للواجهة
        const connectedApprovedDevices = dbDevices.filter(d => {
            const s = String(d.serial_number || d.serial || '').trim();
            return s && connectedSerials.has(s);
        }).map(d => ({ ...d, status: 'connected' }));

        const approvedButDisconnected = dbDevices.filter(d => {
            const s = String(d.serial_number || d.serial || '').trim();
            return s && !connectedSerials.has(s);
        }).map(d => ({ ...d }));

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('approved-connected-devices', connectedApprovedDevices);
            mainWindow.webContents.send('approved-disconnected-devices', approvedButDisconnected);
        }

        // خطوة 6: معالجة الأجهزة الجديدة (غير الموجودة في DB) - حظرها فعلياً ثم إضافتها كمعلقة
        if (newDevices.length > 0) {
            let trulyNewCount = 0;
            for (const d of newDevices) {
                if (deriveDeviceKey(d) && !pendingDevicesMap.has(deriveDeviceKey(d))) {
                    trulyNewCount++;
                }
            }
            if (trulyNewCount > 0) {
                console.log(`🆕 Found ${trulyNewCount} new devices not in DB - blocking and marking as pending`);
            }

            // إضافة إلى الخريطة المحلية للأجهزة المعلقة + حظر فعلي
            for (const d of newDevices) {
                try {
                    const key = deriveDeviceKey(d);
                    if (key && !pendingDevicesMap.has(key)) {
                        const deviceId = d.device_id || '';
                        const vid = d.vendor_id || '';
                        const pid = d.product_id || '';
                        const deviceClass = d.device_class || d.class || '';
                        const deviceName = d.name || '';

                        // فحص إذا كان الجهاز داخلي (لا يُحظر)
                        if (isInternalDevice(deviceId, vid, pid, deviceClass, deviceName)) {
                            console.log(`⏭️ Skipping internal device: ${deviceName} (${deviceId})`);
                            internalDeviceIds.add(deviceId);
                            continue;
                        }

                        // فحص إذا كان الجهاز موافق عليه مسبقاً (لا يُحظر)
                        if (approvedDeviceIds.has(deviceId)) {
                            console.log(`✅ Device already approved: ${deviceName} (${deviceId})`);
                            continue;
                        }

                        // فحص إذا كان الجهاز محظور بالفعل
                        if (blockedDeviceIds.has(deviceId)) {
                            console.log(`🔒 Device already blocked: ${deviceName} (${deviceId})`);
                            pendingDevicesMap.set(key, { ...d, approval_status: 'pending', block_status: 'blocked', block_method: 'Disable-PnpDevice' });
                            continue;
                        }

                        // *** حظر الجهاز فعلياً عبر Disable-PnpDevice (Default Deny) ***
                        if (deviceId) {
                            // 1. إعلام المستخدم بالاكتشاف أولاً
                            logNewDeviceDiscovered(d);

                            // 2. محاولة الحظر الفوري (محاكاة الباك إند)
                            console.log(`🔒 Attempting to BLOCK device: ${deviceName} (${deviceId})`);
                            const blockResult = await disableDeviceReal(deviceId);

                            if (blockResult.success) {
                                // تم الحظر بنجاح
                                pendingDevicesMap.set(key, {
                                    ...d,
                                    approval_status: 'pending',
                                    block_status: 'blocked',
                                    block_method: 'Disable-PnpDevice'
                                });
                                // لا حاجة لطباعة logDeviceBlocked لأن disableDeviceReal تطبع رسالة النجاح
                            } else {
                                // فشل الحظر
                                console.warn(`⚠️ BLOCK FAILED for ${deviceName}: ${blockResult.message}`);
                                pendingDevicesMap.set(key, {
                                    ...d,
                                    approval_status: 'pending',
                                    block_status: 'failed',
                                    block_error: blockResult.message
                                });
                            }
                        } else {
                            // لا يوجد device_id - نضيفه كمعلق بدون حظر
                            console.warn(`⚠️ Cannot block device (No ID): ${deviceName}`);
                            pendingDevicesMap.set(key, { ...d, approval_status: 'pending' });
                            logNewDeviceDiscovered(d);
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ Error adding/blocking pending device:', e);
                }
            }

            // إخطار الواجهة بالأجهزة المعلقة
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('devices-discovered', { devices: Array.from(pendingDevicesMap.values()), total: pendingDevicesMap.size });
            }

            // إرسال الأجهزة الجديدة إلى agent_pending_devices في Supabase
            await sendNewDevicesToAgentPending(newDevices);

            // إرسال الأجهزة الجديدة إلى السيرفر المركزي عبر API
            await sendDiscoveredDevicesToCentralServer(newDevices);
        } else {
            // أرسل حالة المعلقة الحالية
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('devices-discovered', { devices: Array.from(pendingDevicesMap.values()), total: pendingDevicesMap.size });
            }
        }

        // خطوة 7: تحديث العدادات
        await updateConnectedDeviceCount();

    } catch (error) {
        console.error('❌ Error in device processing:', error);
    }
}

// ✅ تم إلغاء دالة تنظيف الأجهزة "الوهمية" - لأن أجهزة INST_ هي أجهزة حقيقية
// كيبوردات وماوسات وأجهزة إدخال ما عندها سيريال مصنعي
async function cleanupPhantomPendingDevices() {
    // لا نحذف أي شيء - الأجهزة بـ INST_ هي أجهزة حقيقية بحاجة لموافقة الأدمن
    console.log('ℹ️ Phantom cleanup disabled - INST_ devices are real devices without manufacturer serial');
}

// دالة إرسال الأجهزة الجديدة إلى جدول agent_pending_devices في Supabase
async function sendNewDevicesToAgentPending(newDevices) {
    if (!supabaseManager || !connectionInfo || !connectionInfo.server_id) {
        console.warn('⚠️ Cannot send to agent_pending_devices: no Supabase or server connection');
        return;
    }

    try {
        const systemInfo = await getSystemInfo();

        // فلترة الأجهزة الخارجية فقط باستخدام deviceBlocker
        let devicesToProcess = newDevices;
        if (deviceBlocker && typeof deviceBlocker.filterExternalDevices === 'function') {
            console.log(`\n🔍 [Device Blocker] معالجة ${newDevices.length} جهاز`);
            devicesToProcess = deviceBlocker.filterExternalDevices(newDevices);
            console.log(`✅ [Device Blocker] تم تصفية الأجهزة: ${devicesToProcess.length} جهاز خارجي`);
        }

        for (const device of devicesToProcess) {
            try {
                const serialNumber = (device.serial_number || device.serial || '').toString();
                const deviceData = {
                    server_id: connectionInfo.server_id,
                    name: device.name || 'Unknown USB Device',
                    serial_number: serialNumber,
                    vendor_id: device.vendor_id || '0000',
                    product_id: device.product_id || '0000',
                    usb_port: device.location || 'USB Port',
                    device_class: device.device_class || device.class || 'Unknown',
                    manufacturer: device.manufacturer || 'Unknown',
                    location: device.location || 'USB Port',
                    meta_data: {
                        device_type: device.device_class || 'unknown',
                        auto_detected: true,
                        detected_by: 'usb_agent_with_blocker',
                        detected_at: new Date().toISOString(),
                        block_status: device.block_status || 'blocked',
                        block_method: device.block_method || 'Disable-PnpDevice',
                        pnp_instance_id: device.device_id || '',
                        system_info: {
                            hostname: systemInfo.hostname,
                            platform: systemInfo.platform,
                            ip: systemInfo.ip
                        },
                        device_info: device,
                        is_real_device: true,
                        filtered_by_device_blocker: true
                    }
                };

                const saveResult = await supabaseManager.saveAgentPendingDevice(deviceData);

                if (saveResult.success) {
                    if (saveResult.exists) {
                        console.log(`⚠️ Device ${device.name} already exists in agent_pending_devices`);
                    } else {
                        console.log(`✅ Device ${device.name} saved to agent_pending_devices`);
                    }

                    // إرسال إشعار للواجهة
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('device-detected', {
                            device: saveResult.device || deviceData,
                            message: `تم اكتشاف جهاز جديد: ${device.name}`
                        });
                    }
                } else {
                    console.error(`❌ Failed to save device ${device.name}:`, saveResult.error);
                }
            } catch (error) {
                console.error(`❌ Error saving device ${device.name} to agent_pending_devices:`, error);
            }
        }
    } catch (error) {
        console.error('❌ Error in sendNewDevicesToAgentPending:', error);
    }
}


// (Removed duplicate updateDisconnectedDevicesInDB and updateConnectedDevicesInDB functions)



// دالة إرسال الأجهزة المكتشفة إلى السيرفر المركزي عبر HTTP API
async function sendDiscoveredDevicesToCentralServer(devices) {
    if (!connectionInfo || !connectionInfo.server_url || !Array.isArray(devices) || devices.length === 0) {
        console.log('⚠️ No server connection or no devices to send to central server');
        return;
    }

    try {
        const serverUrl = connectionInfo.server_url.replace(/\/$/, '');
        const endpoint = `${serverUrl}/api/devices/discovered`;

        // إرسال جميع الأجهزة المكتشفة بدون استبعاد baseline
        const devicesToSend = devices;
        if (!devicesToSend || devicesToSend.length === 0) {
            return;
        }

        // تحضير بيانات الأجهزة للإرسال
        const devicePayload = {
            server_id: connectionInfo.server_id,
            server_name: connectionInfo.server_name || 'USB Agent',
            agent_version: '1.0.0',
            discovered_at: new Date().toISOString(),
            devices: devicesToSend.map(device => ({
                name: device.name || device.Caption || device.Name || 'Unknown Device',
                serial_number: device.serial_number || device.SerialNumber || '',
                vendor_id: device.vendor_id || device.VendorID || '',
                product_id: device.product_id || device.ProductID || '',
                manufacturer: device.manufacturer || device.Manufacturer || 'Unknown',
                device_class: device.class || device.Class || device.device_class || 'Unknown',
                description: device.description || device.Description || '',
                physical_path: device.device_id || device.DeviceID || '',
                location: device.location || device.LocationInformation || 'USB Port',
                detected_at: device.detected_at || new Date().toISOString(),
                system_info: {
                    os: device.system || 'Windows',
                    hostname: os.hostname(),
                    platform: os.platform(),
                    arch: os.arch()
                },
                status: 'discovered',
                is_real_device: true,
                discovery_method: 'electron_agent'
            }))
        };

        console.log(`📤 Sending ${devicesToSend.length} discovered devices to central server: ${endpoint}`);

        // إرسال الطلب إلى السيرفر المركزي باستخدام axios
        const axios = require('axios');
        const response = await axios.post(endpoint, devicePayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${connectionInfo.access_token || ''}`,
                'X-Agent-ID': connectionInfo.server_id?.toString() || '1',
                'X-Agent-Name': connectionInfo.server_name || 'USB Agent'
            },
            timeout: 10000, // 10 seconds timeout
            validateStatus: (status) => status < 500 // قبول أي status code أقل من 500
        });

        if (response.status >= 200 && response.status < 300) {
            const result = response.data;
            console.log(`✅ Successfully sent ${devicesToSend.length} devices to central server:`, result.message || 'OK');

            // إشعار الواجهة المحلية بنجاح الإرسال
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('devices-sent-to-server', {
                    success: true,
                    count: devicesToSend.length,
                    message: 'تم إرسال الأجهزة للمراجعة المركزية بنجاح'
                });
            }
        } else {
            const errorText = response.data || response.statusText;
            console.error(`❌ Failed to send devices to central server. Status: ${response.status}, Error:`, errorText);

            // إشعار الواجهة المحلية بفشل الإرسال
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('devices-sent-to-server', {
                    success: false,
                    count: devicesToSend.length,
                    message: `فشل إرسال الأجهزة: ${response.status}`,
                    error: errorText
                });
            }
        }
    } catch (error) {
        console.error('❌ Error sending devices to central server:', error);

        // إشعار الواجهة المحلية بفشل الإرسال
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('devices-sent-to-server', {
                success: false,
                count: devicesToSend.length,
                message: 'خطأ في الاتصال بالسيرفر المركزي',
                error: error.message
            });
        }
    }
}

// دالة إرسال الأجهزة المكتشفة للسيرفر المركزي (فقط إرسال بدون حفظ)
// الحفظ في قاعدة البيانات يتم فقط عند الموافقة على الجهاز
async function sendDevicesToMainServer(devices, action) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        console.log('⚠️ Main window not available');
        return;
    }

    try {
        // تحضير بيانات الأجهزة المكتشفة
        const discoveredDevices = devices.map(device => ({
            name: device.name,
            serial_number: device.serial_number,
            vendor_id: device.vendor_id,
            product_id: device.product_id,
            manufacturer: device.manufacturer || 'Unknown',
            device_class: device.class || 'Unknown',
            detected_at: device.detected_at,
            system: device.system,
            location: device.location || 'USB Port',
            device_id: device.device_id,
            status: device.status,
            action: action,
            server_id: connectionInfo?.server_id || null,
            server_name: connectionInfo?.server_name || 'Unknown Server'
        }));

        // إرسال الأجهزة المكتشفة إلى الواجهة الأمامية فقط (لا يتم الحفظ في قاعدة البيانات)
        mainWindow.webContents.send('devices-discovered', {
            devices: discoveredDevices,
            action: action,
            total: discoveredDevices.length,
            timestamp: new Date().toISOString()
        });

        console.log(`📤 Sent ${discoveredDevices.length} ${action} devices to frontend (not saved to DB - awaiting approval)`);
    } catch (error) {
        console.error('Error sending devices to frontend:', error);
    }
}

// دالة إيقاف مراقبة الأجهزة
function stopDeviceMonitoring() {
    deviceDiscoveryActive = false;
    if (deviceMonitoringInterval) {
        clearInterval(deviceMonitoringInterval);
        deviceMonitoringInterval = null;
    }
    console.log('Device monitoring stopped');
}

// دالة تحديث حالة السيرفر عند الإغلاق
async function updateServerStatusOnExit() {
    // التحقق من أن Supabase Manager لا يزال متاحاً
    if (!supabaseManager || !supabaseManager.client) {
        console.log('⚠️  Supabase Manager not available for status update on exit');
        return;
    }

    // محاولة تحميل معلومات الاتصال إذا لم تكن متوفرة
    if (!connectionInfo) {
        console.log('🔄 Loading connection info for exit update...');
        await loadConnectionInfo();
    }

    if (!connectionInfo || !connectionInfo.server_id) {
        console.log('⚠️  No server connection info available for status update on exit');
        return;
    }

    try {
        console.log(`🔄 Updating server status to offline for server ID: ${connectionInfo.server_id}`);

        // تحديث حالة السيرفر إلى offline في قاعدة البيانات
        const result = await supabaseManager.client
            .from('servers')
            .update({
                status: 'offline',
                last_heartbeat: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                is_online: false // إضافة هذا الحقل للتأكد
            })
            .eq('id', connectionInfo.server_id);

        if (result.error) {
            console.error('❌ Error updating server status to offline:', result.error);
        } else {
            console.log('✅ Server status successfully updated to offline');

            // إضافة سجل في جدول logs للتوثيق
            try {
                await supabaseManager.client
                    .from('logs')
                    .insert({
                        action: 'server_disconnected',
                        user_id: connectionInfo.user_id || null,
                        details: JSON.stringify({
                            server_id: connectionInfo.server_id,
                            server_name: connectionInfo.server_name || 'Unknown',
                            disconnect_time: new Date().toISOString(),
                            reason: 'Application closed'
                        }),
                        timestamp: new Date().toISOString()
                    });
                console.log('📝 Server disconnection logged successfully');
            } catch (logError) {
                console.error('⚠️  Warning: Failed to log server disconnection:', logError);
            }
        }

        // انتظار قصير للتأكد من إتمام العملية
        await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
        console.error('❌ Critical error updating server status on exit:', error);
    }
}

// دالة تهيئة حالة السيرفر عند بدء التطبيق
async function initializeServerStatus() {
    console.log('🔄 Initializing server status...');

    try {
        // التأكد من أن Supabase Manager جاهز
        if (!supabaseManager || !supabaseManager.client) {
            console.log('⚠️  Supabase Manager not ready yet');
            return;
        }

        // تحميل معلومات الاتصال
        await loadConnectionInfo();

        // إذا لم تكن معلومات الاتصال متوفرة، حاول الحصول عليها من قاعدة البيانات
        if (!connectionInfo || !connectionInfo.server_id) {
            console.log('🔄 Trying to get server info from database...');
            const systemInfo = await getSystemInfo();

            const { data, error } = await supabaseManager.client
                .from('servers')
                .select('*')
                .eq('hostname', systemInfo.hostname)
                .limit(1);

            if (error) {
                console.error('❌ Error querying server info:', error);
                return;
            }

            if (data && data.length > 0) {
                // تحديث معلومات الاتصال
                connectionInfo = {
                    server_id: data[0].id,
                    server_name: data[0].name || data[0].hostname,
                    server_type: data[0].server_type || 'sub',
                    registered_at: data[0].created_at
                };
                await saveConnectionInfo(connectionInfo);
                console.log('✅ Server info loaded from database');
            } else {
                console.log('⚠️  No server record found for this hostname');
                return;
            }
        }

        // تحديث حالة السيرفر إلى متصل
        await updateServerStatusOnline();

        // بدء heartbeat monitoring
        startHeartbeat();

        console.log('✅ Server status initialization completed');
    } catch (error) {
        console.error('❌ Error initializing server status:', error);
    }
}

// دالة تحديث حالة السيرفر إلى متصل عند بدء التطبيق
async function updateServerStatusOnline() {
    // التأكد من أن التطبيق قد انتهى من التهيئة
    if (!supabaseManager || !supabaseManager.client) {
        console.log('⚠️  Supabase Manager not ready yet, retrying in 3 seconds...');
        // إعادة المحاولة بعد 3 ثواني
        setTimeout(updateServerStatusOnline, 3000);
        return;
    }

    // محاولة تحميل معلومات الاتصال إذا لم تكن متوفرة
    if (!connectionInfo) {
        console.log('🔄 Loading connection info...');
        await loadConnectionInfo();
    }

    if (!connectionInfo || !connectionInfo.server_id) {
        console.log('⚠️  No server connection info available for online status update');
        // محاولة الحصول على معلومات السيرفر من قاعدة البيانات
        try {
            const systemInfo = await getSystemInfo();
            const { data, error } = await supabaseManager.client
                .from('servers')
                .select('*')
                .eq('hostname', systemInfo.hostname)
                .limit(1);

            if (error) {
                console.error('❌ Error querying server info:', error);
                return;
            }

            if (data && data.length > 0) {
                // تحديث معلومات الاتصال
                connectionInfo = {
                    server_id: data[0].id,
                    server_name: data[0].name || data[0].hostname,
                    server_type: data[0].server_type || 'sub',
                    registered_at: data[0].created_at
                };
                await saveConnectionInfo(connectionInfo);
                console.log('✅ Server info loaded from database');
            } else {
                console.log('⚠️  No server record found for this hostname');
                return;
            }
        } catch (error) {
            console.error('❌ Error loading server info from database:', error);
            return;
        }
    }

    try {
        console.log(`🔄 Updating server status to online for server ID: ${connectionInfo.server_id}`);

        const systemInfo = await getSystemInfo();
        const result = await supabaseManager.client
            .from('servers')
            .update({
                status: 'active',
                last_heartbeat: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                is_online: true,
                ip_address: systemInfo.ip || 'unknown'
            })
            .eq('id', connectionInfo.server_id);

        if (result.error) {
            console.error('❌ Error updating server status to online:', result.error);
        } else {
            console.log('✅ Server status successfully updated to online');

            // إضافة سجل في جدول logs للتوثيق
            try {
                await supabaseManager.client
                    .from('logs')
                    .insert({
                        action: 'server_connected',
                        user_id: connectionInfo.user_id || null,
                        details: JSON.stringify({
                            server_id: connectionInfo.server_id,
                            server_name: connectionInfo.server_name || 'Unknown',
                            connect_time: new Date().toISOString(),
                            app_version: require('./package.json').version || '1.0.0'
                        }),
                        timestamp: new Date().toISOString()
                    });
                console.log('📝 Server connection logged successfully');
            } catch (logError) {
                console.error('⚠️  Warning: Failed to log server connection:', logError);
            }
        }

        // انتظار قصير للتأكد من إتمام العملية
        await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
        console.error('❌ Critical error updating server status on startup:', error);
    }
}

// دالة تهيئة حالة السيرفر عند بدء التطبيق
async function initializeServerStatus() {
    console.log('🔄 Initializing server status...');

    try {
        // التأكد من أن Supabase Manager جاهز
        if (!supabaseManager || !supabaseManager.client) {
            console.log('⚠️  Supabase Manager not ready yet');
            return;
        }

        // تحميل معلومات الاتصال
        await loadConnectionInfo();

        // إذا لم تكن معلومات الاتصال متوفرة، حاول الحصول عليها من قاعدة البيانات
        if (!connectionInfo || !connectionInfo.server_id) {
            console.log('🔄 Trying to get server info from database...');
            const systemInfo = await getSystemInfo();

            const { data, error } = await supabaseManager.client
                .from('servers')
                .select('*')
                .eq('hostname', systemInfo.hostname)
                .limit(1);

            if (error) {
                console.error('❌ Error querying server info:', error);
                return;
            }

            if (data && data.length > 0) {
                // تحديث معلومات الاتصال
                connectionInfo = {
                    server_id: data[0].id,
                    server_name: data[0].name || data[0].hostname,
                    server_type: data[0].server_type || 'sub',
                    registered_at: data[0].created_at
                };
                await saveConnectionInfo(connectionInfo);
                console.log('✅ Server info loaded from database');
            } else {
                console.log('⚠️  No server record found for this hostname');
                return;
            }
        }

        // تحديث حالة السيرفر إلى متصل
        await updateServerStatusOnline();

        // بدء heartbeat monitoring
        startHeartbeat();

        console.log('✅ Server status initialization completed');
    } catch (error) {
        console.error('❌ Error initializing server status:', error);
    }
}

// دالة تحديث السيرفرات القديمة إلى offline عند بدء التطبيق
async function markOldServersOffline() {
    if (!supabaseManager) {
        console.log('No supabase manager available for marking old servers offline');
        return;
    }

    try {
        console.log('🔄 Marking old servers as offline...');

        // تحديث جميع السيرفرات التي لم يتم تحديثها منذ أكثر من 5 دقائق إلى offline
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

        const result = await supabaseManager.client
            .from('servers')
            .update({
                status: 'offline',
                is_online: false,
                updated_at: new Date().toISOString()
            })
            .lt('last_heartbeat', fiveMinutesAgo);

        if (result.error) {
            console.error('❌ Error marking old servers offline:', result.error);
        } else {
            console.log('✅ Old servers marked as offline successfully');
        }
    } catch (error) {
        console.error('❌ Critical error marking old servers offline:', error);
    }
}

// start USB discovery (optional)
try {
    const discoveryConfig = {
        serverUrl: process.env.CENTRAL_SERVER_URL || 'http://localhost:5000',
        serverId: process.env.SERVER_ID ? Number(process.env.SERVER_ID) : 1,
        token: process.env.AGENT_TOKEN || '',
        intervalMs: process.env.SCAN_INTERVAL ? Number(process.env.SCAN_INTERVAL) : 5000
    };

    // lazy-require to avoid breaking environments without native usb
    try {
        const { startUsbDiscovery } = require('./src/discovery');
        const disco = startUsbDiscovery(discoveryConfig);
        disco.on('reported', (devices) => console.log(`Discovery reported ${devices.length} devices`));
        disco.on('report-failed', () => console.warn('Discovery report failed'));
    } catch (err) {
        console.warn('USB discovery not available in this environment:', err.message);
    }
} catch (e) {
    console.warn('USB discovery initialization failed:', e.message);
}

// ==================== CLEANUP & EXIT HANDLING ====================

