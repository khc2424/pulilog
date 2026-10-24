import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeConnection,publicSettings,classifyYouTubeTitle } from '../src/youtube.mjs';
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
  assert.equal(saved.published,false);
  assert.equal(saved.book,'쎈');assert.equal(saved.unit,'함수');
  assert.equal(saved.class_name,'고1 B2');
  await store.patch('videos',{id:saved.id},{notes:'유지할 기록',published:true,timeline:[['1',1,'개념','00:10',10]]});
  assert.equal((await yt.sync()).imported,0);
  assert.equal((await store.all('videos'))[0].notes,'유지할 기록');
  assert.equal((await store.all('videos'))[0].published,true);
  assert.equal((await store.all('classes')).length,1);
  assert.deepEqual(await yt.disconnect(),{revoked:true});
  assert.equal((await yt.status()).connected,false);
  assert.equal((await store.all('videos')).length,1);
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
  const saved=await store.all('videos');assert.equal(saved.length,4);assert.ok(saved.every(v=>v.published===false));
  const unknown=saved.find(v=>v.id===items[4].id);assert.equal(unknown.class_name,'');assert.equal(unknown.book,'');
  const irregular=saved.find(v=>v.id===items[5].id);assert.equal(irregular.class_name,'고1B2');assert.equal(irregular.subject,'');
  assert.equal((await store.all('classes')).length,1);
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
  await store.put('settings',{key:'youtube_state_private',value:'secret-ciphertext'});
  const state=await (await fetch(cfg.origin+'/api/teacher/state',{headers:{Cookie:cookie}})).json();
  assert.deepEqual(state.settings,{});assert.equal(state.youtube.configured,false);
  assert.equal((await post('/api/teacher/youtube/connect',cookie)).status,400);
  const callback=await fetch(cfg.origin+'/api/youtube/callback?state=invalid&code=bad',{redirect:'manual'});
  assert.equal(callback.status,303);assert.ok(callback.headers.get('location').endsWith('/?youtube=failed#settings'));
 }finally{await new Promise(r=>app.close(r));store.close()}
});
