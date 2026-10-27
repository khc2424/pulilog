import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalStore} from '../src/store.mjs';
import {TextbookLibrary,SupabaseBookFiles,MAX_PDF_BYTES} from '../src/textbooks.mjs';
import {createApp} from '../src/server.mjs';

const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const memoryFiles=()=>({data:new Map(),async ensure(){},async put(id,bytes){this.data.set(id,Buffer.from(bytes))},async get(id){return this.data.get(id)},async remove(id){this.data.delete(id)}});
test('PDF 원본과 메타데이터를 보관하고 중복·위장 파일을 차단하며 휴지통에서 복원한다',async()=>{
 const store=new LocalStore(':memory:'),files=memoryFiles(),library=new TextbookLibrary(store,files),meta={title:'쎈 공통수학1',subject:'공통수학1',kind:'questions',edition:'2026년판',filename:'쎈.pdf'};
 try{
  const book=await library.upload(meta,pdf);assert.equal((await library.list()).length,1);assert.deepEqual((await library.download(book.id)).bytes,pdf);
  await assert.rejects(library.upload(meta,pdf),/이미 저장/);await assert.rejects(library.upload({...meta,filename:'fake.txt'},pdf));await assert.rejects(library.upload(meta,Buffer.from('not pdf')));await assert.rejects(library.upload(meta,Buffer.alloc(MAX_PDF_BYTES+1)));
  await library.update(book.id,{...meta,title:'수정한 교재'});assert.equal((await library.find(book.id)).title,'수정한 교재');
  await library.archive(book.id);assert.equal((await library.list()).length,0);assert.equal((await library.list({deleted:true})).length,1);await assert.rejects(library.download(book.id),e=>e.status===404);
  await library.archive(book.id,true);assert.equal((await library.list()).length,1);assert.deepEqual((await library.download(book.id)).bytes,pdf);
  assert.equal((await library.verifyStorage()).verified,true);assert.equal(files.data.size,1);
 }finally{store.close()}
});
test('메타데이터 저장 실패 시 업로드한 파일을 정리한다',async()=>{
 const files=memoryFiles(),store={all:async()=>[],put:async()=>{throw new Error('database failure')}},library=new TextbookLibrary(store,files);
 await assert.rejects(library.upload({title:'교재',filename:'book.pdf'},pdf),/database/);assert.equal(files.data.size,0);
});
test('Supabase 파일은 비공개 버킷과 서버 키를 사용하며 기존 공개 버킷에는 쓰지 않는다',async()=>{
 let created=false,stored;
 const files=new SupabaseBookFiles('https://example.supabase.co','sb_secret_server',async(url,options)=>{
  assert.equal(options.headers.apikey,'sb_secret_server');assert.equal(options.headers.Authorization,undefined);
  const path=new URL(url).pathname;
  if(path.endsWith('/bucket/pulilog-textbooks'))return created?Response.json({public:false}):new Response('',{status:404});
  if(path.endsWith('/bucket')){const body=JSON.parse(options.body);assert.equal(body.public,false);assert.equal(body.file_size_limit,MAX_PDF_BYTES);created=true;return Response.json({})}
  if(options.method==='POST'){stored=options.body;return Response.json({})}
  if(path.includes('/authenticated/'))return new Response(stored);
  if(options.method==='DELETE')return Response.json([]);
  throw new Error('Unexpected request');
 });
 const id='12345678-1234-4123-8123-123456789012';await files.put(id,pdf);assert.deepEqual(await files.get(id),pdf);await files.remove(id);
 await assert.rejects(new SupabaseBookFiles('https://example.supabase.co','key',async()=>Response.json({public:true})).ensure(),/비공개/);
});
test('교재 업로드·열기·다운로드·범위 요청은 선생님만 가능하고 학생 응답에 노출하지 않는다',async()=>{
 const store=new LocalStore(':memory:'),files=memoryFiles(),cfg={origin:'http://127.0.0.1',sessionSecret:'test',adminCode:'2424',driver:'sqlite'};
 const app=createApp(cfg,store,{bookFiles:files});await new Promise(r=>app.listen(0,'127.0.0.1',r));cfg.origin=`http://127.0.0.1:${app.address().port}`;
 const post=async(path,data,cookie)=>fetch(cfg.origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 const upload=cookie=>fetch(cfg.origin+'/api/teacher/textbooks/upload?'+new URLSearchParams({title:'교재',subject:'대수',filename:'한글 교재.pdf'}),{method:'POST',headers:{'Content-Type':'application/pdf','X-AXIS-Request':'1',Origin:cfg.origin,...(cookie?{Cookie:cookie}:{})},body:pdf});
 try{
  await store.put('students',{id:1,name:'학생',phone:'01011112222',class_name:'A반',active:true});
  const teacher=(await post('/api/teacher/login',{code:'2424'})).headers.get('set-cookie'),student=(await post('/api/login',{phone:'01011112222'})).headers.get('set-cookie');
  assert.equal((await upload(student)).status,401);assert.equal(files.data.size,0);
  const result=await upload(teacher);assert.equal(result.status,200);const {book}=await result.json();
  const path='/api/teacher/textbooks/'+book.id+'/file';assert.equal((await fetch(cfg.origin+path,{headers:{Cookie:student}})).status,401);
  const file=await fetch(cfg.origin+path,{headers:{Cookie:teacher}});assert.equal(file.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await file.arrayBuffer()),pdf);
  const download=await fetch(cfg.origin+path+'?download=1',{headers:{Cookie:teacher}});assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.match(download.headers.get('content-disposition'),/filename\*=UTF-8''/);await download.arrayBuffer();
  const range=await fetch(cfg.origin+path,{headers:{Cookie:teacher,Range:'bytes=0-7'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),pdf.subarray(0,8));
  assert.equal((await fetch(cfg.origin+path,{headers:{Cookie:teacher,Range:'bytes=999999-'}})).status,416);
  const state=await (await fetch(cfg.origin+'/api/teacher/state',{headers:{Cookie:teacher}})).json();assert.equal(state.textbooks.length,1);assert.deepEqual(state.settings,{});
  assert.equal((await post('/api/teacher/textbooks/delete',{id:book.id},teacher)).status,200);assert.equal((await fetch(cfg.origin+path,{headers:{Cookie:teacher}})).status,404);
  assert.equal((await post('/api/teacher/textbooks/restore',{id:book.id},teacher)).status,200);assert.equal(files.data.size,1);
 }finally{await new Promise(r=>app.close(r));store.close()}
});
