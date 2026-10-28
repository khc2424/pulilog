import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TimelineAI,parseCaptions,validateAnalysis,reconcileAnalysis} from '../src/timeline-ai.mjs';
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
 const result=validateAnalysis(answer,cues);assert.equal(result.rows[0][4],1);assert.equal(result.rows[1][0],'번호 확인 필요');assert.equal(result.needs_check,1);assert.equal(result.rows[0][2],'1번 · 거리의 최솟값');assert.equal(result.rows[1][2],'다음 문제 풀이');
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
  assert.equal((await post('/api/teacher/timeline',{id:video.id,rows:result.data.rows,publish:true},teacher)).status,200);
  changeDuringAnalysis=true;
  assert.equal((await post('/api/teacher/timeline/analyze',{...data,captions:subtitles.replace('보자.','다시 보자.'),replace_draft:true},teacher)).status,412);
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
  const payload=JSON.parse(JSON.parse(options.body).messages[0].content),cues=payload.captions;
  assert.ok(payload.range.first_cue_id>lastId);lastId=payload.range.last_cue_id;calls++;
  const cue=cues.find(c=>c.id===payload.range.first_cue_id);return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[{cue_id:cue.id,number:String(cue.id+1),title:'문제 풀이',evidence:`${cue.id+1}번 문제`,confidence:'high'}]})}],usage:{input_tokens:100,output_tokens:20}});
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
 assert.deepEqual(result.rows.map(r=>r[0]),['1','잡담1','캡쳐구간1','잡담2','캡쳐구간2','번호 확인 필요']);assert.equal(result.needs_check,0);
 assert.throws(()=>validateAnalysis({items:[{...item(1,'smalltalk'),number:'2'}]},cues));
 assert.throws(()=>validateAnalysis({items:[item(1,'capture')]},cues));
 assert.throws(()=>validateAnalysis({items:[item(1,'unknown')]},cues));
 const time=sec=>`00:${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}.000`;
 const long='WEBVTT\n\n'+Array.from({length:2400},(_,i)=>`${time(i)} --> ${time(i+1)}\n다른 이야긴데 주말에 있었던 일을 말할게. 여기 캡처해 둬. 자막 구간을 나누어도 영상 전체의 순번은 이어져야 해.\n`).join('\n');
 let calls=0;
 const ai=new TimelineAI({anthropicKey:'test'},async(url,options)=>{
  calls++;const payload=JSON.parse(JSON.parse(options.body).messages[0].content),captions=payload.captions.filter(c=>c.id>=payload.range.first_cue_id&&c.id<=payload.range.last_cue_id);
  const items=[{cue_id:captions[0].id,kind:'smalltalk',number:null,title:'주말 이야기',evidence:'다른 이야긴데',confidence:'high'},{cue_id:captions.at(-1).id,kind:'capture',number:null,title:'화면 캡처 안내',evidence:'여기 캡처해 둬',confidence:'high'}];
  return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items})}]});
 });
 const full=await ai.analyze(long,{});assert.ok(calls>1);
 assert.deepEqual(full.rows.map(r=>r[0]),Array.from({length:calls},(_,i)=>['잡담'+(i+1),'캡쳐구간'+(i+1)]).flat());assert.equal(full.needs_check,0);
});

test('인접 자막에 걸친 원문과 문장부호를 맞추되 먼 시각·다른 숫자·없는 인용은 허용하지 않는다',()=>{
 const cues=[{id:0,start:10,end:12,text:'자, 12번 문제를'},{id:1,start:12,end:14,text:'이제 풀어 보자.'},{id:2,start:100,end:102,text:'이제 풀어 보자.'},{id:3,start:103,end:105,text:'1.2번 문제야'}];
 const item={cue_id:0,kind:'problem',number:'12',title:'문제 풀이',evidence:'12번 문제를 이제 풀어 보자',confidence:'high'};
 let checked=reconcileAnalysis({items:[item]},cues);assert.equal(checked.items.length,1);assert.equal(checked.aligned_count,1);assert.equal(checked.items[0].confidence,'medium');
 const result=validateAnalysis({items:checked.items},cues);assert.equal(result.rows[0][4],10);assert.equal(result.needs_check,1);assert.ok(result.evidence[0].text.includes('이제 풀어 보자.'));
 checked=reconcileAnalysis({items:[{...item,evidence:'자 12번 문제를'}]},cues);assert.equal(checked.items.length,1);
 checked=reconcileAnalysis({items:[{...item,cue_id:1,evidence:'자 12번 문제를'}]},cues);assert.equal(checked.items[0].cue_id,0);
 for(const changed of [{cue_id:999},{cue_id:0,evidence:'이제 풀어 보자'},{cue_id:3,evidence:'12번 문제야'},{evidence:'원문을 새로 만들어 낸 문장'}]){
  const rejected=reconcileAnalysis({items:[{...item,...changed}]},cues);
  if(changed.cue_id===0&&changed.evidence==='이제 풀어 보자'){assert.equal(rejected.items[0].cue_id,1);continue}
  assert.equal(rejected.items.length,0);assert.equal(rejected.skipped_count,1);
 }
 const far=reconcileAnalysis({items:[{...item,cue_id:2,evidence:'자 12번 문제를'}]},cues);assert.equal(far.items.length,0);
});

test('일부 근거 오류는 제외 개수와 함께 반환하고 전부 잘못되면 결과를 저장하지 않는다',async()=>{
 const invalid={...answer.items[0],evidence:'자막에 없는 문장'};
 const ai=new TimelineAI({anthropicKey:'test'},async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[invalid,answer.items[1]]})}]}));
 const result=await ai.analyze(subtitles,{});assert.equal(result.rows.length,1);assert.equal(result.skipped_count,1);assert.equal(result.rows[0][4],35);
 const bad=new TimelineAI({anthropicKey:'test'},async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[invalid]})}]}));
 await assert.rejects(bad.analyze(subtitles,{}),/자막과 일치하는 근거/);assert.equal(bad.busy,false);
});

test('응답 길이 제한은 해당 구간만 둘로 나누고 완료한 구간과 분할 정보는 다음 시도에서 재사용한다',async()=>{
 const source='WEBVTT\n\n'+[0,1,2,3].map(i=>`00:00:${String(i*10).padStart(2,'0')}.000 --> 00:00:${String(i*10+5).padStart(2,'0')}.000\n${i+1}번 문제를 풀어 보자\n`).join('\n'),cache=new Map();let calls=0,failRight=true;
 const fetcher=async(url,opts)=>{calls++;const payload=JSON.parse(JSON.parse(opts.body).messages[0].content),range=payload.range;
  if(range.last_cue_id-range.first_cue_id>=3)return Response.json({stop_reason:'max_tokens',content:[{type:'text',text:'잘린 JSON'}],usage:{input_tokens:10,output_tokens:8000}});
  if(range.first_cue_id===2&&failRight)return new Response('',{status:503});
  const cue=payload.captions.find(c=>c.id===range.first_cue_id);return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[{cue_id:cue.id,kind:'problem',number:String(cue.id+1),title:'문제 풀이',evidence:cue.text,confidence:'high'}]})}],usage:{input_tokens:10,output_tokens:30}});
 };
 await assert.rejects(new TimelineAI({anthropicKey:'test'},fetcher,{cache}).analyze(source,{id:'video'}),/모델 설정/);assert.equal(calls,3);assert.equal([...cache.values()].filter(v=>v.kind==='complete').length,1);
 failRight=false;const result=await new TimelineAI({anthropicKey:'test'},fetcher,{cache}).analyze(source,{id:'video'});assert.equal(calls,4);assert.deepEqual(result.rows.map(r=>r[4]),[0,20]);assert.equal(result.cached_chunk_count,1);assert.equal(result.api_calls,1);assert.equal(result.usage.output_tokens,30);
 const cached=await new TimelineAI({anthropicKey:'test'},fetcher,{cache}).analyze(source,{id:'video'});assert.equal(calls,4);assert.equal(cached.api_calls,0);assert.equal(cached.cached_chunk_count,2);assert.equal(cached.usage,null);
});
test('모델 거절은 유료 호출을 자동 반복하지 않고 중단 사유를 구분한다',async()=>{
 let calls=0;const ai=new TimelineAI({anthropicKey:'test'},async()=>{calls++;return Response.json({stop_reason:'refusal'})});await assert.rejects(ai.analyze(subtitles,{}),/분석을 거절/);assert.equal(calls,1);assert.equal(ai.busy,false);
});
test('자막 분할은 시간·문자량·항목수 제한을 지키며 원래 시간과 문맥 범위를 유지한다',async()=>{
 const {captionChunks}=await import('../src/timeline-ai.mjs');const cues=Array.from({length:10},(_,id)=>({id,start:id*300,end:id*300+10,text:'설명'})),chunks=captionChunks(cues,{maxSeconds:600,maxCues:3,maxBytes:10000});assert.equal(chunks.length,5);assert.deepEqual(chunks.flat().map(c=>c.id),cues.map(c=>c.id));assert.ok(chunks.every(c=>c.at(-1).start-c[0].start<600));
 const store=new LocalStore(':memory:');try{await store.put('settings',{key:'youtube_timeline_chunk_example',value:{kind:'complete',items:[]}});assert.equal((await store.all('settings')).length,0);assert.equal((await store.all('settings',{key:'youtube_timeline_chunk_example'})).length,1)}finally{store.close()}
});

test('서버를 재시작해도 완료 구간을 재사용하고 전체 성공 전에는 초안을 저장하지 않는다',async()=>{
 const store=new LocalStore(':memory:'),cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite',anthropicKey:'test'},source='WEBVTT\n\n'+[0,1,2,3].map(i=>`00:00:${String(i*10).padStart(2,'0')}.000 --> 00:00:${String(i*10+5).padStart(2,'0')}.000\n${i+1}번 문제 풀이\n`).join('\n');let failRight=true,calls=0;
 const fetcher=async(url,opts)=>{calls++;const p=JSON.parse(JSON.parse(opts.body).messages[0].content);if(p.range.last_cue_id-p.range.first_cue_id>=3)return Response.json({stop_reason:'max_tokens'});if(p.range.first_cue_id===2&&failRight)return new Response('',{status:503});const cue=p.captions.find(c=>c.id===p.range.first_cue_id);return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[{cue_id:cue.id,kind:'problem',number:String(cue.id+1),title:'문제 설명',evidence:cue.text,confidence:'high'}]})}]})};
 let app=createApp(cfg,store,{aiFetch:fetcher});const listen=async()=>{await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`};await listen();
 const post=(path,body,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 try{
  await store.saveVideo({id:'ResumeVid01',title:'수업',timeline:[],timeline_draft:null,published:true,added_at:1},['반']);const cookie=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie');const input={id:'ResumeVid01',captions:source,source:'file'};
  assert.equal((await post('/api/teacher/timeline/analyze',input,cookie)).status,400);assert.equal((await store.all('videos',{id:input.id}))[0].timeline_draft,null);assert.equal(calls,3);assert.equal((await store.settingsPrefix('youtube_timeline_chunk_')).length,2);
  await new Promise(r=>app.close(r));failRight=false;app=createApp(cfg,store,{aiFetch:fetcher});await listen();const response=await post('/api/teacher/timeline/analyze',input,cookie);assert.equal(response.status,200);const data=await response.json();assert.equal(data.analysis.cached_chunk_count,1);assert.equal(data.analysis.api_calls,1);assert.equal(calls,4);assert.deepEqual(data.rows.map(r=>r[4]),[0,20]);
 }finally{await new Promise(r=>app.close(r));store.close()}
});
