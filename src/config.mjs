import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
export function config(env=process.env){
 const production=env.NODE_ENV==='production',port=Number(env.PORT||8766);
 const configuredOrigin=env.APP_ORIGIN||env.RENDER_EXTERNAL_URL;
 const origin=new URL(configuredOrigin||`http://127.0.0.1:${port}`).origin;
 const driver=env.DATABASE_DRIVER||'sqlite';
 let adminCode=env.ADMIN_CODE||'',sessionSecret=env.SESSION_SECRET||'';
 if(production){
  if(!configuredOrigin||!origin.startsWith('https://'))throw new Error('APP_ORIGIN or RENDER_EXTERNAL_URL must be the HTTPS production origin.');
  if(driver!=='supabase'||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw new Error('Production requires a configured Supabase project.');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL))throw new Error('Invalid Supabase project URL.');
  if(adminCode.length<4||sessionSecret.length<32)throw new Error('Set a 4+ character ADMIN_CODE and a 32+ character SESSION_SECRET.');
 }else{
  adminCode ||= '2424';
  if(!sessionSecret){const dir=resolve('.private');mkdirSync(dir,{recursive:true});const file=resolve(dir,'session-secret');if(!existsSync(file))writeFileSync(file,randomBytes(32).toString('hex'),{mode:0o600});sessionSecret=readFileSync(file,'utf8').trim()}
 }
 return {production,port,origin,driver,adminCode,sessionSecret,googleClientId:env.GOOGLE_CLIENT_ID||'',googleClientSecret:env.GOOGLE_CLIENT_SECRET||'',supabaseUrl:env.SUPABASE_URL,supabaseKey:env.SUPABASE_SECRET_KEY,trustProxy:env.TRUST_PROXY==='true',dbPath:env.LOCAL_DB_PATH||resolve('.private/pulilog.sqlite3')};
}
