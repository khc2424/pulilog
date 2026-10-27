import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const tables=new Set(['classes','students','videos','video_classes','favorites','sessions','settings']);
const keyOf=(t,r)=>t==='classes'?r.name:t==='sessions'?r.digest:t==='settings'?r.key:t==='video_classes'?`${r.video_id}:${r.class_name}`:t==='favorites'?`${r.student_id}:${r.video_id}`:String(r.id);
const match=(r,f)=>Object.entries(f).every(([k,v])=>r[k]===v);
const activityPrefix='youtube_student_activity_';
const selectFields=fields=>{if(fields===null)return '*';if(!Array.isArray(fields)||!fields.length||fields.some(f=>!/^[a-z_]+$/.test(f)))throw new Error('Invalid fields');return fields.join(',')};
export class StoreError extends Error { constructor(status=503){super('데이터 저장소 연결을 확인해주세요.');this.status=status} }

export class LocalStore {
 constructor(path){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(t TEXT NOT NULL,k TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(t,k)); CREATE TABLE IF NOT EXISTS rate_limits(k TEXT PRIMARY KEY,n INTEGER NOT NULL,until REAL NOT NULL);')}
 rows(t){if(!tables.has(t))throw new Error('Unknown table');return this.db.prepare('SELECT data FROM records WHERE t=?').all(t).map(r=>JSON.parse(r.data))}
 async all(t,f={},fields=null){selectFields(fields);const rows=this.rows(t).filter(r=>match(r,f)&&(t!=='settings'||f.key!==undefined||!r.key.startsWith(activityPrefix)));return fields?rows.map(r=>Object.fromEntries(fields.map(k=>[k,r[k]]))):rows}
 async settingsPrefix(prefix){if(!/^[a-zA-Z0-9_-]{1,150}$/.test(prefix))throw new Error('Invalid prefix');return this.rows('settings').filter(r=>r.key.startsWith(prefix))}
 write(t,r){if(!tables.has(t))throw new Error('Unknown table');this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(t,k) DO UPDATE SET data=excluded.data').run(t,keyOf(t,r),JSON.stringify(r));return r}
 async put(t,r){if(t==='students'&&r.id==null)r={...r,id:Math.max(0,...this.rows(t).map(x=>x.id))+1};return this.write(t,r)}
 remove(t,f){for(const r of this.rows(t).filter(r=>match(r,f)))this.db.prepare('DELETE FROM records WHERE t=? AND k=?').run(t,keyOf(t,r))}
 async del(t,f){this.remove(t,f)}
 async setVideosVisibility(ids,published){this.db.exec('BEGIN IMMEDIATE');try{for(const id of ids){const row=this.rows('videos').find(v=>v.id===id);if(row)this.write('videos',{...row,published})}this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}}
 async deleteVideos(ids){this.db.exec('BEGIN IMMEDIATE');try{for(const id of ids){this.remove('favorites',{video_id:id});this.remove('video_classes',{video_id:id});this.remove('videos',{id})}this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}}
 async patch(t,f,changes){for(const r of this.rows(t).filter(r=>match(r,f)))this.write(t,{...r,...changes})}
 async saveVideo(v,classes){this.db.exec('BEGIN IMMEDIATE');try{const old=this.rows('videos').find(x=>x.id===v.id);this.write('videos',old?{...old,...Object.fromEntries(['title','class_name','book','subject','unit','published'].map(k=>[k,v[k]]))}:v);this.remove('video_classes',{video_id:v.id});for(const g of classes){if(!this.rows('classes').some(r=>r.name===g))this.write('classes',{name:g,schedule:''});this.write('video_classes',{video_id:v.id,class_name:g})}this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}}
 async saveStudent(s){this.db.exec('BEGIN IMMEDIATE');try{const old=this.rows('students').find(x=>x.id===s.id);if(this.rows('students').some(x=>x.phone===s.phone&&x.id!==s.id))throw new StoreError(409);if(!this.rows('classes').some(x=>x.name===s.class_name))throw new StoreError(400);if(!s.id)s={...s,id:Math.max(0,...this.rows('students').map(x=>x.id))+1};this.write('students',s);if(old&&(old.phone!==s.phone||!s.active))this.remove('sessions',{student_id:s.id});this.db.exec('COMMIT');return s}catch(e){this.db.exec('ROLLBACK');throw e}}
 async consumeRate(key,limit,seconds){const now=Date.now()/1000;this.db.prepare('DELETE FROM rate_limits WHERE until<?').run(now);const r=this.db.prepare('SELECT * FROM rate_limits WHERE k=?').get(key);const n=r?r.n+1:1;this.db.prepare('INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET n=excluded.n,until=excluded.until').run(key,n,r?.until||now+seconds);return n<=limit}
 close(){this.db.close()}
}

export class SupabaseStore {
 constructor(url,key,fetcher=fetch){this.url=url.replace(/\/$/,'');this.key=key;this.fetcher=fetcher}
 async request(path,{method='GET',body,headers={}}={}){
  const h={apikey:this.key,'Content-Type':'application/json',...headers};
  if(!this.key.startsWith('sb_secret_'))h.Authorization=`Bearer ${this.key}`;
  let res;try{res=await this.fetcher(`${this.url}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)})}catch{throw new StoreError()}
  if(!res.ok)throw new StoreError(res.status===409?409:503);
  return res.status===204?null:res.json();
 }
 query(t,f){if(!tables.has(t))throw new Error('Unknown table');const p=new URLSearchParams();for(const [k,v]of Object.entries(f)){if(!/^[a-z_]+$/.test(k))throw new Error('Invalid field');p.set(k,`eq.${v}`)}return `pl_${t}?${p}`}
 async all(t,f={},fields=null){const select=selectFields(fields),out=[];for(let offset=0;offset<100000;offset+=1000){const rows=await this.request(`${this.query(t,f)}${t==='settings'&&f.key===undefined?'&key=not.like.'+activityPrefix+'*':''}&select=${select}&limit=1000&offset=${offset}&order=${t==='students'?'id':t==='classes'?'name':t==='videos'?'id':t==='settings'?'key':t==='sessions'?'digest':t==='favorites'?'student_id,video_id':'video_id,class_name'}`);out.push(...rows);if(rows.length<1000)return out}throw new StoreError()}
 async settingsPrefix(prefix){if(!/^[a-zA-Z0-9_-]{1,150}$/.test(prefix))throw new Error('Invalid prefix');const out=[];for(let offset=0;offset<100000;offset+=1000){const rows=await this.request('pl_settings?'+new URLSearchParams({key:'like.'+prefix+'*',select:'key,value',order:'key',limit:'1000',offset:String(offset)}));out.push(...rows);if(rows.length<1000)return out}throw new StoreError()}
 async put(t,r){const rows=await this.request(`pl_${t}`,{method:'POST',body:r,headers:{Prefer:'resolution=merge-duplicates,return=representation'}});return rows[0]}
 async del(t,f){await this.request(this.query(t,f),{method:'DELETE',headers:{Prefer:'return=minimal'}})}
 async setVideosVisibility(ids,published){
  if(!ids.every(id=>/^[A-Za-z0-9_-]{11}$/.test(id)))throw new Error('Invalid video IDs');
  for(let i=0;i<ids.length;i+=100){const query=new URLSearchParams({id:'in.('+ids.slice(i,i+100).join(',')+')'});await this.request('pl_videos?'+query,{method:'PATCH',body:{published},headers:{Prefer:'return=minimal'}})}
 }
 async deleteVideos(ids){
  if(!ids.every(id=>/^[A-Za-z0-9_-]{11}$/.test(id)))throw new Error('Invalid video IDs');
  for(let i=0;i<ids.length;i+=100){const query=new URLSearchParams({id:'in.('+ids.slice(i,i+100).join(',')+')'});await this.request('pl_videos?'+query,{method:'DELETE',headers:{Prefer:'return=minimal'}})}
 }
 async patch(t,f,changes){await this.request(this.query(t,f),{method:'PATCH',body:changes,headers:{Prefer:'return=minimal'}})}
 async saveVideo(video,classes){await this.request('rpc/pl_save_video',{method:'POST',body:{p_video:video,p_classes:classes}})}
 async saveStudent(student){return this.request('rpc/pl_save_student',{method:'POST',body:{p_student:student}})}
 async consumeRate(key,limit,seconds){return this.request('rpc/pl_consume_rate',{method:'POST',body:{p_key:key,p_limit:limit,p_seconds:seconds}})}
 close(){}
}
