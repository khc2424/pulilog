/* Phone-number lookup, class-scoped library, and per-student favorites. */
let accountReady=false, accountError='', signedStudent=null, teacherAuthorized=false;
let libraryVideos=[], managedData={students:[],videos:[],classes:[]}, favoriteOnly=false;
let catalogSearch='', bookFilter='', subjectFilter='', unitFilter='', libraryLoading=false;

async function requestAPI(path, body){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',
  headers:body===undefined?{}:{'Content-Type':'application/json','X-AXIS-Request':'1'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 let result;try{result=await response.json()}catch{throw new Error('앱 서버에 연결하지 못했어요. server.py로 실행해주세요.')}
 if(!response.ok){const error=new Error(result.error||'잠시 후 다시 시도해주세요.');error.status=response.status;throw error}
 return result;
}
async function refreshStudent(){
 const session=await requestAPI('/api/session');signedStudent=session.student;teacherAuthorized=session.teacher;
 libraryVideos=signedStudent?(await requestAPI('/api/videos')).videos:[];
}
async function refreshTeacher(){managedData=await requestAPI('/api/teacher/state')}
function normalizeSearch(s){return String(s).normalize('NFKC').toLowerCase().replace(/\s+/g,'')}
function currentClassVideos(){
 const terms=catalogSearch.trim().split(/\s+/).filter(Boolean).map(normalizeSearch);
 return libraryVideos.filter(v=>(!favoriteOnly||v.favorite)&&(!bookFilter||v.book===bookFilter)&&
  (!subjectFilter||v.subject===subjectFilter)&&(!unitFilter||v.unit===unitFilter)&&
  terms.every(term=>normalizeSearch([v.title,v.book,v.subject,v.unit].join(' ')).includes(term)));
}
function filterSelect(id,label,key,value){const options=[...new Set(libraryVideos.map(v=>v[key]))].sort();return `<select id="${id}" aria-label="${label}"><option value="">${label} 전체</option>${options.map(o=>`<option ${o===value?'selected':''} value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`}
function loginView(teacher=false){return `<div class="login-layout"><div class="login-intro"><span class="eyebrow">풀이로그</span><h1>풀이로그 강의실</h1><p>우리 반 강의를 한곳에서.<br>필요한 설명은 문제별 타임라인으로 바로 찾아보세요.</p><div class="login-art" aria-hidden="true">풀이<span>로그</span></div></div><section class="card login-card"><span class="badge ${teacher?'purple':'green'}">${teacher?'선생님 관리':'학생 로그인'}</span><h2>${teacher?'선생님 접속':'전화번호로 시작하기'}</h2><p class="subtitle">${teacher?'선생님 접속 코드를 입력해주세요.':'선생님께 등록한 전화번호를 입력해주세요.'}</p><form id="account-login"><div class="field"><label for="login-identity">${teacher?'선생님 접속 코드':'휴대폰 번호'}</label><input id="login-identity" type="${teacher?'password':'tel'}" ${teacher?'autocomplete="off"':'inputmode="tel" autocomplete="tel" maxlength="14"'} placeholder="${teacher?'접속 코드':'010-0000-0009'}" required></div>${teacher?'':'<label class="check-row remember"><input id="remember-login" type="checkbox" checked>이 기기에서 로그인 기억하기 <small>30일</small></label>'}<p id="login-error" class="form-error" role="alert"></p><button class="btn primary" id="login-submit" type="submit">${teacher?'선생님 사이트 열기':'내 반 강의 보기'} →</button></form>${teacher?'<p class="source-note">선생님 전용 접속 코드예요.</p>':'<p class="phone-disclosure">선생님이 등록한 전화번호로 로그인해요. 문자 인증 방식은 아니에요.</p>'}</section></div>`}

function studentLibraryView(){
 const videos=currentClassVideos();
 const card=v=>`<article class="library-video" data-record-id="${esc(v.id)}"><button class="library-cover course" data-open-course="${esc(v.id)}" aria-label="${esc(v.title)} 재생"><span class="cover-subject">${esc(v.subject)}</span><span class="cover-symbol">${esc(v.book)}</span><span class="cover-unit">${esc(v.unit)}</span><span class="cover-play">▷</span>${v.is_new?'<span class="new-badge" title="사이트에 추가된 지 7일 이내인 영상">NEW</span>':''}</button><div class="library-video-body"><div class="course-title-row"><button class="course-title" data-open-course="${esc(v.id)}">${esc(v.title)}</button><button class="favorite-star ${v.favorite?'selected':''}" data-favorite="${esc(v.id)}" aria-label="${esc(v.title)} 즐겨찾기 ${v.favorite?'해제':'설정'}" aria-pressed="${!!v.favorite}" title="즐겨찾기">${v.favorite?'★':'☆'}</button></div><p>${esc(v.book)} · ${esc(v.subject)} · ${esc(v.unit)}</p><span class="course-meta">문제별 타임라인 ${v.timeline.length}개${v.is_new?' · 최근 추가':''}</span></div></article>`;
 return heading('MY CLASS VIDEOS',`${esc(signedStudent.name)} 학생의 강의실`,`${esc(signedStudent.class_name)} · 내 반 강의만 모았어요.`,badge(signedStudent.class_name,'green'))+`
 <div class="catalog-toolbar"><div class="catalog-tabs"><button class="filter ${!favoriteOnly?'active':''}" data-library-view="all">전체 강의 <span>${libraryVideos.length}</span></button><button class="filter ${favoriteOnly?'active':''}" data-library-view="favorites">★ 즐겨찾기 <span>${libraryVideos.filter(v=>v.favorite).length}</span></button></div><div class="catalog-search"><span aria-hidden="true">⌕</span><input id="catalog-search" type="search" aria-label="강의 제목 검색" placeholder="교재, 과목, 단원 또는 영상 제목 검색" value="${esc(catalogSearch)}"></div><div class="catalog-filters">${filterSelect('book-filter','교재','book',bookFilter)}${filterSelect('subject-filter','과목','subject',subjectFilter)}${filterSelect('unit-filter','단원','unit',unitFilter)}</div></div>
 <div class="section-row"><h2>${favoriteOnly?'즐겨찾는 강의':'우리 반 강의'} <span class="library-count">${videos.length}</span></h2><span class="sample-tag">최근 등록 순 · NEW는 사이트 추가 후 7일</span></div>
 <div class="library-grid">${videos.map(card).join('')}</div>${!videos.length?`<div class="card empty-state"><span class="empty-icon">${favoriteOnly?'☆':'▷'}</span><h3>${favoriteOnly?'아직 즐겨찾는 강의가 없어요.':libraryVideos.length?'검색 조건에 맞는 강의가 없어요.':'우리 반에 등록된 강의가 아직 없어요.'}</h3><p>${favoriteOnly?'강의 제목 오른쪽의 별을 눌러 모아보세요.':libraryVideos.length?'제목의 일부로 검색하거나 필터를 바꿔보세요.':'선생님이 이 반의 영상을 등록하면 여기에 표시돼요.'}</p></div>`:''}
 <p class="source-note">강의를 열고 문제별 타임라인으로 필요한 풀이를 바로 찾아보세요.</p>`;
}

function renderApplication(){
 if(!paths[page])page='overview';
 document.body.classList.toggle('login-mode',!accountReady||(studentMode?!signedStudent:!teacherAuthorized));
 nav();
 if(!accountReady){$('#app').innerHTML='<div class="empty-state">강의실을 불러오고 있어요…</div>';return}
 if(accountError){$('#app').innerHTML=`<section class="card empty-state"><h2>서버 연결을 확인해주세요.</h2><p>${esc(accountError)}</p><button class="btn" id="account-retry">다시 연결</button></section>`;$('#account-retry').onclick=bootAccounts;return}
 $('#mode').textContent=studentMode?(signedStudent?'로그아웃':'선생님 사이트'):'학생 사이트';
 $('#breadcrumb').textContent=studentMode?'내 반 강의':'학생 관리';
 if(studentMode&&!signedStudent){$('#app').innerHTML=loginView();bindLogin(false);return}
 if(!studentMode&&!teacherAuthorized){$('#app').innerHTML=loginView(true);bindLogin(true);return}
 if(studentMode){$('#app').innerHTML=studentLibraryView();document.title='풀이로그 · '+signedStudent.class_name+' 강의';bindCatalog();return}
 $('.sidebar-bottom p').innerHTML='등록한 학생과 반에 맞춰 영상을 제공해요.';
 $('#app').innerHTML=renderTeacherPage();
 document.title='풀이로그 · 선생님';bindPage();
}
render=renderApplication;

function bindLogin(teacher){
 $('#fill-demo-phone')?.addEventListener('click',()=>{$('#login-identity').value='01000000009';$('#login-identity').focus()});
 $('#account-login').onsubmit=async e=>{
  e.preventDefault();const button=$('#login-submit');button.disabled=true;$('#login-error').textContent='';
  try{
   if(teacher){await requestAPI('/api/teacher/login',{code:$('#login-identity').value});teacherAuthorized=true;await refreshTeacher();go('overview')}
   else{const result=await requestAPI('/api/login',{phone:$('#login-identity').value,remember:$('#remember-login').checked});signedStudent=result.student;await refreshStudent();catalogSearch='';favoriteOnly=false;render()}
  }catch(error){$('#login-error').textContent=error.message;button.disabled=false}
 };
}
function bindCatalog(){
 $('#catalog-search').oninput=e=>{catalogSearch=e.target.value;const pos=e.target.selectionStart;render();$('#catalog-search').focus();try{$('#catalog-search').setSelectionRange(pos,pos)}catch{}};
 for(const [id,key] of [['book-filter','book'],['subject-filter','subject'],['unit-filter','unit']]){
  $('#'+id).onchange=e=>{if(key==='book')bookFilter=e.target.value;if(key==='subject')subjectFilter=e.target.value;if(key==='unit')unitFilter=e.target.value;render()};
 }
}
function managedStudents(){return heading('STUDENT ACCESS','학생과 반을 연결해요','등록한 전화번호로 로그인하면 해당 반 영상만 열려요.',`<button class="btn" data-add-course>＋ 강의 등록</button><button class="btn primary" data-add-student>＋ 학생 등록</button>`)+`
 <section class="card"><div class="card-header"><div><h2>학생 로그인 관리</h2><p class="card-sub">이름·전화번호·반·이용 상태를 관리해요. 현재 ${managedData.students.length}명</p></div>${badge('로컬 서버 저장','green')}</div><div class="student-table-wrap"><table class="student-table"><thead><tr><th>학생</th><th>전화번호</th><th>반</th><th>이용 상태</th><th>관리</th></tr></thead><tbody>${managedData.students.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td>${esc(s.class_name)}</td><td>${badge(s.active?'이용 가능':'이용 중지',s.active?'green':'orange')}</td><td><button class="text-link" data-edit-managed="${s.id}">수정 →</button></td></tr>`).join('')}</tbody></table></div><p class="source-note">번호를 변경하거나 이용 중지하면 기존 학생 로그인을 해제해요. 반을 바꾸면 다음 조회부터 새 반의 영상만 표시해요.</p></section>
 <section class="card" style="margin-top:22px"><div class="card-header"><div><h2>강의별 배정 반</h2><p class="card-sub">유튜브 영상 한 개당 강의 카드 한 개로 관리해요.</p></div><button class="text-link" data-add-course>＋ 등록</button></div>${managedData.videos.map(v=>`<div class="managed-course"><div><b>${esc(v.title)}</b><p>${esc(v.class_name)} · ${esc(v.book)} · ${esc(v.subject)} · ${esc(v.unit)}</p></div><button class="btn small" data-edit-course="${esc(v.id)}">수정</button></div>`).join('')}</section>`}

function manageStudent(id=null,group=''){
 const s=managedData.students.find(s=>s.id===id)||{name:'',phone:'',class_name:group||managedData.classes[0]||'',active:1};
 openModal(`<h2 id="modal-title">${id===null?'학생 등록':'학생 정보 수정'}</h2><p class="subtitle">등록된 전화번호와 반으로 학생 사이트를 연결해요.</p><form id="managed-student-form"><div class="form-grid"><div class="field"><label for="managed-name">학생 이름</label><input id="managed-name" required maxlength="60" value="${esc(s.name)}"></div><div class="field"><label for="managed-phone">전화번호</label><input id="managed-phone" type="tel" inputmode="tel" required value="${esc(s.phone)}"></div><div class="field"><label for="managed-class">반 이름</label><input id="managed-class" list="class-names" required maxlength="60" value="${esc(s.class_name)}"><datalist id="class-names">${managedData.classes.map(g=>`<option value="${esc(g)}">`).join('')}</datalist></div></div><label class="check-row"><input id="managed-active" type="checkbox" ${s.active?'checked':''}>학생 사이트 이용 허용</label><p class="form-error" id="managed-error" role="alert"></p><div class="modal-actions"><button class="btn primary" type="submit">저장</button></div></form>`);
 $('#managed-student-form').onsubmit=async e=>{e.preventDefault();try{await requestAPI('/api/teacher/student',{id,name:$('#managed-name').value,phone:$('#managed-phone').value,class_name:$('#managed-class').value,active:$('#managed-active').checked});await refreshTeacher();closeModal();render();toast('학생 정보를 저장했어요.')}catch(error){$('#managed-error').textContent=error.message}};
}
function parseCourseTitle(raw){
 const title=raw.trim();const m=title.match(/^(고\d|중\d|초\d)\s*([A-Za-z]\d+)\s+(.+?)\s+(공통수학\s*[12]|대수|미적분\s*[12]?|확률과\s*통계|기하|수학\s*[ⅠⅡ12])\s*(.*)$/i);
 if(!m)return null;
 const tail=m[5].trim(),unit=tail.replace(/^\[[^\]]+\]\s*/,'').replace(/\s*#\s*\d+\s*$/,'').trim();
 return{class_name:m[1]+' '+m[2].toUpperCase(),book:m[3].trim(),subject:m[4].replace(/\s/g,''),unit:unit||tail};
}
function manageCourse(id=null){
 const v=managedData.videos.find(v=>v.id===id)||{id:'',title:'',class_name:'고1 B2',book:'',subject:'',unit:''};
 openModal(`<h2 id="modal-title">${id?'강의 정보 수정':'강의 등록'}</h2><p class="subtitle">제목을 입력하면 반·교재·과목·단원을 제안해요. 저장 전에 확인해주세요.</p><form id="managed-video-form"><div class="field"><label for="course-url">유튜브 링크</label><input id="course-url" type="url" required ${id?'readonly':''} value="${v.id?'https://youtu.be/'+esc(v.id):''}" placeholder="https://youtu.be/..."></div><div class="field" style="margin-top:15px"><label for="course-title">영상 제목</label><input id="course-title" required maxlength="300" value="${esc(v.title)}" placeholder="고1B2 쎈 공통수학1 [2-7] 함수 #1"></div><button type="button" id="parse-title" class="text-link" style="margin:8px 0 15px">제목에서 분류 채우기 →</button><div class="form-grid">${[['class_name','배정 반'],['book','교재'],['subject','과목'],['unit','단원']].map(([key,label])=>`<div class="field"><label for="course-${key}">${label}</label><input required id="course-${key}" value="${esc(v[key])}"></div>`).join('')}</div><p class="form-error" id="course-error" role="alert"></p><p class="source-note">링크를 직접 등록하는 기능이에요. 유튜브 채널 자동 동기화는 아직 연결하지 않았어요.</p><div class="modal-actions"><button type="submit" class="btn primary">저장</button></div></form>`);
 $('#parse-title').onclick=()=>{const parsed=parseCourseTitle($('#course-title').value);if(!parsed){toast('예시 제목 형식인지 확인하고 직접 분류를 입력해주세요.');return}for(const[k,value]of Object.entries(parsed))$('#course-'+k).value=value;toast('제목에서 분류를 채웠어요. 확인 후 저장해주세요.')};
 $('#managed-video-form').onsubmit=async e=>{e.preventDefault();const vid=youtubeId($('#course-url').value);if(!vid){$('#course-error').textContent='유튜브 링크를 확인해주세요.';return}try{await requestAPI('/api/teacher/video',{id:vid,title:$('#course-title').value,...Object.fromEntries(['class_name','book','subject','unit'].map(k=>[k,$('#course-'+k).value]))});await refreshTeacher();closeModal();render();toast('강의와 배정 반을 저장했어요.')}catch(error){$('#course-error').textContent=error.message}};
}

async function openCourse(id){
 try{await refreshStudent()}catch(error){toast(error.message);return}
 if(!signedStudent){render();toast('다시 로그인해주세요.');return}
 const v=libraryVideos.find(v=>v.id===id);if(!v){toast('이 반에서 볼 수 없는 영상이에요.');return}
 const rows=v.timeline;
 openModal(`<h2 id="modal-title">${esc(v.title)}</h2><p class="subtitle">${esc(v.book)} · ${esc(v.subject)} · ${esc(v.unit)}</p><iframe id="lesson-player" class="embedded-video" src="https://www.youtube.com/embed/${esc(v.id)}?start=0" title="${esc(v.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><p id="playing-position" class="playing-position" role="status">전체 강의</p><section class="video-timeline" aria-label="문제 번호별 타임라인"><div class="timeline-heading"><h3>문제별 타임라인</h3><span>${rows.length}개</span></div><p class="timeline-help">문제 번호나 시간을 누르면 해당 풀이부터 재생돼요.</p>${rows.length?rows.map(([n,p,t,label,sec])=>`<button class="timeline-row" data-course-seek="${sec}" data-course-id="${esc(v.id)}" data-course-problem="${esc(n)}"><span class="timeline-number">${esc(n)}번</span><span class="timeline-topic">${esc(t)}<small>${p?'교재 '+p+'쪽':''}</small></span><span class="timeline-time">${esc(label)} ▷</span></button>`).join(''):'<div class="empty-state">아직 등록된 타임라인이 없어요. 전체 강의를 먼저 볼 수 있어요.</div>'}</section><div class="modal-actions"><a id="original-video-link" class="btn" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener noreferrer">유튜브에서 열기 ↗</a></div>`);
}

document.addEventListener('click',async e=>{
 const el=e.target.closest('button');if(!el)return;
 if(el.dataset.libraryView){favoriteOnly=el.dataset.libraryView==='favorites';render()}
 if(el.dataset.openCourse){modalTrigger=el;openCourse(el.dataset.openCourse)}
 if(el.dataset.favorite){
  const v=libraryVideos.find(v=>v.id===el.dataset.favorite);if(!v)return;el.disabled=true;
  try{const result=await requestAPI('/api/favorite',{video_id:v.id,favorite:!v.favorite});v.favorite=result.favorite;render()}catch(error){toast(error.message);el.disabled=false}
 }
 if(el.dataset.courseSeek!==undefined){
  if(!libraryVideos.some(v=>v.id===el.dataset.courseId))return;
  const sec=Number(el.dataset.courseSeek);$('#lesson-player').src=`https://www.youtube.com/embed/${el.dataset.courseId}?start=${sec}&autoplay=1`;
  $('#playing-position').textContent='선택한 구간 · '+el.dataset.courseProblem+'번';
  $('#original-video-link').href=`https://www.youtube.com/watch?v=${el.dataset.courseId}&t=${sec}s`;
  document.querySelectorAll('[data-course-seek]').forEach(row=>{const active=row===el;row.classList.toggle('active',active);if(active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current')});
  $('.modal').scrollTo({top:0,behavior:'smooth'});
 }
 if(el.hasAttribute('data-add-student'))manageStudent();
 if(el.dataset.editManaged!==undefined)manageStudent(Number(el.dataset.editManaged));
 if(el.hasAttribute('data-add-course'))manageCourse();
 if(el.dataset.editCourse)manageCourse(el.dataset.editCourse);
});

$('#mode').onclick=async()=>{
 if(studentMode&&signedStudent){try{await requestAPI('/api/logout',{});signedStudent=null;libraryVideos=[];favoriteOnly=false;catalogSearch='';bookFilter=subjectFilter=unitFilter='';render()}catch(error){toast(error.message)}}
 else if(studentMode)go('teacher-login');
 else location.hash='student';
};
async function bootAccounts(){
 accountReady=false;accountError='';render();
 try{await refreshStudent();if(teacherAuthorized)await refreshTeacher()}catch(error){accountError=error.message}
 accountReady=true;render();
}
window.addEventListener('hashchange',async()=>{if(studentMode){try{await refreshStudent();render()}catch(error){signedStudent=null;libraryVideos=[];render()}}else if(teacherAuthorized){try{await refreshTeacher();render()}catch(error){teacherAuthorized=false;render()}}});
document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&signedStudent){try{await refreshStudent();render()}catch{signedStudent=null;libraryVideos=[];render()}}});
bootAccounts();
