from extensions import db
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
import json
import jwt
import os
from base_model import BaseModel
import hashlib
from sqlalchemy.orm import relationship
from cryptography.fernet import Fernet
import base64

# --- جداول الربط many-to-many ---
# تأجيل إنشاء الجداول حتى يتم تهيئة db
def _create_tables():
    global user_roles, role_permissions
    user_roles = db.Table(
        'user_roles',
        db.Column('user_id', db.Integer, db.ForeignKey('users.id'), primary_key=True),
        db.Column('role_id', db.Integer, db.ForeignKey('roles.id'), primary_key=True)
    )

    role_permissions = db.Table(
        'role_permissions',
        db.Column('role_id', db.Integer, db.ForeignKey('roles.id'), primary_key=True),
        db.Column('permission_id', db.Integer, db.ForeignKey('permissions.id'), primary_key=True)
    )

# إنشاء الجداول إذا كان db متاحاً
try:
    if db is not None:
        _create_tables()
except:
    # إذا لم يكن db متاحاً بعد، سيتم إنشاء الجداول لاحقاً
    user_roles = None
    role_permissions = None

ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')
if ENCRYPTION_KEY is None:
    ENCRYPTION_KEY = base64.urlsafe_b64encode(os.urandom(32))
fernet = Fernet(ENCRYPTION_KEY)

def encrypt_field(val):
    if not val:
        return None
    return fernet.encrypt(val.encode()).decode()

def decrypt_field(val):
    if not val:
        return None
    try:
        return fernet.decrypt(val.encode()).decode()
    except Exception:
        # إذا فشل فك التشفير، نعيد القيمة كما هي (ربما غير مشفرة)
        return val


class User(db.Model):
    __tablename__ = "users"
    __table_args__ = {"extend_existing": True}

    id                   = db.Column(db.Integer, primary_key=True)
    username             = db.Column(db.String(100), unique=True, nullable=False)
    email                = db.Column(db.String(255), unique=True, nullable=False)
    password_hash        = db.Column(db.String(255), nullable=False)
    role                 = db.Column(db.String(20), default="user")
    status               = db.Column(db.String(20), default="active")
    mfa_enabled          = db.Column(db.Boolean, default=False)
    mfa_secret           = db.Column(db.String(64), nullable=True)  # secret الخاص بـ MFA
    last_login           = db.Column(db.DateTime, nullable=True)
    created_at           = db.Column(db.DateTime, default=datetime.utcnow)
    reset_token          = db.Column(db.String(255), nullable=True)
    reset_token_expiry   = db.Column(db.DateTime, nullable=True)
    phone                = db.Column(db.String(20), nullable=True)
    avatar               = db.Column(db.String(255), nullable=True)
    department           = db.Column(db.String(100), nullable=True)
    position             = db.Column(db.String(100), nullable=True)  # المنصب
    last_password_change = db.Column(db.DateTime, nullable=True)

    # relationships
    logs    = db.relationship("Log", backref="user", lazy=True)
    devices = db.relationship(
        "Device",
        back_populates="registered_by",
        foreign_keys="[Device.registered_by_id]",
        lazy="dynamic"
    )
    roles   = db.relationship("Role", secondary=user_roles, back_populates="users")

    @property
    def email_decrypted(self):
        try:
            return decrypt_field(self.email)
        except Exception:
            return self.email  # إرجاع البريد كما هو إذا فشل فك التشفير
    
    @property
    def phone_decrypted(self):
        try:
            return decrypt_field(self.phone)
        except Exception:
            return self.phone  # إرجاع الهاتف كما هو إذا فشل فك التشفير

    def set_password(self, password):
        """تعيين كلمة مرور جديدة باستخدام التشفير الحديث"""
        self.password_hash = generate_password_hash(password, method='scrypt')
        self.last_password_change = datetime.utcnow()

    def check_password(self, password):
        """التحقق من كلمة المرور - يستقبل كلمة المرور كنص عادي"""
        try:
            # استخدام check_password_hash من werkzeug مباشرة
            return check_password_hash(self.password_hash, password)
        except Exception as e:
            # في حالة وجود مشكلة في التشفير، إعادة تعيين كلمة المرور
            print(f"Password check error: {e}")
            return False
        except Exception as e:
            # في حالة حدوث خطأ، إرجاع False
            return False

    def generate_reset_token(self, expiry_minutes=10):
        token = jwt.encode(
            {"user_id": self.id, "exp": datetime.utcnow() + timedelta(minutes=expiry_minutes)},
            os.getenv("SECRET_KEY", "your_super_secret_key"),
            algorithm="HS256"
        )
        self.reset_token = token
        self.reset_token_expiry = datetime.utcnow() + timedelta(minutes=expiry_minutes)
        return token

    def set_email(self, email):
        self.email = encrypt_field(email)

    def set_phone(self, phone):
        self.phone = encrypt_field(phone)

    def update_role(self, new_role):
        """
        تحديث دور المستخدم مع ضمان التحديث المتسق للحقلين role و roles
        """
        from models import Role
        
        # التحقق من صحة الدور
        valid_roles = ['user', 'manager', 'admin', 'readonly']
        if new_role not in valid_roles:
            raise ValueError(f'Invalid role: {new_role}. Valid roles are: {", ".join(valid_roles)}')
        
        # تحديث الحقل المباشر
        self.role = new_role
        
        # إزالة جميع الأدوار الحالية
        self.roles.clear()
        
        # البحث عن الدور في جدول الأدوار أو إنشاؤه
        role = Role.query.filter_by(name=new_role).first()
        if not role:
            # إنشاء الدور إذا لم يكن موجوداً
            role = Role(name=new_role, description=f'دور {new_role}')
            from extensions import db
            db.session.add(role)
            db.session.flush()  # تأكد من حفظ الدور أولاً
        
        # إضافة الدور الجديد للمستخدم
        self.roles.append(role)
        
        # تأكد من أن الحقل المباشر متسق مع العلاقة
        if not self.roles:
            self.role = 'user'  # قيمة افتراضية إذا لم تكن هناك أدوار
        else:
            self.role = self.roles[0].name  # استخدام الدور الأول كدور أساسي
    
    def get_roles_list(self):
        """
        الحصول على قائمة الأدوار كأسماء نصية
        """
        return [r.name for r in self.roles] if self.roles else ['user']
    
    def get_primary_role(self):
        """
        الحصول على الدور الأساسي
        """
        roles_list = self.get_roles_list()
        return roles_list[0] if roles_list else 'user'

    @classmethod
    def reorder_ids(cls):
        """
        إعادة ترتيب الـ IDs لجميع المستخدمين
        """
        from sqlalchemy import text
        from extensions import db
        
        try:
            # الحصول على جميع المستخدمين مرتبين حسب الـ ID
            users = cls.query.order_by(cls.id).all()
            
            if not users:
                return 0
            
            # إنشاء جدول مؤقت للـ IDs الجديدة
            temp_ids = {}
            for i, user in enumerate(users, 1):
                temp_ids[user.id] = i
            
            # تحديث الـ IDs باستخدام SQL مباشر
            for old_id, new_id in temp_ids.items():
                if old_id != new_id:
                    # تحديث جدول المستخدمين
                    db.session.execute(
                        text("UPDATE users SET id = :new_id WHERE id = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    
                    # تحديث الجداول المرتبطة
                    db.session.execute(
                        text("UPDATE user_roles SET user_id = :new_id WHERE user_id = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    
                    # تحديث السجلات
                    db.session.execute(
                        text("UPDATE logs SET user_id = :new_id WHERE user_id = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    
                    # تحديث التنبيهات
                    db.session.execute(
                        text("UPDATE alerts SET resolved_by = :new_id WHERE resolved_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    
                    # تحديث الأجهزة
                    db.session.execute(
                        text("UPDATE devices SET registered_by_id = :new_id WHERE registered_by_id = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    db.session.execute(
                        text("UPDATE devices SET modified_by = :new_id WHERE modified_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    db.session.execute(
                        text("UPDATE devices SET whitelisted_by = :new_id WHERE whitelisted_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    db.session.execute(
                        text("UPDATE devices SET approved_by = :new_id WHERE approved_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    db.session.execute(
                        text("UPDATE devices SET blacklisted_by = :new_id WHERE blacklisted_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    
                    # تحديث التقارير
                    db.session.execute(
                        text("UPDATE reports SET created_by = :new_id WHERE created_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    db.session.execute(
                        text("UPDATE reports SET modified_by = :new_id WHERE modified_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    db.session.execute(
                        text("UPDATE reports SET generated_by = :new_id WHERE generated_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    

                    
                    # تحديث التقارير الذكية
                    db.session.execute(
                        text("UPDATE ai_reports SET action_by = :new_id WHERE action_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    
                    # تحديث إعدادات النظام
                    db.session.execute(
                        text("UPDATE system_settings SET modified_by = :new_id WHERE modified_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    
                    # تحديث السياسات
                    db.session.execute(
                        text("UPDATE policies SET created_by = :new_id WHERE created_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
                    db.session.execute(
                        text("UPDATE policies SET modified_by = :new_id WHERE modified_by = :old_id"),
                        {"new_id": new_id, "old_id": old_id}
                    )
            
            # إعادة تعيين الـ auto increment (متوافق مع PostgreSQL)
            max_id = len(users)
            try:
                # محاولة إعادة تعيين sequence (لـ PostgreSQL)
                db.session.execute(
                    text("ALTER SEQUENCE users_id_seq RESTART WITH :max_id"),
                    {"max_id": max_id + 1}
                )
            except Exception:
                # تجاهل الخطأ في PostgreSQL (لا يدعم AUTO_INCREMENT)
                pass
            
            db.session.commit()
            return max_id
            
        except Exception as e:
            db.session.rollback()
            raise e
    


    def to_dict(self):
        # استخدام الدوال الجديدة للحصول على الأدوار
        user_roles = self.get_roles_list()
        primary_role = self.get_primary_role()
        
        # معالجة آمنة لفك تشفير البريد الإلكتروني
        try:
            email = self.email_decrypted
        except Exception:
            email = self.email  # استخدام البريد كما هو إذا فشل فك التشفير
        
        return {
            "id": self.id,
            "username": self.username,
            "name": self.username,  # اسم العرض
            "email": email,
            "role": primary_role,  # الدور الأساسي للتوافق مع الواجهة الأمامية
            "roles": user_roles,   # جميع الأدوار
            "status": self.status,
            "mfa_enabled": self.mfa_enabled,
            "last_login": self.last_login.isoformat() if self.last_login else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "department": self.department,
            "position": self.position,
            "avatar": self.avatar,
            "avatar_url": f"/uploads/avatars/{self.avatar}" if self.avatar else None,
            "phone": self.phone_decrypted,
            "notifications_enabled": True,  # افتراضي لحين إضافة الحقل
        }

    def __repr__(self):
        return f"<User {self.username}>"


class Role(db.Model):
    """نموذج الأدوار في النظام"""
    __tablename__ = "roles"

    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(255), nullable=True)

    users       = db.relationship("User", secondary=user_roles, back_populates="roles")
    permissions = db.relationship(
        "Permission", secondary=role_permissions, back_populates="roles"
    )

    def __repr__(self):
        return f"<Role {self.name}>"


class Permission(db.Model):
    """نموذج الصلاحيات"""
    __tablename__ = "permissions"

    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(100), unique=True, nullable=False)
    description = db.Column(db.String(255), nullable=True)

    roles = db.relationship("Role", secondary=role_permissions, back_populates="permissions")

    def __repr__(self):
        return f"<Permission {self.name}>"


class LoginSession(db.Model):
    """سجلّ جلسات تسجيل الدخول للمستخدمين"""
    __tablename__ = "login_sessions"

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    timestamp   = db.Column(db.DateTime, default=datetime.utcnow)
    ip_address  = db.Column(db.String(45), nullable=True)
    device_info = db.Column(db.String(255), nullable=True)
    token       = db.Column(db.String(500), nullable=False)

    user = db.relationship("User", backref="login_sessions")

    def __repr__(self):
        return f"<LoginSession {self.id} user={self.user_id}>"


class Device(db.Model, BaseModel):
    __tablename__ = "devices"
    __table_args__ = {"extend_existing": True}

    # الحقول الأساسية
    id                   = db.Column(db.Integer, primary_key=True)
    server_id            = db.Column(db.Integer, db.ForeignKey("servers.id"), nullable=True)
    name                 = db.Column(db.String(100), nullable=False)
    usb_port             = db.Column(db.String(100), nullable=False)
    vendor_id            = db.Column(db.String(50), nullable=False)
    product_id           = db.Column(db.String(50), nullable=False)
    manufacturer         = db.Column(db.String(100), nullable=True)
    product              = db.Column(db.String(100), nullable=True)
    serial_number        = db.Column(db.String(100), unique=True, nullable=True)
    device_class         = db.Column(db.String(50), nullable=True)
    device_hash          = db.Column(db.String(255), nullable=True)
    
    # معلومات الاتصال
    connection_time      = db.Column(db.DateTime, default=datetime.utcnow)
    connection_duration  = db.Column(db.Integer, nullable=True)
    last_activity        = db.Column(db.DateTime, nullable=True)
    last_scan_time       = db.Column(db.DateTime, nullable=True)
    
    # حالة الجهاز
    status               = db.Column(db.String(20), default="pending")  # pending, approved, denied, connected, disconnected
    is_verified          = db.Column(db.Boolean, default=False)
    whitelisted          = db.Column(db.Boolean, default=False)
    blacklisted          = db.Column(db.Boolean, default=False)
    
    # معلومات الأمان
    risk_level           = db.Column(db.String(20), default="unknown")  # low, medium, high, critical
    security_score       = db.Column(db.Integer, default=0)  # درجة الأمان (0-100)
    
    # معلومات الطاقة
    power_consumption    = db.Column(db.Float, default=0.0)  # استهلاك الطاقة بالواط
    voltage              = db.Column(db.Float, default=0.0)   # الجهد بالفولت
    current_draw         = db.Column(db.Float, default=0.0)   # التيار بالمللي أمبير
    
    # معلومات التقنية
    physical_path        = db.Column(db.String(255), nullable=True)
    bus_number           = db.Column(db.Integer, nullable=True)
    port_path            = db.Column(db.String(100), nullable=True)
    max_packet_size      = db.Column(db.Integer, nullable=True)
    speed_class          = db.Column(db.String(50), nullable=True)
    firmware_version     = db.Column(db.String(100), nullable=True)
    device_type          = db.Column(db.String(100), nullable=True)
    
    # معلومات النقل
    data_transferred     = db.Column(db.BigInteger, default=0)  # البيانات المنقولة بالبايت
    transfer_speed       = db.Column(db.Float, default=0.0)     # سرعة النقل بالبايت/ثانية
    
    # معلومات إضافية
    custom_name          = db.Column(db.String(100), nullable=True)
    notes                = db.Column(db.Text, nullable=True)
    meta_data            = db.Column(db.Text, nullable=True)  # JSON string
    
    # معلومات السيرفر
    server_name          = db.Column(db.String(100), nullable=True)
    server_ip            = db.Column(db.String(45), nullable=True)
    
    # معلومات الموافقة والرفض
    approved_by          = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    approved_at          = db.Column(db.DateTime, nullable=True)
    approval_notes       = db.Column(db.Text, nullable=True)
    denied_by            = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    denied_at            = db.Column(db.DateTime, nullable=True)
    denial_reason        = db.Column(db.Text, nullable=True)
    
    # معلومات القائمة البيضاء والسوداء
    whitelisted_by       = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    whitelisted_at       = db.Column(db.DateTime, nullable=True)
    blacklisted_by       = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    blacklisted_at       = db.Column(db.DateTime, nullable=True)
    
    # معلومات التسجيل والتعديل
    registered_by_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    modified_by          = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    modified_at          = db.Column(db.DateTime, nullable=True)
    
    # معلومات التوافق والسياسات
    policy_compliance    = db.Column(db.Text, nullable=True)  # JSON string
    compatibility_score  = db.Column(db.Integer, default=0)   # درجة التوافق (0-100)
    
    # معلومات المراقبة
    monitoring_enabled   = db.Column(db.Boolean, default=True)
    alert_threshold      = db.Column(db.Float, default=0.0)
    last_alert_time      = db.Column(db.DateTime, nullable=True)
    
    # معلومات النسخ الاحتياطي
    backup_enabled       = db.Column(db.Boolean, default=False)
    last_backup_time     = db.Column(db.DateTime, nullable=True)
    backup_path          = db.Column(db.String(255), nullable=True)

    # relationships
    server               = db.relationship("Server", back_populates="devices", lazy=True)
    registered_by        = db.relationship("User", back_populates="devices",
                                           foreign_keys=[registered_by_id], lazy=True)
    modified_by_user     = db.relationship("User", foreign_keys=[modified_by], lazy=True)
    whitelisted_by_user  = db.relationship("User", foreign_keys=[whitelisted_by], lazy=True)
    approved_by_user     = db.relationship("User", foreign_keys=[approved_by], lazy=True)

    def to_dict(self):
        result = {
            # الحقول الأساسية
            "id": self.id,
            "server_id": self.server_id,
            "server": {
                "id": self.server.id,
                "name": self.server.name,
                "ip_address": self.server.ip_address
            } if self.server else None,
            "name": self.name,
            "usb_port": self.usb_port,
            "vendor_id": self.vendor_id,
            "product_id": self.product_id,
            "manufacturer": self.manufacturer,
            "product": self.product,
            "serial_number": self.serial_number,
            "device_class": self.device_class,
            "device_hash": self.device_hash,
            
            # معلومات الاتصال
            "connection_time": self.connection_time.isoformat() if self.connection_time else None,
            "connection_duration": self.connection_duration,
            "last_activity": self.last_activity.isoformat() if self.last_activity else None,
            "last_scan_time": self.last_scan_time.isoformat() if self.last_scan_time else None,
            
            # حالة الجهاز
            "status": self.status,
            "is_verified": self.is_verified,
            "whitelisted": self.whitelisted,
            "blacklisted": self.blacklisted,
            
            # معلومات الأمان
            "risk_level": self.risk_level,
            "security_score": self.security_score,
            
            # معلومات الطاقة
            "power_consumption": self.power_consumption,
            "voltage": self.voltage,
            "current_draw": self.current_draw,
            
            # معلومات التقنية
            "physical_path": self.physical_path,
            "bus_number": self.bus_number,
            "port_path": self.port_path,
            "max_packet_size": self.max_packet_size,
            "speed_class": self.speed_class,
            "firmware_version": self.firmware_version,
            "device_type": self.device_type,
            
            # معلومات النقل
            "data_transferred": self.data_transferred,
            "transfer_speed": self.transfer_speed,
            
            # معلومات إضافية
            "custom_name": self.custom_name,
            "notes": self.notes,
            
            # معلومات السيرفر
            "server_name": self.server_name,
            "server_ip": self.server_ip,
            
            # معلومات الموافقة والرفض
            "approved_by": self.approved_by,
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "approval_notes": self.approval_notes,
            "denied_by": self.denied_by,
            "denied_at": self.denied_at.isoformat() if self.denied_at else None,
            "denial_reason": self.denial_reason,
            
            # معلومات القائمة البيضاء والسوداء
            "whitelisted_by": self.whitelisted_by,
            "whitelisted_at": self.whitelisted_at.isoformat() if self.whitelisted_at else None,
            "blacklisted_by": self.blacklisted_by,
            "blacklisted_at": self.blacklisted_at.isoformat() if self.blacklisted_at else None,
            
            # معلومات التسجيل والتعديل
            "registered_by_id": self.registered_by_id,
            "modified_by": self.modified_by,
            "modified_at": self.modified_at.isoformat() if self.modified_at else None,
            
            # معلومات التوافق والسياسات
            "policy_compliance": self.policy_compliance,
            "compatibility_score": self.compatibility_score,
            
            # معلومات المراقبة
            "monitoring_enabled": self.monitoring_enabled,
            "alert_threshold": self.alert_threshold,
            "last_alert_time": self.last_alert_time.isoformat() if self.last_alert_time else None,
            
            # معلومات النسخ الاحتياطي
            "backup_enabled": self.backup_enabled,
            "last_backup_time": self.last_backup_time.isoformat() if self.last_backup_time else None,
            "backup_path": self.backup_path,
        }
        
        # إضافة meta_data كـ JSON
        if self.meta_data:
            try:
                result["meta_data"] = json.loads(self.meta_data)
            except ValueError:
                result["meta_data"] = {}
        else:
            result["meta_data"] = {}
            
        return result

    @classmethod
    def from_dict(cls, data):
        device = cls(
            # الحقول الأساسية
            server_id         = data.get("server_id"),
            name              = data.get("name"),
            usb_port          = data.get("usb_port"),
            vendor_id         = data.get("vendor_id"),
            product_id        = data.get("product_id"),
            manufacturer      = data.get("manufacturer"),
            product           = data.get("product"),
            serial_number     = data.get("serial_number"),
            device_class      = data.get("device_class"),
            device_hash       = data.get("device_hash"),
            
            # معلومات الاتصال
            connection_time   = data.get("connection_time"),
            connection_duration = data.get("connection_duration"),
            last_activity     = data.get("last_activity"),
            last_scan_time    = data.get("last_scan_time"),
            
            # حالة الجهاز
            status            = data.get("status", "pending"),
            is_verified      = data.get("is_verified", False),
            whitelisted      = data.get("whitelisted", False),
            blacklisted      = data.get("blacklisted", False),
            
            # معلومات الأمان
            risk_level       = data.get("risk_level", "unknown"),
            security_score   = data.get("security_score", 0),
            
            # معلومات الطاقة
            power_consumption = data.get("power_consumption", 0.0),
            voltage          = data.get("voltage", 0.0),
            current_draw     = data.get("current_draw", 0.0),
            
            # معلومات التقنية
            physical_path    = data.get("physical_path"),
            bus_number       = data.get("bus_number"),
            port_path        = data.get("port_path"),
            max_packet_size  = data.get("max_packet_size"),
            speed_class      = data.get("speed_class"),
            firmware_version = data.get("firmware_version"),
            device_type      = data.get("device_type"),
            
            # معلومات النقل
            data_transferred = data.get("data_transferred", 0),
            transfer_speed   = data.get("transfer_speed", 0.0),
            
            # معلومات إضافية
            custom_name      = data.get("custom_name"),
            notes           = data.get("notes"),
            meta_data       = json.dumps(data.get("meta_data", {})) if data.get("meta_data") else None,
            
            # معلومات السيرفر
            server_name      = data.get("server_name"),
            server_ip        = data.get("server_ip"),
            
            # معلومات الموافقة والرفض
            approved_by      = data.get("approved_by"),
            approved_at      = data.get("approved_at"),
            approval_notes   = data.get("approval_notes"),
            denied_by        = data.get("denied_by"),
            denied_at        = data.get("denied_at"),
            denial_reason    = data.get("denial_reason"),
            
            # معلومات القائمة البيضاء والسوداء
            whitelisted_by   = data.get("whitelisted_by"),
            whitelisted_at   = data.get("whitelisted_at"),
            blacklisted_by   = data.get("blacklisted_by"),
            blacklisted_at   = data.get("blacklisted_at"),
            
            # معلومات التسجيل والتعديل
            registered_by_id = data.get("registered_by_id"),
            modified_by      = data.get("modified_by"),
            modified_at      = data.get("modified_at"),
            
            # معلومات التوافق والسياسات
            policy_compliance = json.dumps(data.get("policy_compliance", {})) if data.get("policy_compliance") else None,
            compatibility_score = data.get("compatibility_score", 0),
            
            # معلومات المراقبة
            monitoring_enabled = data.get("monitoring_enabled", True),
            alert_threshold   = data.get("alert_threshold", 0.0),
            last_alert_time   = data.get("last_alert_time"),
            
            # معلومات النسخ الاحتياطي
            backup_enabled    = data.get("backup_enabled", False),
            last_backup_time  = data.get("last_backup_time"),
            backup_path       = data.get("backup_path"),
        )
        
        # إضافة الحقول الإضافية
        device.device_class      = data.get("device_class")
        device.device_hash       = data.get("device_hash")
        device.status            = data.get("status", "pending")
        device.is_verified       = data.get("is_verified", False)
        device.physical_path     = data.get("physical_path")
        device.bus_number        = data.get("bus_number")
        device.port_path         = data.get("port_path")
        device.max_packet_size   = data.get("max_packet_size")
        device.speed_class       = data.get("speed_class")
        device.firmware_version  = data.get("firmware_version")
        device.data_transferred  = data.get("data_transferred", 0)
        device.custom_name       = data.get("custom_name")
        device.risk_level        = data.get("risk_level", "unknown")
        device.notes             = data.get("notes")
        device.whitelisted       = data.get("whitelisted", False)
        device.blacklisted       = data.get("blacklisted", False)
        device.whitelisted_by    = data.get("whitelisted_by")
        device.approved_by       = data.get("approved_by")
        device.approval_notes    = data.get("approval_notes")
        device.meta_data         = json.dumps(data["meta_data"]) if isinstance(data.get("meta_data"), dict) else None
        device.power_consumption = data.get("power_consumption", 0.0)
        
        # الحقول الجديدة للموافقة والرفض
        device.denied_by         = data.get("denied_by")
        device.denied_at         = data.get("denied_at")
        device.denial_reason     = data.get("denial_reason")
        
        # الحقول الجديدة للمعلومات الإضافية
        device.server_name       = data.get("server_name")
        device.device_type       = data.get("device_type")
        
        return device
        return device

    def __repr__(self):
        serial_display = self.serial_number or "بدون رقم تسلسلي"
        return f"<Device {self.name} ({serial_display})>"


class DeviceSerial(db.Model):
    """نموذج لتخزين أرقام السيريال المرتبطة بالأجهزة"""
    __tablename__ = "device_serials"
    __table_args__ = {"extend_existing": True}

    id         = db.Column(db.Integer, primary_key=True)
    serial_id  = db.Column(db.String(64), unique=True, nullable=False)
    device_id  = db.Column(db.Integer, db.ForeignKey("devices.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<DeviceSerial {self.serial_id} for Device {self.device_id}>"


class Log(db.Model, BaseModel):
    __tablename__ = "logs"
    __table_args__ = {"extend_existing": True}

    id           = db.Column(db.Integer, primary_key=True)
    action       = db.Column(db.String(200), nullable=False)
    user_id      = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    timestamp    = db.Column(db.DateTime, default=datetime.utcnow)
    target_device= db.Column(db.String(100), nullable=True)
    ip_address   = db.Column(db.String(50), nullable=True)
    details      = db.Column(db.Text, nullable=True)
    success      = db.Column(db.Boolean, default=True)
    duration     = db.Column(db.Float, nullable=True)
    session_id   = db.Column(db.String(100), nullable=True)
    browser_info = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        result = {
            "id": self.id,
            "action": self.action,
            "user_id": self.user_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "target_device": self.target_device,
            "ip_address": self.ip_address,
            "success": self.success,
            "duration": self.duration,
            "session_id": self.session_id,
            "browser_info": self.browser_info,
        }
        # محاولة إثراء بيانات العرض لتسهيل الواجهة الأمامية
        # user_name: اسم المستخدم إذا كان موجوداً، وإلا نحاول استخدام عنوان الـ IP أو وصف بديل
        try:
            user_name = None
            # backref 'user' ممكن أن يوفر كائن User
            if hasattr(self, 'user') and self.user:
                user_name = getattr(self.user, 'username', None) or getattr(self.user, 'name', None)
            else:
                # حاول جلب المستخدم من قاعدة البيانات إذا كان user_id عدديا
                try:
                    if isinstance(self.user_id, int) or (isinstance(self.user_id, str) and self.user_id.isdigit()):
                        u = User.query.get(int(self.user_id))
                        if u:
                            user_name = getattr(u, 'username', None) or getattr(u, 'name', None)
                except Exception:
                    user_name = None

            if not user_name:
                # استخدم الـ IP إن لم يتوفر اسم مستخدم
                if self.ip_address:
                    user_name = f"IP {self.ip_address}"
                elif self.user_id:
                    user_name = f"مستخدم {self.user_id}"
                else:
                    user_name = 'النظام'

            result['user_name'] = user_name
        except Exception:
            result['user_name'] = 'النظام'

        # device_name: حاول ربط الهدف بسجل جهاز إذا أمكن
        try:
            device_name = None
            if self.target_device:
                # بحث مرن: مقارنة بالسيريال، بالاسم أو بالـ id
                try:
                    # أولاً، إذا كان target_device قابل للتحويل لعدد، حاول البحث بالـ id
                    if isinstance(self.target_device, int) or (isinstance(self.target_device, str) and self.target_device.isdigit()):
                        d = Device.query.get(int(self.target_device))
                        if d:
                            device_name = d.custom_name or d.name
                    if not device_name:
                        # البحث بالسيريال أو بالاسم
                        d = Device.query.filter((Device.serial_number == str(self.target_device)) | (Device.name == str(self.target_device))).first()
                        if d:
                            device_name = d.custom_name or d.name
                except Exception:
                    device_name = None

            # fallback إلى النص الخام أو 'غير محدد'
            if not device_name:
                device_name = self.target_device or 'غير محدد'

            result['device_name'] = device_name
        except Exception:
            result['device_name'] = self.target_device or 'غير محدد'
        if self.details:
            try:
                result["details"] = json.loads(self.details)
            except:
                result["details"] = self.details
        return result

    @classmethod
    def from_dict(cls, data):
        log = cls(
            action=data["action"],
            user_id=data.get("user_id"),
            target_device=data.get("target_device"),
            ip_address=data.get("ip_address"),
            success=data.get("success", True),
            duration=data.get("duration"),
            session_id=data.get("session_id"),
            browser_info=data.get("browser_info"),
        )
        if "details" in data:
            log.details = json.dumps(data["details"]) if isinstance(
                data["details"], dict
            ) else data["details"]
        return log

    def __repr__(self):
        return f"<Log {self.action} by user {self.user_id}>"


class Alert(db.Model, BaseModel):
    __tablename__ = "alerts"
    __table_args__ = {"extend_existing": True}

    id            = db.Column(db.Integer, primary_key=True)
    message       = db.Column(db.String(200), nullable=False)
    priority      = db.Column(db.String(20), default="normal")
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    resolved      = db.Column(db.Boolean, default=False)
    resolved_by   = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    resolved_at   = db.Column(db.DateTime, nullable=True)
    target_device = db.Column(db.String(100), nullable=True)
    alert_type    = db.Column(db.String(50), nullable=True)
    read          = db.Column(db.Boolean, default=False)
    meta_data     = db.Column(db.Text, nullable=True)

    def to_dict(self):
        result = {
            "id": self.id,
            "message": self.message,
            "priority": self.priority,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "resolved": self.resolved,
            "resolved_by": self.resolved_by,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "target_device": self.target_device,
            "alert_type": self.alert_type,
            "read": self.read,
        }
        if self.meta_data:
            try:
                result["metadata"] = json.loads(self.meta_data)
            except:
                result["metadata"] = {}
        return result

    @classmethod
    def from_dict(cls, data):
        alert = cls(
            message=data["message"],
            priority=data.get("priority", "normal"),
            target_device=data.get("target_device"),
            alert_type=data.get("alert_type"),
            read=data.get("read", False),
        )
        if "metadata" in data and isinstance(data["metadata"], dict):
            alert.meta_data = json.dumps(data["metadata"])
        return alert

    def __repr__(self):
        return f"<Alert {self.message}>"


class Policy(db.Model, BaseModel):
    __tablename__ = "policies"
    __table_args__ = {"extend_existing": True}

    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(100), nullable=False)
    description   = db.Column(db.String(200), nullable=False)
    policy_type   = db.Column(db.String(20), nullable=False)
    device_pattern= db.Column(db.String(200), nullable=False)
    is_active     = db.Column(db.Boolean, default=True)
    created_by    = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    modified_at   = db.Column(db.DateTime, nullable=True)
    modified_by   = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    schedule      = db.Column(db.String(100), nullable=True)
    auto_apply    = db.Column(db.Boolean, default=False)
    rules         = db.Column(db.Text, nullable=True)

    def to_dict(self):
        result = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "policy_type": self.policy_type,
            "device_pattern": self.device_pattern,
            "is_active": self.is_active,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "modified_at": self.modified_at.isoformat() if self.modified_at else None,
            "modified_by": self.modified_by,
            "schedule": self.schedule,
            "auto_apply": self.auto_apply,
        }
        if self.rules:
            try:
                result["rules"] = json.loads(self.rules)
            except:
                result["rules"] = {}
        return result

    @classmethod
    def from_dict(cls, data):
        policy = cls(
            name=data["name"],
            description=data.get("description", ""),
            policy_type=data["policy_type"],
            device_pattern=data["device_pattern"],
            is_active=data.get("is_active", True),
            created_by=data["created_by"],
            schedule=data.get("schedule"),
            auto_apply=data.get("auto_apply", False),
            modified_by=data.get("modified_by"),
        )
        if "rules" in data and isinstance(data["rules"], dict):
            policy.rules = json.dumps(data["rules"])
        return policy

    def __repr__(self):
        return f"<Policy {self.name}>"



class BlockchainLog(db.Model, BaseModel):
    __tablename__ = "blockchain_logs"
    __table_args__ = {"extend_existing": True}

    id            = db.Column(db.Integer, primary_key=True)
    data          = db.Column(db.Text, nullable=False)
    hash          = db.Column(db.String(256), nullable=False)
    previous_hash = db.Column(db.String(256), nullable=True)
    timestamp     = db.Column(db.DateTime, default=datetime.utcnow)
    nonce         = db.Column(db.Integer, default=0)
    verified      = db.Column(db.Boolean, default=False)
    block_height  = db.Column(db.Integer, nullable=True)

    def to_dict(self):
        result = {
            "id": self.id,
            "hash": self.hash,
            "previous_hash": self.previous_hash,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "nonce": self.nonce,
            "verified": self.verified,
            "block_height": self.block_height,
        }
        if self.data:
            try:
                result["data"] = json.loads(self.data)
            except:
                result["data"] = self.data
        return result

    @classmethod
    def from_dict(cls, data):
        return cls(
            data=json.dumps(data["data"]) if isinstance(data["data"], dict) else data["data"],
            hash=data["hash"],
            previous_hash=data.get("previous_hash"),
            nonce=data.get("nonce", 0),
            verified=data.get("verified", False),
            block_height=data.get("block_height"),
        )

    def __repr__(self):
        return f"<BlockchainLog {self.id}>"

    @staticmethod
    def verify_chain():
        """
        تتحقق من سلامة السلسلة كاملة عند التشغيل.
        تعيد True إذا كانت جميع الكتل مترابطة بشكل صحيح وهاشاتها صحيحة.
        """
        try:
            from supabase_config import get_supabase_client
            supabase_client = get_supabase_client()
            if supabase_client:
                response = supabase_client.table('blockchain_logs').select('*').order('block_height').execute()
                logs = response.data if response.data else []
                
                prev_hash = None
                for blk in logs:
                    # إعادة حساب الهاش من البيانات ونص previous_hash وnonce
                    block_content = (
                        (blk.get('data') or "") +
                        (prev_hash or "") +
                        str(blk.get('nonce', 0))
                    )
                    calc_hash = hashlib.sha256(block_content.encode('utf-8')).hexdigest()
                    if calc_hash != blk.get('hash') or blk.get('previous_hash') != prev_hash:
                        return False
                    prev_hash = blk.get('hash')
                return True
            else:
                # Fallback - return True if Supabase not available
                return True
        except Exception as e:
            print(f"Error verifying blockchain chain: {e}")
            return False



class AIReport(db.Model, BaseModel):
    __tablename__ = "ai_reports"
    __table_args__ = {"extend_existing": True}

    id               = db.Column(db.Integer, primary_key=True)
    description      = db.Column(db.Text, nullable=False)
    analysis_type    = db.Column(db.String(50), nullable=False)
    confidence_score = db.Column(db.Float, nullable=True)
    timestamp        = db.Column(db.DateTime, default=datetime.utcnow)
    related_device   = db.Column(db.String(100), nullable=True)
    recommendation   = db.Column(db.Text, nullable=True)
    is_anomaly       = db.Column(db.Boolean, default=False)
    acted_upon       = db.Column(db.Boolean, default=False)
    action_taken     = db.Column(db.String(100), nullable=True)
    action_by        = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "description": self.description,
            "analysis_type": self.analysis_type,
            "confidence_score": self.confidence_score,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "related_device": self.related_device,
            "recommendation": self.recommendation,
            "is_anomaly": self.is_anomaly,
            "acted_upon": self.acted_upon,
            "action_taken": self.action_taken,
            "action_by": self.action_by,
        }

    @classmethod
    def from_dict(cls, data):
        return cls(
            description=data["description"],
            analysis_type=data["analysis_type"],
            confidence_score=data.get("confidence_score"),
            related_device=data.get("related_device"),
            recommendation=data.get("recommendation"),
            is_anomaly=data.get("is_anomaly", False),
            acted_upon=data.get("acted_upon", False),
            action_taken=data.get("action_taken"),
            action_by=data.get("action_by"),
        )

    def __repr__(self):
        return f"<AIReport {self.id}>"


class SystemSettings(db.Model):
    __tablename__ = "system_settings"
    __table_args__ = {"extend_existing": True}

    id           = db.Column(db.Integer, primary_key=True)
    key          = db.Column(db.String(100), unique=True, nullable=False)
    value        = db.Column(db.Text, nullable=True)
    type         = db.Column(db.String(20), default="string")
    description  = db.Column(db.String(255), nullable=True)
    modified_at  = db.Column(db.DateTime, default=datetime.utcnow)
    modified_by  = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    def get_value(self):
        if self.type == "int":
            return int(self.value) if self.value is not None else None
        elif self.type == "float":
            return float(self.value) if self.value is not None else None
        elif self.type == "boolean":
            return self.value.lower() in ("true", "1", "yes", "y") if self.value else None
        elif self.type == "json":
            try:
                return json.loads(self.value) if self.value else None
            except:
                return None
        return self.value

    def __repr__(self):
        return f"<SystemSettings {self.key}={self.value}>"


class ActivationKey(db.Model):
    __tablename__ = "activation_keys"
    __table_args__ = {"extend_existing": True}

    id          = db.Column(db.Integer, primary_key=True)
    key         = db.Column(db.String(100), unique=True, nullable=False)
    license_type= db.Column(db.String(50), nullable=False)
    max_users   = db.Column(db.Integer, default=1)
    max_devices = db.Column(db.Integer, default=10)
    valid_from  = db.Column(db.DateTime, default=datetime.utcnow)
    valid_until = db.Column(db.DateTime, nullable=True)
    is_used     = db.Column(db.Boolean, default=False)
    used_by     = db.Column(db.String(100), nullable=True)
    used_at     = db.Column(db.DateTime, nullable=True)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<ActivationKey {self.key} ({self.license_type})>"


class Server(db.Model, BaseModel):
    __tablename__ = 'servers'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), unique=True, nullable=False)
    ip_address = db.Column(db.String(64))
    os = db.Column(db.String(64))
    cpu = db.Column(db.String(64))
    ram = db.Column(db.String(64))
    last_heartbeat = db.Column(db.DateTime)
    status = db.Column(db.String(32), default='inactive')
    # الحقول الجديدة:
    api_key = db.Column(db.String(128), unique=True, nullable=True)
    capabilities = db.Column(db.Text, nullable=True)  # JSON string
    config = db.Column(db.Text, nullable=True)        # JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # ربط الـ agent بالمستخدم
    devices = relationship("Device", back_populates="server", lazy=True)
    # جديد لدعم التوافر العالي
    role = db.Column(db.String(20), default="primary")  # primary | secondary
    is_active = db.Column(db.Boolean, default=True)      # هل هو الخادم النشط فعليًا
    # حقول جديدة لنظام الـ sub-servers
    server_type = db.Column(db.String(20), default="secondary")  # primary | secondary
    parent_server_id = db.Column(db.Integer, db.ForeignKey('servers.id'), nullable=True)  # ربط بالسيرفر الرئيسي

    def to_dict(self):
        # تحليل الإمكانيات مع معالجة الأخطاء
        capabilities = {}
        if self.capabilities:
            try:
                capabilities = json.loads(self.capabilities)
            except (json.JSONDecodeError, TypeError):
                capabilities = {}

        # تحليل التكوين مع معالجة الأخطاء
        config = {}
        if self.config:
            try:
                config = json.loads(self.config)
            except (json.JSONDecodeError, TypeError):
                config = {}

        return {
            "id": self.id,
            "name": self.name,
            "ip_address": self.ip_address,
            "os": self.os,
            "cpu": self.cpu,
            "ram": self.ram,
            "last_heartbeat": self.last_heartbeat.isoformat() if self.last_heartbeat else None,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "role": self.role,
            "is_active": self.is_active,
            "is_online": self.is_online,
            "api_key": self.api_key,
            "capabilities": capabilities,
            "config": config,
            "user_id": self.user_id,
            "server_type": self.server_type,
            "parent_server_id": self.parent_server_id,
        }

    @property
    def is_online(self):
        """تحديد ما إذا كان الخادم متصل أم لا"""
        return self.status == 'active' or self.status == 'online' or self.is_active

    def set_online(self):
        """تحديد الخادم كمتصل"""
        self.status = 'active'
        self.is_active = True
        self.last_heartbeat = datetime.utcnow()

    def set_offline(self):
        """تحديد الخادم كغير متصل"""
        self.status = 'inactive'
        self.is_active = False

    def __repr__(self):
        return f"<Server {self.name} ({self.ip_address})>"



class Report(db.Model, BaseModel):
    """نموذج التقارير الشاملة"""
    __tablename__ = "reports"
    __table_args__ = {"extend_existing": True}

    id              = db.Column(db.Integer, primary_key=True)
    name            = db.Column(db.String(100), nullable=False)
    description     = db.Column(db.Text, nullable=True)
    schedule        = db.Column(db.String(100), nullable=True)
    report_type     = db.Column(db.String(50), nullable=False)
    params          = db.Column(db.Text, nullable=True)
    is_active       = db.Column(db.Boolean, default=True)
    created_by      = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at      = db.Column(db.DateTime, default=datetime.utcnow)
    modified_at     = db.Column(db.DateTime, nullable=True)
    modified_by     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    last_run        = db.Column(db.DateTime, nullable=True)
    next_run        = db.Column(db.DateTime, nullable=True)
    download_count  = db.Column(db.Integer, default=0)
    language        = db.Column(db.String(10), default='ar')
    format_type     = db.Column(db.String(20), default='pdf')
    content         = db.Column(db.Text, nullable=True)
    file_path       = db.Column(db.String(255), nullable=True)
    file_size       = db.Column(db.Integer, default=0)
    generation_time = db.Column(db.Float, nullable=True)
    error_message   = db.Column(db.Text, nullable=True)
    metadata_json   = db.Column(db.Text, nullable=True)
    status          = db.Column(db.String(20), default='pending')
    last_generated_at = db.Column(db.DateTime, nullable=True)
    generated_by    = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    is_comprehensive = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "report_type": self.report_type,
            "schedule": self.schedule,
            "params": json.loads(self.params) if self.params else {},
            "is_active": self.is_active,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "modified_at": self.modified_at.isoformat() if self.modified_at else None,
            "modified_by": self.modified_by,
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "next_run": self.next_run.isoformat() if self.next_run else None,
            "download_count": self.download_count,
            "language": self.language,
            "format_type": self.format_type,
            "content": self.content,
            "file_path": self.file_path,
            "file_size": self.file_size,
            "generation_time": self.generation_time,
            "error_message": self.error_message,
            "metadata": json.loads(self.metadata_json) if self.metadata_json else {},
            "status": self.status,
            "last_generated_at": self.last_generated_at.isoformat() if self.last_generated_at else None,
            "generated_by": self.generated_by,
            "is_comprehensive": self.is_comprehensive,
        }

    @classmethod
    def from_dict(cls, data):
        rpt = cls(
            name=data["name"],
            description=data.get("description"),
            report_type=data["report_type"],
            schedule=data.get("schedule"),
            is_active=data.get("is_active", True),
            created_by=data["created_by"],
            modified_by=data.get("modified_by"),
            download_count=data.get("download_count", 0),
            language=data.get("language", "ar"),
            format_type=data.get("format_type", "pdf"),
            content=data.get("content"),
            file_path=data.get("file_path"),
            file_size=data.get("file_size", 0),
            generation_time=data.get("generation_time"),
            error_message=data.get("error_message"),
            status=data.get("status", "pending"),
            last_generated_at=data.get("last_generated_at"),
            generated_by=data.get("generated_by"),
            is_comprehensive=data.get("is_comprehensive", False),
        )
        if "params" in data and isinstance(data["params"], dict):
            rpt.params = json.dumps(data["params"])
        if "metadata" in data and isinstance(data["metadata"], dict):
            rpt.metadata_json = json.dumps(data["metadata"])
        return rpt

    def __repr__(self):
        return f"<Report {self.name}>"


class GeneratedReport(db.Model, BaseModel):
    __tablename__ = "generated_reports"
    __table_args__ = {"extend_existing": True}

    id              = db.Column(db.Integer, primary_key=True)
    report_id       = db.Column(db.Integer, db.ForeignKey("reports.id"), nullable=True)
    report_type     = db.Column(db.String(50), nullable=True)
    parameters      = db.Column(db.Text, nullable=True)
    generated_at    = db.Column(db.DateTime, default=datetime.utcnow)
    created_at      = db.Column(db.DateTime, default=datetime.utcnow)
    content         = db.Column(db.Text, nullable=True)
    format          = db.Column(db.String(20), default="html")
    file_path       = db.Column(db.String(255), nullable=True)
    file_size       = db.Column(db.Integer, nullable=True)
    generation_time = db.Column(db.Float, nullable=True)
    status          = db.Column(db.String(20), default="completed")
    error_message   = db.Column(db.Text, nullable=True)
    metadata_json   = db.Column('metadata', db.Text, nullable=True)  # استخدام اسم مختلف للكولومن
    download_count  = db.Column(db.Integer, default=0)  # عدد مرات التحميل

    def to_dict(self):
        return {
            "id": self.id,
            "report_id": self.report_id,
            "report_type": self.report_type,
            "parameters": json.loads(self.parameters) if self.parameters else {},
            "generated_at": self.generated_at.isoformat() if self.generated_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "content": self.content,
            "format": self.format,
            "file_path": self.file_path,
            "file_size": self.file_size,
            "generation_time": self.generation_time,
            "status": self.status,
            "error_message": self.error_message,
            "metadata": json.loads(self.metadata_json) if self.metadata_json else {},
            "download_count": self.download_count
        }

    @classmethod
    def from_dict(cls, data):
        gr = cls(
            report_id=data["report_id"],
            report_type=data.get("report_type"),
            parameters=json.dumps(data.get("parameters", {})),
            content=data.get("content"),
            format=data.get("format", "html"),
            file_path=data.get("file_path"),
            file_size=data.get("file_size"),
            generation_time=data.get("generation_time"),
            status=data.get("status", "completed"),
            error_message=data.get("error_message"),
            download_count=data.get("download_count", 0),
        )
        if "metadata" in data and isinstance(data["metadata"], dict):
            gr.metadata_json = json.dumps(data["metadata"])
        return gr

    def __repr__(self):
        return f"<GeneratedReport {self.id} for Report {self.report_id}>"







        # ----------------------------------------------------------------------
# جدول الاشتراكات (Subscriptions)
# ----------------------------------------------------------------------
class Subscription(db.Model):
    __tablename__ = "subscriptions"
    id             = db.Column(db.Integer, primary_key=True)
    user_id        = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    device_id      = db.Column(db.Integer, db.ForeignKey("devices.id"), nullable=True)
    next_renewal   = db.Column(db.Date, nullable=False)
    reminder_days  = db.Column(db.String(20), default="7,3,1")
    active         = db.Column(db.Boolean, default=True)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)
    modified_at    = db.Column(db.DateTime, onupdate=datetime.utcnow)

    user   = db.relationship("User", backref="subscriptions")
    device = db.relationship("Device", backref="subscriptions")

    def due_reminders(self):
        """ترجع قائمة بالأيام المتبقية التي ينبغي إرسال تذكير لها اليوم."""
        today = datetime.utcnow().date()
        days_left = (self.next_renewal - today).days
        return [int(d) for d in self.reminder_days.split(",") if int(d) == days_left]

    def __repr__(self):
        return f"<Subscription user={self.user_id} next_renewal={self.next_renewal}>"


class License(db.Model):
    __tablename__ = "licenses"
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.String(100), nullable=False)
    license_key = db.Column(db.String(512), unique=True, nullable=False)
    license_type = db.Column(db.String(50), nullable=False)
    features = db.Column(db.Text, nullable=True)  # JSON: قائمة الميزات
    issued_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    max_servers = db.Column(db.Integer, default=1)
    max_users = db.Column(db.Integer, default=1)
    status = db.Column(db.String(20), default="active")
    digital_signature = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {
            "id": self.id,
            "organization_id": self.organization_id,
            "license_key": self.license_key,
            "license_type": self.license_type,
            "features": json.loads(self.features or '{}'),
            "issued_at": self.issued_at.isoformat() if self.issued_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "max_servers": self.max_servers,
            "max_users": self.max_users,
            "status": self.status,
            "digital_signature": self.digital_signature,
            "is_active": self.is_active,
        }

class LicenseActivation(db.Model):
    __tablename__ = "license_activations"
    id = db.Column(db.Integer, primary_key=True)
    license_id = db.Column(db.Integer, db.ForeignKey("licenses.id"), nullable=False)
    server_id = db.Column(db.Integer, db.ForeignKey("servers.id"), nullable=False)
    ip_address = db.Column(db.String(45), nullable=True)
    activated_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_heartbeat = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default="active")

    def to_dict(self):
        return {
            "id": self.id,
            "license_id": self.license_id,
            "server_id": self.server_id,
            "ip_address": self.ip_address,
            "activated_at": self.activated_at.isoformat() if self.activated_at else None,
            "last_heartbeat": self.last_heartbeat.isoformat() if self.last_heartbeat else None,
            "status": self.status,
        }


