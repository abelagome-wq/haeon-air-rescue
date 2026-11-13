const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

export function createFlightHaptics({nav=globalThis.navigator,now=()=>performance.now(),mobile=()=>false,enabled=true}={}){
  let actuator=null,phoneActive=false,generation=0,nextWind=0,impactUntil=0;
  const supports=(motor,type)=>!motor.effects||Array.from(motor.effects).includes(type);
  function stop(){
    generation++;nextWind=impactUntil=0;
    if(actuator){
      try{Promise.resolve(actuator.reset?.()??actuator.pulse?.(0,0)).catch(()=>{});}catch{}
      actuator=null;
    }
    if(phoneActive){try{nav.vibrate?.(0);}catch{}phoneActive=false;}
  }
  async function play(strength,duration){
    if(!enabled)return 'off';
    const token=++generation;
    try{
      const pad=Array.from(nav.getGamepads?.()??[]).find(p=>p?.connected&&p.mapping==='standard');
      const motor=pad?.vibrationActuator;
      const legacy=pad?.hapticActuators?.[0];
      if(motor?.playEffect && supports(motor,'dual-rumble')){
        actuator=motor;
        const result=await motor.playEffect('dual-rumble',{startDelay:0,duration,
          strongMagnitude:strength,weakMagnitude:Math.min(1,.2+strength*.8)});
        if(token!==generation)return 'stopped';
        if(result!=='not-supported')return 'pad';
      }else if(legacy?.pulse || motor?.pulse){
        actuator=legacy?.pulse?legacy:motor;
        const ok=await actuator.pulse(strength,duration);
        if(token!==generation)return 'stopped';
        if(ok!==false)return 'pad';
      }
    }catch{}
    if(token!==generation||!enabled)return 'stopped';
    if(mobile()&&typeof nav.vibrate==='function'){
      try{phoneActive=nav.vibrate(duration)===true;if(phoneActive)return 'phone';}catch{}
    }
    return 'unavailable';
  }
  return {
    get enabled(){return enabled;},
    setEnabled(value){enabled=!!value;if(!enabled)stop();},
    test:()=>play(.55,160),
    impact(e){
      if(!enabled)return;
      const strength=e.destroyed?1:e.kind==='fire'?.24:clamp(.22+(e.damageDelta||0)*.022+(e.speed||0)*.009,.24,1);
      const duration=Math.round(55+210*strength);
      impactUntil=now()+duration+100;play(strength,duration);
    },
    turbulence(intensity){
      const t=now();
      if(!enabled||!Number.isFinite(intensity)||intensity<.16||t<nextWind||t<impactUntil)return;
      nextWind=t+680;play(clamp(intensity*.35,.10,.38),Math.round(45+70*Math.min(1,intensity)));
    },
    stop,
  };
}
