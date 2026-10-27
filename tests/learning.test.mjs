import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {LearningAI,selectedPdf} from '../src/learning-ai.mjs';
import {LearningWorkspace} from '../src/learning-workspace.mjs';
import {LocalStore} from '../src/store.mjs';
import {curriculumKey} from '../src/curriculum.mjs';
const captions='WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n개념을 먼저 확인합시다\n\n00:00:10.000 --> 00:00:40.000\n1번 문제를 풀어봅시다\n\n00:00:40.000 --> 00:01:10.000\n2번 문제도 같은 원리입니다\n';
const lesson=(direction='left')=>({observations:[{axis:'starting_point',direction,confidence:'high',evidence:[{cue_id:0,quote:'개념을 먼저 확인합시다'}]}],segments:[{start_cue:0,end_cue:2,topic:'지수함수',kind:'teaching',problem_count:2,evidence:[{cue_id:1,quote:'1번 문제를 풀어봅시다'}]}]});
const response=data=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(data)}],usage:{input_tokens:100,output_tokens:100}});
async function until(fn){for(let i=0;i<400;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5))}throw new Error('분석 완료 대기 초과')}

test('수업 유형·속도는 실제 자막 인용과 시간만 사용하며 다른 선생님 이름을 전제하지 않는다',async()=>{
 let sent;const ai=new LearningAI({anthropicKey:'test'},async(url,opts)=>{sent=JSON.parse(opts.body);const data=lesson();data.observations.push({...data.observations[0],evidence:[{cue_id:999,quote:'없는 자막'}]});return response(data)});
 const result=await ai.lesson(captions,{id:'Lesson00001',title:'수업',subject:'대수'},'teacher-A');assert.equal(result.observations.length,1);assert.equal(result.rejected,1);assert.equal(result.teacher_id,'teacher-A');assert.equal(result.speed.observed_problems,2);assert.equal(result.speed.minutes_per_problem,0.58);assert.ok(sent.messages[0].content[0].text.includes('starting_point'));assert.ok(!sent.system.includes('김형철'));
});
test('교재 PDF는 지정한 페이지만 분리하고 읽지 않은 쪽의 근거·문제 수를 거부한다',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();pdf.addPage();const bytes=await pdf.save(),part=await selectedPdf(bytes,2,3);assert.deepEqual(part.pages,[2,3]);assert.equal((await PDFDocument.load(part.bytes)).getPageCount(),2);assert.equal(part.page_count,3);
 await assert.rejects(selectedPdf(bytes,0,1),/1~20쪽/);await assert.rejects(selectedPdf(bytes,1,4),/총 3쪽/);
 const ai=new LearningAI({anthropicKey:'test'},async()=>response({topics:[{title:'지수함수',description:'정의',observed_problem_count:null,pdf_page:1,quote:'지수함수',confidence:'high'}]}));
 await assert.rejects(ai.book(bytes,{id:'book',title:'교재'},2,3),/쪽수·근거/);
});
test('커리큘럼은 실제 교재·영상 ID를 요구하며 AI가 완료 진도를 임의로 확정하지 않는다',async()=>{
 const input={teacher:{id:'A'},goal:{},scope:'지수함수',book_analysis:{id:'book-A',title:'교재',pages:[1],coverage:'partial',topics:[{id:'topic1',title:'지수함수'}]},lessons:[{id:'lesson-A',observations:[],segments:[]}]};
 const topic={title:'지수함수',total_minutes:40,done_minutes:0,book_topic_ids:['book-A:topic1'],lesson_ids:['lesson-A'],reason:'수업 속도 추정',confidence:'medium'};
 let data={topics:[topic],notes:'일부 범위 추정'};const ai=new LearningAI({anthropicKey:'test'},async()=>response(data));assert.equal((await ai.curriculum(input)).topics[0].total_minutes,40);
 data={topics:[{...topic,done_minutes:30}],notes:''};await assert.rejects(ai.curriculum(input),/근거나 예상 시간/);
 data={topics:[{...topic,lesson_ids:['다른 영상']}],notes:''};await assert.rejects(ai.curriculum(input),/근거나 예상 시간/);
});
test('선생님별 분석·계획을 분리하고 기존 진도를 보존한 자동 갱신 초안만 만든다',async()=>{
 const store=new LocalStore(':memory:'),pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save(),book={id:'book',title:'교재',subject:'대수',sha256:'source'},books={find:async()=>book,download:async()=>({book,bytes})};let calls=0,direction='left',minutes=40;
 const fetcher=async(url,options)=>{calls++;const body=JSON.parse(options.body);if(body.messages[0].content.some(c=>c.type==='document'))return response({topics:[{title:'지수함수',description:'개념',observed_problem_count:null,pdf_page:1,quote:'지수함수',confidence:'high'}]});if(body.system.includes('4개 수업 유형'))return response(lesson(direction));const input=JSON.parse(body.messages[0].content[0].text);return response({topics:[{title:'지수함수',total_minutes:minutes,done_minutes:0,book_topic_ids:[input.book.topics[0].id],lesson_ids:[input.lessons[0].id],reason:'선택한 교재·수업 속도 근거',confidence:'medium'}],notes:'추정 계획'})};
 const workspace=new LearningWorkspace({anthropicKey:'test'},store,{downloadCaptions:async()=>({text:captions})},books,fetcher);
 try{
  const a=await workspace.createTeacher('선생님 A'),b=await workspace.createTeacher('선생님 B');assert.notEqual(a.id,b.id);
  for(const id of ['Lesson00001','Lesson00002'])await store.saveVideo({id,title:'수업',subject:'대수',published:true,timeline:[],added_at:1},['A반']);await store.patch('classes',{name:'A반'},{schedule:'MWF'});
  await workspace.enqueue('lesson',{teacher_id:a.id,video_id:'Lesson00001'});await until(async()=>(await workspace.state()).lessons.length===1);
  await workspace.enqueue('book',{book_id:'book',start_page:1,end_page:1});await until(async()=>(await workspace.state()).books.length===1);
  let state=await workspace.state(),sourceLesson=state.lessons[0],sourceBook=state.books[0];const before=calls;assert.equal((await workspace.enqueue('lesson',{teacher_id:a.id,video_id:'Lesson00001'})).cached,true);assert.equal(calls,before);
  const goalStart=new Date(Date.now()+9*3600000).toISOString().slice(0,10),goalEnd=new Date(Date.now()+9*3600000+28*86400000).toISOString().slice(0,10);const input={teacher_id:a.id,class_name:'A반',book_analysis_id:sourceBook.id,lesson_ids:[sourceLesson.id],mode:'exam',start_date:goalStart,end_date:goalEnd,minutes_per_session:90,scope:'지수함수',notes:'설명 시간을 확보',makeup_dates:[],excluded_dates:[]};
  await assert.rejects(workspace.enqueue('plan',{...input,teacher_id:b.id}),/선생님·반/);
  await workspace.enqueue('plan',input);await until(async()=>(await workspace.state()).plans.length===1);state=await workspace.state();const draft=state.plans[0];assert.equal(draft.teacher_id,a.id);assert.ok(draft.calculated.capacity_minutes>0);assert.equal(draft.plan.topics[0].done_minutes,0);assert.equal((await store.all('settings',{key:curriculumKey('A반',a.id)})).length,0);
  await store.put('settings',{key:curriculumKey('A반',a.id),value:{...draft.plan,revision:1,auto_replan:true,ai_scope:'지수함수',ai_sources:{book_analysis_id:sourceBook.id},topics:draft.plan.topics.map(t=>({...t,done_minutes:30}))}});
  direction='right';minutes=20;await workspace.enqueue('lesson',{teacher_id:a.id,video_id:'Lesson00001',force:true});await until(async()=>(await workspace.state()).plans.length===2);await until(async()=>!(await workspace.state()).jobs.some(j=>['queued','running'].includes(j.status)));
  state=await workspace.state();assert.equal(state.teachers.find(t=>t.id===a.id).lesson_count,1);assert.equal(state.teachers.find(t=>t.id===a.id).style[0].right_percent,100);assert.equal(state.teachers.find(t=>t.id===b.id).lesson_count,0);assert.equal(state.plans[0].plan.topics[0].done_minutes,30);assert.equal(state.plans[0].plan.topics[0].total_minutes,30);assert.equal((await store.all('settings',{key:curriculumKey('A반',a.id)}))[0].value.revision,1);assert.equal((await store.all('settings',{key:curriculumKey('A반',b.id)})).length,0);
 }finally{workspace.close();store.close()}
});
test('중단된 자료 분석을 재시작해도 유료 분석을 자동 재실행하지 않는다',async()=>{
 const store=new LocalStore(':memory:');await store.put('settings',{key:'youtube_learning_job_old',value:{id:'old',status:'running',created_at:'2026-10-27',type:'lesson',input:{}}});let calls=0;const workspace=new LearningWorkspace({anthropicKey:'test'},store,{}, {},async()=>{calls++});try{const state=await workspace.state();assert.equal(state.jobs[0].status,'failed');assert.equal(calls,0)}finally{workspace.close();store.close()}
});

test('자료 분석 API는 선생님만 사용하고 계획 출처·수정 충돌을 확인한다',async()=>{
 const {createApp}=await import('../src/server.mjs');const store=new LocalStore(':memory:'),cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite'},app=createApp(cfg,store);await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=(path,data,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 try{
  await store.put('students',{id:1,name:'학생',phone:'01011112222',class_name:'A반',active:true});await store.put('classes',{name:'A반',schedule:'MWF'});
  const teacher=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie'),student=(await post('/api/login',{phone:'01011112222'})).headers.get('set-cookie');
  assert.equal((await fetch(cfg.origin+'/api/teacher/learning',{headers:{Cookie:student}})).status,401);assert.equal((await post('/api/teacher/learning/teacher',{name:'선생님'},student)).status,401);
  const profile=await (await post('/api/teacher/learning/teacher',{name:'추가 선생님'},teacher)).json();assert.ok(profile.teacher.id);
  const plan={class_name:'A반',teacher_id:profile.teacher.id,mode:'exam',start_date:'2026-10-27',end_date:'2026-11-27',minutes_per_session:90,topics:[{id:'a',title:'단원',total_minutes:100,done_minutes:0}],notes:'',makeup_dates:[],excluded_dates:[]};
  await store.put('settings',{key:'youtube_learning_result_draft',value:{id:'draft',kind:'plan',teacher_id:profile.teacher.id,plan,base_revision:0,source_book_analysis_id:'book-analysis',source_lesson_ids:['lesson-analysis'],scope:'단원'}});
  const saved=await post('/api/teacher/curriculum/save',{...plan,ai_draft_id:'draft',revision:0},teacher);assert.equal(saved.status,200);const record=(await store.all('settings',{key:curriculumKey('A반',profile.teacher.id)}))[0].value;assert.equal(record.ai_draft_id,'draft');assert.equal(record.ai_scope,'단원');
  assert.equal((await post('/api/teacher/curriculum/save',{...plan,ai_draft_id:'draft',revision:1},teacher)).status,412);
  assert.equal((await post('/api/teacher/curriculum/save',{...plan,teacher_id:'unknown',revision:0},teacher)).status,400);
 }finally{await new Promise(r=>app.close(r));store.close()}
});

test('계획 배분 미리보기는 비동기 응답 뒤에도 버튼을 다시 누를 수 있다',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm'),source=await readFile(new URL('../public/curriculum.js',import.meta.url),'utf8');
 const button={disabled:false},error={textContent:''},result={innerHTML:''},nodes={'#cp-preview':button,'#cp-error':error,'#cp-preview-result':result};let resolve;
 const context={$:key=>nodes[key],readPlan:()=>({}),requestAPI:()=>new Promise(r=>resolve=r),curriculumSchedule:()=> '배분 결과'};
 const start=source.indexOf("$('#cp-preview').onclick"),end=source.indexOf(" $('#curriculum-form').onsubmit",start);runInNewContext(source.slice(start,end),context);
 const event={currentTarget:button},pending=button.onclick(event);assert.equal(button.disabled,true);event.currentTarget=null;resolve({calculated:{}});await pending;assert.equal(button.disabled,false);assert.equal(result.innerHTML,'배분 결과');
});
