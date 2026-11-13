// A secondary finger, or the first tap after interrupting a drag with a
// menu, can produce a full pointer sequence without a compatibility click.
export function enableMultitouchButtons(root,{enabled=()=>true,includePrimaryTouch=false,window:win=window,document:doc=document}={}){
  const pointers=new Map(),recent=new WeakMap(),listeners=[];
  function listen(target,type,fn,options){target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));}
  function release(p){try{if(p.button.hasPointerCapture(p.id))p.button.releasePointerCapture(p.id);}catch{}}
  function clear(){const all=[...pointers.values()];pointers.clear();all.forEach(release);}
  listen(root,'pointerdown',e=>{
    const button=e.target.closest?.('button');
    if(!button||!root.contains(button)||button.disabled||button.closest('#touchControls'))return;
    recent.delete(button); // A new intentional tap/click is never a duplicate.
    if(!['touch','pen'].includes(e.pointerType)||!enabled())return;
    if(e.isPrimary!==false&&!(includePrimaryTouch&&e.pointerType==='touch'))return;
    const p={id:e.pointerId,button,x:e.clientX,y:e.clientY,moved:false};pointers.set(e.pointerId,p);
    try{button.setPointerCapture(e.pointerId);}catch{}
  });
  listen(win,'pointermove',e=>{const p=pointers.get(e.pointerId);if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>18)p.moved=true;});
  function end(e){
    const p=pointers.get(e.pointerId);if(!p)return;pointers.delete(e.pointerId);release(p);
    if(e.type!=='pointerup'||p.moved||!enabled()||doc.hidden||p.button.disabled)return;
    const r=p.button.getBoundingClientRect();
    if(!r.width||!r.height||e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;
    e.preventDefault();recent.set(p.button,performance.now());p.button.click();
  }
  listen(win,'pointerup',end,{passive:false});listen(win,'pointercancel',end);
  listen(root,'lostpointercapture',e=>pointers.delete(e.pointerId),true);
  listen(root,'click',e=>{
    const button=e.target.closest?.('button');
    // .click(), keyboard and assistive activation have detail 0. A browser that
    // also emits a compatibility click must not run the same tap twice.
    if(button&&e.detail!==0&&performance.now()-(recent.get(button)??-Infinity)<800){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  listen(win,'blur',clear);listen(win,'resize',clear);listen(win,'orientationchange',clear);listen(doc,'visibilitychange',clear);
  return {reset:clear,dispose(){clear();listeners.forEach(remove=>remove());}};
}
