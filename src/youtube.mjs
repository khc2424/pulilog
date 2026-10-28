import { MAX_CAPTION_BYTES } from './timeline-ai.mjs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { classKey,canonicalClassName,titleClassAlias } from './classes.mjs';

const scope='https://www.googleapis.com/auth/youtube.readonly';
const captionScope='https://www.googleapis.com/auth/youtube.force-ssl';
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{status:400})};
export async function youtubeRequestFailure(response,context='유튜브 조회'){
 let reason='';try{const data=await response.json();reason=data.error?.errors?.[0]?.reason||data.error?.details?.find(d=>d.reason)?.reason||''}catch{}
 const messages={quotaExceeded:'유튜브 API 사용 한도에 도달했어요. 한도가 초기화된 뒤 다시 요청해주세요.',dailyLimitExceeded:'유튜브 일일 API 한도를 사용했어요. 한도가 초기화된 뒤 다시 요청해주세요.',rateLimitExceeded:'유튜브 요청이 잠시 몰렸어요. 조금 기다린 뒤 다시 요청해주세요.',userRateLimitExceeded:'유튜브 요청이 잠시 몰렸어요. 조금 기다린 뒤 다시 요청해주세요.',accessNotConfigured:'Google Cloud에서 YouTube Data API v3 사용 설정을 확인해주세요.',serviceDisabled:'Google Cloud에서 YouTube Data API v3 사용 설정을 확인해주세요.',insufficientPermissions:'현재 Google 연결에 필요한 권한이 없어요. 자막 권한으로 다시 연결해주세요.',forbidden:context.includes('자막')?'이 영상의 자막 접근이 거절됐어요. 영상을 올린 채널의 계정·자막 권한을 확인해주세요.':'유튜브 요청 권한이 없어요. 연결한 채널 계정을 확인해주세요.',videoNotFound:'이 영상을 유튜브에서 찾지 못했어요. 삭제·비공개 상태와 영상 주소를 확인해주세요.',captionNotFound:'선택한 자막이 없거나 변경됐어요. 자막 목록을 다시 확인해주세요.',couldNotConvert:'유튜브에서 이 자막을 요청한 형식으로 변환하지 못했어요. Studio에서 SRT/VTT 파일을 내려받아 사용해주세요.'};
 let message=messages[reason];if(!message)message=response.status===401?'Google 인증이 만료되거나 취소됐어요. 계정을 다시 연결해주세요.':response.status===429?'유튜브 요청이 잠시 몰렸어요. 조금 기다린 뒤 다시 요청해주세요.':response.status>=500?'유튜브 서버가 일시적으로 응답하지 못했어요. 잠시 후 다시 요청해주세요.':context+'에 실패했어요. 오류 코드: '+(/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(reason)?reason:'HTTP '+response.status);
 const error=new Error(message);error.status=400;error.youtube_reason=reason;throw error;
}
export const publicSettings=rows=>Object.fromEntries(rows.filter(r=>!r.key.startsWith('youtube_')).map(r=>[r.key,r.value]));
export const isYouTubeVideoReady=item=>item.status?.uploadStatus==='processed'&&(!item.processingDetails?.processingStatus||['succeeded','terminated'].includes(item.processingDetails.processingStatus));
export const youtubeYear=value=>{const time=Date.parse(value);return Number.isFinite(time)?new Date(time+9*3600000).getUTCFullYear():null};

export function classifyYouTubeTitle(title,classes){
 const compact=classKey;
 let group='',rest=title;
 const alias=titleClassAlias(title,classes);if(alias){group=alias.name;rest=alias.rest}
 if(!group)for(const candidate of [...new Set(classes.map(name=>canonicalClassName(name,classes)))].sort((a,b)=>b.length-a.length)){
  let end=0;while(end<title.length&&compact(title.slice(0,end)).length<compact(candidate).length)end++;
  if(compact(title.slice(0,end))===compact(candidate)&&(!title[end]||/\s/.test(title[end]))){group=candidate;rest=title.slice(end).trim();break}
 }
 if(!group)return {classes:[],class_name:'',book:'',subject:'',unit:''};
 const match=rest.match(/^(?:(.+?)\s+)?(공통수학\s*[12]|대수|미적분\s*[12]?|확률과\s*통계|기하|수학\s*[ⅠⅡ12])\s*(.*)$/i);
 return {classes:group?[group]:[],class_name:group||'',book:match?.[1]?.trim()||'',subject:match?.[2]?.replace(/\s/g,'')||'',unit:(match?.[3]||'').replace(/^\[[^\]]+\]\s*/,'').replace(/\s*#\s*\d+\s*$/,'').trim()};
}

export class YouTubeConnection {
 constructor(cfg,store,fetcher=fetch){this.cfg=cfg;this.store=store;this.fetcher=fetcher;this.key=createHash('sha256').update(cfg.sessionSecret).digest();this.busy=false}
 get configured(){return !!(this.cfg.googleClientId&&this.cfg.googleClientSecret)}
 get redirectUri(){return this.cfg.origin+'/api/youtube/callback'}
 seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64url')).join('.')}
 open(value){try{const [iv,tag,data]=value.split('.').map(s=>Buffer.from(s,'base64url'));const decipher=createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString())}catch{fail('유튜브 연결을 다시 진행해주세요.')}}
 async read(){const row=(await this.store.all('settings',{key:'youtube_credentials'}))[0];return row?this.open(row.value):null}
 async save(value){await this.store.put('settings',{key:'youtube_credentials',value:this.seal(value)})}
 async status(){const data=await this.read();return {configured:this.configured,connected:!!data,channel_title:data?.channel?.title||'',channel_id:data?.channel?.id||'',last_sync:data?.last_sync||null,captions_enabled:!!data?.scopes?.includes(captionScope),redirect_uri:this.redirectUri}}
 async start(session,{captions=false}={}){
  if(!this.configured)fail('Render에 Google 연결 설정을 먼저 입력해주세요.');
  const now=Date.now()/1000;
  for(const row of await this.store.all('settings'))if(row.key.startsWith('youtube_state_')){const value=this.open(row.value);if(value.expires<now)await this.store.del('settings',{key:row.key})}
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  await this.store.put('settings',{key:'youtube_state_'+digest(state),value:this.seal({digest:session.digest,expires:now+600,verifier,captions})});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:this.cfg.googleClientId,redirect_uri:this.redirectUri,response_type:'code',scope:captions?scope+' '+captionScope:scope,access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  return {url:url.href,state};
 }
 async token(params){
  let response;try{response=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:this.cfg.googleClientId,client_secret:this.cfg.googleClientSecret}),signal:AbortSignal.timeout(20000)})}catch{fail('Google 연결이 지연돼요. 다시 시도해주세요.')}
  if(!response.ok)fail('Google 연결 승인을 다시 진행해주세요.');const result=await response.json();if(!result.access_token)fail('Google 연결 승인을 다시 진행해주세요.');return result;
 }
 async api(path,params,access){
  let response;try{response=await this.fetcher('https://www.googleapis.com/youtube/v3/'+path+'?'+new URLSearchParams(params),{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(20000)})}catch{fail('유튜브 응답이 지연돼요. 다시 시도해주세요.')}
  if(!response.ok)await youtubeRequestFailure(response,path==='captions'?'자막 목록 조회':'유튜브 조회');return response.json();
 }
 async finish(query,cookieState){
  const state=query.get('state');if(!state||state!==cookieState)fail('연결 요청을 확인할 수 없어요. 사이트에서 다시 연결해주세요.');
  const key='youtube_state_'+digest(state),row=(await this.store.all('settings',{key}))[0];
  if(!row)fail('연결 요청이 만료됐어요. 다시 연결해주세요.');
  const pending=this.open(row.value);await this.store.del('settings',{key});
  const session=(await this.store.all('sessions',{digest:pending.digest,role:'teacher'}))[0];
  if(pending.expires<Date.now()/1000||!session||session.expires<Date.now()/1000)fail('선생님 로그인 후 다시 연결해주세요.');
  if(query.get('error')||!query.get('code'))fail('Google 연결 승인이 완료되지 않았어요.');
  const tokens=await this.token({code:query.get('code'),grant_type:'authorization_code',redirect_uri:this.redirectUri,code_verifier:pending.verifier});
  if(!tokens.scope?.split(' ').includes(scope)||!tokens.refresh_token||pending.captions&&!tokens.scope.split(' ').includes(captionScope))fail('영상 읽기 권한을 선택하고 다시 연결해주세요.');
  const channels=await this.api('channels',{part:'snippet,contentDetails',mine:'true',maxResults:'50'},tokens.access_token);
  if(channels.items?.length!==1)fail('수업 영상을 올리는 유튜브 채널을 선택해서 다시 연결해주세요.');
  const c=channels.items[0];if(!c.contentDetails?.relatedPlaylists?.uploads)fail('유튜브 채널의 업로드 목록을 찾지 못했어요.');
  await this.save({scopes:tokens.scope.split(' '),refresh_token:tokens.refresh_token,access_token:tokens.access_token,expires:Date.now()/1000+Number(tokens.expires_in||3600)-60,channel:{id:c.id,title:c.snippet.title,uploads:c.contentDetails.relatedPlaylists.uploads},last_sync:null});
 }
 async access(data){if(data.expires>Date.now()/1000)return data.access_token;const token=await this.token({grant_type:'refresh_token',refresh_token:data.refresh_token});data.access_token=token.access_token;data.expires=Date.now()/1000+Number(token.expires_in||3600)-60;if(token.refresh_token)data.refresh_token=token.refresh_token;await this.save(data);return data.access_token}
 async withVideoLock(action){
  if(this.busy)fail('영상 가져오기나 삭제가 진행 중이에요. 완료 후 다시 시도해주세요.');
  this.busy=true;try{return await action()}finally{this.busy=false}
 }
 async addDeletionExclusions(ids){
  const previous=(await this.store.all('settings',{key:'youtube_excluded_video_ids'}))[0]?.value||[];
  await this.store.put('settings',{key:'youtube_excluded_video_ids',value:[...new Set([...previous,...ids])]});
 }
 async rememberDeletedVideos(ids){
  return this.withVideoLock(async()=>{
   const current=new Set((await this.store.all('videos')).map(v=>v.id));
   const deleted=ids.filter(id=>!current.has(id));await this.addDeletionExclusions(deleted);return deleted.length;
  });
 }
 async removeVideos(ids){
  return this.withVideoLock(async()=>{
   const known=new Set((await this.store.all('videos')).map(v=>v.id));
   if(!ids.every(id=>known.has(id)))fail('영상 목록을 다시 확인해주세요.');
   await this.addDeletionExclusions(ids);
   await this.store.deleteVideos(ids);return ids.length;
  });
 }
 async disconnect(){
  if(this.busy)fail('영상 가져오기가 끝난 뒤 연결을 해제해주세요.');
  const data=await this.read();let revoked=!data;
  if(data)try{const response=await this.fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:data.refresh_token}),signal:AbortSignal.timeout(15000)});revoked=response.ok}catch{}
  await this.store.del('settings',{key:'youtube_credentials'});
  for(const row of await this.store.all('settings'))if(row.key.startsWith('youtube_state_'))await this.store.del('settings',{key:row.key});
  return {revoked};
 }
 async downloadCaptions(videoId){
  const data=await this.read();if(!data)fail('Google 계정을 먼저 연결해주세요.');
  if(!data.scopes?.includes(captionScope))fail('현재 연결에는 자막 내려받기 권한이 없어요. 자막 권한을 연결하거나 SRT/VTT 파일을 넣어주세요.');
  const access=await this.access(data);
  const result=await this.api('captions',{part:'snippet',videoId},access);
  const tracks=(result.items||[]).filter(t=>!t.snippet?.isDraft&&t.snippet?.status==='serving').sort((a,b)=>(b.snippet.language?.startsWith('ko')?1:0)-(a.snippet.language?.startsWith('ko')?1:0));
  if(!tracks.length)fail('가져올 수 있는 자막이 없어요. YouTube Studio에서 SRT/VTT 자막을 내려받아 넣어주세요.');
  let response;try{response=await this.fetcher('https://www.googleapis.com/youtube/v3/captions/'+encodeURIComponent(tracks[0].id)+'?tfmt=vtt',{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(30000)})}catch{fail('자막 다운로드가 지연돼요. 다시 시도해주세요.')}
  if(!response.ok)await youtubeRequestFailure(response,'자막 다운로드');
  const text=await response.text();if(Buffer.byteLength(text)>MAX_CAPTION_BYTES)fail('자막이 2MB를 넘어요. 자막 파일을 확인해주세요.');
  return {text,source:'youtube',language:tracks[0].snippet.language};
 }
 async inspectVideos(ids){
  const data=await this.read();if(!data)fail('Google 계정을 먼저 연결해주세요.');
  const access=await this.access(data),excluded=new Set((await this.store.all('settings',{key:'youtube_excluded_video_ids'}))[0]?.value||[]);
  const result=await this.api('videos',{part:'snippet,status,processingDetails',id:ids.join(','),maxResults:'50'},access);
  return {videos:(result.items||[]).map(item=>({id:item.id,title:item.snippet?.title,published_at:item.snippet?.publishedAt,upload_status:item.status?.uploadStatus||null,processing_status:item.processingDetails?.processingStatus||null,ready:isYouTubeVideoReady(item),excluded:excluded.has(item.id)}))};
 }
 async deferProcessingVideos(ids){
  return this.withVideoLock(async()=>{
   const status=await this.inspectVideos(ids),records=await this.store.all('videos'),favorites=await this.store.all('favorites');
   const pending=status.videos.filter(item=>item.processing_status==='processing'&&!item.ready).map(item=>item.id).filter(id=>{
    const video=records.find(v=>v.id===id);
    return video&&!video.notes&&!video.supplement_needed&&!video.timeline?.length&&!video.timeline_draft?.length&&!favorites.some(f=>f.video_id===id);
   });
   // This is an unfinished import, not a teacher deletion: allow retry after processing.
   if(pending.length)await this.store.deleteVideos(pending);
   return {deferred:pending.length,ids:pending};
  });
 }
 async sync({year=2026,newOnly=false,since=null}={}){
  if(!Number.isInteger(year)||year<2005||year>2100)fail('가져올 연도를 확인해주세요.');
  const start=Date.parse(`${year}-01-01T00:00:00+09:00`),end=Date.parse(`${year+1}-01-01T00:00:00+09:00`);
  if(this.busy)fail('영상 가져오기가 진행 중이에요. 잠시 후 확인해주세요.');this.busy=true;
  try{
   const data=await this.read();if(!data)fail('Google 계정을 먼저 연결해주세요.');const access=await this.access(data);
   const ids=new Set();let pageToken='';
   for(let page=0;page<100;page++){
    const result=await this.api('playlistItems',{part:'contentDetails',playlistId:data.channel.uploads,maxResults:'50',...(pageToken?{pageToken}:{})},access);
    for(const item of result.items||[])if(item.contentDetails?.videoId)ids.add(item.contentDetails.videoId);
    pageToken=result.nextPageToken||'';if(!pageToken)break;
   }
   if(pageToken)fail('영상이 5,000개를 넘어 분할 가져오기가 필요해요.');
   const existing=new Set((await this.store.all('videos')).map(v=>v.id));const classes=(await this.store.all('classes')).map(c=>c.name);
   const excluded=new Set((await this.store.all('settings',{key:'youtube_excluded_video_ids'}))[0]?.value||[]);
   const dates={...((await this.store.all('settings',{key:'youtube_video_dates'}))[0]?.value||{})};
   let imported=0,skipped=0,outside_year=0,unknown_date=0,unassigned=0,needs_review=0;
   const list=[...ids].filter(id=>{
    if(!newOnly)return true;
    if(existing.has(id)||excluded.has(id)){skipped++;return false}
    const time=Date.parse(dates[id]);
    if(Number.isFinite(time)&&(time<start||time>=end)){outside_year++;return false}
    return true;
   });
   for(let i=0;i<list.length;i+=50){
    const batch=await this.api('videos',{part:'snippet,status,processingDetails',id:list.slice(i,i+50).join(','),maxResults:'50'},access);
    for(const item of batch.items||[]){
     const publishedAt=Date.parse(item.snippet?.publishedAt);
     if(Number.isFinite(publishedAt))dates[item.id]=item.snippet.publishedAt;
     if(!Number.isFinite(publishedAt)){unknown_date++;continue}
     if(publishedAt<start||publishedAt>=end){outside_year++;continue}
     if(newOnly&&since&&publishedAt<Date.parse(since)){skipped++;continue}
     if(!isYouTubeVideoReady(item)){skipped++;continue}
     if(existing.has(item.id)||excluded.has(item.id)||item.snippet?.channelId!==data.channel.id||!['public','unlisted'].includes(item.status?.privacyStatus)||!item.status?.embeddable){skipped++;continue}
     const title=String(item.snippet.title).slice(0,300),parsed=classifyYouTubeTitle(title,classes);
     await this.store.saveVideo({id:item.id,title,...parsed,added_at:Date.now()/1000,timeline:[],timeline_draft:null,reviewed:false,published:true,notes:'',supplement_needed:false},parsed.classes);
     existing.add(item.id);imported++;
     if(!parsed.classes.length)unassigned++;
     if(!parsed.classes.length||!parsed.book||!parsed.subject||!parsed.unit)needs_review++;
    }
   }
   await this.store.put('settings',{key:'youtube_video_dates',value:dates});
   data.last_sync=new Date().toISOString();await this.save(data);return {year,imported,skipped,outside_year,unknown_date,unassigned,needs_review};
  }finally{this.busy=false}
 }
}
