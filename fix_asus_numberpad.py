#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_asus_numberpad.py
إصلاح مشكلة ASUS Number Pad (Code 19) بطريقة ديناميكية:
- يكتشف الـ Instance الفعلي تلقائياً من Keyboard class
- يقرأ اسم التعريف الحالي المرتبط به (oemXX.inf) تلقائياً
- يحذف تعريف OEM المعطوب فقط (إن وجد)
- يزيل الجهاز ويعمل scan لإعادة الاكتشاف بتعريف النظام keyboard.inf

قبل التشغيل: افتح السكربت كـ Administrator أو وافق على نافذة UAC.
"""

import ctypes
import subprocess
import sys
import os
import argparse
import re
from datetime import datetime

LOGFILE = os.path.join(os.path.dirname(__file__), 'fix_asus_numberpad.log')
TARGET_VIDPID = 'VID_0B05&PID_1866'


def log(msg):
    ts = datetime.now().isoformat(sep=' ', timespec='seconds')
    line = f"[{ts}] {msg}\n"
    print(line, end='')
    with open(LOGFILE, 'a', encoding='utf-8') as f:
        f.write(line)


def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False


def run(cmd, check=False):
    log(f"تشغيل: {cmd}")
    proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    log(f"رمز الإرجاع: {proc.returncode}")
    if proc.stdout:
        log(f"stdout:\n{proc.stdout.strip()}")
    if proc.stderr:
        log(f"stderr:\n{proc.stderr.strip()}")
    if check and proc.returncode != 0:
        raise RuntimeError(f"أمر فشل: {cmd}")
    return proc


def run_quiet(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def parse_keyboard_blocks(pnputil_output):
    blocks = []
    current = {}
    for raw_line in pnputil_output.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                blocks.append(current)
                current = {}
            continue

        if ':' in line:
            k, v = line.split(':', 1)
            key = k.strip().lower()
            val = v.strip()
            current[key] = val

    if current:
        blocks.append(current)
    return blocks


def find_target_device_info(target_vidpid):
    proc = run_quiet('pnputil /enum-devices /class Keyboard')
    if proc.returncode != 0:
        raise RuntimeError(f'فشل قراءة أجهزة Keyboard: {proc.stderr.strip()}')

    target_upper = target_vidpid.upper()
    blocks = parse_keyboard_blocks(proc.stdout)

    matches = []
    for b in blocks:
        instance_id = b.get('instance id', '')
        if target_upper in instance_id.upper():
            matches.append({
                'instance_id': instance_id,
                'device_description': b.get('device description', ''),
                'status': b.get('status', ''),
                'problem_code': b.get('problem code', ''),
                'driver_name': b.get('driver name', ''),
            })

    if not matches:
        return None

    def score(item):
        s = 0
        status = (item.get('status') or '').lower()
        problem = (item.get('problem_code') or '').lower()
        if 'problem' in status:
            s += 5
        if '19' in problem:
            s += 10
        if 'asus number pad' in (item.get('device_description') or '').lower():
            s += 3
        return s

    matches.sort(key=score, reverse=True)
    return matches[0]


def is_oem_inf(driver_name):
    return bool(re.fullmatch(r'oem\d+\.inf', (driver_name or '').strip(), flags=re.IGNORECASE))


def elevate():
    # Relaunch script as admin
    params = ' '.join([f'"{arg}"' for arg in sys.argv])
    log("إعادة تشغيل السكربت بصلاحيات المسؤول (UAC) ...")
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, 1)
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser(description='Fix ASUS Number Pad Code 19 dynamically')
    parser.add_argument('--driver', default='', help='(اختياري) اسم ملف تعريف OEM للحذف مثل oem26.inf')
    parser.add_argument('--instance-id', default='', help='(اختياري) Device Instance ID لإزالة الجهاز')
    parser.add_argument('--target-vidpid', default=TARGET_VIDPID, help='VID/PID الهدف (افتراضياً ASUS Number Pad)')
    parser.add_argument('--no-restore', action='store_true', help='تخطى محاولة إنشاء نقطة استعادة')
    parser.add_argument('--yes', '-y', action='store_true', help='تأكيد تلقائي لكل الأسئلة (use with care)')
    args = parser.parse_args()

    if not is_admin():
        elevate()

    log('بدء تنفيذ إجراءات إصلاح ASUS Number Pad')

    # 1) محاولة إنشاء نقطة استعادة (اختياري)
    if not args.no_restore:
        try:
            log('محاولة إنشاء نقطة استعادة: Checkpoint-Computer')
            cmd = 'powershell.exe -Command "Checkpoint-Computer -Description \"Before ASUS driver removal\" -RestorePointType \"APPLICATION_INSTALL\""'
            proc = run(cmd)
            if proc.returncode == 0:
                log('تم تنفيذ الأمر؛ قد تم إنشاء نقطة استعادة (تحقق من System Restore).')
            else:
                log('فشل إنشاء نقطة استعادة أو لم تُعطى الصلاحيات (راجع السجل أعلاه).')
        except Exception as e:
            log(f'خطأ أثناء محاولة إنشاء نقطة استعادة: {e}')
    else:
        log('تخطي إنشاء نقطة استعادة (--no-restore)')

    # 2) اكتشاف الجهاز/التعريف تلقائياً
    detected = None
    try:
        detected = find_target_device_info(args.target_vidpid)
        if detected:
            log('تم اكتشاف جهاز الهدف:')
            log(f"- Instance ID: {detected.get('instance_id')}")
            log(f"- Device: {detected.get('device_description')}")
            log(f"- Status: {detected.get('status')}")
            if detected.get('problem_code'):
                log(f"- Problem Code: {detected.get('problem_code')}")
            log(f"- Driver: {detected.get('driver_name')}")
        else:
            log('لم يتم العثور على جهاز ASUS Number Pad ضمن Keyboard class.')
    except Exception as e:
        log(f'خطأ أثناء اكتشاف الجهاز: {e}')

    effective_instance_id = args.instance_id or (detected.get('instance_id') if detected else '')
    detected_driver = detected.get('driver_name', '') if detected else ''
    effective_driver = args.driver or detected_driver

    # 3) حذف حزمة تعريف OEM المعطوبة (إن وُجدت)
    if effective_driver and is_oem_inf(effective_driver):
        question = f"هل تريد حذف التعريف '{effective_driver}' إذا وُجد؟ (y/N): "
        if args.yes or input(question).strip().lower() == 'y':
            cmd = f'pnputil /delete-driver {effective_driver} /uninstall /force'
            try:
                run(cmd)
                log(f'تم إرسال أمر حذف الحزمة {effective_driver}.')
            except Exception as e:
                log(f'فشل حذف الحزمة {effective_driver}: {e}')
        else:
            log('تخطى حذف حزمة التعريف.')
    elif effective_driver:
        log(f"التعريف الحالي ليس OEM قابل للحذف الآمن: {effective_driver} (سيتم تجاهل الحذف)")
    else:
        log('لم يتم تحديد تعريف OEM للحذف (تخطي خطوة الحذف).')

    # 4) محاولة إزالة الجهاز عبر Instance ID
    if effective_instance_id:
        question = f"هل تريد إزالة الجهاز Instance ID '{effective_instance_id}'؟ (y/N): "
        if args.yes or input(question).strip().lower() == 'y':
            cmd = f'pnputil /remove-device "{effective_instance_id}"'
            try:
                run(cmd)
                log('تم تنفيذ إزالة الجهاز.')
            except Exception as e:
                log(f'فشل إزالة الجهاز: {e}')
        else:
            log('تخطى إزالة المثيل.')
    else:
        log('لا يوجد Instance ID معروف لإزالته (تخطي خطوة الإزالة).')

    # 5) مسح الأجهزة لإجبار Windows على إعادة الاكتشاف
    try:
        run('pnputil /scan-devices')
        log('تم إرسال أمر /scan-devices.')
    except Exception as e:
        log(f'خطأ أثناء مسح الأجهزة: {e}')

    # 6) فحص الأجهزة النهائية
    try:
        log('حالة أجهزة الكيبورد بعد الإجراءات:')
        run('pnputil /enum-devices /class Keyboard')
    except Exception as e:
        log(f'خطأ في فحص الأجهزة: {e}')

    # 7) تحقق مختصر من نجاح إصلاح ASUS Number Pad
    try:
        post = find_target_device_info(args.target_vidpid)
        if post:
            problem = (post.get('problem_code') or '').lower()
            status = (post.get('status') or '').lower()
            driver = post.get('driver_name', '')
            if '19' in problem or 'problem' in status:
                log('⚠️ ما زالت هناك مشكلة على جهاز ASUS Number Pad بعد الإصلاح.')
            else:
                log(f'✅ الجهاز يعمل حالياً. Driver={driver} Status={post.get("status")}')
        else:
            log('ℹ️ لم يعد جهاز ASUS Number Pad ظاهراً ضمن Keyboard class بعد العملية.')
    except Exception as e:
        log(f'تعذر التحقق النهائي: {e}')

    # 8) إعادة تشغيل (اختياري)
    if args.yes or input('هل تود إعادة تشغيل الجهاز الآن؟ (y/N): ').strip().lower() == 'y':
        log('إعادة التشغيل الآن...')
        run('shutdown /r /t 5')
    else:
        log('انتهت الإجراءات. أعد التشغيل يدوياً لاحقاً إن لزم.')

    log('انتهى السكربت.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        log(f'خطأ غير متوقع: {exc}')
        sys.exit(1)
