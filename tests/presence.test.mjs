import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudentPresence} from '../src/presence.mjs';
import {LocalStore} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';

test('재생 위치 이동을 시청 시간으로 부풀리지 않고 정지·다른 화면·오래된 신호는 제외한다',()=>{
 let now=100000;const presence=new StudentPresence(()=>now),session={digest:'session'},student={id:1,name:'학생',class_name:'A',active:true},video={id:'Video000001',title:'강의',published:true};let seq=0;
 const update=data=>presence.update(session,student,{client_id:'client-123',sequence:++seq,visible:true,online:true,video_id:video.id,state:'playing',position_seconds:0,...data});
 const snap=()=>presence.snapshot([student],[video],[{digest:'session',role:'student',expires:10000}],[{video_id:video.id,class_name:'A'}]);
 update({});now+=20000;update({position_seconds:900});assert.equal(snap()[0].watched_seconds,20);assert.equal(snap()[0].position_seconds,900);
 now+=20000;update({state:'paused'});assert.equal(snap()[0].watched_seconds,20);
 now+=20000;update({state:'playing',visible:false});now+=20000;update({state:'playing',visible:false});assert.equal(snap()[0].watched_seconds,20);
 presence.update(session,student,{client_id:'client-123',sequence:1,online:false});assert.equal(snap().length,1);
 now+=91000;assert.equal(snap().length,0);
});

test('접속·영상 상태는 본인 반 영상만 보내며 선생님에게만 표시되고 로그아웃 시 사라진다',async()=>{
 const cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite'},store=new LocalStore(':memory:'),app=createApp(cfg,store);
 await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=(path,data,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 try{
  await store.put('students',{id:1,name:'학생',phone:'01011112222',class_name:'A',active:true});
  for(const [id,group] of [['Video000001','A'],['Video000002','B']])await store.saveVideo({id,title:'강의',published:true,added_at:1,timeline:[],timeline_draft:null,reviewed:false},[group]);
  const student=(await post('/api/login',{phone:'01011112222'})).headers.get('set-cookie'),teacher=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie');
  const body={client_id:'client-123',sequence:1,visible:true,online:true,video_id:'Video000001',state:'playing',position_seconds:123};
  assert.equal((await post('/api/presence',body,teacher)).status,401);assert.equal((await post('/api/presence',{...body,video_id:'Video000002'},student)).status,403);
  assert.equal((await post('/api/presence',body,student)).status,200);
  assert.equal((await fetch(cfg.origin+'/api/teacher/presence',{headers:{Cookie:student}})).status,401);
  let state=await (await fetch(cfg.origin+'/api/teacher/presence',{headers:{Cookie:teacher}})).json();assert.equal(state.students[0].name,'학생');assert.equal(state.students[0].position_seconds,123);assert.ok(!JSON.stringify(state).includes('01011112222'));assert.ok(!JSON.stringify(state).includes('session_digest'));
  await post('/api/logout',{},student);state=await (await fetch(cfg.origin+'/api/teacher/presence',{headers:{Cookie:teacher}})).json();assert.equal(state.students.length,0);
  assert.equal((await post('/api/teacher/courses/count-since',{since:'2026-10-27'},teacher)).status,200);
  const teacherState=await (await fetch(cfg.origin+'/api/teacher/state',{headers:{Cookie:teacher}})).json();assert.equal(teacherState.unclassified_count_since,'2026-10-27');assert.deepEqual(teacherState.settings,{});
 }finally{await new Promise(r=>app.close(r));store.close()}
});

test('접속 상태 조회는 타임라인·개인 연락처·인증값을 읽지 않고 필요한 열만 요청할 수 있다',async()=>{
 const {SupabaseStore}=await import('../src/store.mjs');const requests=[];
 const store=new SupabaseStore('https://example.supabase.co','private',async url=>{requests.push(new URL(url));return Response.json([{id:'Video000001',title:'수업',published:true}])});
 await store.all('videos',{id:'Video000001'},['id','title','published']);assert.equal(requests[0].searchParams.get('select'),'id,title,published');assert.equal(requests[0].searchParams.get('id'),'eq.Video000001');
 await assert.rejects(store.all('videos',{},['id,*']),/Invalid fields/);assert.equal(requests.length,1);
 const local=new LocalStore(':memory:');try{await local.put('settings',{key:'test',value:'private'});assert.deepEqual(await local.all('settings',{},['key']),[{key:'test'}])}finally{local.close()}
});
