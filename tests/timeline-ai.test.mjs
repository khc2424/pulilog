import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TimelineAI,parseCaptions,validateAnalysis} from '../src/timeline-ai.mjs';
import {LocalStore} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {YouTubeConnection} from '../src/youtube.mjs';

const subtitles='WEBVTT\n\n00:00:01.500 --> 00:00:04.000\n1번 문제 거리의 최솟값 보자.\n\n00:00:35.000 --> 00:00:40.000\n다음 문제를 풀어 볼게.\n';
const answer={items:[{cue_id:0,number:'1',title:'거리의 최솟값',evidence:'1번 문제',confidence:'high'},{cue_id:1,number:null,title:'다음 문제 풀이',evidence:'다음 문제를 풀어',confidence:'low'}]};
const aiResponse=()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(answer)}],usage:{input_tokens:100,output_tokens:80}});

test('SRT/VTT 시간을 유지하고 근거 없는 시간·본문·문제 번호는 거부한다',()=>{
 const cues=parseCaptions(subtitles);assert.equal(cues[0].start,1);assert.equal(cues[1].start,35);
 const srt=parseCaptions('1\n01:02:03,400 --> 01:02:05,000\n<b>123번</b> 풀이\n');assert.equal(srt[0].start,3723);assert.equal(srt[0].text,'123번 풀이');
 assert.throws(()=>parseCaptions('문제 1번: 35초'));assert.throws(()=>parseCaptions(subtitles.replace('00:00:35','00:61:35')));
 assert.throws(()=>parseCaptions('a'.repeat(2*1024*1024+1)));
 const result=validateAnalysis(answer,cues);assert.equal(result.rows[0][4],1);assert.equal(result.rows[1][0],'번호 확인 필요');assert.equal(result.needs_check,1);
 for(const changed of [{cue_id:999},{evidence:'원문에 없는 말'},{number:'1000000'},{title:''}])assert.throws(()=>validateAnalysis({items:[{...answer.items[0],...changed}]},cues));
});

test('Claude 요청은 서버 키와 자막만 보내며 중복 실행·실패 응답을 처리한다',async()=>{
 let release,request;
 const ai=new TimelineAI({anthropicKey:'private-key',anthropicModel:'test-model'},async(url,options)=>{request={url,options};await new Promise(r=>release=r);return aiResponse()});
 const pending=ai.analyze(subtitles,{title:'수업'});await assert.rejects(ai.analyze(subtitles,{}),e=>e.status===429);release();const result=await pending;
 assert.equal(request.options.headers['x-api-key'],'private-key');assert.equal(request.url,'https://api.anthropic.com/v1/messages');
 const body=JSON.parse(request.options.body);assert.equal(body.output_config.format.type,'json_schema');assert.equal(body.model,'test-model');assert.ok(!JSON.stringify(ai.status()).includes('private-key'));assert.equal(result.rows.length,2);
 await assert.rejects(new TimelineAI({}).analyze(subtitles,{}),/ANTHROPIC_API_KEY/);
 await assert.rejects(new TimelineAI({anthropicKey:'key'},async()=>new Response('',{status:401})).analyze(subtitles,{}),/권한/);
 await assert.rejects(new TimelineAI({anthropicKey:'key'},async()=>Response.json({stop_reason:'max_tokens'})).analyze(subtitles,{}),/완성/);
});

test('AI 결과는 초안에만 저장하고 학생에게 비공개, 동시 수정·삭제를 덮어쓰지 않는다',async()=>{
 const store=new LocalStore(':memory:'),cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite',anthropicKey:'private-key'};
 let aiCalls=0,changeDuringAnalysis=false;
 const app=createApp(cfg,store,{aiFetch:async()=>{aiCalls++;if(changeDuringAnalysis)await store.patch('videos',{id:'Video000001'},{timeline_draft:[['9',0,'선생님 수정','00:09',9]]});return aiResponse()}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=async(path,data,cookie)=>{const response=await fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')}};
 try{
  const video={id:'Video000001',title:'강의',added_at:1,published:true,reviewed:true,timeline:[['7',0,'기존 공개','00:07',7]],timeline_draft:null,notes:'교사 메모'};
  await store.saveVideo(video,['테스트반']);await store.put('students',{id:1,name:'학생',phone:'01011112222',class_name:'테스트반',active:true});
  const teacher=(await post('/api/teacher/login',{code:'2424'})).cookie,student=(await post('/api/login',{phone:'01011112222'})).cookie;
  const data={id:video.id,captions:subtitles,source:'file'};
  assert.equal((await post('/api/teacher/timeline/analyze',data,student)).status,401);
  const result=await post('/api/teacher/timeline/analyze',data,teacher);assert.equal(result.status,200);assert.equal(result.data.rows.length,2);
  const current=(await store.all('videos',{id:video.id}))[0];assert.deepEqual(current.timeline,video.timeline);assert.equal(current.notes,video.notes);assert.equal(current.published,true);
  const list=await (await fetch(cfg.origin+'/api/videos',{headers:{Cookie:student}})).json();assert.deepEqual(list.videos[0].timeline,video.timeline);assert.ok(!JSON.stringify(list).includes('evidence'));
  const state=await (await fetch(cfg.origin+'/api/teacher/state',{headers:{Cookie:teacher}})).json();assert.ok(state.videos[0].ai_analysis);assert.ok(!JSON.stringify(state).includes('private-key'));assert.deepEqual(state.settings,{});
  assert.equal((await post('/api/teacher/timeline/analyze',data,teacher)).status,400);assert.equal(aiCalls,1);
  assert.equal((await post('/api/teacher/timeline',{id:video.id,rows:result.data.rows,publish:true},teacher)).status,400);
  changeDuringAnalysis=true;
  assert.equal((await post('/api/teacher/timeline/analyze',{...data,replace_draft:true},teacher)).status,412);
  assert.equal((await store.all('videos',{id:video.id}))[0].timeline_draft[0][0],'9');
  const specialRows=[['잡담1',0,'주말 이야기','00:20',20],['캡쳐구간1',0,'화면 캡처 안내','00:40',40]];
  assert.equal((await post('/api/teacher/timeline',{id:video.id,rows:specialRows,publish:true},teacher)).status,200);
  const published=await (await fetch(cfg.origin+'/api/videos',{headers:{Cookie:student}})).json();assert.deepEqual(published.videos[0].timeline,specialRows);

 }finally{await new Promise(r=>app.close(r));store.close()}
});

test('기존 읽기 권한은 유지하고 자막 연결을 선택할 때만 넓은 권한을 요청한다',async()=>{
 const store=new LocalStore(':memory:'),cfg={origin:'https://example.com',sessionSecret:'test',googleClientId:'id',googleClientSecret:'secret'};
 const yt=new YouTubeConnection(cfg,store,async input=>new URL(input).pathname.endsWith('/captions')?Response.json({items:[{id:'track',snippet:{language:'ko',status:'serving'}}]}):new Response(subtitles));
 try{
  const basic=new URL((await yt.start({digest:'test'})).url);assert.equal(basic.searchParams.get('scope'),'https://www.googleapis.com/auth/youtube.readonly');
  const upgraded=new URL((await yt.start({digest:'test'},{captions:true})).url);assert.ok(upgraded.searchParams.get('scope').includes('youtube.force-ssl'));
  await yt.save({access_token:'private',expires:Date.now()/1000+3600,scopes:[]});await assert.rejects(yt.downloadCaptions('Video000001'),/권한/);
  await yt.save({access_token:'private',expires:Date.now()/1000+3600,scopes:['https://www.googleapis.com/auth/youtube.force-ssl']});assert.equal((await yt.downloadCaptions('Video000001')).text,subtitles);
 }finally{store.close()}
});

test('90분 한국어 자막은 240KB를 넘어도 자동 분할하고 원래 시간을 유지한다',async()=>{
 const time=sec=>`${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor(sec/60)%60).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}.000`;
 const long='WEBVTT\n\n'+Array.from({length:5400},(_,i)=>`${time(i)} --> ${time(i+1)}\n${i+1}번 문제를 살펴보자. 이 부분은 계산 과정을 확인하고 다음 풀이로 넘어갈게.\n`).join('\n');
 assert.ok(Buffer.byteLength(long)>240000);assert.equal(parseCaptions(long).length,5400);
 let calls=0,lastId=-1;
 const ai=new TimelineAI({anthropicKey:'test'},async(url,options)=>{
  const cues=JSON.parse(JSON.parse(options.body).messages[0].content).captions;
  assert.ok(cues[0].id>lastId);lastId=cues.at(-1).id;calls++;
  const cue=cues[0];return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[{cue_id:cue.id,number:String(cue.id+1),title:'문제 풀이',evidence:`${cue.id+1}번 문제`,confidence:'high'}]})}],usage:{input_tokens:100,output_tokens:20}});
 });
 const result=await ai.analyze(long,{title:'90분 강의'});
 assert.ok(calls>1);assert.equal(result.chunk_count,calls);assert.equal(result.usage.input_tokens,100*calls);assert.equal(result.rows.length,calls);assert.ok(result.rows.at(-1)[4]>3600);assert.equal(result.cue_count,5400);
 const cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite',anthropicKey:'test'},store=new LocalStore(':memory:');
 const app=createApp(cfg,store,{aiFetch:ai.fetcher});await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=(path,data,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 try{
  await store.saveVideo({id:'LongVideo01',title:'긴 강의',added_at:1,published:true,reviewed:false,timeline:[],timeline_draft:null},['테스트반']);
  const login=await post('/api/teacher/login',{code:'2424'});const cookie=login.headers.get('set-cookie');
  lastId=-1;const payload={id:'LongVideo01',captions:long,source:'file'};assert.ok(Buffer.byteLength(JSON.stringify(payload))>500000);
  const response=await post('/api/teacher/timeline/analyze',payload,cookie);assert.equal(response.status,200);assert.ok((await response.json()).rows.length>1);
 }finally{await new Promise(r=>app.close(r));store.close()}
});

test('잡담과 캡쳐구간은 문제 번호와 분리하고 영상 전체에서 각각 순번을 붙인다',async()=>{
 const cues=[
  {id:0,start:1,text:'1번 문제를 풀자'},
  {id:1,start:20,text:'어제 선생님이 길을 잘못 들어서 말이야'},
  {id:2,start:35,text:'지금 캡처 구간이야'},
  {id:3,start:60,text:'다른 이야긴데 주말에 있었던 일이야'},
  {id:4,start:90,text:'여기 캡쳐해 둬'},
  {id:5,start:100,text:'다음 문제를 보자'}
 ];
 const item=(i,kind,number=null)=>({cue_id:i,kind,number,title:'구간 설명',evidence:cues[i].text,confidence:'high'});
 const items=[item(0,'problem','1'),item(1,'smalltalk'),item(2,'capture'),item(3,'smalltalk'),item(4,'capture'),item(5,'problem')];
 const result=validateAnalysis({items},cues);
 assert.deepEqual(result.rows.map(r=>r[0]),['1','잡담1','캡쳐구간1','잡담2','캡쳐구간2','번호 확인 필요']);assert.equal(result.needs_check,1);
 assert.throws(()=>validateAnalysis({items:[{...item(1,'smalltalk'),number:'2'}]},cues));
 assert.throws(()=>validateAnalysis({items:[item(1,'capture')]},cues));
 assert.throws(()=>validateAnalysis({items:[item(1,'unknown')]},cues));
 const time=sec=>`00:${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}.000`;
 const long='WEBVTT\n\n'+Array.from({length:2400},(_,i)=>`${time(i)} --> ${time(i+1)}\n다른 이야긴데 주말에 있었던 일을 말할게. 여기 캡처해 둬. 자막 구간을 나누어도 영상 전체의 순번은 이어져야 해.\n`).join('\n');
 let calls=0;
 const ai=new TimelineAI({anthropicKey:'test'},async(url,options)=>{
  calls++;const captions=JSON.parse(JSON.parse(options.body).messages[0].content).captions;
  const items=[{cue_id:captions[0].id,kind:'smalltalk',number:null,title:'주말 이야기',evidence:'다른 이야긴데',confidence:'high'},{cue_id:captions.at(-1).id,kind:'capture',number:null,title:'화면 캡처 안내',evidence:'여기 캡처해 둬',confidence:'high'}];
  return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items})}]});
 });
 const full=await ai.analyze(long,{});assert.ok(calls>1);
 assert.deepEqual(full.rows.map(r=>r[0]),Array.from({length:calls},(_,i)=>['잡담'+(i+1),'캡쳐구간'+(i+1)]).flat());assert.equal(full.needs_check,0);
});
