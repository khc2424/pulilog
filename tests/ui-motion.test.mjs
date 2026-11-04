import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../public/ui-motion.js',import.meta.url),'utf8');
function harness(reduce=false,engine=true){
 const calls=[],panel={style:{removeProperty(){}}},backdrop={hidden:false,style:{removeProperty(){}},querySelector:()=>panel};
 const context={window:{matchMedia:()=>({matches:reduce})},document:{querySelector:s=>s==='#modal'?backdrop:panel,addEventListener(){}},CSS:{escape:String},Promise};
 if(engine)context.window.PuliMotionEngine={animate(){let finish;const finished=new Promise(r=>finish=r);const call={finished,cancel(){},finish};calls.push(call);return call}};
 runInNewContext(source,context);return {motion:context.window.PuliMotion,calls};
}
test('닫는 중 새 팝업을 열어도 이전 종료 효과가 새 화면을 지우지 않고 반복 닫기는 한 번만 처리한다',async()=>{
 const h=harness();let closed=0;h.motion.open();h.motion.close(()=>closed++);h.motion.open();for(const c of h.calls)c.finish();await new Promise(r=>setImmediate(r));assert.equal(closed,0);
 h.motion.close(()=>closed++);h.motion.close(()=>closed++);for(const c of h.calls)c.finish();await new Promise(r=>setImmediate(r));assert.equal(closed,1);
});
test('동작 줄이기나 라이브러리 로드 실패 시에도 팝업은 즉시 닫힌다',()=>{
 for(const h of [harness(true),harness(false,false)]){let closed=0;h.motion.open();h.motion.close(()=>closed++);assert.equal(closed,1);assert.equal(h.calls.length,0)}
});
