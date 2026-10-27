import {randomUUID,createHash} from 'node:crypto';
import {LearningAI} from './learning-ai.mjs';
import {summarizeTeachingStyles} from './teaching-style.mjs';
import {cleanCurriculum,curriculumKey,buildCurriculum} from './curriculum.mjs';
import {daysForSchedule} from './schedules.mjs';
const prefix='youtube_learning_',fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const active=j=>['queued','running'].includes(j.status),hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
export class LearningWorkspace {
 constructor(cfg,store,youtube,books,fetcher,busy=()=>false){this.cfg=cfg;this.store=store;this.youtube=youtube;this.books=books;this.ai=new LearningAI(cfg,fetcher);this.busy=busy;this.running=false;this.closed=false;this.timer=null;this.adding=Promise.resolve();this.initializing=null}
 async rows(){return (await this.store.all('settings')).filter(r=>r.key.startsWith(prefix))}
 async save(kind,id,value){await this.store.put('settings',{key:prefix+kind+'_'+id,value});return value}
 async ready(){if(!this.initializing)this.initializing=(async()=>{for(const r of await this.rows())if(r.key.startsWith(prefix+'job_')&&r.value.status==='running')await this.save('job',r.value.id,{...r.value,status:'failed',error:'서버 재시작으로 중단됐어요. 자동 재분석은 하지 않아요.'})})();await this.initializing}
 async state(){
  await this.ready();const rows=await this.rows(),values=kind=>rows.filter(r=>r.key.startsWith(prefix+kind+'_')).map(r=>r.value),profiles=values('teacher'),results=values('result');
  const relations=await this.store.all('video_classes');for(const r of results)if(r.kind==='lesson')r.class_names=relations.filter(v=>v.video_id===r.video_id).map(v=>v.class_name);
  const unique=new Map();for(const r of results.filter(r=>r.kind==='lesson').sort((a,b)=>a.analyzed_at.localeCompare(b.analyzed_at)))unique.set(r.teacher_id+':'+r.video_id,r);const lessons=[...unique.values()];
  const teachers=profiles.map(p=>({...p,style:summarizeTeachingStyles(lessons.filter(r=>r.teacher_id===p.id).flatMap(r=>r.observations)),lesson_count:lessons.filter(r=>r.teacher_id===p.id).length}));
  return {configured:!!this.cfg.anthropicKey,teachers,lessons:lessons.sort((a,b)=>b.analyzed_at.localeCompare(a.analyzed_at)),books:results.filter(r=>r.kind==='book').sort((a,b)=>b.analyzed_at.localeCompare(a.analyzed_at)),plans:results.filter(r=>r.kind==='plan').sort((a,b)=>b.generated_at.localeCompare(a.generated_at)).slice(0,30),notices:values('notice'),jobs:values('job').sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,30)};
 }
 async teacher(id){const p=(await this.store.all('settings',{key:prefix+'teacher_'+id}))[0]?.value;if(!p)fail('분석할 선생님 프로필을 선택해주세요.');return p}
 async result(id,kind){const r=(await this.store.all('settings',{key:prefix+'result_'+id}))[0]?.value;if(!r||r.kind!==kind)fail('분석 자료를 찾지 못했어요.');if(kind==='lesson')r.class_names=(await this.store.all('video_classes',{video_id:r.video_id})).map(v=>v.class_name);return r}
 async addTeacher(name){name=String(name||'').trim();if(!name||name.length>60)fail('선생님 이름은 1~60자로 입력해주세요.');const teachers=(await this.state()).teachers;if(teachers.length>=50)fail('선생님 프로필은 최대 50개예요.');if(teachers.some(t=>t.name===name))fail('같은 이름의 프로필이 있어요.');const id=randomUUID();return this.save('teacher',id,{id,name,created_at:new Date().toISOString()})}
 async createTeacher(name){return this.addTeacher(name)}
 async validate(type,input){
  if(!['lesson','book','plan'].includes(type))fail('분석 종류를 선택해주세요.');
  if(type==='book'){const book=await this.books.find(String(input.book_id||''));if(book.deleted_at)fail('사용 중인 교재를 선택해주세요.');const start=Number(input.start_page),end=Number(input.end_page);if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end-start>=20)fail('PDF 분석 범위는 한 번에 최대 20쪽이에요.');return {book_id:book.id,source_sha256:book.sha256,start_page:start,end_page:end}}
  const teacher=await this.teacher(String(input.teacher_id||''));
  if(type==='lesson'){const video=(await this.store.all('videos',{id:String(input.video_id||'')}))[0];if(!video)fail('분석할 수업 영상을 선택해주세요.');return {teacher_id:teacher.id,video_id:video.id}}
  const book=await this.result(String(input.book_analysis_id||''),'book'),current=await this.books.find(book.book_id);if(current.deleted_at||current.sha256!==book.source_sha256)fail('교재 원본이 바뀌었어요. 교재를 다시 분석해주세요.');
  if(!Array.isArray(input.lesson_ids)||!input.lesson_ids.length||input.lesson_ids.length>8)fail('이 반의 수업 분석 결과를 1~8개 선택해주세요.');const ids=[...new Set(input.lesson_ids)];
  for(const id of ids){const result=await this.result(id,'lesson');if(result.teacher_id!==teacher.id||!result.class_names.includes(input.class_name))fail('선택한 선생님·반의 수업 분석만 사용해주세요.')}
  const classes=await this.store.all('classes'),goal=cleanCurriculum({...input,topics:[{id:'validate',title:'범위 확인',total_minutes:1,done_minutes:0}],makeup_dates:input.makeup_dates||[],excluded_dates:input.excluded_dates||[]},classes.map(c=>c.name));
  const old=(await this.store.all('settings',{key:curriculumKey(input.class_name,teacher.id)}))[0]?.value;
  const scope=String(input.scope||'').trim();if(!scope||scope.length>1000)fail('시험 범위나 목표 범위를 1~1,000자로 입력해주세요.');
  return {teacher_id:teacher.id,book_analysis_id:book.id,lesson_ids:ids,goal,scope,base_revision:old?.revision||0};
 }
 enqueue(type,input){const pending=this.adding.then(async()=>{
  await this.ready();if(!this.cfg.anthropicKey)fail('Claude API 연결이 필요해요.');const spec=await this.validate(type,input),key=hash({type,spec}),rows=await this.rows(),results=rows.filter(r=>r.key.startsWith(prefix+'result_')).map(r=>r.value),jobs=rows.filter(r=>r.key.startsWith(prefix+'job_')).map(r=>r.value);
  const existing=results.sort((a,b)=>String(b.analyzed_at||b.generated_at).localeCompare(String(a.analyzed_at||a.generated_at))).find(r=>r.source_key===key);if(existing&&!input.force)return {cached:true,result_id:existing.id};
  const queued=jobs.find(j=>j.source_key===key&&active(j));if(queued)return {cached:false,job:queued};if(jobs.filter(active).length>=8)fail('자료 분석은 최대 8개까지 접수할 수 있어요.');
  const title=type==='book'?(await this.books.find(spec.book_id)).title+' · PDF '+spec.start_page+'~'+spec.end_page+'쪽':type==='lesson'?(await this.store.all('videos',{id:spec.video_id}))[0].title:spec.goal.class_name+' · 커리큘럼 초안';
  const job={id:randomUUID(),type,input:spec,source_key:key,status:'queued',title,created_at:new Date().toISOString(),error:''};await this.save('job',job.id,job);this.kick();return {cached:false,job};
 });this.adding=pending.catch(()=>{});return pending}
 kick(){if(this.closed||this.running)return;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.work().catch(()=>{this.running=false})},30);this.timer.unref?.()}
 async work(){
  if(this.closed||this.running)return;this.running=true;try{await this.ready()}catch(error){this.running=false;throw error};if(this.busy()){this.running=false;this.timer=setTimeout(()=>{this.timer=null;this.kick()},3000);this.timer.unref?.();return}
  const jobs=(await this.rows()).filter(r=>r.key.startsWith(prefix+'job_')&&r.value.status==='queued').map(r=>r.value).sort((a,b)=>a.created_at.localeCompare(b.created_at));if(!jobs.length){this.running=false;return}
  const job={...jobs[0],status:'running',started_at:new Date().toISOString()};await this.save('job',job.id,job);
  try{
   const spec=job.input;let result;
   if(job.type==='lesson'){const video=(await this.store.all('videos',{id:spec.video_id}))[0];if(!video)fail('영상이 삭제됐어요.');await this.teacher(spec.teacher_id);const captions=await this.youtube.downloadCaptions(video.id);result=await this.ai.lesson(captions.text,video,spec.teacher_id);result.class_names=(await this.store.all('video_classes',{video_id:video.id})).map(r=>r.class_name)}
   if(job.type==='book'){const {book,bytes}=await this.books.download(spec.book_id);if(book.sha256!==spec.source_sha256)fail('교재 원본이 변경됐어요.');result=await this.ai.book(bytes,book,spec.start_page,spec.end_page)}
   if(job.type==='plan'){
    const teacher=await this.teacher(spec.teacher_id),book=await this.result(spec.book_analysis_id,'book'),lessons=await Promise.all(spec.lesson_ids.map(id=>this.result(id,'lesson'))),old=(await this.store.all('settings',{key:curriculumKey(spec.goal.class_name,spec.teacher_id)}))[0]?.value;
    const currentBook=await this.books.find(book.book_id);if(currentBook.deleted_at||currentBook.sha256!==book.source_sha256)fail('교재가 변경됐어요. 다시 분석해주세요.');
    if((old?.revision||0)!==spec.base_revision)fail('계획이 변경됐어요. 최신 진도로 다시 생성해주세요.');
    result=await this.ai.curriculum({teacher,book_analysis:book,lessons,goal:spec.goal,scope:spec.scope,notes:spec.goal.notes,existing_plan:old});
    const used=new Set();result.topics=result.topics.map(t=>{const prior=old?.topics.find(o=>!used.has(o.id)&&o.title.replace(/\s/g,'')===t.title.replace(/\s/g,''));if(prior){used.add(prior.id);return {...t,id:prior.id,total_minutes:Math.max(t.total_minutes,prior.done_minutes),done_minutes:prior.done_minutes}}return {...t,id:'ai_'+randomUUID().replaceAll('-','').slice(0,24)}});
    for(const prior of old?.topics||[])if(prior.done_minutes>0&&!used.has(prior.id))result.topics.push({...prior,reason:'기존에 선생님이 확인한 진도를 보존했어요.',confidence:'high',book_topic_ids:[],lesson_ids:[]});
    const plan=cleanCurriculum({...spec.goal,teacher_id:teacher.id,topics:result.topics},(await this.store.all('classes')).map(c=>c.name));result.plan=plan;result.base_revision=spec.base_revision;result.calculated=buildCurriculum(plan,daysForSchedule((await this.store.all('classes',{name:plan.class_name}))[0]?.schedule));result.scope=spec.scope;
   }
   result={...result,id:randomUUID(),kind:job.type,source_key:job.source_key};await this.save('result',result.id,result);await this.save('job',job.id,{...job,status:'done',result_id:result.id,completed_at:new Date().toISOString()});if(result.kind==='lesson')await this.replanAfterLesson(result);
  }catch(error){await this.save('job',job.id,{...job,status:'failed',error:error.status?error.message:'자료 분석 중 문제가 생겼어요. 기존 자료는 유지했어요.',completed_at:new Date().toISOString()})}
  finally{this.running=false;this.kick()}
 }
 async replanAfterLesson(lesson){
  const state=await this.state(),plans=(await this.store.all('settings')).filter(r=>r.key.startsWith('youtube_curriculum_')).map(r=>r.value);
  for(const plan of plans)if(plan.auto_replan&&plan.teacher_id===lesson.teacher_id&&lesson.class_names.includes(plan.class_name)&&plan.ai_sources?.book_analysis_id&&plan.ai_scope&&plan.end_date>=new Date(Date.now()+9*3600000).toISOString().slice(0,10)){
   try{const ids=state.lessons.filter(l=>l.teacher_id===plan.teacher_id&&l.class_names.includes(plan.class_name)).slice(0,3).map(l=>l.id);await this.enqueue('plan',{...plan,book_analysis_id:plan.ai_sources.book_analysis_id,lesson_ids:ids,scope:plan.ai_scope});await this.store.del('settings',{key:prefix+'notice_'+hash([plan.teacher_id,plan.class_name]).slice(0,24)})}catch(error){await this.save('notice',hash([plan.teacher_id,plan.class_name]).slice(0,24),{teacher_id:plan.teacher_id,class_name:plan.class_name,message:error.status?error.message:'자동 계획 초안 갱신을 확인해주세요.',at:new Date().toISOString()})}
  }
 }
 close(){this.closed=true;if(this.timer)clearTimeout(this.timer)}
}
