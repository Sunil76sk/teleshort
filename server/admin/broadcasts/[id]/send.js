/** TeleShort v2.1 — Telegram Broadcast Dispatch */
const { handleCors, sendSuccess, sendError } = require('../../../utils/response');
const { authenticateAdmin } = require('../../../utils/auth');
const { getSupabaseClient } = require('../../../utils/db');

module.exports=async function handler(req,res){
  if(handleCors(req,res))return;
  if(req.method!=='POST')return sendError(res,'Method Not Allowed',405);
  const auth=authenticateAdmin(req,['SUPER_ADMIN','MARKETING_ADMIN']);if(!auth.authenticated||!auth.admin)return sendError(res,auth.error||'Admin authorization required',403,'FORBIDDEN');
  const broadcastId=req.query?.id;if(!broadcastId)return sendError(res,'Broadcast ID is required',400,'MISSING_BROADCAST_ID');
  const {confirm_large_send=false,target_audience='ALL_USERS'}=req.body||{};
  try{
    const supabase=getSupabaseClient();const botToken=String(process.env.BOT_TOKEN||'').trim();if(!botToken)return sendError(res,'BOT_TOKEN is not configured',503,'SERVER_CONFIG_ERROR');
    const {data:broadcast,error:fetchErr}=await supabase.from('broadcasts').select('*').eq('id',broadcastId).single();if(fetchErr||!broadcast)return sendError(res,'Broadcast not found',404,'NOT_FOUND');
    if(['COMPLETED','PROCESSING'].includes(broadcast.status))return sendError(res,`Broadcast is already ${String(broadcast.status).toLowerCase()}`,409,'BROADCAST_NOT_AVAILABLE');
    let userQuery=supabase.from('users').select('id,telegram_id,status');if(target_audience==='ACTIVE_USERS')userQuery=userQuery.eq('status','ACTIVE');if(target_audience==='USERS_WITH_BALANCE')userQuery=userQuery.gt('balance',0);if(target_audience==='USERS_WITH_REFERRALS')userQuery=userQuery.gt('total_earned',0);
    const {data:targetUsers,error:usersErr}=await userQuery; if(usersErr)throw usersErr;
    const recipients=(targetUsers||[]).filter(u=>Number.isSafeInteger(Number(u.telegram_id))&&Number(u.telegram_id)>0);const totalRecipients=recipients.length;
    if(totalRecipients>100&&!confirm_large_send&&auth.admin.role!=='SUPER_ADMIN')return sendError(res,`Broadcast targets ${totalRecipients} users. Please confirm the large send.`,400,'CONFIRMATION_REQUIRED');
    await supabase.from('broadcasts').update({status:'PROCESSING',total_recipients:totalRecipients}).eq('id',broadcastId);
    if(recipients.length){const rows=recipients.map(u=>({broadcast_id:broadcastId,user_id:u.id,status:'PENDING'}));for(let i=0;i<rows.length;i+=500){const {error}=await supabase.from('broadcast_deliveries').upsert(rows.slice(i,i+500),{onConflict:'broadcast_id,user_id'});if(error)throw error;}}
    let replyMarkup;if(broadcast.button_text&&broadcast.button_url)replyMarkup={inline_keyboard:[[{text:broadcast.button_text,url:broadcast.button_url}]]};
    let sentCount=0,failedCount=0;
    for(const recipient of recipients){
      try{
        const endpoint=broadcast.image_url?`https://api.telegram.org/bot${botToken}/sendPhoto`:`https://api.telegram.org/bot${botToken}/sendMessage`;
        const payload=broadcast.image_url?{chat_id:recipient.telegram_id,photo:broadcast.image_url,caption:broadcast.message,parse_mode:'HTML',reply_markup:replyMarkup}:{chat_id:recipient.telegram_id,text:broadcast.message,parse_mode:'HTML',reply_markup:replyMarkup};
        const tgRes=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const tgData=await tgRes.json();
        if(tgData.ok){sentCount++;await supabase.from('broadcast_deliveries').update({status:'SENT',sent_at:new Date().toISOString()}).eq('broadcast_id',broadcastId).eq('user_id',recipient.id);}else{failedCount++;const code=Number(tgData.error_code||0);await supabase.from('broadcast_deliveries').update({status:code===403?'BLOCKED':'FAILED',error_message:`${code}: ${tgData.description||'Telegram error'}`}).eq('broadcast_id',broadcastId).eq('user_id',recipient.id);if(code===429){const wait=Math.min(30000,Number(tgData.parameters?.retry_after||1)*1000);await new Promise(r=>setTimeout(r,wait));}}
      }catch(error){failedCount++;await supabase.from('broadcast_deliveries').update({status:'FAILED',error_message:error.message}).eq('broadcast_id',broadcastId).eq('user_id',recipient.id);}
    }
    await supabase.from('broadcasts').update({status:'COMPLETED',sent_count:sentCount,failed_count:failedCount,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',broadcastId);
    await supabase.from('audit_logs').insert([{actor_type:'ADMIN',actor_id:String(auth.admin.id||auth.admin.username||'ADMIN'),action:'BROADCAST_DISPATCHED',target_type:'BROADCAST',target_id:broadcastId,metadata:{total_recipients:totalRecipients,sent_count:sentCount,failed_count:failedCount}}]);
    return sendSuccess(res,{broadcast_id:broadcastId,status:'COMPLETED',total_recipients:totalRecipients,sent_count:sentCount,failed_count:failedCount,message:`Broadcast completed. Sent: ${sentCount}, Failed/Blocked: ${failedCount}`});
  }catch(error){console.error('[Broadcast Send Error]:',error);await getSupabaseClient().from('broadcasts').update({status:'PENDING'}).eq('id',broadcastId).catch(()=>{});return sendError(res,error.message||'Error dispatching broadcast',500,'BROADCAST_SEND_ERROR');}
};
