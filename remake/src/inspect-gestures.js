// Single-pointer orbit, two-pointer pinch, and existing wheel distance control.
// zoom is a camera-distance multiplier: spreading fingers moves closer.
export function createInspectorGestures(canvas, view, {
  window:win=globalThis.window, document:doc=globalThis.document,
}={}) {
  const points=new Map(),cleanups=[];
  const original={touchAction:canvas.style.touchAction,userSelect:canvas.style.userSelect};
  let distance=0,disposed=false,focused=true;
  canvas.style.touchAction='none';canvas.style.userSelect='none';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const ready=()=>!disposed&&focused&&!doc?.hidden;
  const pairDistance=()=>{const [a,b]=points.values();return b?Math.hypot(b.x-a.x,b.y-a.y):0;};
  function listen(target,name,fn,options){target?.addEventListener?.(name,fn,options);cleanups.push(()=>target?.removeEventListener?.(name,fn,options));}
  function release(id){try{if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);}catch{}}
  function reset(){const ids=[...points.keys()];points.clear();distance=0;ids.forEach(release);}
  function down(e){
    if(!ready()||points.has(e.pointerId)||e.pointerType==='mouse'&&e.button!==0)return;
    e.preventDefault();if(points.size>=2)return;
    points.set(e.pointerId,{x:e.clientX,y:e.clientY});distance=pairDistance();
    try{canvas.setPointerCapture(e.pointerId);}catch{/* Window events still release a pointer outside the canvas. */}
  }
  function move(e){
    const point=points.get(e.pointerId);if(!point)return;
    if(!ready()){reset();return;}e.preventDefault();
    const dx=e.clientX-point.x,dy=e.clientY-point.y;point.x=e.clientX;point.y=e.clientY;
    if(points.size===1){view.yaw-=dx*.008;view.pitch=clamp(view.pitch+dy*.008,-1.2,1.4);}
    else{
      const next=pairDistance();
      if(distance>2&&next>2)view.zoom=clamp(view.zoom*distance/next,.48,4);
      distance=next;
    }
  }
  function up(e){
    if(!points.has(e.pointerId))return;
    e.preventDefault();points.delete(e.pointerId);distance=pairDistance();release(e.pointerId);
  }
  function cancel(e){if(points.has(e.pointerId)){e.preventDefault?.();reset();}}
  function wheel(e){
    if(!ready())return;e.preventDefault();
    if(Number.isFinite(e.deltaY))view.zoom=clamp(view.zoom*Math.exp(e.deltaY*.001),.48,4);
  }
  listen(canvas,'pointerdown',down,{passive:false});
  listen(win,'pointermove',move,{passive:false});listen(win,'pointerup',up,{passive:false});
  listen(win,'pointercancel',cancel,{passive:false});listen(canvas,'lostpointercapture',cancel);
  listen(canvas,'wheel',wheel,{passive:false});
  listen(win,'blur',()=>{focused=false;reset();});listen(win,'focus',()=>{focused=true;reset();});
  listen(doc,'visibilitychange',reset);listen(win,'resize',reset);
  return {reset,dispose(){if(disposed)return;disposed=true;reset();cleanups.forEach(remove=>remove());
    canvas.style.touchAction=original.touchAction;canvas.style.userSelect=original.userSelect;}};
}
