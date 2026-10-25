import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('영상 행의 빈 공간은 선택하고 버튼·체크박스·텍스트 선택은 별도로 처리한다',async()=>{
 const source=await readFile(new URL('../public/teacher.js',import.meta.url),'utf8');
 const action=source.slice(source.indexOf('function bindTeacherVideoRowSelection('),source.indexOf('function bindTeacherPage('));
 let clicks=0,selection='';
 const context={window:{getSelection:()=>({toString:()=>selection})}};
 runInNewContext(action,context);
 const row={querySelector:()=>({click:()=>{clicks++}})};
 context.bindTeacherVideoRowSelection(row);
 row.onclick({target:{closest:()=>null}});assert.equal(clicks,1);
 row.onclick({target:{closest:()=>({tagName:'BUTTON'})}});assert.equal(clicks,1);
 row.onclick({target:{closest:()=>({tagName:'INPUT'})}});assert.equal(clicks,1);
 selection='선택한 제목';row.onclick({target:{closest:()=>null}});assert.equal(clicks,1);
});

test('영상 삭제는 확인 전 요청하지 않고 취소·실패·성공 상태를 처리한다',async()=>{
 const source=await readFile(new URL('../public/teacher.js',import.meta.url),'utf8');
 const action=source.slice(source.indexOf('function confirmTeacherVideoDelete('),source.indexOf('function timeToSeconds('));
 const nodes=Object.fromEntries(['video-delete-cancel','video-delete-confirm','video-delete-error'].map(id=>['#'+id,{disabled:false,textContent:'',checked:true}]));
 let html='',closed=0,renders=0,fail=false;const calls=[];
 const context={
  selectedTeacherVideoIds:new Set(),selectedCourseId:'EeNDcFziKIQ',timelineDrafts:{EeNDcFziKIQ:[1]},managedData:{videos:[{id:'EeNDcFziKIQ',title:'삭제 확인용',classes:['A반']}]},
  teacherVideo:id=>context.managedData.videos.find(v=>v.id===id),videoGroups:v=>v.classes,esc:String,
  openModal:value=>{html=value},closeModal:()=>{closed++},$:id=>nodes[id],render:()=>{renders++},toast:()=>{},refreshTeacher:async()=>{},
  requestAPI:async(path,body)=>{calls.push({path,body:JSON.parse(JSON.stringify(body))});if(fail)throw new Error('연결 확인')}
 };
 runInNewContext(action,context);
 context.confirmTeacherVideoDelete('EeNDcFziKIQ');
 assert.equal(calls.length,0);assert.ok(html.includes('삭제 확인용'));assert.ok(html.includes('A반'));assert.ok(!html.includes('video-delete-exclude'));assert.ok(html.includes('유튜브 원본은 유지'));
 nodes['#video-delete-cancel'].onclick();assert.equal(closed,1);assert.equal(context.managedData.videos.length,1);
 context.confirmTeacherVideoDelete('EeNDcFziKIQ');fail=true;
 await nodes['#video-delete-confirm'].onclick({currentTarget:nodes['#video-delete-confirm']});
 assert.equal(context.managedData.videos.length,1);assert.equal(nodes['#video-delete-error'].textContent,'연결 확인');assert.equal(nodes['#video-delete-confirm'].disabled,false);
 fail=false;await nodes['#video-delete-confirm'].onclick({currentTarget:nodes['#video-delete-confirm']});
 assert.deepEqual(calls.at(-1),{path:'/api/teacher/videos/delete',body:{ids:['EeNDcFziKIQ'],execute:true}});
 assert.equal(context.managedData.videos.length,0);assert.equal(context.selectedCourseId,null);assert.equal(context.timelineDrafts.EeNDcFziKIQ,undefined);assert.equal(renders,1);
 context.managedData.videos=[{id:'a',title:'첫 강의',classes:['A반']},{id:'b',title:'둘째 강의',classes:['B반']},{id:'c',title:'유지 강의',classes:[]}];
 context.selectedTeacherVideoIds.add('a');context.selectedTeacherVideoIds.add('b');
 context.confirmTeacherVideosDelete(['a','b','a','없는영상']);
 assert.ok(html.includes('2개 영상을 삭제할까요?'));assert.ok(html.includes('첫 강의'));assert.ok(html.includes('둘째 강의'));assert.ok(!html.includes('유지 강의'));
 fail=true;await nodes['#video-delete-confirm'].onclick({currentTarget:nodes['#video-delete-confirm']});
 assert.equal(context.managedData.videos.length,3);assert.equal(context.selectedTeacherVideoIds.size,2);
 fail=false;await nodes['#video-delete-confirm'].onclick({currentTarget:nodes['#video-delete-confirm']});
 assert.deepEqual(calls.at(-1).body,{ids:['a','b'],execute:true});
 assert.equal(context.managedData.videos.length,1);assert.equal(context.managedData.videos[0].id,'c');assert.equal(context.selectedTeacherVideoIds.size,0);
});
