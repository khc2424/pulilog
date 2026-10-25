import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeConnection,publicSettings,classifyYouTubeTitle,youtubeYear } from '../src/youtube.mjs';
import { LocalStore } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';

test('유튜브 OAuth 상태 검증·토큰 암호화·일부 공개 가져오기·중복 보존',async()=>{
 const store=new LocalStore(':memory:');
 const cfg={origin:'https://example.com',sessionSecret:'s'.repeat(32),googleClientId:'client-id',googleClientSecret:'client-secret'};
 let refresh=0,exchanges=0;
 const fetcher=async(raw,options)=>{
  const url=new URL(raw);
  if(url.pathname==='/token'){
   exchanges++;
   if(options.body.get('grant_type')==='refresh_token'){refresh++;return Response.json({access_token:'renewed',expires_in:3600})}
   assert.ok(options.body.get('code_verifier'));
   return Response.json({access_token:'access-private',refresh_token:'refresh-private',expires_in:1,scope:'https://www.googleapis.com/auth/youtube.readonly'});
  }
  if(url.pathname.endsWith('/channels'))return Response.json({items:[{id:'channel',snippet:{title:'수업 채널'},contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]});
  if(url.pathname.endsWith('/playlistItems'))return Response.json(url.searchParams.get('pageToken')?{items:[{contentDetails:{videoId:'Private0001'}}]}:{items:[{contentDetails:{videoId:'EeNDcFziKIQ'}}],nextPageToken:'page2'});
  if(url.pathname.endsWith('/videos'))return Response.json({items:[
   {id:'EeNDcFziKIQ',snippet:{publishedAt:'2026-04-01T00:00:00Z',channelId:'channel',title:'고1B2 쎈 공통수학1 [2-7] 함수 #1'},status:{privacyStatus:'unlisted',embeddable:true}},
   {id:'Private0001',snippet:{publishedAt:'2026-04-01T00:00:00Z',channelId:'channel',title:'비공개'},status:{privacyStatus:'private',embeddable:true}}
  ]});
  if(url.pathname==='/revoke')return new Response('',{status:200});
  throw new Error('Unexpected endpoint');
 };
 const yt=new YouTubeConnection(cfg,store,fetcher);
 try{
  await store.put('sessions',{digest:'teacher',role:'teacher',expires:Date.now()/1000+3600});
  await store.put('classes',{name:'고1 B2',schedule:''});
  const started=await yt.start({digest:'teacher'}),auth=new URL(started.url);
  assert.equal(auth.searchParams.get('scope'),'https://www.googleapis.com/auth/youtube.readonly');
  assert.equal(auth.searchParams.get('redirect_uri'),'https://example.com/api/youtube/callback');
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  const params=new URLSearchParams({state:started.state,code:'one-use-code'});
  await assert.rejects(yt.finish(params,'wrong'));
  assert.equal(exchanges,0);
  await yt.finish(params,started.state);
  await assert.rejects(yt.finish(params,started.state));
  assert.equal((await yt.status()).connected,true);
  const settings=await store.all('settings');
  assert.ok(!JSON.stringify(settings).includes('refresh-private'));
  assert.deepEqual(publicSettings(settings),{});
  assert.ok(!JSON.stringify(await yt.status()).includes('access-private'));
  assert.deepEqual(await yt.sync(),{year:2026,imported:1,skipped:1,outside_year:0,unknown_date:0,unassigned:0,needs_review:0});
  assert.equal(refresh,1);
  const saved=(await store.all('videos'))[0];
  assert.equal(saved.published,true);
  assert.equal(saved.book,'쎈');assert.equal(saved.unit,'함수');
  assert.equal(saved.class_name,'고1 B2');
  await store.patch('videos',{id:saved.id},{notes:'유지할 기록',published:false,timeline:[['1',1,'개념','00:10',10]]});
  assert.equal((await yt.sync()).imported,0);
  assert.equal((await store.all('videos'))[0].notes,'유지할 기록');
  assert.equal((await store.all('videos'))[0].published,false);
  assert.equal((await store.all('classes')).length,1);
  yt.busy=true;await assert.rejects(yt.removeVideos([saved.id]));assert.equal((await store.all('videos')).length,1);yt.busy=false;
  const removing=yt.removeVideos([saved.id]);await assert.rejects(yt.sync());await removing;
  assert.equal((await yt.sync()).imported,0);
  const restarted=new YouTubeConnection(cfg,store,fetcher);assert.equal((await restarted.sync()).imported,0);
  assert.deepEqual(await yt.disconnect(),{revoked:true});
  assert.equal((await yt.status()).connected,false);
  assert.equal((await store.all('videos')).length,0);
 }finally{store.close()}
});

test('반 이름 공백과 긴 이름 우선 매칭, 교재 이름 보존',()=>{
 assert.deepEqual(classifyYouTubeTitle('고1 B2 개념 원리 공통수학1 [1-2] 다항식 #2',['고1B2']),{classes:['고1B2'],class_name:'고1B2',book:'개념 원리',subject:'공통수학1',unit:'다항식'});
 assert.equal(classifyYouTubeTitle('고1B20 쎈 대수 함수 #1',['고1B2']).classes.length,0);
 assert.equal(classifyYouTubeTitle('약논반 수리논술 수업 #1',['약논반']).class_name,'약논반');
});

test('1,000개 업로드를 페이지 순서와 무관하게 2026년만 가져오고 불규칙 제목은 검토 대상으로 둔다',async()=>{
 const store=new LocalStore(':memory:');
 const cfg={origin:'https://example.com',sessionSecret:'s'.repeat(32)};
 const items=Array.from({length:1000},(_,i)=>({id:'V'+String(i).padStart(10,'0'),snippet:{channelId:'channel',publishedAt:'2025-06-01T00:00:00Z',title:'고1B2 쎈 공통수학1 [2-7] 함수 #1'},status:{privacyStatus:'unlisted',embeddable:true}}));
 items[0].snippet.publishedAt='2025-12-31T15:00:00Z';
 items[1].snippet.publishedAt='2026-12-31T14:59:59Z';
 items[2].snippet.publishedAt='2026-12-31T15:00:00Z';
 items[3].snippet.publishedAt='2025-12-31T14:59:59Z';
 items[4].snippet={...items[4].snippet,publishedAt:'2026-07-01T00:00:00Z',title:'고2C1 쎈 대수 함수 #1'};
 items[5].snippet={...items[5].snippet,publishedAt:'2026-07-01T00:00:00Z',title:'고1B2 오늘 보충수업'};
 delete items[6].snippet.publishedAt;
 items[7].snippet.publishedAt='2026-07-01T00:00:00Z';items[7].status.privacyStatus='private';
 let pages=0;
 const yt=new YouTubeConnection(cfg,store,async raw=>{
  const url=new URL(raw);
  if(url.pathname.endsWith('/playlistItems')){
   pages++;const start=Number(url.searchParams.get('pageToken')||0);
   return Response.json({items:items.slice(start,start+50).map(v=>({contentDetails:{videoId:v.id}})),...(start+50<items.length?{nextPageToken:String(start+50)}:{})});
  }
  if(url.pathname.endsWith('/videos')){const ids=new Set(url.searchParams.get('id').split(','));return Response.json({items:items.filter(v=>ids.has(v.id))})}
  throw new Error('Unexpected endpoint');
 });
 try{
  await store.put('classes',{name:'고1B2',schedule:''});
  await yt.save({access_token:'test-access',expires:Date.now()/1000+3600,channel:{id:'channel',uploads:'uploads'}});
  const result=await yt.sync();
  assert.equal(pages,20);
  assert.deepEqual(result,{year:2026,imported:4,skipped:1,outside_year:994,unknown_date:1,unassigned:1,needs_review:2});
  const saved=await store.all('videos');assert.equal(saved.length,4);assert.ok(saved.every(v=>v.published===true));
  const unknown=saved.find(v=>v.id===items[4].id);assert.equal(unknown.class_name,'');assert.equal(unknown.book,'');
  const irregular=saved.find(v=>v.id===items[5].id);assert.equal(irregular.class_name,'고1B2');assert.equal(irregular.subject,'');
  assert.equal((await store.all('classes')).length,1);
  const dates=(await store.all('settings',{key:'youtube_video_dates'}))[0].value;
  assert.equal(youtubeYear(dates[items[0].id]),2026);
  assert.equal(youtubeYear(dates[items[2].id]),2027);
  assert.equal(youtubeYear(dates[items[3].id]),2025);
  assert.equal((await yt.sync()).imported,0);
  await store.put('settings',{key:'youtube_excluded_video_ids',value:[items[0].id]});
  await store.deleteVideos([items[0].id]);
  assert.equal((await yt.sync()).imported,0);
  assert.equal((await store.all('videos')).length,3);
  await assert.rejects(yt.sync({year:'2026'}));
 }finally{store.close()}
});

test('유튜브 연결 API는 선생님 전용이고 비밀 설정은 응답에 포함되지 않는다',async()=>{
 const store=new LocalStore(':memory:'),cfg={origin:'http://127.0.0.1',production:false,sessionSecret:'test-secret',adminCode:'2424',driver:'sqlite'};
 const app=createApp(cfg,store);await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=async(path,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'X-AXIS-Request':'1',Origin:cfg.origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:'{}'});
 try{
  assert.equal((await post('/api/teacher/youtube/connect')).status,401);
  const login=await fetch(cfg.origin+'/api/teacher/login',{method:'POST',headers:{'X-AXIS-Request':'1',Origin:cfg.origin,'Content-Type':'application/json'},body:JSON.stringify({code:'2424'})});
  const cookie=login.headers.get('set-cookie');
  for(const [id,title] of [['Keep2026001','유지'],['Drop2025001','제거'],['NoDate00001','날짜 미확인']])await store.saveVideo({id,title,added_at:1,published:false,timeline:[]},['테스트반']);
  await store.put('students',{id:1,name:'학생',phone:'01011112222',class_name:'테스트반',active:true});
  await store.put('favorites',{student_id:1,video_id:'Drop2025001'});
  await store.put('settings',{key:'youtube_video_dates',value:{Keep2026001:'2026-03-01T00:00:00Z',Drop2025001:'2025-03-01T00:00:00Z'}});
  const cleanup=async body=>fetch(cfg.origin+'/api/teacher/videos/remove-outside-year',{method:'POST',headers:{Cookie:cookie,'X-AXIS-Request':'1',Origin:cfg.origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const preview=await (await cleanup({keep_year:2026})).json();
  assert.deepEqual(preview.ids,['Drop2025001']);assert.equal(preview.unknown_date,1);
  assert.equal((await cleanup({keep_year:2026,execute:true,ids:['Keep2026001']})).status,409);
  assert.equal((await store.all('videos')).length,3);
  const removed=await (await cleanup({keep_year:2026,execute:true,ids:preview.ids})).json();
  assert.equal(removed.deleted,1);
  assert.deepEqual((await store.all('videos')).map(v=>v.id).sort(),['Keep2026001','NoDate00001']);
  assert.equal((await store.all('favorites')).length,0);
  assert.equal((await store.all('video_classes')).length,2);
  assert.equal((await store.all('classes')).length,1);
  assert.equal((await store.all('students')).length,1);
  const teacherPost=async(path,data)=>fetch(cfg.origin+path,{method:'POST',headers:{Cookie:cookie,'X-AXIS-Request':'1',Origin:cfg.origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const visibility=await teacherPost('/api/teacher/videos/visibility',{ids:['Keep2026001','NoDate00001'],published:true});
  assert.equal(visibility.status,200);assert.ok((await store.all('videos')).every(v=>v.published));
  for(const [id,classes]of [['Default0001',[]],['Default0002',['테스트 반','테스트반']]])assert.equal((await teacherPost('/api/teacher/video',{id,title:'분류 전 새 강의',classes})).status,200);
  assert.equal((await store.all('classes')).length,1);
  assert.equal((await store.all('video_classes',{video_id:'Default0002'})).length,1);
  assert.equal((await teacherPost('/api/teacher/student',{id:1,name:'학생',phone:'01011112222',class_name:'테스트 반',active:true})).status,200);
  assert.equal((await store.all('students'))[0].class_name,'테스트반');
  assert.ok((await store.all('videos')).every(v=>v.published));
  const student=await teacherPost('/api/login',{phone:'01011112222'});
  const studentCookie=student.headers.get('set-cookie');
  const studentVideos=await (await fetch(cfg.origin+'/api/videos',{headers:{Cookie:studentCookie}})).json();
  assert.ok(studentVideos.videos.some(v=>v.id==='Default0002'));
  assert.ok(!studentVideos.videos.some(v=>v.id==='Default0001'));
  // Site import time must not move an older YouTube lesson ahead of a newer one.
  await store.saveVideo({id:'Newest00001',title:'최신 강의',added_at:0,published:true,timeline:[]},['테스트반']);
  await store.put('settings',{key:'youtube_video_dates',value:{Keep2026001:'2026-03-01T00:00:00Z',Newest00001:'2026-10-25T00:00:00Z'}});
  const ordered=await (await fetch(cfg.origin+'/api/videos',{headers:{Cookie:studentCookie}})).json();
  assert.deepEqual(ordered.videos.slice(0,2).map(v=>v.id),['Newest00001','Keep2026001']);
  assert.equal(ordered.videos[0].youtube_published_at,'2026-10-25T00:00:00Z');
  assert.equal(ordered.videos.find(v=>v.id==='Default0002').youtube_published_at,null);
  await store.deleteVideos(['Newest00001']);
  await store.put('settings',{key:'youtube_video_dates',value:{Keep2026001:'2026-03-01T00:00:00Z',Drop2025001:'2025-03-01T00:00:00Z'}});
  await teacherPost('/api/teacher/videos/visibility',{ids:['Default0002'],published:false});
  const afterHide=await (await fetch(cfg.origin+'/api/videos',{headers:{Cookie:studentCookie}})).json();
  assert.ok(!afterHide.videos.some(v=>v.id==='Default0002'));
  const deletePreview=await teacherPost('/api/teacher/videos/delete',{ids:['Default0001']});
  assert.equal((await deletePreview.json()).delete_count,1);assert.equal((await store.all('videos')).length,4);
  assert.equal((await teacherPost('/api/teacher/videos/delete',{ids:['Nonexistent'],execute:true})).status,400);
  assert.equal((await teacherPost('/api/teacher/videos/delete',{ids:['Default0001'],execute:true})).status,200);
  assert.equal((await store.all('videos')).length,3);
  assert.equal((await store.all('students')).length,1);
  await store.saveVideo({id:'TempVideo01',title:'임시 삭제 특강',published:true},[]);
  await store.put('settings',{key:'youtube_excluded_video_ids',value:['Default0001','TempVideo01']});
  assert.equal((await teacherPost('/api/teacher/videos/delete',{ids:['TempVideo01'],execute:true,exclude_from_import:false})).status,200);
  assert.deepEqual((await store.all('settings',{key:'youtube_excluded_video_ids'}))[0].value,['Default0001','TempVideo01']);
  assert.equal((await store.all('videos',{id:'TempVideo01'})).length,0);
  await store.put('classes',{name:'약논반',schedule:'TTS'});
  for(const [id,published]of [['AliasTest01',true],['AliasTest02',false]])await store.saveVideo({id,title:'NK 약술형논술 수학1',class_name:'',published,book:'',subject:'',unit:'',timeline:[['1',1,'개념','00:10',10]],notes:'유지할 메모'},[]);
  assert.equal((await (await teacherPost('/api/teacher/videos/apply-title-aliases',{})).json()).assign_count,2);
  assert.equal((await (await teacherPost('/api/teacher/videos/apply-title-aliases',{execute:true})).json()).updated,2);
  assert.equal((await (await teacherPost('/api/teacher/videos/apply-title-aliases',{execute:true})).json()).updated,0);
  assert.equal((await store.all('videos',{id:'AliasTest02'}))[0].published,false);
  assert.equal((await store.all('videos',{id:'AliasTest01'}))[0].notes,'유지할 메모');
  await store.put('students',{id:2,name:'약논학생',phone:'01022223333',class_name:'약논반',active:true});
  const aliasStudent=await teacherPost('/api/login',{phone:'01022223333'});
  const aliasList=await (await fetch(cfg.origin+'/api/videos',{headers:{Cookie:aliasStudent.headers.get('set-cookie')}})).json();
  assert.deepEqual(aliasList.videos.map(v=>v.id),['AliasTest01']);
  const otherClassList=await (await fetch(cfg.origin+'/api/videos',{headers:{Cookie:studentCookie}})).json();
  assert.ok(!otherClassList.videos.some(v=>v.id.startsWith('Alias')));
  const existingDates=(await store.all('settings',{key:'youtube_video_dates'}))[0].value;
  await store.put('settings',{key:'youtube_video_dates',value:{...existingDates,History0001:'2026-02-01T00:00:00Z'}});
  const recoveredPreview=await (await teacherPost('/api/teacher/videos/recover-deletion-history',{ids:['TempVideo01','Keep2026001']})).json();
  assert.ok(recoveredPreview.ids.includes('History0001'));assert.ok(!recoveredPreview.ids.includes('Keep2026001'));
  const videoCount=(await store.all('videos')).length;
  assert.equal((await teacherPost('/api/teacher/videos/recover-deletion-history',{ids:['TempVideo01','Keep2026001'],execute:true,confirmed_ids:recoveredPreview.ids})).status,200);
  assert.equal((await store.all('videos')).length,videoCount);
  const exclusions=(await store.all('settings',{key:'youtube_excluded_video_ids'}))[0].value;
  assert.ok(exclusions.includes('History0001'));assert.ok(exclusions.includes('TempVideo01'));assert.ok(!exclusions.includes('Keep2026001'));
  await store.put('settings',{key:'youtube_state_private',value:'secret-ciphertext'});
  const state=await (await fetch(cfg.origin+'/api/teacher/state',{headers:{Cookie:cookie}})).json();
  assert.deepEqual(state.settings,{});assert.equal(state.youtube.configured,false);
  assert.equal((await post('/api/teacher/youtube/connect',cookie)).status,400);
  const callback=await fetch(cfg.origin+'/api/youtube/callback?state=invalid&code=bad',{redirect:'manual'});
  assert.equal(callback.status,303);assert.ok(callback.headers.get('location').endsWith('/?youtube=failed#settings'));
 }finally{await new Promise(r=>app.close(r));store.close()}
});
