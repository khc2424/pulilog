import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';

export const MAX_PDF_BYTES=50*1024*1024;
const bucket='pulilog-textbooks',prefix='youtube_textbook_';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export const validBookId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export function cleanBookMeta(input){
 const title=String(input.title||'').trim(),subject=String(input.subject||'').trim(),edition=String(input.edition||'').trim(),kind=input.kind||'questions';
 if(!title||title.length>150||subject.length>60||edition.length>80||!['questions','solutions'].includes(kind))fail('교재명·과목·판본을 확인해주세요.');
 return {title,subject,edition,kind};
}

export class LocalBookFiles {
 constructor(root){this.root=resolve(root)}
 path(id){if(!validBookId(id))fail('교재 번호를 확인해주세요.');return resolve(this.root,id+'.pdf')}
 async ensure(){await mkdir(this.root,{recursive:true})}
 async put(id,bytes){await this.ensure();await writeFile(this.path(id),bytes,{flag:'wx',mode:0o600})}
 async get(id){try{return await readFile(this.path(id))}catch{fail('PDF 파일을 찾지 못했어요.',404)}}
 async remove(id){try{await unlink(this.path(id))}catch(error){if(error.code!=='ENOENT')throw error}}
}

export class SupabaseBookFiles {
 constructor(url,key,fetcher=fetch){this.url=url.replace(/\/$/,'');this.key=key;this.fetcher=fetcher;this.ready=false}
 async request(path,{method='GET',body,headers={}}={}){
  let response;const auth={apikey:this.key,...(!this.key.startsWith('sb_secret_')?{Authorization:'Bearer '+this.key}:{})};
  try{response=await this.fetcher(this.url+'/storage/v1/'+path,{method,headers:{...auth,...headers},body,signal:AbortSignal.timeout(120000)})}catch{fail('PDF 저장소 연결이 지연돼요. 잠시 후 다시 시도해주세요.')}
  return response;
 }
 async ensure(){
  if(this.ready)return;
  let response=await this.request('bucket/'+bucket);
  if(response.status===404||response.status===400){
   const created=await this.request('bucket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:MAX_PDF_BYTES,allowed_mime_types:['application/pdf']})});
   if(!created.ok&&![409,400].includes(created.status))fail('PDF 저장소를 만들지 못했어요. Supabase Storage 상태를 확인해주세요.');
   response=await this.request('bucket/'+bucket);
  }
  if(!response.ok)fail('PDF 저장소에 접근할 수 없어요. 서버 연결 설정을 확인해주세요.');
  const data=await response.json();if(data.public!==false)fail('교재 저장소의 비공개 설정을 확인해주세요.');this.ready=true;
 }
 async put(id,bytes){
  if(!validBookId(id))fail('교재 번호를 확인해주세요.');await this.ensure();
  const response=await this.request('object/'+bucket+'/'+id+'.pdf',{method:'POST',headers:{'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});
  if(!response.ok){if(response.status===413)fail('PDF 용량이 저장소 제한을 초과했어요. 최대 50MB까지 가능해요.');fail('PDF를 저장하지 못했어요. Supabase 저장 용량과 파일 크기 제한을 확인해주세요.')}
 }
 async get(id){
  if(!validBookId(id))fail('교재 번호를 확인해주세요.');
  const response=await this.request('object/authenticated/'+bucket+'/'+id+'.pdf');
  if(!response.ok)fail('저장된 PDF를 불러오지 못했어요.',response.status===404?404:400);
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>MAX_PDF_BYTES)fail('PDF 용량 제한을 초과했어요.');return bytes;
 }
 async remove(id){
  if(!validBookId(id))fail('교재 번호를 확인해주세요.');
  const response=await this.request('object/'+bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[id+'.pdf']})});
  if(!response.ok)fail('저장소 정리를 완료하지 못했어요.');
 }
}

export class TextbookLibrary {
 constructor(store,files){this.store=store;this.files=files;this.uploading=false}
 async verifyStorage(){
  const id=randomUUID();let body='%PDF-1.4\n';const offsets=[0];
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>'];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(body));body+=`${index+1} 0 obj\n${object}\nendobj\n`});
  const xref=Buffer.byteLength(body);body+='xref\n0 4\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes=Buffer.from(body);await this.files.put(id,bytes);
  try{const returned=await this.files.get(id);if(!bytes.equals(returned))fail('PDF 저장 검증에 실패했어요.');return {verified:true}}finally{await this.files.remove(id)}
 }
 async list({deleted=false}={}){return (await this.store.all('settings')).filter(row=>row.key.startsWith(prefix)).map(row=>row.value).filter(book=>deleted?!!book.deleted_at:!book.deleted_at).sort((a,b)=>b.created_at.localeCompare(a.created_at))}
 async find(id){if(!validBookId(id))fail('교재 번호를 확인해주세요.');const book=(await this.store.all('settings',{key:prefix+id}))[0]?.value;if(!book)fail('저장된 교재를 찾지 못했어요.',404);return book}
 async upload(input,bytes){
  const meta=cleanBookMeta(input),filename=String(input.filename||'').replaceAll('\\','/').split('/').at(-1);
  if(!/\.pdf$/i.test(filename)||filename.length>200)fail('PDF 파일을 선택해주세요.');
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_PDF_BYTES)fail('PDF는 50MB 이하로 선택해주세요.',413);
  if(!/^%PDF-\d\.\d/.test(bytes.subarray(0,16).toString('ascii'))||!bytes.subarray(-4096).includes(Buffer.from('%%EOF')))fail('PDF 형식의 파일인지 확인해주세요.');
  const sha256=createHash('sha256').update(bytes).digest('hex'),previous=[...await this.list(),...await this.list({deleted:true})].find(book=>book.sha256===sha256);
  if(previous?.deleted_at)fail('휴지통에 같은 PDF가 있어요. 휴지통에서 복원해주세요: '+previous.title);
  if(previous)fail('이미 저장된 PDF예요: '+previous.title);
  const id=randomUUID(),record={id,...meta,filename,size:bytes.length,sha256,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),deleted_at:null};
  await this.files.put(id,bytes);
  try{await this.store.put('settings',{key:prefix+id,value:record})}catch(error){try{await this.files.remove(id)}catch{}throw error}
  return record;
 }
 async update(id,input){const book=await this.find(id);if(book.deleted_at)fail('삭제한 교재는 먼저 복원해주세요.');const record={...book,...cleanBookMeta(input),updated_at:new Date().toISOString()};await this.store.put('settings',{key:prefix+id,value:record});return record}
 async archive(id,restore=false){const book=await this.find(id);const record={...book,deleted_at:restore?null:new Date().toISOString(),updated_at:new Date().toISOString()};await this.store.put('settings',{key:prefix+id,value:record});return record}
 async download(id){const book=await this.find(id);if(book.deleted_at)fail('삭제한 교재는 먼저 복원해주세요.',404);return {book,bytes:await this.files.get(id)}}
}
