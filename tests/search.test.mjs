import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('강의 관리에서 2026년을 기본 표시하고 전체·날짜 미확인으로 전환한다',async()=>{
 const source=await readFile(new URL('../public/teacher.js',import.meta.url),'utf8');
 const view=source.slice(source.indexOf('function teacherCourses(){'),source.indexOf('function teacherCourseDetail('));
 const context={page:'courses',teacherCourseClasses:new Set(),teacherCourseMissing:new Set(),selectedCourseId:null,teacherCourseSearch:'',teacherCourseFilter:'all',teacherCourseYear:null,normalizeSearch:s=>s,heading:()=>'',esc:String,videoGroups:()=>[],badge:String,tlabel:()=>'',classificationMissing:()=>false,
  managedData:{videos:[
   {id:'a',title:'올해영상',youtube_year:2026,timeline:[]},
   {id:'b',title:'지난영상',youtube_year:2025,timeline:[]},
   {id:'c',title:'수동영상',youtube_year:null,timeline:[]}
  ]}};
 runInNewContext(view,context);
 let html=context.teacherCourses();assert.ok(html.includes('올해영상'));assert.ok(!html.includes('지난영상'));assert.ok(!html.includes('수동영상'));
 context.teacherCourseYear='all';html=context.teacherCourses();assert.ok(html.includes('지난영상'));assert.ok(html.includes('수동영상'));
 context.teacherCourseYear='unknown';html=context.teacherCourses();assert.ok(html.includes('수동영상'));assert.ok(!html.includes('올해영상'));
 context.teacherCourseFilter='missing';context.teacherCourseYear='all';context.classificationMissing=v=>v.title==='지난영상';
 html=context.teacherCourses();assert.ok(html.includes('미분류 영상 1개'));assert.ok(html.includes('지난영상'));assert.ok(!html.includes('올해영상'));assert.ok(html.includes('미지정: 반 · 교재 · 과목 · 단원'));
 context.classificationMissing=()=>false;html=context.teacherCourses();assert.ok(html.includes('미분류 영상 0개'));
 context.page='courses';context.teacherCourseYear='2026';context.teacherCourseFilter='classified';
 context.managedData.classes=['A반','B반'];context.videoGroups=v=>v.classes||[];context.classificationMissing=v=>!v.complete;
 context.managedData.videos=[
  {id:'a',title:'A반완료',youtube_published_at:'2026-01-01T15:00:00Z',youtube_year:2026,classes:['A반'],complete:true,timeline:[]},
  {id:'b',title:'B반완료',youtube_year:2026,classes:['B반'],complete:true,timeline:[]},
  {id:'c',title:'A반미완료',youtube_year:2026,classes:['A반'],complete:false,timeline:[]}
 ];
 html=context.teacherCourses();assert.ok(html.includes('분류 완료 영상 2개'));assert.ok(!html.includes('A반미완료'));
 context.teacherCourseClasses.add('A반');html=context.teacherCourses();assert.ok(html.includes('분류 완료 영상 1개'));assert.ok(html.includes('A반완료'));assert.ok(!html.includes('B반완료'));assert.ok(html.includes('2026. 01. 02.'));assert.ok(html.includes('유튜브 게시일'));
 context.teacherCourseFilter='missing';html=context.teacherCourses();assert.ok(html.includes('A반미완료'));assert.ok(!html.includes('A반완료'));assert.ok(!html.includes('data-course-class '));assert.ok(html.includes('data-course-missing'));
 context.teacherCourseFilter='all';html=context.teacherCourses();assert.ok(html.includes('B반완료'));assert.equal((html.match(/data-t-filter=/g)||[]).length,5);
 context.teacherCourseFilter='classified';context.teacherCourseClasses.add('B반');
 html=context.teacherCourses();assert.ok(html.includes('분류 완료 영상 2개'));assert.ok(html.includes('A반완료'));assert.ok(html.includes('B반완료'));assert.ok(html.includes('data-course-class value="A반" checked'));assert.ok(html.includes('data-course-class value="B반" checked'));
 context.teacherCourseFilter='missing';context.managedData.videos=[
  {id:'a',title:'반만없음',youtube_year:2026,classes:[],book:'쎈',subject:'대수',unit:'지수',timeline:[]},
  {id:'b',title:'교재만없음',youtube_year:2026,classes:['A반'],book:'',subject:'대수',unit:'지수',timeline:[]},
  {id:'c',title:'단원만없음',youtube_year:2026,classes:['B반'],book:'쎈',subject:'대수',unit:'',timeline:[]}
 ];
 context.teacherCourseMissing.add('class');html=context.teacherCourses();assert.ok(html.includes('반만없음'));assert.ok(!html.includes('교재만없음'));assert.ok(!html.includes('단원만없음'));
 context.teacherCourseMissing.add('book');html=context.teacherCourses();assert.ok(html.includes('미분류 영상 2개'));assert.ok(html.includes('반만없음'));assert.ok(html.includes('교재만없음'));assert.ok(!html.includes('단원만없음'));
 context.teacherCourseMissing.clear();html=context.teacherCourses();assert.ok(html.includes('미분류 영상 3개'));
});

test('반·학생 이름·전화번호 검색으로 실제 표시 목록이 줄어든다', async () => {
  const source = await readFile(new URL('../public/workbench.js', import.meta.url), 'utf8');
  const view = source.slice(source.indexOf('function teacherGroups(){'), source.indexOf('function refreshStudentSearchResults(){'));
  const context = {
    teacherStudentSearch: '', openClassGroups: new Set(),
    managedData: { classes: ['고1B2', '중3D4'], videos: [], students: [
      { id: 1, name: '김테스트', phone: '01011112222', class_name: '고1B2', active: true },
      { id: 2, name: '박예시', phone: '01033334444', class_name: '중3D4', active: true }
    ] },
    heading: () => '', esc: String, badge: String, scheduleText: () => '', groupSchedule: () => '', videoGroups: () => []
  };
  runInNewContext(view, context);
  for (const query of ['김', '2222', '고1', '고 1']) {
    context.teacherStudentSearch = query;
    const html = context.teacherGroups();
    assert.ok(html.includes('김테스트'));
    assert.ok(!html.includes('박예시'));
    assert.ok(html.includes('open'));
  }
  context.teacherStudentSearch = '없는이름';
  assert.ok(context.teacherGroups().includes('검색 결과가 없어요'));
  context.teacherStudentSearch = '';
  assert.ok(context.teacherGroups().includes('박예시'));
});

test('학생 검색은 한글 조합 도중에도 입력창을 유지하며 결과만 갱신한다', async () => {
  const source = await readFile(new URL('../public/search.js', import.meta.url), 'utf8');
  let query = '', refreshed = 0;
  const context = { render() { assert.fail('입력창을 포함한 전체 화면을 교체하면 안 된다'); } };
  runInNewContext(source, context);
  const input = { value: '' };
  context.bindComposingSearch(input, value => { query = value; }, () => { refreshed++; });
  input.oncompositionstart();
  for (const value of ['ㄱ', '기', '김']) {
    input.value = value;
    input.oninput({ isComposing: true });
    assert.equal(query, value);
  }
  assert.equal(refreshed, 3);
  input.oncompositionend();
  assert.equal(query, '김');
  input.value = '';
  input.oninput({ isComposing: false });
  assert.equal(query, '');
});

test('한글 조합 중에는 검색 화면을 교체하지 않고 완성 후 검색한다', async () => {
  const source = await readFile(new URL('../public/search.js', import.meta.url), 'utf8');
  let renders = 0, query = '', focused = false, selection;
  const next = { focus() { focused = true; }, setSelectionRange(...args) { selection = args; } };
  const context = { render() { renders++; }, document: { getElementById() { return next; } } };
  runInNewContext(source, context);
  const input = { id: 'teacher-student-search', value: 'ㅈ', selectionStart: 1, selectionEnd: 1, selectionDirection: 'none' };
  context.bindComposingSearch(input, value => { query = value; });
  input.oncompositionstart();
  input.oninput({ isComposing: true });
  input.value = '자';
  input.oninput({ isComposing: false });
  assert.equal(renders, 0);
  input.oncompositionend();
  assert.equal(renders, 1);
  assert.equal(query, '자');
  assert.equal(focused, true);
  assert.deepEqual(selection, [1, 1, 'none']);
  input.value = '';
  input.oninput({ isComposing: false });
  assert.equal(query, '');
  assert.equal(renders, 2);
});
