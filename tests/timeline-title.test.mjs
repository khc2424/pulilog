import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
test('기존 타임라인은 번호를 설명 제목에 합치고 불확실 번호와 교재 쪽수는 표시하지 않는다',async()=>{
 const source=await readFile(new URL('../public/accounts.js',import.meta.url),'utf8');
 const start=source.indexOf('function timelineDescription('),end=source.indexOf('function studentPublishedDate(',start),context={};runInNewContext(source.slice(start,end),context);
 for(const [row,title] of [[['69',12,'도함수 활용'],'69번 · 도함수 활용'],[['69',12,'69번 · 도함수 활용'],'69번 · 도함수 활용'],[['번호 확인 필요',0,'넓이의 최솟값'],'넓이의 최솟값'],[['',0,'개념 정리'],'개념 정리'],[['잡담1',0,'주말 이야기'],'잡담1 · 주말 이야기'],[['캡쳐구간1',0,'캡쳐구간1 · 판서 정리'],'캡쳐구간1 · 판서 정리']])assert.equal(context.timelineDescription(row),title);
});
