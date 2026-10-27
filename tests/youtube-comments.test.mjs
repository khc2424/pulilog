import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timelineCommentText,YouTubeTimelineComments} from '../src/youtube-comments.mjs';
import {LocalStore} from '../src/store.mjs';
import {YouTubeConnection} from '../src/youtube.mjs';
import {createApp} from '../src/server.mjs';
const video={id:'Comment0001',title:'수업',timeline:[['',0,'도함수의 활용','01:00',60]]};
const force='https://www.googleapis.com/auth/youtube.force-ssl';
function fixture({disabled=false,owner='owner',timeout=false}={}){
 const store=new LocalStore(':memory:');let comments=[],writes=[];
 const fetcher=async(url,options={})=>{
  const u=new URL(url),path=u.pathname.split('/').at(-1),method=options.method||'GET';
  if(path==='videos')return Response.json({items:[{snippet:{channelId:owner}}]});
  if(method==='GET')return Response.json({items:path==='comments'?comments.filter(c=>c.id===u.searchParams.get('id')):comments.map(c=>({snippet:{topLevelComment:c}}))});
  writes.push({path,method,body:JSON.parse(options.body)});
  if(disabled)return Response.json({error:{errors:[{reason:'commentsDisabled'}]}},{status:403});
  const body=JSON.parse(options.body),text=method==='PUT'?body.snippet.textOriginal:body.snippet.topLevelComment.snippet.textOriginal;
  const comment={id:'own-comment',snippet:{authorChannelId:{value:'owner'},videoId:video.id,textOriginal:text}};comments=[comment];
  if(timeout)throw new Error('ambiguous transport timeout');
  return Response.json(method==='PUT'?comment:{snippet:{topLevelComment:comment}});
 };
 const youtube={read:async()=>({scopes:[force],channel:{id:'owner'}}),access:async()=> 'private',api:async(path,params,token)=>fetcher('https://www.googleapis.com/youtube/v3/'+path+'?'+new URLSearchParams(params)).then(r=>r.json()),fetcher};
 return {store,youtube,sync:new YouTubeTimelineComments(store,youtube),writes,get comments(){return comments}};
}
test('댓글은 검토한 시간·설명만 사용하고 번호 중복·불확실 번호·동일 시각을 정리한다',()=>{
 const text=timelineCommentText([['1',20,'1번 도함수','00:30',30],['번호 확인 필요',30,'함수 그래프','00:30',30],['',0,'마무리','1:01:02',3662]]);
 assert.equal(text,'[풀이로그 수업 타임라인]\n\n00:00 강의 시작\n00:30 1번 도함수 / 함수 그래프\n1:01:02 마무리');
 assert.throws(()=>timelineCommentText([]),/타임라인이 없어/);assert.throws(()=>timelineCommentText([['',0,'긴 설명'.repeat(4000),'00:00',0]]),/길이 제한/);
});
test('첫 검토는 댓글 하나, 재검토는 같은 댓글 수정, 같은 내용은 재게시하지 않는다',async()=>{
 const f=fixture();try{await f.sync.sync(video);await f.sync.sync(video);await f.sync.sync({...video,timeline:[['',0,'수정한 설명','00:10',10]]});assert.deepEqual(f.writes.map(r=>r.method),['POST','PUT']);assert.equal(f.comments.length,1);assert.match(f.comments[0].snippet.textOriginal,/수정한 설명/)}finally{f.store.close()}
});
test('게시 응답이 끊기거나 저장 ID가 없어도 본인 채널의 기존 풀이로그 댓글을 찾아 중복을 막는다',async()=>{
 const f=fixture({timeout:true});try{await assert.rejects(f.sync.sync(video),/응답이 지연/);await f.sync.sync(video);assert.equal(f.writes.length,1);assert.equal((await f.sync.setting(video.id)).status,'done');await f.store.del('settings',{key:'youtube_timeline_comment_'+video.id});await f.sync.sync(video);assert.equal(f.writes.length,1)}finally{f.store.close()}
});
test('다른 채널 영상은 쓰기를 차단하고 댓글 꺼짐은 실패 상태로 보존한다',async()=>{
 for(const options of [{owner:'other'},{disabled:true}]){const f=fixture(options);try{await assert.rejects(f.sync.sync(video),options.owner?/본인 채널/:/댓글 사용이 꺼져/);assert.equal(f.writes.length,options.owner?0:1);assert.equal((await f.sync.setting(video.id)).status,'failed')}finally{f.store.close()}}
});
test('자동 댓글은 검토 완료에서만 실행하며 실패해도 학생 타임라인은 저장하고 API 권한을 보호한다',async()=>{
 const cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite',googleClientId:'id',googleClientSecret:'secret'},f=fixture({disabled:true}),app=createApp(cfg,f.store,{youtubeFetch:f.youtube.fetcher});
 const yt=new YouTubeConnection(cfg,f.store);await yt.save({access_token:'private',expires:Date.now()/1000+3600,scopes:[force],channel:{id:'owner'}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=(path,body,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 try{
  await f.store.saveVideo({...video,timeline:[],timeline_draft:null,published:true,reviewed:false,added_at:1},['반']);
  const teacher=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie');
  assert.equal((await post('/api/teacher/youtube/timeline-comment',{id:video.id})).status,401);
  await post('/api/teacher/youtube/timeline-comments-setting',{enabled:true},teacher);
  await post('/api/teacher/timeline',{id:video.id,rows:video.timeline,publish:false},teacher);assert.equal(f.writes.length,0);
  const result=await (await post('/api/teacher/timeline',{id:video.id,rows:video.timeline,publish:true},teacher)).json();assert.equal(result.ok,true);assert.equal(result.youtube_comment.ok,false);assert.equal(f.writes.length,1);assert.deepEqual((await f.store.all('videos',{id:video.id}))[0].timeline,video.timeline);
  await post('/api/teacher/youtube/timeline-comments-setting',{enabled:false},teacher);await post('/api/teacher/timeline',{id:video.id,rows:video.timeline,publish:true},teacher);assert.equal(f.writes.length,1);
 }finally{await new Promise(r=>app.close(r));f.store.close()}
});
