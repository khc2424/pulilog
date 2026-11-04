/* Small, interruptible interactions. Native behavior remains available without Motion. */
window.PuliMotion=(()=>{
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const enabled=()=>!reduced.matches&&typeof window.PuliMotionEngine?.animate==='function';
 const ease=[.22,1,.36,1];
 const animate=(element,frames,options={})=>window.PuliMotionEngine.animate(element,frames,{duration:.2,ease,...options});
 let modalGeneration=0,modalAnimations=[],closing=false;
 const resetModal=()=>{for(const a of modalAnimations)try{a.cancel()}catch{}modalAnimations=[];for(const el of [document.querySelector('#modal'),document.querySelector('#modal .modal')])if(el){el.style.removeProperty('opacity');el.style.removeProperty('transform')}};
 function open(){modalGeneration++;closing=false;resetModal();if(!enabled())return;
  const backdrop=document.querySelector('#modal'),panel=backdrop?.querySelector('.modal');if(!panel||backdrop.hidden)return;
  const generation=modalGeneration;
  try{modalAnimations=[animate(backdrop,{opacity:[0,1]},{duration:.16}),animate(panel,{opacity:[0,1],transform:['translateY(12px) scale(.985)','translateY(0px) scale(1)']},{duration:.22})];Promise.all(modalAnimations.map(a=>a.finished)).then(()=>{if(modalGeneration===generation&&!closing)resetModal()}).catch(()=>{})}catch{resetModal()}
 }
 function close(finish){
  if(closing)return;const backdrop=document.querySelector('#modal');if(!backdrop||backdrop.hidden){finish();return}
  closing=true;const generation=++modalGeneration;resetModal();
  const complete=()=>{if(generation!==modalGeneration)return;closing=false;resetModal();finish()};
  if(!enabled()){complete();return}
  try{modalAnimations=[animate(backdrop,{opacity:[1,0]},{duration:.12})];Promise.all(modalAnimations.map(a=>a.finished)).then(complete,complete)}catch{complete()}
 }
 const detailAnimations=new WeakMap();
 function toggleDetail(detail){
  const old=detailAnimations.get(detail),opening=old?!old.opening:!detail.open,start=detail.getBoundingClientRect().height;
  old?.animation?.cancel();detail.style.removeProperty('height');detail.style.removeProperty('overflow');
  detail.open=true;const full=detail.getBoundingClientRect().height,summary=detail.querySelector(':scope > summary'),border=parseFloat(getComputedStyle(detail).borderTopWidth)+parseFloat(getComputedStyle(detail).borderBottomWidth),end=opening?full:summary.getBoundingClientRect().height+border;
  const state={opening,animation:null};detailAnimations.set(detail,state);detail.style.overflow='hidden';
  const complete=()=>{if(detailAnimations.get(detail)!==state)return;detailAnimations.delete(detail);detail.open=opening;detail.style.removeProperty('height');detail.style.removeProperty('overflow')};
  try{state.animation=animate(detail,{height:[start+'px',end+'px']},{duration:.2});state.animation.finished.then(complete,complete)}catch{complete()}
 }
 document.addEventListener('click',event=>{
  const summary=event.target.closest?.('summary');if(!summary||event.target.closest('button,a,input,select,textarea')||!enabled())return;
  const detail=summary.parentElement;if(!detail.matches('details.class-accordion,details.record-student'))return;
  event.preventDefault();toggleDetail(detail);
 },true);
 function favorite(id){if(!enabled())return;const star=document.querySelector('[data-favorite="'+CSS.escape(id)+'"]');if(!star)return;try{animate(star,{transform:star.classList.contains('selected')?['scale(1)','scale(1.23)','scale(1)']:['scale(1)','scale(.88)','scale(1)']},{duration:.24}).finished.then(()=>star.style.removeProperty('transform')).catch(()=>{})}catch{}}
 let sidebarGeneration=0,sidebarAnimations=[];
 function resetSidebar(){
  sidebarGeneration++;for(const animation of sidebarAnimations)try{animation.cancel()}catch{}sidebarAnimations=[];
  const bar=document.querySelector('.sidebar'),shell=document.querySelector('.shell'),shade=document.querySelector('#sidebar-shade'),top=document.querySelector('.topbar');
  for(const [el,keys] of [[bar,['transform','visibility','transition']],[shell,['margin-left']],[shade,['opacity']],[top,['padding-left']]])if(el)for(const key of keys)el.style.removeProperty(key);
  shade?.classList.remove('motion-shade');
 }
 function sidebar(update){
  const bar=document.querySelector('.sidebar'),shell=document.querySelector('.shell'),shade=document.querySelector('#sidebar-shade'),top=document.querySelector('.topbar');
  if(!enabled()||!bar||!shell){resetSidebar();update();return}
  const before={transform:getComputedStyle(bar).transform,margin:getComputedStyle(shell).marginLeft,padding:top?getComputedStyle(top).paddingLeft:'0px',shade:shade?getComputedStyle(shade).opacity:'0',overlay:document.body.classList.contains('sidebar-overlay')};
  resetSidebar();bar.style.transition='none';update();
  const after={transform:getComputedStyle(bar).transform,margin:getComputedStyle(shell).marginLeft,padding:top?getComputedStyle(top).paddingLeft:'0px',overlay:document.body.classList.contains('sidebar-overlay')},generation=sidebarGeneration;
  bar.style.visibility='visible';
  const complete=()=>{if(generation===sidebarGeneration)resetSidebar()};
  try{
   sidebarAnimations=[animate(bar,{transform:[before.transform,after.transform]},{duration:.22})];
   if(before.margin!==after.margin)sidebarAnimations.push(animate(shell,{marginLeft:[before.margin,after.margin]},{duration:.22}));
   if(top&&before.padding!==after.padding)sidebarAnimations.push(animate(top,{paddingLeft:[before.padding,after.padding]},{duration:.22}));
   if(shade&&(before.overlay||after.overlay)){shade.classList.add('motion-shade');sidebarAnimations.push(animate(shade,{opacity:[before.overlay?before.shade:0,after.overlay?1:0]},{duration:.18}))}
   Promise.all(sidebarAnimations.map(a=>a.finished)).then(complete,complete);
  }catch{complete()}
 }
 return {open,close,favorite,sidebar,resetSidebar};

})();
