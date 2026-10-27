import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudentActivity} from '../src/student-activity.mjs';
import {LocalStore} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
test('접속·시청 기록은 재시작 후 남고 건너뛰기·정지·다른 화면 시간을 시청량에 더하지 않는다',async()=>{
 const store=new LocalStore(':memory:');let now=Date.parse('2026-10-27T00:00:00Z');let activity=new StudentActivity(store,()=>now);
 const session={digest:'private-session'},student={id:1,name:'검사 학생',class_name:'A'},video={id:'WatchVid001',title:'강의'};let sequence=0;
 const input=patch=>({client_id:'client-123',sequence:++sequence,online:true,visible:true,state:'playing',video_id:video.id,position_seconds:0,...patch});
 try{
  await activity.mutate(session,student,input(),video);now+=20000;await activity.mutate(session,student,input({position_seconds:1200}),video);now+=10000;await activity.mutate(session,student,input({state:'paused'}),video);
  now+=20000;await activity.mutate(session,student,input({state:'paused'}),video);now+=10000;await activity.mutate(session,student,input({visible:false}),video);now+=20000;await activity.mutate(session,student,input({visible:false}),video);
  activity=new StudentActivity(store,()=>now);let report=await activity.report({from:'2026-10-27',to:'2026-10-27'});assert.equal(report.students[0].watched_seconds,30);assert.equal(report.visits[0].watch[0].last_position,0);
  const external={client_id:'client-123',event_id:'external-123'};await activity.mutate(session,student,external,video,{external:true});await activity.mutate(session,student,external,video,{external:true});report=await activity.report({from:'2026-10-27',to:'2026-10-27'});assert.equal(report.students[0].youtube_count,1);assert.equal(report.students[0].watched_seconds,30);
  await activity.mutate(session,student,{...input({online:false}),sequence:1},video);assert.equal((await activity.report({from:'2026-10-27',to:'2026-10-27'})).visits[0].closed_at,null);
  await activity.logout(session);report=await activity.report({from:'2026-10-27',to:'2026-10-27'});assert.equal(report.visits[0].end_reason,'logout');assert.ok(!JSON.stringify(report).includes('private-session'));assert.ok(!JSON.stringify(report).includes('session_ref'));assert.equal((await store.all('settings')).length,0);
 }finally{store.close()}
});
test('이탈한 접속은 마지막 확인 시각으로 종료 추정하며 재접속과 날짜·학생 필터를 구분한다',async()=>{
 const store=new LocalStore(':memory:');let now=Date.parse('2026-10-27T00:00:00Z');const activity=new StudentActivity(store,()=>now),student={id:1,name:'학생',class_name:'A'},session={digest:'token'},input={client_id:'client-123',sequence:1,online:true,state:'browsing',visible:true};
 try{await activity.mutate(session,student,input,null);now+=100000;let report=await activity.report({from:'2026-10-27',to:'2026-10-27'});assert.equal(report.visits[0].end_reason,'timeout');await activity.mutate(session,student,{...input,sequence:2},null);report=await activity.report({from:'2026-10-27',to:'2026-10-27'});assert.equal(report.total_visits,2);assert.equal((await activity.report({from:'2026-10-27',to:'2026-10-27',student_id:'2'})).total_visits,0);await assert.rejects(activity.report({from:'2026-02-30',to:'2026-03-01'}),/날짜/);await assert.rejects(activity.report({from:'2026-01-01',to:'2026-03-01'}),/31일/)}finally{store.close()}
});
test('학생 기록과 유튜브 이동 API는 본인 세션·본인 반만 기록하고 선생님만 조회한다',async()=>{
 const cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite'},store=new LocalStore(':memory:'),app=createApp(cfg,store);await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=(path,data,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 try{
  await store.put('students',{id:1,name:'학생',phone:'01011112222',class_name:'A',active:true});for(const [id,group] of [['WatchVid001','A'],['WatchVid002','B']])await store.saveVideo({id,title:'수업',published:true,timeline:[],timeline_draft:null,added_at:1},[group]);
  const student=(await post('/api/login',{phone:'01011112222'})).headers.get('set-cookie'),teacher=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie'),date=new Date(Date.now()+9*3600000).toISOString().slice(0,10),url=cfg.origin+`/api/teacher/student-records?from=${date}&to=${date}`;
  assert.equal((await fetch(url,{headers:{Cookie:student}})).status,401);assert.equal((await post('/api/student/youtube-open',{client_id:'client-123',event_id:'event-123',video_id:'WatchVid002'},student)).status,403);
  assert.equal((await post('/api/presence',{client_id:'client-123',sequence:1,online:true,visible:true,state:'playing',position_seconds:10,video_id:'WatchVid001'},student)).status,200);
  assert.equal((await post('/api/student/youtube-open',{client_id:'client-123',event_id:'event-123',video_id:'WatchVid001'},student)).status,200);
  const report=await (await fetch(url,{headers:{Cookie:teacher}})).json();assert.equal(report.students[0].youtube_count,1);assert.equal(report.visits[0].watch[0].title,'수업');assert.ok(!JSON.stringify(report).includes('01011112222'));
  const state=await (await fetch(cfg.origin+'/api/student/state',{headers:{Cookie:student}})).text();assert.ok(!state.includes('youtube_student_activity_'));
 }finally{await new Promise(r=>app.close(r));store.close()}
});

test('학생 기록은 학생·반 관리 바로 아래에 배치되고 실제 교사 화면 라우터에 연결된다',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');const source=await readFile(new URL('../public/workbench.js',import.meta.url),'utf8');
 const context={paths:Object.fromEntries(['overview','courses','students','records','analysis','curriculum','settings'].map(k=>[k,[k,'']])),teacherIcons:{plan:''},page:'records',teacherNavigation:()=>{},queueMicrotask:()=>{},syncSidebarState:()=>{},teacherOverview:()=> 'overview',teacherCourses:()=>'',teacherGroups:()=>'',studentRecordsView:()=> 'student-records',teacherAnalysis:()=>'',teacherCurriculum:()=>'',teacherSettings:()=>''};
 runInNewContext(source.slice(0,source.indexOf('function teacherCurriculum(){')),context);const keys=Object.keys(context.paths);assert.equal(keys.indexOf('records'),keys.indexOf('students')+1);assert.equal(context.renderTeacherPage(),'student-records');
});
