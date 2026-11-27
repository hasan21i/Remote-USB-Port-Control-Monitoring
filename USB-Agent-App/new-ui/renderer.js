const { ipcRenderer } = require('electron');

// عناصر الواجهة
const devicesTableBody = document.getElementById('devicesTableBody');
const emptyRow = document.getElementById('emptyRow');
const themeToggle = document.getElementById('themeToggle');
const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');

// قائمة الأجهزة لتجنب التكرار في العرض
let currentDevices = new Map();
let systemLogs = [];

// شاشات الانتقال
const splashScreen = document.getElementById('splash-screen');
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const startBtn = document.getElementById('startBtn');
const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginErrorMsg = document.getElementById('loginErrorMsg');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const serverStatusText = document.getElementById('serverStatusText');
const dbStatusText = document.getElementById('dbStatusText');

// عند الضغط على ابدأ
startBtn.addEventListener('click', async () => {
    // التحقق مما إذا كان مسجلاً مسبقاً (اختياري)
    splashScreen.classList.remove('active-overlay');
    loginScreen.classList.add('active-overlay');
});

// عند تقديم فورم الدخول
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErrorMsg.textContent = '';
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'جاري التحقق...';

    const email = emailInput.value;
    const password = passwordInput.value;

    try {
        const result = await ipcRenderer.invoke('login', { email, password });
        if (result.success) {
            loginScreen.classList.remove('active-overlay');
            appContainer.style.display = 'flex';
            
            serverStatusText.textContent = 'متصل (نشط)';
            serverStatusText.style.color = 'var(--accent-gold)';
            dbStatusText.textContent = 'متصل';
            dbStatusText.style.color = 'var(--accent-gold)';
            
            fetchInitialDevices();
        } else {
            loginErrorMsg.textContent = result.message || 'فشل تسجيل الدخول. تأكد من البيانات.';
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = 'تسجيل الدخول';
        }
    } catch (err) {
        loginErrorMsg.textContent = 'حدث خطأ في الاتصال بالخادم.';
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = 'تسجيل الدخول';
    }
});

// التعامل مع الأقسام (Tabs)
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.dashboard');

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        const targetId = item.getAttribute('data-target');
        sections.forEach(sec => sec.style.display = 'none');
        document.getElementById(targetId).style.display = 'block';
    });
});

// سجل الأحداث
const logsTableBody = document.getElementById('logsTableBody');
const emptyLogsRow = document.getElementById('emptyLogsRow');

function addLog(action, details) {
    if (systemLogs.length === 0) {
        logsTableBody.innerHTML = '';
    }
    
    const time = new Date().toLocaleTimeString('ar-IQ');
    systemLogs.unshift({ time, action, details });
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td style="direction: ltr; text-align: left;">${time}</td>
        <td><span class="badge ${action === 'حظر' ? 'badge-blocked' : 'badge-allowed'}">${action}</span></td>
        <td>${details}</td>
    `;
    logsTableBody.prepend(tr);
}

// التعامل مع الثيمات (Dark/Light Mode)
function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    html.setAttribute('data-theme', newTheme);
    
    if (newTheme === 'dark') {
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
    } else {
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
    }
}

themeToggle.addEventListener('click', toggleTheme);

// تحديث جدول الأجهزة
function renderDevices() {
    if (currentDevices.size === 0) {
        devicesTableBody.innerHTML = '';
        devicesTableBody.appendChild(emptyRow);
        return;
    }

    devicesTableBody.innerHTML = '';
    
    currentDevices.forEach(device => {
        const tr = document.createElement('tr');
        
        // معرف الجهاز
        const tdId = document.createElement('td');
        tdId.textContent = `${device.vendorId}:${device.productId}`;
        tdId.style.direction = 'ltr';
        tdId.style.textAlign = 'left';
        tdId.style.fontFamily = 'monospace';
        
        // الاسم
        const tdName = document.createElement('td');
        tdName.textContent = device.name || 'USB Device';

        // الفئة
        const tdClass = document.createElement('td');
        tdClass.textContent = device.device_class !== undefined ? device.device_class : (device.deviceClass !== undefined ? device.deviceClass : 'Unknown');

        // الحالة
        const tdStatus = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = device.isBlocked ? 'badge badge-blocked' : 'badge badge-allowed';
        badge.textContent = device.isBlocked ? 'محظور (آمن)' : 'مسموح';
        tdStatus.appendChild(badge);
        
        tr.appendChild(tdId);
        tr.appendChild(tdName);
        tr.appendChild(tdClass);
        tr.appendChild(tdStatus);
        
        devicesTableBody.appendChild(tr);
    });
}

// استقبال أحداث الـ USB من العمليات الخلفية
ipcRenderer.on('usb-event', (event, { device, action }) => {
    if (action === 'added') {
        // افتراضياً عند إضافته نقوم بإظهاره كـ "جاري الفحص" أو "محظور" لأن النظام سيحظره
        device.isBlocked = true;
        currentDevices.set(device.id, device);
        addLog('اكتشاف', `تم توصيل جهاز: ${device.vendorId}:${device.productId}`);
    } else if (action === 'removed') {
        currentDevices.delete(device.id);
        addLog('إزالة', `تم فصل جهاز: ${device.vendorId}:${device.productId}`);
    }
    renderDevices();
});

// استقبال تأكيد الحظر
ipcRenderer.on('device-blocked', (event, device) => {
    if (currentDevices.has(device.id)) {
        currentDevices.get(device.id).isBlocked = true;
        addLog('حظر', `تم حظر جهاز: ${device.id}`);
        renderDevices();
    }
});

// جلب الأجهزة عند بدء التشغيل
async function fetchInitialDevices() {
    const devices = await ipcRenderer.invoke('get-devices');
    devices.forEach(dev => {
        dev.isBlocked = false; // افتراضياً المتصلة مسبقاً مسموحة حتى نتحقق، أو يمكن تغييرها
        currentDevices.set(dev.id, dev);
    });
    renderDevices();
}

// البدء لا يستدعي الأجهزة فوراً بل ينتظر الدخول
// fetchInitialDevices();
