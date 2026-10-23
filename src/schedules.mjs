const legacy={MWF:[1,3,5],TTS:[2,4,6],MW:[1,3],TT:[2,4]};
export function normalizeSchedule(input){
 let days;
 if(Object.hasOwn(input,'days'))days=input.days;
 else{const s=input.schedule??'';if(s==='')return '';if(Object.hasOwn(legacy,s))return s;if(typeof s==='string'&&/^days:[1-7](,[1-7]){0,6}$/.test(s))days=s.slice(5).split(',').map(Number);else return null}
 if(!Array.isArray(days)||days.length>7||days.some(d=>!Number.isInteger(d)||d<1||d>7))return null;
 const sorted=[...new Set(days)].sort((a,b)=>a-b);if(!sorted.length)return '';
 return Object.entries(legacy).find(([,value])=>value.join(',')===sorted.join(','))?.[0]||'days:'+sorted.join(',');
}
