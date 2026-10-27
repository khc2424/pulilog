import {createHash} from 'node:crypto';
const prefix='youtube_timeline_comment_',marker='[풀이로그 수업 타임라인]';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const hash=text=>createHash('sha256').update(text).digest('hex');
const stamp=sec=>sec>=3600?`${Math.floor(sec/3600)}:${String(Math.floor(sec/60)%60).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`:`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
export function timelineCommentText(rows){
 const lines=new Map();
 for(const row of [...rows].sort((a,b)=>a[4]-b[4])){
  if(!Array.isArray(row)||!Number.isInteger(row[4])||row[4]<0||row[4]>86400)fail('타임라인 시간을 확인해주세요.');
  const number=String(row[0]||'').trim();let title=String(row[2]||'').replace(/[\r\n]+/g,' ').trim();if(!title)fail('설명 제목을 확인해주세요.');
  const lead=/^\d+(?:[-.]\d+)?$/.test(number)?number+'번':number;
  if(lead&&lead!=='번호 확인 필요'&&!title.replace(/\s/g,'').startsWith(lead.replace(/\s/g,'')))title=lead+' · '+title;
  lines.set(row[4],lines.has(row[4])?lines.get(row[4])+' / '+title:title);
 }
 if(!lines.size)fail('학생에게 반영한 타임라인이 없어 댓글을 만들지 않았어요.');
 if(!lines.has(0))lines.set(0,'강의 시작');
 const text=marker+'\n\n'+[...lines].sort((a,b)=>a[0]-b[0]).map(([sec,title])=>stamp(sec)+' '+title).join('\n');
 if(text.length>9000)fail('타임라인이 댓글 길이 제한을 넘어요. 항목이나 설명 제목을 줄여주세요.');
 return text;
}
export class YouTubeTimelineComments {
 constructor(store,youtube){this.store=store;this.youtube=youtube;this.locks=new Set()}
 async setting(id){return (await this.store.all('settings',{key:prefix+id}))[0]?.value||{}}
 async enabled(){return (await this.store.all('settings',{key:'youtube_timeline_comments_auto'}))[0]?.value===true}
 async save(id,value){await this.store.put('settings',{key:prefix+id,value})}
 async request(path,access,{method='GET',body}={}){
  let response;try{response=await this.youtube.fetcher('https://www.googleapis.com/youtube/v3/'+path,{method,headers:{Authorization:'Bearer '+access,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})}catch{fail('유튜브 응답이 지연돼요. 중복 댓글을 막기 위해 잠시 후 게시 상태를 다시 확인해주세요.')}
  if(!response.ok){let reason='';try{reason=(await response.json()).error?.errors?.[0]?.reason||''}catch{}
   if(reason==='commentsDisabled')fail('이 영상은 유튜브 댓글 사용이 꺼져 있어요.');
   if(response.status===404)return null;
   if(response.status===401||response.status===403)fail('유튜브 댓글 작성 권한·댓글 설정·할당량을 확인해주세요.');
   fail('유튜브 댓글을 반영하지 못했어요. 잠시 후 다시 요청해주세요.');
  }
  return response.json();
 }
 async sync(video){
  if(this.locks.has(video.id))fail('이 영상의 댓글을 반영 중이에요. 잠시 후 확인해주세요.',429);
  this.locks.add(video.id);let state={};
  try{
   state=await this.setting(video.id);
   const text=timelineCommentText(video.timeline||[]),textHash=hash(text),data=await this.youtube.read();
   if(!data?.scopes?.includes('https://www.googleapis.com/auth/youtube.force-ssl'))fail('유튜브 자막·댓글 권한을 연결해주세요.');
   const channelId=data.channel?.id;if(!channelId)fail('연결된 유튜브 채널을 확인해주세요.');
   const access=await this.youtube.access(data),owned=await this.youtube.api('videos',{part:'snippet',id:video.id},access);
   if(owned.items?.[0]?.snippet?.channelId!==channelId)fail('연결한 본인 채널의 영상에만 댓글을 작성할 수 있어요.');
   let comment=null;
   if(state.comment_id){const found=await this.request('comments?'+new URLSearchParams({part:'snippet',id:state.comment_id,textFormat:'plainText'}),access);comment=found?.items?.[0]||null;
    if(comment&&(comment.snippet?.authorChannelId?.value!==channelId||comment.snippet?.videoId!==video.id))fail('기존 댓글의 영상·작성자 정보를 확인해주세요.');
   }
   if(!comment){
    let pageToken='';
    for(let page=0;page<10;page++){
     const found=await this.request('commentThreads?'+new URLSearchParams({part:'snippet',videoId:video.id,maxResults:'100',order:'time',textFormat:'plainText',...(pageToken?{pageToken}:{})}),access);
     if(!found)fail('영상 댓글을 확인하지 못했어요.');
     comment=found.items?.map(row=>row.snippet?.topLevelComment).find(c=>c?.snippet?.authorChannelId?.value===channelId&&c.snippet.textOriginal?.startsWith(marker));
     if(comment)break;pageToken=found.nextPageToken||'';if(!pageToken)break;
    }
    if(!comment&&pageToken)fail('기존 댓글 확인 범위를 넘었어요. 중복 방지를 위해 자동 게시를 멈췄어요.');
   }
   if(comment?.snippet?.textOriginal===text){state={...state,status:'done',comment_id:comment.id,channel_id:channelId,text_hash:textHash,error:'',updated_at:new Date().toISOString()};await this.save(video.id,state);return state}
   if(!comment&&state.attempted_at&&Date.now()-Date.parse(state.attempted_at)<120000&&['pending','failed'].includes(state.status))fail('이전 댓글의 게시 여부를 확인 중이에요. 2분 뒤 다시 요청해주세요.');
   state={...state,status:'pending',error:'',attempted_at:new Date().toISOString()};await this.save(video.id,state);
   const result=comment?await this.request('comments?part=snippet',access,{method:'PUT',body:{id:comment.id,snippet:{textOriginal:text}}}):await this.request('commentThreads?part=snippet',access,{method:'POST',body:{snippet:{channelId,videoId:video.id,topLevelComment:{snippet:{textOriginal:text}}}}});
   const id=comment?result?.id:result?.snippet?.topLevelComment?.id;if(!id)fail('댓글 게시 결과를 확인하지 못했어요. 잠시 후 다시 확인해주세요.');
   state={...state,status:'done',comment_id:id,channel_id:channelId,text_hash:textHash,error:'',updated_at:new Date().toISOString()};await this.save(video.id,state);return state;
  }catch(error){await this.save(video.id,{...state,status:'failed',error:error.status?error.message:'댓글 게시 상태를 확인해주세요.',updated_at:new Date().toISOString()});throw error}
  finally{this.locks.delete(video.id)}
 }
}
