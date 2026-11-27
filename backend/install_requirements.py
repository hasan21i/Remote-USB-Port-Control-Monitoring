#!/usr/bin/env python3
"""
تثبيت المكتبات المطلوبة لسكربتات قاعدة البيانات
"""

import subprocess
import sys

def install_package(package):
    """تثبيت مكتبة Python"""
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        print(f"✅ تم تثبيت {package} بنجاح")
        return True
    except Exception as e:
        print(f"❌ فشل تثبيت {package}: {e}")
        return False

def main():
    print("🔧 تثبيت المكتبات المطلوبة لسكربتات قاعدة البيانات...")
    
    required_packages = [
        'supabase',
        'tabulate',
        'psycopg2-binary',
        'python-dotenv'
    ]
    
    success_count = 0
    
    for package in required_packages:
        print(f"\n📦 تثبيت {package}...")
        if install_package(package):
            success_count += 1
    
    print(f"\n" + "="*50)
    if success_count == len(required_packages):
        print("🎉 تم تثبيت جميع المكتبات بنجاح!")
        print("\n🚀 يمكنك الآن تشغيل:")
        print("   python simple_users_check.py")
        print("   أو")
        print("   python check_users_database.py")
    else:
        print(f"⚠️ تم تثبيت {success_count}/{len(required_packages)} مكتبة فقط")
        print("🔧 قد تحتاج لتثبيت المكتبات المفقودة يدوياً")

if __name__ == "__main__":
    main()