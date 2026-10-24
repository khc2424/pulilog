export const classKey=value=>String(value??'').replace(/\s/g,'').toUpperCase();
export function canonicalClassName(value,registered){
 const key=classKey(value),matches=registered.filter(name=>classKey(name)===key);
 return matches.find(name=>name===key)||matches.sort((a,b)=>a.length-b.length||a.localeCompare(b))[0]||key;
}
export async function mergeClassAliases(store,targetName){
 const groups=await store.all('classes'),target=canonicalClassName(targetName,groups.map(g=>g.name));
 if(!groups.some(g=>g.name===target))throw Object.assign(new Error('합칠 반을 찾을 수 없어요.'),{status:400});
 const aliases=groups.filter(g=>classKey(g.name)===classKey(target)&&g.name!==target);
 const targetGroup=groups.find(g=>g.name===target);
 if(!targetGroup.schedule){const schedule=aliases.find(g=>g.schedule)?.schedule;if(schedule)await store.put('classes',{...targetGroup,schedule})}
 for(const alias of aliases){
  const relations=await store.all('video_classes',{class_name:alias.name});
  for(const relation of relations)await store.put('video_classes',{video_id:relation.video_id,class_name:target});
  await store.patch('students',{class_name:alias.name},{class_name:target});
  await store.patch('videos',{class_name:alias.name},{class_name:target});
  await store.del('video_classes',{class_name:alias.name});
  await store.del('classes',{name:alias.name});
 }
 return {name:target,merged:aliases.map(g=>g.name)};
}
