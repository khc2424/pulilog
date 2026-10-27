import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TimelineQueue} from '../src/timeline-queue.mjs';
import {LocalStore} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {YouTubeConnection} from '../src/youtube.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await pause(5)}throw new Error('작업 대기 시간 초과')}
const video=id=>({id,title:id,timeline:[],timeline_draft:null});

test('선택 영상은 하나씩 처리하며 중복·기존 초안을 건너뛰고 실패 뒤에도 계속한다',async()=>{
 const store=new LocalStore(':memory:');let release,started=false,running=0,maxRunning=0;const calls=[];
 const queue=new TimelineQueue(store,async job=>{running++;maxRunning=Math.max(maxRunning,running);calls.push(job.video_id);try{if(job.video_id==='first'){started=true;await new Promise(r=>release=r)}if(job.video_id==='bad')throw Object.assign(new Error('자막 없음'),{status:400});return {rows:[['1']],analysis:{needs_check:1}}}finally{running--}});
 try{
  const created=await queue.enqueue([video('first'),video('cancel'),video('bad'),video('last'),{...video('old'),timeline_draft:[['기존']]}]);
  await until(()=>started);assert.equal((await queue.enqueue([video('first')])).length,0);
  await queue.cancel(created.find(j=>j.video_id==='cancel').id);release();
  await until(async()=>!(await queue.list()).some(j=>['queued','running'].includes(j.status)));
  assert.deepEqual(calls,['first','bad','last']);assert.equal(maxRunning,1);
  const statuses=Object.fromEntries((await queue.list()).map(j=>[j.video_id,j.status]));assert.deepEqual(statuses,{old:'skipped',last:'done',bad:'failed',cancel:'cancelled',first:'done'});
  await assert.rejects(queue.enqueue(Array.from({length:21},(_,i)=>video(String(i)))),/20개/);
 }finally{queue.close();store.close()}
});

test('재시작 시 진행 중이던 작업은 자동 재과금하지 않고 대기 작업만 재개한다',async()=>{
 const store=new LocalStore(':memory:');let calls=0;
 for(const [id,status] of [['interrupted','running'],['pending','queued']])await store.put('settings',{key:'youtube_timeline_job_'+id,value:{id,video_id:id,title:id,status,created_at:'2026-10-27T00:00:00Z'}});
 const queue=new TimelineQueue(store,async()=>{calls++;return {rows:[],analysis:{}}});
 try{const before=await queue.list();assert.equal(before.find(j=>j.id==='interrupted').status,'failed');queue.kick();await until(async()=>(await queue.list()).find(j=>j.id==='pending').status==='done');assert.equal(calls,1)}finally{queue.close();store.close()}
});

test('일괄 작업 API는 선생님 전용이고 응답은 빠르게 접수하며 결과는 초안에만 저장한다',async()=>{
 const cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite',anthropicKey:'test',googleClientId:'id',googleClientSecret:'secret'},store=new LocalStore(':memory:');let calls=0;
 const yt=new YouTubeConnection(cfg,store);await yt.save({access_token:'private',expires:Date.now()/1000+3600,scopes:['https://www.googleapis.com/auth/youtube.force-ssl']});
 const captions='WEBVTT\n\n00:00:05.000 --> 00:00:09.000\n1번 문제 풀자\n';
 const app=createApp(cfg,store,{youtubeFetch:async url=>new URL(url).pathname.endsWith('/captions')?Response.json({items:[{id:'track',snippet:{status:'serving',language:'ko'}}]}):new Response(captions),aiFetch:async()=>{calls++;return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[{cue_id:0,kind:'problem',number:'1',title:'문제 풀이',evidence:'1번 문제',confidence:'high'}]})}]})}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=(path,data,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 try{
  for(const id of ['BatchVid001','BatchVid002'])await store.saveVideo({...video(id),added_at:1,published:true,reviewed:false},['반']);
  await store.put('students',{id:1,name:'학생',phone:'01011112222',class_name:'반',active:true});
  const teacher=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie'),student=(await post('/api/login',{phone:'01011112222'})).headers.get('set-cookie');
  assert.equal((await post('/api/teacher/timeline/batch',{ids:['BatchVid001']},student)).status,401);
  assert.equal((await fetch(cfg.origin+'/api/teacher/timeline/jobs',{headers:{Cookie:student}})).status,401);
  assert.equal((await post('/api/teacher/timeline/batch',{ids:['Unknown0000']},teacher)).status,400);
  const response=await post('/api/teacher/timeline/batch',{ids:['BatchVid001','BatchVid002']},teacher);assert.equal(response.status,202);assert.equal((await response.json()).jobs.length,2);
  let jobs;await until(async()=>{jobs=(await (await fetch(cfg.origin+'/api/teacher/timeline/jobs',{headers:{Cookie:teacher}})).json()).jobs;return jobs.length===2&&jobs.every(j=>j.status==='done')});assert.equal(calls,2);
  for(const v of await store.all('videos')){assert.equal(v.timeline.length,0);assert.equal(v.timeline_draft.length,1)}
  const state=await (await fetch(cfg.origin+'/api/teacher/state',{headers:{Cookie:teacher}})).json();assert.deepEqual(state.settings,{});
  const list=await (await fetch(cfg.origin+'/api/videos',{headers:{Cookie:student}})).json();assert.ok(!JSON.stringify(list).includes('job'));assert.ok(list.videos.every(v=>!v.timeline.length));
 }finally{await new Promise(r=>app.close(r));store.close()}
});
