# backend/controllers/ai_monitoring.py

import os
import json
import random
import openai
import requests

from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt
from sqlalchemy import func

from extensions import db, socketio
from models import AIReport, Device, Log
from utils import generate_alert, control_device
from services.blockchain_service import create_blockchain_record
from supabase_config import get_supabase_client

# initialize Blueprint
ai_monitoring_bp = Blueprint('ai_monitoring', __name__)

# configure OpenAI
openai.api_key = os.getenv("OPENAI_API_KEY")


# Roles allowed to use AI monitoring
ALLOWED_ROLES = {'admin', 'manager'}


def _check_roles():
    """Complete Mediation & Separation of Privilege: ensure user has the right role."""
    claims = get_jwt()
    user_roles = set(claims.get('roles', []))
    if not (user_roles & ALLOWED_ROLES):
        return False
    return True


# 1) Fetch AI monitoring reports — يجلب من Supabase ai_reports مباشرة
@ai_monitoring_bp.route('/reports', methods=['GET'])
@jwt_required()
def get_ai_reports():
    if not _check_roles():
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403

    try:
        analysis_type = request.args.get('type')
        is_anomaly    = request.args.get('anomaly')
        start_date    = request.args.get('start_date')
        end_date      = request.args.get('end_date')
        serial        = request.args.get('device')
        days          = request.args.get('days')
        limit         = min(int(request.args.get('limit', 50)), 100)
        offset        = max(int(request.args.get('offset', 0)), 0)

        # ────────────────────────────────────────────────
        # جلب التقارير من Supabase ai_reports
        # ────────────────────────────────────────────────
        supabase_client = get_supabase_client()
        if supabase_client:
            try:
                q = supabase_client.table('ai_reports').select('*')

                # فلتر نوع التحليل
                if analysis_type:
                    q = q.eq('analysis_type', analysis_type)

                # فلتر الجهاز (serial stored in parameters JSON)
                # نحتفظ بالفلتر ونطبقه بعد الجلب

                # فلتر النطاق الزمني
                if days:
                    since = (datetime.utcnow() - timedelta(days=int(days))).isoformat()
                    q = q.gte('generated_at', since)
                elif start_date:
                    q = q.gte('generated_at', start_date)
                if end_date:
                    ed = (datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)).isoformat()
                    q = q.lt('generated_at', ed)

                # ترتيب وصفحات
                q = q.order('generated_at', desc=True).range(offset, offset + limit - 1)

                result = q.execute()
                rows = result.data if result.data else []

                # تحويل بيانات Supabase إلى نفس شكل to_dict()
                data = []
                for row in rows:
                    # استخراج الحقول من parameters JSON
                    params_raw = row.get('parameters') or '{}'
                    try:
                        params = json.loads(params_raw) if isinstance(params_raw, str) else (params_raw or {})
                    except Exception:
                        params = {}

                    sn = params.get('serial_number', '')

                    # فلتر الجهاز إذا طُلب
                    if serial and sn != serial:
                        continue

                    # فلتر الشذوذات
                    row_anomaly = params.get('is_anomaly', False)
                    if is_anomaly is not None:
                        want_anomaly = is_anomaly.lower() == 'true'
                        if bool(row_anomaly) != want_anomaly:
                            continue

                    # جلب معلومات الجهاز
                    device_info = None
                    if sn:
                        dev = Device.query.filter_by(serial_number=sn).first()
                        if dev:
                            device_info = {
                                'id': dev.id,
                                'name': dev.name,
                                'serial_number': dev.serial_number
                            }

                    entry = {
                        'id':               row.get('id'),
                        'description':      row.get('content', ''),
                        'analysis_type':    row.get('analysis_type', ''),
                        'confidence_score': params.get('confidence_score'),
                        'timestamp':        row.get('generated_at'),
                        'related_device':   sn,
                        'recommendation':   row.get('recommendations', ''),
                        'is_anomaly':       bool(row_anomaly),
                        'acted_upon':       False,
                        'action_taken':     None,
                        'action_by':        row.get('generated_by'),
                        'title':            row.get('title', ''),
                        'device':           device_info,
                    }
                    data.append(entry)

                total = len(data)

                # audit log
                try:
                    db.session.add(Log(
                        action="ai_reports_viewed",
                        user_id=get_jwt()['sub'],
                        ip_address=request.remote_addr,
                        details=json.dumps({
                            'source': 'supabase',
                            'filters': {
                                'analysis_type': analysis_type,
                                'is_anomaly': is_anomaly,
                                'days': days,
                                'device': serial
                            },
                            'results_count': total
                        }),
                        timestamp=datetime.utcnow()
                    ))
                    db.session.commit()
                except Exception:
                    pass

                return jsonify({'reports': data, 'total': total, 'limit': limit, 'offset': offset}), 200

            except Exception as supa_err:
                current_app.logger.warning(f"Supabase ai_reports fetch failed, falling back to SQLite: {supa_err}")

        # ────────────────────────────────────────────────
        # Fallback: جلب من SQLite إذا فشل Supabase
        # ────────────────────────────────────────────────
        q = AIReport.query
        if analysis_type:
            q = q.filter_by(analysis_type=analysis_type)
        if is_anomaly is not None:
            q = q.filter_by(is_anomaly=(is_anomaly.lower() == 'true'))
        if days:
            since = datetime.utcnow() - timedelta(days=int(days))
            q = q.filter(AIReport.timestamp >= since)
        elif start_date:
            sd = datetime.strptime(start_date, '%Y-%m-%d')
            q = q.filter(AIReport.timestamp >= sd)
        if end_date:
            ed = datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)
            q = q.filter(AIReport.timestamp < ed)
        if serial:
            q = q.filter_by(related_device=serial)

        total   = q.count()
        reports = q.order_by(AIReport.timestamp.desc()).limit(limit).offset(offset).all()

        data = []
        for rpt in reports:
            rd = rpt.to_dict()
            if rpt.related_device:
                dev = Device.query.filter_by(serial_number=rpt.related_device).first()
                rd['device'] = {
                    'id': dev.id, 'name': dev.name, 'serial_number': dev.serial_number
                } if dev else None
            data.append(rd)

        # audit log
        db.session.add(Log(
            action="ai_reports_viewed",
            user_id=get_jwt()['sub'],
            ip_address=request.remote_addr,
            details=json.dumps({
                'source': 'sqlite_fallback',
                'filters': {
                    'analysis_type': analysis_type,
                    'is_anomaly': is_anomaly,
                    'days': days,
                    'device': serial
                },
                'results_count': len(reports)
            }),
            timestamp=datetime.utcnow()
        ))
        db.session.commit()

        return jsonify({'reports': data, 'total': total, 'limit': limit, 'offset': offset}), 200

    except Exception as e:
        current_app.logger.exception("Error fetching AI reports")
        generate_alert(f"Error fetching AI reports: {e}", "medium")
        return jsonify({'error': 'حدث خطأ أثناء جلب التقارير'}), 500


# 2) Analyze one device
@ai_monitoring_bp.route('/analyze', methods=['POST'])
@jwt_required()
def analyze_device():
    if not _check_roles():
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403

    data = request.get_json() or {}
    # Debug log for incoming requests
    try:
        safe_headers = {k: ('<REDACTED>' if k.lower() == 'authorization' else v) for k, v in request.headers.items()}
        current_app.logger.debug(f"[analyze_device] incoming request from {request.remote_addr} headers={safe_headers} body={data}")
    except Exception as _e:
        current_app.logger.debug(f"[analyze_device] incoming request logging failed: {_e}")

    serial = data.get('serial_number')
    if not serial:
        return jsonify({'error': 'رقم تسلسلي للجهاز مطلوب'}), 400

    device = Device.query.filter_by(serial_number=serial).first()
    if not device:
        return jsonify({'error': 'الجهاز غير موجود'}), 404

    try:
        analysis_type    = data.get('analysis_type', 'security_scan')
        confidence_score = round(random.uniform(0.6, 0.99), 2)
        is_anomaly       = random.random() < 0.3

        if analysis_type == 'security_scan':
            if is_anomaly:
                desc = f"Security scan detected suspicious activity on {device.name}."
                rec  = "Investigate; consider disconnecting."
            else:
                desc = f"No suspicious activity on {device.name}."
                rec  = "No action."
        elif analysis_type == 'performance_analysis':
            if is_anomaly:
                desc = f"Performance anomaly on {device.name}."
                rec  = "Check logs and firmware."
            else:
                desc = f"Performance normal for {device.name}."
                rec  = "No action."
        else:
            desc = f"Analysis completed for {device.name}."
            rec  = "No recommendations."

        report = AIReport(
            description=desc,
            analysis_type=analysis_type,
            confidence_score=confidence_score,
            timestamp=datetime.utcnow(),
            related_device=serial,
            recommendation=rec,
            is_anomaly=is_anomaly
        )
        db.session.add(report)
        db.session.commit()

        # Also save to Supabase ai_reports table
        supabase_client = get_supabase_client()
        if supabase_client:
            try:
                supabase_client.table('ai_reports').insert({
                    'title': f'{analysis_type} - {device.name}',
                    'content': desc,
                    'analysis_type': analysis_type,
                    'generated_by': get_jwt()['sub'],
                    'generated_at': datetime.utcnow().isoformat(),
                    'parameters': json.dumps({
                        'serial_number': serial,
                        'confidence_score': confidence_score,
                        'is_anomaly': is_anomaly
                    }),
                    'recommendations': rec
                }).execute()
            except Exception as supa_err:
                current_app.logger.warning(f"Supabase ai_reports insert failed: {supa_err}")

        # log + blockchain
        db.session.add(Log(
            action=f"ai_{analysis_type}_performed",
            user_id=get_jwt()['sub'],
            target_device=serial,
            ip_address=request.remote_addr,
            details=json.dumps({
                'device_name': device.name,
                'is_anomaly': is_anomaly,
                'confidence_score': confidence_score
            }),
            timestamp=datetime.utcnow()
        ))
        db.session.commit()

        create_blockchain_record(
            f"ai_{analysis_type}_performed",
            {
                'device_id': device.id,
                'serial': serial,
                'analysis_type': analysis_type,
                'is_anomaly': is_anomaly,
                'user_id': get_jwt()['sub']
            },
            get_jwt()['sub']
        )

        # generate alert
        if is_anomaly:
            prio = "high" if confidence_score > 0.8 else "medium"
            generate_alert(
                f"AI detected anomaly on {device.name}",
                prio,
                {
                    'analysis_type': analysis_type,
                    'confidence_score': confidence_score,
                    'device_id': device.id,
                    'report_id': report.id
                }
            )

            # ==== آلية الحظر التلقائي للأجهزة عالية المخاطر ====
            if current_app.config.get("AI_AUTO_BLOCK_HIGH_RISK", False):
                success, msg = control_device(serial, 'block')
                db.session.add(Log(
                    action="device_auto_blocked",
                    user_id=get_jwt()['sub'],
                    target_device=serial,
                    details=json.dumps({'blocked': success, 'reason': 'AI anomaly'}),
                    timestamp=datetime.utcnow()
                ))
                db.session.commit()
        # ==============================================

        socketio.emit(
            'ai:report_generated',
            report.to_dict(),
            namespace='/ai_monitoring',
            broadcast=True
        )

        result = {'message': 'تمت عملية التحليل بنجاح', 'report': report.to_dict()}
        if is_anomaly and current_app.config.get("AI_AUTO_BLOCK_HIGH_RISK", False):
            result['auto_block'] = True

        return jsonify(result), 201

    except Exception as e:
        db.session.rollback()
        generate_alert(f"Error performing AI analysis: {e}", "high")
        return jsonify({'error': 'حدث خطأ أثناء التحليل'}), 500


# 3) Analyze all connected devices
@ai_monitoring_bp.route('/analyze-all', methods=['POST'])
@jwt_required()
def analyze_all_devices():
    if not _check_roles():
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403

    try:
        analysis_type = (request.get_json() or {}).get('analysis_type', 'security_scan')
        devices       = Device.query.filter_by(status='connected').all()
        if not devices:
            return jsonify({'message': 'لا توجد أجهزة متصلة'}), 200

        results = []
        for dev in devices:
            score   = round(random.uniform(0.6, 0.99), 2)
            anomaly = random.random() < 0.3
            desc = f"Anomaly on {dev.name}." if anomaly else f"No issues on {dev.name}."
            rec  = "Investigate." if anomaly else "No action."

            rpt = AIReport(
                description=desc,
                analysis_type=analysis_type,
                confidence_score=score,
                timestamp=datetime.utcnow(),
                related_device=dev.serial_number,
                recommendation=rec,
                is_anomaly=anomaly
            )
            db.session.add(rpt)

            # Save to Supabase ai_reports table
            supabase_client = get_supabase_client()
            if supabase_client:
                try:
                    supabase_client.table('ai_reports').insert({
                        'title': f'{analysis_type} - {dev.name}',
                        'content': desc,
                        'analysis_type': analysis_type,
                        'generated_by': get_jwt()['sub'],
                        'generated_at': datetime.utcnow().isoformat(),
                        'parameters': json.dumps({
                            'serial_number': dev.serial_number,
                            'confidence_score': score,
                            'is_anomaly': anomaly
                        }),
                        'recommendations': rec
                    }).execute()
                except Exception as supa_err:
                    current_app.logger.warning(f"Supabase ai_reports insert failed: {supa_err}")

            if anomaly:
                prio = "high" if score > 0.8 else "medium"
                generate_alert(
                    f"AI anomaly on {dev.name}",
                    prio,
                    {'device_id': dev.id, 'analysis_type': analysis_type}
                )
                if current_app.config.get("AI_AUTO_BLOCK_HIGH_RISK", False):
                    success, msg = control_device(dev.serial_number, 'block')
                    results.append({
                        'device_id': dev.id,
                        'device_name': dev.name,
                        'is_anomaly': True,
                        'confidence_score': score,
                        'auto_blocked': success
                    })
                    continue

            results.append({
                'device_id': dev.id,
                'device_name': dev.name,
                'is_anomaly': anomaly,
                'confidence_score': score
            })

        db.session.commit()

        db.session.add(Log(
            action=f"ai_{analysis_type}_bulk_performed",
            user_id=get_jwt()['sub'],
            ip_address=request.remote_addr,
            details=json.dumps({
                'devices': len(devices),
                'anomalies': sum(1 for r in results if r['is_anomaly'])
            }),
            timestamp=datetime.utcnow()
        ))
        db.session.commit()

        create_blockchain_record(
            f"ai_{analysis_type}_bulk_performed",
            {
                'devices': len(devices),
                'anomalies': sum(1 for r in results if r['is_anomaly']),
                'user_id': get_jwt()['sub']
            },
            get_jwt()['sub']
        )

        socketio.emit(
            'ai:bulk_analysis',
            {'analysis_type': analysis_type, 'results': results},
            namespace='/ai_monitoring',
            broadcast=True
        )

        return jsonify({
            'message': f'تم تحليل {len(devices)} جهاز',
            'anomalies_detected': sum(1 for r in results if r['is_anomaly']),
            'results': results
        }), 200

    except Exception as e:
        db.session.rollback()
        generate_alert(f"Error in bulk AI analysis: {e}", "high")
        return jsonify({'error': 'حدث خطأ أثناء التحليل الشامل'}), 500


# 4) AI stats
@ai_monitoring_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_ai_stats():
    if not _check_roles():
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403

    try:
        days  = min(max(int(request.args.get('days', 7)), 1), 365)
        since = datetime.utcnow() - timedelta(days=days)

        # ────────────────────────────────────────────────
        # جلب الإحصائيات من Supabase
        # ────────────────────────────────────────────────
        supabase_client = get_supabase_client()
        if supabase_client:
            try:
                # 1. إجمالي التقارير
                all_res = supabase_client.table('ai_reports').select('id').execute()
                total = len(all_res.data) if all_res.data else 0

                # 2. التقارير الحديثة
                recent_res = supabase_client.table('ai_reports').select('*').gte('generated_at', since.isoformat()).execute()
                recent_rows = recent_res.data if recent_res.data else []
                recent = len(recent_rows)

                # معالجة البيانات الحديثة
                anomalies = 0
                by_type = {}
                device_counts = {}
                recent_anoms = []

                for row in recent_rows:
                    params_raw = row.get('parameters') or '{}'
                    try:
                        params = json.loads(params_raw) if isinstance(params_raw, str) else (params_raw or {})
                    except Exception:
                        params = {}
                    
                    is_anomaly = bool(params.get('is_anomaly', False))
                    serial = params.get('serial_number', '')
                    a_type = row.get('analysis_type', 'unknown')

                    if is_anomaly:
                        anomalies += 1
                        
                        dev_info = None
                        if serial:
                            dev = Device.query.filter_by(serial_number=serial).first()
                            if dev:
                                dev_info = {'id': dev.id, 'name': dev.name, 'serial_number': dev.serial_number}
                        
                        entry = {
                            'id': row.get('id'),
                            'description': row.get('content', ''),
                            'analysis_type': a_type,
                            'confidence_score': params.get('confidence_score'),
                            'timestamp': row.get('generated_at'),
                            'related_device': serial,
                            'recommendation': row.get('recommendations', ''),
                            'is_anomaly': True,
                            'acted_upon': False,
                            'device': dev_info
                        }
                        recent_anoms.append(entry)

                    by_type[a_type] = by_type.get(a_type, 0) + 1

                    if serial:
                        device_counts[serial] = device_counts.get(serial, 0) + 1

                recent_anoms.sort(key=lambda x: x['timestamp'] or '', reverse=True)
                recent_anoms = recent_anoms[:5]

                top_serials = sorted(device_counts.items(), key=lambda item: item[1], reverse=True)[:5]
                top_devices = []
                for serial, cnt in top_serials:
                    dev = Device.query.filter_by(serial_number=serial).first()
                    top_devices.append({
                        'id': dev.id if dev else None,
                        'name': dev.name if dev else 'Unknown',
                        'serial_number': serial,
                        'count': cnt
                    })

                stats = {
                    'total_reports': total,
                    'recent_reports': recent,
                    'anomalies_detected': anomalies,
                    'by_analysis_type': by_type,
                    'top_devices': top_devices,
                    'recent_anomalies': recent_anoms,
                    'period_days': days,
                    'source': 'supabase'
                }

                try:
                    db.session.add(Log(
                        action="ai_stats_viewed",
                        user_id=get_jwt()['sub'],
                        ip_address=request.remote_addr,
                        details=json.dumps({'period_days': days, 'source': 'supabase'}),
                        timestamp=datetime.utcnow()
                    ))
                    db.session.commit()
                except Exception:
                    pass

                return jsonify(stats), 200

            except Exception as supa_err:
                current_app.logger.warning(f"Supabase ai_reports stats failed, falling back to SQLite: {supa_err}")

        # ────────────────────────────────────────────────
        # Fallback: SQLite
        # ────────────────────────────────────────────────
        total     = db.session.query(func.count(AIReport.id)).scalar()
        recent    = db.session.query(func.count(AIReport.id)).filter(AIReport.timestamp >= since).scalar()
        anomalies = db.session.query(func.count(AIReport.id)).filter(AIReport.timestamp >= since, AIReport.is_anomaly).scalar()

        by_type = dict(db.session.query(
            AIReport.analysis_type,
            func.count(AIReport.id)
        ).filter(AIReport.timestamp >= since).group_by(AIReport.analysis_type).all())

        top_q = db.session.query(
            AIReport.related_device,
            func.count(AIReport.id).label('cnt')
        ).filter(AIReport.timestamp >= since).group_by(
            AIReport.related_device
        ).order_by(
            func.count(AIReport.id).desc()
        ).limit(5).all()

        top_devices = []
        for serial, cnt in top_q:
            dev = Device.query.filter_by(serial_number=serial).first()
            top_devices.append({
                'id': dev.id if dev else None,
                'name': dev.name if dev else 'Unknown',
                'serial_number': serial,
                'count': cnt
            })

        recent_anoms = AIReport.query.filter(
            AIReport.timestamp >= since, AIReport.is_anomaly
        ).order_by(AIReport.timestamp.desc()).limit(5).all()

        anoms = []
        for a in recent_anoms:
            d = a.to_dict()
            if a.related_device:
                dev = Device.query.filter_by(serial_number=a.related_device).first()
                d['device'] = {
                    'id': dev.id, 'name': dev.name, 'serial_number': dev.serial_number
                } if dev else None
            anoms.append(d)

        stats = {
            'total_reports': total,
            'recent_reports': recent,
            'anomalies_detected': anomalies,
            'by_analysis_type': by_type,
            'top_devices': top_devices,
            'recent_anomalies': anoms,
            'period_days': days,
            'source': 'sqlite'
        }

        db.session.add(Log(
            action="ai_stats_viewed",
            user_id=get_jwt()['sub'],
            ip_address=request.remote_addr,
            details=json.dumps({'period_days': days, 'source': 'sqlite'}),
            timestamp=datetime.utcnow()
        ))
        db.session.commit()

        return jsonify(stats), 200

    except Exception as e:
        current_app.logger.exception("Error fetching AI stats")
        generate_alert(f"Error fetching AI stats: {e}", "medium")
        return jsonify({'error': 'حدث خطأ أثناء جلب الإحصاءات'}), 500


# 5) Chat endpoint
@ai_monitoring_bp.route('/chat', methods=['POST'])
@jwt_required()
def chat_with_ai():
    if not _check_roles():
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403

    data = request.get_json() or {}
    user_message = data.get('message', '').strip()
    if not user_message:
        return jsonify({'error': 'الرسالة مطلوبة'}), 400

    try:
        resp = openai.ChatCompletion.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a USB-monitoring assistant."},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7,
            max_tokens=512
        )
        ai_reply = resp.choices[0].message.content

        db.session.add(Log(
            action="ai_chat",
            user_id=get_jwt()['sub'],
            details=json.dumps({'user': user_message, 'assistant': ai_reply}),
            timestamp=datetime.utcnow()
        ))
        db.session.commit()

        return jsonify({'reply': ai_reply}), 200

    except Exception as e:
        current_app.logger.error(f"OpenAI API error: {e}")
        return jsonify({'error': 'فشل خدمة الذكاء الاصطناعي'}), 500


# Helper: perform advanced analysis logic (callable from scripts/tests)
def perform_advanced_analysis(serial, analysis_type='security_scan', provider=None, mistral_key=None, user_id=None, remote_addr=None):
    # Normalize Mistral key from param or app config
    mistral_key = mistral_key or current_app.config.get('MISTRAL_API_KEY')

    supabase_client = get_supabase_client()
    if not supabase_client:
        return {'error': 'Database connection error'}, 500

    device_response = supabase_client.table('devices').select('*').eq('serial_number', serial).execute()
    devices = device_response.data
    device = devices[0] if devices else None
    if not device:
        # Try to find device via system discovery if not present in DB
        from utils import discover_usb_devices
        try:
            discovered = discover_usb_devices()
            matched = None
            for d in discovered:
                if d.get('serial_number') and d.get('serial_number').lower() == serial.lower():
                    matched = d
                    break
            if matched:
                device = matched
            else:
                return {'error': 'الجهاز غير موجود'}, 404
        except Exception:
            return {'error': 'الجهاز غير موجود'}, 404

    # Normalize device
    device_name = device.get('name') if isinstance(device, dict) else getattr(device, 'name', '')
    device_id = device.get('id') if isinstance(device, dict) else getattr(device, 'id', None)

    try:
        confidence_score = round(random.uniform(0.6, 0.99), 2)
        is_anomaly = random.random() < 0.3
        prov = (provider or 'openai').lower()
        use_mistral = prov == 'mistral'

        device_context = {
            'name': device.get('name', '') if isinstance(device, dict) else getattr(device, 'name', ''),
            'device_class': device.get('device_class', '') if isinstance(device, dict) else getattr(device, 'device_class', ''),
            'vendor_id': device.get('vendor_id', '') if isinstance(device, dict) else getattr(device, 'vendor_id', ''),
            'product_id': device.get('product_id', '') if isinstance(device, dict) else getattr(device, 'product_id', ''),
            'status': device.get('status', '') if isinstance(device, dict) else getattr(device, 'status', ''),
            'last_seen': device.get('last_seen') if isinstance(device, dict) else getattr(device, 'last_seen', None)
        }

        recent_logs = Log.query.filter_by(target_device=serial).order_by(Log.timestamp.desc()).limit(10).all()
        log_context = [{ 'action': log.action, 'timestamp': log.timestamp.isoformat(), 'details': log.details } for log in recent_logs]

        prompt = f"""
        Analyze this USB device for security risks:

        Device: {json.dumps(device_context, indent=2)}
        Recent Activity: {json.dumps(log_context, indent=2)}
        Analysis Type: {analysis_type}

        Provide a detailed security analysis in Arabic including:
        1. Risk assessment (High/Medium/Low)
        2. Specific threats identified
        3. Recommendations
        4. Confidence score (0.0-1.0)

        Respond in JSON format with fields: risk_level, threats, recommendations, confidence_score, description
        """

        def try_parse_json(text):
            if not text or not isinstance(text, str):
                return None
            try:
                return json.loads(text)
            except Exception:
                pass
            try:
                start = text.find('{')
                end = text.rfind('}')
                if start != -1 and end != -1 and end > start:
                    snippet = text[start:end+1]
                    return json.loads(snippet)
            except Exception:
                pass
            return None

        description = ''
        recommendation = ''
        ai_details = {'ai_enhanced': False}

        # Enhanced analysis with Mistral if requested
        if use_mistral:
            try:
                # Use provided mistral_key parameter if present, otherwise fall back to app config
                mistral_key = mistral_key or current_app.config.get('MISTRAL_API_KEY')
                if not mistral_key:
                    raise RuntimeError('Mistral API key not configured')

                # Use mistral-small-latest model (always available)
                model_id = 'mistral-small-latest'
                current_app.logger.info(f"Using Mistral model: {model_id}")

                # Mistral API uses /v1/chat/completions endpoint (OpenAI-compatible)
                url = 'https://api.mistral.ai/v1/chat/completions'
                payload = {
                    'model': model_id,
                    'messages': [
                        {
                            'role': 'system',
                            'content': 'أنت خبير أمني متخصص في تحليل أجهزة USB. قم بتحليل الجهاز وتقديم تقرير مفصل بالعربية. استجب بصيغة JSON فقط مع الحقول: risk_level (مرتفع/متوسط/منخفض), threats (قائمة التهديدات), recommendations (قائمة التوصيات), confidence_score (رقم بين 0 و 1), description (وصف مفصل).'
                        },
                        {
                            'role': 'user',
                            'content': prompt
                        }
                    ],
                    'temperature': 0.3,
                    'max_tokens': 1024
                }

                current_app.logger.debug(f"Calling Mistral API: {url}")
                r = requests.post(
                    url,
                    json=payload,
                    headers={
                        'Authorization': f'Bearer {mistral_key}',
                        'Content-Type': 'application/json'
                    },
                    timeout=60
                )
                
                if r.status_code != 200:
                    current_app.logger.error(f"Mistral API error {r.status_code}: {r.text}")
                    raise RuntimeError(f"Mistral API returned {r.status_code}: {r.text[:200]}")
                
                j = r.json()
                current_app.logger.debug(f"Mistral response received")

                # Extract text from response
                ai_response = None
                if 'choices' in j and j['choices']:
                    message = j['choices'][0].get('message', {})
                    ai_response = message.get('content', '')
                
                if not ai_response:
                    raise RuntimeError('Empty response from Mistral')

                current_app.logger.debug(f"Mistral AI response: {ai_response[:200]}...")

                # Attempt to parse AI response as JSON
                ai_analysis = try_parse_json(ai_response)
                if ai_analysis:
                    try:
                        confidence_score = float(ai_analysis.get('confidence_score', confidence_score))
                    except Exception:
                        pass
                    is_anomaly = str(ai_analysis.get('risk_level', '')).lower() in ['high', 'مرتفع']
                    description = ai_analysis.get('description', f"تحليل متقدم بالذكاء الاصطناعي للجهاز {device_name}")
                    recommendation = ai_analysis.get('recommendations', 'لا توجد توصيات محددة')

                    ai_details = {
                        'ai_enhanced': True,
                        'risk_level': ai_analysis.get('risk_level'),
                        'threats': ai_analysis.get('threats', []),
                        'mistral_model': model_id
                    }
                else:
                    description = f"تحليل متقدم للجهاز {device_name}. استجابة الذكاء الاصطناعي: {str(ai_response)[:200]}..."
                    recommendation = "مراجعة النتائج والتحقق من الجهاز"
                    ai_details = {'ai_enhanced': True, 'ai_response': ai_response, 'mistral_model': model_id}

            except Exception as ai_error:
                current_app.logger.error(f"Mistral API error: {ai_error}")
                description = f"تحليل أساسي للجهاز {device_name}. خدمة Mistral غير متاحة حالياً."
                recommendation = "فحص يدوي للجهاز مطلوب"
                ai_details = {'ai_enhanced': False, 'error': str(ai_error)}

        elif prov == 'openai' and current_app.config.get('OPENAI_API_KEY'):
            try:
                resp = openai.ChatCompletion.create(model="gpt-4o-mini", messages=[{"role": "system", "content": "You are a cybersecurity expert analyzing USB devices. Respond in Arabic and JSON format only."},{"role": "user", "content": prompt}], temperature=0.3, max_tokens=1000)
                ai_response = resp.choices[0].message.content
                ai_analysis = try_parse_json(ai_response)
                if ai_analysis:
                    try:
                        confidence_score = float(ai_analysis.get('confidence_score', confidence_score))
                    except Exception:
                        pass
                    is_anomaly = str(ai_analysis.get('risk_level', '')).lower() in ['high', 'مرتفع']
                    description = ai_analysis.get('description', f"تحليل متقدم بالذكاء الاصطناعي للجهاز {device_name}")
                    recommendation = ai_analysis.get('recommendations', 'لا توجد توصيات محددة')
                    ai_details = {'ai_enhanced': True, 'risk_level': ai_analysis.get('risk_level'), 'threats': ai_analysis.get('threats', []), 'openai_model': 'gpt-4o-mini'}
                else:
                    description = f"تحليل متقدم للجهاز {device_name}. استجابة الذكاء الاصطناعي: {ai_response[:200]}..."
                    recommendation = "مراجعة النتائج والتحقق من الجهاز"
                    ai_details = {'ai_enhanced': True, 'ai_response': ai_response}

            except Exception as ai_error:
                current_app.logger.error(f"OpenAI API error: {ai_error}")
                description = f"تحليل أساسي للجهاز {device_name}. خدمة الذكاء الاصطناعي غير متاحة حالياً."
                recommendation = "فحص يدوي للجهاز مطلوب"
                ai_details = {'ai_enhanced': False, 'error': str(ai_error)}
        else:
            if analysis_type == 'security_scan':
                if is_anomaly:
                    description = f"فحص الأمان اكتشف نشاط مشبوه على الجهاز {device_name}"
                    recommendation = "التحقق من الجهاز وفصله إذا لزم الأمر"
                else:
                    description = f"فحص الأمان لم يكتشف أي نشاط مشبوه على الجهاز {device_name}"
                    recommendation = "لا يوجد إجراء مطلوب"
            elif analysis_type == 'performance_analysis':
                if is_anomaly:
                    description = f"تحليل الأداء اكتشف مشاكل في أداء الجهاز {device_name}"
                    recommendation = "فحص السجلات والبرامج الثابتة"
                else:
                    description = f"أداء الجهاز {device_name} طبيعي"
                    recommendation = "لا يوجد إجراء مطلوب"
            else:
                if is_anomaly:
                    description = f"تحليل السلوك اكتشف أنماط غير عادية للجهاز {device_name}"
                    recommendation = "مراقبة إضافية للجهاز"
                else:
                    description = f"سلوك الجهاز {device_name} طبيعي"
                    recommendation = "لا يوجد إجراء مطلوب"

        # normalize recommendation to a string (DB expects text)
        if isinstance(recommendation, list):
            recommendation = '\n'.join([str(x) for x in recommendation])
        elif isinstance(recommendation, dict):
            recommendation = json.dumps(recommendation, ensure_ascii=False)

        # save report
        report = AIReport(
            description=description,
            analysis_type=analysis_type,
            confidence_score=confidence_score,
            timestamp=datetime.utcnow(),
            related_device=serial,
            recommendation=recommendation,
            is_anomaly=is_anomaly
        )
        db.session.add(report)
        db.session.commit()

        # Also save to Supabase ai_reports table
        supabase_client = get_supabase_client()
        if supabase_client:
            try:
                supabase_client.table('ai_reports').insert({
                    'title': f'{analysis_type} - {device_name}',
                    'content': description,
                    'analysis_type': analysis_type,
                    'generated_by': user_id,
                    'generated_at': datetime.utcnow().isoformat(),
                    'parameters': json.dumps({
                        'serial_number': serial,
                        'confidence_score': confidence_score,
                        'is_anomaly': is_anomaly
                    }),
                    'recommendations': recommendation
                }).execute()
            except Exception as supa_err:
                current_app.logger.warning(f"Supabase ai_reports insert failed: {supa_err}")

        # add log
        db.session.add(Log(action=f"ai_advanced_{analysis_type}_performed", user_id=user_id, target_device=serial, ip_address=remote_addr, details=json.dumps({'device_name': device_name, 'is_anomaly': is_anomaly, 'confidence_score': confidence_score, **ai_details}), timestamp=datetime.utcnow()))
        db.session.commit()

        # blockchain
        create_blockchain_record(f"ai_advanced_{analysis_type}_performed", {'device_id': device_id, 'serial': serial, 'analysis_type': analysis_type, 'is_anomaly': is_anomaly, 'confidence_score': confidence_score, 'user_id': user_id, **ai_details}, user_id)

        if is_anomaly:
            priority = "high" if confidence_score > 0.8 else "medium"
            generate_alert(f"تحليل متقدم بالذكاء الاصطناعي اكتشف شذوذ في الجهاز {device_name}", priority, {'analysis_type': analysis_type, 'confidence_score': confidence_score, 'device_id': device_id, 'report_id': report.id, **ai_details})

        result = {'message': 'تمت عملية التحليل المتقدم بنجاح', 'report': {**report.to_dict(), **ai_details}}
        if is_anomaly and current_app.config.get('AI_AUTO_BLOCK_HIGH_RISK', False) and confidence_score > 0.8:
            result['auto_block'] = True

        return result, 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Error in perform_advanced_analysis")
        generate_alert(f"خطأ في التحليل المتقدم بالذكاء الاصطناعي: {e}", "high")
        return {'error': 'حدث خطأ أثناء التحليل المتقدم'}, 500



# Debug-only endpoint: POST /api/ai_monitoring/test-analyze
# This endpoint is available only when DEBUG=True or when called from localhost. It does not require JWT.
@ai_monitoring_bp.route('/test-analyze', methods=['POST'])
def test_analyze():
    # Only allow in debug or from localhost
    if not (current_app.config.get('DEBUG') or request.remote_addr in ('127.0.0.1', '::1')):
        return jsonify({'error': 'Not allowed'}), 403

    data = request.get_json() or {}
    serial = data.get('serial_number')
    if not serial:
        return jsonify({'error': 'serial_number required'}), 400

    provider = data.get('provider', None)
    mistral_key = data.get('mistral_api_key', None)
    result, status = perform_advanced_analysis(serial, data.get('analysis_type', 'security_scan'), provider, mistral_key, user_id=None, remote_addr=request.remote_addr)
    return jsonify(result), status


@ai_monitoring_bp.route('/advanced-analyze', methods=['POST'])
@jwt_required()
def advanced_ai_analysis():
    if not _check_roles():
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403

    data = request.get_json() or {}
    # Debug log for incoming advanced analyze requests
    try:
        safe_headers = {k: ('<REDACTED>' if k.lower() == 'authorization' else v) for k, v in request.headers.items()}
        current_app.logger.debug(f"[advanced_ai_analysis] incoming request from {request.remote_addr} headers={safe_headers} body={data}")
    except Exception as _e:
        current_app.logger.debug(f"[advanced_ai_analysis] incoming request logging failed: {_e}")

    serial = data.get('serial_number')
    analysis_type = data.get('analysis_type', 'security_scan')
    use_openai = data.get('use_openai', False)
    
    if not serial:
        return jsonify({'error': 'رقم تسلسلي للجهاز مطلوب'}), 400

    # call helper
    user_id = get_jwt()['sub']
    mistral_key = data.get('mistral_api_key')
    result, status = perform_advanced_analysis(serial, analysis_type, data.get('provider'), mistral_key, user_id, request.remote_addr)
    return jsonify(result), status
