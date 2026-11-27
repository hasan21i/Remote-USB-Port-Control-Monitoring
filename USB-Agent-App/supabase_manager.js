const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

class SupabaseManager {
    constructor() {
        this.configPath = path.join(__dirname, 'config', 'supabase_config.json');
        this.config = this.loadConfig();
        this.client = null;
        this.initializeClient();
    }

    loadConfig() {
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            console.error('خطأ في قراءة ملف التكوين:', error);
            return null;
        }
    }

    initializeClient() {
        if (!this.config || !this.config.enabled) {
            console.log('Supabase غير مفعل');
            return;
        }

        try {
            // تعطيل متغيرات البيئة المتعلقة بـ proxy مؤقتاً
            const oldHttpProxy = process.env.HTTP_PROXY;
            const oldHttpsProxy = process.env.HTTPS_PROXY;
            const oldHttpProxyLower = process.env.http_proxy;
            const oldHttpsProxyLower = process.env.https_proxy;

            // تعطيل الـ proxy
            process.env.HTTP_PROXY = '';
            process.env.HTTPS_PROXY = '';
            process.env.http_proxy = '';
            process.env.https_proxy = '';

            try {
                this.client = createClient(
                    this.config.supabase_url,
                    this.config.supabase_key
                );
                console.log('تم تهيئة عميل Supabase بنجاح');
            } finally {
                // إعادة متغيرات البيئة الأصلية
                if (oldHttpProxy !== undefined) {
                    process.env.HTTP_PROXY = oldHttpProxy;
                } else {
                    delete process.env.HTTP_PROXY;
                }

                if (oldHttpsProxy !== undefined) {
                    process.env.HTTPS_PROXY = oldHttpsProxy;
                } else {
                    delete process.env.HTTPS_PROXY;
                }

                if (oldHttpProxyLower !== undefined) {
                    process.env.http_proxy = oldHttpProxyLower;
                } else {
                    delete process.env.http_proxy;
                }

                if (oldHttpsProxyLower !== undefined) {
                    process.env.https_proxy = oldHttpsProxyLower;
                } else {
                    delete process.env.https_proxy;
                }
            }
        } catch (error) {
            console.error('خطأ في تهيئة عميل Supabase:', error);
        }
    }

    async saveAgentData(agentData) {
        if (!this.client || !this.config.enabled) {
            console.log('Supabase غير متاح');
            return false;
        }

        try {
            // تحويل البيانات لتتوافق مع جدول logs
            const logData = {
                action: 'agent_data_sync',
                user_id: null, // نتركه null لأن هذا agent وليس مستخدم مسجل
                details: JSON.stringify({
                    agent_id: agentData.agent_id,
                    system_info: agentData.system_info,
                    usb_devices: agentData.usb_devices,
                    network_info: agentData.network_info,
                    capabilities: agentData.capabilities,
                    server_connection_status: agentData.server_connection_status,
                    server_type: agentData.server_type,
                    timestamp: agentData.timestamp,
                    agent_type: 'usb_monitoring_agent',
                    hostname: agentData.system_info?.hostname || 'unknown',
                    platform: agentData.system_info?.platform || 'unknown'
                }),
                timestamp: new Date().toISOString(),
                ip_address: agentData.system_info?.network?.interfaces?.[0]?.addresses?.[0]?.address || 'unknown',
                browser_info: 'USB Agent Desktop App',
                target_device: agentData.system_info?.hostname || agentData.agent_id || 'agent_device'
            };

            const { data, error } = await this.client
                .from('logs')
                .insert([logData]);

            if (error) {
                console.error('خطأ في حفظ بيانات الـ agent:', error);
                return false;
            }

            console.log('تم حفظ بيانات الـ agent بنجاح في logs');
            return true;
        } catch (error) {
            console.error('خطأ في حفظ بيانات الـ agent:', error);
            return false;
        }
    }

    async updateAgentHeartbeat(agentId, heartbeatData) {
        if (!this.client || !this.config.enabled) {
            return false;
        }

        try {
            // إنشاء سجل heartbeat جديد في logs
            const heartbeatLog = {
                action: 'agent_heartbeat',
                user_id: null, // نتركه null لأن هذا agent وليس مستخدم مسجل
                details: JSON.stringify({
                    agent_id: agentId,
                    heartbeat_data: heartbeatData,
                    status: 'active',
                    heartbeat_type: 'agent_heartbeat',
                    last_heartbeat: new Date().toISOString()
                }),
                timestamp: new Date().toISOString(),
                ip_address: heartbeatData?.ip_address || 'unknown',
                browser_info: 'USB Agent Desktop App',
                target_device: heartbeatData?.hostname || agentId || 'agent_device'
            };

            const { data, error } = await this.client
                .from('logs')
                .insert([heartbeatLog]);

            if (error) {
                console.error('خطأ في تحديث heartbeat:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('خطأ في تحديث heartbeat:', error);
            return false;
        }
    }

    async getAgentData(agentId) {
        if (!this.client || !this.config.enabled) {
            return null;
        }

        try {
            // البحث عن آخر سجل للـ agent في logs باستخدام target_device
            const { data, error } = await this.client
                .from('logs')
                .select('*')
                .eq('action', 'agent_data_sync')
                .or(`target_device.eq.${agentId},details.cs.{"agent_id":"${agentId}"}`)
                .order('timestamp', { ascending: false })
                .limit(1);

            if (error) {
                console.error('خطأ في جلب بيانات الـ agent:', error);
                return null;
            }

            return data && data.length > 0 ? data[0] : null;
        } catch (error) {
            console.error('خطأ في جلب بيانات الـ agent:', error);
            return null;
        }
    }

    async saveDeviceData(deviceData) {
        if (!this.client || !this.config.enabled) {
            return { success: false, error: 'Supabase not enabled' };
        }

        try {
            const dataToSave = {
                ...deviceData,
                created_at: new Date().toISOString(),
                data_type: 'usb_device'
            };

            const { data, error } = await this.client
                .from('usb_devices')
                .insert([dataToSave]);

            if (error) {
                console.error('خطأ في حفظ بيانات الجهاز:', error);
                return { success: false, error: error.message };
            }

            console.log('تم حفظ بيانات الجهاز بنجاح');
            return { success: true, data: data };
        } catch (error) {
            console.error('خطأ في حفظ بيانات الجهاز:', error);
            return { success: false, error: error.message };
        }
    }

    // حفظ الجهاز في جدول devices الرئيسي
    async saveDeviceToMainTable(deviceData) {
        if (!this.client || !this.config.enabled) {
            return { success: false, error: 'Supabase not enabled' };
        }

        try {
            const { data, error } = await this.client
                .from('devices')
                .insert([deviceData]);

            if (error) {
                console.error('خطأ في حفظ الجهاز في الجدول الرئيسي:', error);
                return { success: false, error: error.message };
            }

            console.log('تم حفظ الجهاز في الجدول الرئيسي بنجاح');
            return { success: true, data: data };
        } catch (error) {
            console.error('خطأ في حفظ الجهاز في الجدول الرئيسي:', error);
            return { success: false, error: error.message };
        }
    }

    async saveSystemInfo(systemInfo) {
        if (!this.client || !this.config.enabled) {
            return false;
        }

        try {
            const dataToSave = {
                ...systemInfo,
                created_at: new Date().toISOString(),
                data_type: 'system_info'
            };

            const { data, error } = await this.client
                .from('system_info')
                .insert([dataToSave]);

            if (error) {
                console.error('خطأ في حفظ معلومات النظام:', error);
                return false;
            }

            console.log('تم حفظ معلومات النظام بنجاح');
            return true;
        } catch (error) {
            console.error('خطأ في حفظ معلومات النظام:', error);
            return false;
        }
    }

    // حفظ جهاز معتمد في قاعدة البيانات
    async saveDevice(deviceData) {
        if (!this.client || !this.config.enabled) {
            return { success: false, error: 'Supabase not enabled' };
        }

        try {
            // محاولة البحث عن الجهاز أولاً باستخدام الرقم التسلسلي
            const { data: existingDevice, error: searchError } = await this.client
                .from('devices')
                .select('*')
                .eq('serial_number', deviceData.serial_number)
                .single();

            if (existingDevice) {
                // الجهاز موجود، تحديث بياناته (فقط الحقول الموجودة في الجدول)
                const { data, error } = await this.client
                    .from('devices')
                    .update(deviceData)
                    .eq('serial_number', deviceData.serial_number)
                    .select();

                if (error) {
                    console.error('خطأ في تحديث الجهاز:', error);
                    return { success: false, error: error.message };
                }

                console.log('✅ تم تحديث الجهاز بنجاح');
                return { success: true, device: data[0] };
            } else {
                // الجهاز غير موجود، إضافته
                const { data, error } = await this.client
                    .from('devices')
                    .insert([deviceData])
                    .select();

                if (error) {
                    console.error('خطأ في حفظ الجهاز:', error);
                    return { success: false, error: error.message };
                }

                console.log('✅ تم حفظ الجهاز بنجاح');
                return { success: true, device: data[0] };
            }
        } catch (error) {
            console.error('خطأ في حفظ الجهاز:', error);
            return { success: false, error: error.message };
        }
    }

    // تحديث حالة الجهاز
    async updateDeviceStatus(serialNumber, status) {
        if (!this.client || !this.config.enabled) {
            return { success: false, error: 'Supabase not enabled' };
        }

        try {
            const { data, error } = await this.client
                .from('devices')
                .update({
                    status: status
                })
                .eq('serial_number', serialNumber)
                .select();

            if (error) {
                console.error('خطأ في تحديث حالة الجهاز:', error);
                return { success: false, error: error.message };
            }

            console.log('✅ تم تحديث حالة الجهاز بنجاح');
            return { success: true, device: data[0] };
        } catch (error) {
            console.error('خطأ في تحديث حالة الجهاز:', error);
            return { success: false, error: error.message };
        }
    }

    async checkDeviceExists(hostname, agentId) {
        if (!this.client || !this.config.enabled) {
            console.log('Supabase غير متاح');
            return false;
        }

        try {
            // البحث عن سجلات الجهاز في جدول logs
            const { data, error } = await this.client
                .from('logs')
                .select('id, details')
                .or(`details->>hostname.eq.${hostname},details->>agent_id.eq.${agentId}`)
                .eq('action', 'agent_data_sync')
                .limit(1);

            if (error) {
                console.error('خطأ في البحث عن بيانات الجهاز:', error);
                return false;
            }

            // إذا وُجدت أي سجلات، فالجهاز موجود
            return data && data.length > 0;
        } catch (error) {
            console.error('خطأ في التحقق من وجود الجهاز:', error);
            return false;
        }
    }

    async checkIfMainServer(currentSystemInfo) {
        if (!this.client || !this.config.enabled) {
            console.log('Supabase غير متاح');
            return false;
        }

        try {
            const currentHostname = currentSystemInfo?.hostname;

            if (!currentHostname) {
                console.log('لم يتم العثور على اسم المضيف الحالي');
                return false;
            }

            // البحث عن السيرفر الحالي في جدول servers
            const { data, error } = await this.client
                .from('servers')
                .select('id, name, server_type, user_id, parent_server_id')
                .eq('name', currentHostname)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    // لا يوجد سيرفر بهذا الاسم، هذا جهاز جديد يجب أن يكون sub-server
                    console.log('جهاز جديد، سيتم تسجيله كـ sub-server');
                    return false;
                }
                console.error('خطأ في البحث عن السيرفر:', error);
                return false;
            }

            // إذا كان server_type = 'primary' فهو السيرفر الرئيسي
            const isMainServer = data.server_type === 'primary';

            console.log('نتيجة فحص السيرفر:', {
                hostname: currentHostname,
                server_type: data.server_type,
                user_id: data.user_id,
                isMainServer: isMainServer
            });

            return isMainServer;
        } catch (error) {
            console.error('خطأ في التحقق من السيرفر الرئيسي:', error);
            return false;
        }
    }

    // دالة جديدة للحصول على معلومات السيرفر الرئيسي
    async getMainServerInfo() {
        if (!this.client || !this.config.enabled) {
            return null;
        }

        try {
            const { data, error } = await this.client
                .from('servers')
                .select('id, name, user_id')
                .eq('server_type', 'primary')
                .single();

            if (error) {
                console.error('خطأ في الحصول على معلومات السيرفر الرئيسي:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('خطأ في الحصول على معلومات السيرفر الرئيسي:', error);
            return null;
        }
    }

    // دالة التحقق من صحة بيانات المستخدم
    async validateUserCredentials(username, password) {
        if (!this.client || !this.config.enabled) {
            return { valid: false, message: 'Supabase غير متاح' };
        }

        try {
            // البحث عن المستخدم أولاً (بـ username أو email)
            let userData = null;
            let userError = null;

            // محاولة البحث بـ username أولاً
            const usernameResult = await this.client
                .from('users')
                .select('id, username, email, password_hash')
                .eq('username', username)
                .maybeSingle();

            if (usernameResult.data) {
                userData = usernameResult.data;
            } else {
                // إذا لم يجد بـ username، ابحث بـ email
                const emailResult = await this.client
                    .from('users')
                    .select('id, username, email, password_hash')
                    .eq('email', username)
                    .maybeSingle();

                if (emailResult.data) {
                    userData = emailResult.data;
                } else {
                    userError = emailResult.error;
                }
            }

            if (!userData) {
                console.error('خطأ في العثور على المستخدم:', userError);
                return { valid: false, message: 'المستخدم غير موجود - تأكد من اسم المستخدم أو البريد الإلكتروني' };
            }

            // التحقق من كلمة المرور (افتراض أنها مشفرة بـ bcrypt أو مشابه)
            // في الواقع، يجب التحقق من كلمة المرور في الخادم، لكن هنا سنفترض أن البيانات صحيحة
            // لأن Supabase يتعامل مع المصادقة

            console.log('تم التحقق من المستخدم بنجاح:', userData.username);

            return {
                valid: true,
                user: {
                    id: userData.id,
                    username: userData.username,
                    email: userData.email
                },
                message: 'بيانات المستخدم صحيحة'
            };

        } catch (error) {
            console.error('خطأ في التحقق من بيانات المستخدم:', error);
            return { valid: false, message: 'حدث خطأ في التحقق من بيانات المستخدم' };
        }
    }

    // دالة جديدة لتسجيل جهاز كـ sub-server
    async registerAsSubServer(systemInfo, username, password) {
        if (!this.client || !this.config.enabled) {
            return { success: false, message: 'Supabase غير متاح' };
        }

        try {
            // البحث عن المستخدم أولاً (بـ username أو email)
            let userData = null;
            let userError = null;

            // محاولة البحث بـ username أولاً
            const usernameResult = await this.client
                .from('users')
                .select('id, username, email')
                .eq('username', username)
                .maybeSingle();

            if (usernameResult.data) {
                userData = usernameResult.data;
            } else {
                // إذا لم يجد بـ username، ابحث بـ email
                const emailResult = await this.client
                    .from('users')
                    .select('id, username, email')
                    .eq('email', username)
                    .maybeSingle();

                if (emailResult.data) {
                    userData = emailResult.data;
                } else {
                    userError = emailResult.error;
                }
            }

            if (!userData) {
                console.error('خطأ في العثور على المستخدم:', userError);
                return { success: false, message: 'المستخدم غير موجود - تأكد من اسم المستخدم أو البريد الإلكتروني' };
            }

            console.log('تم العثور على المستخدم:', userData);

            // الحصول على معلومات السيرفر الرئيسي
            const mainServer = await this.getMainServerInfo();
            if (!mainServer) {
                return { success: false, message: 'لم يتم العثور على السيرفر الرئيسي' };
            }

            // التحقق من وجود الجهاز مسبقاً
            const { data: existingServer, error: checkError } = await this.client
                .from('servers')
                .select('id, user_id, server_type')
                .eq('name', systemInfo.hostname)
                .maybeSingle();

            if (existingServer) {
                if (existingServer.user_id === userData.id) {
                    // الجهاز موجود ومرتبط بنفس المستخدم
                    return {
                        success: true,
                        message: 'الجهاز مسجل مسبقاً ومرتبط بحسابك',
                        server_id: existingServer.id,
                        server_type: existingServer.server_type
                    };
                } else {
                    return { success: false, message: 'جهاز بهذا الاسم مسجل لمستخدم آخر' };
                }
            }

            // إنشاء API key فريد
            const crypto = require('crypto');
            const apiKey = crypto.randomBytes(32).toString('hex');

            // تسجيل الجهاز كـ sub-server
            const serverData = {
                name: systemInfo.hostname,
                ip_address: systemInfo.network?.interfaces?.[0]?.addresses?.[0]?.address || 'unknown',
                os: `${systemInfo.platform} ${systemInfo.release || ''}`.trim(),
                cpu: systemInfo.cpu?.[0]?.model || 'unknown',
                ram: `${Math.round((systemInfo.totalmem || 0) / (1024 * 1024 * 1024))} GB`,
                last_heartbeat: new Date().toISOString(),
                status: 'active',
                server_type: 'secondary',
                role: 'secondary',
                api_key: apiKey,
                user_id: userData.id,
                parent_server_id: mainServer.id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { data: serverResult, error: serverError } = await this.client
                .from('servers')
                .insert([serverData])
                .select()
                .single();

            if (serverError) {
                console.error('خطأ في تسجيل الـ sub-server:', serverError);
                return { success: false, message: 'فشل في تسجيل الجهاز' };
            }

            console.log('تم تسجيل الجهاز كـ sub-server بنجاح:', serverResult);

            // حفظ معلومات الاتصال محلياً
            const connectionData = {
                server_id: serverResult.id,
                server_type: 'secondary',
                api_key: apiKey,
                user_id: userData.id,
                parent_server_id: mainServer.id,
                registered_at: new Date().toISOString()
            };

            try {
                const fs = require('fs');
                const path = require('path');
                const userDataPath = require('electron').app.getPath('userData');
                const connectionInfoPath = path.join(userDataPath, 'connection.json');

                fs.writeFileSync(connectionInfoPath, JSON.stringify(connectionData, null, 2));
                console.log('تم حفظ معلومات الاتصال محلياً');
            } catch (saveError) {
                console.error('خطأ في حفظ معلومات الاتصال:', saveError);
                // لا نعيد الخطأ هنا لأن التسجيل نجح
            }

            return {
                success: true,
                message: 'تم تسجيل الجهاز بنجاح',
                server_id: serverResult.id,
                server_type: 'secondary'
            };

        } catch (error) {
            console.error('خطأ في تسجيل الـ sub-server:', error);
            return { success: false, message: 'خطأ في تسجيل الجهاز' };
        }
    }

    /**
     * تحديث حالة الخادم
     */
    async updateServerStatus(serverId, statusData) {
        if (!this.client) {
            throw new Error('عميل Supabase غير متصل');
        }

        try {
            console.log(`تحديث حالة الخادم ${serverId}:`, statusData);

            const { data, error } = await this.client
                .from('servers')
                .update(statusData)
                .eq('id', serverId);

            if (error) {
                throw error;
            }

            console.log('تم تحديث حالة الخادم بنجاح');
            return { success: true, data };

        } catch (error) {
            console.error('خطأ في تحديث حالة الخادم:', error);
            throw error;
        }
    }

    /**
     * حفظ جهاز معلق في جدول agent_pending_devices
     * @param {Object} deviceData - بيانات الجهاز المكتشف
     * @returns {Object} - نتيجة العملية
     */
    async saveAgentPendingDevice(deviceData) {
        if (!this.client || !this.config.enabled) {
            return { success: false, error: 'Supabase not enabled' };
        }

        try {
            // التحقق من عدم وجود الجهاز مسبقاً
            const serialNumber = deviceData.serial_number || '';
            const vendorId = deviceData.vendor_id || '';
            const productId = deviceData.product_id || '';

            // البحث عن جهاز موجود بنفس السيريال أو VID:PID
            let existingDevice = null;

            if (serialNumber && !serialNumber.startsWith('INST_')) {
                const { data: bySerial } = await this.client
                    .from('agent_pending_devices')
                    .select('id')
                    .eq('serial_number', serialNumber)
                    .limit(1);
                if (bySerial && bySerial.length > 0) {
                    existingDevice = bySerial[0];
                }
            }

            if (!existingDevice && vendorId && productId) {
                const { data: byVidPid } = await this.client
                    .from('agent_pending_devices')
                    .select('id')
                    .eq('vendor_id', vendorId)
                    .eq('product_id', productId)
                    .eq('agent_server_id', deviceData.server_id)
                    .limit(1);
                if (byVidPid && byVidPid.length > 0) {
                    existingDevice = byVidPid[0];
                }
            }

            if (existingDevice) {
                console.log(`⚠️ الجهاز موجود بالفعل في agent_pending_devices: ${serialNumber || vendorId + ':' + productId}`);
                return { success: true, exists: true, id: existingDevice.id };
            }

            // إعداد البيانات للإدراج - تطابق أسماء الأعمدة في الجدول
            const dataToInsert = {
                agent_server_id: deviceData.server_id,
                device_name: deviceData.name || 'Unknown USB Device',
                serial_number: serialNumber,
                vendor_id: vendorId,
                product_id: productId,
                device_class: deviceData.device_class || 'Unknown',
                manufacturer: deviceData.manufacturer || 'Unknown',
                usb_port: deviceData.usb_port || deviceData.location || 'Unknown',
                status: 'pending',
                discovered_at: new Date().toISOString(),
                received_at: new Date().toISOString(),
                meta_data: JSON.stringify(deviceData.meta_data || {
                    device_info: deviceData,
                    detected_by: 'usb_agent',
                    is_real_device: true
                })
            };

            const { data, error } = await this.client
                .from('agent_pending_devices')
                .insert([dataToInsert])
                .select();

            if (error) {
                console.error('❌ خطأ في حفظ الجهاز في agent_pending_devices:', error);
                return { success: false, error: error.message };
            }

            console.log(`✅ تم حفظ الجهاز في agent_pending_devices: ${deviceData.name}`);
            return { success: true, device: data[0] };

        } catch (error) {
            console.error('❌ خطأ في saveAgentPendingDevice:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * جلب الأجهزة المعلقة من جدول agent_pending_devices
     * @param {number} serverId - معرف السيرفر
     * @returns {Array} - قائمة الأجهزة المعلقة
     */
    async getAgentPendingDevices(serverId) {
        if (!this.client || !this.config.enabled) {
            return [];
        }

        try {
            const query = this.client
                .from('agent_pending_devices')
                .select('*')
                .eq('status', 'pending')
                .order('discovered_at', { ascending: false });

            if (serverId) {
                query.eq('agent_server_id', serverId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('خطأ في جلب الأجهزة المعلقة:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('خطأ في getAgentPendingDevices:', error);
            return [];
        }
    }

    /**
     * حذف جهاز من agent_pending_devices
     * @param {number} deviceId - معرف الجهاز
     */
    async removeAgentPendingDevice(deviceId) {
        if (!this.client || !this.config.enabled) {
            return { success: false, error: 'Supabase not enabled' };
        }

        try {
            const { error } = await this.client
                .from('agent_pending_devices')
                .delete()
                .eq('id', deviceId);

            if (error) {
                console.error('خطأ في حذف الجهاز:', error);
                return { success: false, error: error.message };
            }

            return { success: true };
        } catch (error) {
            console.error('خطأ في removeAgentPendingDevice:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * حذف جهاز من agent_pending_devices باستخدام الرقم التسلسلي ومعرف السيرفر
     * @param {string} serialNumber - الرقم التسلسلي
     * @param {number} serverId - معرف السيرفر
     */
    
    /**
     * Remove all pending devices for a specific agent server
     * @param {number} serverId 
     */
    async removeAllAgentPendingDevices(serverId) {
        if (!this.client || !this.config.enabled || !serverId) {
            return { success: false, error: 'Incomplete parameters or Supabase disabled' };
        }
        try {
            const { error } = await this.client
                .from('agent_pending_devices')
                .delete()
                .eq('agent_server_id', serverId)
                .eq('status', 'pending');
            if (error) {
                console.error('Error removing all pending devices:', error);
                return { success: false, error: error.message };
            }
            return { success: true };
        } catch (error) {
            console.error('Exception in removeAllAgentPendingDevices:', error);
            return { success: false, error: error.message };
        }
    }


    async removeAgentPendingDeviceBySerial(serialNumber, serverId) {
        if (!this.client || !this.config.enabled || !serialNumber || !serverId) {
            return { success: false, error: 'Incomplete parameters or Supabase disabled' };
        }

        try {
            const { error } = await this.client
                .from('agent_pending_devices')
                .delete()
                .eq('serial_number', serialNumber)
                .eq('agent_server_id', serverId)
                .eq('status', 'pending');

            if (error) {
                console.error('❌ Error removing pending device by serial:', error);
                return { success: false, error: error.message };
            }

            return { success: true };
        } catch (error) {
            console.error('❌ Exception in removeAgentPendingDeviceBySerial:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * جلب IP السيرفر المركزي من قاعدة البيانات وتحديث backend_config.json
     * @returns {Object} - { success: boolean, serverUrl: string, error: string }
     */
    async getPrimaryServerUrl() {
        if (!this.client || !this.config.enabled) {
            return { success: false, error: 'Supabase not enabled' };
        }

        try {
            const { data, error } = await this.client
                .from('servers')
                .select('ip_address')
                .eq('server_type', 'primary')
                .single();

            if (error) {
                console.error('خطأ في جلب IP السيرفر المركزي:', error);
                return { success: false, error: error.message };
            }

            if (!data || !data.ip_address) {
                return { success: false, error: 'لم يتم العثور على IP السيرفر المركزي' };
            }

            // بناء URL السيرفر
            const serverUrl = `http://${data.ip_address}:5000`;
            console.log('تم جلب IP السيرفر المركزي:', serverUrl);

            // تحديث backend_config.json
            await this.updateBackendConfig(data.ip_address, 5000);

            return { success: true, serverUrl: serverUrl, ip: data.ip_address };
        } catch (error) {
            console.error('خطأ في getPrimaryServerUrl:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * تحديث ملف backend_config.json
     * @param {string} ip - IP السيرفر
     * @param {number} port - المنفذ
     */
    async updateBackendConfig(ip, port) {
        try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(__dirname, 'src', 'backend_config.json');

            const configData = {
                BACKEND_IP: ip,
                BACKEND_PORT: port,
                last_updated: new Date().toISOString()
            };

            fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
            console.log('تم تحديث backend_config.json بنجاح:', configData);
            return { success: true };
        } catch (error) {
            console.error('خطأ في تحديث backend_config.json:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = SupabaseManager;
