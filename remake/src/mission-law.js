// Korean help 19REF/20REF/24REF and spotlight, megaphone and gas references
// 29REF/34REF/35REF. PEOPLE.DF distinguishes Robber, Mugger, Arsonist and Car.
// Distances, timers and individual reactions below are the remake's tuning.
import {particles,waterCannon} from './mission-hazards.js';
import {roadDrivingPoint,roadEdgeLength} from './road-path.js';
import {completion,JAM_SECONDS,REMAKE_SERVICE_FEES} from './original-mission-economy.js';
import {pickIncidentSite} from './incident-sites.js';

const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
const roadKey=p=>p.id??p.row*128+p.col;
const actor=(api,name,clip)=>api.model(`models/complete/actors/${name}/${name}-LOD1.glb`,clip);
const vehicle=(api,name)=>api.model(`models/traffic/lod1/${name}-LOD1.glb`);
const height=(api,x,z)=>api.city.roadHeightAt?.(x,z)??api.city.surfaceAt(x,z);

// Runtime emergency vehicles travel at 7.2 m/s (police) and 6 m/s (fire).
// Each SC2 network hop is one equally long, connected cardinal tile. A BFS
// gives physical shortest-path travel time from the actual unit's parking bay.
const unitSpeed={police:7.2,fire:6};
const stationMaps=new WeakMap();
function travelTimes(sites,kind){
  if(!stationMaps.has(sites))stationMaps.set(sites,new Map());
  const maps=stationMaps.get(sites);
  if(maps.has(kind))return maps.get(kind);
  const start=sites.stations.find(s=>s.kind===kind)?.park,queue=start?[start]:[],times=new Map();
  if(start)times.set(roadKey(start),0);
  for(let i=0;i<queue.length;i++){
    const p=queue[i];
    for(const id of p.neighbors){
      const next=sites.roads.get(id);if(!next||times.has(id))continue;
      times.set(id,times.get(roadKey(p))+dist(p,next)/unitSpeed[kind]);queue.push(next);
    }
  }
  maps.set(kind,times);return times;
}

function roadsForCall(api,intersection=false,burning=false){
  const police=travelTimes(api.sites,'police'),fire=burning?travelTimes(api.sites,'fire'):null;
  const degree=intersection?3:2, candidates=[];
  for(const p of api.sites.street){
    const id=roadKey(p),patrol=police.get(id),engine=fire?.get(id);
    if(p.neighbors.length<degree||!Number.isFinite(patrol)||burning&&!Number.isFinite(engine))continue;
    candidates.push({p,arrival:burning?Math.max(patrol,engine):patrol});
  }
  if(!candidates.length)return null;
  // Reserve time for spotting the suspect, extinguishing the obstructing
  // vehicle, and clearing traffic. If two stations are far apart, use a real
  // junction within three seconds of their quickest joint response instead
  // of silently placing one vehicle across a disconnected district.
  const bestArrival=candidates.reduce((best,c)=>Math.min(best,c.arrival),Infinity);
  const normalBudget=intersection?95:75;
  const limit=Math.max(normalBudget,bestArrival+3);
  if(api.origin)return candidates.reduce((best,c)=>dist(c.p,api.origin)<dist(best.p,api.origin)?c:best);
  const road=pickIncidentSite(api,intersection?'road-jam':'road-patrol',candidates.filter(c=>c.arrival<=limit).map(c=>c.p));
  return candidates.find(c=>c.p===road);
}

// All targets advance along reciprocal SC2 road links. Preserve the fractional
// position when reversing, including a pedestrian's current side of the road.
function roadMover(api,start,node,lane=0){
  const graph=api.sites.roads;
  let from=start,to=graph.get(start.neighbors[api.serial%start.neighbors.length]),along=0,turns=0,side=lane,sideGoal=lane;
  if(api.origin&&api.city.tileAt(api.origin.x,api.origin.z)?.road){
    let closest=Infinity;
    for(const id of start.neighbors){
      const next=graph.get(id);if(!next)continue;
      const len=dist(start,next),dx=(next.x-start.x)/len,dz=(next.z-start.z)/len;
      const x=api.origin.x-start.x,z=api.origin.z-start.z,projection=x*dx+z*dz,offset=z*dx-x*dz;
      if(projection<0||projection>len||Math.abs(offset)>7.9||Math.abs(offset)>=closest)continue;
      closest=Math.abs(offset);to=next;along=projection;side=offset;
    }
  }
  function place(){
    const sample=roadDrivingPoint(from,to,along,side);
    node.position.set(sample.x,api.city.roadHeightAt?.(sample.x,sample.z,sample.level)??api.city.surfaceAt(sample.x,sample.z),sample.z);
    node.rotation.y=Math.atan2(sample.dx,sample.dz);
  }
  function move(dt,speed){
    side+=(sideGoal-side)*Math.min(1,dt*1.8);
    let remaining=dt*speed;
    while(remaining>0){
      const length=roadEdgeLength(from,to,side),step=Math.min(remaining,Math.max(0,length-along));
      along+=step;remaining-=step;
      if(along<length-1e-6)break;
      const prev=from;from=to;
      const exits=from.neighbors.map(id=>graph.get(id)).filter(p=>p&&p!==prev);
      if(exits.length>1){
        const dx=from.x-prev.x,dz=from.z-prev.z;
        exits.sort((a,b)=>(b.x-a.x)*dx+(b.z-a.z)*dz);
      }
      to=exits.length?exits[(++turns+api.serial)%4===0?exits.length-1:0]:prev;
      along=0;
    }
    place();
  }
  place();
  return {move,setSide(value){sideGoal=side=value;place();},reverse(){along=roadEdgeLength(from,to,side)-along;[from,to]=[to,from];side=-side;sideGoal=-sideGoal;place();},
    get ahead(){return to;}};
}

function send(api,kind,point){
  const ok=api.requestService(kind,point);
  api.notice(ok?(kind==='fire'?'소방차가 현장으로 출발했습니다.':'경찰차가 지정한 도로로 출발했습니다.'):'출동할 수 있는 연결 도로 또는 차량이 없습니다.');
  return ok;
}

function speeder(api){
  const s=api.state,site=roadsForCall(api);
  if(!site)return unavailable(api);
  const car=vehicle(api,'CARROBBR'),road=roadMover(api,site.p,car);
  let done=false,stopped=0,lost=0,seen=0,clock=0,hold=0,nextSqueal=0,dispatched=false,waitPayments=0;
  const target=car.position;
  Object.assign(s,{title:'과속 차량 단속',phase:'patrol',destination:'도로 순찰',instruction:'도로 중앙을 달리는 차량을 찾아 탐조등을 비추고 정차를 지시하세요.',
    target,hiddenTarget:true,suggestedTool:'stop',progress:0});
  function reveal(){
    if(!s.hiddenTarget)return;
    s.hiddenTarget=false;s.phase='pursuit';s.destination='과속 차량';s.instruction='탐조등 안에서 F7 또는 현장 작업으로 도로 가장자리에 세우세요.';
    api.fieldVoice?.('FIELD_SPOTTED');
  }
  function finish(ok){if(done)return;done=true;if(ok)api.fieldVoice?.('FIELD_TICKET');api.finish(ok?{outcome:'success',...completion('speeder'),message:'과속 차량 인계 완료 · 경찰이 운전자를 단속했습니다.'}:
    {outcome:'failed',reason:'escapedDriver',points:0,cash:0,message:'탐조등을 벗어난 과속 차량이 달아났습니다. 보상은 없습니다.'});}
  function requestStop(){
    if(!api.spotlit(target,24,85))return false;
    reveal();s.phase='hold';s.suggestedTool='follow';s.instruction='경찰차가 올 때까지 차량을 탐조등 안에 두세요. 이탈하면 운전자가 달아납니다.';
    dispatched=api.requestService('police',target);return true;
  }
  function update(dt){
    if(done)return;clock+=dt;const lit=api.spotlit(target,25,85);
    if(s.phase!=='hold'){
      road.move(dt,16.5);
      if(clock>=nextSqueal){nextSqueal=clock+7;if(dist(api.flight.position,target)<125)api.sound?.('screech',target);}
      if(s.hiddenTarget){seen=lit?seen+dt:0;if(seen>.4||api.serviceNearby?.('police',target,25))reveal();}
    }else{
      stopped=Math.min(1,stopped+dt*.85);road.setSide(2.65*stopped);road.move(dt,8*(1-stopped));
      lost=lit?0:lost+dt;hold=lit?hold+dt:Math.max(0,hold-dt);s.progress=clamp(hold/10,0,.95);
      if(lost>3.5){road.setSide(0);road.move(dt,16);finish(false);return;}
      if(stopped===1&&lit&&api.serviceAt('police',target,28)){finish(true);return;}
      // Native event 33 resets a 10-second fixed-point counter (004A13CE).
      if(stopped===1&&lit&&hold>=waitPayments*10){
        api.event?.('speederWait','wait/'+waitPayments);waitPayments++;
      }
    }
  }
  function act(tool){
    if(done)return false;
    if(tool==='stop'||tool==='context'&&s.phase!=='hold')return s.phase==='hold'?true:requestStop();
    if((tool==='police'||tool==='follow'||tool==='context')&&!s.hiddenTarget){
      dispatched=send(api,'police',target)||dispatched;return dispatched;
    }
    return false;
  }
  return {update,act,dispose(){done=true;}};
}

function unavailable(api){
  let pending=true;
  return {act:()=>false,dispose(){pending=false;},update(){if(pending){pending=false;api.finish({outcome:'failed',reason:'unavailable',points:0,cash:0,message:'이 도시에 출동 가능한 연결 도로가 없습니다.'});}}};
}

function traffic(api,variant){
  const s=api.state,site=roadsForCall(api,true,variant==='burning');
  if(!site)return unavailable(api);
  const junction=site.p;
  const graph=api.sites.roads,arms=junction.neighbors.map(id=>graph.get(id)).filter(Boolean);
  const burning=variant==='burning',fx=burning?particles(api):null,water=burning?waterCannon(api):null;
  const blocked=burning?vehicle(api,'AUTO3'):null;
  if(blocked){blocked.position.set(junction.x,height(api,junction.x,junction.z),junction.z);blocked.rotation.y=.93;}
  const cars=[];
  // Several drivers have already braked on different approaches. Each is
  // released onto a different connected road and must actually clear the box.
  for(let i=0;i<arms.length;i++){
    const a=arms[i],len=dist(a,junction),dx=(junction.x-a.x)/len,dz=(junction.z-a.z)/len;
    const car=api.model(`models/complete/objects/SIM3D2/${['AUTO','AUTO2','AUTO4','AUTO5'][i]}.glb`);
    const x=junction.x-dx*(9+i*.65)-dz*1.6,z=junction.z-dz*(9+i*.65)+dx*1.6;
    // Direct source coachwork spans about 3.3 m. Match the scaled city traffic.
    car.scale.set(.60,.84,.75);car.position.set(x,height(api,x,z),z);car.rotation.y=Math.atan2(dx,dz);
    cars.push({car,exit:arms[(i+1)%arms.length],moving:false,clear:false,speed:0});
  }
  let elapsed=0,heat=burning?1:0,done=false,policeClock=0,given=0;
  // A distant ground unit may still finish after the original 60s clock for half pay.
  const timely=JAM_SECONDS;
  const cleanup=Math.max(timely,Math.ceil(site.arrival+25))+125;
  function publish(){
    s.title=burning?'차량 화재 · 교차로 정체':'교차로 정체';s.target=junction;s.destination='정체 교차로';
    s.phase=heat>0?'burning':'redirect';s.suggestedTool=heat>0?(api.supplies.water>0?'cannon':'firetruck'):'traffic';
    s.instruction=heat>0?'소방차와 경찰차를 먼저 급파하거나, 급수 후 물대포·양동이로 차량 화재를 진압하세요.':
      '교차로에 탐조등을 비추고 F6으로 차량을 우회시키거나 경찰을 급파하세요. 통과 '+cars.filter(c=>c.clear).length+'/'+cars.length+'대.';
    const free=cars.filter(c=>c.clear).length/cars.length;
    s.progress=burning?.32*(1-heat)+.68*free:free;s.secondsLeft=Math.max(0,Math.ceil(timely-elapsed));
  }
  function release(count){for(const c of cars)if(!c.moving&&count-->0){c.moving=true;given++;}}
  function extinguish(amount){
    const old=heat;heat=Math.max(0,heat-amount);
    if(old>0&&heat===0){
      blocked.visible=false;api.sound?.('douse',junction);api.event?.('carDoused','blocker');
      api.updateVoice?.('D1023');api.notice('화재 차량이 치워졌습니다. 운전자들에게 우회를 지시하세요.');
    }
  }
  function draw(){
    if(!fx)return;fx.begin(elapsed);
    if(heat>0){
      for(let i=0;i<6;i++)fx.add(junction.x+Math.sin(i*2.3)*.95,junction.y+.5,junction.z+Math.cos(i*2.3)*1.4,3.2*Math.sqrt(heat),0,.55,0,i);
      for(let i=0;i<9;i++){const age=(elapsed*.23+i/9)%1;fx.add(junction.x+age*2,junction.y+1.7+age*5,junction.z,2.8+age*2,1,1,age,i);}
    }
    water.draw(fx);fx.end();
  }
  function update(dt){
    if(done)return;elapsed+=dt;water?.update(dt);
    if(heat>0&&api.serviceAt('fire',junction,39))extinguish(dt/7);
    if(!heat&&api.serviceAt('police',junction,39)){
      policeClock-=dt;if(policeClock<=0){release(1);policeClock=1.15;}
    }
    for(const c of cars)if(c.moving&&!c.clear){
      const p=c.car.position,t=c.exit,dx=t.x-p.x,dz=t.z-p.z,len=Math.hypot(dx,dz);
      c.speed=Math.min(7,c.speed+3*dt);const step=Math.min(len,c.speed*dt);
      if(len>.01){p.x+=dx/len*step;p.z+=dz/len*step;c.car.rotation.y=Math.atan2(dx,dz);p.y=height(api,p.x,p.z);}
      if(len<.3){c.clear=true;c.car.visible=false;api.event?.('trafficReleased','car/'+cars.indexOf(c));}
    }
    draw();publish();
    if(cars.every(c=>c.clear)){
      const onTime=elapsed<=timely;done=true;api.finish({outcome:onTime?'success':'partial',reason:onTime?undefined:'delayedTraffic',...completion('traffic',onTime?1:.5),
        message:onTime?'교차로 차량이 모두 통과했습니다. 완료 보상이 지급됩니다.':'교통은 정상화됐습니다. 지연된 출동은 일부 보상됩니다.'});
    }else if(elapsed>cleanup){done=true;api.finish({outcome:'failed',reason:'blockedTraffic',points:0,cash:0,message:'교차로가 계속 막혀 출동 시간이 종료됐습니다.'});}
  }
  function act(tool){
    if(done)return false;
    if(tool==='context')tool=s.suggestedTool;
    if(tool==='police'||tool==='follow')return send(api,'police',junction);
    if(tool==='firetruck'&&burning)return send(api,'fire',junction);
    if(tool==='cannon'&&heat>0){
      if(!api.spotlit(junction,24,65)||!api.near(junction,43,65,35)){api.notice('불타는 차량 가까이에서 탐조등을 맞추세요.');return false;}
      if(api.supplies.water<=0){api.notice('물이 부족합니다. 수면에서 급수하거나 소방차를 부르세요.');return false;}
      const amount=water.shoot(junction);if(amount<=0)return false;api.sound?.('water',junction);extinguish(amount/48);publish();return true;
    }
    if(tool!=='traffic')return false;
    if(heat>0){api.notice('불타는 차량이 아직 교차로를 가로막고 있습니다.');return false;}
    if(!api.spotlit(junction,30,90)){api.notice('정체된 교차로에 탐조등을 비춘 뒤 교통 방송을 하세요.');return false;}
    release(2);api.notice(given>=cars.length?'차량들이 연결 도로로 빠져나가고 있습니다.':'선두 차량이 우회합니다. 남은 차량에도 교통 방송을 하세요.');publish();return true;
  }
  publish();draw();return {update,act,
    waterImpact(p,amount){
      if(!done&&heat>0&&Math.abs(p.y-junction.y)<=3&&dist(p,junction)<=6){extinguish(amount/48);publish();}
    },
    activeFireSources:()=>!done&&heat>0?[{x:junction.x,y:junction.y,z:junction.z,intensity:heat,radius:6}]:[],
    dispose(){done=true;fx?.dispose();}};
}

function criminal(api,variant){
  const s=api.state,site=roadsForCall(api);
  if(!site)return unavailable(api);
  const deadline=Math.max(265,Math.ceil(site.arrival+85));
  const T=api.ctx.THREE,carrier=new T.Object3D(),mover=roadMover(api,site.p,carrier,variant==='getaway'?0:3.3);
  const suspect=actor(api,'Badguy','1Run'),officer=actor(api,'Kopp','1Run');officer.visible=false;
  const reaction=['yield','evade','armed'][api.serial%3];
  const canDrive=variant==='getaway'||(variant==='robber'&&reaction==='evade');
  const car=canDrive?vehicle(api,'CARROBBR'):null;
  const victim=variant==='mugger'||variant==='robber'?actor(api,'Woman','Inju'):null;
  const fx=particles(api),target=new T.Vector3().copy(carrier.position);
  const labels={robber:'절도범 추적',mugger:'노상강도 검거',arsonist:'방화범 검거',getaway:'도주 차량 추격'};
  let inCar=variant==='getaway',done=false,spotted=false,following=false,order=false,elapsed=0,lost=0,beam=0;
  let nextCrime=8,crimes=0,gasTime=0,gasCloud=null,blocks=0,blockDelay=0,shots=0,fired=false,arrestClock=0;
  let officerOut=false,escapeToCar=false,nextRadio=0,lastOrder=null,stopped=false,holdLost=0,policeCalled=false;
  if(victim)victim.visible=false;
  if(car&&!inCar){const a=mover.ahead;car.position.set(a.x,height(api,a.x,a.z),a.z);}
  function drawActors(){
    target.copy(carrier.position);suspect.visible=!inCar;suspect.position.copy(target);suspect.rotation.copy(carrier.rotation);
    if(inCar&&car){car.position.copy(target);car.rotation.copy(carrier.rotation);}
  }
  function publish(){
    s.title=labels[variant];s.target=target;s.hiddenTarget=false;s.destination=inCar?'도주 차량':'도보 용의자';
    s.phase=stopped?'contain':officerOut?'arrest':inCar?'chase':'search';
    s.suggestedTool=api.cabin.has('officer')&&api.flight.state.grounded&&api.near(target,35,6,4)?'officer':
      inCar&&!order?'stop':!following&&inCar?'follow':(!policeCalled&&!officerOut?'police':(inCar?'follow':'police'));
    s.instruction=stopped?'정차한 용의자를 계속 비추세요. 경찰관이 접근해 체포해야 검거됩니다.':inCar?
      '탐조등을 가깝게 맞춰 감속시키고 F7으로 정차 지시, F5로 경찰 추적 또는 F4로 앞길을 차단하세요.':
      '현장 가까운 도로에 F4로 경찰을 보내세요. 탑승한 경관은 헬기를 착륙시켜 투입할 수 있습니다.';
    if(gasTime>0)s.instruction='도보 용의자가 최루탄으로 멈췄습니다. 경찰관이 접근해야 체포됩니다.';
    s.progress=clamp((spotted?.14:0)+(policeCalled?.16:0)+(stopped||gasTime>0?.27:0)+Math.min(.36,arrestClock*.34),0,.96);
    s.secondsLeft=Math.max(0,Math.ceil(deadline-elapsed));
  }
  function end(caught){
    if(done)return;done=true;
    if(!caught){if(variant==='arsonist'&&lost>22)api.event?.('arsonistEscaped','escape');
      api.finish({outcome:'failed',reason:'escapedSuspect',points:0,cash:0,message:'용의자가 수색 범위를 벗어났습니다. 검거 보상은 없습니다.'});return;}
    api.fieldVoice?.('FIELD_ARREST');
    api.finish({outcome:'success',...completion('criminal'),
      message:'현장 경찰이 용의자를 체포했습니다. 검거 보상이 지급됩니다.'});
  }
  function dispatch(track,context=false){
    const dest=track||context?target:(api.aimPoint??target);
    const ok=send(api,'police',dest);
    if(ok){policeCalled=true;following=track;nextRadio=elapsed+2.5;lastOrder={x:dest.x,z:dest.z};}
    return ok;
  }
  function useOfficer(){
    if(api.flight.state.grounded&&api.cabin.has('officer')&&api.near(target,35,5,4)){
      api.cabin.remove('officer');officerOut=true;officer.visible=true;officer.position.copy(api.flight.position);
      officer.position.y=height(api,officer.position.x,officer.position.z);api.notice('탑승 경관이 내려 용의자에게 접근합니다.');return true;
    }
    if(api.cabin.has('officer')){api.notice('용의자 35m 안의 평지에 착륙한 뒤 경관을 내리세요.');return false;}
    const station=api.sites.stations.find(v=>v.kind==='police');
    if(!station||!api.flight.state.grounded||!api.near(station.park,37,7,3)){api.notice('경관을 태우려면 경찰서에 착륙하세요.');return false;}
    if(!api.cabin.add('officer',1)){api.notice('경관이 탈 빈 좌석이 없습니다.');return false;}
    api.charge?.(REMAKE_SERVICE_FEES.officer,'경관 탑승');api.notice('경관 1명이 탑승했습니다.');return true;
  }
  function useGas(){
    if(api.supplies.gas<=0){api.notice('최루탄이 없습니다. 기지에서 보급하세요.');return false;}
    const good=!inCar&&api.spotlit(target,18,55)&&api.near(target,45,55,35);
    api.supplies.gas--;gasCloud={...(good?target:(api.aimPoint??api.flight.position)),age:0};
    api.sound?.('gasPop',api.flight.position);api.sound?.('gas',gasCloud);
    if(!good){api.notice('최루탄이 도보 용의자를 벗어났습니다.');return true;}
    gasTime=8;spotted=true;api.notice('도보 용의자가 멈췄습니다. 현장 경찰을 접근시키세요.');publish();return true;
  }
  function crime(){
    if(variant==='getaway')return;
    // Consequences remain independent active calls with their own victims,
    // equipment and deadlines. The dispatcher deduplicates a repeated alert.
    const p={x:target.x,y:target.y,z:target.z};crimes++;
    if(variant==='arsonist'){api.secondary('fire','small',p);api.notice('방화 현장에서 화재가 신고됐습니다.');}
    else{
      p.x+=1.4;p.y=height(api,p.x,p.z);victim.position.set(p.x,p.y,p.z);victim.visible=true;
      api.event?.(variant==='mugger'?'personAssaulted':'robbery','crime/'+crimes);
      api.secondary('medevac','street',p);api.notice('범행 현장에 부상자가 있습니다. 의료 후송이 요청됐습니다.');
    }
  }
  function deployFromCar(){
    officerOut=true;officer.visible=true;
    // The arriving unit is on a real road close to the target. Emerge on the
    // roadside and walk the remaining distance instead of awarding a remote arrest.
    const near=api.sites.street.reduce((best,p)=>!best||dist(p,target)<dist(best,target)?p:best,null);
    const x=(near?.x??target.x)+2,z=(near?.z??target.z)+1;
    officer.position.set(x,height(api,x,z),z);
  }
  function walkOfficer(dt){
    if(!officerOut)return;
    const p=officer.position,dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);
    if(d>.1){const k=Math.min(1,4.2*dt/d);p.x+=k*dx;p.z+=k*dz;p.y=height(api,p.x,p.z);officer.rotation.y=Math.atan2(dx,dz);}
    if(d<2.8&&(!inCar||stopped)){arrestClock+=dt;if(arrestClock>1.15)end(true);}else arrestClock=0;
  }
  function update(dt){
    if(done)return;elapsed+=dt;gasTime=Math.max(0,gasTime-dt);shots=Math.max(0,shots-dt);blockDelay=Math.max(0,blockDelay-dt);
    const lit=api.spotlit(target,26,86),cop=api.serviceAt('police',target,28);
    if(lit||cop||officerOut)spotted=true;
    beam=lit?Math.min(12,beam+dt):Math.max(0,beam-dt*1.6);
    if(!spotted&&elapsed>=nextCrime&&crimes<2){crime();nextCrime=elapsed+44;}
    if(!inCar&&canDrive&&spotted&&!gasTime&&!officerOut&&elapsed>3)escapeToCar=true;
    if(following&&elapsed>=nextRadio&&(!lastOrder||dist(lastOrder,target)>12)){
      if(api.requestService('police',target,true))lastOrder={x:target.x,z:target.z};nextRadio=elapsed+2.5;
    }
    const confronting=cop||(officerOut&&dist(officer.position,target)<15);
    if(confronting&&blockDelay<=0&&!stopped&&!gasTime){
      if(!blocks&&reaction!=='yield'){
        mover.reverse();blocks++;blockDelay=4;api.notice('경찰을 본 용의자가 방향을 바꿨습니다.');
        if(reaction==='armed'&&!fired){fired=true;shots=.85;api.updateVoice?.('D2012');api.secondary('medevac','street',{...target});api.notice('용의자가 발포했습니다. 경찰이 현장을 차단합니다.');}
      }else if(!inCar||order||beam>1.6){stopped=true;}
    }
    if(!inCar&&cop&&!officerOut)deployFromCar();
    if(inCar&&stopped&&cop&&!officerOut)deployFromCar();
    if(inCar&&stopped&&!cop&&!officerOut){holdLost=lit?0:holdLost+dt;if(holdLost>3){stopped=false;order=false;}}
    let speed=inCar?14:spotted?3.1:1.1;
    if(inCar&&lit){const d=api.aimPoint?dist(api.aimPoint,target):8;speed*=.23+.53*clamp(d/26,0,1);}
    if(gasTime>0||stopped)speed=0;
    mover.move(dt,speed);
    if(escapeToCar&&car&&dist(car.position,carrier.position)<4.8){inCar=true;escapeToCar=false;stopped=false;mover.setSide(0);api.notice('용의자가 도주 차량에 탔습니다. 탐조등으로 계속 추적하세요.');}
    drawActors();walkOfficer(dt);if(done)return;
    lost=spotted&&!lit&&!cop&&dist(api.flight.position,target)>125?lost+dt:0;
    if(lost>22||elapsed>deadline){end(false);return;}
    fx.begin(elapsed);
    if(gasCloud){gasCloud.age+=dt;if(gasCloud.age<7){for(let i=0;i<6;i++){const a=gasCloud.age/7;
      fx.add(gasCloud.x+Math.sin(i*2)*a*3,gasCloud.y+.65+a,gasCloud.z+Math.cos(i*2)*a*2,2+a*3,3,1,a,i);}}else gasCloud=null;}
    if(shots>0&&Math.sin(shots*30)>-.2)fx.add(target.x+.38,target.y+1.23,target.z,.85,0,.5,0,3);
    fx.end();publish();
  }
  function act(tool){
    if(done)return false;const context=tool==='context';if(context)tool=s.suggestedTool;
    if(tool==='officer'||tool==='board')return useOfficer();
    if(tool==='gas')return useGas();
    if(tool==='police'||tool==='follow'){const ok=dispatch(tool==='follow',context);publish();return ok;}
    if(tool!=='stop')return false;
    if(!api.spotlit(target,24,85)){api.notice('탐조등을 용의자에게 맞춘 뒤 정차 방송을 하세요.');return false;}
    spotted=true;order=true;
    if(reaction==='yield'||gasTime>0||blocks>0&&beam>1.5){stopped=true;api.notice('용의자가 정지했습니다. 경찰에게 현장을 인계하세요.');}
    else api.notice('용의자가 정지 명령에 불응합니다. 경찰이 앞길을 막도록 유도하세요.');
    publish();return true;
  }
  drawActors();publish();return {update,act,dispose(){done=true;fx.dispose();}};
}

export function createLawIncident(api,type,variant){
  if(type==='speeder')return speeder(api);
  if(type==='traffic')return traffic(api,variant);
  if(type==='criminal')return criminal(api,variant);
  throw Error(`지원하지 않는 치안 임무: ${type}`);
}
