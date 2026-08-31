/** TeleShort v2.1 — Financial Reward Claim */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { getClientIp, hashIp } = require('../utils/crypto');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports=async function handler(req,res){
  if(handleCors(req,res)) return;
  if(req.method!=='POST') return sendError(res,'Method Not Allowed',405);
  const {session_id,initData}=req.body||{};
  if(!session_id)return sendError(res,'Session ID is required',400,'MISSING_SESSION_ID');
  const auth=verifyTelegramWebAppData(initData||req.headers['x-telegram-init-data'],process.env.BOT_TOKEN);
  if(!auth.valid||!auth.user)return sendError(res,auth.error||'Invalid Telegram authentication signature',401,'INVALID_AUTH');
  const visitorId=Number(auth.user.id);const ipHash=hashIp(getClientIp(req));
  const rateLimit=await checkRateLimit(`claim_${visitorId}`,'reward_claim',10,60);if(!rateLimit.allowed)return sendError(res,'Too many reward claim attempts. Please wait.',429,'RATE_LIMITED');
  if(!process.env.CHALLENGE_SECRET||process.env.CHALLENGE_SECRET.length<16)return sendError(res,'Server reward security is not configured',503,'SERVER_CONFIG_ERROR');
  try{
    const supabase=getSupabaseClient();
    const {data:session,error:sessionErr}=await supabase.from('ad_sessions').select('id,link_id,visitor_telegram_id,step,status,started_at,expires_at,metadata,links(id,short_code,owner_id,original_url,status)').eq('id',session_id).single();
    if(sessionErr||!session)return sendError(res,'Ad session not found',404,'SESSION_NOT_FOUND');
    const link=session.links;if(!link)return sendError(res,'Associated link not found',404,'LINK_NOT_FOUND');
    if(String(session.visitor_telegram_id)!==String(visitorId))return sendError(res,'Unauthorized: session belongs to another user',403,'UNAUTHORIZED_SESSION');
    if(session.status==='REWARD_CLAIMED'||session.status==='UNLOCKED'){
      const {data:existingTx}=await supabase.from('wallet_transactions').select('id,amount,currency,created_at').eq('reference_type','AD_REWARD').eq('reference_id',session.id).eq('type','AD_REWARD').maybeSingle();
      return sendSuccess(res,{success:true,session_id:session.id,reward_amount:Number(existingTx?.amount||0),currency:existingTx?.currency||'INR',transaction_id:existingTx?.id||null,owner_id:link.owner_id,is_owner:Boolean(session.metadata?.is_owner),destination_url:link.original_url,unlocked:true,idempotent_replay:true});
    }
    if(session.status!=='REWARD_ELIGIBLE')return sendError(res,`Cannot claim reward. Current session status is ${session.status}`,400,'INVALID_SESSION_STATE');
    if(new Date(session.expires_at).getTime()<Date.now()){await supabase.from('ad_sessions').update({status:'EXPIRED'}).eq('id',session_id);return sendError(res,'Ad session has expired. Please restart.',410,'SESSION_EXPIRED');}
    if(link.status!=='ACTIVE')return sendError(res,'Link is not active and cannot be claimed',403,'LINK_INACTIVE');

    const isOwner=Boolean(session.metadata?.is_owner);
    if(!Boolean(session.metadata?.is_eligible)||isOwner){
      await supabase.from('ad_sessions').update({status:'UNLOCKED',completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',session_id);
      return sendSuccess(res,{success:true,session_id:session.id,reward_amount:0,currency:'INR',owner_id:link.owner_id,is_owner:isOwner,is_eligible:false,ineligible_reason:session.metadata?.ineligible_reason||(isOwner?'SELF_CLICK':'FRAUD_HEURISTIC'),destination_url:link.original_url,unlocked:true});
    }

    const {data:settingsList,error:settingsErr}=await supabase.from('settings').select('key,value').in('key',['publisher_payout_cpm','referral_config']);
    if(settingsErr)throw settingsErr;
    const map={};(settingsList||[]).forEach(s=>{map[s.key]=s.value||{};});
    const cpm=Number(map.publisher_payout_cpm?.rate_inr??160);const rewardAmount=Number((cpm/1000).toFixed(4));
    const referralPercent=Number(map.referral_config?.commission_percent??10);

    const {data:rpcResult,error:rpcErr}=await supabase.rpc('record_reward_claim',{p_session_id:session.id,p_link_id:link.id,p_owner_id:link.owner_id,p_reward_amount:rewardAmount,p_referral_percent:referralPercent,p_visitor_tg_id:visitorId,p_ip_hash:ipHash,p_fraud_score:Number(session.metadata?.fraud_score||0),p_server_secret:process.env.CHALLENGE_SECRET});
    if(rpcErr)throw rpcErr;
    await supabase.from('audit_logs').insert([{actor_type:'SYSTEM',actor_id:String(visitorId),action:'REWARD_CLAIM_SUCCESS',target_type:'WALLET_TRANSACTION',target_id:session.id,metadata:{link_id:link.id,owner_id:link.owner_id,visitor_id:visitorId,reward_amount:rewardAmount,referral_commission:rpcResult?.referral_commission||0}}]);
    return sendSuccess(res,{success:true,session_id:session.id,reward_amount:rewardAmount,currency:'INR',owner_id:link.owner_id,owner_new_balance:rpcResult?.owner_new_balance,referral_credited:Number(rpcResult?.referral_commission||0)>0,referral_commission:Number(rpcResult?.referral_commission||0),destination_url:link.original_url,unlocked:true});
  }catch(error){console.error('[Reward Claim Error]:',error);return sendError(res,error.message||'Error processing reward claim',500,'REWARD_CLAIM_ERROR');}
};
