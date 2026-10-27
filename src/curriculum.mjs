import {createHash} from 'node:crypto';

const fail=message=>{throw Object.assign(new Error(message),{status:400})};
export const curriculumKey=(name,teacherId='')=>'youtube_curriculum_'+createHash('sha256').update(teacherId?JSON.stringify([teacherId,name]):name).digest('hex').slice(0,24);
export const koreaToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const stamp=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('날짜를 확인해주세요.');
 const time=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)fail('존재하는 날짜를 입력해주세요.');return time;
};
export function cleanCurriculum(input,classes){
 if(!classes.includes(input.class_name))fail('등록된 반을 선택해주세요.');
 if(!['exam','vacation','ahead'].includes(input.mode))fail('목표 종류를 선택해주세요.');
 const start=stamp(input.start_date),end=stamp(input.end_date);
 if(end<start||end-start>366*86400000)fail('목표 기간은 시작일부터 1년 이내로 설정해주세요.');
 const minutes=Number(input.minutes_per_session);if(!Number.isInteger(minutes)||minutes<10||minutes>480)fail('수업 시간은 10~480분으로 입력해주세요.');
 if(!Array.isArray(input.topics)||!input.topics.length||input.topics.length>100)fail('단원은 1~100개 등록해주세요.');
 const seen=new Set();
 const topics=input.topics.map((topic,index)=>{
  if(!topic||typeof topic!=='object')fail('단원 정보를 확인해주세요.');
  const title=String(topic.title||'').trim(),total=Number(topic.total_minutes),done=Number(topic.done_minutes||0),id=String(topic.id||index+1);
  if(!title||title.length>120||!/^[-\w]{1,40}$/.test(id)||seen.has(id))fail('단원 이름과 번호를 확인해주세요.');seen.add(id);
  if(!Number.isInteger(total)||total<1||total>10000||!Number.isInteger(done)||done<0||done>total)fail('단원별 예상 시간과 완료 시간을 확인해주세요.');
  return {id,title,total_minutes:total,done_minutes:done};
 });
 const dates=key=>{if(!Array.isArray(input[key]||[])||(input[key]||[]).length>366)fail('보강·휴강 날짜를 확인해주세요.');return [...new Set((input[key]||[]).map(date=>{const time=stamp(date);if(time<start||time>end)fail('보강·휴강은 목표 기간 안에서 선택해주세요.');return date}))].sort()};
 const notes=String(input.notes||'').trim();if(notes.length>2000)fail('수업 특이사항은 2,000자 이내로 입력해주세요.');
 return {...(input.auto_replan===true?{auto_replan:true}:{}),...(input.teacher_id?{teacher_id:String(input.teacher_id)}:{}),class_name:input.class_name,mode:input.mode,start_date:input.start_date,end_date:input.end_date,minutes_per_session:minutes,topics,makeup_dates:dates('makeup_dates'),excluded_dates:dates('excluded_dates'),notes};
}

export function buildCurriculum(plan,weekdays,today=koreaToday()){
 const start=Math.max(stamp(plan.start_date),stamp(today)),end=stamp(plan.end_date),step=86400000;
 const excluded=new Set(plan.excluded_dates),makeup=new Set(plan.makeup_dates),sessions=[],candidates=[];
 const remaining=plan.topics.map(t=>({...t,remaining:t.total_minutes-t.done_minutes}));
 const total=remaining.reduce((sum,t)=>sum+t.remaining,0);let index=0,allocated=0;
 for(let day=start;day<=end;day+=step){
  const date=new Date(day).toISOString().slice(0,10),weekday=new Date(day).getUTCDay()||7;
  if(excluded.has(date))continue;
  if(!weekdays.includes(weekday)&&!makeup.has(date)){candidates.push(date);continue}
  let available=plan.minutes_per_session;const items=[];
  while(available>0&&index<remaining.length){
   const topic=remaining[index];if(!topic.remaining){index++;continue}
   const duration=Math.min(available,topic.remaining);items.push({topic_id:topic.id,title:topic.title,minutes:duration});topic.remaining-=duration;available-=duration;allocated+=duration;
  }
  sessions.push({date,makeup:makeup.has(date)&&!weekdays.includes(weekday),items,used_minutes:plan.minutes_per_session-available,free_minutes:available});
 }
 const shortage=Math.max(0,total-allocated),needed=Math.ceil(shortage/plan.minutes_per_session);
 return {from_date:today,sessions,remaining_minutes:total,capacity_minutes:sessions.length*plan.minutes_per_session,allocated_minutes:allocated,shortage_minutes:shortage,makeup_needed:needed,makeup_candidates:candidates.slice(0,needed),unplaced:remaining.filter(t=>t.remaining>0).map(t=>({id:t.id,title:t.title,minutes:t.remaining}))};
}
