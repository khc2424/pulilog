import http from 'node:http';
import { createHash,createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { LocalStore,SupabaseStore,StoreError } from './store.mjs';
import { normalizeSchedule } from './schedules.mjs';
import { canonicalClassName,mergeClassAliases,titleClassAlias } from './classes.mjs';
import { YouTubeConnection,publicSettings,youtubeYear } from './youtube.mjs';
import { TimelineAI,timelineFingerprint,parseCaptions } from './timeline-ai.mjs';
import { YouTubeAutoImport } from './youtube-auto.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../public');
const assets=new Map([['/','index.html'],...['index.html','search.js','app.js','accounts.js','teacher.js','workbench.js','production.js','timeline-ai.js','style.css'].map(f=>['/'+f,f])]);
const hash=s=>createHash('sha256').update(s).digest('hex');
const clean=(v,max=300)=>String(v??'').trim().slice(0,max);
const check=(ok,message='입력 내용을 확인해주세요.',status=400)=>{if(!ok){const e=new Error(message);e.status=status;throw e}};
const phone=v=>{const p=clean(v).replace(/[^0-9]/g,'');check(/^010\d{8}$/.test(p),'휴대폰 번호 11자리를 입력해주세요.');return p};
function publicVideo(v,favorite=false){return Object.fromEntries([...['id','title','class_name','book','subject','unit','added_at','timeline','youtube_published_at'].map(k=>[k,v[k]]),['favorite',favorite],['is_new',Date.now()/1000-v.added_at<604800]])}
function cleanRows(rows){check(Array.isArray(rows)&&rows.length<=500);return rows.map(r=>{check(Array.isArray(r)&&r.length===5);const [n,p,t,,sec]=r;check(clean(n)&&clean(t)&&Number.isInteger(sec)&&sec>=0&&sec<=86400&&Number.isInteger(Number(p||0))&&Number(p||0)>=0&&Number(p||0)<=10000);const label=sec>=3600?`${Math.floor(sec/3600)}:${String(Math.floor(sec%3600/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`:`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;return[clean(n,30),Number(p||0),clean(t,200),label,sec]})}
async function body(req,max=100000){let n=0;const chunks=[];for await(const c of req){n+=c.length;check(n<=max,'입력 내용이 너무 길어요.',413);chunks.push(c)}let d;try{d=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{check(false,'입력 형식을 확인해주세요.')}check(d&&typeof d==='object'&&!Array.isArray(d));return d}
function cookieToken(req,role){const name=role==='teacher'?'axis_admin':'axis_student';return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||''}

export function createApp(cfg,store,options={}){
 const youtube=new YouTubeConnection(cfg,store,options.youtubeFetch);
 const youtubeAuto=new YouTubeAutoImport(cfg,store,youtube);
 const timelineAI=new TimelineAI(cfg,options.aiFetch);
 const oauthCookie=(value,expire=false)=>`pl_youtube_state=${value}; Path=/api/youtube/callback; HttpOnly; SameSite=Lax; Max-Age=${expire?0:600}${cfg.production?'; Secure':''}`;
 const send=(res,status,data,cookie)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...(cookie?{'Set-Cookie':cookie}:{})});res.end(JSON.stringify(data))};
 const cookie=(role,token,remember=false,expire=false)=>`${role==='teacher'?'axis_admin':'axis_student'}=${token}; Path=/; HttpOnly; SameSite=Strict${cfg.production?'; Secure':''}${expire?'; Max-Age=0':remember?'; Max-Age=2592000':''}`;
 async function session(req,role){const token=cookieToken(req,role);if(!token)return null;const row=(await store.all('sessions',{digest:hash(token),role}))[0];if(!row||row.expires<=Date.now()/1000){if(row)await store.del('sessions',{digest:row.digest});return null}if(role==='teacher')return row;const s=(await store.all('students',{id:row.student_id}))[0];return s?.active?s:null}
 async function requireRole(req,role='student'){const s=await session(req,role);check(s,'로그인이 필요해요.',401);return s}
 async function newSession(role,student_id=null,remember=false){const token=randomBytes(32).toString('base64url');await store.put('sessions',{digest:hash(token),role,student_id,expires:Date.now()/1000+(remember?2592000:43200)});return cookie(role,token,remember)}
 async function rate(req,path){const remote=cfg.trustProxy?clean(req.headers['x-forwarded-for']).split(',').at(-1).trim():req.socket.remoteAddress;const key=createHmac('sha256',cfg.sessionSecret).update(path+':'+remote).digest('hex');check(await store.consumeRate(key,15,60),'잠시 후 다시 시도해주세요.',429)}
 async function allowedVideos(s){
  const [relations,videos,settings]=await Promise.all([store.all('video_classes',{class_name:s.class_name}),store.all('videos'),store.all('settings',{key:'youtube_video_dates'})]);
  const ids=new Set(relations.map(r=>r.video_id)),dates=settings[0]?.value||{};
  const publishedTime=v=>{const time=Date.parse(dates[v.id]);return Number.isFinite(time)?time:0};
  return videos.filter(v=>v.published&&ids.has(v.id)).sort((a,b)=>publishedTime(b)-publishedTime(a)||b.added_at-a.added_at||a.id.localeCompare(b.id)).map(v=>({...v,youtube_published_at:Number.isFinite(Date.parse(dates[v.id]))?dates[v.id]:null}));
 }
 return http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://i.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if(cfg.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   const url=new URL(req.url,cfg.origin),path=url.pathname;
   if(req.method==='GET'&&path==='/api/youtube/callback'){
    const state=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('pl_youtube_state='))?.slice(17)||'';
    let outcome='connected';try{await youtube.finish(url.searchParams,state)}catch{outcome='failed'}
    res.writeHead(303,{Location:cfg.origin+'/?youtube='+outcome+'#settings','Set-Cookie':oauthCookie('',true)});return res.end();
   }
   if(req.method==='GET'&&path==='/healthz'){await store.all('settings',{key:'schema_version'});return send(res,200,{ok:true})}
   if(req.method==='POST'&&path==='/api/jobs/youtube-import'){
    check(req.headers.host===new URL(cfg.origin).host,'허용되지 않은 주소예요.',403);
    return send(res,200,await youtubeAuto.run(req.headers.authorization));
   }
   if(req.method==='GET'&&path==='/api/status')return send(res,200,{name:'풀이로그',database:cfg.driver,environment:cfg.production?'production':'development',youtube_connected:(await youtube.status()).connected,video_analysis_connected:false,timeline_analysis_configured:timelineAI.status().configured,demo_data:false});
   if(req.method==='GET'&&path==='/api/session'){const s=await session(req,'student');return send(res,200,{student:s?{id:s.id,name:s.name,class_name:s.class_name}:null,teacher:!!await session(req,'teacher')})}
   if(req.method==='GET'&&path==='/api/videos'){const s=await requireRole(req);const fav=new Set((await store.all('favorites',{student_id:s.id})).map(f=>f.video_id));return send(res,200,{videos:(await allowedVideos(s)).map(v=>publicVideo(v,fav.has(v.id)))})}
   if(req.method==='GET'&&path==='/api/teacher/state'){
    await requireRole(req,'teacher');const [students,videos,relations,class_info,settings]=await Promise.all(['students','videos','video_classes','classes','settings'].map(t=>store.all(t)));
    const videoDates=settings.find(row=>row.key==='youtube_video_dates')?.value||{};
    return send(res,200,{students:students.sort((a,b)=>a.id-b.id),classes:class_info.map(c=>c.name).sort(),class_info,settings:publicSettings(settings),youtube:{...await youtube.status(),auto_import:await youtubeAuto.status()},ai:timelineAI.status(),videos:videos.sort((a,b)=>b.added_at-a.added_at).map(v=>({...v,ai_analysis:settings.find(row=>row.key==='youtube_timeline_analysis_'+v.id)?.value||null,youtube_year:youtubeYear(videoDates[v.id]),youtube_published_at:Number.isFinite(Date.parse(videoDates[v.id]))?videoDates[v.id]:null,is_new:Date.now()/1000-v.added_at<604800,classes:relations.filter(r=>r.video_id===v.id).map(r=>r.class_name),has_draft:v.timeline_draft!==null,timeline_draft:v.timeline_draft??v.timeline}))});
   }
   if(req.method==='GET'&&assets.has(path)){const file=assets.get(path);const contents=await readFile(resolve(ROOT,file));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});return res.end(contents)}
   if(req.method!=='POST')return send(res,404,{error:'없는 페이지예요.'});
   check(req.headers['x-axis-request']==='1','앱에서 다시 시도해주세요.',403);
   check(!req.headers.origin||req.headers.origin===cfg.origin,'허용되지 않은 요청이에요.',403);
   check(req.headers.host===new URL(cfg.origin).host,'허용되지 않은 주소예요.',403);
   const d=await body(req,path==='/api/teacher/timeline/analyze'?500000:100000);
   if(path==='/api/login'||path==='/api/teacher/login'){
    await rate(req,path);
    if(path==='/api/teacher/login'){check(timingSafeEqual(Buffer.from(hash(String(d.code||''))),Buffer.from(hash(cfg.adminCode))),'선생님 접속 코드를 확인해주세요.',401);return send(res,200,{ok:true},await newSession('teacher'))}
    const s=(await store.all('students',{phone:phone(d.phone),active:true}))[0];check(s,'등록된 번호를 확인해주세요.',401);return send(res,200,{student:{id:s.id,name:s.name,class_name:s.class_name}},await newSession('student',s.id,d.remember===true));
   }
   if(path==='/api/logout'||path==='/api/teacher/logout'){const role=path.includes('/teacher/')?'teacher':'student';const token=cookieToken(req,role);if(token)await store.del('sessions',{digest:hash(token)});return send(res,200,{ok:true},cookie(role,'',false,true))}
   if(path==='/api/favorite'){const s=await requireRole(req);check((await allowedVideos(s)).some(v=>v.id===d.video_id),'이 반에서 볼 수 없는 영상이에요.',404);const value={student_id:s.id,video_id:d.video_id};if(d.favorite===true)await store.put('favorites',value);else await store.del('favorites',value);return send(res,200,{favorite:d.favorite===true})}
   const teacherSession=await requireRole(req,'teacher');
   if(path==='/api/teacher/videos/recover-deletion-history'){
    const extra=d.ids??[];check(Array.isArray(extra)&&extra.length<=5000&&extra.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)));
    const dates=(await store.all('settings',{key:'youtube_video_dates'}))[0]?.value||{};
    const current=new Set((await store.all('videos')).map(v=>v.id));
    const candidates=[...new Set([...Object.keys(dates),...extra])].filter(id=>/^[A-Za-z0-9_-]{11}$/.test(id));
    const absent=candidates.filter(id=>!current.has(id)).sort();
    if(d.execute!==true)return send(res,200,{known_count:candidates.length,absent_count:absent.length,current_count:current.size,ids:absent});
    check(Array.isArray(d.confirmed_ids)&&d.confirmed_ids.length===absent.length&&new Set(d.confirmed_ids).size===absent.length&&absent.every(id=>d.confirmed_ids.includes(id)),'삭제 이력이 변경됐어요. 목록을 다시 확인해주세요.',409);
    return send(res,200,{recorded:await youtube.rememberDeletedVideos(absent)});
   }
   if(path==='/api/teacher/videos/apply-title-aliases'){
    const registered=(await store.all('classes')).map(g=>g.name),relations=await store.all('video_classes');
    const targets=(await store.all('videos')).map(video=>({video,alias:titleClassAlias(video.title,registered)})).filter(({video,alias})=>alias&&!relations.some(r=>r.video_id===video.id&&r.class_name===alias.name));
    if(d.execute!==true)return send(res,200,{assign_count:targets.length,ids:targets.map(({video})=>video.id)});
    for(const {video,alias} of targets){const groups=[...new Set([...relations.filter(r=>r.video_id===video.id).map(r=>r.class_name),alias.name])];await store.saveVideo({...video,class_name:video.class_name||alias.name},groups)}
    return send(res,200,{updated:targets.length});
   }
   if(path==='/api/teacher/videos/delete'){
    check(Array.isArray(d.ids)&&d.ids.length>0&&d.ids.length<=5000&&d.ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)));
    const ids=[...new Set(d.ids)],known=new Set((await store.all('videos')).map(v=>v.id));check(ids.every(id=>known.has(id)),'영상 목록을 다시 확인해주세요.');
    if(d.execute!==true)return send(res,200,{delete_count:ids.length,ids});
    return send(res,200,{deleted:await youtube.removeVideos(ids)});
   }
   if(path==='/api/teacher/videos/visibility'){
    check(Array.isArray(d.ids)&&d.ids.length<=5000&&d.ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id))&&typeof d.published==='boolean');
    const ids=[...new Set(d.ids)],known=new Set((await store.all('videos')).map(v=>v.id));check(ids.every(id=>known.has(id)),'영상 목록을 다시 확인해주세요.');
    await store.setVideosVisibility(ids,d.published);return send(res,200,{updated:ids.length,published:d.published});
   }
   if(path==='/api/teacher/videos/remove-outside-year'){
    const year=d.keep_year;check(Number.isInteger(year)&&year>=2005&&year<=2100,'유지할 연도를 확인해주세요.');
    const dates=(await store.all('settings',{key:'youtube_video_dates'}))[0]?.value||{};
    const videos=await store.all('videos'),targets=videos.filter(v=>youtubeYear(dates[v.id])!==null&&youtubeYear(dates[v.id])!==year);
    const unknown=videos.filter(v=>youtubeYear(dates[v.id])===null).length;
    if(d.execute!==true)return send(res,200,{keep_year:year,delete_count:targets.length,unknown_date:unknown,ids:targets.map(v=>v.id)});
    check(Array.isArray(d.ids)&&d.ids.length===targets.length&&new Set(d.ids).size===targets.length&&targets.every(v=>d.ids.includes(v.id)),'삭제 대상이 변경됐어요. 목록을 다시 확인해주세요.',409);
    await youtube.removeVideos(targets.map(v=>v.id));
    return send(res,200,{deleted:targets.length,kept:videos.length-targets.length,unknown_date:unknown});
   }
   if(path==='/api/teacher/youtube/connect'){const started=await youtube.start(teacherSession,{captions:d.captions===true});return send(res,200,{url:started.url},oauthCookie(started.state))}
   if(path==='/api/teacher/timeline/captions'){
    const id=clean(d.id,11);check((await store.all('videos',{id})).length,'영상을 찾을 수 없어요.',404);
    const caption=await youtube.downloadCaptions(id),cues=parseCaptions(caption.text);
    return send(res,200,{...caption,cue_count:cues.length});
   }
   if(path==='/api/teacher/timeline/analyze'){
    const id=clean(d.id,11),video=(await store.all('videos',{id}))[0];check(video,'영상을 찾을 수 없어요.',404);
    check(!video.timeline_draft?.length||d.replace_draft===true,'기존 초안 교체에 동의한 뒤 다시 실행해주세요.');
    const fingerprint=timelineFingerprint(video),result=await timelineAI.analyze(d.captions,video);
    const latest=(await store.all('videos',{id}))[0];check(latest,'분석 중 영상이 삭제됐어요. 결과를 저장하지 않았어요.',404);
    check(timelineFingerprint(latest)===fingerprint,'분석 중 타임라인이 변경되어 결과를 덮어쓰지 않았어요.',412);
    const analysis={created_at:new Date().toISOString(),model:result.model,source:d.source==='youtube'?'youtube':'file',evidence:result.evidence,needs_check:result.needs_check,cue_count:result.cue_count,usage:result.usage};
    await store.patch('videos',{id},{timeline_draft:result.rows,reviewed:false});
    await store.put('settings',{key:'youtube_timeline_analysis_'+id,value:analysis});
    return send(res,200,{rows:result.rows,analysis});
   }
   if(path==='/api/teacher/youtube/video-status'){
    check(Array.isArray(d.ids)&&d.ids.length>0&&d.ids.length<=50&&d.ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)));
    return send(res,200,await youtube.inspectVideos(d.ids));
   }
   if(path==='/api/teacher/youtube/defer-processing'){
    check(Array.isArray(d.ids)&&d.ids.length>0&&d.ids.length<=50&&d.ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)));
    return send(res,200,await youtube.deferProcessingVideos(d.ids));
   }
   if(path==='/api/teacher/youtube/auto-setup')return send(res,200,await youtubeAuto.prepare(d.year??2026));
   if(path==='/api/teacher/youtube/auto-toggle')return send(res,200,await youtubeAuto.toggle(d.enabled));
   if(path==='/api/teacher/youtube/sync')return send(res,200,await youtube.sync({year:d.year??2026}));
   if(path==='/api/teacher/youtube/disconnect')return send(res,200,await youtube.disconnect());
   if(path==='/api/teacher/classes/merge-aliases')return send(res,200,await mergeClassAliases(store,clean(d.name,60)));
   if(path==='/api/teacher/class'){const name=canonicalClassName(clean(d.name,60),(await store.all('classes')).map(g=>g.name)),schedule=normalizeSchedule(d);check(name&&schedule!==null,'반 이름과 선택한 수업 요일을 확인해주세요.');await store.put('classes',{name,schedule});return send(res,200,{ok:true})}
   if(path==='/api/teacher/student'){
    const id=d.id==null?null:Number(d.id);check(id===null||Number.isSafeInteger(id)&&id>0);const name=clean(d.name,60),class_name=canonicalClassName(clean(d.class_name,60),(await store.all('classes')).map(g=>g.name));check(name&&class_name);check((await store.all('classes',{name:class_name})).length,'반을 먼저 등록해주세요.');if(id!==null)check((await store.all('students',{id})).length,'학생을 찾을 수 없어요.',404);
    const student=await store.saveStudent({...(id===null?{}:{id}),name,phone:phone(d.phone),class_name,active:d.active!==false});return send(res,200,{ok:true,id:student.id});
   }
   if(path==='/api/teacher/video'){
    const id=clean(d.id,11);check(/^[A-Za-z0-9_-]{11}$/.test(id));const old=(await store.all('videos',{id}))[0];const raw=d.classes??[d.class_name];check(Array.isArray(raw)&&raw.length<=50);const registered=(await store.all('classes')).map(g=>g.name);const classes=[...new Set(raw.map(g=>canonicalClassName(clean(g,60),registered)).filter(Boolean))];
    const v={...(old||{id,added_at:Date.now()/1000,timeline:[],reviewed:false,timeline_draft:null,notes:'',supplement_needed:false}),title:clean(d.title),class_name:classes[0]||'',book:clean(d.book),subject:clean(d.subject),unit:clean(d.unit),published:d.published==null?(old?.published??true):(d.published===true||d.published===1)};check(v.title);await store.saveVideo(v,classes);return send(res,200,{ok:true});
   }
   if(path==='/api/teacher/timeline'||path==='/api/teacher/note'){
    const old=(await store.all('videos',{id:clean(d.id,11)}))[0];check(old,'영상을 찾을 수 없어요.',404);
    let changes;if(path.endsWith('/note')){changes={notes:clean(d.notes,5000),supplement_needed:d.supplement_needed===true}}else{const rows=cleanRows(d.rows);check(d.publish!==true||rows.every(r=>r[0]!=='번호 확인 필요'),'번호 확인 필요 항목의 문제 번호를 수정하거나 삭제한 뒤 반영해주세요.');changes=d.publish===true?{timeline:rows,timeline_draft:null,reviewed:true}:{timeline_draft:rows,reviewed:false}}
    await store.patch('videos',{id:old.id},changes);return send(res,200,{ok:true});
   }
   if(path==='/api/teacher/settings'){const channel=clean(d.channel_url,500);check(!channel||/^https:\/\/(www\.)?youtube\.com\/(@[\w.\-]+|channel\/[\w\-]+)\/?$/.test(channel),'유튜브 채널 주소를 확인해주세요.');await store.put('settings',{key:'channel_url',value:channel});return send(res,200,{ok:true})}
   return send(res,404,{error:'없는 기능이에요.'});
  }catch(e){const status=e instanceof StoreError?e.status:e.status||500;send(res,status,{error:status===409?'이미 등록된 전화번호예요.':status>=500?'서버 연결을 확인해주세요.':e.message})}
 });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const cfg=config();const store=cfg.driver==='supabase'?new SupabaseStore(cfg.supabaseUrl,cfg.supabaseKey):new LocalStore(cfg.dbPath);
 const app=createApp(cfg,store);app.listen(cfg.port,cfg.production?'0.0.0.0':'127.0.0.1',()=>console.log(`풀이로그: ${cfg.origin} (${cfg.driver})`));
 const stop=()=>app.close(()=>{store.close();process.exit(0)});process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
