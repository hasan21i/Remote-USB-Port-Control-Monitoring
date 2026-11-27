-- =========================================================
-- جدول الأجهزة المعلقة المعزول: server_pending_devices
-- =========================================================

CREATE TABLE IF NOT EXISTS public.server_pending_devices (
    id                  BIGSERIAL PRIMARY KEY,
    server_id           INTEGER NOT NULL DEFAULT 1,
    device_id           TEXT NOT NULL,
    name                TEXT,
    product             TEXT,
    serial_number       TEXT,
    vendor_id           TEXT,
    product_id          TEXT,
    manufacturer        TEXT,
    device_class        TEXT,
    device_type         TEXT,
    device_hash         TEXT,
    firmware_version    TEXT,
    usb_port            TEXT,
    physical_path       TEXT,
    bus_number          TEXT,
    port_path           TEXT,
    speed_class         TEXT,
    max_packet_size     INTEGER,
    risk_level          TEXT DEFAULT 'high',
    security_score      FLOAT,
    policy_compliance   BOOLEAN DEFAULT FALSE,
    compatibility_score FLOAT,
    blocked_at          TIMESTAMPTZ DEFAULT NOW(),
    connection_time     TIMESTAMPTZ DEFAULT NOW(),
    last_activity       TIMESTAMPTZ DEFAULT NOW(),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    meta_data           TEXT,
    notes               TEXT,
    UNIQUE (server_id, device_id)
);

-- إيقاف الحماية (RLS) مؤقتاً للجدول حتى يكتب السيرفر بحرية
ALTER TABLE public.server_pending_devices DISABLE ROW LEVEL SECURITY;

-- حذف السياسة القديمة إن وُجدت، ثم إنشاء سياسة تسمح بالكل (كإجراء احتياطي)
DROP POLICY IF EXISTS "Enable all operations for all users" ON public.server_pending_devices;

CREATE POLICY "Enable all operations for all users" 
ON public.server_pending_devices 
FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);

COMMENT ON TABLE public.server_pending_devices IS
    'جدول معزول للأجهزة المحظورة المنتظرة موافقة الأدمن. يُنظَّف تلقائياً عند إغلاق الباك إند.';
