const fail=message=>{throw Object.assign(new Error(message),{status:400})};
export class StudentPresence {
 constructor(now=()=>Date.now()){this.now=now;this.entries=new Map()}
 key(session,client){return session.digest+':'+client}
 update(session,student,input){
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(input.client_id||''))fail('접속 식별 정보를 확인해주세요.');
  const key=this.key(session,input.client_id),now=this.now(),previous=this.entries.get(key);
  if(!Number.isSafeInteger(input.sequence)||input.sequence<0)fail('접속 순서를 확인해주세요.');
  if(previous&&input.sequence<=previous.sequence)return;
  if(input.online===false){this.entries.delete(key);return}
  const states=['browsing','loading','playing','paused','buffering','ended','unavailable'];
  if(!states.includes(input.state)||typeof input.visible!=='boolean'||!Number.isSafeInteger(input.sequence)||input.sequence<0)fail('재생 상태를 확인해주세요.');
  const position=input.position_seconds==null?null:Number(input.position_seconds);
  if(position!==null&&(!Number.isFinite(position)||position<0||position>86400))fail('재생 위치를 확인해주세요.');
  const videoId=input.video_id||'',gap=previous?(now-previous.last_seen)/1000:0;
  let watched=previous?.video_id===videoId?previous.watched_seconds:0;
  if(previous?.video_id===videoId&&videoId&&previous.state==='playing'&&input.state==='playing'&&previous.visible&&input.visible&&gap>=0&&gap<=45)watched+=Math.min(gap,30);
  this.entries.set(key,{session_digest:session.digest,student_id:student.id,client_id:input.client_id,sequence:input.sequence,video_id:videoId,state:videoId?input.state:'browsing',position_seconds:videoId?position:null,visible:input.visible,watched_seconds:watched,last_seen:now});
  for(const [id,row] of this.entries)if(now-row.last_seen>90000)this.entries.delete(id);
  if(this.entries.size>1000)this.entries.delete(this.entries.keys().next().value);
 }
 removeSession(digest){for(const [id,row] of this.entries)if(row.session_digest===digest)this.entries.delete(id)}
 snapshot(students,videos,sessions,relations){
  const now=this.now(),out=new Map(),valid=new Set(sessions.filter(s=>s.role==='student'&&s.expires>now/1000).map(s=>s.digest));
  for(const [key,row] of this.entries){
   const student=students.find(s=>s.id===row.student_id&&s.active);
   if(now-row.last_seen>90000||!student||!valid.has(row.session_digest)){this.entries.delete(key);continue}
   const video=videos.find(v=>v.id===row.video_id&&v.published&&relations.some(r=>r.video_id===v.id&&r.class_name===student.class_name));
   const entry={student_id:student.id,name:student.name,class_name:student.class_name,state:video?row.state:'browsing',visible:row.visible,video_id:video?.id||'',video_title:video?.title||'',position_seconds:video?row.position_seconds:null,watched_seconds:video?Math.floor(row.watched_seconds):0,last_seen:new Date(row.last_seen).toISOString()};
   if(!out.has(student.id)||Date.parse(out.get(student.id).last_seen)<row.last_seen)out.set(student.id,entry);
  }
  return [...out.values()].sort((a,b)=>a.class_name.localeCompare(b.class_name,'ko')||a.name.localeCompare(b.name,'ko'));
 }
}
