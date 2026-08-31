/** TeleShort v2.2 — Current User Profile & Analytics */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return sendError(res, 'Method Not Allowed', 405);
  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');

  try {
    const supabase = getSupabaseClient();
    const telegramId = Number(auth.user.id);
    const { data: user, error } = await supabase.from('users').select('id,telegram_id,username,first_name,balance,total_earned,total_earnings,status,is_blocked,created_at,last_seen_at').eq('telegram_id', telegramId).maybeSingle();
    if (error) throw error;
    if (!user) return sendError(res, 'User account not found. Please reopen the Telegram Mini App.', 404, 'USER_NOT_FOUND');

    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [links, todayTx, referrals] = await Promise.all([
      supabase.from('links').select('id', { count: 'exact', head: true }).eq('owner_id', user.id),
      supabase.from('wallet_transactions').select('amount,type').eq('user_id', user.id).gte('created_at', start.toISOString()),
      supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_tg_id', telegramId)
    ]);
    if (links.error) throw links.error;
    if (todayTx.error) throw todayTx.error;
    if (referrals.error) throw referrals.error;

    const todayEarnings = (todayTx.data || []).filter(t => ['AD_REWARD', 'REFERRAL_REWARD', 'BONUS'].includes(t.type)).reduce((sum, t) => sum + Number(t.amount || 0), 0);
    return sendSuccess(res, {
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        balance: Number(user.balance || 0),
        total_earned: Number(user.total_earned || 0),
        total_earnings: Number(user.total_earnings || 0),
        status: user.status,
        is_blocked: Boolean(user.is_blocked),
        created_at: user.created_at,
        last_seen_at: user.last_seen_at
      },
      analytics: {
        links_created: links.count || 0,
        today_earnings: Number(todayEarnings.toFixed(4)),
        referral_count: referrals.count || 0
      }
    });
  } catch (error) {
    console.error('[User Me Error]:', error);
    return sendError(res, error.message || 'Failed to load account', 500, 'ME_ERROR');
  }
};
