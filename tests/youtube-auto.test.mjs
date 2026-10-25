import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalStore} from '../src/store.mjs';
import {YouTubeConnection,publicSettings} from '../src/youtube.mjs';
import {YouTubeAutoImport} from '../src/youtube-auto.mjs';
import {createApp} from '../src/server.mjs';

test('예약 설정문은 Vault 인증과 고정 작업명을 사용하고 인증값을 상태에 노출하지 않는다',async()=>{
 const store=new LocalStore(':memory:'),cfg={origin:'https://example.com',sessionSecret:'test',googleClientId:'id',googleClientSecret:'secret'};
 const yt=new YouTubeConnection(cfg,store),auto=new YouTubeAutoImport(cfg,store,yt);
 try{
  await assert.rejects(auto.prepare(2026),/Google/);
  await yt.save({access_token:'access',expires:Date.now()/1000+3600,channel:{id:'channel',uploads:'uploads'}});
  await assert.rejects(auto.prepare(1900));
  const {sql}=await auto.prepare(2026),token=sql.match(/vault.create_secret\('([^']+)'/)[1];
  assert.match(sql,/cron.schedule\('pulilog-youtube-auto-import'/);
  assert.ok(sql.includes("'0 * * * *'"));
  assert.equal((await auto.status()).interval_minutes,60);
  assert.match(sql,/vault.decrypted_secrets/);
  assert.match(sql,/timeout_milliseconds := 180000/);
  assert.ok(!JSON.stringify(await store.all('settings')).includes(token));
  assert.ok(!JSON.stringify(await auto.status()).includes('token_hash'));
  assert.deepEqual(publicSettings(await store.all('settings')),{});
  await assert.rejects(auto.run('Bearer wrong'),e=>e.status===401);
  await auto.toggle(false);assert.deepEqual(await auto.run('Bearer '+token),{skipped:'paused'});
  await auto.toggle(true);yt.busy=true;assert.deepEqual(await auto.run('Bearer '+token),{skipped:'busy'});yt.busy=false;
  const repeated=await auto.prepare(2026);assert.equal(repeated.sql,sql);
  await auto.toggle(false);assert.deepEqual(await auto.run('Bearer '+token),{skipped:'paused'});
 }finally{store.close()}
});

test('예약 요청은 새 영상만 가져오고 삭제·숨김·연도 조건과 학생 반을 유지한다',async()=>{
 const store=new LocalStore(':memory:'),cfg={origin:'http://127.0.0.1',production:false,sessionSecret:'test',adminCode:'2424',driver:'sqlite',googleClientId:'id',googleClientSecret:'secret'};
 let metadataCalls=0,fail=false;
 const fetcher=async input=>{
  if(fail)throw new Error('network');
  const url=new URL(input);
  if(url.pathname.endsWith('/playlistItems'))return Response.json({items:['NewVideo001','Deleted0001','Hidden00001','Older000001'].map(videoId=>({contentDetails:{videoId}}))});
  if(url.pathname.endsWith('/videos')){
   metadataCalls++;assert.equal(url.searchParams.get('id'),'NewVideo001');
   return Response.json({items:[{id:'NewVideo001',snippet:{publishedAt:'2026-10-25T00:00:00Z',channelId:'channel',title:'고1B2 쎈 공통수학1 [2-7] 함수 #1'},status:{privacyStatus:'unlisted',embeddable:true}}]});
  }
  throw new Error('Unexpected URL');
 };
 const app=createApp(cfg,store,{youtubeFetch:fetcher});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const yt=new YouTubeConnection(cfg,store),auto=new YouTubeAutoImport(cfg,store,yt);
 try{
  await yt.save({access_token:'access',expires:Date.now()/1000+3600,channel:{id:'channel',uploads:'uploads'}});
  await store.saveVideo({id:'Hidden00001',title:'숨긴 영상',published:false,added_at:1,notes:'유지',timeline:[]},['고1B2']);
  await store.put('settings',{key:'youtube_excluded_video_ids',value:['Deleted0001']});
  await store.put('settings',{key:'youtube_video_dates',value:{Older000001:'2025-10-01T00:00:00Z'}});
  const {sql}=await auto.prepare(2026),token=sql.match(/vault.create_secret\('([^']+)'/)[1];
  const call=auth=>fetch(cfg.origin+'/api/jobs/youtube-import',{method:'POST',headers:auth?{Authorization:auth}:{}});
  assert.equal((await call()).status,401);assert.equal((await call('Bearer 2424')).status,401);
  const response=await call('Bearer '+token);assert.equal(response.status,200);assert.equal((await response.json()).imported,1);
  assert.equal(metadataCalls,1);
  assert.equal((await store.all('videos',{id:'Deleted0001'})).length,0);
  assert.equal((await store.all('videos',{id:'Hidden00001'}))[0].published,false);
  assert.equal((await store.all('videos',{id:'NewVideo001'}))[0].class_name,'고1B2');
  assert.equal((await store.all('videos',{id:'NewVideo001'}))[0].published,true);
  assert.equal((await auto.status()).last_imported,1);assert.ok((await auto.status()).last_success);
  assert.equal((await (await call('Bearer '+token)).json()).skipped,'recent');
  let state=await auto.read();await auto.save({...state,last_checked:null});
  const repeat=await (await call('Bearer '+token)).json();assert.equal(repeat.imported,0);assert.equal(metadataCalls,1);
  state=await auto.read();await auto.save({...state,last_checked:null});fail=true;
  assert.equal((await call('Bearer '+token)).status,400);assert.match((await auto.status()).error,/지연/);
  fail=false;state=await auto.read();await auto.save({...state,last_checked:null});
  assert.equal((await call('Bearer '+token)).status,200);assert.equal((await auto.status()).error,'');
 }finally{await new Promise(r=>app.close(r));store.close()}
});
