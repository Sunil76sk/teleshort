/** TeleShort v2.1 — Distributed Sliding-Window Rate Limiter */
const { getRedisClient } = require('./redis');
const memorySlidingLogs=new Map();

async function checkRateLimit(identifier,action,maxRequests=30,windowSeconds=60){
  const sanitizedId=String(identifier).replace(/[^a-zA-Z0-9_:-]/g,'');
  const key=`ratelimit:${action}:${sanitizedId}`;const now=Date.now();const windowMs=windowSeconds*1000;const windowStart=now-windowMs;
  const client=getRedisClient();
  if(client){
    try{
      await client.zremrangebyscore(key,0,windowStart);const count=await client.zcard(key);
      if(count>=maxRequests)return {allowed:false,count,remaining:0,resetIn:windowSeconds,algorithm:'SLIDING_WINDOW_LOG_REDIS'};
      const member=`${now}-${Math.random().toString(36).slice(2,8)}`;await client.zadd(key,{score:now,member});await client.expire(key,windowSeconds*2);
      return {allowed:true,count:count+1,remaining:maxRequests-count-1,resetIn:windowSeconds,algorithm:'SLIDING_WINDOW_LOG_REDIS'};
    }catch(_error){/* Redis is optional; use process-local limiter below. */}
  }
  const timestamps=(memorySlidingLogs.get(key)||[]).filter(ts=>ts>windowStart);
  if(timestamps.length>=maxRequests){memorySlidingLogs.set(key,timestamps);return {allowed:false,count:timestamps.length,remaining:0,resetIn:windowSeconds,algorithm:'SLIDING_WINDOW_LOG_MEMORY'};}
  timestamps.push(now);memorySlidingLogs.set(key,timestamps);
  return {allowed:true,count:timestamps.length,remaining:maxRequests-timestamps.length,resetIn:windowSeconds,algorithm:'SLIDING_WINDOW_LOG_MEMORY'};
}
module.exports={checkRateLimit};
