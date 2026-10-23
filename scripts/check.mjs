import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const dir of ['src','public','scripts','tests'])for(const file of await readdir(dir)){if(!/\.(mjs|js)$/.test(file))continue;const r=spawnSync(process.execPath,['--check',`${dir}/${file}`],{encoding:'utf8'});if(r.status){console.error(r.stderr);process.exit(1)}}
const html=await readFile('public/index.html','utf8');
for(const name of [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(m=>m[1]))await readFile('public/'+name);
console.log('서버·화면 문법 및 참조 파일 확인 완료');
