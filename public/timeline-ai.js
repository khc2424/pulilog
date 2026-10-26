function openCaptionPermission(){
 openModal(`<h2 id="modal-title">유튜브 자막 연결</h2><p class="subtitle">Google 자막 다운로드 API에는 기존 영상 읽기보다 넓은 권한이 필요해요.</p><p class="source-note">Google 승인 화면에는 영상·댓글·자막 관리 및 삭제 권한이 포함되어 표시돼요. 풀이로그는 이 연결로 자막 조회·다운로드만 요청해요. 원하지 않으면 YouTube Studio에서 SRT/VTT 자막을 내려받아 파일로 넣을 수 있어요.</p><p id="caption-permission-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" id="caption-permission-cancel">파일로 진행할게요</button><button class="btn primary" id="caption-permission-confirm">Google 권한 확인하고 연결</button></div>`);
 $('#caption-permission-cancel').onclick=closeModal;
 $('#caption-permission-confirm').onclick=async e=>{e.currentTarget.disabled=true;try{const result=await requestAPI('/api/teacher/youtube/connect',{captions:true});location.assign(result.url)}catch(error){$('#caption-permission-error').textContent=error.message;e.currentTarget.disabled=false}};
}

function openTimelineAI(id){
 const video=teacherVideo(id);if(!video)return;
 if($('#timeline-editor-rows')){try{timelineDrafts[id]=readTimelineRows()}catch(error){toast(error.message);return}}
 const configured=managedData.ai?.configured,needsReplace=!!(timelineDrafts[id]?.length||video.timeline_draft?.length);
 let captions='',source='file';
 openModal(`<h2 id="modal-title">AI 타임라인 초안 만들기</h2><p class="subtitle">${esc(video.title)}</p><p class="source-note">이 영상 한 개의 자막을 Claude로 보내 문제별 시작 구간을 찾아요. API 사용료가 발생하며 결과는 선생님 초안으로만 저장돼요.</p>${!configured?'<div class="notice">Claude 연결 전이에요. Render Environment에 ANTHROPIC_API_KEY를 저장해주세요. 키는 채팅이나 자막 칸에 넣지 마세요.</div>':''}<div class="heading-actions" style="margin-top:16px"><button class="btn" id="ai-fetch-captions" ${managedData.youtube?.captions_enabled?'':'disabled'}>유튜브 자막 가져오기</button>${!managedData.youtube?.captions_enabled?'<button class="btn" id="ai-caption-permission">자막 연결 안내</button>':''}</div><div class="field" style="margin-top:18px"><label for="ai-caption-file">또는 자막 파일 선택 · SRT / VTT · 240KB 이하</label><input id="ai-caption-file" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip"></div><p class="source-note">자동 자막이 있어도 YouTube API에서 내려받기를 허용하지 않는 경우에는 YouTube Studio에서 파일을 내려받아 넣어주세요. 자막과 이 강의가 같은 영상인지 확인해주세요.</p><p id="ai-source-status" role="status" class="source-note">자막을 먼저 준비해주세요.</p><details><summary>자막 미리보기</summary><pre id="ai-caption-preview" style="white-space:pre-wrap;max-height:180px;overflow:auto;font-size:12px"></pre></details>${needsReplace?'<label class="check-row" style="margin-top:18px"><input id="ai-replace-draft" type="checkbox">현재 수정 초안을 새 AI 초안으로 교체</label>':''}<p id="ai-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="btn primary" id="ai-analyze" disabled>이 영상 초안 생성</button></div>`);
 const showCaptions=(text,kind,name)=>{captions=text;source=kind;$('#ai-source-status').textContent=name+' · '+text.length.toLocaleString()+'자';$('#ai-caption-preview').textContent=text.slice(0,1800);$('#ai-analyze').disabled=!configured};
 if($('#ai-caption-permission'))$('#ai-caption-permission').onclick=openCaptionPermission;
 $('#ai-caption-file').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;$('#ai-error').textContent='';if(file.size>240000||!(/\.(srt|vtt)$/i.test(file.name))){captions='';$('#ai-analyze').disabled=true;$('#ai-error').textContent='240KB 이하의 SRT 또는 VTT 파일을 선택해주세요.';return}showCaptions(await file.text(),'file',file.name)};
 $('#ai-fetch-captions').onclick=async e=>{const button=e.currentTarget;button.disabled=true;$('#ai-error').textContent='';$('#ai-source-status').textContent='유튜브 자막을 확인하고 있어요…';try{const result=await requestAPI('/api/teacher/timeline/captions',{id});showCaptions(result.text,'youtube',`유튜브 자막 ${result.cue_count}개 구간`)}catch(error){$('#ai-error').textContent=error.message;$('#ai-source-status').textContent='SRT/VTT 파일로도 진행할 수 있어요.'}finally{button.disabled=false}};
 $('#ai-analyze').onclick=async e=>{
  if(!captions)return;
  if(needsReplace&&!$('#ai-replace-draft').checked){$('#ai-error').textContent='현재 초안을 교체할지 확인해주세요.';return}
  const button=e.currentTarget;button.disabled=true;$('#ai-caption-file').disabled=true;$('#ai-fetch-captions').disabled=true;$('#ai-error').textContent='';$('#ai-source-status').textContent='문제별 시작 구간을 분석하고 있어요. 최대 2분 정도 걸릴 수 있어요.';
  try{const result=await requestAPI('/api/teacher/timeline/analyze',{id,captions,source,replace_draft:needsReplace});await refreshTeacher();timelineDrafts[id]=result.rows;selectedCourseId=id;courseTab='timeline';closeModal();go('courses');render();toast(`초안 ${result.rows.length}개를 저장했어요. 확인 필요 ${result.analysis.needs_check}개 · 학생에게는 아직 공개되지 않았어요.`)}catch(error){if($('#ai-error')){$('#ai-error').textContent=error.message;button.disabled=false;$('#ai-caption-file').disabled=false;$('#ai-fetch-captions').disabled=!managedData.youtube?.captions_enabled}}
 };
}

function timelineAIEvidence(video){
 const info=video.ai_analysis;if(!info)return '';
 return `<details class="card" style="margin-bottom:18px"><summary>AI 분석 근거 · 확인 필요 ${info.needs_check||0}개</summary><p class="source-note">${esc(new Date(info.created_at).toLocaleString('ko-KR'))} · ${esc(info.model)} · 자막에 나온 시각을 기준으로 만든 초안이에요. 영상과 대조해 확인해주세요.</p>${(info.evidence||[]).map(item=>`<div class="note-item"><b>${esc(item.number)} · ${esc(item.time)} · ${item.confidence==='high'?'근거 확인':'검토 필요'}</b><small>${esc(item.text)}</small></div>`).join('')}</details>`;
}
