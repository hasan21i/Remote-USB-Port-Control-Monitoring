/**
 * منطق حظر الأجهزة
 * يتطابق مع منطق backend/services/device_blocker.py
 */

// قائمة الأجهزة الداخلية المستثناة من الحظر
const INTERNAL_VID_PID = {
    // Intel Internal Bluetooth Adapters
    '8087:0026': 'Intel AX201 BT',
    '8087:0029': 'Intel AX200 BT',
    '8087:0032': 'Intel AX210 BT',
    '8087:0033': 'Intel BE200 BT',
    '8087:0025': 'Intel 9560 BT',
    '8087:0aaa': 'Intel BT',
    '8087:0a2b': 'Intel BT',
    '8087:0a2a': 'Intel BT',

    // Intel Internal Cameras
    '8086:0a80': 'Intel Camera',
    '8086:09d4': 'Intel Camera',
    '5986:2150': 'Acer/ASUS Internal Camera (Bison)',
    '5986:2141': 'Acer/ASUS Internal Camera',
    '5986:214c': 'Acer/ASUS Internal Camera',
    '04f2:b71a': 'Chicony Internal Camera',
    '04f2:b6d9': 'Chicony Internal Camera',
    '04f2:b5ee': 'Chicony Internal Camera',
    '04f2:b725': 'Chicony Internal Camera',
    '0408:1091': 'Quanta Internal Camera',
    '13d3:56ff': 'IMC Internal Camera',
    '13d3:5a02': 'IMC Internal Camera',
    '13d3:5248': 'IMC Internal Camera',

    // Fingerprint readers (internal)
    '06cb:00bd': 'Synaptics Fingerprint',
    '06cb:00be': 'Synaptics Fingerprint',
    '138a:0097': 'Validity/Synaptics Fingerprint',
    '27c6:63ac': 'Goodix Fingerprint (ASUS)',
    '27c6:55a4': 'Goodix Fingerprint',

    // ASUS Internal Devices
    '0b05:19b6': 'ASUS NumberPad/ScreenPad',
    '0b05:1866': 'ASUS Internal',
    '0b05:1837': 'ASUS Internal',
};

const INTERNAL_DEVICE_PATTERNS = [
    'ROOT_HUB',
    'USB\\ROOT_HUB',
    'VID_8086',      // Intel Internal/Hubs
    'VID_8087',      // Intel Bluetooth
    'VID_0C45',      // Internal webcam
    'VID_04F2',      // Chicony webcam
    'VID_13D3',      // Azurewave Bluetooth/Webcam
    // 'VID_0BDA', Removed because it breaks Realtek External HDDs
    'VID_5986',      // Acer/ASUS Internal Camera
    'VID_0B05',      // ASUS Internal
    'VID_06CB',      // Synaptics Fingerprint
    'VID_27C6',      // Goodix Fingerprint
    'HID\\',         // Human Interface Devices
    'SWD\\',         // Software Devices
    'PCI\\'          // PCI Devices
];

const INTERNAL_DEVICE_CLASSES = new Set([
    'system',
    'firmware',
    'processor',
    'computer',
    'volume',
    'hub'
]);

/**
 * التحقق من أن الجهاز داخلي (يجب استثناؤه من الحظر)
 * @param {Object} device - معلومات الجهاز
 * @returns {boolean} - true إذا كان الجهاز داخلياً
 */
function isInternalDevice(device) {
    if (!device) return false;

    const instanceId = device.instanceId || device.instance_id || '';
    const deviceId = device.deviceId || device.device_id || '';
    const vendorId = device.vendorId || device.vendor_id || '';
    const productId = device.productId || device.product_id || '';
    const name = device.name || '';
    const deviceClass = device.deviceClass || device.class || device.device_class || '';
    const location = device.location || '';

    const upperInstanceId = (instanceId || deviceId).toUpperCase();

    // فحص أنماط DeviceID
    for (const pattern of INTERNAL_DEVICE_PATTERNS) {
        if (upperInstanceId.includes(pattern.toUpperCase())) {
            console.log(`[Device Blocker] تم اكتشاف جهاز داخلي (Pattern): ${name || instanceId}`);
            return true;
        }
    }

    // فحص VID:PID
    const vidPidKey1 = `${vendorId.toUpperCase()}:${productId.toUpperCase()}`;
        // ?????
        // ????? ????
    if (vendorId === '8086' || vendorId === '8087' || vendorId.toUpperCase() === '8086') {
        console.log(`[Device Blocker] ØªÙ… Ø§ÙƒØªØ´Ø§Ù Ø¬Ù‡Ø§Ø² Ø¯Ø§Ø®Ù„ÙŠ (Intel USB Hub/Controller): ${name}`);
        return true;
    }
    if (vidPidKey1 in INTERNAL_VID_PID) {
        console.log(`[Device Blocker] تم اكتشاف جهاز داخلي (VID:PID): ${name || vidPidKey1}`);
        return true;
    }

    // فحص فئة الجهاز
    if (INTERNAL_DEVICE_CLASSES.has(deviceClass.toLowerCase())) {
        console.log(`[Device Blocker] تم اكتشاف جهاز داخلي (Class): ${name || deviceClass}`);
        return true;
    }

    // فحص الاسم لأجهزة داخلية واضحة
    const nameLower = name.toLowerCase();
    const internalNamePatterns = [
        'host controller',
        'root hub',
        'generic hub',
        'intel',
        'realtek'
    ];
    for (const pattern of internalNamePatterns) {
        if (nameLower.includes(pattern)) {
            console.log(`[Device Blocker] تم اكتشاف جهاز داخلي (Name): ${name}`);
            return true;
        }
    }

    return false;
}

/**
 * معالجة جهاز مكتشف حديثاً
 * @param {Object} device - معلومات الجهاز
 * @param {Function} onBlockDevice - دالة لتنفيذ حظر الجهاز
 * @returns {Promise<Object>} - نتيجة المعالجة
 */
async function processNewDevice(device, onBlockDevice) {
    console.log(`[Device Blocker] معالجة جهاز جديد: ${device.name}`);

    // التحقق من أن الجهاز ليس داخلياً
    if (isInternalDevice(device)) {
        console.log(`[Device Blocker] تم تجاوز الجهاز الداخلي: ${device.name}`);
        return {
            success: false,
            reason: 'internal_device',
            message: `الجهاز الداخلي ${device.name} تم تجاوزه`
        };
    }

    console.log(`[Device Blocker] جهاز خارجي مكتشف: ${device.name}`);

    // تنفيذ حظر الجهاز إذا كانت الدالة متوفرة
    if (typeof onBlockDevice === 'function') {
        try {
            const blockResult = await onBlockDevice(device);
            return {
                success: true,
                blocked: true,
                message: `تم حظر الجهاز: ${device.name}`,
                blockResult
            };
        } catch (error) {
            console.error(`[Device Blocker] خطأ في حظر الجهاز: ${error.message}`);
            return {
                success: false,
                reason: 'block_failed',
                message: `فشل في حظر الجهاز: ${error.message}`,
                error: error.message
            };
        }
    }

    // إرجاع أن الجهاز يحتاج إلى حظر
    return {
        success: true,
        needsBlocking: true,
        message: `${device.name} يحتاج إلى حظر`
    };
}

/**
 * تصفية الأجهزة الخارجية فقط (غير الداخلية)
 * @param {Array} devices - قائمة الأجهزة
 * @returns {Array} - الأجهزة الخارجية فقط
 */
function filterExternalDevices(devices) {
    if (!Array.isArray(devices)) return [];
    return devices.filter(device => !isInternalDevice(device));
}

/**
 * تحضير بيانات الجهاز للإرسال إلى قاعدة البيانات
 * @param {Object} device - معلومات الجهاز
 * @param {string} serverId - معرف السيرفر
 * @returns {Object} - البيانات المعدة
 */
function preparePendingDeviceData(device, serverId) {
    const vendorId = device.vendorId || device.vendor_id || '';
    const productId = device.productId || device.product_id || '';
    const instanceId = device.instanceId || device.instance_id || '';
    
    // استخراج رقم VID:PID من instanceId إذا لم تكن موجودة
    let extractedVid = vendorId;
    let extractedPid = productId;
    
    if (!vendorId && instanceId) {
        const match = instanceId.match(/VID_([0-9A-Fa-f]+).*PID_([0-9A-Fa-f]+)/);
        if (match) {
            extractedVid = match[1];
            extractedPid = match[2];
        }
    }

    return {
        server_id: serverId,
        name: device.name || 'Unknown USB Device',
        serial_number: device.serialNumber || device.serial_number || instanceId || `INST_${Date.now()}`,
        vendor_id: extractedVid.toUpperCase(),
        product_id: extractedPid.toUpperCase(),
        device_class: device.deviceClass || 'Unknown',
        manufacturer: device.manufacturer || 'Unknown',
        usb_port: device.location || device.portNumber || 'Unknown',
        device_path: device.instanceId || device.deviceId || '',
        is_internal: false,
        status: 'pending',
        meta_data: {
            device_info: device,
            detected_by: 'usb_agent',
            is_real_device: true,
            detection_time: new Date().toISOString()
        }
    };
}

module.exports = {
    isInternalDevice,
    processNewDevice,
    filterExternalDevices,
    preparePendingDeviceData,
    INTERNAL_VID_PID,
    INTERNAL_DEVICE_PATTERNS,
    INTERNAL_DEVICE_CLASSES
};
