import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
test('학생 기록은 반별 접기와 누적 시간 정렬·전체 학생 순위·접속 없는 학생을 함께 제공한다',async()=>{
 const source=await readFile(new URL('../public/student-records.js',import.meta.url),'utf8');
 const ctx={URLSearchParams,Set,Map,Date,esc:String,normalizeSearch:s=>s.replace(/\s/g,''),managedData:{students:[{id:1,name:'가',class_name:'A'},{id:2,name:'나',class_name:'B'},{id:3,name:'다',class_name:'A'}]},playbackClock:String};
 runInNewContext(source+`\nrecordsData={from:'2026-11-01',to:'2026-11-03',students:[{student_id:1,name:'가',class_name:'A',visits:1,watched_seconds:120,youtube_count:1},{student_id:2,name:'나',class_name:'B',visits:1,watched_seconds:300,youtube_count:0}],visits:[]};`,ctx);
 let html=ctx.recordsBody();assert.ok(html.indexOf('data-record-class="B"')<html.indexOf('data-record-class="A"'));assert.ok(!html.includes('data-record-class="B" open'));assert.equal(ctx.recordsStudentRows().length,3);assert.ok(html.includes('누적 시청 0분 00초'));
 runInNewContext("recordsSort='watch-asc';recordsLayout='all';recordsOpenStudents.add('3');",ctx);html=ctx.recordsBody();assert.ok(!html.includes('data-record-class='));assert.ok(html.indexOf('data-record-student="3"')<html.indexOf('data-record-student="1"'));assert.ok(html.includes('data-record-student="3" open'));
 runInNewContext("recordsSearch='B';",ctx);assert.equal(ctx.recordsStudentRows().length,1);assert.equal(ctx.recordsStudentRows()[0].student_id,2);
});

test('그래프는 시청하지 않은 날도 표시하고 합계·정확한 시간·영상 순위를 제공한다',async()=>{
 const source=await readFile(new URL('../public/student-records.js',import.meta.url),'utf8'),ctx={URLSearchParams,Set,Map,Date,esc:String,normalizeSearch:String,managedData:{students:[]},playbackClock:String};
 runInNewContext(source+`\nrecordsData={from:'2026-11-02',to:'2026-11-04'};`,ctx);
 const student={daily:[{date:'2026-11-02',watched_seconds:60},{date:'2026-11-03',watched_seconds:0},{date:'2026-11-04',watched_seconds:120}],top_videos:[{title:'함수 복습',watched_seconds:120}]},html=ctx.recordWatchChart([student],'student-1');assert.ok(html.includes('3분 00초'));assert.equal((html.match(/data-watch-label=/g)||[]).length,3);assert.ok(html.includes('2026-11-03 · 0분 00초'));assert.ok(html.includes('aria-controls='));assert.ok(ctx.recordTopVideos(student).includes('함수 복습'));assert.ok(ctx.recordWatchChart([],'empty').includes('조회 기간에 사이트 내 시청 기록이 없어요.'));
});
