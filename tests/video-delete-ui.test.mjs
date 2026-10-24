import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('영상 삭제는 확인 전 요청하지 않고 취소·실패·성공 상태를 처리한다',async()=>{
 const source=await readFile(new URL('../public/teacher.js',import.meta.url),'utf8');
 const action=source.slice(source.indexOf('function confirmTeacherVideoDelete('),source.indexOf('function timeToSeconds('));
 const nodes=Object.fromEntries(['video-delete-cancel','video-delete-confirm','video-delete-error','video-delete-exclude'].map(id=>['#'+id,{disabled:false,textContent:'',checked:true}]));
 let html='',closed=0,renders=0,fail=false;const calls=[];
 const context={
  selectedCourseId:'EeNDcFziKIQ',timelineDrafts:{EeNDcFziKIQ:[1]},managedData:{videos:[{id:'EeNDcFziKIQ',title:'삭제 확인용',classes:['A반']}]},
  teacherVideo:id=>context.managedData.videos.find(v=>v.id===id),videoGroups:v=>v.classes,esc:String,
  openModal:value=>{html=value},closeModal:()=>{closed++},$:id=>nodes[id],render:()=>{renders++},toast:()=>{},refreshTeacher:async()=>{},
  requestAPI:async(path,body)=>{calls.push({path,body:JSON.parse(JSON.stringify(body))});if(fail)throw new Error('연결 확인')}
 };
 runInNewContext(action,context);
 context.confirmTeacherVideoDelete('EeNDcFziKIQ');
 assert.equal(calls.length,0);assert.ok(html.includes('삭제 확인용'));assert.ok(html.includes('A반'));assert.ok(html.includes('유튜브 원본은 유지'));
 nodes['#video-delete-cancel'].onclick();assert.equal(closed,1);assert.equal(context.managedData.videos.length,1);
 context.confirmTeacherVideoDelete('EeNDcFziKIQ');fail=true;
 await nodes['#video-delete-confirm'].onclick({currentTarget:nodes['#video-delete-confirm']});
 assert.equal(context.managedData.videos.length,1);assert.equal(nodes['#video-delete-error'].textContent,'연결 확인');assert.equal(nodes['#video-delete-confirm'].disabled,false);
 fail=false;nodes['#video-delete-exclude'].checked=false;await nodes['#video-delete-confirm'].onclick({currentTarget:nodes['#video-delete-confirm']});
 assert.deepEqual(calls.at(-1),{path:'/api/teacher/videos/delete',body:{ids:['EeNDcFziKIQ'],execute:true,exclude_from_import:false}});
 assert.equal(context.managedData.videos.length,0);assert.equal(context.selectedCourseId,null);assert.equal(context.timelineDrafts.EeNDcFziKIQ,undefined);assert.equal(renders,1);
});
