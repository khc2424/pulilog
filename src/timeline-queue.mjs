import {randomUUID} from 'node:crypto';
const prefix='youtube_timeline_job_';
const active=job=>['queued','running'].includes(job.status);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export class TimelineQueue {
 constructor(store,run,busy=()=>false){this.store=store;this.run=run;this.busy=busy;this.running=false;this.closed=false;this.timer=null;this.initializing=null;this.adding=Promise.resolve()}
 async save(job){job.updated_at=new Date().toISOString();await this.store.put('settings',{key:prefix+job.id,value:job});return job}
 async rows(){return (await this.store.all('settings')).filter(row=>row.key.startsWith(prefix)).map(row=>row.value).sort((a,b)=>(a.sequence??Date.parse(a.created_at))-(b.sequence??Date.parse(b.created_at))||a.id.localeCompare(b.id))}
 async ready(){
  if(!this.initializing)this.initializing=(async()=>{for(const job of await this.rows())if(job.status==='running')await this.save({...job,status:'failed',error:'서버 재시작으로 중단됐어요. 초안이 있는지 확인한 뒤 다시 요청해주세요.'})})().catch(error=>{this.initializing=null;throw error});
  await this.initializing;
 }
 async dismissReviewed(videoId){await this.store.put('settings',{key:'youtube_timeline_reviewed_'+videoId,value:new Date().toISOString()})}
 async list(){
  await this.ready();const reviewed=new Map((await this.store.all('settings')).filter(r=>r.key.startsWith('youtube_timeline_reviewed_')).map(r=>[r.key.slice('youtube_timeline_reviewed_'.length),r.value]));
  const jobs=(await this.rows()).filter(job=>!reviewed.has(job.video_id)||job.created_at>reviewed.get(job.video_id));
  return [...jobs.filter(active),...jobs.filter(j=>!active(j)).slice(-40)].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
 }
 enqueue(videos){
  const pending=this.adding.then(async()=>{
   await this.ready();if(!Array.isArray(videos)||!videos.length||videos.length>20)fail('한 번에 1~20개 영상을 선택해주세요.');
   const jobs=await this.rows(),waiting=jobs.filter(active),ids=new Set(waiting.map(j=>j.video_id)),created=[];
   if(waiting.length+videos.filter(v=>!ids.has(v.id)&&!v.timeline_draft?.length&&!v.timeline?.length).length>20)fail('진행·대기 중인 영상은 최대 20개예요. 완료 후 추가해주세요.');
   let sequence=Math.max(Date.now(),...jobs.map(j=>j.sequence||Date.parse(j.created_at)||0));
   for(const video of videos){
    if(ids.has(video.id))continue;ids.add(video.id);
    const exists=!!(video.timeline_draft?.length||video.timeline?.length),job={id:randomUUID(),video_id:video.id,title:video.title,sequence:++sequence,status:exists?'skipped':'queued',error:exists?'이미 타임라인이나 초안이 있어 건너뛰었어요.':'',created_at:new Date().toISOString()};
    created.push(await this.save(job));
   }
   this.kick();return created;
  });this.adding=pending.catch(()=>{});return pending;
 }
 async cancel(id){await this.ready();const job=(await this.rows()).find(j=>j.id===id);if(!job)fail('작업을 찾지 못했어요.',404);if(job.status!=='queued')fail('대기 중인 작업만 취소할 수 있어요.');await this.save({...job,status:'cancelled',error:'대기를 취소했어요.'})}
 kick(delay=0){if(this.closed||this.running||this.timer)return;this.timer=setTimeout(()=>{this.timer=null;this.drain().catch(()=>this.kick(5000))},delay);this.timer.unref?.()}
 async drain(){
  if(this.running||this.closed)return;this.running=true;
  try{
   await this.ready();
   while(!this.closed){
    if(this.busy()){this.running=false;this.kick(3000);return}
    const job=(await this.rows()).find(j=>j.status==='queued');if(!job)return;
    // Recheck immediately before starting so cancelled jobs never start an API call.
    if((await this.rows()).find(j=>j.id===job.id)?.status!=='queued')continue;
    await this.save({...job,status:'running',error:''});
    try{const result=await this.run(job);await this.save({...job,status:result.skipped?'skipped':'done',error:result.reason||'',rows:result.rows?.length||0,needs_check:result.analysis?.needs_check||0,skipped_count:result.analysis?.skipped_count||0})}
    catch(error){await this.save({...job,status:'failed',error:error.status&&error.status<500?error.message:'처리 중 오류가 발생했어요. 기존 타임라인은 유지돼요.'})}
   }
  }finally{this.running=false}
 }
 close(){this.closed=true;if(this.timer)clearTimeout(this.timer)}
}
