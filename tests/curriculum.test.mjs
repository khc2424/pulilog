import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanCurriculum,buildCurriculum} from '../src/curriculum.mjs';
import {daysForSchedule} from '../src/schedules.mjs';
import {summarizeTeachingStyles} from '../src/teaching-style.mjs';
import {createApp} from '../src/server.mjs';
import {LocalStore} from '../src/store.mjs';

const base={class_name:'고1B2',mode:'exam',start_date:'2026-10-26',end_date:'2026-11-01',minutes_per_session:60,topics:[{id:'a',title:'함수',total_minutes:120,done_minutes:30},{id:'b',title:'명제',total_minutes:150,done_minutes:0}],makeup_dates:[],excluded_dates:[],notes:''};
test('실제 수업 요일·휴강·보강을 적용하고 부족한 시간은 숨기지 않는다',()=>{
 const plan=cleanCurriculum(base,['고1B2']);
 const result=buildCurriculum(plan,[1,3,5],'2026-10-26');
 assert.deepEqual(result.sessions.map(s=>s.date),['2026-10-26','2026-10-28','2026-10-30']);
 assert.equal(result.remaining_minutes,240);assert.equal(result.allocated_minutes,180);assert.equal(result.shortage_minutes,60);assert.equal(result.makeup_needed,1);
 assert.equal(result.makeup_candidates[0],'2026-10-27');
 assert.equal(result.sessions[1].items[0].minutes,30);assert.equal(result.sessions[1].items[1].minutes,30);
 const makeup=buildCurriculum({...plan,makeup_dates:['2026-10-27'],excluded_dates:['2026-10-28']},[1,3,5],'2026-10-26');
 assert.deepEqual(makeup.sessions.map(s=>s.date),['2026-10-26','2026-10-27','2026-10-30']);assert.ok(makeup.sessions[1].makeup);
 const conflict=buildCurriculum({...plan,makeup_dates:['2026-10-27'],excluded_dates:['2026-10-27']},[1,3,5],'2026-10-26');assert.ok(!conflict.sessions.some(s=>s.date==='2026-10-27'));
 const late=buildCurriculum(plan,[1,3,5],'2026-10-29');assert.equal(late.sessions.length,1);assert.equal(late.shortage_minutes,180);
 const full=buildCurriculum({...plan,topics:plan.topics.map(t=>({...t,done_minutes:t.total_minutes}))},[1,3,5],'2026-10-26');assert.equal(full.shortage_minutes,0);assert.equal(full.sessions[0].free_minutes,60);
 assert.deepEqual(daysForSchedule('days:6,7'),[6,7]);assert.deepEqual(daysForSchedule('MWF'),[1,3,5]);
});
test('잘못된 날짜·완료량·단원 중복과 등록되지 않은 반은 거부한다',()=>{
 for(const changed of [{class_name:'다른반'},{start_date:'2026-02-30'},{minutes_per_session:0},{end_date:'2028-01-01'},{topics:[{id:'a',title:'단원',total_minutes:30,done_minutes:31}]},{makeup_dates:['2026-12-01']},{topics:[base.topics[0],base.topics[0]]}])assert.throws(()=>cleanCurriculum({...base,...changed},['고1B2']));
});
test('수업 유형은 근거가 있을 때만 집계하고 한 영상의 발언 수로 다른 영상을 압도하지 않는다',()=>{
 assert.ok(summarizeTeachingStyles([]).every(a=>a.result==='분석 전'&&a.left_percent===null));
 const left=Array.from({length:30},()=>({axis:'participation',video_id:'a',direction:'left',confidence:'high',evidence:['근거']}));
 const result=summarizeTeachingStyles([...left,{axis:'participation',video_id:'b',direction:'right',confidence:'high',evidence:['근거']},{axis:'starting_point',video_id:'c',direction:'right',confidence:'high',evidence:[]}]);
 assert.equal(result[1].left_percent,50);assert.equal(result[1].result,'혼합형');assert.equal(result[1].lesson_count,2);assert.equal(result[0].lesson_count,0);
});
test('커리큘럼은 반별로 저장하고 학생 비공개·동시 수정 방지·진도 재배분을 유지한다',async()=>{
 const store=new LocalStore(':memory:'),cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite'};
 const app=createApp(cfg,store);await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=async(path,data,cookie)=>{const response=await fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')}};
 try{
  await store.put('classes',{name:'고1B2',schedule:'MWF'});
  const teacher=(await post('/api/teacher/login',{code:'2424'})).cookie;
  assert.equal((await post('/api/teacher/curriculum/save',base)).status,401);
  assert.equal((await post('/api/teacher/curriculum/preview',base,teacher)).status,200);assert.equal((await store.all('settings')).length,0);
  const saved=await post('/api/teacher/curriculum/save',base,teacher);assert.equal(saved.status,200);assert.equal(saved.data.plan.revision,1);
  assert.equal((await post('/api/teacher/curriculum/save',base,teacher)).status,412);
  assert.equal((await post('/api/teacher/curriculum/progress',{class_name:'고1B2',revision:1,topic_id:'a',done_minutes:120,note:'빠르게 완료'},teacher)).status,200);
  const state=await (await fetch(cfg.origin+'/api/teacher/state',{headers:{Cookie:teacher}})).json();assert.equal(state.curricula.length,1);assert.equal(state.curricula[0].topics[0].done_minutes,120);assert.equal(state.curricula[0].revision,2);assert.deepEqual(state.settings,{});assert.equal(state.teaching_styles.length,4);
 }finally{await new Promise(r=>app.close(r));store.close()}
});
