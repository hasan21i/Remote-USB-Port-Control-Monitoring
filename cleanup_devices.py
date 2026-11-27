"""
سكربت تنظيف أجهزة USB المعطلة
================================
يقوم بإعادة تفعيل جميع أجهزة USB التي تم تعطيلها عبر Disable-PnpDevice
يمكن تشغيله كأداة طوارئ إذا أغلق البرنامج بشكل غير طبيعي وبقيت أجهزة معطلة

الاستخدام:
    python cleanup_devices.py           # تنظيف تلقائي لكل الأجهزة المعطلة
    python cleanup_devices.py --scan    # فحص فقط بدون تفعيل
    python cleanup_devices.py --device "USB\\VID_2717&PID_FF40\\SERIAL"  # تفعيل جهاز محدد
"""

import subprocess
import json
import sys
import os
import argparse
from datetime import datetime


def get_disabled_usb_devices():
    """جلب جميع أجهزة USB المعطلة حالياً"""
    ps_script = '''
    $disabledDevices = Get-PnpDevice | Where-Object {
        ($_.InstanceId -like "USB\\VID_*" -or $_.InstanceId -like "HID\\VID_*") -and
        $_.Present -eq $true -and
        ($_.Status -eq "Error" -or $_.Status -eq "Disabled" -or $_.Problem -ne 0)
    } | Select-Object InstanceId, FriendlyName, Status, Class, Manufacturer, Problem

    $results = @()
    foreach ($dev in $disabledDevices) {
        $results += @{
            'instance_id' = $dev.InstanceId
            'name' = if ($dev.FriendlyName) { $dev.FriendlyName } else { "Unknown Device" }
            'status' = [string]$dev.Status
            'class' = if ($dev.Class) { $dev.Class } else { "Unknown" }
            'manufacturer' = if ($dev.Manufacturer) { $dev.Manufacturer } else { "Unknown" }
            'problem_code' = if ($dev.Problem) { [int]$dev.Problem } else { 0 }
        }
    }
    if ($results.Count -gt 0) { $results | ConvertTo-Json -Depth 3 } else { "[]" }
    '''

    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_script],
            capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            print(f"❌ خطأ في PowerShell: {result.stderr}")
            return []

        output = result.stdout.strip()
        if not output or output == '':
            return []

        devices = json.loads(output)
        if isinstance(devices, dict):
            devices = [devices]
        return devices if isinstance(devices, list) else []

    except Exception as e:
        print(f"❌ خطأ: {e}")
        return []


def enable_device(instance_id):
    """إعادة تفعيل جهاز محدد"""
    try:
        safe_id = instance_id.replace('"', '').replace("'", '').replace(';', '')
        cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            f'Enable-PnpDevice -InstanceId "{safe_id}" -Confirm:$false -ErrorAction Stop; Write-Output "ENABLED_OK"'
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)

        if result.returncode == 0 and 'ENABLED_OK' in result.stdout:
            return True, "تم التفعيل بنجاح"
        elif result.returncode == 0:
            return True, "تم التفعيل"
        else:
            error_msg = result.stderr.strip() if result.stderr else "خطأ غير معروف"
            return False, f"فشل التفعيل: {error_msg}"

    except subprocess.TimeoutExpired:
        return False, "انتهت مهلة التفعيل"
    except Exception as e:
        return False, str(e)


def clean_registry_cache():
    """تنظيف كاش الرجستري لأجهزة USB والأجهزة المخفية"""
    try:
        print("\n🧹 جاري تنظيف كاش الرجستري والأجهزة المخفية...")
        
        # استخدام pnputil لحذف الأجهزة غير المتصلة (كاش الأجهزة في الرجستري)
        ps_script = '''
        $disconnected = Get-PnpDevice | Where-Object { $_.Present -eq $false -and ($_.InstanceId -like "USB*" -or $_.InstanceId -like "HID*") }
        $count = 0
        foreach ($dev in $disconnected) {
            try {
                pnputil /remove-device $dev.InstanceId | Out-Null
                $count++
            } catch {}
        }
        Write-Output $count
        '''
        
        result = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_script],
            capture_output=True, text=True, timeout=30
        )
        
        count = result.stdout.strip()
        if count and count.isdigit() and int(count) > 0:
            print(f"✅ تم تنظيف {count} من إدخالات كاش الأجهزة (الرجستري) القديمة.")
        else:
            print("✅ كاش الرجستري نظيف، لم يتم العثور على أجهزة قديمة.")
            
    except Exception as e:
        print(f"⚠️ حدث خطأ أثناء تنظيف كاش الرجستري: {e}")

def load_failed_cleanup_file():
    """تحميل ملف الأجهزة التي فشل تنظيفها من التطبيق"""
    possible_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'failed_cleanup_devices.json'),
        os.path.join(os.environ.get('APPDATA', ''), 'usb-agent-app', 'failed_cleanup_devices.json'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'usb-agent-app', 'failed_cleanup_devices.json'),
    ]

    for filepath in possible_paths:
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    devices = json.load(f)
                print(f"📄 تم تحميل {len(devices)} جهاز من: {filepath}")
                return devices
            except Exception as e:
                print(f"⚠️ فشل قراءة {filepath}: {e}")

    return []


def main():
    parser = argparse.ArgumentParser(description='تنظيف أجهزة USB المعطلة')
    parser.add_argument('--scan', action='store_true', help='فحص فقط بدون تفعيل')
    parser.add_argument('--device', type=str, help='تفعيل جهاز محدد بالـ InstanceId')
    parser.add_argument('--all', action='store_true', help='تفعيل جميع أجهزة USB المعطلة')
    args = parser.parse_args()

    print("=" * 60)
    print("🧹 أداة تنظيف أجهزة USB المعطلة")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    print()

    # تفعيل جهاز محدد
    if args.device:
        print(f"🔓 إعادة تفعيل الجهاز: {args.device}")
        success, message = enable_device(args.device)
        if success:
            print(f"   ✅ {message}")
        else:
            print(f"   ❌ {message}")
        return

    # فحص الأجهزة المعطلة
    print("🔍 جاري البحث عن أجهزة USB معطلة...")
    disabled_devices = get_disabled_usb_devices()

    # تحميل الأجهزة من ملف التنظيف الفاشل
    failed_cleanup = load_failed_cleanup_file()

    if not disabled_devices and not failed_cleanup:
        print("\n✅ لا توجد أجهزة USB معطلة! كل شيء يعمل بشكل طبيعي.")
        return

    # عرض الأجهزة المعطلة
    if disabled_devices:
        print(f"\n📋 وُجدت {len(disabled_devices)} أجهزة USB معطلة:")
        print("-" * 60)
        for i, dev in enumerate(disabled_devices, 1):
            print(f"  {i}. {dev.get('name', 'Unknown')}")
            print(f"     📌 ID: {dev.get('instance_id', 'N/A')}")
            print(f"     📊 Status: {dev.get('status', 'N/A')}")
            print(f"     🏭 Class: {dev.get('class', 'N/A')}")
            print(f"     🔧 Problem: {dev.get('problem_code', 0)}")
            print()

    if failed_cleanup:
        print(f"\n📄 أجهزة من ملف التنظيف الفاشل ({len(failed_cleanup)}):")
        for dev in failed_cleanup:
            print(f"  📌 {dev.get('instance_id', 'N/A')}")

    # وضع الفحص فقط
    if args.scan:
        print("\n📝 وضع الفحص فقط - لم يتم تغيير أي شيء.")
        print("   لتفعيل الأجهزة، أعد التشغيل بدون --scan أو استخدم --all")
        return

    # تفعيل جميع الأجهزة
    if args.all or disabled_devices:
        print("\n" + "=" * 60)
        if not args.all:
            response = input("❓ هل تريد إعادة تفعيل جميع الأجهزة المعطلة؟ (y/n): ").strip().lower()
            if response != 'y':
                print("❌ تم الإلغاء.")
                return

        print("🔓 جاري إعادة تفعيل الأجهزة...")
        success_count = 0
        fail_count = 0

        # تفعيل الأجهزة المكتشفة
        all_device_ids = set()
        for dev in disabled_devices:
            all_device_ids.add(dev.get('instance_id', ''))
        for dev in failed_cleanup:
            all_device_ids.add(dev.get('instance_id', ''))

        for device_id in all_device_ids:
            if not device_id:
                continue
            print(f"   🔓 {device_id}...", end=" ")
            success, message = enable_device(device_id)
            if success:
                print(f"✅ {message}")
                success_count += 1
            else:
                print(f"❌ {message}")
                fail_count += 1

        print()
        print("=" * 60)
        print(f"🧹 النتيجة: {success_count} تم تفعيلها | {fail_count} فشلت")
        print("=" * 60)

        # حذف ملف التنظيف إذا نجح كل شيء
        if fail_count == 0:
            for filepath in [
                os.path.join(os.path.dirname(os.path.abspath(__file__)), 'failed_cleanup_devices.json'),
                os.path.join(os.environ.get('APPDATA', ''), 'usb-agent-app', 'failed_cleanup_devices.json'),
            ]:
                if os.path.exists(filepath):
                    try:
                        os.remove(filepath)
                        print(f"🗑️ تم حذف ملف التنظيف: {filepath}")
                    except:
                        pass
        
        # تنظيف كاش الرجستري في النهاية
        clean_registry_cache()


if __name__ == '__main__':
    # التأكد من تشغيل كمسؤول
    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],
            capture_output=True, text=True, timeout=5
        )
        if 'True' not in result.stdout:
            print("⚠️ تحذير: يجب تشغيل هذا السكربت كمسؤول (Administrator) لتفعيل الأجهزة!")
            print("   أعد التشغيل بالضغط بزر الفأرة الأيمن واختيار 'Run as administrator'")
            print()
    except:
        pass

    main()
