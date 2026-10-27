let studentPresenceTimer=null,presenceSequence=0,presencePosting=false;
const presenceClientId=crypto.randomUUID();
let presenceVideoId='',presencePlayer=null,presencePlayerState='browsing',presenceGeneration=0,youtubeReadyPromise=null;
let teacherPresenceRows=[],teacherPresenceTimer=null,teacherPresencePolling=false;
function youtubePlayerAPI(){
 if(window.YT?.Player)return Promise.resolve(window.YT);
 if(youtubeReadyPromise)return youtubeReadyPromise;
 youtubeReadyPromise=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{youtubeReadyPromise=null;reject(new Error('영상 상태 연결 지연'))},15000);
  const prior=window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);if(prior)prior();resolve(window.YT)};
  const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;script.onerror=()=>{clearTimeout(timeout);youtubeReadyPromise=null;reject(new Error('영상 상태 연결 실패'))};document.head.appendChild(script);
 });return youtubeReadyPromise;
}
function presenceSnapshot(online=true){
 let position=null,state=presencePlayerState;
 if(presencePlayer&&state!=='unavailable'){try{const code=presencePlayer.getPlayerState();state=({'-1':'loading',0:'ended',1:'playing',2:'paused',3:'buffering',5:'loading'})[code]||'loading';const value=presencePlayer.getCurrentTime();if(Number.isFinite(value))position=Math.max(0,value)}catch{state='unavailable'}}
 return {client_id:presenceClientId,sequence:++presenceSequence,online,visible:!document.hidden,video_id:presenceVideoId,state:presenceVideoId?state:'browsing',position_seconds:position};
}
async function sendStudentPresence(online=true,keepalive=false){
 if(!signedStudent||(!studentMode&&online))return;
 if(presencePosting&&online&&!keepalive)return;
 const data=presenceSnapshot(online);presencePosting=true;
 try{await fetch('/api/presence',{method:'POST',credentials:'same-origin',keepalive,headers:{'Content-Type':'application/json','X-AXIS-Request':'1'},body:JSON.stringify(data)})}catch{}finally{presencePosting=false}
}
function syncStudentPresence(){
 if(signedStudent&&studentMode){if(!studentPresenceTimer){studentPresenceTimer=setInterval(()=>sendStudentPresence(),20000);sendStudentPresence()}}
 else if(studentPresenceTimer){clearInterval(studentPresenceTimer);studentPresenceTimer=null;sendStudentPresence(false,true)}
}
function stopLessonTracking(){
 if(!presenceVideoId)return;presenceGeneration++;const old=presencePlayer;presencePlayer=null;presenceVideoId='';presencePlayerState='browsing';try{old?.destroy()}catch{}sendStudentPresence();
}
async function startLessonTracking(id){
 stopLessonTracking();const generation=++presenceGeneration;presenceVideoId=id;presencePlayerState='loading';sendStudentPresence();
 const frame=document.querySelector('#lesson-player');
 try{const YT=await youtubePlayerAPI();if(generation!==presenceGeneration||!frame?.isConnected)return;
  presencePlayer=new YT.Player(frame,{events:{onReady:()=>{if(generation===presenceGeneration)sendStudentPresence()},onStateChange:()=>{if(generation===presenceGeneration){presencePlayerState='loading';sendStudentPresence()}},onError:()=>{if(generation===presenceGeneration){presencePlayerState='unavailable';sendStudentPresence()}}}});
 }catch{if(generation===presenceGeneration){presencePlayerState='unavailable';sendStudentPresence()}}
}
function seekTrackedLesson(seconds){try{if(!presencePlayer?.seekTo)return false;presencePlayer.seekTo(seconds,true);presencePlayer.playVideo();return true}catch{return false}}
function playbackClock(value){if(value==null)return '위치 확인 중';const sec=Math.floor(value);return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}
function studentPresenceView(){
 return `<section class="card presence-card"><div class="card-header"><h2>지금 접속 중인 학생 <span class="library-count">${teacherPresenceRows.length}명</span></h2><span class="card-sub">최근 90초 접속 기준 · 약 20초마다 갱신</span></div>${teacherPresenceRows.length?`<div class="student-table-wrap"><table class="student-table"><thead><tr><th>학생 / 반</th><th>상태</th><th>보고 있는 영상</th><th>재생 위치</th><th>이번 시청</th></tr></thead><tbody>${teacherPresenceRows.map(row=>`<tr><td><b>${esc(row.name)}</b><p class="card-sub">${esc(row.class_name)}</p></td><td>${esc(!row.visible?'다른 화면':({browsing:'목록 확인 중',loading:'영상 준비 중',playing:'재생 중',paused:'일시 정지',buffering:'불러오는 중',ended:'재생 종료',unavailable:'재생 상태 확인 불가'})[row.state]||'확인 중')}</td><td>${esc(row.video_title||'—')}</td><td>${row.video_id?esc(playbackClock(row.position_seconds)):'—'}</td><td>${row.video_id?esc(playbackClock(row.watched_seconds)):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">현재 접속이 확인된 학생이 없어요.</div>'}<p class="source-note">이번 시청은 학생 화면이 보이는 상태에서 영상이 재생된 시간을 추정해요. 앱 종료나 연결이 끊기면 잠시 후 목록에서 빠져요.</p></section>`;
}
async function refreshPresenceDashboard(){
 if(studentMode||!teacherAuthorized||page!=='overview'){if(teacherPresenceTimer){clearInterval(teacherPresenceTimer);teacherPresenceTimer=null}return}
 if(teacherPresencePolling)return;teacherPresencePolling=true;
 try{teacherPresenceRows=(await requestAPI('/api/teacher/presence')).students;const panel=$('#student-presence-panel');if(panel)panel.innerHTML=studentPresenceView()}catch{}finally{teacherPresencePolling=false}
}
function bindPresenceDashboard(){
 if(teacherPresenceTimer){clearInterval(teacherPresenceTimer);teacherPresenceTimer=null}
 if($('#student-presence-panel')){refreshPresenceDashboard();teacherPresenceTimer=setInterval(refreshPresenceDashboard,20000)}
}
document.addEventListener('visibilitychange',()=>{if(signedStudent&&studentMode)sendStudentPresence(true,true)});
window.addEventListener('pagehide',()=>sendStudentPresence(false,true));
window.addEventListener('hashchange',()=>syncStudentPresence());
if(accountReady)syncStudentPresence();

function recordYouTubeOpen(videoId){
 if(!signedStudent||!studentMode)return;
 fetch('/api/student/youtube-open',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json','X-AXIS-Request':'1'},body:JSON.stringify({client_id:presenceClientId,event_id:crypto.randomUUID(),video_id:videoId})}).catch(()=>{});
 try{presencePlayer?.pauseVideo()}catch{}
}
