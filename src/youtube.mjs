import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const scope='https://www.googleapis.com/auth/youtube.readonly';
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{status:400})};
export const publicSettings=rows=>Object.fromEntries(rows.filter(r=>!r.key.startsWith('youtube_')).map(r=>[r.key,r.value]));
export const youtubeYear=value=>{const time=Date.parse(value);return Number.isFinite(time)?new Date(time+9*3600000).getUTCFullYear():null};

export function classifyYouTubeTitle(title,classes){
 const compact=s=>s.replace(/\s/g,'').toLowerCase();
 let group='',rest=title;
 for(const candidate of [...classes].sort((a,b)=>b.length-a.length)){
  let end=0;while(end<title.length&&compact(title.slice(0,end)).length<compact(candidate).length)end++;
  if(compact(title.slice(0,end))===compact(candidate)&&(!title[end]||/\s/.test(title[end]))){group=candidate;rest=title.slice(end).trim();break}
 }
 if(!group)return {classes:[],class_name:'',book:'',subject:'',unit:''};
 const match=rest.match(/^(.+?)\s+(공통수학\s*[12]|대수|미적분\s*[12]?|확률과\s*통계|기하|수학\s*[ⅠⅡ12])\s*(.*)$/i);
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
 async status(){const data=await this.read();return {configured:this.configured,connected:!!data,channel_title:data?.channel?.title||'',channel_id:data?.channel?.id||'',last_sync:data?.last_sync||null,redirect_uri:this.redirectUri}}
 async start(session){
  if(!this.configured)fail('Render에 Google 연결 설정을 먼저 입력해주세요.');
  const now=Date.now()/1000;
  for(const row of await this.store.all('settings'))if(row.key.startsWith('youtube_state_')){const value=this.open(row.value);if(value.expires<now)await this.store.del('settings',{key:row.key})}
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  await this.store.put('settings',{key:'youtube_state_'+digest(state),value:this.seal({digest:session.digest,expires:now+600,verifier})});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:this.cfg.googleClientId,redirect_uri:this.redirectUri,response_type:'code',scope,access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  return {url:url.href,state};
 }
 async token(params){
  let response;try{response=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:this.cfg.googleClientId,client_secret:this.cfg.googleClientSecret}),signal:AbortSignal.timeout(20000)})}catch{fail('Google 연결이 지연돼요. 다시 시도해주세요.')}
  if(!response.ok)fail('Google 연결 승인을 다시 진행해주세요.');const result=await response.json();if(!result.access_token)fail('Google 연결 승인을 다시 진행해주세요.');return result;
 }
 async api(path,params,access){
  let response;try{response=await this.fetcher('https://www.googleapis.com/youtube/v3/'+path+'?'+new URLSearchParams(params),{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(20000)})}catch{fail('유튜브 응답이 지연돼요. 다시 시도해주세요.')}
  if(!response.ok)fail('유튜브 조회에 실패했어요. API 사용 설정·연결 권한·할당량을 확인해주세요.');return response.json();
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
  if(!tokens.scope?.split(' ').includes(scope)||!tokens.refresh_token)fail('영상 읽기 권한을 선택하고 다시 연결해주세요.');
  const channels=await this.api('channels',{part:'snippet,contentDetails',mine:'true',maxResults:'50'},tokens.access_token);
  if(channels.items?.length!==1)fail('수업 영상을 올리는 유튜브 채널을 선택해서 다시 연결해주세요.');
  const c=channels.items[0];if(!c.contentDetails?.relatedPlaylists?.uploads)fail('유튜브 채널의 업로드 목록을 찾지 못했어요.');
  await this.save({refresh_token:tokens.refresh_token,access_token:tokens.access_token,expires:Date.now()/1000+Number(tokens.expires_in||3600)-60,channel:{id:c.id,title:c.snippet.title,uploads:c.contentDetails.relatedPlaylists.uploads},last_sync:null});
 }
 async access(data){if(data.expires>Date.now()/1000)return data.access_token;const token=await this.token({grant_type:'refresh_token',refresh_token:data.refresh_token});data.access_token=token.access_token;data.expires=Date.now()/1000+Number(token.expires_in||3600)-60;if(token.refresh_token)data.refresh_token=token.refresh_token;await this.save(data);return data.access_token}
 async disconnect(){
  if(this.busy)fail('영상 가져오기가 끝난 뒤 연결을 해제해주세요.');
  const data=await this.read();let revoked=!data;
  if(data)try{const response=await this.fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:data.refresh_token}),signal:AbortSignal.timeout(15000)});revoked=response.ok}catch{}
  await this.store.del('settings',{key:'youtube_credentials'});
  for(const row of await this.store.all('settings'))if(row.key.startsWith('youtube_state_'))await this.store.del('settings',{key:row.key});
  return {revoked};
 }
 async sync({year=2026}={}){
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
   let imported=0,skipped=0,outside_year=0,unknown_date=0,unassigned=0,needs_review=0;const list=[...ids];
   for(let i=0;i<list.length;i+=50){
    const batch=await this.api('videos',{part:'snippet,status',id:list.slice(i,i+50).join(','),maxResults:'50'},access);
    for(const item of batch.items||[]){
     const publishedAt=Date.parse(item.snippet?.publishedAt);
     if(Number.isFinite(publishedAt))dates[item.id]=item.snippet.publishedAt;
     if(!Number.isFinite(publishedAt)){unknown_date++;continue}
     if(publishedAt<start||publishedAt>=end){outside_year++;continue}
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
