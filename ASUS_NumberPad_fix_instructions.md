# إصلاح مشكلة ASUS Number Pad (Code 19) - خطوات وأوامر مبسطة ⚙️

> هذا الملف يحتوي على خطوات منظمة وأوامر يمكنك تنفيذها بنفسك إذا ظهرت مشكلة مشابهة في المستقبل. اقرأ التحذيرات قبل أي تعديل على الريجستري أو حذف تعريفات.

---

## قبل البدء - تحذيرات وسلامة 🔒
- **مهم جدًا:** نفّذ الأوامر في PowerShell أو Command Prompt بصلاحيات المسؤول (Run as Administrator).
- **اصنع نقطة استعادة للنظام** قبل أي تغييرات على التعريفات أو الريجستري.
  - من واجهة Windows: افتح "Create a restore point" وصنع نقطة جديدة.
  - أو في PowerShell (كمسؤول):

```powershell
Checkpoint-Computer -Description "Before ASUS driver removal" -RestorePointType "APPLICATION_INSTALL"
```

---

## الأوامر التي نُفذت بعد موافقتك ✅

1. محاولة إنشاء نقطة استعادة (فشلت):

```powershell
wmic.exe /Namespace:\\root\default Path SystemRestore Call CreateRestorePoint "Before ASUS driver removal", 100, 7
# النتيجة: فشل (Invalid format)
```

2. محاولة إنشاء نقطة استعادة مرفوعة الصلاحيات (لم يتأكد نجاحها):

```powershell
Start-Process -FilePath "powershell.exe" -ArgumentList '-NoProfile','-Command','Checkpoint-Computer -Description "Before ASUS driver removal" -RestorePointType "APPLICATION_INSTALL"' -Verb RunAs -Wait
# النتيجة: تم تشغيل الأمر لكن لم يتم التحقق من وجود نقطة استعادة (Get-ComputerRestorePoint أعاد Access denied)
```

3. حذف حزمة التعريف oem66.inf بالقوة:

```powershell
Start-Process -FilePath "pnputil.exe" -ArgumentList '/delete-driver','oem66.inf','/uninstall','/force' -Verb RunAs -Wait
# النتيجة: بعد الحذف، أمر التحقق 'pnputil /enum-drivers | findstr /i "oem66"' لم يظهر الحزمة.
```

4. محاولة إزالة جهاز الـ Instance المحدد (مُنفّذ مرفوع الصلاحيات):

```powershell
Start-Process -FilePath "pnputil.exe" -ArgumentList '/remove-device','HID\\VID_0B05&PID_1866&MI_00\\7&45F3DE7&0&0000' -Verb RunAs -Wait
# النتيجة: الأمر نفّذ، والجهاز ظهر لاحقًا مُستخدمًا تعريف النظام القياسي (keyboard.inf)
```

5. إجبار Windows على مسح الأجهزة مرفوع الصلاحيات:

```powershell
Start-Process -FilePath "pnputil.exe" -ArgumentList '/scan-devices' -Verb RunAs -Wait
# النتيجة: نجحت بعد التشغيل كمسؤول (غير مرفوع فشل سابقًا بـ Access is denied).
```

6. فحص حالة الأجهزة النهائية:

```powershell
pnputil /enum-devices /class Keyboard
# النتيجة: يظهر الآن ASUS Number Pad كـ 'HID Keyboard Device' وبحالة 'Started' ويستخدم 'keyboard.inf'
```

---

## فحص سريع بعد إعادة التشغيل ✅
- افتح Notepad وجرّب الكتابة بكل الأزرار.
- جرّب Num Lock واللوحة الرقمية.
- جرّب الدخول إلى BIOS/UEFI وتحقق من عمل المفاتيح (إن لم تعمل داخل BIOS فالمشكلة عتادية-Hardware).

---

## حلول إضافية إذا بقيت المشكلة ⚠️
- **إلغاء تثبيت أي برنامج ASUS** له علاقة بالـ Number Pad من Settings → Apps.
- **تحديث Windows** و**تثبيت تعريف رسمي** من موقع ASUS إن توافر.
- **استعادة النظام** إلى نقطة سابقة إن تغيّرت أشياء خاطئة.

### إصلاح متقدّم في الريجستري (افعل هذا فقط إن فشل كل شيء)
- افتح `regedit` كمسؤول.
- اذهب إلى:

```
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\{4d36e96b-e325-11ce-bfc1-08002be10318}
```

- **صدّر النسخة (File → Export)** لعمل Backup قبل أي تغيير.
- إذا وجدت القيم `UpperFilters` أو `LowerFilters`، احذفها ثم أعد التشغيل.

> تحذير: تعديل الريجستري قد يسبب مشاكل في النظام - اصنع نسخة احتياطية أولًا.

---

## أوامر تشخيصية مفيدة (سريعة) 🧩
- لإظهار الأجهزة التي بها مشاكل:

```powershell
Get-PnpDevice -Class Keyboard | Where-Object { $_.Status -ne 'OK' } | Format-Table -AutoSize
```

- لعرض تعريفات الـ OEM ومساراتها:

```powershell
pnputil /enum-drivers
```

---

## خطوات للرجوع (Rollback)
1. استعمل System Restore للنقطة التي أنشأتها.
2. إذا حذفت حزمة تعريف بالخطأ، يمكنك إعادة تثبيتها من ملف التعريف إن كان متوفراً أو من صفحة الدعم الخاصة بـ ASUS.

---

## ملاحظات نهائية
- أنفّذ هذه الخطوات دومًا كمسؤول (Administrative privileges).
- إن احتجت، أرسل لي مخرجات الأوامر أعلاه أو صورة من رسالة الخطأ وسأرشدك للخطوة التالية.

---

ملف هذا قابل للتعديل أو التوسع — أخبرني إذا ترايد إضافة أوامر أو تصحيحات بالعربية المبسطة.