import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalStore} from '../src/store.mjs';
import {StudentTools} from '../src/student-tools.mjs';
import {AIUsage} from '../src/ai-usage.mjs';
import {createApp} from '../src/server.mjs';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('이어보기는 학생별로 저장하며 지연 도착한 동일 기기 위치가 최신 위치를 덮지 않는다',async()=>{
 const store=new LocalStore(':memory:');try{let tools=new StudentTools(store);const s={id:1},input={video_id:'WatchVid001',state:'playing',position_seconds:100,client_id:'device1',sequence:2};
 await tools.saveResume(s,input);await tools.saveResume(s,{...input,sequence:1,position_seconds:20});tools=new StudentTools(store);assert.equal((await tools.resume(s,input.video_id)).position_seconds,100);assert.equal(await tools.resume({id:2},input.video_id),null);
 await tools.saveResume(s,{...input,sequence:3,state:'loading',position_seconds:0});assert.equal((await tools.resume(s,input.video_id)).position_seconds,100);
 await tools.saveResume(s,{...input,client_id:'device2',sequence:1,position_seconds:300});assert.equal((await tools.resume(s,input.video_id)).position_seconds,300);assert.equal((await store.all('settings')).length,0);
 }finally{store.close()}
});

test('학생 질문 중복 방지·확인 처리와 다른 반 접근 차단, 이어보기 응답은 내부 기기 ID를 숨긴다',async()=>{
 const cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite'},store=new LocalStore(':memory:'),app=createApp(cfg,store);await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=(path,data,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)}),get=(path,cookie)=>fetch(cfg.origin+path,{headers:{Cookie:cookie}});
 try{
 for(const [id,phone] of [[1,'01011112222'],[2,'01011113333']])await store.put('students',{id,name:'학생'+id,phone,class_name:'A',active:true});for(const [id,g]of[['WatchVid001','A'],['WatchVid002','B']])await store.saveVideo({id,title:'강의',published:true,timeline:[],timeline_draft:null,added_at:1},[g]);
 const student=(await post('/api/login',{phone:'01011112222'})).headers.get('set-cookie'),other=(await post('/api/login',{phone:'01011113333'})).headers.get('set-cookie'),teacher=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie');
 assert.equal((await post('/api/student/question',{video_id:'WatchVid002',seconds:120},student)).status,403);assert.equal((await get('/api/teacher/questions',student)).status,401);assert.equal((await get('/api/teacher/ai-usage',student)).status,401);
 const data={video_id:'WatchVid001',seconds:120,note:'부호 질문'},q=await (await post('/api/student/question',data,student)).json();assert.equal((await (await post('/api/student/question',data,student)).json()).duplicate,true);
 assert.equal((await post('/api/teacher/question/resolve',{id:q.question.id,resolved:true},student)).status,401);await post('/api/teacher/question/resolve',{id:q.question.id,resolved:true},teacher);assert.equal((await (await get('/api/teacher/questions',teacher)).json()).questions[0].resolved,true);
 await post('/api/presence',{client_id:'private-device',sequence:1,online:true,visible:true,state:'playing',video_id:'WatchVid001',position_seconds:120},student);
 const r=await (await get('/api/student/resume?id=WatchVid001',student)).json();assert.equal(r.resume.position_seconds,120);assert.ok(!JSON.stringify(r).includes('private-device'));assert.equal((await (await get('/api/student/resume?id=WatchVid001',other)).json()).resume,null);
 assert.equal((await get('/api/student/resume?id=WatchVid002',student)).status,403);await store.patch('videos',{id:'WatchVid001'},{published:false});assert.equal((await post('/api/student/question',data,student)).status,403);
 }finally{await new Promise(r=>app.close(r));store.close()}
});

test('제목·타임라인 검색은 분리되며 메타데이터와 구간 설명을 함께 검색한다',async()=>{
 const source=await readFile(new URL('../public/accounts.js',import.meta.url),'utf8'),start=source.indexOf('function studentSearchMatches'),end=source.indexOf('function filterSelect',start);
 const context={catalogSearch:'쎈 부호',normalizeSearch:s=>String(s).toLowerCase().replace(/\s/g,''),timelineDescription:r=>r[2],favoriteOnly:false,bookFilter:'',subjectFilter:'',unitFilter:'',searchResultMode:'all',libraryVideos:[{id:1,title:'고1 쎈 함수',timeline:[['',0,'부호가 바뀌는 이유','01:00',60]]},{id:2,title:'고2 고쟁이 부호',timeline:[]}]};
 runInNewContext(source.slice(start,end),context);assert.equal(context.currentClassVideos().length,1);const hit=context.studentSearchMatches(context.libraryVideos[0]);assert.equal(hit.title,false);assert.equal(hit.rows.length,1);context.searchResultMode='title';assert.equal(context.currentClassVideos().length,0);context.catalogSearch='고2';assert.equal(context.currentClassVideos()[0].id,2);context.catalogSearch='부호';context.searchResultMode='timeline';assert.equal(context.currentClassVideos()[0].id,1);
});

test('AI 실패·미완료도 기록하고 요청 상한은 실제 호출 전에 막으며 모델별 단가로만 비용을 계산한다',async()=>{
 const store=new LocalStore(':memory:');try{let usage=new AIUsage(store);await usage.save({daily_requests:2,model:'test',input_rate:1,output_rate:5});let calls=0;const wrapped=usage.wrap(async()=>{calls++;return Response.json({stop_reason:calls===1?'end_turn':'max_tokens',usage:{input_tokens:100,output_tokens:20},content:[]})}),input={body:JSON.stringify({model:'test'})};
 await wrapped('https://example.com',input);await wrapped('https://example.com',input);usage=new AIUsage(store);await assert.rejects(usage.wrap(async()=>{calls++;return Response.json({})})('x',input),/요청 상한/);assert.equal(calls,2);const r=await usage.report();assert.equal(r.requests,2);assert.equal(r.incomplete,1);assert.equal(r.estimated_usd,0.0004);assert.equal((await store.all('settings')).filter(r=>r.key.startsWith('youtube_ai_call_')).length,0);
 await usage.save({daily_requests:0,model:'test',input_rate:null,output_rate:null});await assert.rejects(usage.wrap(async()=>{throw new Error('private key must not leak')})('x',input));const failed=await usage.report();assert.equal(failed.failed,1);assert.equal(failed.unknown_usage,1);assert.ok(!JSON.stringify(failed).includes('private key'));
 }finally{store.close()}
});

test('Claude 429의 대기 시간을 저장하고 재시작 후에도 다음 API 요청을 차단한다',async()=>{
 const store=new LocalStore(':memory:');try{let usage=new AIUsage(store),calls=0;await usage.wrap(async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'60'}})})('x',{body:'{}'});usage=new AIUsage(store);await assert.rejects(usage.wrap(async()=>{calls++})('x',{body:'{}'}),e=>e.ai_guard&&e.status===429);assert.equal(calls,1);assert.equal((await usage.report()).failed,1)}finally{store.close()}
});
