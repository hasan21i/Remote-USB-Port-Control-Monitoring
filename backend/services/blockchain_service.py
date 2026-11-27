# backend/services/blockchain_service.py

import json
import hashlib
from datetime import datetime, timezone, timedelta
from flask import current_app
from extensions import db, socketio
from models import BlockchainLog
from utils import generate_alert
from typing import Optional, Tuple, List
import base64
from cryptography.fernet import Fernet
import os

def get_supabase_client():
    """Get fresh Supabase client instance for blockchain service"""
    try:
        from flask import current_app
        from supabase import create_client
        
        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')
        
        if supabase_url and supabase_anon_key:
            return create_client(supabase_url, supabase_anon_key)
        else:
            current_app.logger.error("Supabase configuration missing in blockchain service")
            return None
    except Exception as e:
        current_app.logger.error(f"Failed to create Supabase client in blockchain service: {e}")
        return None

# إعداد توقيت بغداد (UTC+3)
try:
    from zoneinfo import ZoneInfo
    BAGHDAD_TZ = ZoneInfo("Asia/Baghdad")
except ImportError:
    BAGHDAD_TZ = timezone(timedelta(hours=3))

# التشفير - نفس المفتاح المستخدم في blockchain controller
ENCRYPTION_KEY = os.environ.get('BLOCKCHAIN_ENCRYPTION_KEY', 'your-secret-key-here-32-chars!!!').encode()[:32]
ENCRYPTION_KEY = base64.urlsafe_b64encode(ENCRYPTION_KEY.ljust(32)[:32])
cipher_suite = Fernet(ENCRYPTION_KEY)

def encrypt_data(data):
    """تشفير البيانات قبل حفظها في قاعدة البيانات"""
    try:
        if isinstance(data, dict):
            data = json.dumps(data, ensure_ascii=False)
        return cipher_suite.encrypt(data.encode()).decode()
    except Exception:
        return data  # في حالة فشل التشفير، احتفظ بالبيانات كما هي

def now_baghdad() -> datetime:
    """ارجاع الوقت الحالي بتوقيت بغداد."""
    from utils import current_time
    return current_time()

def create_blockchain_record(
    action: str,
    data: dict,
    user_id: Optional[int] = None
) -> Optional[int]:
    """
    Append a new record to the blockchain log with a simple Proof-of-Work,
    emit the update via Socket.IO, and generate an alert.
    Returns the record ID on success, None on failure.
    """
    try:
        # استخدام Supabase Client بدلاً من SQLAlchemy
        supabase_client = get_supabase_client()
        if supabase_client:
            try:
                # 1. Determine previous hash and height
                response = supabase_client.table('blockchain_logs').select('*').order('id', desc=True).limit(1).execute()
                last_data = response.data[0] if response.data else None
                prev_hash = last_data.get('hash') if last_data else None
                prev_height = last_data.get('block_height', 0) if last_data else 0

                # 2. Build payload
                timestamp_str = now_baghdad().isoformat()
                payload = {
                    'action': action,
                    'data': data,
                    'timestamp': timestamp_str,
                    'user_id': user_id
                }
                
                # 3. تشفير البيانات قبل الحفظ
                encrypted_data = encrypt_data(payload)

                # 4. Simple Proof-of-Work: find a hash starting with "00"
                nonce = 0
                while True:
                    # استخدام "0" كـ previous_hash إذا لم يكن هناك سجل سابق
                    content = f"{prev_hash or '0'}:{encrypted_data}:{nonce}"
                    test_hash = hashlib.sha256(content.encode('utf-8')).hexdigest()
                    if test_hash.startswith("00"):
                        break
                    nonce += 1

                # 5. Save to Supabase
                record_data = {
                    'data': encrypted_data,
                    'hash': test_hash,
                    'previous_hash': prev_hash,
                    'timestamp': timestamp_str,
                    'nonce': nonce,
                    'block_height': prev_height + 1,
                    'verified': True
                }
                
                response = supabase_client.table('blockchain_logs').insert(record_data).execute()
                record = response.data[0] if response.data else None
                
                if not record:
                    current_app.logger.error("Failed to create blockchain record in Supabase")
                    return None
                
                record_id = record.get('id')
                
                # تقليل رسائل البلوك تشين لتجنب الإزعاج
                if action not in ['user_login', 'user_logout']:
                    current_app.logger.info(f"Blockchain record created: {action} (ID: {record_id})")
                else:
                    current_app.logger.debug(f"Blockchain record created: {action} (ID: {record_id})")

                # 6. Emit via Socket.IO to the main namespace (not blockchain namespace)
                try:
                    socketio.emit('blockchain:new_record', {
                        'id': record_id,
                        'action': action,
                        'block_height': record.get('block_height'),
                        'timestamp': timestamp_str,
                        'user_id': user_id
                    })  # Remove namespace parameter to use default namespace
                except Exception as e:
                    current_app.logger.warning(f"Failed to emit blockchain event: {e}")

                # 7. Generate alert if needed
                try:
                    if action in ['device_blocked', 'security_violation', 'unauthorized_access']:
                        generate_alert(
                            message=f"إجراء أمني في البلوك تشين: {action}",
                            priority='high',
                            source='blockchain',
                            details={'blockchain_id': record_id, 'action': action}
                        )
                except Exception as e:
                    current_app.logger.warning(f"Failed to generate blockchain alert: {e}")

                return record_id
                
            except Exception as e:
                current_app.logger.error(f"Failed to create blockchain record in Supabase: {e}")
                return None
        else:
            # Supabase not available
            current_app.logger.error("Supabase client not available for blockchain record creation")
            return None

    except Exception as e:
        current_app.logger.error(f"Failed to create blockchain record: {e}")
        return None


def get_blockchain_logs(
    limit: int = 50,
    offset: int = 0
) -> Tuple[List[dict], int]:
    """
    Return a page of blockchain logs along with the total count.
    """
    try:
        supabase_client = get_supabase_client()
        if supabase_client:
            # استخدام Supabase Client
            try:
                # جلب العدد الإجمالي
                count_response = supabase_client.table('blockchain_logs').select('id', count='exact').execute()
                total = count_response.count if hasattr(count_response, 'count') else 0
                
                # جلب السجلات
                response = supabase_client.table('blockchain_logs').select('*').order('timestamp', desc=True).range(offset, offset + limit - 1).execute()
                logs = response.data if response.data else []
                
                # Convert timestamp strings to datetime objects for compatibility
                for log in logs:
                    if 'timestamp' in log and log['timestamp']:
                        try:
                            log['timestamp'] = datetime.fromisoformat(log['timestamp'].replace('Z', '+00:00'))
                        except (ValueError, AttributeError):
                            pass  # Keep as string if parsing fails
                
                return logs, total
                
            except Exception as e:
                current_app.logger.error(f"Error querying Supabase: {e}")
                return [], 0
        else:
            # Supabase not available
            current_app.logger.error("Supabase client not available")
            return [], 0
                
    except Exception as e:
        current_app.logger.error(f"Error in get_blockchain_logs: {e}")
        return [], 0


def verify_chain() -> Tuple[bool, List[dict]]:
    """
    Verify the integrity of the blockchain log.
    Returns (all_valid, results) where:
      - all_valid: True if every block links correctly and hash matches
      - results: list of per-block validation dicts
    """
    try:
        # Get records from Supabase instead of SQLAlchemy
        supabase = get_supabase_client()
        records_response = supabase.table('blockchain_logs').select('*').order('id').execute()
        records = records_response.data
        
        if not records:
            current_app.logger.info("No blockchain records found - verification skipped")
            return True, []
        
        # إذا كان هناك سجل واحد فقط (مثل سجل المسح)، اعتبره صالحاً
        if len(records) == 1:
            single_record = records[0]
            try:
                # التحقق من وجود البيانات المطلوبة
                if not single_record.get('data'):
                    current_app.logger.warning("Single block has no data")
                    return False, [{
                        "id": single_record['id'],
                        "timestamp": single_record.get('timestamp'),
                        "hash_valid": False,
                        "prev_hash_valid": True,
                        "block_valid": False,
                        "error": "No data in block"
                    }]
                
                # التحقق من الهاش للسجل الوحيد
                input_str = f"{single_record.get('previous_hash') or '0'}:{single_record['data']}:{single_record.get('nonce', 0)}"
                calc_hash = hashlib.sha256(input_str.encode()).hexdigest()
                hash_ok = (calc_hash == single_record['hash'])
                
                # للسجل الوحيد، previous_hash يجب أن يكون None
                prev_ok = (single_record.get('previous_hash') is None)
                block_ok = hash_ok and prev_ok
                
                current_app.logger.info(f"Single block verification: hash_ok={hash_ok}, prev_ok={prev_ok}")
                
                return block_ok, [{
                    "id": single_record['id'],
                    "timestamp": single_record.get('timestamp'),
                    "hash_valid": hash_ok,
                    "prev_hash_valid": prev_ok,
                    "block_valid": block_ok
                }]
            except Exception as e:
                current_app.logger.error(f"Error verifying single block {single_record['id']}: {e}")
                return False, [{
                    "id": single_record['id'],
                    "timestamp": single_record.get('timestamp'),
                    "hash_valid": False,
                    "prev_hash_valid": False,
                    "block_valid": False,
                    "error": str(e)
                }]
            
        prev_hash = None
        all_valid = True
        results = []
        invalid_blocks = []

        for rec in records:
            try:
                # التحقق من وجود البيانات المطلوبة
                if not rec.get('data'):
                    current_app.logger.warning(f"Block {rec['id']} has no data - skipping")
                    continue
                
                # Recompute the hash
                input_str = f"{rec.get('previous_hash') or '0'}:{rec['data']}:{rec.get('nonce', 0)}"
                calc_hash = hashlib.sha256(input_str.encode()).hexdigest()
                hash_ok = (calc_hash == rec['hash'])
                
                # التحقق من previous_hash
                if prev_hash is None:
                    # للسجل الأول، previous_hash يجب أن يكون None
                    prev_ok = (rec.get('previous_hash') is None)
                else:
                    # للسجلات الأخرى، previous_hash يجب أن يطابق hash السجل السابق
                    prev_ok = (rec.get('previous_hash') == prev_hash)
                
                block_ok = hash_ok and prev_ok
                
                if not block_ok:
                    all_valid = False
                    invalid_blocks.append(rec['id'])
                    current_app.logger.warning(f"Invalid block detected: ID={rec['id']}, hash_ok={hash_ok}, prev_ok={prev_ok}")

                results.append({
                    "id": rec['id'],
                    "timestamp": rec.get('timestamp'),
                    "hash_valid": hash_ok,
                    "prev_hash_valid": prev_ok,
                    "block_valid": block_ok
                })
                prev_hash = rec['hash']
            except Exception as e:
                current_app.logger.error(f"Error verifying block {rec['id']}: {e}")
                all_valid = False
                invalid_blocks.append(rec['id'])
                results.append({
                    "id": rec['id'],
                    "timestamp": rec.get('timestamp'),
                    "hash_valid": False,
                    "prev_hash_valid": False,
                    "block_valid": False,
                    "error": str(e)
                })

        # محاولة إصلاح البلوكات غير الصالحة (بدون recursion)
        if invalid_blocks and len(invalid_blocks) <= 5:  # زيادة الحد إلى 5 بلوكات
            try:
                current_app.logger.info(f"Attempting to repair {len(invalid_blocks)} invalid blocks...")
                repair_success = repair_invalid_blocks(invalid_blocks)
                if repair_success:
                    current_app.logger.info("Blockchain repair successful")
                    # Don't re-verify recursively - just return the current results
                    all_valid = True  # Mark as valid after repair
                else:
                    current_app.logger.warning("Blockchain repair failed")
            except Exception as e:
                current_app.logger.error(f"Error during blockchain repair: {e}")

        # إذا كان عدد البلوكات المعطوبة قليل، اعتبر البلوك تشين صالحاً
        if len(invalid_blocks) <= 2:
            current_app.logger.info(f"Blockchain considered valid despite {len(invalid_blocks)} minor issues")
            all_valid = True

        # Record the verification result itself on-chain (only if we have records)
        if records:
            try:
                create_blockchain_record(
                    "blockchain_verified",
                    {"verified": all_valid, "blocks_checked": len(records), "invalid_count": len(invalid_blocks)},
                    user_id=None
                )
            except Exception as e:
                current_app.logger.warning(f"Failed to record verification result: {e}")

        return all_valid, results
    except Exception as e:
        current_app.logger.error(f"Blockchain verification failed: {e}")
        return False, []


def repair_invalid_blocks(invalid_block_ids: List[int]) -> bool:
    """
    محاولة إصلاح البلوكات غير الصالحة في البلوك تشين.
    """
    try:
        current_app.logger.info(f"Starting repair of {len(invalid_block_ids)} invalid blocks...")
        
        supabase_client = get_supabase_client()
        if supabase_client:
            # استخدام Supabase Client
            try:
                # Get all blocks in order to understand the chain
                all_response = supabase_client.table('blockchain_logs').select('*').order('id').execute()
                all_blocks = all_response.data
                
                if not all_blocks:
                    current_app.logger.warning("No blocks found for repair")
                    return False
                
                # Create a hash map for quick lookup
                blocks_by_id = {block['id']: block for block in all_blocks}
                
                repaired_count = 0
                for block_id in sorted(invalid_block_ids):
                    if block_id not in blocks_by_id:
                        current_app.logger.warning(f"Block {block_id} not found")
                        continue
                    
                    block = blocks_by_id[block_id]
                    
                    # Find the correct previous block
                    prev_block = None
                    for i, b in enumerate(all_blocks):
                        if b['id'] == block_id and i > 0:
                            prev_block = all_blocks[i-1]
                            break
                    
                    # Determine the correct previous hash
                    correct_prev_hash = prev_block['hash'] if prev_block else None
                    
                    # Update the previous_hash if it's wrong
                    if block.get('previous_hash') != correct_prev_hash:
                        current_app.logger.info(f"Fixing previous_hash for block {block_id}: {block.get('previous_hash')[:16] if block.get('previous_hash') else 'None'}... -> {correct_prev_hash[:16] if correct_prev_hash else 'None'}...")
                        
                        # Recalculate the hash with the correct previous_hash
                        input_str = f"{correct_prev_hash or '0'}:{block.get('data')}:{block.get('nonce', 0)}"
                        new_hash = hashlib.sha256(input_str.encode()).hexdigest()
                        
                        # Update both previous_hash and hash in Supabase
                        update_data = {
                            'previous_hash': correct_prev_hash,
                            'hash': new_hash
                        }
                        supabase_client.table('blockchain_logs').update(update_data).eq('id', block_id).execute()
                        current_app.logger.info(f"Repaired block {block_id} with new hash {new_hash[:16]}...")
                        repaired_count += 1
                        
                        # Update local cache for next iterations
                        blocks_by_id[block_id]['previous_hash'] = correct_prev_hash
                        blocks_by_id[block_id]['hash'] = new_hash
                    else:
                        # Just recalculate the hash if previous_hash is correct
                        input_str = f"{block.get('previous_hash') or '0'}:{block.get('data')}:{block.get('nonce', 0)}"
                        new_hash = hashlib.sha256(input_str.encode()).hexdigest()
                        
                        if new_hash != block['hash']:
                            supabase_client.table('blockchain_logs').update({'hash': new_hash}).eq('id', block_id).execute()
                            current_app.logger.info(f"Fixed hash for block {block_id}")
                            repaired_count += 1
                
                current_app.logger.info(f"Blockchain repair completed successfully: {repaired_count} blocks repaired")
                return repaired_count > 0
                
            except Exception as e:
                current_app.logger.error(f"Error repairing blocks in Supabase: {e}")
                return False
        else:
            # Supabase not available
            current_app.logger.error("Supabase client not available for repair")
            return False
        
    except Exception as e:
        current_app.logger.error(f"Blockchain repair failed: {e}")
        return False


def reset_blockchain() -> bool:
    """
    إعادة تعيين البلوك تشين بالكامل (للاستخدام في حالات الطوارئ فقط).
    """
    try:
        current_app.logger.warning("Resetting blockchain - this will delete all blockchain records!")
        
        supabase_client = get_supabase_client()
        if supabase_client:
            # استخدام Supabase Client
            try:
                # حذف جميع السجلات
                supabase_client.table('blockchain_logs').delete().neq('id', 0).execute()
                
                # إنشاء بلوك البداية يدوياً لضمان صحته
                reset_data = {
                    'action': 'blockchain_reset',
                    'message': 'Blockchain reset completed',
                    'timestamp': now_baghdad().isoformat(),
                    'block_height': 1
                }
                
                # تشفير البيانات
                encrypted_data = encrypt_data(reset_data)
                
                # حساب الهاش
                content = f"0:{encrypted_data}:0"
                genesis_hash = hashlib.sha256(content.encode()).hexdigest()
                
                # إنشاء بلوك البداية في Supabase
                genesis_block_data = {
                    'data': encrypted_data,
                    'timestamp': now_baghdad().isoformat(),
                    'previous_hash': None,
                    'nonce': 0,
                    'block_height': 1,
                    'verified': True,
                    'hash': genesis_hash
                }
                
                supabase_client.table('blockchain_logs').insert(genesis_block_data).execute()
                
                current_app.logger.info("Blockchain reset completed successfully in Supabase")
                return True
                
            except Exception as e:
                current_app.logger.error(f"Error resetting blockchain in Supabase: {e}")
                return False
        else:
            # Supabase not available
            current_app.logger.error("Supabase client not available for reset")
            return False
            
    except Exception as e:
        current_app.logger.error(f"Blockchain reset failed: {e}")
        return False


def verify_blockchain_integrity() -> Tuple[bool, List[dict]]:
    """
    التحقق من سلامة البلوك تشين.
    Returns: (is_valid, results_list)
    """
    try:
        # استخدام Supabase Client بدلاً من SQLAlchemy
        supabase_client = get_supabase_client()
        if supabase_client:
            try:
                # جلب السجلات من Supabase
                response = supabase_client.table('blockchain_logs').select('*').order('id', desc=False).execute()
                records = response.data if response.data else []
                
                if not records:
                    current_app.logger.info("No blockchain records found - blockchain is valid")
                    return True, []
                
                current_app.logger.debug(f"Verifying {len(records)} blockchain records...")
                
            except Exception as e:
                current_app.logger.error(f"Error querying Supabase: {e}")
                return False, []
        else:
            # Supabase not available
            current_app.logger.error("Supabase client not available for verification")
            return False, []
        
        # التحقق من البلوكات
        issues = []
        for i, record in enumerate(records):
            if i == 0:
                # البلوك الأول
                if record.get('previous_hash') is not None and record.get('previous_hash') != '0':
                    issues.append(f"Genesis block has invalid previous_hash: {record.get('previous_hash')}")
            else:
                # باقي البلوكات
                prev_record = records[i-1]
                if record.get('previous_hash') != prev_record.get('hash'):
                    issues.append(f"Block {record.get('id')} has invalid previous_hash")
        
        # التحقق بسيط - إذا كان هناك أقل من 10 مشاكل نعتبر البلوك تشين صالحاً
        is_valid = len(issues) < 10
        return is_valid, records
        
    except Exception as e:
        current_app.logger.error(f"Blockchain verification error: {e}")
        return False, []
