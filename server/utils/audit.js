/** TeleShort — non-blocking security audit logger. */
const { getSupabaseClient } = require('./db');

async function writeAuditLog({ actorType, actorId = null, action, targetType = null, targetId = null, metadata = {} }) {
  if (!action) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('audit_logs').insert([{
      actor_type: actorType || 'SYSTEM',
      actor_id: actorId == null ? null : String(actorId),
      action: String(action),
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId),
      metadata: metadata && typeof metadata === 'object' ? metadata : {}
    }]);
    if (error) {
      console.error('[Audit Log Error]:', error.message || error);
      return false;
    }
    return true;
  } catch (error) {
    // Auditing must never turn a valid auth/admin response into a 500.
    console.error('[Audit Log Error]:', error.message || error);
    return false;
  }
}

module.exports = { writeAuditLog };
