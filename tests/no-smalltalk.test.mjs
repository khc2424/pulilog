import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {LocalStore} from '../src/store.mjs';
test('기존 잡담은 선생님만 제거하고 초안·공개 타임라인의 나머지 내용과 상태를 보존한다',async()=>{
 const store=new LocalStore(':memory:'),cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite'},app=createApp(cfg,store);await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=(path,data,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{Origin:cfg.origin,'X-AXIS-Request':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 const problem=['1',0,'잡담을 예시로 설명한 수학 문제','00:01',1],talk=['잡담 2',0,'주말 이야기','00:20',20],capture=['캡쳐구간1',0,'화면 캡처 안내','00:40',40];
 try{await store.saveVideo({id:'Video000001',title:'강의',timeline:[problem,talk,capture],timeline_draft:[talk,capture],reviewed:false,published:true,added_at:1},['A']);assert.equal((await post('/api/teacher/timeline/remove-smalltalk',{})).status,401);
 const cookie=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie');const result=await (await post('/api/teacher/timeline/remove-smalltalk',{},cookie)).json();assert.equal(result.removed,2);const v=(await store.all('videos'))[0];assert.deepEqual(v.timeline,[problem,capture]);assert.deepEqual(v.timeline_draft,[capture]);assert.equal(v.reviewed,false);assert.equal(v.published,true);assert.equal((await (await post('/api/teacher/timeline/remove-smalltalk',{},cookie)).json()).removed,0);
 }finally{await new Promise(r=>app.close(r));store.close()}
});
