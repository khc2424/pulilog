import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export class StudentTools {
 constructor(store){this.store=store;this.pending=Promise.resolve()}
 serialize(fn){const task=this.pending.then(fn);this.pending=task.catch(()=>{});return task}
 async resume(student,id){return (await this.store.all('settings',{key:`youtube_resume_${student.id}_${id}`}))[0]?.value||null}
 async saveResume(student,d){
  if(!d.video_id||!['playing','paused','ended'].includes(d.state)||typeof d.position_seconds!=='number'||!Number.isFinite(d.position_seconds)||d.position_seconds<0||d.position_seconds>86400)return;
  return this.serialize(async()=>{const key=`youtube_resume_${student.id}_${d.video_id}`,old=await this.resume(student,d.video_id),client=String(d.client_id||'').slice(0,80);if(!client||!Number.isSafeInteger(d.sequence))return;
   if((old?.sequences?.[client]??-1)>=d.sequence)return;
   const sequences=Object.fromEntries([...Object.entries(old?.sequences||{}).filter(([k])=>k!==client),[client,d.sequence]].slice(-10));
   await this.store.put('settings',{key,value:{position_seconds:Math.floor(d.position_seconds),ended:d.state==='ended',updated_at:new Date().toISOString(),sequences}});
  });
 }
 async ask(student,video,d){
  if(!Number.isInteger(d.seconds)||d.seconds<0||d.seconds>86400)fail('영상의 현재 위치를 확인한 뒤 눌러주세요.');
  return this.serialize(async()=>{const rows=await this.store.settingsPrefix('youtube_question_');const existing=rows.map(r=>r.value).find(r=>r.student_id===student.id&&r.video_id===video.id&&!r.resolved&&Math.abs(r.seconds-d.seconds)<=15);if(existing)return {question:existing,duplicate:true};
   if(!await this.store.consumeRate('question_'+student.id,20,3600))fail('질문을 많이 등록했어요. 잠시 후 다시 시도해주세요.',429);
   const question={id:randomUUID(),student_id:student.id,name:student.name,class_name:student.class_name,video_id:video.id,title:video.title,seconds:d.seconds,note:String(d.note||'').trim().slice(0,300),created_at:new Date().toISOString(),resolved:false};
   await this.store.put('settings',{key:'youtube_question_'+question.id,value:question});return {question,duplicate:false};
  });
 }
 async questions(){return (await this.store.settingsPrefix('youtube_question_')).map(r=>r.value).sort((a,b)=>b.created_at.localeCompare(a.created_at))}
 async resolve(id,resolved){return this.serialize(async()=>{const key='youtube_question_'+id,row=(await this.store.all('settings',{key}))[0];if(!row)fail('질문을 찾을 수 없어요.',404);await this.store.put('settings',{key,value:{...row.value,resolved:resolved===true}})})}
}
