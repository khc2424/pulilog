/* Teacher class groups and navigation. Homework is outside the current product scope. */
delete paths.planning;
paths.curriculum=['커리큘럼',teacherIcons.plan];
delete paths.unclassified;
if(page==='unclassified'){page='courses';teacherCourseFilter='missing';history.replaceState(null,'','#courses')}
delete paths.homework;
// Keep navigation in the order used during the teacher's work.
const menuOrder=['overview','courses','students','analysis','curriculum','settings'];
const menuItems=Object.fromEntries(menuOrder.map(k=>[k,paths[k]]));
Object.keys(paths).forEach(k=>delete paths[k]);Object.assign(paths,menuItems);
const openClassGroups=new Set();
function renderTeacherPage(){
 teacherNavigation();
 queueMicrotask(syncSidebarState);
 const map={overview:teacherOverview,courses:teacherCourses,students:teacherGroups,analysis:teacherAnalysis,curriculum:teacherCurriculum,settings:teacherSettings,planning:teacherCurriculum};
 const html=(map[page]||teacherOverview)();queueMicrotask(()=>{bindTeacherPage();bindWorkbench()});return html;
}
function teacherCurriculum(){return heading('','커리큘럼','')+`<section class="card"><h2>커리큘럼 준비 중</h2><p class="subtitle">자동 커리큘럼 기능은 준비 중이에요.</p></section>`}
const classNameKey=value=>String(value??'').replace(/\s/g,'').toUpperCase();
const weekdayNames=['월','화','수','목','금','토','일'];
const legacyScheduleDays={MWF:[1,3,5],TTS:[2,4,6],MW:[1,3],TT:[2,4]};
const scheduleDays=s=>legacyScheduleDays[s]||(/^days:[1-7](,[1-7]){0,6}$/.test(s||'')?s.slice(5).split(',').map(Number):[]);
const scheduleText=s=>{const days=scheduleDays(s);return days.length?days.map(d=>weekdayNames[d-1]).join('·')+' 수업':'수업 요일 미설정'};
const groupSchedule=g=>managedData.class_info?.find(c=>c.name===g)?.schedule||'';
function teacherGroups(){
 const q=teacherStudentSearch.trim();
 const matches=value=>String(value).replace(/\s/g,'').toLowerCase().includes(q.replace(/\s/g,'').toLowerCase());
 const groups=managedData.classes.filter(g=>!q||matches(g)||managedData.students.some(s=>s.class_name===g&&(matches(s.name)||matches(s.phone))));
 return heading('STUDENTS & CLASSES','반별로 접고, 필요한 반만 펼쳐요.','반을 등록하고 수업 요일을 설정한 뒤, 해당 반에 학생을 추가해주세요.',`<button class="btn" data-w-collapse>모두 접기</button><button class="btn primary" data-w-class-new>＋ 반 등록</button>`)+`
 <div class="teacher-toolbar"><p class="subtitle">${managedData.classes.length}개 반 · 전체 ${managedData.students.length}명</p><input id="teacher-student-search" class="search-input" aria-label="학생 검색" placeholder="반·학생 이름·전화번호 검색" value="${esc(q)}"></div>
 <div class="class-accordions">${groups.map(g=>{const all=managedData.students.filter(s=>s.class_name===g),ss=all.filter(s=>!q||matches(g)||matches(s.name)||matches(s.phone));return `<details class="card class-accordion" data-class-group="${esc(g)}" ${q||openClassGroups.has(g)?'open':''}><summary><span class="class-disclosure">›</span><span class="class-summary-title"><b>${esc(g)}</b><small>${scheduleText(groupSchedule(g))}</small></span><span class="badge purple">${all.length}명</span><span class="muted">강의 ${managedData.videos.filter(v=>videoGroups(v).includes(g)).length}개</span></summary><div class="class-body"><div class="card-header"><p class="card-sub">이 반에 속한 학생만 표시해요.</p><div class="heading-actions"><button class="btn small" data-w-class-edit="${esc(g)}">수업 요일 설정</button><button class="btn primary small" data-w-student-add="${esc(g)}">＋ 이 반에 학생 추가</button></div></div>${ss.length?`<div class="student-table-wrap"><table class="student-table"><thead><tr><th>이름</th><th>전화번호</th><th>이용 상태</th><th>관리</th></tr></thead><tbody>${ss.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.phone)}</td><td>${badge(s.active?'이용 가능':'이용 중지',s.active?'green':'orange')}</td><td><button class="text-link" data-edit-managed="${s.id}">수정 →</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">아직 등록된 학생이 없어요. 위 버튼으로 추가해주세요.</div>'}</div></details>`}).join('')||'<section class="card empty-state">검색 결과가 없어요.</section>'}</div>`;
}
function refreshStudentSearchResults(){
 const current=$('.class-accordions');
 if(!current)return;
 const template=document.createElement('template');
 template.innerHTML=teacherGroups();
 const results=template.content.querySelector('.class-accordions');
 current.replaceChildren(...results.childNodes);
 bindWorkbench();
}
function editClass(g=''){
 openModal(`<h2 id="modal-title">${g?'반 수업 요일 설정':'새 반 등록'}</h2><form id="class-form"><div class="field"><label for="class-name">반 이름</label><input id="class-name" maxlength="60" required ${g?'readonly':''} value="${esc(g)}" placeholder="예: 고1 B2"></div><fieldset class="weekday-fieldset"><legend>수업 요일<small>여러 개 선택 가능</small></legend><div class="weekday-buttons">${weekdayNames.map((day,i)=>`<label class="weekday-toggle"><input type="checkbox" name="class-day" value="${i+1}" aria-label="${day}요일" ${scheduleDays(groupSchedule(g)).includes(i+1)?'checked':''}><span>${day}</span></label>`).join('')}</div><p class="weekday-selection" id="weekday-selection" aria-live="polite"></p></fieldset><p id="class-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="btn primary" type="submit">저장</button></div></form>`);
 const showSelectedDays=()=>{const names=[...document.querySelectorAll('[name="class-day"]:checked')].map(el=>weekdayNames[Number(el.value)-1]);$('#weekday-selection').textContent=names.length?names.join('·')+' 수업':'요일은 나중에 설정할 수 있어요.'};
 document.querySelectorAll('[name="class-day"]').forEach(el=>el.onchange=showSelectedDays);showSelectedDays();
 $('#class-form').onsubmit=async e=>{e.preventDefault();const name=$('#class-name').value.trim();if(!g&&managedData.classes.some(group=>classNameKey(group)===classNameKey(name))){$('#class-error').textContent='이미 등록된 반이에요. 기존 반의 수업 요일 설정을 이용해주세요.';return}try{await requestAPI('/api/teacher/class',{name,days:[...document.querySelectorAll('[name="class-day"]:checked')].map(el=>Number(el.value))});await refreshTeacher();openClassGroups.add(name);closeModal();render();toast('반과 수업 요일을 저장했어요.')}catch(e){$('#class-error').textContent=e.message}};
}
function bindWorkbench(){
 if(studentMode||!teacherAuthorized)return;
 document.querySelectorAll('[data-class-group]').forEach(d=>d.ontoggle=()=>{if(d.open)openClassGroups.add(d.dataset.classGroup);else openClassGroups.delete(d.dataset.classGroup)});
}
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||!teacherAuthorized||studentMode)return;
 if(b.hasAttribute('data-w-class-new'))editClass();
 if(b.hasAttribute('data-w-class-edit'))editClass(b.dataset.wClassEdit);
 if(b.hasAttribute('data-w-student-add')){openClassGroups.add(b.dataset.wStudentAdd);manageStudent(null,b.dataset.wStudentAdd)}
 if(b.hasAttribute('data-w-collapse')){teacherStudentSearch='';openClassGroups.clear();render()}
});

// Remember the desktop preference; mobile opens as an overlay without covering its close button.
const sidebarMedia=window.matchMedia('(max-width:650px)');
let sidebarCollapsed=false;
try{sidebarCollapsed=localStorage.getItem('axis-sidebar-collapsed')==='1'}catch{}
function syncSidebarState(){
 const mobile=sidebarMedia.matches,open=mobile?$('.sidebar').classList.contains('open'):!sidebarCollapsed;
 const authorized=typeof teacherAuthorized!=='undefined'&&teacherAuthorized;
 document.body.classList.toggle('sidebar-collapsed',!mobile&&sidebarCollapsed);
 document.body.classList.toggle('sidebar-overlay',mobile&&open&&!studentMode&&authorized);
 const btn=$('#menu');btn.setAttribute('aria-expanded',String(open));btn.setAttribute('aria-label',open?'메뉴 접기':'메뉴 열기');btn.title=open?'메뉴 접기':'메뉴 열기';btn.textContent=open?'×':'☰';
 $('.sidebar').inert=!open||studentMode||!authorized;
 $('.shell').inert=mobile&&open&&!studentMode&&authorized;
}
function setSidebarOpen(open){
 if(sidebarMedia.matches){$('.sidebar').classList.toggle('open',open)}else{sidebarCollapsed=!open;try{localStorage.setItem('axis-sidebar-collapsed',sidebarCollapsed?'1':'0')}catch{}}
 syncSidebarState();$('#menu').focus();
}
// app.js owns the original menu handler; replace it after account boot.
queueMicrotask(()=>{
 $('#menu').onclick=()=>setSidebarOpen(sidebarMedia.matches?!$('.sidebar').classList.contains('open'):sidebarCollapsed);
 $('#sidebar-shade').onclick=()=>setSidebarOpen(false);
 syncSidebarState();
});
sidebarMedia.addEventListener('change',()=>{$('.sidebar').classList.remove('open');syncSidebarState()});
window.addEventListener('hashchange',()=>{if(sidebarMedia.matches)$('.sidebar').classList.remove('open');queueMicrotask(syncSidebarState)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&sidebarMedia.matches&&$('.sidebar').classList.contains('open'))setSidebarOpen(false)});
document.addEventListener('click',e=>{if(sidebarMedia.matches&&e.target.closest('#nav a'))setSidebarOpen(false)});
