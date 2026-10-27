let timelineBatchJobs=[],timelineBatchTimer=null,timelineBatchPolling=false,timelineBatchDetailsOpen=null;
const timelineJobLabels={queued:'대기',running:'분석 중',done:'초안 완료',failed:'실패',skipped:'건너뜀',cancelled:'취소됨'};
function timelineBatchContents(){
 if(!timelineBatchJobs.length)return '';
 const active=timelineBatchJobs.filter(j=>['queued','running'].includes(j.status));
 return `<section class="card timeline-batch-card" style="margin-bottom:20px"><div class="card-header"><h2>타임라인 일괄 작업</h2><span class="card-sub">${active.length?'진행·대기 '+active.length+'개':'진행 중인 작업 없음'}</span></div><details data-batch-details ${(timelineBatchDetailsOpen??!!active.length)?'open':''}><summary>최근 작업 ${timelineBatchJobs.length}개 보기</summary>${timelineBatchJobs.map(job=>`<div class="teacher-task timeline-batch-job"><div><button class="teacher-title-link batch-title-link" data-batch-open="${esc(job.video_id)}">${esc(job.title)}</button><p>${esc(timelineJobLabels[job.status]||job.status)}${job.status==='done'?' · '+job.rows+'개 · 확인 필요 '+job.needs_check+'개'+(job.skipped_count?' · 후보 제외 '+job.skipped_count+'개':''):''}</p>${job.error?`<p class="source-note">${esc(job.error)}</p>`:''}</div><div class="heading-actions">${job.status==='queued'?`<button class="btn small" data-batch-cancel="${esc(job.id)}">대기 취소</button>`:''}${job.status==='done'?`<button class="btn small" data-batch-open="${esc(job.video_id)}">초안 보기</button>`:''}${job.status==='failed'?`<button class="btn small" data-batch-retry="${esc(job.video_id)}">다시 요청</button>`:''}</div></div>`).join('')}</details></section>`;
}
function bindTimelineJobActions(){
 const details=document.querySelector('[data-batch-details]');if(details)details.ontoggle=()=>timelineBatchDetailsOpen=details.open;
 document.querySelectorAll('[data-batch-cancel]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await requestAPI('/api/teacher/timeline/jobs/cancel',{id:button.dataset.batchCancel});await refreshTimelineBatch()}catch(error){toast(error.message);button.disabled=false}});
 document.querySelectorAll('[data-batch-retry]').forEach(button=>button.onclick=()=>openTimelineBatch([button.dataset.batchRetry]));
 document.querySelectorAll('[data-batch-open]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{rememberTeacherCourseReturn();await refreshTeacher();const id=button.dataset.batchOpen;if(!teacherVideo(id))throw new Error('삭제된 영상이거나 더 이상 목록에 없어요.');if(!timelineDirtyIds.has(id))delete timelineDrafts[id];selectedCourseId=id;courseTab='timeline';render()}catch(error){toast(error.message);button.disabled=false}});
}
async function refreshTimelineBatch(){
 if(studentMode||!teacherAuthorized||page!=='courses'||selectedCourseId){if(timelineBatchTimer){clearInterval(timelineBatchTimer);timelineBatchTimer=null}return}
 if(timelineBatchPolling)return;
 timelineBatchPolling=true;
 try{timelineBatchJobs=(await requestAPI('/api/teacher/timeline/jobs')).jobs;const panel=$('#timeline-batch-panel');if(panel){panel.innerHTML=timelineBatchContents();bindTimelineJobActions()}
  const active=timelineBatchJobs.some(j=>['queued','running'].includes(j.status));
  if(active&&!timelineBatchTimer)timelineBatchTimer=setInterval(refreshTimelineBatch,5000);
  if(!active&&timelineBatchTimer){clearInterval(timelineBatchTimer);timelineBatchTimer=null}
 }catch(error){if(timelineBatchTimer){clearInterval(timelineBatchTimer);timelineBatchTimer=null}toast(error.message)}finally{timelineBatchPolling=false}
}
function bindTimelineBatch(){
 if(timelineBatchTimer){clearInterval(timelineBatchTimer);timelineBatchTimer=null}
 if($('#generate-selected-timelines'))$('#generate-selected-timelines').onclick=()=>openTimelineBatch([...selectedTeacherVideoIds]);
 if($('#timeline-batch-panel')){bindTimelineJobActions();refreshTimelineBatch()}
}
async function openTimelineBatch(ids){
 if(!ids.length)return;
 if(ids.length>20){toast('한 번에 최대 20개까지 선택해주세요.');return}
 try{await refreshTeacher()}catch(error){toast(error.message);return}
 if(!managedData.ai?.configured){toast('Claude API 키를 먼저 설정해주세요.');return}
 if(!managedData.youtube?.captions_enabled){openCaptionPermission();return}
 const completedIds=ids.filter(id=>{const video=teacherVideo(id);return video?.timeline_draft?.length||video?.timeline?.length});
 const localDraftIds=ids.filter(id=>!completedIds.includes(id)&&timelineDirtyIds.has(id)&&timelineDrafts[id]?.length),eligible=ids.filter(id=>!completedIds.includes(id)&&!localDraftIds.includes(id));
 if(!eligible.length){toast(completedIds.length===ids.length?'선택한 영상은 모두 이미 분석이 완료됐어요.':"진행할 영상이 없어요. 편집 중인 초안을 먼저 저장해주세요.");return}
 openModal(`<h2 id="modal-title">선택 영상 타임라인 생성</h2><p>${completedIds.length?`${completedIds.length}건은 이미 분석이 완료됐습니다. 나머지 ${eligible.length}건만 진행하시겠습니까?`:`${eligible.length}개 영상의 타임라인 분석을 진행하시겠습니까?`}</p><p class="source-note">확인하면 ${eligible.length}개만 순서대로 분석해요. 영상별 Claude API 사용료가 발생해요.</p><p class="source-note">기존 타임라인·초안은 건너뛰며, 생성 결과는 학생에게 공개되지 않아요. 자막을 가져올 수 없는 영상은 실패로 표시하고 다음 영상으로 넘어가요.${localDraftIds.length?' 편집 중인 '+localDraftIds.length+'개는 이번 요청에서 제외해요.':''}</p><ul class="batch-confirm-list">${eligible.map(id=>`<li>${esc(teacherVideo(id)?.title||id)}</li>`).join('')}</ul><p class="form-error" id="timeline-batch-error" role="alert"></p><div class="modal-actions"><button class="btn" id="timeline-batch-dismiss">취소</button><button class="btn primary" id="timeline-batch-submit">확인 · ${eligible.length}개 분석</button></div>`);
 $('#timeline-batch-dismiss').onclick=closeModal;
 $('#timeline-batch-submit').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const result=await requestAPI('/api/teacher/timeline/batch',{ids:eligible});selectedTeacherVideoIds.clear();closeModal();render();toast(`${result.jobs.filter(j=>j.status==='queued').length}개를 분석 대기에 추가했어요.`)}catch(error){if($('#timeline-batch-error'))$('#timeline-batch-error').textContent=error.message;button.disabled=false}};
}
