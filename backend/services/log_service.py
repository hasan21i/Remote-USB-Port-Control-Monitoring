import json
from datetime import datetime
from flask import current_app
from extensions import db, socketio
from models import Log, User, Device
from services.blockchain_service import create_blockchain_record
from utils import generate_alert, get_geo_location
from typing import Optional, List, Tuple

def create_log(
    action: str,
    user_id: Optional[int] = None,
    target_device: Optional[str] = None,
    ip_address: Optional[str] = None,
    details: Optional[dict] = None,
    success: bool = True,
    duration: Optional[float] = None,
    session_id: Optional[str] = None,
    browser_info: Optional[str] = None
) -> Log:
    """Create, persist, broadcast, blockchain-record, and return a new log entry."""
    entry = Log(
        action=action,
        user_id=user_id,
        target_device=target_device,
        ip_address=ip_address,
        success=success,
        duration=duration,
        session_id=session_id,
        browser_info=browser_info,
        timestamp=datetime.utcnow()
    )
    if isinstance(details, dict):
        entry.details = json.dumps(details)
    elif isinstance(details, str):
        entry.details = details

    db.session.add(entry)
    db.session.commit()

    # Emit via SocketIO
    try:
        socketio.emit("new_log", entry.to_dict(), namespace="/logs")
    except Exception:
        current_app.logger.exception("SocketIO emit failed for new_log")

    # Blockchain record
    try:
        create_blockchain_record(
            "log_created",
            {
                "log_id": entry.id,
                "action": action,
                "user_id": user_id,
                "target_device": target_device,
                "success": success
            },
            user_id
        )
    except Exception:
        current_app.logger.exception("Blockchain record failed for log_created")

    return entry

def query_logs(
    action: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    user_id: Optional[int] = None,
    device_serial: Optional[str] = None,
    limit: int = 20,
    offset: int = 0
) -> Tuple[List[dict], int]:
    """Fetch logs with optional filtering, return (items_as_dicts, total_count)."""
    q = Log.query
    if action:
        q = q.filter(Log.action == action)
    if start_date:
        q = q.filter(Log.timestamp >= start_date)
    if end_date:
        q = q.filter(Log.timestamp < end_date)
    if user_id:
        q = q.filter(Log.user_id == user_id)
    if device_serial:
        q = q.filter(Log.target_device == device_serial)

    total = q.count()
    logs = q.order_by(Log.timestamp.desc()).limit(limit).offset(offset).all()

    result = []
    for l in logs:
        d = l.to_dict()
        if l.user_id:
            u = User.query.get(l.user_id)
            if u:
                d["user"] = {"id": u.id, "username": u.username}
        if l.target_device:
            dev = Device.query.filter_by(serial_number=l.target_device).first()
            if dev:
                d["device"] = {
                    "id": dev.id,
                    "name": dev.name,
                    "serial_number": dev.serial_number
                }
        result.append(d)

    return result, total


def log_usb_transfer(
    serial_number: str,
    user_id: Optional[int],
    transfer_size: int,
    transfer_type: str,  # 'read' أو 'write'
    filename: Optional[str] = None,
    success: bool = True,
    ip_address: Optional[str] = None
) -> Log:
    """
    سجل عملية نقل بيانات عبر USB (قراءة/كتابة) في جدول Log.
    - serial_number: معرف الجهاز
    - user_id: معرف المستخدم
    - transfer_size: حجم النقل بالبايت
    - transfer_type: 'read' أو 'write'
    - filename: اسم الملف (اختياري)
    - success: هل نجحت العملية
    - ip_address: عنوان IP (اختياري)
    """
    details = {
        'transfer_size': transfer_size,
        'transfer_type': transfer_type,
        'filename': filename,
    }
    # جلب الموقع الجغرافي إذا توفر IP
    geo = get_geo_location(ip_address) if ip_address else None
    if geo:
        details['geo_location'] = geo
    entry = Log(
        action='usb_transfer',
        user_id=user_id,
        target_device=serial_number,
        ip_address=ip_address,
        details=json.dumps(details),
        success=success,
        timestamp=datetime.utcnow()
    )
    db.session.add(entry)
    db.session.commit()
    # Emit via SocketIO
    try:
        socketio.emit("new_log", entry.to_dict(), namespace="/logs")
    except Exception:
        current_app.logger.exception("SocketIO emit failed for new_log (usb_transfer)")
    # Blockchain record
    try:
        create_blockchain_record(
            "log_usb_transfer",
            {
                "log_id": entry.id,
                "user_id": user_id,
                "serial_number": serial_number,
                "transfer_size": transfer_size,
                "transfer_type": transfer_type,
                "filename": filename,
                "success": success,
                "geo_location": geo
            },
            user_id
        )
    except Exception:
        current_app.logger.exception("Blockchain record failed for log_usb_transfer")
    return entry

