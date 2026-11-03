import {randomUUID} from 'node:crypto';
const day=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const fail=message=>{throw Object.assign(new Error(message),{status:429,ai_guard:true})};
export class AIUsage {
 constructor(store){this.store=store;this.serial=Promise.resolve()}
 lock(fn){const p=this.serial.then(fn);this.serial=p.catch(()=>{});return p}
 async setting(){return (await this.store.all('settings',{key:'youtube_ai_limits'}))[0]?.value||{daily_requests:0,rates:{}}}
 async save(d){
  if(!Number.isInteger(d.daily_requests)||d.daily_requests<0||d.daily_requests>10000)throw Object.assign(new Error('하루 요청 상한은 0~10000 정수로 입력해주세요.'),{status:400});
  const model=String(d.model||'').slice(0,100),rates=(await this.setting()).rates||{};
  if(model){for(const key of ['input_rate','output_rate'])if(d[key]!==null&&(!Number.isFinite(d[key])||d[key]<0||d[key]>1000))throw Object.assign(new Error('단가는 0~1000달러로 입력해주세요.'),{status:400});rates[model]={input:d.input_rate,output:d.output_rate}}
  await this.store.put('settings',{key:'youtube_ai_limits',value:{daily_requests:d.daily_requests,rates}});
 }
 async report(){
  const [limits,entries,pause]=await Promise.all([this.setting(),this.store.settingsPrefix('youtube_ai_call_'+day()+'_'),this.store.all('settings',{key:'youtube_ai_cooldown'})]);
  const calls=entries.map(r=>r.value),known=calls.filter(c=>c.estimated_usd!==null&&c.estimated_usd!==undefined);
  return {date:day(),limits,cooldown_until:pause[0]?.value||null,requests:calls.length,failed:calls.filter(c=>c.status==='failed').length,incomplete:calls.filter(c=>c.status==='incomplete').length,unknown_usage:calls.filter(c=>!c.usage).length,input_tokens:calls.reduce((n,c)=>n+(c.usage?.input_tokens||0),0),output_tokens:calls.reduce((n,c)=>n+(c.usage?.output_tokens||0),0),estimated_usd:known.length?known.reduce((n,c)=>n+c.estimated_usd,0):null,unpriced:calls.filter(c=>c.usage&&c.estimated_usd==null).length,recent:calls.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,20)};
 }
 async available(){
  const report=await this.report();if(Date.parse(report.cooldown_until)>Date.now())fail('Claude 한도 오류로 요청을 잠시 멈췄어요. '+new Date(report.cooldown_until).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})+' 이후 다시 요청해주세요.');
   if(report.limits.daily_requests&&report.requests>=report.limits.daily_requests)fail('설정한 오늘의 AI 요청 상한에 도달했어요. 연동 설정에서 상한을 변경하거나 한국시간 자정 이후 다시 요청해주세요.');
 }
 wrap(fetcher=fetch){return async(url,init)=>{
  let payload={};try{payload=JSON.parse(init.body)}catch{}
  const record=await this.lock(async()=>{
   await this.available();
   const row={id:randomUUID(),model:payload.model||'',created_at:new Date().toISOString(),status:'running',usage:null,estimated_usd:null};row.key='youtube_ai_call_'+day()+'_'+row.id;await this.store.put('settings',{key:row.key,value:row});return row;
  });
  const save=()=>this.store.put('settings',{key:record.key,value:record});
  try{
   const response=await fetcher(url,init);let body=null;try{body=await response.clone().json()}catch{}
   record.status=!response.ok?'failed':body?.stop_reason==='end_turn'?'done':'incomplete';record.reason=!response.ok?'HTTP '+response.status:String(body?.stop_reason||'응답 형식 확인 필요');
   if(body?.usage){record.usage={input_tokens:Math.max(0,Number(body.usage.input_tokens)||0),output_tokens:Math.max(0,Number(body.usage.output_tokens)||0)};const rates=(await this.setting()).rates?.[record.model];if(rates?.input!=null&&rates?.output!=null&&!body.usage.cache_creation_input_tokens&&!body.usage.cache_read_input_tokens)record.estimated_usd=(record.usage.input_tokens*rates.input+record.usage.output_tokens*rates.output)/1000000}
   if(response.status===429){const retry=response.headers?.get?.('retry-after'),seconds=Number(retry);const until=retry&&Number.isFinite(seconds)?Date.now()+Math.max(60,Math.min(seconds,86400))*1000:Math.max(Date.now()+300000,Date.parse(retry)||0);await this.store.put('settings',{key:'youtube_ai_cooldown',value:new Date(until).toISOString()})}
   await save();return response;
  }catch(error){record.status='failed';record.reason='연결 중단 · 사용량 확인 불가';await save();throw error}
 }}
}
