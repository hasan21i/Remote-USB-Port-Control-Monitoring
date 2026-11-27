# backend/controllers/reports.py

import json
import jwt
import io
import csv
import re
from datetime import datetime, timezone, timedelta
from sqlalchemy import func

from flask import (
    Blueprint, request, jsonify, current_app,
    make_response
)
from flask_cors import cross_origin
from flask_jwt_extended import jwt_required, get_jwt_identity

from extensions import db
from models import Report, GeneratedReport, Log
from services.ai_report_service import generate_report_content
from utils import generate_alert
from services.blockchain_service import create_blockchain_record

def get_supabase_client():
    """الحصول على Supabase client مع التحقق من الإعدادات"""
    from flask import current_app
    import extensions
    
    # محاولة الحصول عليه من extensions أولاً
    client = extensions.get_supabase_client()
    if client:
        return client
        
    # إذا كان None، نحاول إنشاؤه محلياً كحل أخير
    try:
        from supabase import create_client
        url = current_app.config.get('SUPABASE_URL')
        key = current_app.config.get('SUPABASE_ANON_KEY')
        if url and key:
            return create_client(url, key)
    except Exception:
        pass
        
    return None

reports_bp = Blueprint('reports', __name__)

# إعداد توقيت بغداد
try:
    from zoneinfo import ZoneInfo
    BAGHDAD_TZ = ZoneInfo("Asia/Baghdad")
except ImportError:
    BAGHDAD_TZ = timezone(timedelta(hours=3))

def now_baghdad() -> datetime:
    """الوقت الحالي بتوقيت بغداد (UTC+3)."""
    from utils import current_time
    return current_time()


def _build_cors_preflight():
    resp = make_response('', 204)
    resp.headers['Access-Control-Allow-Origin'] = ','.join(current_app.config.get('CORS_ORIGINS', ['*']))
    resp.headers['Access-Control-Allow-Headers'] = ','.join(current_app.config.get('CORS_HEADERS', ['Content-Type','Authorization', 'X-Server-Id']))
    resp.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS,DELETE'
    return resp


@reports_bp.route('/schedule', methods=['OPTIONS', 'POST'])

@jwt_required()
def schedule_report():
    if request.method == 'OPTIONS':
        return _build_cors_preflight()

    user_id = get_jwt_identity()
    data = request.get_json() or {}
    name        = data.get('name')
    cron        = data.get('cron')
    report_type = data.get('type')
    params      = data.get('params', {})

    if not all([name, cron, report_type]):
        return jsonify({'error': 'name, cron, and type are required'}), 400

    try:
        rpt = Report(
            name=name,
            schedule=cron,
            report_type=report_type,
            params=json.dumps(params),
            created_by=user_id,
            created_at=now_baghdad()
        )
        db.session.add(rpt)
        db.session.commit()

        db.session.add(Log(
            action='report_scheduled',
            user_id=user_id,
            details=json.dumps({'report_id': rpt.id, 'cron': cron}),
            timestamp=now_baghdad()
        ))
        db.session.commit()

        create_blockchain_record('report_scheduled', {'report_id': rpt.id}, user_id)
        generate_alert(f"Report scheduled: {name}", 'normal')

        return jsonify({'message': 'Report scheduled', 'report': rpt.to_dict()}), 201

    except Exception as e:
        db.session.rollback()
        generate_alert(f"Error scheduling report: {e}", 'high')
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/run/<int:report_id>', methods=['OPTIONS', 'POST'])

@jwt_required()
def run_report(report_id):
    if request.method == 'OPTIONS':
        return _build_cors_preflight()

    user_id = get_jwt_identity()
    rpt = Report.query.get(report_id)
    if not rpt:
        return jsonify({'error': 'Report not found'}), 404

    try:
        content = generate_report_content(rpt)
        # تحديث التقرير الموجود بدلاً من إنشاء واحد جديد
        rpt.content = content
        rpt.status = 'completed'
        rpt.last_generated_at = now_baghdad()
        rpt.generated_by = user_id
        db.session.commit()

        db.session.add(Log(
            action='report_run',
            user_id=user_id,
            details=json.dumps({'report_id': report_id}),
            timestamp=now_baghdad()
        ))
        db.session.commit()

        create_blockchain_record('report_run', {'report_id': report_id}, user_id)
        generate_alert(f"Report generated: {rpt.name}", 'normal')

        return jsonify({'message': 'Report generated', 'report': rpt.to_dict()}), 201

    except Exception as e:
        db.session.rollback()
        generate_alert(f"Error running report: {e}", 'high')
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/history', methods=['OPTIONS', 'GET'])
@jwt_required()
def get_reports_history():
    """جلب إحصائيات التقارير الشاملة"""
    if request.method == 'OPTIONS':
        return _build_cors_preflight()

    try:
        current_app.logger.info("Fetching reports history statistics...")
        user_id = get_jwt_identity()
        
        try:
            user_id_int = int(user_id) if user_id else None
        except Exception:
            user_id_int = None

        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

        # إحصائيات التقارير الشاملة
        total_reports = 0
        try:
            total_result = client.table('reports').select('id', count='exact').eq('report_type', 'system_overview').execute()
            total_reports = getattr(total_result, 'count', 0) or 0
        except Exception as e:
            current_app.logger.error(f"Error getting total reports: {e}")

        completed_reports = 0
        try:
            completed_result = client.table('reports').select('id', count='exact').eq('report_type', 'system_overview').eq('status', 'completed').execute()
            completed_reports = getattr(completed_result, 'count', 0) or 0
        except Exception as e:
            current_app.logger.error(f"Error getting completed reports: {e}")

        failed_reports = 0
        try:
            failed_result = client.table('reports').select('id', count='exact').eq('report_type', 'system_overview').eq('status', 'failed').execute()
            failed_reports = getattr(failed_result, 'count', 0) or 0
        except Exception as e:
            current_app.logger.error(f"Error getting failed reports: {e}")

        # التقارير في هذا الشهر
        this_month_reports = 0
        try:
            now = now_baghdad()
            start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            this_month_result = client.table('reports').select('id', count='exact').eq('report_type', 'system_overview').gte('created_at', start_of_month.isoformat()).execute()
            this_month_reports = getattr(this_month_result, 'count', 0) or 0
        except Exception as e:
            current_app.logger.error(f"Error getting this month reports: {e}")

        # إجمالي التحميلات
        total_downloads = 0
        try:
            reports_result = client.table('reports').select('download_count').eq('report_type', 'system_overview').execute()
            data = getattr(reports_result, 'data', [])
            total_downloads = sum([int(r.get('download_count', 0) or 0) for r in data]) if data else 0
        except Exception as e:
            current_app.logger.error(f"Error getting total downloads: {e}")

        # التقارير حسب اللغة
        arabic_reports = 0
        english_reports = 0
        try:
            lang_res = client.table('reports').select('language').eq('report_type', 'system_overview').execute()
            if lang_res and hasattr(lang_res, 'data') and lang_res.data:
                for r in lang_res.data:
                    lang = r.get('language')
                    if lang == 'ar': arabic_reports += 1
                    elif lang == 'en': english_reports += 1
        except Exception as e:
            current_app.logger.error(f"Error getting language stats: {e}")

        # تسجيل عرض الإحصائيات (تعديل: وضعنا Log بصمت)
        try:
            log_data = {
                'action': 'comprehensive_reports_stats_viewed',
                'user_id': user_id_int,
                'ip_address': request.remote_addr,
                'details': json.dumps({'total_reports': total_reports}),
                'timestamp': now_baghdad().isoformat(),
                'success': True
            }
            client.table('logs').insert(log_data).execute()
        except Exception:
            pass

        response_data = {
            'total_reports': int(total_reports),
            'completed_reports': int(completed_reports),
            'failed_reports': int(failed_reports),
            'this_month': int(this_month_reports),
            'total_downloads': int(total_downloads),
            'arabic_reports': int(arabic_reports),
            'english_reports': int(english_reports)
        }
        return jsonify(response_data), 200

    except Exception as e:
        import traceback
        current_app.logger.error(f"Error in get_reports_history: {traceback.format_exc()}")
        return jsonify({'error': 'Internal server error'}), 500

@reports_bp.route('/history/<int:report_id>', methods=['OPTIONS', 'GET'])

@jwt_required()
def report_history(report_id):
    if request.method == 'OPTIONS':
        return _build_cors_preflight()

    user_id = get_jwt_identity()
    try:
        history = (
            Report.query
                .filter_by(id=report_id)
                .order_by(Report.created_at.desc())
                .all()
        )
        out = [h.to_dict() for h in history]

        db.session.add(Log(
            action='report_history_viewed',
            user_id=user_id,
            details=json.dumps({'report_id': report_id, 'count': len(out)}),
            timestamp=now_baghdad()
        ))
        db.session.commit()

        create_blockchain_record('report_history_viewed', {'report_id': report_id, 'count': len(out)}, user_id)
        return jsonify(out), 200

    except Exception as e:
        generate_alert(f"Error fetching report history: {e}", 'medium')
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/export', methods=['OPTIONS', 'GET'])

@jwt_required()
def export_report_history():
    if request.method == 'OPTIONS':
        return _build_cors_preflight()

    user_id = get_jwt_identity()
    try:
        report_id = int(request.args.get('report_id', 0))
        fmt = request.args.get('format', 'csv').lower()
        if fmt not in ('csv', 'pdf'):
            return jsonify({'error': "format must be 'csv' or 'pdf'"}), 400

        history = (
            Report.query
                .filter_by(id=report_id)
                .order_by(Report.created_at.desc())
                .all()
        )
        if not history:
            return jsonify({'error': 'No history for this report'}), 404

        # CSV export
        if fmt == 'csv':
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(['Generated ID', 'Timestamp', 'Format', 'Status', 'Error Message'])
            for h in history:
                ts = h.generated_at.astimezone(BAGHDAD_TZ).isoformat()
                writer.writerow([h.id, ts, h.format, h.status, h.error_message or ''])
            resp = make_response(output.getvalue())
            resp.headers['Content-Disposition'] = f'attachment; filename=report_{report_id}_history.csv'
            resp.headers['Content-Type']        = 'text/csv'
            return resp

        # PDF export
        try:
            from reportlab.pdfgen import canvas
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.units import mm
            from services.ai_report_service import generate_report_content
        except ImportError:
            return jsonify({'error': 'PDF export not available; please install reportlab'}), 400

        buffer = io.BytesIO()
        p = canvas.Canvas(buffer, pagesize=A4)
        width, height = A4
        p.setFont("Helvetica", 12)
        y = height - 30
        # عنوان التقرير
        p.drawString(30, y, f"تقرير جنائي مفصل للهجمات (Report {report_id})")
        y -= 30
        p.setFont("Helvetica", 9)
        # اجلب محتوى التقرير الجنائي
        try:
            rpt = Report.query.get(report_id)
            report_text = generate_report_content(rpt)
        except Exception as e:
            report_text = f"خطأ في توليد التقرير: {e}"
        # قسم النص إلى أسطر قصيرة
        lines = []
        for line in report_text.split('\n'):
            while len(line) > 110:
                lines.append(line[:110])
                line = line[110:]
            lines.append(line)
        for line in lines:
            if y < 40:
                p.showPage()
                y = height - 30
                p.setFont("Helvetica", 9)
            p.drawString(30, y, line)
            y -= 14
        p.save()
        buffer.seek(0)
        resp = make_response(buffer.read())
        resp.headers['Content-Disposition'] = f'attachment; filename=report_{report_id}_history.pdf'
        resp.headers['Content-Type']        = 'application/pdf'
        return resp

    except Exception as e:
        current_app.logger.exception("Error exporting report history")
        generate_alert(f"Error exporting report history: {e}", 'medium')
        return jsonify({'error': 'Internal server error'}), 500

@reports_bp.route('/generated', methods=['OPTIONS', 'GET'])
@jwt_required()
def get_generated_reports():
    """جلب قائمة التقارير الشاملة المولّدة"""
    if request.method == 'OPTIONS':
        return _build_cors_preflight()

    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

        # جلب التقارير الشاملة المولّدة
        query = client.table('reports').select('*').eq('report_type', 'system_overview')

        # فلترة حسب الحالة
        status = request.args.get('status')
        if status:
            query = query.eq('status', status)

        # فلترة حسب التاريخ
        start_date = request.args.get('start_date')
        if start_date:
            try:
                start_dt = datetime.fromisoformat(start_date)
                query = query.gte('created_at', start_dt.isoformat())
            except ValueError:
                pass

        end_date = request.args.get('end_date')
        if end_date:
            try:
                end_dt = datetime.fromisoformat(end_date)
                query = query.lte('created_at', end_dt.isoformat())
            except ValueError:
                pass

        # ترتيب حسب تاريخ الإنشاء (الأحدث أولاً)
        try:
            reports_result = query.order('created_at', desc=True).execute()
            reports = reports_result.data if reports_result.data else []
        except Exception as e:
            current_app.logger.error(f"Error fetching generated reports from Supabase: {e}")
            reports = []

        # تحويل إلى قاموس
        result = []
        for report in reports:
            # Safe JSON parsing
            params_raw = report.get('params')
            if isinstance(params_raw, dict):
                parameters = params_raw
            elif isinstance(params_raw, str):
                try:
                    parameters = json.loads(params_raw)
                except:
                    parameters = {}
            else:
                parameters = {}

            report_dict = {
                'id': report.get('id'),
                'name': report.get('name') or f'تقرير شامل عن النظام - {report.get("created_at", "")[:10] if report.get("created_at") else "unknown"}',
                'type': 'system_overview',
                'language': report.get('language'),
                'format': report.get('format_type'),
                'status': report.get('status'),
                'file_path': report.get('file_path', ''),
                'created_at': report.get('created_at'),
                'parameters': parameters,
                'file_size': report.get('file_size', 0),
                'download_count': report.get('download_count', 0),
                'description': report.get('description') or 'تقرير شامل عن النظام يحتوي على جميع الإحصائيات والبيانات'
            }
            result.append(report_dict)

        return jsonify(result), 200

    except Exception as e:
        import traceback
        current_app.logger.error(f"Error fetching generated reports: {traceback.format_exc()}")
        return jsonify({'error': 'Internal server error'}), 500

@reports_bp.route('/content/<int:report_id>', methods=['OPTIONS', 'GET'])
@jwt_required()
def get_report_content(report_id):
    """جلب محتوى التقرير الشامل المولد"""
    if request.method == 'OPTIONS':
        return _build_cors_preflight()

    try:
        user_id = get_jwt_identity()
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500
        
        # البحث عن التقرير المولد في Supabase
        try:
            report_result = client.table('reports').select('*').eq('id', report_id).execute()
            if not report_result.data:
                return jsonify({'error': 'التقرير غير موجود'}), 404
            report = report_result.data[0]
        except Exception as e:
            current_app.logger.error(f"Error fetching report from Supabase: {e}")
            return jsonify({'error': 'فشل في جلب التقرير'}), 500

        # التحقق من أن التقرير هو تقرير شامل
        if report.get('report_type') != 'system_overview':
            return jsonify({'error': 'هذا التقرير ليس تقرير شامل'}), 400

        # إذا كان التقرير يحتوي على محتوى محفوظ مسبقاً
        if report.get('content'):
            content = report['content']
            current_app.logger.info("Using existing saved report content")
        else:
            # توليد المحتوى من جديد باستخدام البيانات المحفوظة
            try:
                # Safe JSON parsing
                params_raw = report.get('params')
                if isinstance(params_raw, dict):
                    parameters = params_raw
                elif isinstance(params_raw, str):
                    try:
                        parameters = json.loads(params_raw)
                    except:
                        parameters = {}
                else:
                    parameters = {}

                language = report.get('language', 'ar')
                
                from services.ai_report_service import generate_comprehensive_report
                
                content = generate_comprehensive_report(
                    report_type='system_overview',
                    params={**parameters, 'clean_text': True},
                    language=language
                )
                
                # حفظ المحتوى المولد في التقرير للاستخدام المستقبلي
                try:
                    client.table('reports').update({'content': content}).eq('id', report_id).execute()
                    current_app.logger.info("Generated and saved new report content")
                except Exception as update_error:
                    current_app.logger.error(f"Error updating report content in Supabase: {update_error}")
                
            except Exception as e:
                current_app.logger.error(f"Error generating content: {str(e)}")
                content = None

        # تسجيل عرض التقرير في Supabase
        try:
            user_id = get_jwt_identity()
            try:
                user_id_int = int(user_id) if user_id else None
            except:
                user_id_int = None

            log_data = {
                'action': 'comprehensive_report_viewed',
                'user_id': user_id_int,
                'details': json.dumps({
                    'report_id': report_id,
                    'type': 'system_overview'
                }),
                'timestamp': now_baghdad().isoformat(),
                'ip_address': request.remote_addr,
                'success': True
            }
            client.table('logs').insert(log_data).execute()
        except:
            pass

        try:
            create_blockchain_record(
                'comprehensive_report_viewed',
                {'report_id': report_id, 'type': 'system_overview'},
                user_id_int
            )
        except:
            pass

        return jsonify({
            'content': content,
            'report_id': report_id,
            'type': 'system_overview',
            'language': report.get('language') or 'ar'
        }), 200

    except Exception as e:
        current_app.logger.exception("Error fetching report content")
        generate_alert(f"Error fetching report content: {e}", 'medium')
        return jsonify({'error': 'Internal server error'}), 500

@reports_bp.route('/export-pdf/<int:report_id>', methods=['OPTIONS', 'GET'])
@jwt_required()
def export_report_pdf(report_id):
    """تصدير التقرير الشامل بصيغة PDF"""
    if request.method == 'OPTIONS':
        response = _build_cors_preflight()
        return response
    
    try:
        user_id = get_jwt_identity()
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500
            
        current_app.logger.info(f"Starting PDF export for report {report_id}")
        
        # البحث عن التقرير في Supabase
        try:
            report_result = client.table('reports').select('*').eq('id', report_id).execute()
            if not report_result.data:
                current_app.logger.error(f"Report {report_id} not found in Supabase")
                return jsonify({'error': 'التقرير غير موجود'}), 404
            report = report_result.data[0]
        except Exception as e:
            current_app.logger.error(f"Error fetching report from Supabase: {e}")
            return jsonify({'error': 'فشل في جلب التقرير'}), 500
        
        current_app.logger.info(f"Found report: {report.get('name', 'Unknown')}")
        
        # توليد المحتوى الحقيقي للتقرير باللغة الإنجليزية فقط
        current_app.logger.info("Generating real report content for PDF in English only")
        
        try:
            from services.ai_report_service import generate_comprehensive_report
            
            # Safe JSON parsing
            params_raw = report.get('params')
            if isinstance(params_raw, dict):
                params = params_raw
            elif isinstance(params_raw, str):
                try:
                    params = json.loads(params_raw)
                except:
                    params = {}
            else:
                params = {}
            
            # إجبار اللغة الإنجليزية لتجنب مشاكل العربية
            language = 'en'
            
            # توليد المحتوى الحقيقي باللغة الإنجليزية
            content = generate_comprehensive_report(
                report_type='system_overview',
                params={**params, 'clean_text': True},
                language=language
            )
            
            current_app.logger.info("Real English content generated successfully")
            
        except Exception as e:
            current_app.logger.error(f"Error generating real report content: {str(e)}")
            # في حالة الفشل، لا نستخدم محتوى افتراضي
            content = None
        
        # إنشاء PDF
        try:
            import io
            from reportlab.lib.pagesizes import A4
            from reportlab.lib import colors
            from reportlab.platypus import (
                SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
            )
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch, mm
            from reportlab.lib.enums import TA_CENTER, TA_LEFT

            current_app.logger.info("Creating formatted PDF with tables...")

            # ── Arabic → English sanitizer for PDF ────────────────────────
            ARABIC_TO_ENGLISH = {
                'تقرير النظام الشامل': 'Comprehensive System Report',
                'تقرير شامل': 'Comprehensive Report',
                'نظرة عامة على النظام': 'System Overview',
                'إحصائيات الأجهزة': 'Device Statistics',
                'إحصائيات المستخدمين': 'User Statistics',
                'إحصائيات السجلات': 'Log Statistics',
                'تقرير أمني': 'Security Report',
                'تقرير الأجهزة': 'Device Report',
                'تقرير المستخدمين': 'User Report',
                'إجمالي الأجهزة المسجلة': 'Total Registered Devices',
                'الأجهزة المتصلة حالياً': 'Currently Connected Devices',
                'الأجهزة المحظورة': 'Blocked Devices',
                'الأجهزة في القائمة البيضاء': 'Whitelisted Devices',
                'الأجهزة المعلقة': 'Pending Devices',
                'إجمالي المستخدمين': 'Total Users',
                'المستخدمين النشطين': 'Active Users',
                'إجمالي السجلات': 'Total Logs',
                'سجلات آخر 24 ساعة': 'Logs Last 24 Hours',
                'سجلات آخر 7 أيام': 'Logs Last 7 Days',
                'سجلات آخر 30 يوم': 'Logs Last 30 Days',
                'سجلات آخر 90 يوم': 'Logs Last 90 Days',
                'سجلات آخر سنة': 'Logs Last Year',
                'التنبيهات': 'Alerts',
                'التنبيهات النشطة': 'Active Alerts',
                'تنبيهات حرجة': 'Critical Alerts',
                'تنبيهات عالية': 'High Alerts',
                'تنبيهات متوسطة': 'Medium Alerts',
                'تنبيهات منخفضة': 'Low Alerts',
                'حالة النظام': 'System Status',
                'معدل الأمان': 'Security Rate',
                'وقت التشغيل': 'Uptime',
                'آخر تحديث': 'Last Update',
                'جهاز': 'device',
                'أجهزة': 'devices',
                'مستخدم': 'user',
                'مستخدمين': 'users',
                'سجل': 'log',
                'سجلات': 'logs',
                'نشط': 'active',
                'غير نشط': 'inactive',
                'متصل': 'connected',
                'غير متصل': 'disconnected',
                'محظور': 'blocked',
                'معلق': 'pending',
                'مسموح': 'allowed',
                'الأولوية': 'Priority',
                'عادي': 'normal',
                'عالي': 'high',
                'حرج': 'critical',
                'منخفض': 'low',
                'متوسط': 'medium',
                'البلوكتشين': 'Blockchain',
                'سلسلة الكتل': 'Blockchain',
                'الذكاء الاصطناعي': 'Artificial Intelligence',
                'المراقبة الذكية': 'Smart Monitoring',
                'السياسات': 'Policies',
                'الخوادم': 'Servers',
                'لوحة التحكم': 'Dashboard',
                'تاريخ التقرير': 'Report Date',
                'نوع التقرير': 'Report Type',
                'تم الإنشاء': 'Created',
                'تم الحذف': 'Deleted',
                'تم التحديث': 'Updated',
                'ملخص': 'Summary',
                'تفاصيل': 'Details',
                'ملاحظات': 'Notes',
                'توصيات': 'Recommendations',
                'تحليل': 'Analysis',
                'إحصائيات': 'Statistics',
                'بيانات': 'Data',
                'معلومات': 'Information',
            }

            def sanitize_arabic_for_pdf(text):
                """Replace any Arabic text with English equivalents for PDF rendering."""
                if not text:
                    return text
                text = str(text)
                # Replace known Arabic phrases (longest first to avoid partial matches)
                for ar, en in sorted(ARABIC_TO_ENGLISH.items(), key=lambda x: len(x[0]), reverse=True):
                    text = text.replace(ar, en)
                # Remove any remaining Arabic/RTL characters that Helvetica can't render
                text = re.sub(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+', '', text)
                # Clean up extra whitespace from removals
                text = re.sub(r'  +', ' ', text).strip()
                return text


            buffer = io.BytesIO()
            doc = SimpleDocTemplate(
                buffer,
                pagesize=A4,
                topMargin=0.6*inch,
                bottomMargin=0.6*inch,
                leftMargin=0.6*inch,
                rightMargin=0.6*inch
            )
            story = []
            styles = getSampleStyleSheet()

            # ── الأنماط ──────────────────────────────────────────────────────
            title_style = ParagraphStyle(
                'ReportTitle',
                parent=styles['Heading1'],
                fontSize=18, spaceAfter=4, spaceBefore=0,
                alignment=TA_CENTER, fontName='Helvetica-Bold',
                textColor=colors.HexColor('#1a1a2e')
            )
            subtitle_style = ParagraphStyle(
                'ReportSubtitle',
                parent=styles['Normal'],
                fontSize=10, spaceAfter=16, alignment=TA_CENTER,
                fontName='Helvetica', textColor=colors.HexColor('#6c757d')
            )
            section_style = ParagraphStyle(
                'SectionHeader',
                parent=styles['Heading2'],
                fontSize=12, spaceAfter=4, spaceBefore=14,
                fontName='Helvetica-Bold',
                textColor=colors.HexColor('#0d6efd'),
                borderPad=4
            )
            sub_section_style = ParagraphStyle(
                'SubSection',
                parent=styles['Heading3'],
                fontSize=10.5, spaceAfter=4, spaceBefore=8,
                fontName='Helvetica-Bold',
                textColor=colors.HexColor('#495057')
            )
            list_style = ParagraphStyle(
                'ListItem',
                parent=styles['Normal'],
                fontSize=10, spaceAfter=2,
                fontName='Helvetica',
                textColor=colors.HexColor('#212529'),
                leftIndent=12
            )

            # ── Header ───────────────────────────────────────────────────────
            story.append(Paragraph("System Report", title_style))
            story.append(Paragraph(
                f"Report ID: {report_id} &nbsp;&nbsp;|&nbsp;&nbsp; "
                f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} &nbsp;&nbsp;|&nbsp;&nbsp; "
                "Type: Comprehensive Report",
                subtitle_style
            ))
            story.append(HRFlowable(
                width="100%", thickness=2,
                color=colors.HexColor('#0d6efd'), spaceAfter=14
            ))

            # ── محلل المحتوى إلى أقسام ───────────────────────────────────────
            def parse_content_sections(text):
                """Parse plain text into sections with KV rows for PDF tables."""
                if not text:
                    return []
                sections = []
                current_title = None
                current_rows = []

                def flush():
                    nonlocal current_title, current_rows
                    if current_rows:
                        sections.append({
                            'section': current_title or 'Report Details',
                            'rows': list(current_rows)
                        })
                    current_title = None
                    current_rows = []

                for line in text.split('\n'):
                    line = line.strip()
                    if not line:
                        continue
                    # List item
                    list_m = re.match(r'^[-•*]\s+(.+)$', line) or re.match(r'^\d+\.\s+(.+)$', line)
                    if list_m:
                        current_rows.append(('•', list_m.group(1).replace('**', '')))
                        continue
                    # Key: Value pair
                    colon_idx = line.find(': ')
                    if 0 < colon_idx < len(line) - 2:
                        key = re.sub(r'\*\*', '', line[:colon_idx]).strip()
                        val = re.sub(r'\*\*', '', line[colon_idx+2:]).strip()
                        current_rows.append((key, val))
                        continue
                    # Heading — flush previous rows then start new section
                    flush()
                    clean = re.sub(r'^#{1,6}\s+', '', line)
                    clean = re.sub(r'\*\*', '', clean)
                    clean = re.sub(r'[\U0001F300-\U0001FFFF\U00002600-\U000027BF\U0000FE0F]', '', clean).strip()
                    if clean:
                        current_title = clean

                flush()
                return sections

            # Sanitize content before parsing
            if content:
                content = sanitize_arabic_for_pdf(content)

            parsed = parse_content_sections(content) if content else []

            if not parsed:
                # fallback — dump raw lines as a table
                if content:
                    for raw_line in content.split('\n'):
                        raw_line = raw_line.strip()
                        if raw_line:
                            story.append(Paragraph(sanitize_arabic_for_pdf(raw_line), list_style))
                else:
                    story.append(Paragraph("No content available.", list_style))
            else:
                # Colour bands per section (cycling)
                HEADER_COLORS = [
                    colors.HexColor('#0d6efd'),
                    colors.HexColor('#198754'),
                    colors.HexColor('#dc3545'),
                    colors.HexColor('#6f42c1'),
                    colors.HexColor('#fd7e14'),
                    colors.HexColor('#20c997'),
                ]
                color_idx = 0
                current_section = None
                current_subsection = None

                for block in parsed:
                    sec = block.get('section')
                    subsec = block.get('subsection')
                    rows = block.get('rows', [])

                    # Print section header if changed
                    if sec and sec != current_section:
                        story.append(HRFlowable(
                            width="100%", thickness=1,
                            color=colors.HexColor('#dee2e6'), spaceAfter=4
                        ))
                        section_para = ParagraphStyle(
                            f'Sec_{color_idx}',
                            parent=section_style,
                            textColor=HEADER_COLORS[color_idx % len(HEADER_COLORS)]
                        )
                        story.append(Paragraph(sanitize_arabic_for_pdf(sec), section_para))
                        current_section = sec
                        current_subsection = None
                        color_idx += 1

                    # Print sub-section header if changed
                    if subsec and subsec != current_subsection:
                        story.append(Paragraph(sanitize_arabic_for_pdf(subsec), sub_section_style))
                        current_subsection = subsec

                    if not rows:
                        continue

                    # Build table
                    page_width = A4[0] - 1.2*inch
                    col1_w = page_width * 0.50
                    col2_w = page_width * 0.50

                    hdr_color = HEADER_COLORS[(color_idx - 1) % len(HEADER_COLORS)]
                    table_data = []
                    for key, val in rows:
                        safe_key = sanitize_arabic_for_pdf(key)
                        safe_val = sanitize_arabic_for_pdf(str(val))
                        if key == '•':
                            table_data.append([
                                Paragraph(f'<bullet>&bull;</bullet> {safe_val}',
                                          ParagraphStyle('BulletRow', parent=list_style,
                                                         textColor=colors.HexColor('#212529'))),
                                Paragraph('', list_style)
                            ])
                        else:
                            table_data.append([
                                Paragraph(f'<b>{safe_key}</b>',
                                          ParagraphStyle('KeyCell', parent=list_style,
                                                         textColor=colors.HexColor('#495057'))),
                                Paragraph(safe_val,
                                          ParagraphStyle('ValCell', parent=list_style,
                                                         textColor=colors.HexColor('#212529'),
                                                         fontName='Helvetica-Bold'))
                            ])

                    if table_data:
                        tbl = Table(table_data, colWidths=[col1_w, col2_w])
                        tbl.setStyle(TableStyle([
                            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f0f4ff')),
                            ('ROWBACKGROUNDS', (0, 0), (-1, -1),
                             [colors.HexColor('#f8f9fa'), colors.white]),
                            ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#dee2e6')),
                            ('LEFTPADDING',  (0, 0), (-1, -1), 8),
                            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                            ('TOPPADDING',   (0, 0), (-1, -1), 5),
                            ('BOTTOMPADDING',(0, 0), (-1, -1), 5),
                            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                        ]))
                        story.append(tbl)
                        story.append(Spacer(1, 6))

            # ── Footer rule ───────────────────────────────────────────────────
            story.append(Spacer(1, 20))
            story.append(HRFlowable(
                width="100%", thickness=1,
                color=colors.HexColor('#dee2e6'), spaceAfter=6
            ))
            story.append(Paragraph(
                f"Generated by Remot Security System &nbsp;|&nbsp; {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                subtitle_style
            ))

            current_app.logger.info("Building PDF document...")
            doc.build(story)

            pdf_data = buffer.getvalue()
            buffer.close()

            current_app.logger.info(f"PDF created successfully, size: {len(pdf_data)} bytes")

            if len(pdf_data) < 100:
                current_app.logger.error("PDF data too small")
                return jsonify({'error': 'Failed to create PDF - invalid data'}), 500

        except ImportError as import_error:
            current_app.logger.error(f"ReportLab not available: {import_error}")
            return jsonify({'error': 'ReportLab library not available for PDF creation'}), 500
        except Exception as pdf_error:
            current_app.logger.error(f"Error creating PDF: {pdf_error}")
            return jsonify({'error': f'Error creating PDF: {str(pdf_error)}'}), 500
        
        # تحديث عداد التحميل - فقط عند التحميل الفعلي
        try:
            current_download_count = report.get('download_count', 0) or 0
            new_download_count = current_download_count + 1
            
            client.table('reports').update({'download_count': new_download_count}).eq('id', report_id).execute()
            current_app.logger.info(f"Download count updated: {new_download_count}")
        except Exception as update_error:
            current_app.logger.warning(f"Error updating download count in Supabase: {update_error}")
        
        # تسجيل التحميل في Supabase
        try:
            log_data = {
                'action': 'report_pdf_downloaded',
                'user_id': user_id,
                'details': json.dumps({
                    'report_id': report_id,
                    'format': 'pdf',
                    'file_size': len(pdf_data)
                }),
                'timestamp': now_baghdad().isoformat(),
                'ip_address': request.remote_addr,
                'success': True
            }
            client.table('logs').insert(log_data).execute()
        except Exception as log_error:
            current_app.logger.warning(f"Error logging download to Supabase: {log_error}")
        try:
            create_blockchain_record(
                'report_pdf_downloaded',
                {'report_id': report_id, 'format': 'pdf'},
                user_id
            )
        except Exception as log_error:
            current_app.logger.warning(f"Error logging blockchain record: {log_error}")
        
        # إنشاء الاستجابة
        current_app.logger.info("Creating response...")
        response = make_response(pdf_data)
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Length'] = str(len(pdf_data))
        
        # اسم الملف البسيط
        filename = f"system_report_{report_id}.pdf"
        response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
        
        # CORS headers بسيطة
        response.headers['Access-Control-Allow-Origin'] = 'http://localhost:3000'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Server-Id'
        
        current_app.logger.info("PDF export completed successfully")
        return response
        
    except Exception as e:
        current_app.logger.exception(f"Critical error in export_report_pdf: {str(e)}")
        # إرجاع استجابة خطأ بسيطة
        return jsonify({'error': f'Error exporting report: {str(e)}'}), 500

@reports_bp.route('/generate', methods=['OPTIONS', 'POST'])
@jwt_required()
def generate_report_instance():
    """توليد تقرير شامل جديد عن النظام"""
    if request.method == 'OPTIONS':
        return _build_cors_preflight()
    
    try:
        data = request.get_json() or {}
        user_id = get_jwt_identity()
        
        # استخراج المعاملات - دائماً تقرير شامل باللغة الإنجليزية
        report_type = 'system_overview'  # ثابت - تقرير شامل فقط
        language = 'en'  # إجبار اللغة الإنجليزية
        format_type = data.get('format', 'pdf')
        include_charts = data.get('include_charts', True)
        name = data.get('name', f'Comprehensive System Report - {datetime.now().strftime("%Y-%m-%d")}')
        
        # إنشاء سجل تقرير جديد في Supabase
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500
            
        report_data = {
            'name': name,
            'report_type': report_type,
            'status': 'generating',
            'created_at': now_baghdad().isoformat(),
            'created_by': user_id,
            'params': json.dumps({
                'language': language,
                'format': format_type,
                'include_charts': include_charts,
                'name': name
            }),
            'language': language,
            'format_type': format_type,
            'is_comprehensive': True
        }
        
        try:
            report_result = client.table('reports').insert(report_data).execute()
            if not report_result.data:
                return jsonify({'error': 'فشل في إنشاء سجل التقرير'}), 500
            report_data = report_result.data[0]
            report_id = report_data['id']
        except Exception as e:
            current_app.logger.error(f"Error creating report record in Supabase: {e}")
            return jsonify({'error': 'فشل في إنشاء سجل التقرير'}), 500
        
        try:
            # توليد التقرير الشامل باستخدام الخدمة باللغة الإنجليزية
            from services.ai_report_service import generate_comprehensive_report
            
            report_content = generate_comprehensive_report(
                report_type='system_overview',  # ثابت - تقرير شامل
                params={'language': 'en', 'include_charts': include_charts, 'clean_text': True},
                language='en'  # إجبار اللغة الإنجليزية
            )
            
            # حفظ محتوى التقرير
            update_data = {
                'content': report_content,
                'status': 'completed',
                'file_path': f'reports/comprehensive_system_report_{report_id}.{format_type}',
                'file_size': len(report_content.encode('utf-8'))
            }
            
            try:
                client.table('reports').update(update_data).eq('id', report_id).execute()
            except Exception as update_error:
                current_app.logger.error(f"Error updating report in Supabase: {update_error}")
                return jsonify({'error': 'فشل في حفظ محتوى التقرير'}), 500
            
            # تسجيل في البلوك تشين
            create_blockchain_record(
                'comprehensive_report_generated',
                {
                    'report_id': report_id, 
                    'type': 'system_overview',
                    'language': language,
                    'format': format_type,
                    'name': name
                },
                user_id
            )
            
            # إضافة سجل في Supabase
            try:
                log_data = {
                    'action': 'comprehensive_report_generated',
                    'user_id': user_id,
                    'details': json.dumps({
                        'report_id': report_id, 
                        'type': 'system_overview',
                        'language': language,
                        'format': format_type,
                        'name': name
                    }),
                    'timestamp': now_baghdad().isoformat(),
                    'ip_address': request.remote_addr,
                    'success': True
                }
                client.table('logs').insert(log_data).execute()
            except Exception as log_error:
                current_app.logger.warning(f"Error logging to Supabase: {log_error}")
            
            return jsonify({
                'message': 'Comprehensive report generated successfully',
                'report': {
                    'id': report_id,
                    'name': name,
                    'status': 'completed',
                    'type': 'system_overview',
                    'language': 'en',
                    'format': format_type,
                    'created_at': report_data['created_at'],
                    'file_size': len(report_content.encode('utf-8'))
                }
            }), 201
            
        except Exception as e:
            # Update report status to failed in Supabase
            try:
                if 'report_id' in locals():
                    client.table('reports').update({
                        'status': 'failed',
                        'error_message': str(e)
                    }).eq('id', report_id).execute()
            except Exception as update_error:
                current_app.logger.error(f"Error updating failed report status: {update_error}")
            
            current_app.logger.error(f"Report generation failed: {str(e)}")
            raise e
        
    except Exception as e:
        current_app.logger.exception("Error generating report")
        generate_alert(f"Error generating report: {e}", 'high')
        return jsonify({'error': 'Error generating report'}), 500


@reports_bp.route('/delete/<int:report_id>', methods=['OPTIONS', 'DELETE'])
@jwt_required()
def delete_report(report_id):
    """حذف تقرير من النظام وقاعدة البيانات"""
    if request.method == 'OPTIONS':
        return _build_cors_preflight()
    
    try:
        user_id = get_jwt_identity()
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500
        
        # العثور على التقرير في Supabase
        try:
            report_result = client.table('reports').select('*').eq('id', report_id).execute()
            if not report_result.data:
                return jsonify({'error': 'التقرير غير موجود'}), 404
            report = report_result.data[0]
        except Exception as e:
            current_app.logger.error(f"Error fetching report from Supabase: {e}")
            return jsonify({'error': 'فشل في جلب التقرير'}), 500
        
        # حذف الملف من النظام إذا كان موجوداً
        import os
        if report.get('file_path') and os.path.exists(report['file_path']):
            try:
                os.remove(report['file_path'])
            except OSError as e:
                current_app.logger.warning(f"Could not delete file {report['file_path']}: {e}")
        
        # حذف التقرير من Supabase
        try:
            client.table('reports').delete().eq('id', report_id).execute()
        except Exception as e:
            current_app.logger.error(f"Error deleting report from Supabase: {e}")
            return jsonify({'error': 'فشل في حذف التقرير'}), 500
        
        # تسجيل في البلوك تشين
        create_blockchain_record(
            'report_deleted',
            {'report_id': report_id, 'deleted_by': user_id},
            user_id
        )
        
        generate_alert(f"Report deleted: {report_id}", 'normal')
        return jsonify({'message': 'تم حذف التقرير بنجاح'}), 200
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Error deleting report")
        generate_alert(f"Error deleting report: {e}", 'high')
        return jsonify({'error': 'خطأ في حذف التقرير'}), 500


@reports_bp.route('/reset-download-count/<int:report_id>', methods=['OPTIONS', 'POST'])
@jwt_required()
def reset_download_count(report_id):
    """إعادة تعيين عداد التحميلات لتقرير معين"""
    if request.method == 'OPTIONS':
        return _build_cors_preflight()
    
    try:
        user_id = get_jwt_identity()
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500
        
        # البحث عن التقرير في Supabase
        try:
            report_result = client.table('reports').select('*').eq('id', report_id).execute()
            if not report_result.data:
                current_app.logger.error(f"Report {report_id} not found in Supabase")
                return jsonify({'error': 'Report not found'}), 404
            report = report_result.data[0]
        except Exception as e:
            current_app.logger.error(f"Error fetching report from Supabase: {e}")
            return jsonify({'error': 'فشل في جلب التقرير'}), 500
        
        current_app.logger.info(f"Found report: {report.get('name', 'Unknown')}")
        
        # إعادة تعيين عداد التحميلات
        try:
            client.table('reports').update({'download_count': 0}).eq('id', report_id).execute()
            current_app.logger.info("Download count reset to 0")
        except Exception as e:
            current_app.logger.error(f"Error updating download count in Supabase: {e}")
            return jsonify({'error': 'فشل في إعادة تعيين عداد التحميلات'}), 500
        
        # تسجيل العملية
        db.session.add(Log(
            action='report_download_count_reset',
            user_id=user_id,
            details=json.dumps({'report_id': report_id}),
            timestamp=now_baghdad()
        ))
        db.session.commit()
        
        create_blockchain_record('report_download_count_reset', {'report_id': report_id}, user_id)
        
        return jsonify({'message': 'Download count reset successfully', 'download_count': 0}), 200
        
    except Exception as e:
        current_app.logger.exception("Error resetting download count")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@reports_bp.route('/reset-all-download-counts', methods=['OPTIONS', 'POST'])
@jwt_required()
def reset_all_download_counts():
    """إعادة تعيين عداد التحميلات لجميع التقارير"""
    if request.method == 'OPTIONS':
        return _build_cors_preflight()
    
    try:
        user_id = get_jwt_identity()
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500
        
        # إعادة تعيين جميع عدادات التحميلات في Supabase
        try:
            # Get all reports first to count them
            reports_result = client.table('reports').select('id').execute()
            total_reports = len(reports_result.data) if reports_result.data else 0
            
            # Reset all download counts
            client.table('reports').update({'download_count': 0}).neq('id', 0).execute()
            
            current_app.logger.info(f"Reset download count for {total_reports} reports")
            reset_count = total_reports
        except Exception as e:
            current_app.logger.error(f"Error resetting download counts in Supabase: {e}")
            return jsonify({'error': 'فشل في إعادة تعيين عدادات التحميلات'}), 500
        
        # تسجيل العملية في Supabase
        try:
            log_data = {
                'action': 'all_reports_download_count_reset',
                'user_id': user_id,
                'details': json.dumps({'count': reset_count}),
                'timestamp': now_baghdad().isoformat(),
                'ip_address': request.remote_addr,
                'success': True
            }
            client.table('logs').insert(log_data).execute()
        except Exception as log_error:
            current_app.logger.warning(f"Error logging to Supabase: {log_error}")
        
        create_blockchain_record('all_reports_download_count_reset', {'count': reset_count}, user_id)
        
        return jsonify({'message': f'Reset download count for {reset_count} reports'}), 200
        
    except Exception as e:
        current_app.logger.exception("Error resetting all download counts")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@reports_bp.route('/bulk-delete', methods=['OPTIONS', 'POST'])
@jwt_required()
def bulk_delete_reports():
    """حذف عدة تقارير مرة واحدة"""
    if request.method == 'OPTIONS':
        return _build_cors_preflight()
    
    try:
        user_id = get_jwt_identity()
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500
            
        data = request.get_json() or {}
        report_ids = data.get('report_ids', [])
        
        if not report_ids:
            return jsonify({'error': 'لم يتم تحديد تقارير للحذف'}), 400
        
        deleted_count = 0
        errors = []
        
        for report_id in report_ids:
            try:
                # البحث عن التقرير في Supabase
                report_result = client.table('reports').select('*').eq('id', report_id).execute()
                if report_result.data:
                    report = report_result.data[0]
                    
                    # حذف الملف من النظام إذا كان موجوداً
                    import os
                    if report.get('file_path') and os.path.exists(report['file_path']):
                        try:
                            os.remove(report['file_path'])
                        except OSError as e:
                            current_app.logger.warning(f"Could not delete file {report['file_path']}: {e}")
                    
                    # حذف التقرير من Supabase
                    client.table('reports').delete().eq('id', report_id).execute()
                    deleted_count += 1
                else:
                    errors.append(f"التقرير {report_id} غير موجود")
                    
            except Exception as e:
                errors.append(f"خطأ في حذف التقرير {report_id}: {str(e)}")
        
        if deleted_count > 0:
            # تسجيل في البلوك تشين
            create_blockchain_record(
                'bulk_reports_deleted',
                {'deleted_count': deleted_count, 'errors': errors, 'deleted_by': user_id},
                user_id
            )
            
            generate_alert(f"Bulk deleted {deleted_count} reports", 'normal')
        
        return jsonify({
            'message': f'تم حذف {deleted_count} تقرير بنجاح',
            'deleted_count': deleted_count,
            'errors': errors
        }), 200
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Error in bulk delete reports")
        generate_alert(f"Error in bulk delete reports: {e}", 'high')
        return jsonify({'error': 'خطأ في حذف التقارير'}), 500

