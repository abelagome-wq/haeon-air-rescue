const radians=Math.PI/180;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// Resolve gravity into the current screen axes. Compass heading is irrelevant
// to cyclic control, including on phones without a magnetometer.
export function screenTilt(beta,gamma,screenAngle){
  const b=beta*radians,g=gamma*radians,a=screenAngle*radians;
  const dx=-Math.cos(b)*Math.sin(g),dy=Math.sin(b),dz=Math.cos(b)*Math.cos(g);
  const right=dx*Math.cos(a)-dy*Math.sin(a),up=dx*Math.sin(a)+dy*Math.cos(a);
  return {pitch:Math.atan2(up,dz)/radians,roll:-Math.asin(clamp(right,-1,1))/radians};
}
function cyclic(degrees){
  const angle=((degrees+540)%360)-180;
  return Math.sign(angle)*clamp((Math.abs(angle)-2)/23,0,1);
}

export function createTiltControls({win=globalThis.window,onChange=()=>{}}={}){
  let enabled=false,flying=false,listening=false,focused=true,disposed=false,attempt=0;
  let baseline=null,screen=null,timer=null,status='off';
  let targetPitch=0,targetRoll=0;
  const axes={forward:0,strafe:0};
  const reset=()=>{axes.forward=axes.strafe=targetPitch=targetRoll=0;};
  const announce=value=>{if(status!==value){status=value;onChange(value);}};
  const angle=()=>win.screen?.orientation?.angle??win.orientation??0;
  const active=()=>enabled&&focused&&!win.document?.hidden&&!disposed;
  function clearTimer(){if(timer!==null)win.clearTimeout(timer);timer=null;}
  function detach(){
    clearTimer();
    if(listening)win.removeEventListener('deviceorientation',sensor);
    listening=false;
  }
  function fail(reason){
    enabled=false;baseline=null;reset();detach();announce(reason);
  }
  function listen(){
    if(!active()){detach();return;}
    if(!listening){win.addEventListener('deviceorientation',sensor);listening=true;}
    if(!baseline&&timer===null)timer=win.setTimeout(()=>fail('no-signal'),4500);
  }
  function sensor(e){
    if(!active())return;
    if(!Number.isFinite(e.beta)||!Number.isFinite(e.gamma)){
      if(baseline)calibrate();
      return;
    }
    const orientation=angle();
    if(screen!==orientation){baseline=null;reset();}
    screen=orientation;const last=screenTilt(e.beta,e.gamma,orientation);
    if(!baseline){
      baseline=last;reset();clearTimer();announce('ready');
      if(!flying)detach();
    }else{
      targetPitch=cyclic(baseline.pitch-last.pitch);
      targetRoll=cyclic(last.roll-baseline.roll);
    }
  }
  function calibrate(){
    if(!enabled)return;
    baseline=null;reset();clearTimer();announce('waiting');listen();
  }
  async function enable(){
    const run=++attempt;
    const sensorType=win?.DeviceOrientationEvent;
    if(!sensorType||win.isSecureContext===false){fail('unsupported');return;}
    announce('requesting');
    try{
      if(typeof sensorType.requestPermission==='function'){
        // Call directly during the button click to preserve transient user activation.
        const granted=await sensorType.requestPermission();
        if(run!==attempt||disposed)return;
        if(granted!=='granted'){fail('denied');return;}
      }
      if(run!==attempt||disposed)return;
      enabled=true;calibrate();
    }catch{if(run===attempt&&!disposed)fail('denied');}
  }
  function disable(){attempt++;fail('off');}
  function setFlying(value){
    if(flying===value)return;
    flying=value;reset();
    if(!enabled)return;
    if(flying){if(baseline)listen();else calibrate();}
    else detach();
  }
  function sample(dt){
    if(!active()||!flying||!baseline){reset();return axes;}
    const mix=-Math.expm1(-Math.min(dt,.12)*12);
    axes.forward+=(targetPitch-axes.forward)*mix;
    axes.strafe+=(targetRoll-axes.strafe)*mix;
    return axes;
  }
  function blur(){focused=false;reset();baseline=null;detach();}
  function focus(){focused=true;if(enabled&&(flying||status==='waiting'))calibrate();}
  function visibility(){if(win.document.hidden)blur();else focus();}
  function rotation(){if(enabled)calibrate();}
  win.addEventListener('blur',blur);win.addEventListener('focus',focus);
  win.document?.addEventListener('visibilitychange',visibility);
  win.screen?.orientation?.addEventListener?.('change',rotation);win.addEventListener('orientationchange',rotation);
  return {get enabled(){return enabled;},get status(){return status;},enable,disable,calibrate,setFlying,sample,
    dispose(){disposed=true;disable();win.removeEventListener('blur',blur);win.removeEventListener('focus',focus);
      win.document?.removeEventListener('visibilitychange',visibility);win.removeEventListener('orientationchange',rotation);
      win.screen?.orientation?.removeEventListener?.('change',rotation);}};
}
