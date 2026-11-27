# services/offline_service.py

import os
import json
import logging

from extensions import socketio

logger = logging.getLogger(__name__)

def sync_offline_events():
    """
    يُستدعى بشكل دوري لإرسال أي أحداث USB مخزنة أثناء 
    وضع offline إلى Socket.IO عندما يعود الاتصال.
    """
    offline_path = os.getenv('OFFLINE_CACHE_PATH', 'offline_events.json')
    if not os.path.exists(offline_path):
        logger.debug(f"No offline events file at {offline_path}")
        return

    try:
        with open(offline_path, 'r', encoding='utf-8') as f:
            events = json.load(f)
    except Exception as e:
        logger.error(f"Failed to read offline events file '{offline_path}': {e}")
        return

    for ev in events:
        event   = ev.get('event')
        payload = ev.get('payload')
        try:
            socketio.emit(event, payload, namespace="/api/devices")
            logger.debug(f"Emitted offline event '{event}' with payload: {payload}")
        except Exception as emit_err:
            logger.error(f"Failed to emit event '{event}': {emit_err}")

    try:
        os.remove(offline_path)
        logger.info(f"Offline events synchronized; removed '{offline_path}'")
    except Exception as rm_err:
        logger.error(f"Failed to remove offline events file '{offline_path}': {rm_err}")

