import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classKey,canonicalClassName,mergeClassAliases} from '../src/classes.mjs';
import {LocalStore} from '../src/store.mjs';
import {classifyYouTubeTitle} from '../src/youtube.mjs';

test('반 이름은 띄어쓰기·대소문자를 무시하고 기존 이름을 재사용한다',()=>{
 assert.equal(classKey(' 중3 d4 '),'중3D4');
 assert.equal(canonicalClassName('중3 d4',['중3 D4','중3D4']),'중3D4');
 assert.equal(canonicalClassName('고1 b2',['고1B2']),'고1B2');
 assert.equal(canonicalClassName('중3 D4',['중3D5']),'중3D4');
 assert.equal(classifyYouTubeTitle('중3 d4 쎈 수학1 [1] 다항식 #1',['중3 D4','중3D4']).class_name,'중3D4');
});

test('같은 반 통합은 학생·영상·즐겨찾기·수업 요일을 유지하고 중복 배정만 합친다',async()=>{
 const store=new LocalStore(':memory:');
 try{
  await store.put('classes',{name:'중3D4',schedule:'MW'});
  await store.put('classes',{name:'중3 D4',schedule:''});
  await store.put('students',{id:1,name:'학생',phone:'01011112222',active:true,class_name:'중3 D4'});
  await store.saveVideo({id:'MergeTest01',title:'수업',class_name:'중3 D4',timeline:[['1',1,'개념','00:10',10]],notes:'메모',published:true},['중3 D4','중3D4']);
  await store.put('favorites',{student_id:1,video_id:'MergeTest01'});
  const result=await mergeClassAliases(store,'중3 d4');
  assert.equal(result.name,'중3D4');assert.deepEqual(result.merged,['중3 D4']);
  assert.deepEqual(await store.all('classes'),[{name:'중3D4',schedule:'MW'}]);
  assert.equal((await store.all('students'))[0].class_name,'중3D4');
  assert.deepEqual(await store.all('video_classes'),[{video_id:'MergeTest01',class_name:'중3D4'}]);
  const video=(await store.all('videos'))[0];assert.equal(video.class_name,'중3D4');assert.equal(video.notes,'메모');assert.equal(video.timeline.length,1);assert.equal(video.published,true);
  assert.equal((await store.all('favorites')).length,1);
  assert.deepEqual((await mergeClassAliases(store,'중3D4')).merged,[]);
 }finally{store.close()}
});
