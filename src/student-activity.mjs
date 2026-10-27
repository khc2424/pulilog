import {createHash} from 'node:crypto';
const prefix='youtube_student_activity_',digest=value=>createHash('sha256').update(value).digest('hex').slice(0,32);
const fail=message=>{throw Object.assign(new Error(message),{status:400})};
const day=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
export class StudentActivity {
 constructor(store,now=()=>Date.now()){this.store=store;this.now=now;this.pending=new Map()}
 key(session,student,client){return prefix+day(this.now())+'_'+student.id+'_'+digest(session.digest+':'+client)}
 async serial(key,fn){const pending=(this.pending.get(key)||Promise.resolve()).catch(()=>{}).then(fn);this.pending.set(key,pending);try{return await pending}finally{if(this.pending.get(key)===pending)this.pending.delete(key)}}
 async mutate(session,student,input,video,{external=false}={}){
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(input.client_id||''))fail('접속 식별 정보를 확인해주세요.');
  if(external&&!/^[a-zA-Z0-9-]{8,80}$/.test(input.event_id||''))fail('이동 기록 식별 정보를 확인해주세요.');
  const key=this.key(session,student,input.client_id);
  return this.serial(key,async()=>{
   const now=this.now(),at=new Date(now).toISOString();let row=(await this.store.all('settings',{key}))[0]?.value;
   if(!row)row={student_id:student.id,name:student.name,class_name:student.class_name,day:day(now),session_ref:digest('activity:'+session.digest),visits:[],sequence:-1,external_ids:[]};
   if(!external&&input.sequence<=row.sequence)return;
   if(external&&row.external_ids.includes(input.event_id))return;
   let visit=row.visits.at(-1),previous=visit?.cursor,gap=previous?(now-previous.at)/1000:0;
   if(visit&&!visit.closed_at&&gap>90){visit.closed_at=visit.last_seen;visit.end_reason='timeout'}
   if(!visit||visit.closed_at){
    if(input.online===false&&!external)return;
    visit={id:digest(key+':'+row.visits.length),started_at:at,last_seen:at,closed_at:null,end_reason:null,active_seconds:0,watch:[],cursor:null};row.visits.push(visit);previous=null;gap=0;
   }
   if(previous&&gap>=0&&gap<=45){
    const elapsed=Math.min(gap,30);if(previous.visible)visit.active_seconds+=elapsed;
    const watching=visit.watch.find(w=>w.video_id===previous.video_id);
    if(watching){watching.last_seen=at;if(previous.visible&&previous.state==='playing')watching.watched_seconds+=elapsed;}
   }
   let watch=video&&visit.watch.find(w=>w.video_id===video.id);
   if(video&&!watch){watch={video_id:video.id,title:video.title,opened_at:at,last_seen:at,watched_seconds:0,last_position:null,youtube_count:0,youtube_last_at:null};visit.watch.push(watch)}
   if(watch){watch.last_seen=at;if(!external&&Number.isFinite(input.position_seconds))watch.last_position=input.position_seconds}
   if(external){watch.youtube_count++;watch.youtube_last_at=at;row.external_ids=[...row.external_ids,input.event_id].slice(-500);visit.cursor={...(previous||{}),at:now,visible:previous?.visible||false,state:'paused',video_id:video.id}}
   else{row.sequence=input.sequence;visit.cursor={at:now,visible:input.visible===true,state:input.state,video_id:video?.id||''};if(input.online===false){visit.closed_at=at;visit.end_reason='closed'}}
   visit.last_seen=at;row.name=student.name;row.class_name=student.class_name;await this.store.put('settings',{key,value:row});
  });
 }
 async logout(session){
  await Promise.allSettled([...this.pending.values()]);const ref=digest('activity:'+session.digest);
  const today=this.now(),dates=[day(today),day(today-86400000)];
  for(const date of dates)for(const item of await this.store.settingsPrefix(prefix+date+'_'))if(item.value.session_ref===ref)await this.serial(item.key,async()=>{const row=(await this.store.all('settings',{key:item.key}))[0]?.value,visit=row?.visits.at(-1);if(!visit||visit.closed_at)return;const now=this.now(),gap=(now-Date.parse(visit.last_seen))/1000,watch=visit.watch.find(w=>w.video_id===visit.cursor?.video_id);if(watch&&visit.cursor.visible&&visit.cursor.state==='playing'&&gap>=0&&gap<=45)watch.watched_seconds+=Math.min(gap,30);visit.closed_at=new Date(now).toISOString();visit.end_reason='logout';await this.store.put('settings',{key:item.key,value:row})});
 }
 async report({from,to,student_id='',class_name=''}={}){
  const valid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  if(!valid(from)||!valid(to))fail('조회 날짜를 확인해주세요.');const start=Date.parse(from),end=Date.parse(to);if(end<start||end-start>30*86400000)fail('기록은 한 번에 최대 31일씩 조회해주세요.');
  if(student_id&&!/^[1-9]\d{0,10}$/.test(String(student_id)))fail('학생을 선택해주세요.');
  const dates=[];for(let at=start;at<=end;at+=86400000)dates.push(new Date(at).toISOString().slice(0,10));
  const records=[];for(let i=0;i<dates.length;i+=5){const groups=await Promise.all(dates.slice(i,i+5).map(date=>this.store.settingsPrefix(prefix+date+'_'+(student_id?student_id+'_':''))));records.push(...groups.flat())}
  const visits=[];
  for(const {value:row} of records){if(student_id&&String(row.student_id)!==String(student_id))continue;if(class_name&&row.class_name!==class_name)continue;for(const v of row.visits){const expired=!v.closed_at&&this.now()-Date.parse(v.last_seen)>90000;visits.push({id:v.id,student_id:row.student_id,name:row.name,class_name:row.class_name,started_at:v.started_at,last_seen:v.last_seen,closed_at:v.closed_at||(expired?v.last_seen:null),end_reason:v.end_reason||(expired?'timeout':null),active_seconds:Math.floor(v.active_seconds),watch:v.watch.map(w=>({...w,watched_seconds:Math.floor(w.watched_seconds)}))})}}
  visits.sort((a,b)=>b.started_at.localeCompare(a.started_at));
  const students=new Map();for(const v of visits){const s=students.get(v.student_id)||{student_id:v.student_id,name:v.name,class_name:v.class_name,visits:0,watched_seconds:0,youtube_count:0};s.visits++;s.watched_seconds+=v.watch.reduce((n,w)=>n+w.watched_seconds,0);s.youtube_count+=v.watch.reduce((n,w)=>n+w.youtube_count,0);students.set(v.student_id,s)}
  return {from,to,total_visits:visits.length,students:[...students.values()],visits:visits.slice(0,1000),truncated:visits.length>1000};
 }
}
