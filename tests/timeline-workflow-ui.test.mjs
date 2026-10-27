import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('작업 제목은 타임라인 편집으로 연결하고 빈 화면 캐시는 갱신하되 미저장 편집은 보존한다',async()=>{
 const source=await readFile(new URL('../public/timeline-batch.js',import.meta.url),'utf8');
 const action=source.slice(source.indexOf('function bindTimelineJobActions('),source.indexOf('async function refreshTimelineBatch('));
 const button={disabled:false,dataset:{batchOpen:'video'}};let refreshed=0,renders=0,remembered=0;
 const context={document:{querySelector:()=>null,querySelectorAll:s=>s==='[data-batch-open]'?[button]:[]},timelineDrafts:{video:[]},timelineDirtyIds:new Set(),refreshTeacher:async()=>{refreshed++},teacherVideo:()=>({id:'video'}),rememberTeacherCourseReturn:()=>{remembered++},render:()=>{renders++},toast:()=>{}};
 runInNewContext(action,context);context.bindTimelineJobActions();await button.onclick();assert.equal(context.courseTab,'timeline');assert.equal(context.selectedCourseId,'video');assert.equal(context.timelineDrafts.video,undefined);assert.equal(refreshed,1);assert.equal(remembered,1);
 context.timelineDirtyIds.add('video');context.timelineDrafts.video=[['未保存']];await button.onclick();assert.equal(context.timelineDrafts.video[0][0],'未保存');assert.equal(renders,2);
});

test('검토 완료는 저장 성공 후 목록으로 돌아가고 작업을 숨기며 임시 저장과 오류는 편집 화면을 유지한다',async()=>{
 const source=await readFile(new URL('../public/teacher.js',import.meta.url),'utf8');
 const action=source.slice(source.indexOf('async function saveTeacherTimeline('),source.indexOf('function timeToSeconds('));
 let returned=0,renders=0,fail=false;const calls=[],status={textContent:''};
 const context={selectedCourseId:'video',readTimelineRows:()=>[['',0,'설명','00:10',10]],timelineDrafts:{video:[1]},timelineDirtyIds:new Set(['video']),timelineBatchJobs:[{video_id:'video'},{video_id:'other'}],requestAPI:async(path,data)=>{calls.push(data);if(fail)throw new Error('저장 실패')},refreshTeacher:async()=>{},returnFromTeacherCourse:()=>{returned++},render:()=>{renders++},toast:()=>{},$:()=>status};
 runInNewContext(action,context);
 await context.saveTeacherTimeline('draft');assert.equal(returned,0);assert.equal(renders,1);assert.equal(context.timelineBatchJobs.length,2);assert.equal(calls.at(-1).publish,false);
 fail=true;await context.saveTeacherTimeline('publish');assert.equal(returned,0);assert.equal(context.timelineBatchJobs.length,2);assert.equal(status.textContent,'저장 실패');
 fail=false;await context.saveTeacherTimeline('publish');assert.equal(returned,1);assert.equal(context.timelineBatchJobs.length,1);assert.equal(context.timelineBatchJobs[0].video_id,'other');assert.equal(calls.at(-1).publish,true);
});

test('강의 영상 팝업은 전용 레이아웃과 별도 타임라인 스크롤 영역을 사용한다',async()=>{
 const source=await readFile(new URL('../public/accounts.js',import.meta.url),'utf8');
 const action=source.slice(source.indexOf('async function openCourse('),source.indexOf("document.addEventListener('click'",source.indexOf('async function openCourse(')));
 let html='',layout='';const context={refreshStudent:async()=>{},signedStudent:{id:1},libraryVideos:[{id:'video',title:'강의',book:'교재',subject:'과목',unit:'단원',timeline:[['1',0,'설명','00:10',10]]}],esc:String,timelineDescription:r=>r[2],openModal:(text,kind)=>{html=text;layout=kind},toast:()=>{}};
 runInNewContext(action,context);await context.openCourse('video');assert.equal(layout,'lesson');assert.ok(html.includes('lesson-modal-layout'));assert.ok(html.includes('lesson-main'));assert.ok(html.includes('lesson-timeline-scroll'));assert.equal((html.match(/id="lesson-player"/g)||[]).length,1);assert.equal((html.match(/id="original-video-link"/g)||[]).length,1);
});
