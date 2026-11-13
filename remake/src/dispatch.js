import {clone as cloneRig} from 'three/addons/utils/SkeletonUtils.js';
import {FLEET} from './fleet.js';
import profiles from './dispatch-profiles-data.js';
import {MISSIONS, cabinCapacity, splitMission} from './mission-catalog.js';
import {createLawIncident} from './mission-law.js';
import {createPassengerIncident} from './mission-passengers.js';
import {createHazardIncident} from './mission-hazards.js';
import {createBucketRig} from './bucket-rig.js';
import {createBucketWater} from './bucket-water.js';
import {createIncidentPicker} from './incident-sites.js';
import {BASE_WATER_LITRES} from './aircraft-loadout.js';
import {ECONOMY_EVENTS, economyKey, MISSION_CONTROLS, REMAKE_SERVICE_FEES} from './original-mission-economy.js';
export {ORIGINAL_END_REWARDS} from './original-mission-economy.js';

const HANDLERS={speeder:createLawIncident,traffic:createLawIncident,criminal:createLawIncident,
  rescue:createPassengerIncident,medevac:createPassengerIncident,transport:createPassengerIncident,fire:createHazardIncident,riot:createHazardIncident};
// Road response times depend on the actual network; the traffic handler owns its deadline.
const LIMITS={speeder:Infinity,traffic:Infinity,criminal:520,fire:630,riot:540,rescue:660,medevac:600,transport:480};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const EQUIPMENT={bucket:'급수 장비',cannon:'물대포',harness:'구조 밧줄',megaphone:'확성기',gas:'최루탄 발사기',spotlight:'탐조등'};
const TOOL_EQUIPMENT={bucket:'bucket',cannon:'cannon',harness:'harness',gas:'gas',traffic:'megaphone',stop:'megaphone',evacuate:'megaphone',disperse:'megaphone',greet:'megaphone'};

function makeCabin(capacity){
  const seats=new Map();
  return {get capacity(){return capacity();},get used(){return [...seats.values()].reduce((sum,seat)=>sum+seat.n,0);},
    get roster(){return [...seats.values()].map(seat=>seat.role);},
    get portraits(){return [...seats.values()].map(seat=>seat.portrait);},
    indexOf:key=>[...seats.keys()].indexOf(key),
    has:key=>seats.has(key), remove:key=>seats.delete(key),
    add(key,n=1,role='passenger',portrait=null){if(seats.has(key))return true;if(!Number.isInteger(n)||n<=0||this.used+n>this.capacity)return false;seats.set(key,{n,role,portrait});return true;}};
}
function makeLight(ctx,parent){
  const T=ctx.THREE,beam=new T.SpotLight(0xfff1ce,0,160,.30,.58,2);
  let aircraft,mountZ=1.6;
  beam.name='Aircraft searchlight';beam.visible=false;
  beam.castShadow=!!ctx.night;
  beam.shadow.mapSize.setScalar(512);beam.shadow.camera.near=.65;
  beam.shadow.bias=-.00035;beam.shadow.normalBias=.045;
  parent.add(beam,beam.target);
  return {update(flight,aim,enabled){
    beam.visible=enabled;
    if(!enabled)return;
    if(aircraft!==flight.state.id){aircraft=flight.state.id;mountZ=(FLEET.find(a=>a.id===aircraft)?.diameter??8)*.20;}
    beam.position.set(0,.45,mountZ);
    if(flight.object)flight.object.localToWorld(beam.position);else beam.position.add(flight.position);
    beam.target.position.copy(aim);
    const distance=beam.position.distanceTo(aim);
    beam.intensity=Math.min(3400,2.6*distance*distance);
  },dispose(){beam.removeFromParent();beam.target.removeFromParent();beam.dispose();}};
}
function modelsForCall(ctx,group,prepare,report){
  const objects=[],skeletons=new Set(),mixers=[],loading=[];let disposed=false;
  function play(entry,clip,instant=false){
    if(entry.clip===clip&&entry.action)return;
    entry.clip=clip;entry.instant=instant;
    if(!clip||!entry.content)return;
    const animation=entry.clips.find(a=>a.name===clip);
    if(!animation){report(entry.anchor.name+' / '+clip);return;}
    if(!entry.mixer){entry.mixer=new ctx.THREE.AnimationMixer(entry.content);mixers.push(entry.mixer);}
    if(instant)entry.mixer.stopAllAction();
    else if(entry.action)entry.action.fadeOut(.16);
    entry.action=entry.mixer.clipAction(animation).reset();
    if(!instant)entry.action.fadeIn(.16);
    entry.action.play();
    if(instant){entry.debt=0;entry.mixer.update(0);}
  }
  function model(path,clip){
    const anchor=new ctx.THREE.Group();group.add(anchor);anchor.name=path;
    const entry={anchor,content:null,clip,mixer:null,action:null,debt:0};objects.push(entry);
    const job=ctx.assets.load(path).then(template=>{
      if(disposed)return;
      let skinned=false;template.traverse(o=>{if(o.isSkinnedMesh)skinned=true;});
      const body=skinned?cloneRig(template):template.clone(true);entry.content=body;
      body.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton);if(o.isMesh) o.material=Array.isArray(o.material)?o.material.map(prepare):prepare(o.material);});
      anchor.add(body);
      entry.clips=template.animations??[];play(entry,entry.clip,entry.instant);
    }).catch(()=>{if(!disposed)report(path);});
    loading.push(job);
    return anchor;
  }
  return {model,setClip(anchor,clip,instant){const entry=objects.find(e=>e.anchor===anchor);if(entry)play(entry,clip,instant);},ready:()=>Promise.all(loading),update(dt){
    for(const e of objects){if(!e.content)continue;const d=distance(e.anchor.position,ctx.camera.position);
      e.content.visible=d<800;if(!e.mixer||!e.anchor.visible||d>160)continue;
      e.debt+=dt;if(e.debt >= (d<55?0:.12)){e.mixer.update(e.debt);e.debt=0;}
    }
  },dispose(){disposed=true;for(const m of mixers){m.stopAllAction();m.uncacheRoot(m.getRoot());}skeletons.forEach(s=>s.dispose());group.removeFromParent();group.clear();}};
}

export function createDispatch({ctx,city,flight,sites,parent,worldState,send,arrived,release,notice,prepare,selection='auto',rng=Math.random,loadout,onRadio=()=>{},firstCallDelay=0}){
  const calls=[],secondaryQueue=[],history=[],variants=new Map();
  let tabHistory;
  if(rng===Math.random){try{tabHistory=globalThis.sessionStorage;}catch{}}
  const pickSite=createIncidentPicker(city.cityId,rng,tabHistory);
  // An omitted loadout preserves the original sandbox/test API. An explicit
  // object is authoritative and is read live so a purchased item unlocks at once.
  const owns=key=>loadout===undefined||!!loadout?.[key];
  const missing=tool=>{
    const key=TOOL_EQUIPMENT[tool];
    if(key&&!owns(key))return key;
    if(tool==='cannon'&&!owns('bucket'))return 'bucket';
    return null;
  };
  const shopMessage=key=>`${EQUIPMENT[key]} 미보유 또는 미장착 · 기지 상점에서 장착하세요.`;
  const cabin=makeCabin(()=>cabinCapacity(flight.state.id));
  let water=0,gas=10;
  const supplies={
    get waterScale(){return (flight.state.fit?.water?.capacityLitres??BASE_WATER_LITRES)/BASE_WATER_LITRES;},
    get pumpFactor(){return flight.state.fit?.modifiers.pumpFactor??1;},
    get water(){return owns('bucket')?water:0;},set water(value){water=owns('bucket')?Math.max(0,Math.min(100,Number(value)||0)):0;},
    get gas(){return owns('gas')?gas:0;},set gas(value){gas=Math.max(0,Math.min(10,Number(value)||0));},
    get gasStock(){return gas;}
  };
  const cityScale={small:0,medium:1,large:2}[city.citySize]??0;
  const profile=city.generated?{difficulty:cityScale,weights:{traffic:2+cityScale,fire:2,rescue:2,medevac:2,criminal:1+cityScale,transport:2,riot:1}}:profiles[city.cityId];
  const practice=splitMission(selection),light=makeLight(ctx,parent);
  let focus=null,serial=0,clock=0,nextRadio=firstCallDelay,disposed=false;
  const bucket=createBucketWater({T:ctx.THREE,parent,city,flight,sites,supplies,owns,notice,
    rig:createBucketRig({...ctx,scene:ctx.scene??parent},city,flight),
    sound:(name,p)=>ctx.sound?.sceneCue?.(name,distance(p,flight.position)),
    impact:(point,amount)=>{for(const c of calls)if(!c.done)c.handler?.waterImpact?.(point,amount);}});
  worldState.bucket=bucket.state;
  const events=[];
  function reportEvent(text){events.push({text,at:clock});if(events.length>2)events.shift();}
  const balance={score:0,cash:0,completed:0,failed:0,partial:0,ledger:0};
  const journal=[],pendingAdjustments=[],externalEvents=new Set();
  function record(key,subject,cash,points,callId=null){
    balance.score+=points;
    balance.cash+=cash;
    balance.ledger++;
    journal.push({id:balance.ledger,key,subject,cash,points,at:clock,callId});
    pendingAdjustments.push({id:balance.ledger,cash,points});
    if(journal.length>128)journal.shift();
    const amounts=[];
    if(cash)amounts.push((cash>0?'+':'')+cash+'달러');
    if(points)amounts.push((points>0?'+':'')+points+'점');
    reportEvent(key==='completion'?subject+' · '+points+'점, '+cash+'달러':subject+(amounts.length?' · '+amounts.join(', '):''));
  }
  function incidentEvent(store,key,subject,eventId,callId=null){
    key=economyKey(key);
    if(disposed||!key)return false;
    // An ID identifies one genuine causal event, not a target model or a frame.
    if(eventId!==undefined&&eventId!==null){
      const token=key+'/'+String(eventId);
      if(store.has(token))return false;
      store.add(token);
    }
    const rule=ECONOMY_EVENTS[key];
    record(key,subject||rule.label,rule.cash,rule.points,callId);
    return true;
  }
  function reportIncident(key,subject,eventId){
    const accepted=incidentEvent(externalEvents,key,subject,eventId);
    if(accepted){Object.assign(worldState,balance);worldState.journal=journal;notice(events.at(-1).text,4);}
    return accepted;
  }
  const aim=new ctx.THREE.Vector3();let yawOffset=0,reach=0;
  const report=path=>{if(!worldState.assetErrors.includes(path))worldState.assetErrors.push(path);};
  function refreshAim(){
    const p=flight.position,s=flight.state;
    const forward=Math.min(35,Math.max(0,(s.altitudeAGL??0)*.28+reach)),angle=((s.heading??0)+yawOffset)*Math.PI/180;
    aim.x=p.x+Math.sin(angle)*forward;aim.z=p.z-Math.cos(angle)*forward;
    const land=city.surfaceAt(aim.x,aim.z),roof=city.roofAt?.(aim.x,aim.z);
    aim.y=Math.max(land,Number.isFinite(roof)?roof:-Infinity)+.18;
    light.update(flight,aim,owns('spotlight')&&(s.altitudeAGL??0)>1);
  }
  function available(type,variant){
    if(['medevac','transport','rescue'].includes(type)&&cabin.capacity<1)return false;
    if(type==='rescue'&&variant==='train')return !!ctx.transit?.trainRoof?.();
    if(type==='rescue'&&variant==='boat')return sites.harbor.length>0;
    if(type==='rescue'&&variant==='roof')return city.placements?.some(p=>p.roofY>p.y+2)??false;
    return true;
  }
  function variantFor(type){
    const choices=Object.keys(MISSIONS[type].variants).filter(v=>available(type,v));
    if(!choices.length)return null;
    const index=variants.get(type)||0;variants.set(type,index+1);return choices[index%choices.length];
  }
  function automatic(type,variant){
    if(type==='rescue'&&!owns('harness'))return false;
    if(type==='speeder'&&(!owns('megaphone')||!owns('spotlight')))return false;
    return available(type,variant);
  }
  function recommendation(call){
    const tool=call?.state.suggestedTool??'context',key=missing(tool);
    if(!key)return {tool,key:null};
    // Keep useful paid ground responses available without helicopter equipment.
    // Manual attempts to use the absent item still fail at act's central gate.
    let fallback=null;
    if(call.type==='fire')fallback='firetruck';
    if(call.type==='traffic')fallback=call.state.phase==='burning'?
      (owns('bucket')&&supplies.water>0?'bucket':'firetruck'):'police';
    if(call.type==='criminal')fallback=call.variant==='getaway'?'follow':'police';
    if(call.type==='riot')fallback='police';
    return {tool:fallback??tool,key,fallback:!!fallback};
  }
  function selectRadio(){
    const weights=profile?.weights??{traffic:1,fire:1,rescue:1,medevac:1,criminal:1,transport:1,riot:1};
    const eligible=Object.keys(weights).filter(t=>weights[t]>0&&Object.keys(MISSIONS[t].variants).some(v=>automatic(t,v)));
    const candidates=eligible.filter(t=>!calls.some(c=>!c.done&&c.type===t));
    if(!candidates.length)return;
    let roll=rng()*candidates.reduce((n,t)=>n+weights[t],0);
    const type=candidates.find(t=>(roll-=weights[t])<0)??candidates.at(-1);
    return startCall(type,variantFor(type));
  }
  function complete(call,result){
    if(call.done)return;
    const {outcome='success',points=0,cash=0,message='출동 완료'}=result;
    call.done=true;call.finishedAt=clock;call.outcome=outcome;
    record('completion',call.state.title+' '+call.id+' · '+(outcome==='failed'?'실패':'종료'),cash,points,call.id);
    if (cash > 0) ctx.sound?.cue?.(true);
    if(outcome==='failed')balance.failed++;else{balance.completed++;if(outcome==='partial')balance.partial++;}
    call.state.phase=outcome==='failed'?'failed':'complete';call.state.target=null;call.state.instruction=message;
    call.state.progress=outcome==='failed'?0:1;call.state.secondsLeft=null;call.state.suggestedTool='context';
    history.unshift({id:call.id,type:call.type,variant:call.state.variant,outcome,points,cash,message});if(history.length>12)history.pop();
    onRadio({kind:outcome==='success'?'complete':outcome,id:call.id,type:call.type,variant:call.state.variant,reason:result.reason,message});
    if(!calls.some(c=>!c.done&&!c.state.hiddenTarget))nextRadio=Math.min(nextRadio,clock+6);
    notice(message,4);
  }
  function startCall(type,variant,origin=null,{silent=false}={}){
    if(!HANDLERS[type]||!available(type,variant))return null;
    const id=++serial,group=new ctx.THREE.Group();group.name='Incident '+id+' '+type;parent.add(group);
    const art=modelsForCall(ctx,group,prepare,report);
    const state={type,variant,title:MISSIONS[type].name,phase:'dispatch',target:null,instruction:'',destination:'',progress:0,suggestedTool:'context',secondsLeft:null,hiddenTarget:silent};
    const call={id,type,variant,origin,state,art,group,done:false,began:clock,children:new Set(),units:new Set()};
    calls.push(call);
    if(focus===null&&!silent)focus=id;
    function charge(amount,message='현장 출동 비용'){if(!call.done&&Number.isFinite(amount)&&amount>0)record('charge',message,-Math.round(amount),0,id);}
    const credits=new Set(),spokenUpdates=new Set();
    function event(key,eventId,message,clip){
      if(call.done || !incidentEvent(credits,key,message,eventId,id))return false;
      if(clip && focus===id)onRadio({kind:'field',clip,id:id+'/'+eventId});
      return true;
    }
    const api={ctx,city,flight,sites,group,state,cabin,supplies,bucket,origin,serial:id,model:art.model,setClip:art.setClip,charge,event,aimPoint:aim,
      pickSite:(role,candidates)=>pickSite(role,candidates,calls.filter(c=>c!==call&&!c.done)
        .map(c=>c.state.incidentSite??c.state.target).filter(Boolean)),
      sound:(name,target)=>ctx.sound?.sceneCue(name,distance(flight.position,target)),
      updateVoice:clip=>{
        if(focus!==id||spokenUpdates.has(clip))return;
        spokenUpdates.add(clip);onRadio({kind:'update',type,clip,id:id+'/'+clip});
      },
      fieldVoice:clip=>{if(focus===id || clip==='FIELD_SPOTTED')onRadio({kind:'field',clip,id:'field-'+id+'-'+clip});},
      notice:(message,seconds)=>{if(focus===id||focus===null)notice(message,seconds);},focused:()=>focus===id,
      finish:result=>complete(call,result),
      near(target,radius,height,speed=Infinity){if(!target)return false;const dy=flight.position.y-target.y;
        return distance(flight.position,target)<=radius&&dy>=-2&&dy<=height&&(flight.state.speed||0)<=speed;},
      spotlit(target,radius=28,height=95){return owns('spotlight')&&!!target&&distance(aim,target)<=radius&&Math.abs(flight.position.y-target.y)<=height;},
      requestService(kind,target,quiet=false){call.requestAttempted=true;if(!target||!send(kind,target,id,quiet))return false;if(!call.units.has(kind)){charge(REMAKE_SERVICE_FEES.response);call.units.add(kind);}return true;},
      serviceAt:(kind,target,radius=40)=>!!target&&arrived(kind,target,radius,id),
      serviceNearby:(kind,target,radius=40)=>!!target&&arrived(kind,target,radius,null),
      secondary(type,variant,point){const key=type+'/'+variant;if(!HANDLERS[type]||call.children.has(key)||secondaryQueue.length>=6)return;
        call.children.add(key);secondaryQueue.push({type,variant,origin:point?{x:point.x,y:point.y,z:point.z}:null});}
    };
    try{call.handler=HANDLERS[type](api,type,variant);}catch(err){art.dispose();calls.splice(calls.indexOf(call),1);throw err;}
    call.announced=silent || type==='speeder';
    announceDispatch(call);
    return call;
  }
  function announceDispatch(call){
    const {id,type,state}=call,p=state.incidentSite??state.target;
    if(call.done || call.announced || !p)return;
    call.announced=true;
    const bounds=city.bounds??{minX:-1024,maxX:1024,minZ:-1024,maxZ:1024};
    const x=(p.x-bounds.minX)/(bounds.maxX-bounds.minX),z=(p.z-bounds.minZ)/(bounds.maxZ-bounds.minZ);
    const ew=x<1/3?'서':x>2/3?'동':'',ns=z<1/3?'북':z>2/3?'남':'';
    onRadio({kind:'dispatch',id,type,variant:state.variant,sector:ns+ew||'중앙',message:state.title});
    reportEvent(state.title+' '+id+' · 시작됨');notice('관제 호출 · '+state.title,3);
  }
  function remove(call){
    release(call.id);call.handler?.dispose();call.art.dispose();calls.splice(calls.indexOf(call),1);
    if(focus===call.id)focus=null;
  }
  function projected(){
    const focused=calls.find(c=>c.id===focus);
    const snapshot=focused?.state;
    const advice=recommendation(focused),support=advice.fallback&&['fire','riot'].includes(focused?.type);
    const st=worldState;
    Object.assign(st,balance,{history,events,journal,clock,roster:cabin.roster,cabinPortraits:cabin.portraits,serial:focused?.id??0,supplies,cabinUsed:cabin.used,cabinCapacity:cabin.capacity,
      calls:calls.filter(c=>!c.done&&!c.state.hiddenTarget).map(c=>{
        const remaining=Number.isFinite(c.state.secondsLeft)?c.state.secondsLeft:LIMITS[c.type]-(clock-c.began);
        return {id:c.id,type:c.type,variant:c.state.variant,phase:c.state.phase,title:c.state.title,
          target:c.state.target,incidentSite:c.state.incidentSite,focused:c.id===focus,
          secondsLeft:Number.isFinite(remaining)?Math.max(0,remaining):null};
      }),
      type:snapshot?.type??'patrol',title:snapshot?.title??'도시 순찰',phase:snapshot?.phase??'patrol',
      instruction:snapshot?.instruction??'도시를 순찰하며 관제 무전을 기다리세요.',destination:snapshot?.destination??'',
      progress:snapshot?.progress??0,target:snapshot?.hiddenTarget?null:(snapshot?.target??null),
      suggestedTool:advice.tool,lastResult:history[0]?.message??'',
      loadout:Object.fromEntries(Object.keys(EQUIPMENT).map(key=>[key,owns(key)])),
      equipmentNotice:advice.key?shopMessage(advice.key):''});
    if(advice.key&&!focused?.done){
      if(support&&snapshot.incidentSite){st.target=snapshot.incidentSite;st.destination=focused.type==='fire'?'화재 현장':'군중 집결 도로';}
      if(support&&snapshot.phase==='refill')st.phase='support';
      const alternative=({firetruck:'소방차 급파',police:'경찰차 급파',follow:'경찰 추적',bucket:bucket.state.name+' 투하'})[advice.tool];
      st.instruction=advice.fallback?`${shopMessage(advice.key)} 현재 권장 작업은 ${alternative}입니다.`:
        shopMessage(advice.key)+' '+st.instruction;
    }
    st.remainingCrowd=snapshot?.remainingCrowd??null;
    const limit=focused&&!focused.done?LIMITS[focused.type]-(clock-focused.began):Infinity;
    st.secondsLeft=snapshot?.secondsLeft??(Number.isFinite(limit)?Math.max(0,limit):null);
    st.distance=st.target?distance(flight.state.onFoot&&flight.playerPosition?flight.playerPosition:flight.position,st.target):0;
    st.activeCount=calls.filter(c=>!c.done&&!c.state.hiddenTarget).length;
  }
  function cycle(){
    const listed=calls.filter(c=>!c.done&&(!c.state.hiddenTarget||practice?.type==='speeder'));
    if(listed.length){const i=listed.findIndex(c=>c.id===focus);focus=listed[(i+1)%listed.length].id;}
    projected();
  }
  function update(dt){
    if(disposed)return;clock+=dt;refreshAim();
    bucket.update(dt);
    for(const c of [...calls]){
      if(c.done){if(clock>=c.finishedAt+4)remove(c);continue;}
      c.handler.update(dt);c.art.update(dt);
      if(!c.announced)announceDispatch(c);
      if(!c.done&&clock-c.began>=LIMITS[c.type])complete(c,{outcome:'failed',reason:'timeout',points:0,cash:0,message:c.state.title+' · 출동 시간 초과'});
    }
    while(secondaryQueue.length&&calls.filter(c=>!c.done&&!c.state.hiddenTarget).length<4){
      const child=secondaryQueue.shift();startCall(child.type,child.variant,child.origin);
    }
    if(practice){
      if(!calls.length){const target=startCall(practice.type,practice.variant);if(target)focus=target.id;}
    }else{
      if(automatic('speeder','patrol')&&!calls.some(c=>c.type==='speeder'))startCall('speeder','patrol',null,{silent:true});
      const announced=calls.filter(c=>!c.state.hiddenTarget&&!c.done);
      const general=MISSION_CONTROLS['General Miss'];
      if(clock>=nextRadio&&announced.length<general[0][1]){
        const call=selectRadio();
        const difficulty=Math.min(3,profile?.difficulty||0);
        nextRadio=clock+(call?general[1][1]*(1-general[2][1]*difficulty):8);
      }
    }
    if(focus===null)focus=calls.find(c=>!c.done&&!c.state.hiddenTarget)?.id??null;
    if(!owns('bucket'))supplies.water=0;
    projected();
  }
  const megaphoneGroups = {traffic:[0,10],stop:[1,8],evacuate:[2,9],disperse:[3,9],greet:[4,10]};
  const megaphoneCursors = new Map(), lastAnnouncement = new Map();
  function announce(tool) {
    const group = megaphoneGroups[tool];
    if (!group || clock - (lastAnnouncement.get(tool) ?? -Infinity) < 1.8) return;
    lastAnnouncement.set(tool,clock);
    const next = megaphoneCursors.get(tool) || 0;
    const clip = 'MG_0'+group[0]+'_'+String(next).padStart(2,'0');
    onRadio({kind:'megaphone',clip});
    megaphoneCursors.set(tool,(next+1)%group[1]);
  }
  function act(tool='context'){
    if(disposed)return false;
    if(flight.state.onFoot){notice('장비는 헬기에 탑승한 뒤 사용하세요.');return false;}
    const denied=missing(tool);
    if(denied){notice(shopMessage(denied));projected();return false;}
    // An instant action has no elapsed hold. Leave the cable and valve
    // alone; interactive bucket controls use their paired down/up edges.
    if(tool==='bucket'){notice(bucket.state.kind==='tank'?'투하 버튼을 누르고 있는 동안 탱크에서 물이 나옵니다.':'줄을 내린 뒤 투하 버튼을 누르고 있는 동안 물이 나옵니다.');return false;}
    announce(tool);
    if(tool==='greet')return true;
    refreshAim();let current=calls.find(c=>c.id===focus&&!c.done);
    const patrol=calls.find(c=>!c.done&&c.type==='speeder'&&c.state.hiddenTarget);
    if((tool==='stop'||!current&&tool==='context')&&patrol&&patrol!==current){
      const key=missing('stop');if(key){notice(shopMessage(key));projected();return false;}
      const worked=patrol.handler.act(tool==='context'?'stop':tool);
      if(worked){if(tool==='context')announce('stop');focus=patrol.id;projected();return true;}
    }
    if(!current){projected();return !!megaphoneGroups[tool];}
    const advice=tool==='context'?recommendation(current):null;
    const resolved=advice?.tool??tool,key=missing(resolved);
    if(key){notice(shopMessage(key));projected();return false;}
    if(resolved==='bucket')return act('bucket');
    // Criminal context deliberately sends police to the suspect, whereas F4
    // sends them to the aiming point. Preserve that distinction after gating.
    if (tool==='context') announce(resolved);
    const action=tool==='context'&&!advice.fallback?'context':resolved;
    current.requestAttempted=false;
    let result=current.handler.act(action);
    if(!result&&!current.requestAttempted){const kind=({firetruck:'fire',ambulance:'hospital',police:'police',follow:'police'})[resolved];
      if(kind&&send(kind,aim,current.id)){if(!current.units.has(kind)){record('charge','긴급 차량 출동',-REMAKE_SERVICE_FEES.response,0,current.id);current.units.add(kind);}notice('탐조등 지점으로 긴급 차량을 보냈습니다.');result=true;}}
    projected();return result;
  }
  return {update,act,cycle,reportIncident,
    beginBucket:stamp=>!disposed&&bucket.begin(stamp),endBucket:stamp=>{if(!disposed)bucket.end(stamp);},
    toggleBucketCable:()=>!disposed&&bucket.toggle(),getBucketAim:()=>!disposed?bucket.getAim():null,
    getAdjustments:(afterLedger=0)=>pendingAdjustments.filter(entry=>entry.id>afterLedger).map(entry=>({...entry})),
    ackAdjustments(ledger){
      if(!Number.isSafeInteger(ledger)||ledger<0||ledger>balance.ledger)return;
      let count=0;
      while(count<pendingAdjustments.length&&pendingAdjustments[count].id<=ledger)count++;
      if(count)pendingAdjustments.splice(0,count);
    },
    getFireSources:()=>calls.filter(c=>!c.done).flatMap(c=>c.handler?.activeFireSources?.()??[]),
    ready:()=>Promise.all(calls.map(c=>c.art.ready())),
    recall(tool){const kind=({firetruck:'fire',ambulance:'hospital',police:'police',follow:'police'})[tool];
      if(kind&&release(focus,kind)){calls.find(c=>c.id===focus)?.units.delete(kind);notice('긴급 차량이 복귀합니다.');}},
    aim(yaw,range){yawOffset=Math.max(-75,Math.min(75,yawOffset+yaw));reach=Math.max(-20,Math.min(65,reach+range));refreshAim();},
    choose(id){if(calls.some(c=>c.id===id&&!c.done&&!c.state.hiddenTarget)){focus=id;projected();return true;}return false;},
    dispose(){disposed=true;for(const c of [...calls])remove(c);bucket.dispose();light.dispose();}
  };
}
