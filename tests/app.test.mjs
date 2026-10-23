import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalStore,SupabaseStore} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {config} from '../src/config.mjs';

test('운영 준비 설정은 빈 비밀 값이나 로컬 DB로 실행되지 않는다',()=>{
 assert.throws(()=>config({NODE_ENV:'production'}));
 assert.throws(()=>config({NODE_ENV:'production',APP_ORIGIN:'https://example.com',DATABASE_DRIVER:'supabase',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_CODE:'2424',SESSION_SECRET:'s'.repeat(32)}));
 assert.equal(config({NODE_ENV:'production',APP_ORIGIN:'https://example.com',DATABASE_DRIVER:'supabase',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',ADMIN_CODE:'long-local-test-code',SESSION_SECRET:'s'.repeat(32)}).production,true);
});

test('학생·반·영상·타임라인·권한 통합 흐름',async t=>{
 const store=new LocalStore(':memory:');const cfg={origin:'http://127.0.0.1',production:false,adminCode:'2424',sessionSecret:'test-secret',driver:'sqlite',trustProxy:false};const app=createApp(cfg,store);
 await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const call=async(path,body,cookie,extra={})=>{const res=await fetch(cfg.origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin}),...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});const type=res.headers.get('content-type')||'';return{status:res.status,body:type.includes('json')?await res.json():await res.text(),cookie:res.headers.get('set-cookie'),headers:res.headers}};
 let teacher,a,b,sid;
 try{
 await t.test('로그인 경계와 서버 파일 비공개',async()=>{
  assert.equal((await call('/api/teacher/state')).status,401);assert.equal((await call('/api/videos')).status,401);
  for(const path of ['/.env','/src/server.mjs','/.private/pulilog.sqlite3','/supabase/migrations/001_initial.sql'])assert.equal((await call(path)).status,404);
  assert.equal((await call('/production.js')).status,200);
  assert.equal((await call('/api/teacher/login',{code:'bad'})).status,401);
  const r=await call('/api/teacher/login',{code:'2424'});assert.equal(r.status,200);teacher=r.cookie;assert.match(teacher,/HttpOnly/);assert.match(teacher,/SameSite=Strict/);
  const state=(await call('/api/teacher/state',undefined,teacher)).body;assert.deepEqual(state.students,[]);assert.deepEqual(state.classes,[]);assert.deepEqual(state.videos,[]);
 });
 await t.test('반 등록 후 학생 등록·중복 전화번호 차단',async()=>{
  for(const [name,schedule]of [['A반','MWF'],['B반','TTS']])assert.equal((await call('/api/teacher/class',{name,schedule},teacher)).status,200);
  const r=await call('/api/teacher/student',{name:'가온',phone:'01011112222',class_name:'A반'},teacher);assert.equal(r.status,200);sid=r.body.id;
  assert.equal((await call('/api/teacher/student',{name:'나래',phone:'01033334444',class_name:'B반'},teacher)).status,200);
  assert.equal((await call('/api/teacher/student',{name:'중복',phone:'01011112222',class_name:'B반'},teacher)).status,409);
  assert.equal((await call('/api/teacher/student',{name:'오류',phone:'01055556666',class_name:'없는 반'},teacher)).status,400);
  a=(await call('/api/login',{phone:'010-1111-2222',remember:true})).cookie;b=(await call('/api/login',{phone:'01033334444'})).cookie;assert.match(a,/Max-Age=2592000/);
 });
 const video={id:'EeNDcFziKIQ',title:'A반 수업',classes:['A반'],book:'교재',subject:'공통수학2',unit:'평면좌표',published:true};
 await t.test('학생은 자기 반 영상만, 즐겨찾기는 개인별',async()=>{
  assert.equal((await call('/api/teacher/video',video,teacher)).status,200);
  assert.equal((await call('/api/videos',undefined,a)).body.videos.length,1);assert.equal((await call('/api/videos',undefined,b)).body.videos.length,0);
  assert.equal((await call('/api/favorite',{video_id:video.id,favorite:true},b)).status,404);
  assert.equal((await call('/api/favorite',{video_id:video.id,favorite:true},a)).status,200);
  assert.equal((await call('/api/videos',undefined,a)).body.videos[0].favorite,true);
 });
 await t.test('초안은 학생에게 노출되지 않고 반영 후에만 표시',async()=>{
  const rows=[['1',5,'거리','ignored',108]];
  assert.equal((await call('/api/teacher/timeline',{id:video.id,rows,publish:false},teacher)).status,200);
  assert.deepEqual((await call('/api/videos',undefined,a)).body.videos[0].timeline,[]);
  assert.equal((await call('/api/teacher/timeline',{id:video.id,rows,publish:true},teacher)).status,200);
  assert.equal((await call('/api/videos',undefined,a)).body.videos[0].timeline[0][3],'01:48');
  await call('/api/teacher/note',{id:video.id,notes:'교사 전용',supplement_needed:true},teacher);
  const v=(await call('/api/videos',undefined,a)).body.videos[0];for(const k of ['notes','timeline_draft','supplement_needed','classes'])assert.equal(k in v,false);
 });
 await t.test('동일 영상 수정은 기존 타임라인 유지, 여러 반 배정과 숨김',async()=>{
  await call('/api/teacher/video',{...video,classes:['A반','B반']},teacher);
  assert.equal((await call('/api/videos',undefined,b)).body.videos[0].timeline.length,1);
  const state=(await call('/api/teacher/state',undefined,teacher)).body;assert.equal(state.videos.length,1);assert.equal(state.videos[0].notes,'교사 전용');
  await call('/api/teacher/video',{...video,published:false},teacher);assert.equal((await call('/api/videos',undefined,a)).body.videos.length,0);
  assert.equal((await call('/api/favorite',{video_id:video.id,favorite:true},a)).status,404);
 });
 await t.test('전화번호 변경은 기존 학생 세션 해제',async()=>{
  await call('/api/teacher/student',{id:sid,name:'가온',phone:'01099990000',class_name:'A반'},teacher);
  assert.equal((await call('/api/videos',undefined,a)).status,401);
  const cookie=(await call('/api/login',{phone:'01099990000'})).cookie;await call('/api/teacher/student',{id:sid,name:'가온',phone:'01099990000',class_name:'A반',active:false},teacher);assert.equal((await call('/api/videos',undefined,cookie)).status,401);
 });
 await t.test('외부 Origin 차단·숙제 기능 미제공·로그아웃',async()=>{
  assert.equal((await call('/api/teacher/class',{name:'공격'},teacher,{Origin:'https://other.example'})).status,403);
  assert.equal((await call('/api/teacher/homework-draft',{},teacher)).status,404);
  assert.equal((await call('/api/teacher/timeline',{id:video.id,rows:[['1',5,'오류','',-1]]},teacher)).status,400);
  assert.equal((await call('/api/teacher/logout',{},teacher)).status,200);assert.equal((await call('/api/teacher/state',undefined,teacher)).status,401);
 });
 await t.test('로그인 시도 제한',async()=>{
  for(let i=0;i<16;i++)await call('/api/teacher/login',{code:'wrong'});
  assert.equal((await call('/api/teacher/login',{code:'2424'})).status,429);
 });
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));store.close()}
});

test('Supabase 비밀 키는 서버 요청에만 사용, RPC 원자 저장 경로',async()=>{
 const calls=[];const db=new SupabaseStore('https://example.supabase.co','sb_secret_test',async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.includes('pl_consume_rate')?true:[]),{status:200})});
 await db.all('students',{class_name:'A반'});await db.saveVideo({id:'EeNDcFziKIQ'},['A반']);await db.consumeRate('hashed-ip',15,60);
 assert.equal(calls[0].init.headers.apikey,'sb_secret_test');assert.equal(calls[0].init.headers.Authorization,undefined);assert.match(calls[0].url,/class_name=eq\./);assert.match(calls[1].url,/rpc\/pl_save_video$/);
 const bad=new SupabaseStore('https://example.supabase.co','secret',async()=>new Response('private database details',{status:500}));await assert.rejects(bad.all('students'),e=>!e.message.includes('private database'));
});

test('로컬 파일 저장은 재시작 후에도 유지',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'pulilog-'));const path=join(dir,'test.sqlite3');
 try{const a=new LocalStore(path);await a.put('classes',{name:'기록반',schedule:'MWF'});a.close();const b=new LocalStore(path);assert.equal((await b.all('classes'))[0].name,'기록반');b.close()}finally{rmSync(dir,{recursive:true,force:true})}
});
