# backend/services/alert_service.py

import json
import openai
from flask import current_app
from extensions import db, socketio
from models import Report, GeneratedReport, Log
from utils import generate_alert, current_time
from services.blockchain_service import create_blockchain_record

def generate_report_content(report: Report) -> str:
    """
    Use OpenAI to generate report content based on a Report definition.
    Raises on failure.
    """
    api_key = current_app.config.get('OPENAI_API_KEY')
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    openai.api_key = api_key
    model = current_app.config.get("AI_REPORT_MODEL", "gpt-4o-mini")
    max_tokens = current_app.config.get("REPORT_MAX_TOKENS", 512)

    prompt = (
        f"Generate a '{report.report_type}' report:\n"
        f"Parameters: {report.params}\n"
        "Include a summary, detected anomalies, and actionable recommendations."
    )

    try:
        resp = openai.ChatCompletion.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are an enterprise security reporting assistant."},
                {"role": "user",   "content": prompt}
            ],
            temperature=0.3,
            max_tokens=max_tokens
        )
        return resp.choices[0].message.content
    except Exception as e:
        current_app.logger.exception(f"OpenAI report generation failed for report {report.id}")
        # Generate an alert on failure
        generate_alert(
            f"Failed to generate report content for '{report.name}' (ID {report.id})",
            "high",
            {"error": str(e), "report_id": report.id}
        )
        raise

def run_report(report_id: int, user_id: int = None) -> GeneratedReport:
    """
    Generate a single report immediately:
    - Call OpenAI to build content
    - Persist a GeneratedReport
    - Log the action, emit alerts, record to blockchain, broadcast via Socket.IO
    """
    rpt = Report.query.get(report_id)
    if not rpt:
        current_app.logger.error(f"Report ID {report_id} not found")
        return None
    if not rpt.is_active:
        current_app.logger.info(f"Report ID {report_id} is inactive; skipping")
        return None

    try:
        content = generate_report_content(rpt)
    except Exception:
        # Alert was already generated inside generate_report_content
        return None

    now = current_time()  # توقيت بغداد

    # Persist generated content
    gen = GeneratedReport(
        report_id=report_id,
        generated_at=now,
        content=content
    )
    db.session.add(gen)
    db.session.commit()

    # Audit log
    log = Log(
        action="report_generated",
        user_id=user_id,
        details=json.dumps({"report_id": report_id, "generated_id": gen.id}),
        timestamp=now
    )
    db.session.add(log)
    db.session.commit()

    # Blockchain record
    create_blockchain_record(
        "report_generated",
        {"report_id": report_id, "generated_id": gen.id},
        user_id
    )

    # Alert admins
    generate_alert(
        f"Report generated: {rpt.name}",
        "normal",
        {"report_id": report_id, "generated_id": gen.id}
    )

    # Broadcast to clients
    try:
        socketio.emit(
            "report:generated",
            gen.to_dict(),
            namespace="/reports",
            broadcast=True
        )
    except Exception:
        current_app.logger.exception("Failed to emit report_generated event")

    return gen

def generate_all_reports():
    """
    Scheduled entrypoint for APScheduler.
    Iterates through all active reports and runs them, with failure handling.
    """
    if not current_app.config.get("AI_MONITORING_ENABLED", True):
        current_app.logger.info("AI monitoring disabled; skipping scheduled reports")
        return

    for rpt in Report.query.filter_by(is_active=True).all():
        try:
            gen = run_report(rpt.id, user_id=None)
            if gen is None:
                # If run_report failed or returned None, generate an alert
                generate_alert(
                    f"Scheduled report '{rpt.name}' (ID {rpt.id}) did not complete",
                    "high",
                    {"report_id": rpt.id}
                )
        except Exception as e:
            current_app.logger.exception(f"Unexpected error during scheduled report {rpt.id}")
            generate_alert(
                f"Exception during scheduled report '{rpt.name}' (ID {rpt.id}): {e}",
                "high",
                {"report_id": rpt.id}
            )

def list_reports():
    """Return all report definitions, most recent first."""
    return [
        r.to_dict()
        for r in Report.query.order_by(Report.created_at.desc()).all()
    ]

def get_generated_history(
    report_id: int,
    limit: int = 20,
    offset: int = 0
):
    """
    Return paginated history of GeneratedReport entries for a given report.
    Returns (list of dicts, total_count).
    """
    total = GeneratedReport.query.filter_by(report_id=report_id).count()
    items = (
        GeneratedReport.query
        .filter_by(report_id=report_id)
        .order_by(GeneratedReport.generated_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return [g.to_dict() for g in items], total

