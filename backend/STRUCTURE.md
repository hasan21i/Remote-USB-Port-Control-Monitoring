# بنية مشروع الـ Backend (STRUCTURE)

مستند مختصر يشرح شجرة الملفات ووظيفة كل ملف/مجلد في مجلد `backend/`.

---

## 🌳 شجرة الملفات (تفصيلية)

```
backend/
├─ .env                          # متغيرات البيئة (سرية)
├─ app.py                        # ملف الإقلاع (Flask app, blueprints, background tasks)
├─ base_model.py                 # تعريفات نموذج القاعدة الأساسية (SQLAlchemy)
├─ config/                       # ملفات إعدادات YAML
│  ├─ agent_config.yaml
│  ├─ network_config.yaml
│  └─ server_config.yaml
├─ config.py                     # تحميل إعدادات التطبيق من .env وملفات config
├─ controllers/                  # نقاط النهاية (REST API)
│  ├─ activation.py
│  ├─ ai_monitoring.py
│  ├─ alerts.py
│  ├─ analytics.py
│  ├─ auth.py
│  ├─ blockchain.py
│  ├─ dashboard.py
│  ├─ devices.py
│  ├─ logs.py                     # إدارة السجلات: /logs, /logs/simple, /logs/stats, clear endpoints
│  ├─ policies.py
│  ├─ reports.py                  # إنشاء/تصدير/قائمة التقارير
│  └─ servers.py
├─ extensions.py                 # تهيئة الامتدادات المشتركة (DB, SocketIO, JWT, Supabase client)
├─ install_requirements.py       # سكربت مساعد لتثبيت متطلبات التطوير
├─ logs/
│  └─ app.log                    # سجل التشغيل
├─ models.py                     # نماذج البيانات (SQLAlchemy / ORM)
├─ requirements.txt              # الاعتمادات (pip)
├─ services/                     # منطق الأعمال القابل لإعادة الاستخدام
│  ├─ ai_report_service.py        # توليد تقارير AI
│  ├─ alert_service.py
│  ├─ auth_service.py
│  ├─ blockchain_service.py
│  ├─ log_service.py
│  ├─ offline_service.py
│  ├─ policy_service.py
│  ├─ power_service.py
│  ├─ report_service.py
│  ├─ server_service.py
│  └─ usb_service.py
├─ supabase_config.py            # إعدادات Supabase خاصة بالخادم
├─ templates/
│  └─ index.html
├─ uploads/
│  └─ avatars/
├─ utils.py                      # دوال مساعدة عامة (timezones, json helpers...)
└─ __pycache__/
```

---

## 🔎 نظرة سريعة على الملفات الرئيسية

- `app.py`  
  - نقطة الدخول. يسجل الأزمنة، يبدأ الـ background threads، ويسجل الـ Blueprints من `controllers/`.

- `controllers/*.py`  
  - كل ملف مسؤول عن مجموعة routes محددة (مثال: `reports.py` يتعامل مع `/reports/generate`, `/reports/export-pdf/:id`).
  - راجع `logs.py` و `reports.py` إن أردت تتبع المشاكل المتعلقة بالسجلات والتقارير.

- `extensions.py`  
  - يهيئ `db` (SQLAlchemy session)، اتصال Supabase المشترك، JWT، SocketIO، إلخ.

- `services/`  
  - يحتوي منطق الأعمال المعقد (مثلاً: `ai_report_service.py` حيث يجري استدعاء موديلات الذكاء الصناعي وتهيئة المحتوى).

- `models.py`  
  - يتضمن مخططات الجداول الأساسية والقوائم المرجعية.

---

## 🚀 تشغيل الخادم محلياً (مختصر)

1. أنشئ env محلية (مثال `backend/.env`) واملأ القيم الضرورية:

```env
FLASK_ENV=development
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
JWT_SECRET_KEY=secret
DATABASE_URL=<postgres-conn-string>
```

2. ثبت المتطلبات:

```bash
python -m pip install -r requirements.txt
```

3. شغّل الخادم:

```bash
python app.py
# أو في وضع التطوير
FLASK_ENV=development python app.py
```

4. نقاط فحص سريعة:
- مراجعة `logs/app.log` عند وجود أخطاء.  
- اختبار endpoints: `/api/reports/generate`, `/api/logs`, `/api/logs/stats`.

---

## 🧪 اقتراحات للتحسين (خطوات مقترحة)

- أضف مجلد `tests/` مع اختبارات وحدة للـ controllers المهمة (`reports.py`, `logs.py`).
- أنشئ `README.md` مختصر يشرح المتغيرات والـ endpoints الأساسية.  
- أضف CI (GitHub Actions) لتشغيل linters و unit tests عند كل PR.
- فكّر في استخدام Pagination و Limits موحدة في جميع الـ endpoints التي تُرجع قوائم كبيرة.

---

## 📌 ملاحظات نهائية

إذا تريد، أقدر أُنجز أي مما يلي تلقائياً:
- توليد ملف `README.md` تحريضي للـ backend، أو
- إنشاء `backend/tests/test_logs.py` و `backend/tests/test_reports.py` مع بعض الاختبارات البسيطة، أو
- توليد توثيق endpoints (OpenAPI / Swagger) من الكود.

---

# بنية الواجهة (Frontend - React) — شجرة كاملة بكل الملفات

```
frontend/
├─ .env
├─ package.json
├─ package-lock.json
├─ public/
│  ├─ index.html
│  ├─ manifest.json
│  └─ styles/
├─ node_modules/
├─ build/ (generated)
├─ src/
│  ├─ index.jsx
│  ├─ index.js
│  ├─ App.jsx
│  ├─ backend_config.json
│  ├─ assets/
│  │  └─ logo.png.png
│  ├─ components/
│  │  ├─ AddSecondaryServerForm.jsx
│  │  ├─ AlertsTable.jsx
│  │  ├─ AlertsWidget.jsx
│  │  ├─ AttackTable.jsx
│  │  ├─ DeviceCard.jsx
│  │  ├─ DeviceControls.jsx
│  │  ├─ Footer.jsx
│  │  ├─ Header.jsx
│  │  ├─ HeartbeatBadge.jsx
│  │  ├─ HeartbeatChart.jsx
│  │  ├─ ImageCropper.jsx
│  │  ├─ LicenseStatus.jsx
│  │  ├─ LogTable.jsx
│  │  ├─ Modal.jsx
│  │  ├─ PendingDeviceModal.jsx
│  │  ├─ PolicyManager.jsx
│  │  ├─ PowerAnalytics.jsx
│  │  ├─ PowerSettings.jsx
│  │  ├─ ReportCard.jsx
│  │  ├─ SearchFilter.jsx
│  │  ├─ ServerCard.jsx
│  │  ├─ Sidebar.jsx
│  │  ├─ Spinner.jsx
│  │  └─ StatusBadge.jsx
│  ├─ pages/
│  │  ├─ Dashboard.jsx
│  │  ├─ Home.jsx
│  │  ├─ Login.jsx
│  │  ├─ Register.jsx
│  │  ├─ ForgotPassword.jsx
│  │  ├─ ResetPassword.jsx
│  │  ├─ analytics/
│  │  │  ├─ Ai-analysis.jsx
│  │  │  ├─ DetailedReport.jsx
│  │  │  ├─ Reports.jsx
│  │  │  ├─ Stats.jsx
│  │  │  └─ Stats_fixed.jsx
│  │  ├─ reports/
│  │  │  └─ ReportReader.jsx
│  │  ├─ monitoring/
│  │  │  ├─ Realtime.jsx
│  │  │  ├─ Logs.jsx
│  │  │  └─ Blockchain.jsx
│  │  ├─ servers/
│  │  │  ├─ ServerList.jsx
│  │  │  ├─ ServerHeartbeat.jsx
│  │  │  └─ ServerDetails.jsx
│  │  ├─ settings/
│  │  │  ├─ Users.jsx
│  │  │  ├─ System.jsx
│  │  │  ├─ Profile.jsx
│  │  │  ├─ HASettings.jsx
│  │  │  └─ Activation.jsx
│  │  ├─ security/
│  │  │  ├─ Blacklist.jsx
│  │  │  ├─ Whitelist.jsx
│  │  │  └─ Policies.jsx
│  │  ├─ devices/
│  │  │  ├─ Devicedetails.jsx
│  │  │  ├─ Devicescan.jsx
│  │  │  ├─ Devicelist.jsx
│  │  │  ├─ Compatibility.jsx
│  │  │  ├─ Adddevice.jsx
│  │  │  ├─ PowerMonitoring.jsx
│  │  │  └─ PortControl.jsx
│  │  └─ intrusions/
│  │     ├─ AttackList.jsx
│  │     ├─ AttackList_NEW.jsx
│  │     ├─ AttackDetails.jsx
│  │     ├─ AddNewAttack.jsx
│  │     └─ ConfirmAttack.jsx
│  ├─ utils/
│  │  ├─ api.js
│  │  ├─ auth.js
│  │  ├─ authCleaner.js
│  │  ├─ constants.js
│  │  ├─ formatter.js
│  │  ├─ formatters.js
│  │  ├─ healthCheck.js
│  │  ├─ passwordValidator.js
│  │  ├─ simpleAuth.js
│  │  ├─ test-exports.js
│  │  └─ validators.js
│  ├─ hooks/
│  │  ├─ useApi.js
│  │  ├─ useAttack.js
│  │  ├─ useAuth.js
│  │  ├─ useDevice.js
│  │  ├─ useHAMonitoring.js
│  │  ├─ useReport.js
│  │  ├─ useServer.js
│  │  ├─ useSocket.js
│  │  └─ useSocketEvent.js
│  ├─ context/
│  │  ├─ AppInfoContext.jsx
│  │  ├─ AuthContext.jsx
│  │  ├─ AttackContext.jsx
│  │  ├─ DeviceContext.jsx
│  │  ├─ ReportContext.jsx
│  │  ├─ ServerContext.jsx
│  │  └─ ThemeContext.jsx
│  ├─ locales/
│  │  ├─ ar/
│  │  │  └─ translation.json
│  │  └─ en/
│  │     └─ translation.json
│  ├─ styles/
│  │  ├─ main.css
│  │  ├─ components.css
│  │  ├─ home-responsive.css
│  │  ├─ devicescan.css
│  │  ├─ snake-slider.css
│  │  └─ utilities.css
│  └─ hooks-utils and misc files
└─ setupProxy.js
```

ملاحظات ومهام فنية:
- `src/utils/api.js` ملف مهم جداً: ينظم استدعاءات `/logs`, `/reports`, `/servers`, ويطبق fallback logic عند فشل الخادم.
- `backend_config.json` يُستخدم أثناء التطوير لتغيير عنوان الخادم بدون تعديل الكود.
- إن أردت، أستطيع توليد ملف `FRONTEND_README.md` يضم شرحًا لأي ملف/مكون أو كيفية تشغيل المشروع محليًا.

---

# بنية تطبيق الوكيل (USB-Agent-App - Electron/Node) — تفاصيل الملفات

```
USB-Agent-App/
├─ package.json
├─ preload.js
├─ main-updated.js (Electron main)
├─ index.js / App.jsx                 # واجهة التطبيق (React/Electron)
├─ usb_agent.js                       # Node wrapper for USB tasks
├─ usb_agent.py                       # Python helper communicating with hardware
├─ supabase_manager.js                # وظائف Supabase خاصة بالوكيل
├─ discovery-runner.js                # discovery logic / runner
├─ scripts/                           # build & release scripts
│  ├─ build-electron.sh
│  └─ package-release.sh
├─ public/                            # static html / assets
│  ├─ index.html
│  └─ index.css
├─ src/components/
│  ├─ DeviceList.jsx
│  ├─ DeviceManager.js
│  ├─ ServerConnection.js
│  └─ SystemInfo.js
├─ config/
│  └─ agent_config.yaml
├─ assets/
└─ requirements.txt                   # for Python parts
```

نقاط فنية:
- اتبع سياسة أمان عند فتح قنوات native (serial / usb) من Electron، استخدم `preload.js` لتقليل السطح المعرض.
- `supabase_manager.js` يمكن أن يدير تأمين المفاتيح ويُعيد المحاولات عند فقد الاتصال.
- أنشئ سكربت تثبيت موحّد يثبت المتطلبات Node وPython إن أردت توزيعات مُبسطة.


---

# بنية تطبيق الموبايل (Remot - Flutter) — شجرة كاملة بكل الملفات

```
remot/
├─ pubspec.yaml
├─ pubspec.lock
├─ lib/
│  ├─ main.dart
│  ├─ config/
│  │  ├─ app_theme.dart
│  │  └─ supabase_config.dart
│  ├─ models/
│  │  ├─ alert_model.dart
│  │  ├─ dashboard_stats.dart
│  │  ├─ device_model.dart
│  │  ├─ permission_model.dart
│  │  ├─ server_model.dart
│  │  └─ user_model.dart
│  ├─ providers/
│  │  ├─ auth_provider.dart
│  │  ├─ providers.dart
│  │  └─ theme_provider.dart
│  ├─ services/
│  │  ├─ api_service.dart
│  │  └─ supabase_service.dart
│  ├─ screens/
│  │  ├─ alerts_screen.dart
│  │  ├─ blacklist_whitelist_screen.dart
│  │  ├─ dashboard_screen.dart
│  │  ├─ devices_screen.dart
│  │  ├─ home_screen.dart
│  │  ├─ login_screen.dart
│  │  ├─ logs_screen.dart
│  │  ├─ onboarding_screen.dart
│  │  ├─ profile_screen.dart
│  │  ├─ register_screen.dart
│  │  ├─ servers_screen.dart
│  │  ├─ settings_screen.dart
│  │  └─ users_screen.dart
│  ├─ widgets/
│  │  ├─ common_widgets.dart
│  │  ├─ permission_widgets.dart
│  │  └─ widgets.dart
│  ├─ utils/
│  │  ├─ download_helper.dart
│  │  ├─ web_download.dart
│  │  └─ web_download_stub.dart
│  └─ screens.dart
├─ assets/
│  └─ images/
│     ├─ app_icon.png
│     └─ app_icon_foreground.png
│  └─ backend_config.json
├─ android/
├─ ios/
├─ web/
├─ windows/
├─ macos/
├─ linux/
├─ test/
└─ build/
```

ملاحظات تقنية:
- `lib/services/api_service.dart` ينفذ تعاملات الـ HTTP مع الـ backend ويحتوي على منطق fallback إلى Supabase.
- `lib/services/supabase_service.dart` يدير تهيئة Supabase وقراءة `assets/backend_config.json` وملف تعديل في مجلد المستندات.
- أستطيع إضافة `REMOT_README.md` يشرح خطوات البناء (مثل `flutter build apk --release`) في حال رغبت بذلك.


---

اختر أي قسم تريد أن أُدرج فيه مزيدًا من التفاصيل (مثلاً: قائمة كاملة بالملفات في `src/pages/`، أو شرح `supabase_manager.js` في الـ Agent) أو أريد إنشاء ملفات README لكل مشروع فرعي (frontend / USB-Agent-App / remot).
