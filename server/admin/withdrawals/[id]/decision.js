/** TeleShort v2.1 — Admin Withdrawal Decision */
const { handleCors, sendSuccess, sendError } = require('../../../utils/response');
const { authenticateAdmin } = require('../../../utils/auth');
const { getSupabaseClient } = require('../../../utils/db');

module.exports=async function handler(req,res){
  if(handleCors(req,res))return;
  if(req.method!=='POST')return sendError(res,'Method Not Allowed',405);
  const auth=authenticateAdmin(req,['SUPER_ADMIN','FINANCE_ADMIN']);
  if(!auth.authenticated||!auth.admin)return sendError(res,auth.error||'Financial admin authorization required',403,'FORBIDDEN');
  if(!process.env.CHALLENGE_SECRET||process.env.CHALLENGE_SECRET.length<16)return sendError(res,'Server financial security is not configured',503,'SERVER_CONFIG_ERROR');
  const withdrawalId=req.query?.id;if(!withdrawalId)return sendError(res,'Withdrawal ID is required',400,'MISSING_WITHDRAWAL_ID');
  const {status,admin_notes,payout_tx_id}=req.body||{};const normalized=String(status||'').toUpperCase();
  if(!new Set(['UNDER_REVIEW','APPROVED','PROCESSING','PAID','REJECTED','CANCELLED']).has(normalized))return sendError(res,'Invalid withdrawal status decision',400,'INVALID_STATUS');
  try{
    const supabase=getSupabaseClient();
    const {data,error}=await supabase.rpc('process_withdrawal_decision',{p_withdrawal_id:withdrawalId,p_new_status:normalized,p_admin_id:String(auth.admin.id||auth.admin.username||'ADMIN'),p_admin_notes:admin_notes?String(admin_notes).trim():null,p_payout_tx_id:payout_tx_id?String(payout_tx_id).trim():null,p_server_secret:process.env.CHALLENGE_SECRET});
    if(error){const msg=String(error.message||'');if(msg.includes('WITHDRAWAL_NOT_FOUND'))return sendError(res,'Withdrawal not found',404,'NOT_FOUND');if(msg.includes('ALREADY_PAID'))return sendError(res,'Withdrawal has already been marked as PAID',409,'ALREADY_PAID');if(msg.includes('ALREADY_REJECTED'))return sendError(res,'Withdrawal has already been rejected and refunded',409,'ALREADY_REJECTED');throw error;}
    return sendSuccess(res,{success:true,withdrawal_id:withdrawalId,status:normalized,message:`Withdrawal status successfully updated to ${normalized}`,refunded:Boolean(data?.refunded)});
  }catch(error){console.error('[Admin Withdrawal Decision Error]:',error);return sendError(res,error.message||'Error processing withdrawal decision',500,'WITHDRAWAL_DECISION_ERROR');}
};
