// Pointer Events keep each finger independent. There is no synthetic keyboard
// input: flight receives bounded analog values and the existing mission action
// entry point receives taps, so equipment ownership checks remain authoritative.
const ZERO = Object.freeze({forward:0,turn:0,strafe:0,lift:0,lookX:0,lookY:0});
const clamp = value => Math.max(-1,Math.min(1,value));
const selector = '[data-touch-stick], [data-touch-control], [data-touch-action]';
const HOLD = {up:['lift',1],down:['lift',-1],left:['strafe',-1],right:['strafe',1]};

export function createTouchControls({root,onInput=()=>{},onCamera=()=>{},onAction=()=>{},onActionStart=()=>false,onActionEnd=()=>{},
  onChange=()=>{},inputMode='auto',window:win=globalThis.window,document:doc=globalThis.document,
  navigator:nav=globalThis.navigator}={}) {
  if (!root) throw new Error('터치 조작 영역이 없습니다.');
  const pointers=new Map(), listeners=[], state={...ZERO};
  const coarse=win?.matchMedia?.('(pointer: coarse)'), noHover=win?.matchMedia?.('(hover: none)');
  let mode='auto',enabled=false,visible=false,disposed=false,focused=true;
  const stick=root.querySelector('[data-touch-stick]'),knob=root.querySelector('[data-touch-knob]');
  const controls=[...root.querySelectorAll(selector)];
  const originalStyles=controls.map(el=>[el,el.style.touchAction,el.style.userSelect]);
  for(const el of controls){el.style.touchAction='none';el.style.userSelect='none';}
  function listen(target,type,fn,options){target?.addEventListener?.(type,fn,options);listeners.push(()=>target?.removeEventListener?.(type,fn,options));}
  function emit(force=false){
    const next={...ZERO},heldControls=new Set();
    for(const point of pointers.values()){
      if(point.kind==='stick'){next.forward=point.forward;next.turn=point.turn;}
      else if(HOLD[point.kind])heldControls.add(point.kind);
    }
    for(const kind of heldControls){const [axis,value]=HOLD[kind];next[axis]+=value;}
    const changed=Object.keys(next).some(key=>state[key]!==clamp(next[key]));
    for(const key of Object.keys(next))state[key]=clamp(next[key]);
    if(force||changed)onInput({...state});
    for(const el of controls)el.classList.toggle('is-held',[...pointers.values()].some(point=>point.el===el));
    const held=[...pointers.values()].find(point=>point.kind==='stick');
    const x=held?.visualX||0,y=held?.visualY||0;
    stick?.style.setProperty('--stick-x',x+'px');stick?.style.setProperty('--stick-y',y+'px');
    if(knob)knob.style.transform=`translate(${x}px, ${y}px)`;
  }
  function release(point){if(point.started){onActionEnd(point.action,point.id);point.started=false;}
    try{if(point.el.hasPointerCapture?.(point.id))point.el.releasePointerCapture(point.id);}catch{}}
  function reset(){const held=[...pointers.values()];pointers.clear();held.forEach(release);emit(true);}
  function refresh(){
    const supported=(nav?.maxTouchPoints||0)>0 && !!coarse?.matches && !!noHover?.matches;
    const next=!disposed&&enabled&&(mode==='touch'||mode==='auto'&&supported);
    if(next!==visible){visible=next;reset();}
    root.hidden=!visible;root.setAttribute('aria-hidden',String(!visible));root.dataset.inputMode=mode;
    onChange({visible,inputMode:mode});
  }
  function available(){return visible&&!disposed&&focused&&!doc?.hidden;}
  function updateStick(point,e){
    const dx=(e.clientX-point.cx)/point.radius,dy=(e.clientY-point.cy)/point.radius;
    const length=Math.hypot(dx,dy),unit=length?Math.min(length,1)/length:0;
    point.visualX=dx*unit*point.radius;point.visualY=dy*unit*point.radius;
    const strength=length<=.10?0:Math.min(1,(length-.10)/.90)/length;
    point.turn=dx*strength;point.forward=-dy*strength;
  }
  function down(e){
    if(!available()||pointers.has(e.pointerId)||e.pointerType==='mouse'&&e.button!==0)return;
    const el=e.target?.closest?.(selector);if(!el||!root.contains(el))return;
    const kind=el.hasAttribute('data-touch-stick')?'stick':el.dataset.touchControl||'action';
    if(kind==='stick'&&[...pointers.values()].some(point=>point.kind==='stick'))return;
    if(kind!=='stick'&&kind!=='camera'&&kind!=='action'&&!HOLD[kind])return;
    e.preventDefault();
    const rect=el.getBoundingClientRect(),radius=Math.max(12,Math.min(rect.width,rect.height)*.5-(knob?.offsetWidth||40)*.5);
    const point={id:e.pointerId,el,kind,action:el.dataset.touchAction,cx:rect.left+rect.width*.5,cy:rect.top+rect.height*.5,
      radius,startX:e.clientX,startY:e.clientY,moved:false,forward:0,turn:0};
    pointers.set(e.pointerId,point);
    if(kind==='action')point.started=onActionStart(point.action,point.id);
    if(kind==='stick')updateStick(point,e);
    try{el.setPointerCapture(e.pointerId);}catch{/* Window listeners still release a pointer outside the button. */}
    emit();
  }
  function move(e){
    const point=pointers.get(e.pointerId);if(!point)return;
    if(!available()){reset();return;}e.preventDefault();
    if(Math.hypot(e.clientX-point.startX,e.clientY-point.startY)>18)point.moved=true;
    if(point.kind==='stick'){updateStick(point,e);emit();}
  }
  function end(e){
    const point=pointers.get(e.pointerId);if(!point)return;
    const started=point.started;
    e.preventDefault();pointers.delete(e.pointerId);release(point);emit();
    if(started||e.type!=='pointerup'||!available()||point.moved)return;
    const r=point.el.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;
    if(point.kind==='camera')onCamera();else if(point.kind==='action')onAction(point.action);
  }
  function lost(e){const point=pointers.get(e.pointerId);if(point){pointers.delete(e.pointerId);release(point);emit();}}
  function click(e){
    const el=e.target?.closest?.(selector);if(!el||!root.contains(el))return;
    // Pointer taps were dispatched on pointerup. Keyboard/screen-reader button
    // activation has detail 0 and remains available without a synthetic finger.
    e.preventDefault();if(e.detail!==0||!available())return;
    if(el.dataset.touchControl==='camera')onCamera();else if(el.dataset.touchAction)onAction(el.dataset.touchAction);
  }
  listen(root,'pointerdown',down,{passive:false});
  listen(win,'pointermove',move,{passive:false});listen(win,'pointerup',end,{passive:false});listen(win,'pointercancel',end,{passive:false});
  listen(root,'lostpointercapture',lost,true);listen(root,'click',click);
  listen(root,'contextmenu',e=>{if(e.target?.closest?.(selector))e.preventDefault();});
  listen(win,'blur',()=>{focused=false;reset();});listen(win,'focus',()=>{focused=true;reset();});
  listen(doc,'visibilitychange',reset);listen(win,'orientationchange',reset);listen(win?.screen?.orientation,'change',reset);
  // Resize also changes the fixed stick's bounds (rotation, split view, browser
  // toolbar). Require fresh contact instead of keeping an old direction held.
  listen(win,'resize',reset);listen(coarse,'change',refresh);listen(noHover,'change',refresh);
  function setMode(value){if(!['auto','touch','off'].includes(value))throw new Error('알 수 없는 터치 입력 모드');mode=value;reset();refresh();}
  setMode(inputMode);
  return {get state(){return {...state};},get visible(){return visible;},get inputMode(){return mode;},
    setMode,setEnabled(value){enabled=!!value;if(!enabled)reset();refresh();},reset,
    dispose(){if(disposed)return;disposed=true;enabled=false;reset();refresh();listeners.forEach(remove=>remove());
      originalStyles.forEach(([el,touchAction,userSelect])=>{el.style.touchAction=touchAction;el.style.userSelect=userSelect;});}};
}
