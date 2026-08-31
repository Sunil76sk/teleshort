/**
 * TeleShort v2.1 — Admin Telegram Broadcasts API Endpoint (Phase 8)
 * POST /api/admin/broadcasts — Create new broadcast draft
 * GET /api/admin/broadcasts — List all broadcasts
 */

const { handleCors, sendSuccess, sendError } = require('../../utils/response');
const { authenticateAdmin } = require('../../utils/auth');
const { getSupabaseClient } = require('../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // 1. Authenticate Admin (SUPER_ADMIN and MARKETING_ADMIN)
  const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'MARKETING_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_ADMIN']);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
  }

  const supabase = getSupabaseClient();

  // =========================================================================
  // POST /api/admin/broadcasts — Create Broadcast
  // =========================================================================
  if (req.method === 'POST') {
    if (auth.admin.role !== 'SUPER_ADMIN' && auth.admin.role !== 'MARKETING_ADMIN') {
      return sendError(res, 'Only SUPER_ADMIN or MARKETING_ADMIN can create broadcasts', 403, 'FORBIDDEN');
    }

    const {
      message,
      image_url,
      button_text,
      button_url,
      target_audience = 'ALL_USERS'
    } = req.body || {};

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return sendError(res, 'Broadcast message text is required', 400, 'MISSING_MESSAGE');
    }

    const allowedAudiences = new Set(['ALL_USERS', 'ACTIVE_USERS', 'USERS_WITH_BALANCE', 'USERS_WITH_REFERRALS']);
    if (!allowedAudiences.has(target_audience)) {
      return sendError(res, 'Invalid target audience selection', 400, 'INVALID_AUDIENCE');
    }

    try {
      // 1. Calculate estimated recipient count
      let query = supabase.from('users').select('*', { count: 'exact', head: true });
      if (target_audience === 'ACTIVE_USERS') query = query.eq('status', 'ACTIVE');
      if (target_audience === 'USERS_WITH_BALANCE') query = query.gt('balance', 0);
      if (target_audience === 'USERS_WITH_REFERRALS') query = query.gt('total_earned', 0);

      const { count: recipientCount } = await query;

      // 2. Insert Broadcast record
      const { data: broadcast, error: insertErr } = await supabase
        .from('broadcasts')
        .insert([
          {
            message: message.trim(),
            image_url: image_url ? String(image_url).trim() : null,
            button_text: button_text ? String(button_text).trim() : null,
            button_url: button_url ? String(button_url).trim() : null,
            status: 'PENDING',
            total_recipients: recipientCount || 0,
            sent_count: 0,
            failed_count: 0
          }
        ])
        .select('*')
        .single();

      if (insertErr) throw insertErr;

      // 3. Log Audit Record
      await supabase.from('audit_logs').insert([
        {
          actor_type: 'ADMIN',
          actor_id: auth.admin.userId || auth.admin.username || 'ADMIN',
          action: 'BROADCAST_CREATED',
          target_type: 'BROADCAST',
          target_id: broadcast.id,
          metadata: {
            target_audience,
            estimated_recipients: recipientCount
          }
        }
      ]);

      return sendSuccess(res, {
        broadcast,
        target_audience,
        estimated_recipients: recipientCount || 0,
        message: 'Broadcast draft created successfully'
      }, 201);
    } catch (error) {
      console.error('[Create Broadcast Error]:', error);
      return sendError(res, error.message || 'Error creating broadcast', 500);
    }
  }

  // =========================================================================
  // GET /api/admin/broadcasts — List Broadcasts
  // =========================================================================
  if (req.method === 'GET') {
    try {
      const page = Math.max(1, parseInt(req.query?.page || '1', 10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
      const offset = (page - 1) * limit;

      const { data: broadcasts, error, count } = await supabase
        .from('broadcasts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return sendSuccess(res, {
        broadcasts: broadcasts || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      });
    } catch (error) {
      console.error('[List Broadcasts Error]:', error);
      return sendError(res, error.message || 'Error fetching broadcasts', 500);
    }
  }

  return sendError(res, 'Method Not Allowed', 405);
};
