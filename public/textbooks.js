let textbookSearch='',textbookTrash=false,textbookDeleted=[],textbookUploading=false;
const textbookSize=bytes=>!bytes?'0 KB':bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
function textbookRows(){
 const all=textbookTrash?textbookDeleted:(managedData.textbooks||[]),query=normalizeSearch(textbookSearch);
 const books=all.filter(book=>!query||normalizeSearch([book.title,book.subject,book.edition,book.filename].join(' ')).includes(query));
 return books.length?books.map(book=>`<article class="textbook-row"><div><b>${esc(book.title)}</b><div class="textbook-meta"><span class="badge ${book.kind==='solutions'?'purple':'green'}">${book.kind==='solutions'?'해설집':'문제집'}</span><span>${esc(book.subject||'과목 미지정')}${book.edition?' · '+esc(book.edition):''}</span></div><p class="source-note">${esc(book.filename)} · ${textbookSize(book.size)} · ${esc(new Date(book.created_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}))}</p></div><div class="heading-actions">${textbookTrash?`<button class="btn small" data-book-restore="${esc(book.id)}">복원</button>`:`<a class="btn small" href="/api/teacher/textbooks/${esc(book.id)}/file" target="_blank" rel="noopener">열기 ↗</a><a class="btn small" href="/api/teacher/textbooks/${esc(book.id)}/file?download=1">다운로드</a><button class="text-link" data-book-edit="${esc(book.id)}">정보 수정</button><button class="text-link coral" data-book-delete="${esc(book.id)}">휴지통</button>`}</div></article>`).join(''):`<div class="empty-state">${query?'검색한 교재가 없어요.':textbookTrash?'휴지통이 비어 있어요.':'아직 저장한 교재가 없어요. PDF를 등록해주세요.'}</div>`;
}
function textbookStorageView(){
 const books=managedData.textbooks||[];
 return `<section class="card" id="textbook-storage" style="margin-top:24px"><div class="card-header"><div><h2>교재 PDF 저장소</h2><p class="card-sub">${books.length}개 · ${textbookSize(books.reduce((sum,b)=>sum+b.size,0))} · 선생님 전용</p></div><button class="btn small" id="book-trash-toggle">${textbookTrash?'저장한 교재 보기':'휴지통 보기'}</button></div><form id="book-upload-form"><div class="form-grid"><div class="field"><label for="book-title">교재명</label><input id="book-title" required maxlength="150" placeholder="예: 쎈 공통수학1"></div><div class="field"><label for="book-subject">과목</label><input id="book-subject" maxlength="60" list="book-subject-options" placeholder="예: 공통수학1"><datalist id="book-subject-options">${[...new Set(['공통수학1','공통수학2','대수','미적분1','미적분2','확률과통계','기하',...books.map(b=>b.subject).filter(Boolean)])].map(s=>`<option value="${esc(s)}">`).join('')}</datalist></div><div class="field"><label for="book-kind">자료 종류</label><select id="book-kind"><option value="questions">문제집</option><option value="solutions">해설집</option></select></div><div class="field"><label for="book-edition">판본·추가 구분 · 선택</label><input id="book-edition" maxlength="80" placeholder="예: 2026년판"></div></div><div class="field" style="margin-top:16px"><label for="book-file">PDF 파일 · 최대 50MB</label><input type="file" id="book-file" accept=".pdf,application/pdf" required></div><p class="source-note">교재를 한 번 저장해 두고 열거나 내려받을 수 있어요. 영상·문제 번호와의 연결은 추후 추가돼요.</p><p id="book-upload-error" class="form-error" role="alert"></p><p id="book-upload-status" class="source-note" role="status"></p><progress id="book-upload-progress" max="100" value="0" hidden style="width:100%"></progress><div class="modal-actions"><button class="btn primary" type="submit" id="book-upload-submit">PDF 저장</button></div></form><div class="section-row"><h3>${textbookTrash?'휴지통':'저장한 교재'}</h3><input class="search-input" id="book-search" type="search" aria-label="저장한 교재 검색" placeholder="교재명·과목·파일명 검색" value="${esc(textbookSearch)}"></div><div id="book-list">${textbookRows()}</div></section>`;
}
function bindTextbookActions(){
 document.querySelectorAll('[data-book-edit]').forEach(button=>button.onclick=()=>editTextbook(button.dataset.bookEdit));
 document.querySelectorAll('[data-book-delete]').forEach(button=>button.onclick=()=>archiveTextbook(button.dataset.bookDelete));
 document.querySelectorAll('[data-book-restore]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await requestAPI('/api/teacher/textbooks/restore',{id:button.dataset.bookRestore});textbookDeleted=textbookDeleted.filter(b=>b.id!==button.dataset.bookRestore);await refreshTeacher();render();toast('교재를 복원했어요.')}catch(error){toast(error.message);button.disabled=false}});
}
function bindTextbooks(){
 if(!$('#book-upload-form'))return;
 bindTextbookActions();
 $('#book-file').onchange=()=>{const file=$('#book-file').files?.[0];if(file&&!$('#book-title').value)$('#book-title').value=file.name.replace(/\.pdf$/i,'')};
 bindComposingSearch($('#book-search'),value=>{textbookSearch=value},()=>{$('#book-list').innerHTML=textbookRows();bindTextbookActions()});
 $('#book-trash-toggle').onclick=async()=>{if(textbookUploading)return;try{if(!textbookTrash)textbookDeleted=(await requestAPI('/api/teacher/textbooks?deleted=1')).books;textbookTrash=!textbookTrash;render();$('#textbook-storage').scrollIntoView({block:'start'})}catch(error){toast(error.message)}};
 $('#book-upload-form').onsubmit=async e=>{
  e.preventDefault();if(textbookUploading)return;const file=$('#book-file').files?.[0];if(!file)return;
  $('#book-upload-error').textContent='';if(!/\.pdf$/i.test(file.name)||file.size>50*1024*1024){$('#book-upload-error').textContent='50MB 이하의 PDF를 선택해주세요.';return}
  const params=new URLSearchParams({title:$('#book-title').value,subject:$('#book-subject').value,edition:$('#book-edition').value,kind:$('#book-kind').value,filename:file.name});
  textbookUploading=true;$('#book-upload-submit').disabled=true;$('#book-trash-toggle').disabled=true;$('#book-upload-progress').hidden=false;$('#book-upload-status').textContent='PDF를 전송하고 있어요…';
  try{
   await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST','/api/teacher/textbooks/upload?'+params);xhr.withCredentials=true;xhr.timeout=240000;xhr.setRequestHeader('Content-Type','application/pdf');xhr.setRequestHeader('X-AXIS-Request','1');
    xhr.upload.onprogress=event=>{if(event.lengthComputable){$('#book-upload-progress').value=Math.round(event.loaded/event.total*100);$('#book-upload-status').textContent=event.loaded===event.total?'전송 완료 · 저장소에 보관하고 있어요…':'PDF 전송 중 · '+Math.round(event.loaded/event.total*100)+'%'}};
    xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText)}catch{reject(new Error('저장 응답을 확인하지 못했어요. 잠시 후 목록을 확인해주세요.'));return}if(xhr.status>=200&&xhr.status<300)resolve(result);else reject(new Error(result.error||'PDF를 저장하지 못했어요.'))};
    xhr.onerror=()=>reject(new Error('연결이 끊겼어요. 목록을 확인한 뒤 다시 시도해주세요.'));xhr.ontimeout=()=>reject(new Error('PDF 전송 시간이 초과됐어요. 파일 크기와 연결 상태를 확인해주세요.'));xhr.send(file);
   });
   textbookSearch='';textbookTrash=false;await refreshTeacher();render();$('#textbook-storage').scrollIntoView({block:'start'});toast('교재 PDF를 저장했어요.');
  }catch(error){if($('#book-upload-error'))$('#book-upload-error').textContent=error.message}finally{textbookUploading=false;if($('#book-upload-submit'))$('#book-upload-submit').disabled=false;if($('#book-trash-toggle'))$('#book-trash-toggle').disabled=false}
 };
}
function editTextbook(id){
 const book=managedData.textbooks.find(b=>b.id===id);if(!book)return;
 openModal(`<h2 id="modal-title">교재 정보 수정</h2><form id="book-edit-form"><div class="field"><label for="book-edit-title">교재명</label><input id="book-edit-title" required maxlength="150" value="${esc(book.title)}"></div><div class="field" style="margin-top:14px"><label for="book-edit-subject">과목</label><input id="book-edit-subject" maxlength="60" value="${esc(book.subject)}"></div><div class="field" style="margin-top:14px"><label for="book-edit-edition">판본·추가 구분</label><input id="book-edit-edition" maxlength="80" value="${esc(book.edition)}"></div><div class="field" style="margin-top:14px"><label for="book-edit-kind">자료 종류</label><select id="book-edit-kind"><option value="questions" ${book.kind==='questions'?'selected':''}>문제집</option><option value="solutions" ${book.kind==='solutions'?'selected':''}>해설집</option></select></div><p id="book-edit-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="btn primary" type="submit">저장</button></div></form>`);
 $('#book-edit-form').onsubmit=async e=>{e.preventDefault();try{await requestAPI('/api/teacher/textbooks/update',{id,title:$('#book-edit-title').value,subject:$('#book-edit-subject').value,edition:$('#book-edit-edition').value,kind:$('#book-edit-kind').value});await refreshTeacher();closeModal();render();toast('교재 정보를 수정했어요.')}catch(error){$('#book-edit-error').textContent=error.message}};
}
function archiveTextbook(id){
 const book=managedData.textbooks.find(b=>b.id===id);if(!book)return;
 openModal(`<h2 id="modal-title">교재를 휴지통으로 옮길까요?</h2><p>${esc(book.title)}</p><p class="source-note">파일은 바로 지워지지 않으며, 휴지통에서 복원할 수 있어요.</p><p class="form-error" id="book-delete-error" role="alert"></p><div class="modal-actions"><button class="btn" id="book-delete-cancel">취소</button><button class="btn danger" id="book-delete-confirm">휴지통으로 이동</button></div>`);
 $('#book-delete-cancel').onclick=closeModal;$('#book-delete-confirm').onclick=async e=>{e.currentTarget.disabled=true;try{await requestAPI('/api/teacher/textbooks/delete',{id});await refreshTeacher();closeModal();render();toast('휴지통으로 옮겼어요.')}catch(error){$('#book-delete-error').textContent=error.message;e.currentTarget.disabled=false}};
}
