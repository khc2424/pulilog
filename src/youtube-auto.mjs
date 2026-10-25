import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const key='youtube_auto_import';
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const invalid=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

export class YouTubeAutoImport {
 constructor(cfg,store,youtube){this.cfg=cfg;this.store=store;this.youtube=youtube;this.busy=false}
 async read(){return (await this.store.all('settings',{key}))[0]?.value||null}
 async save(value){await this.store.put('settings',{key,value})}
 async status(){const s=await this.read();return {prepared:!!s,enabled:!!s?.enabled,year:s?.year??2026,interval_minutes:10,last_checked:s?.last_checked||null,last_success:s?.last_success||null,last_imported:s?.last_imported??0,error:s?.error||'',scheduler_seen:!!s?.last_checked}}
 async prepare(year){
  if(!Number.isInteger(year)||year<2005||year>2100)invalid('가져올 연도를 확인해주세요.');
  if(!(await this.youtube.status()).connected)invalid('Google 계정을 먼저 연결해주세요.');
  if(this.busy||this.youtube.busy)invalid('영상 가져오기가 끝난 뒤 설정해주세요.',409);
  const previous=await this.read(),token=randomBytes(32).toString('base64url');
  await this.save({enabled:true,year,token_hash:hash(token),last_checked:null,last_success:previous?.last_success||null,last_imported:0,error:''});
  const url=this.cfg.origin+'/api/jobs/youtube-import';
  // The reusable credential stays in Vault; the cron command contains only its name.
  const sql=`begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $pulilog$
declare secret_id uuid;
begin
 select id into secret_id from vault.secrets where name = 'pulilog_youtube_import_token';
 if secret_id is null then
  perform vault.create_secret(${quote(token)}, 'pulilog_youtube_import_token');
 else
  perform vault.update_secret(secret_id, ${quote(token)});
 end if;
end $pulilog$;
select cron.schedule('pulilog-youtube-auto-import', '7,17,27,37,47,57 * * * *', $job$
 select net.http_post(
  url := ${quote(url)},
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pulilog_youtube_import_token')),
  body := '{}'::jsonb,
  timeout_milliseconds := 180000
 );
$job$);
-- Verify immediately, without waiting for the first scheduled run.
select net.http_post(
 url := ${quote(url)},
 headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pulilog_youtube_import_token')),
 body := '{}'::jsonb,
 timeout_milliseconds := 180000
);
commit;`;
  return {sql};
 }
 async toggle(enabled){const state=await this.read();if(!state)invalid('자동 가져오기 설정을 먼저 완료해주세요.');if(this.busy)invalid('가져오기가 끝난 뒤 변경해주세요.',409);await this.save({...state,enabled:enabled===true});return this.status()}
 async run(authorization){
  const state=await this.read(),token=String(authorization||'').replace(/^Bearer /,'');
  if(!state?.token_hash||!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(state.token_hash)))invalid('예약 실행 인증을 확인해주세요.',401);
  if(!state.enabled)return {skipped:'paused'};
  if(this.busy||this.youtube.busy)return {skipped:'busy'};
  if(state.last_checked&&Date.now()-Date.parse(state.last_checked)<8*60*1000)return {skipped:'recent'};
  this.busy=true;
  const checked=new Date().toISOString();
  try{
   await this.save({...state,last_checked:checked,error:''});
   const result=await this.youtube.sync({year:state.year,newOnly:true});
   await this.save({...state,last_checked:checked,last_success:new Date().toISOString(),last_imported:result.imported,error:''});
   return result;
  }catch(error){
   await this.save({...state,last_checked:checked,error:error.status===400?error.message:'자동 가져오기에 실패했어요. 다음 예약에 다시 시도해요.'});
   throw error;
  }finally{this.busy=false}
 }
}
