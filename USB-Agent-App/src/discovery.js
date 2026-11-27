// USB device discovery helper (Node.js)
// Usage:
//  - npm install usb axios
//  - require('./discovery').startUsbDiscovery({ serverUrl, serverId, token })
// This module ONLY discovers devices and reports them to a central server as "discovered" (no control).

const usb = require('usb');
const axios = require('axios');
const EventEmitter = require('events');
const { exec } = require('child_process');

const DEFAULT_INTERVAL = 5000; // 5s

class UsbDiscovery extends EventEmitter {
  constructor({ serverUrl, serverId = 1, token = '', intervalMs = DEFAULT_INTERVAL, maxRetries = 3 }) {
    super();
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.serverId = serverId;
    this.token = token;
    this.intervalMs = intervalMs;
    this.maxRetries = maxRetries;

    this._timer = null;
    this._seenSerials = new Set(); // حافظ على آخر أجهزة مكتشفة
    this._isScanning = false;

    this.axios = axios.create({ timeout: 30000 });
  }

  async _getRegistryUsbDevicesViaReg() {
    if (process.platform !== 'win32') return [];
    const { exec } = require('child_process');

    return new Promise((resolve) => {
      exec('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Enum\\USB" /s', { timeout: 20000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err || !stdout) return resolve([]);

        try {
          const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const devices = [];
          let currentKey = null;
          let currentValues = {};

          for (const line of lines) {
            if (line.startsWith('HKEY_LOCAL_MACHINE\\')) {
              if (currentKey && Object.keys(currentValues).length > 0) {
                const match = currentKey.match(/VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})/i);
                if (match) {
                  const vendor = match[1].toUpperCase();
                  const product = match[2].toUpperCase();
                  const instanceId = currentKey.split('\\').pop();
                  const name = currentValues['FriendlyName'] || currentValues['DeviceDesc'] || currentValues['Name'] || '';
                  const hw = currentValues['HardwareID'] || currentValues['CompatibleIDs'] || '';
                  const serialCandidate = instanceId && instanceId.indexOf('&') === -1 ? instanceId : null;
                  const serial = serialCandidate || (Array.isArray(hw) && hw.length ? hw[0] : (typeof hw === 'string' ? hw : ''));
                  devices.push({
                    vendor_id: vendor,
                    product_id: product,
                    name: String(name || '').replace(/\s*USB\s*Device\s*/ig, '').trim() || 'Unknown Device',
                    manufacturer: currentValues['Manufacturer'] || null,
                    device_id: currentKey,
                    hardware_id: hw,
                    serial_number: (serial && String(serial).replace(/[^A-Z0-9-]/gi, '')) || null,
                    from_registry: true,
                    controllable: false,
                    detected_at: new Date().toISOString()
                  });
                }
              }
              currentKey = line;
              currentValues = {};
              continue;
            }

            const m = line.match(/^([^\s]+)\s+REG_[A-Z0-9_]+\s+(.*)$/i);
            if (m && currentKey) {
              const key = m[1];
              const value = m[2];
              if (value.indexOf('\u0000') >= 0 || value.indexOf('\\0') >= 0) {
                currentValues[key] = value.split(/\\0|\u0000/).map(v => v).filter(Boolean);
              } else {
                currentValues[key] = value;
              }
            }
          }

          if (currentKey && Object.keys(currentValues).length > 0) {
            const match = currentKey.match(/VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})/i);
            if (match) {
              const vendor = match[1].toUpperCase();
              const product = match[2].toUpperCase();
              const instanceId = currentKey.split('\\').pop();
              const name = currentValues['FriendlyName'] || currentValues['DeviceDesc'] || currentValues['Name'] || '';
              const hw = currentValues['HardwareID'] || currentValues['CompatibleIDs'] || '';
              const serialCandidate = instanceId && instanceId.indexOf('&') === -1 ? instanceId : null;
              const serial = serialCandidate || (Array.isArray(hw) && hw.length ? hw[0] : (typeof hw === 'string' ? hw : ''));
              devices.push({
                vendor_id: vendor,
                product_id: product,
                name: String(name || '').replace(/\s*USB\s*Device\s*/ig, '').trim() || 'Unknown Device',
                manufacturer: currentValues['Manufacturer'] || null,
                device_id: currentKey,
                hardware_id: hw,
                serial_number: (serial && String(serial).replace(/[^A-Z0-9-]/gi, '')) || null,
                from_registry: true,
                controllable: false,
                detected_at: new Date().toISOString()
              });
            }
          }

          const dedup = [];
          const seen = new Set();
          for (const d of devices) {
            const key = d.serial_number || `${d.vendor_id}:${d.product_id}:${d.name}`;
            if (!seen.has(key)) {
              seen.add(key);
              dedup.push(d);
            }
          }
          resolve(dedup);
        } catch (e) {
          return resolve([]);
        }
      });
    });
  }

  async _getStringDescriptorSafe(device, index) {
    if (!index) return null;
    return new Promise((resolve) => {
      try {
        // قد لا نتمكن من فتح الجهاز على بعض الأنظمة أو بدون صلاحيات
        device.open();
      } catch (e) {
        // افتح فشل، حاول الحصول على الوصف بدون فتح (بعض environments لا تسمح)
      }

      if (typeof device.getStringDescriptor !== 'function') {
        try { device.close(); } catch (_) {}
        return resolve(null);
      }

      device.getStringDescriptor(index, (err, value) => {
        try { device.close(); } catch (_) {}
        if (err) return resolve(null);
        resolve(value ? String(value).trim() : null);
      });

      // Safety: if callback never called, resolve after timeout
      setTimeout(() => {
        try { device.close(); } catch (_) {}
        resolve(null);
      }, 3000);
    });
  }

  async _readDeviceInfo(device) {
    try {
      const desc = device.deviceDescriptor || {};
      const vendorId = desc.idVendor || null;
      const productId = desc.idProduct || null;

      const manufacturer = await this._getStringDescriptorSafe(device, desc.iManufacturer);
      const product = await this._getStringDescriptorSafe(device, desc.iProduct);
      const serial = await this._getStringDescriptorSafe(device, desc.iSerialNumber);

      return {
        vendor_id: vendorId ? vendorId.toString(16).toUpperCase() : null,
        product_id: productId ? productId.toString(16).toUpperCase() : null,
        manufacturer: manufacturer || null,
        name: product || null,
        serial_number: serial || null,
        is_real: true,
        connection_time: new Date().toISOString()
      };
    } catch (e) {
      return null;
    }
  }

  async _scanOnce() {
    try {
      const list = usb.getDeviceList();
      const results = [];

      for (const d of list) {
        const info = await this._readDeviceInfo(d);
        if (info) results.push(info);
      }

      return results;
    } catch (e) {
      return [];
    }
  }

  async _notifyServer(devices) {
    // تعطيل الإرسال للسيرفر المركزي - الأجهزة تُدار محلياً عبر Supabase
    // إذا كنت تريد إرسال الأجهزة للسيرفر المركزي، فعّل هذا الكود
    if (!this.serverUrl) return true;
    
    // لا حاجة للإرسال في الوضع الحالي - التطبيق يعمل محلياً
    // يمكن تفعيل هذا لاحقاً إذا احتجت للإرسال لسيرفر مركزي
    return true;
    
    /* كود الإرسال للسيرفر المركزي (معطل حالياً)
    const postUrl = `${this.serverUrl}/api/devices/discovered`;

    const payload = {
      server_id: this.serverId,
      devices,
      action: 'discovered'
    };

    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};

    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        await this.axios.post(postUrl, payload, { headers });
        this.emit('reported', devices);
        return true;
      } catch (err) {
        attempt++;
        const wait = 500 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, wait));
      }
    }

    // فشل الإرسال بعد عدة محاولات
    console.warn('Failed to report devices to central server after retries');
    return false;
    */
  }

  async _getRegistryUsbDevices() {
    // Windows-only: query registry / PnP to discover devices the kernel knows about
    if (process.platform !== 'win32') return [];

  // Use PowerShell Get-PnpDevice mirroring backend detection logic for Windows
  const psCmd = `
        $realUsbDevices = Get-PnpDevice | Where-Object {
          ($_.DeviceID -like "USB\\VID_*" -or $_.DeviceID -like "HID\\VID_*") -and
          $_.Status -eq "OK" -and
          $_.Present -eq $true -and
          # استبعاد الأجهزة الداخلية الأساسية فقط
          -not ($_.DeviceID -like "*ROOT_HUB*") -and
          -not ($_.DeviceID -like "*PCI\\*") -and
          -not ($_.DeviceID -like "*ACPI\\*") -and
          ($_.DeviceID -match "VID_[0-9A-F]{4}") -and
          ($_.DeviceID -match "PID_[0-9A-F]{4}")
        } | Select-Object DeviceID, Name, Status, Class, Manufacturer, LocationInformation, HardwareID

        $devices = @()
        foreach ($device in $realUsbDevices) {
          $serial = ""
          $deviceId = $device.DeviceID

          # Extract serial from DeviceID if available
          if ($deviceId -match "\\\\([^\\\\]+)$") {
            $lastPart = $matches[1]
            $serial = $lastPart -replace "[^A-Z0-9]", ""
            if ($serial.Length -lt 6 -or $serial -notmatch "^[A-Z0-9]+$") {
              $serial = ""
            }
          }

          # Try to extract serial from HardwareID
          if (-not $serial -and $device.HardwareID) {
            foreach ($hwId in $device.HardwareID) {
              if ($hwId -match "&REV_([0-9A-F]+)") {
                $serial = $matches[1]
                break
              }
            }
          }

          # Extract VID and PID (استخدام productId بدل $pid لأن $PID محجوز)
          $vendorId = ""
          $productId = ""
          if ($deviceId -match "VID_([0-9A-F]{4})") {
            $vendorId = $matches[1]
          }
          if ($deviceId -match "PID_([0-9A-F]{4})") {
            $productId = $matches[1]
          }

          # Generate serial if not found (match backend fallback)
          if (-not $serial) {
            $serial = "VID" + $vendorId + "PID" + $productId + "REV0001"
          }

          $devices += @{
            'device_id' = $deviceId
            'name' = $device.Name
            'serial_number' = $serial
            'status' = $device.Status
            'class' = $device.Class
            'manufacturer' = $device.Manufacturer
            'location' = $device.LocationInformation
            'hardware_id' = $device.HardwareID
            'is_real_usb' = $true
            'is_external_port' = $true
          }
        }

        if ($devices.Count -gt 0) {
          $devices | ConvertTo-Json -Depth 3
        } else {
          "[]"
        }
  `;

    return new Promise((resolve) => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `discovery_${Date.now()}.ps1`);

      try {
        fs.writeFileSync(tmpFile, psCmd, 'utf8');
      } catch (writeErr) {
        return resolve([]);
      }

      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        let data = [];
        try {
          if (err) {
            return resolve([]);
          }

          try {
            const raw = stdout.trim();
            const firstJson = raw.indexOf('[') >= 0 ? raw.slice(raw.indexOf('[')) : raw;
            data = JSON.parse(firstJson);
            if (!Array.isArray(data)) data = [data];
          } catch (e) {
            return resolve([]);
          }
          // If PowerShell returned nothing, try reg.exe fallback
          if (!data || (Array.isArray(data) && data.length === 0)) {
            // call registry fallback and resolve with its result
            try {
              this._getRegistryUsbDevicesViaReg()
                .then((regResult) => {
                  return resolve(regResult || []);
                })
                .catch(() => {
                  return resolve([]);
                });
              return; // exit current callback - registry handler will resolve
            } catch (e) {
              // ignore and continue to process empty data
            }
          }

          // process data below
        } finally {
          try { fs.unlinkSync(tmpFile); } catch (_) {}
        }

  // Helper: clean device name similar to backend
        const cleanDeviceName = (name) => {
          if (!name) return 'Unknown Device';
          const lower = String(name).toLowerCase();
          if (['unknown', 'generic', 'composite'].includes(lower.trim())) return 'Unknown Device';
          return String(name).replace(/\s*\(.*?\)\s*/g, '').replace(/\s*USB\s*Device\s*/ig, '').replace(/\s*Standard\s*/ig, '').trim() || 'Unknown Device';
        };

        const isFakeDevice = (vendor, product, name, serial) => {
          if (!vendor || !product) return true;
          const v = (vendor || '').toLowerCase();
          const p = (product || '').toLowerCase();
          const fakePairs = [ ['0123','4567'], ['0000','0000'], ['ffff','ffff'], ['1234','5678'] ];
          for (const [fv, fp] of fakePairs) {
            if (v === fv && p === fp) return true;
          }
          if (serial && typeof serial === 'string') {
            // suspicious serial patterns
            if (serial.startsWith('USB_') && serial.split('_').length >= 3 && /^\\d+$/.test(serial.split('_')[1])) return true;
          }
          return false;
        };

        const isExternalPort = (location) => {
          if (!location) return false;
          const lower = String(location).toLowerCase();
          if (lower.includes('root_hub') || lower.includes('pci') || lower.includes('acpi') || lower.includes('display') || lower.includes('hdaudio')) return false;
          if (lower.includes('port_') && lower.includes('hub_')) return true;
          if (lower.includes('usb') && (lower.includes('port') || lower.includes('hub'))) return true;
          if (lower.match(/port[_#]\d+/)) return true;
          return false;
        };

        const extractRealSerialNumberWindows = (item) => {
          try {
            const deviceId = item.device_id || item.DeviceID || '';
            const m = String(deviceId).match(/\\\\([^\\\\]+)$/);
            if (m && m[1]) {
              const candidate = String(m[1]).replace(/[^A-Z0-9]/gi, '').toUpperCase();
              if (candidate.length >= 6 && !['0000','00000000'].includes(candidate)) return candidate;
            }
          } catch (_) {}

          // fallback: try HardwareID (array or string)
          try {
            const hw = item.hardware_id || item.HardwareID || item.HardwareId || '';
            if (Array.isArray(hw) && hw.length > 0) {
              for (const h of hw) {
                const mm = String(h).match(/&REV_([0-9A-F]+)/i);
                if (mm && mm[1]) return mm[1].toUpperCase();
              }
            } else if (typeof hw === 'string') {
              const mm = hw.match(/&REV_([0-9A-F]+)/i);
              if (mm && mm[1]) return mm[1].toUpperCase();
            }
          } catch (_) {}

          return null;
        };

        // Detection helpers for filtering out network/communication devices
        const isNetworkCommunicationDevice = (name, deviceClass, vidPid) => {
          const lower = String(name || '').toLowerCase();
          const checkVidPid = vidPid || '';
          
          // استبعاد Bluetooth و WiFi الواضحة فقط
          const bluetoothWifiKeywords = ['bluetooth', 'wifi', 'wlan'];
          if (bluetoothWifiKeywords.some(k => lower.includes(k))) return true;
          
          // استبعاد أجهزة الشبكة الواضحة
          if (lower.includes('network adapter') || lower.includes('ethernet adapter')) return true;
          
          // استبعاد device class الشبكية فقط
          const deviceClassLower = String(deviceClass || '').toLowerCase();
          if (deviceClassLower === 'net' || deviceClassLower === 'bluetooth') return true;
          
          return false;
        };

        const isMobileDevice = (name, vidPid) => {
          const lower = String(name || '').toLowerCase();
          
          // أسماء العلامات التجارية للأجهزة المحمولة
          const mobileBrands = [
            'huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'ipad', 'android',
            'oppo', 'vivo', 'realme', 'oneplus', 'honor', 'asus', 'lenovo',
            'lg', 'sony', 'htc', 'motorola', 'nokia', 'google', 'pixel'
          ];
          if (mobileBrands.some(b => lower.includes(b))) return true;
          
          // Vendor IDs الخاصة بالأجهزة المحمولة
          const mobileVids = [
            '2717', '18D1', '04E8', '05AC', '12D1', '0BB4',  // Huawei, Google, Samsung, Apple, HTC
            '22B8', '1004', '1BBB', '2001', '2A70'            // Motorola, LG, T&A, D-Link, OnePlus
          ];
          if (mobileVids.some(v => vidPid.includes(v))) return true;
          
          return false;
        };

        const isInternalDevice = (name, deviceId, deviceClass) => {
          const lowerName = String(name || '').toLowerCase();
          const lowerClass = String(deviceClass || '').toLowerCase();
          
          // استبعاد الأجهزة الداخلية الواضحة فقط
          const internalIndicators = [
            'root hub', 'usb root hub'
          ];
          for (const ind of internalIndicators) {
            if (lowerName.includes(ind)) return true;
          }
          
          // استبعاد patterns الأساسية في DeviceID
          if (deviceId) {
            const upperDeviceId = deviceId.toUpperCase();
            const excludedPatterns = [
              'ROOT_HUB', 'PCI\\', 'ACPI\\'
            ];
            for (const pattern of excludedPatterns) {
              if (upperDeviceId.includes(pattern)) return true;
            }
          }
          
          // استبعاد device classes الأساسية فقط
          if (['system', 'computer'].includes(lowerClass)) return true;
          
          return false;
        };

        const parsed = [];
        for (const item of data) {
          try {
            const vendor = (item.VendorID || '').toString().toLowerCase();
            const product = (item.ProductID || '').toString().toLowerCase();
            if (!(vendor && vendor.length === 4 && product && product.length === 4)) continue;

            const name = cleanDeviceName(item.Name || item.Name || 'Unknown Device');
            const vendorUpper = vendor.toUpperCase();
            const productUpper = product.toUpperCase();
            const vidPid = `${vendorUpper}:${productUpper}`;

            let serial = extractRealSerialNumberWindows(item);
            if (!serial) {
              // backend fallback serial format
              serial = `VID${vendorUpper}PID${productUpper}REV0001`;
            }

            // Apply filters: exclude only obviously-internal devices
            // تخفيف الفلاتر - نستبعد فقط الأجهزة الداخلية الواضحة جداً
            const deviceIdStr = item.DeviceID || item.device_id || '';
            const deviceClassName = item.Class || item.device_class || '';
            
            // استبعاد الأجهزة الداخلية الأساسية فقط
            if (isInternalDevice(name, deviceIdStr, deviceClassName)) {
              continue;
            }

            // Exclude fake vendor/product combinations
            if (isFakeDevice(vendorUpper.toLowerCase(), productUpper.toLowerCase(), name, serial)) {
              continue;
            }

            // لا نستبعد بناءً على LocationInformation - قد يكون فارغاً للأجهزة الحقيقية

            const fromRegistryDevice = {
              vendor_id: vendorUpper,
              product_id: productUpper,
              manufacturer: (item.Manufacturer || '').toString() || null,
              product: name,
              name: name,
              description: item.Description || '',
              service: item.Service || '',
              device_id: item.DeviceID || '',
              hardware_id: item.HardwareID || '',
              status: item.Status || 'Unknown',
              present: item.Present || true,
              device_class: item.Class || '',
              class_guid: item.ClassGuid || '',
              system: 'Windows',
              detected_at: new Date().toISOString(),
              serial_number: serial,
              from_registry: true,
              controllable: false
            };

            // فلترة نهائية مثل الباك اند:
            // استبعد أجهزة الشبكة/التواصل إلا إذا كانت أجهزة محمولة (موبايل/تابلت)
            const isNetwork = isNetworkCommunicationDevice(fromRegistryDevice.name, fromRegistryDevice.device_class, vidPid);
            const isMobile = isMobileDevice(fromRegistryDevice.name, vidPid);
            
            // اقبل الجهاز إذا:
            // 1. ليس جهاز شبكة/تواصل
            // 2. أو هو جهاز محمول (حتى لو كان يحتوي على خصائص اتصال)
            if (!isNetwork || isMobile) {
              parsed.push(fromRegistryDevice);
            }
          } catch (e) {
            // skip
          }
        }

        resolve(parsed);
      });
    });
  }

  async _tick() {
    if (this._isScanning) return;
    this._isScanning = true;

    try {
      const detected = await this._scanOnce();
      // إزالة دمج الأجهزة من registry لتجنب الأجهزة الوهمية غير المتصلة فعلياً
      // const registryDevices = await this._getRegistryUsbDevices();
      // merge registry-only devices (avoid duplicates)
      // const serialsDetected = new Set(detected.map(d => d.serial_number).filter(Boolean));
      // for (const rd of registryDevices) {
      //   if (rd.serial_number && !serialsDetected.has(rd.serial_number)) {
      //     // mark as discovered but non-controllable
      //     detected.push({ ...rd, controllable: false });
      //     serialsDetected.add(rd.serial_number);
      //   }
      // }
      
      // Filter by serial if available, otherwise by vendor/product tuple
      const toReport = [];

      for (const d of detected) {
        const key = d.serial_number || `${d.vendor_id}:${d.product_id}:${d.name || ''}`;
        if (!this._seenSerials.has(key)) {
          this._seenSerials.add(key);
          toReport.push(d);
        }
      }

      if (toReport.length > 0) {
        // report but do not attempt control
        await this._notifyServer(toReport);
      }

      // Emit full current list for UI if needed
      this.emit('scan', detected);

      // Keep _seenSerials trimmed to last 500 entries
      if (this._seenSerials.size > 500) {
        this._seenSerials = new Set(Array.from(this._seenSerials).slice(-500));
      }

    } catch (e) {
      // ignore
    } finally {
      this._isScanning = false;
    }
  }

  start() {
    if (this._timer) return;
    // initial immediate scan
    this._tick();
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    this.emit('started');
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      this.emit('stopped');
    }
  }
}

function startUsbDiscovery(opts = {}) {
  const disco = new UsbDiscovery(opts);
  disco.start();
  return disco;
}

module.exports = { startUsbDiscovery };
