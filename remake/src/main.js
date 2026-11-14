import {createPadNavigation,flightPadAllowed} from './pad-navigation.js';
import {createWorld,makeSound} from './runtime.js';
import {HELICOPTERS,createFlight} from './flight.js';
import {createMissions} from './missions.js';
import {createTransit,hasTrainRoute} from './transit.js';
import {MISSIONS,TOOLS,SHORTCUTS,cabinCapacity,splitMission} from './mission-catalog.js';
import {addGroundDetail} from './ground-detail.js';
import {showMap} from './nav-map.js';
import {rankIncidents} from './incident-priority.js';
import {addHorizon} from './horizon.js';
import {createCivic} from './civic.js';
import {createCareer,AIRCRAFT_CATALOG} from './career.js';
import {createHangarShop,money,requiredEquipment} from './hangar-shop.js';
import {createTouchControls} from './touch-controls.js';
import {createTiltControls} from './tilt-controls.js';
import {createFlightHaptics} from './haptics.js';
import {createFlightPadGestures} from './flight-pad-actions.js';
import {createInstallSupport} from './install.js';
import {enableMultitouchButtons} from './multitouch-buttons.js';

import {createCockpitDisplay} from './cockpit-display.js';
import {createOriginalRadio} from './original-radio.js';
import {dispatchPhrase} from './dispatch-phrases.js';
import {soundLibrary} from './sound-library.js';
import {setupSoundEditor} from './sound-editor.js';
import {citySizes,citySeed,campaignDistrict,districtRoute} from './city-worlds.js';
import {generatedCityId} from './generated-city.js';
import {createPadActions} from './pad-actions.js';
import {createHomeBase} from './home-base.js';
import {createWeather} from './weather.js';
import {updateWeatherDisplay,updateWeatherForecast} from './weather-display.js';

const $=id=>document.getElementById(id), qs=new URLSearchParams(location.search);
const store={get(k,def){try{return localStorage.getItem('simcopter.'+k)??def;}catch{return def;}},set(k,v){try{localStorage.setItem('simcopter.'+k,String(v));}catch{}}};
const sound=makeSound();let soundOn=store.get('sound','on')==='on';sound.setEnabled(soundOn);
let mode='menu',ctx,city,flight,missions,transit,civic,civicDue=0,last=0,elapsed=0,hudDue=0,clockSamples=[],avg=0,scale=1,nextScale=3,slow=0,fast=0;
let prevPhase='',held=[],diagFrames=[],validationTicket=0,menuReady=false;
let campaignCity=null,promotionCalled=false,currentProfile=null,departureLens=null;
let homeBase,enteredDoor=false,wasOnFoot=true,lastConditionAt=0,radioUntil=0,noticeUntil=0,playerNotice='',swapJob=null;
const shiftSeed=crypto.getRandomValues(new Uint32Array(1))[0];
let plannedCityId,plannedCity;
const externalHolds=new Set();
let heldTool=null;
const flightPadGestures=createFlightPadGestures();
let padDownControlsCable=false;
const cockpit=createCockpitDisplay(tool=>action(tool));
const savedDialogue=store.get('dialogue-language','ko')==='en'?'en':'ko';
const radio=createOriginalRadio({language:savedDialogue,library:soundLibrary, phraseURL:dispatchPhrase, station:store.get('station','mix'),isNight:()=>ctx?.night===true,
  onState:s=>{$('station').value=s.station;$('radioTrack').textContent=s.station==='off'?'음악 꺼짐':s.stationName+(s.title?' · '+s.title:'');},
  onSpeech:({event,text,language})=>{
    const en=language==='en', channel=en?({megaphone:'PA',field:'On scene',service:'Ground crew',station:'Radio'}[event.kind] || 'Dispatch'):
      ({megaphone:'확성기',field:'현장',service:'지원',station:'방송'}[event.kind] || '관제');
    const subtitle=$('radioMessage');subtitle.lang=en?'en':'ko';subtitle.textContent=text?'['+channel+'] '+text:'';radioUntil=elapsed+9;
  },
  onDuck:value=>sound.setDuck(value)});
radio.setEnabled(soundOn);
setupSoundEditor({language:savedDialogue,onLanguage:lang=>{
  store.set('dialogue-language',lang);$('radioMessage').textContent='';radioUntil=0;radio.setLanguage(lang);
}});
function say(message){playerNotice=message;noticeUntil=elapsed+5;}
const diag=qs.get('diag')==='1',fields=[$('citySelect'),$('heliSelect'),$('missionSelect'),$('quality'),$('controlsSelect'),$('scheme'),$('shift'),$('weatherSelect')];
const mobileDevice=()=>navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse) and (hover: none)').matches;
let invertCameraX=store.get('invertCameraX','off')==='on';
function drawCameraPreference(){
  $('invertCameraX').setAttribute('aria-pressed',String(invertCameraX));
  $('invertCameraX').textContent=invertCameraX?'시점 좌우 반전 켜짐':'시점 좌우 반전 꺼짐';
}
$('invertCameraX').onclick=()=>{
  invertCameraX=!invertCameraX;store.set('invertCameraX',invertCameraX?'on':'off');drawCameraPreference();
};
drawCameraPreference();
const haptics=createFlightHaptics({enabled:store.get('vibration','on')==='on',mobile:mobileDevice});
const tilt=createTiltControls({onChange:drawTiltOptions});
function drawTiltOptions(status){
  const busy=status==='requesting';
  const message={off:'',requesting:'센서 권한을 요청하는 중입니다.',waiting:'평소 비행할 자세로 기기를 잡으세요.',
    ready:'중립 설정 완료 · 앞뒤로 기울이면 피치, 좌우로 기울이면 뱅크를 조종합니다.',
    unsupported:'이 환경에서는 자세 센서를 사용할 수 없습니다. 화면 스틱으로 조종하세요.',
    denied:'자세 센서 권한이 거부됐습니다. 화면 스틱으로 조종하거나 다시 시도하세요.',
    'no-signal':'자세 센서 신호가 없습니다. 화면 스틱으로 조종하거나 다시 시도하세요.'}[status];
  for(const id of ['tiltMenu','tiltToggle']){
    const button=$(id);button.disabled=busy;button.setAttribute('aria-pressed',String(tilt.enabled));
    button.textContent=busy?'권한 확인 중':tilt.enabled?'기울기 조종 끄기':'기울기 조종 켜기';
  }
  for(const id of ['tiltCenter','tiltCenterMenu'])$(id).hidden=!tilt.enabled;
  $('tiltMenuStatus').textContent=$('tiltStatus').textContent=message;
}
function showHaptics(){
  $('hapticToggle').textContent=haptics.enabled?'진동 켜짐':'진동 꺼짐';
  $('hapticToggle').setAttribute('aria-pressed',String(haptics.enabled));
  $('hapticTest').disabled=!haptics.enabled;$('hapticStatus').textContent='';
}
showHaptics();
$('hapticToggle').onclick=()=>{haptics.setEnabled(!haptics.enabled);store.set('vibration',haptics.enabled?'on':'off');showHaptics();};
$('hapticTest').onclick=async()=>{
  const output=await haptics.test();
  if(mode==='paused'&&haptics.enabled)$('hapticStatus').textContent=({
    pad:'패드에 테스트 진동을 보냈습니다.',phone:'모바일 기기에 테스트 진동을 보냈습니다.',
    unavailable:'이 브라우저에서 사용할 수 있는 진동 장치를 찾지 못했습니다.'})[output]??'';
};
for(const id of ['tiltMenu','tiltToggle'])$(id).onclick=()=>{
  if(tilt.enabled){tilt.disable();flight?.setTouchInput(touch.state);return;}
  if(touch.inputMode==='off'||touch.inputMode==='auto'&&!mobileDevice()){$('controlsSelect').value='touch';$('controlsSelect').dispatchEvent(new Event('change'));}
  void tilt.enable();
};
for(const id of ['tiltCenter','tiltCenterMenu'])$(id).onclick=()=>tilt.calibrate();
const savedControls=qs.get('controls')??store.get('controls','auto');
const install=createInstallSupport({onChange:state=>{
  $('installApp').textContent=state.installed?'홈 화면 앱 사용 중':state.canPrompt?'홈 화면에 설치':'홈 화면에 추가 안내';
  $('installApp').disabled=state.installing||state.installed;
  $('installHint').textContent=state.instructions;$('orientationHint').textContent=[state.fullscreenHint,state.orientationHint].filter(Boolean).join(' ');
  const fullStatus=$('fullscreenStatus');if(fullStatus){fullStatus.textContent=state.fullscreenHint||'';fullStatus.hidden=!state.fullscreenHint;}
}});
const touch=createTouchControls({root:$('touchControls'),inputMode:['auto','touch','off'].includes(savedControls)?savedControls:'auto',
  onInput:value=>flight?.setTouchInput(value),onCamera:()=>flight?.cycleCamera(),
  onActionStart:(name,id)=>name==='use'&&beginExternalAction('touch:'+id),
  onActionEnd:(_name,id)=>releaseExternalAction('touch:'+id),
  onAction:name=>{if(name==='use')action();else if(name==='next')nextCall();},
  onChange:({visible,inputMode})=>{
    const mobile=mobileDevice()||inputMode==='touch',selected=inputMode==='touch'||inputMode==='auto'&&mobileDevice();
    document.body.classList.toggle('touch-controls',visible);document.body.classList.toggle('mobile-layout',mobile);
    $('mobileNotice').hidden=!mobile;$('touchModeBtn').textContent=selected?'터치 조작 끄기':'터치 조작 켜기';
  }});
const multiButtons=enableMultitouchButtons($('hud'),{enabled:()=>mode==='flight'});
const pauseButtons=enableMultitouchButtons($('overlay'),{enabled:()=>mode==='paused',includePrimaryTouch:true});
function syncTouch(){touch.setEnabled(mode==='flight');radio.pause(!['flight','loading'].includes(mode));
  if(mode!=='paused')pauseButtons.reset();
  if(mode!=='flight'){resetFlightPadHolds();cancelExternalAction();multiButtons.reset();tilt.setFlying(false);haptics.stop();}
}
window.addEventListener('blur',()=>{resetFlightPadHolds();cancelExternalAction();haptics.stop();});
window.addEventListener('orientationchange',()=>{resetFlightPadHolds();cancelExternalAction();});
window.addEventListener('gamepaddisconnected',()=>{resetFlightPadHolds();haptics.stop();});
function setPanels(collapsed){
  document.body.classList.toggle('touch-panels-collapsed',collapsed);
  const toggle=$('touchPanelToggle');
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.setAttribute('aria-label',collapsed?'임무·장비·계기 패널 열기':'임무·장비·계기 패널 닫기');
  toggle.textContent=collapsed?'패널':'닫기';
  if(!collapsed)$('flightDetails').scrollTop=0;
}
setPanels(true);
const pilot=createCareer();let lastLedger=-1,sessionId=null,saving=null,saveError='',retrySaveAt=0,activeLoadout=null,activeAircraft=null;
const shop=createHangarShop(pilot,async id=>{
  $('heliSelect').value=id;showPlane();
  if(mode==='hangar'&&activeAircraft!==id){
    swapJob=switchStoredAircraft(id);
    try{return await swapJob;}finally{swapJob=null;}
  }else if(mode==='menu')await validateSelection();
}, id=>id!==activeAircraft||!missions?.state.hook?.attached);
function updateCareer(){
  const p=pilot.snapshot();if(!p)return;
  currentProfile=p;
  if(pilot.status.code==='profile-replaced')saveError=pilot.status.message;
  $('cashBalance').textContent=money(p.cash);$('wallet').textContent=money(p.cash);$('cashReading').textContent=money(p.cash);
  $('rankLabel').hidden=!campaignCity;
  if(campaignCity){
    const score=p.cityScores?.[campaignCity]??0,goal=districtRoute(campaignCity).goal;
    $('rankMeter').max=goal;$('rankMeter').value=score;$('rankPoints').textContent=score+'/'+goal;
  }
  $('career').textContent='누적 '+p.completed+'건 · '+p.score+'점';
  $('ownedKit').textContent='보유 헬기 '+p.ownedAircraft.length+'대 · 보유 부품 '+p.ownedEquipment.length+'종';
  for(const option of $('heliSelect').options){const h=AIRCRAFT_CATALOG.find(h=>h.id===option.value);if(h)option.textContent=h.name+(p.ownedAircraft.includes(h.id)?' · 보유':' · '+money(h.price));}
  const loadout=pilot.loadout($('heliSelect').value);
  if(activeLoadout && (mode==='hangar'||mode==='loading')){
    Object.assign(activeLoadout,pilot.loadout(activeAircraft));
    flight?.refreshFit();
  }
  const availableTools=activeLoadout??loadout;
  for(const option of $('fieldTool').options){const equipment=requiredEquipment(option.value);option.disabled=!!equipment&&!availableTools[equipment];}
  if($('fieldTool').selectedOptions[0]?.disabled)$('fieldTool').value='context';
  if(menuReady&&mode==='menu')validateSelection().catch(failure);
}
pilot.subscribe(updateCareer);
function flightTotals(){
  const totals=Object.fromEntries(['ledger','cash','score','completed','failed','partial'].map(k=>[k,missions.state[k]]));
  totals.adjustments=missions.getAdjustments(lastLedger);
  return totals;
}
async function saveFlight(close=false){
  const id=sessionId,dispatch=missions;
  if(!id||!dispatch)return true;
  if(saving)await saving;
  if(sessionId!==id)return true;
  if(close&&flight&&activeAircraft){
    const condition=await pilot.maintainAircraft(sessionId,activeAircraft,aircraftCondition());
    if(!condition.ok&&condition.code!=='aircraft-busy'){saveError=condition.message;return false;}
  }
  if(!close&&missions.state.ledger===lastLedger)return true;
  const totals=flightTotals();
  const pending=close?pilot.closeSession(id,totals):pilot.settleSession(id,totals);saving=pending;
  try{
    const result=await pending;
    if(sessionId!==id)return result.ok;
    if(result.ok){lastLedger=totals.ledger;dispatch.ackAdjustments(lastLedger);saveError='';if(close)sessionId=null;}
    else{saveError=result.message;retrySaveAt=performance.now()+3000;}
    return result.ok;
  }
  finally{if(saving===pending)saving=null;}
}
function selectedWorld(profile=pilot.snapshot()){
  const size=$('citySelect').value;
  const fixture=diag&&qs.get('worldSeed');
  const seed=fixture&&/^\d{1,10}$/.test(fixture)?(Number(fixture)+(profile.cityLayouts?.[size]??0))>>>0:citySeed(profile,size);
  return {size,seed,id:generatedCityId(size,seed),district:campaignDistrict(size,profile.campaignLevel??1)};
}
function getDepartureCity(id){
  if(plannedCityId!==id){
    plannedCityId=id;
    plannedCity=import('./city.js').then(async ({fetchCityData,createCitySampler,makeMinimap})=>{
      const departure=createCitySampler(await fetchCityData(id));
      departure.minimap=makeMinimap(departure);
      return departure;
    });
  }
  return plannedCity;
}
function departureWeather(cityId){
  const mode=$('weatherSelect').value;
  return createWeather({cityId,mode,seed:mode==='auto'?shiftSeed:1});
}
async function validateSelection(){
  const ticket=++validationTicket, plan=splitMission($('missionSelect').value);let warning='';
  const p=pilot.snapshot();
  if(mode==='menu'&&pilot.status.code==='profile-replaced'){
    const reopen=document.createElement('a');reopen.href=location.pathname;reopen.textContent='새 경력 열기';
    $('menuInfo').replaceChildren(pilot.status.message+' ',reopen);
    $('start').disabled=true;$('resetCareer').disabled=true;
    return;
  }
  if(!p?.ownedAircraft.includes($('heliSelect').value))warning='아직 보유하지 않은 기체입니다. 헬기 · 장비 상점에서 구입하세요.';
  if(plan&&['rescue','medevac','transport'].includes(plan.type)&&!cabinCapacity($('heliSelect').value))
    warning='이 출동에는 승객 좌석이 필요합니다. 민간 헬기를 선택하세요.';
  if(!warning&&plan?.type==='rescue'&&!pilot.loadout($('heliSelect').value).harness)warning='이 구조 임무에는 구조 밧줄이 필요합니다. 선택한 기체에 장착하세요.';
  const needsHook=plan?.type==='cargo'&&!pilot.loadout($('heliSelect').value).hook;
  $('fitMissionGear').hidden=!needsHook||!p?.ownedAircraft.includes($('heliSelect').value);
  if(!warning&&needsHook)warning='화물 수송에는 화물 고리가 필요합니다. 격납고에서 외부 장비를 교체하세요.';
  const {id,district}=selectedWorld(p);
  $('start').disabled=true;
  if(plannedCityId!==id)updateWeatherForecast(null);
  let departure;
  try{departure=await getDepartureCity(id);}
  catch{
    if(ticket!==validationTicket||mode!=='menu')return;
    plannedCityId=null;
    updateWeatherForecast(null);
    $('menuInfo').textContent='도시를 생성하지 못했습니다. 다른 배치로 다시 시도하세요.';
    return;
  }
  if(ticket!==validationTicket||mode!=='menu')return;
  updateWeatherForecast(departureWeather(id).sample(departure.spawn,0));
  if(!warning&&plan?.variant==='train'&&!hasTrainRoute(departure))warning='이 배치에는 운행하는 열차가 없습니다. 다른 배치를 선택하세요.';
  const span=departure.bounds.maxX-departure.bounds.minX,cv=$('districtMap'),ctx2=cv.getContext('2d');
  const scale=departure.minimap.width/2048;
  ctx2.drawImage(departure.minimap,(departure.bounds.minX+1024)*scale,(departure.bounds.minZ+1024)*scale,span*scale,span*scale,0,0,cv.width,cv.height);
  $('districtName').textContent=departure.name;
  $('districtSpan').textContent=(span/1000).toFixed(2)+' × '+(span/1000).toFixed(2)+' km';
  $('start').disabled=!!warning||!menuReady;
  const route=$('careerMode').value==='career'?districtRoute(district):null;
  $('menuInfo').textContent=warning||(plan?'선택한 현장으로 출동합니다.':route?
    '경력 '+route.level+'단계 · 지역 점수 '+(p.cityScores?.[district]??0)+' / '+route.goal+'점':'도시 무전을 받으며 순찰합니다.');
}
function showPlane(){const i=HELICOPTERS.findIndex(h=>h.id===$('heliSelect').value),h=HELICOPTERS[i];if(!h)return;$('airTitle').textContent=h.name;$('airCode').textContent=h.designation;$('airIndex').textContent=String(i+1).padStart(2,'0')+' / '+HELICOPTERS.length;$('airPhoto').src='art/'+h.id+'.webp';$('airPhoto').alt=h.name+' 기체 렌더';}
async function menu(){
  const [account]=await Promise.all([pilot.ready,soundLibrary.ready]);if(!account.ok)throw Error(account.message);
  $('citySelect').replaceChildren(...Object.entries(citySizes).map(([id,label])=>new Option(label,id)));
  for(const h of HELICOPTERS)$('heliSelect').add(new Option(h.name,h.id));
  $('heliSelect').remove(0);
  for(const [type,info] of Object.entries(MISSIONS)){
    const group=document.createElement('optgroup');group.label=info.name;
    for(const [variant,label] of Object.entries(info.variants))group.append(new Option(info.name+' · '+label,type+'/'+variant));
    $('missionSelect').append(group);
  }
  for(const [id,label] of Object.entries(TOOLS))$('fieldTool').add(new Option(label,id));
  const choose=(id,v,def)=>{const e=$(id);e.value=v;if(e.selectedIndex<0)e.value=def;if(e.selectedIndex<0)e.selectedIndex=0;e.disabled=false;};
  choose('citySelect',qs.get('city')??store.get('city','small'),'small');choose('heliSelect',qs.get('heli')??pilot.snapshot().selectedAircraft,'SCWZR300');choose('quality',qs.get('quality')??store.get('quality',mobileDevice()?'mobile':'balanced'),mobileDevice()?'mobile':'balanced');
  choose('careerMode',qs.get('career')??(qs.has('city')||qs.has('mission')?'free':store.get('careerMode','career')),'career');
  $('regenerateCity').disabled=false;
  choose('controlsSelect',touch.inputMode,'auto');choose('scheme',qs.get('scheme')??store.get('scheme','classic'),'classic');choose('shift',qs.get('shift')??store.get('shift','city'),'city');
  choose('missionSelect',qs.get('mission')??store.get('mission','auto'),'auto');
  choose('weatherSelect',qs.get('weather')??store.get('weather','auto'),'auto');
  showPlane();menuReady=true;$('openShop').disabled=false;$('resetCareer').disabled=false;updateCareer();await validateSelection();
}
$('careerMode').onchange=()=>{store.set('careerMode',$('careerMode').value);validateSelection().catch(failure);};
$('regenerateCity').onclick=async()=>{
  if(mode!=='menu'||!menuReady||$('regenerateCity').disabled)return;
  $('regenerateCity').disabled=true;$('start').disabled=true;
  try{
    const res=await pilot.regenerateCity($('citySelect').value);
    if(!res.ok){$('menuInfo').textContent=res.message;return;}
    await validateSelection();
  }finally{$('regenerateCity').disabled=false;}
};
function overlay(title,body,loading=false,pause=false){$('overlay').hidden=false;$('dialogTitle').textContent=title;$('dialogBody').textContent=body;$('loadline').hidden=!loading;$('pauseContents').hidden=!pause;$('homeBtn').hidden=loading;}
function failure(e){console.error(e);mode='error';syncTouch();sound.setActive(false);overlay('출동을 시작할 수 없습니다',e?.message||String(e));}
function resize(){
  if(!ctx)return;
  const {width,height}=$('viewport').getBoundingClientRect();
  if(width<=0||height<=0)return;
  const dpr=devicePixelRatio||1;
  const quality=$('quality').value,mobile=document.body.classList.contains('mobile-layout');
  let density=quality==='mobile'?
    Math.min(dpr,1.5,1280/width,Math.sqrt(921600/(width*height))):
    Math.min(dpr,1920/width,1080/height);
  // Leave headroom for dense geometry and downwash at the large-city start.
  // The HUD remains at CSS resolution; smaller displays already fit the budget.
  if(!mobile&&quality==='balanced'&&$('citySelect').value==='large')
    density=Math.min(density,1296/width,972/height);
  if(mobile){
    ctx.renderer.setDrawingBufferSize(Math.max(1,Math.floor(width*density*scale)),Math.max(1,Math.floor(height*density*scale)),1);
  }else{
    const blocks=Math.max(1,Math.round(Math.min(width/4,height/3)*density*scale));
    ctx.renderer.setDrawingBufferSize(blocks*4,blocks*3,1);
  }
  ctx.camera.aspect=mobile?width/height:4/3;
  // Keep the complete reference 4:3 composition centered. Landscape shows
  // additional scenery to either side; portrait extends the view vertically.
  ctx.camera.zoom=Math.min(1,ctx.camera.aspect/(4/3));
  ctx.camera.updateProjectionMatrix();
}
function stage(s){$('dialogBody').textContent=s;}
function prepareFlight(world,aircraftId){
  return createFlight(world,city,aircraftId,{controlScheme:$('scheme').value,getFit:id=>pilot.fit(id),
    padAllowed:flightPadAllowed,getLookXSign:()=>invertCameraX?-1:1,weather:departureWeather(city.cityId)});
}
function prepareMissions(world,craft,loadout,onRadio){
  return createMissions(world,city,craft,{selection:$('missionSelect').value,loadout,firstCallDelay:8,onRadio,
    onImpact:(message,event)=>{
      say(message);if(mode==='flight'&&!document.hidden&&document.hasFocus())haptics.impact(event);
    }});
}
async function start(){
  if(mode!=='menu'||$('start').disabled||$('resetDialog').open)return;mode='loading';$('start').disabled=true;
  const {id,size,seed,district}=selectedWorld(), heli=$('heliSelect').value,quality=$('quality').value;
  store.set('quality',quality);store.set('scheme',$('scheme').value);
  sound.init();radio.init();radio.pause(false);document.activeElement?.blur();
  syncTouch();if(mobileDevice()||touch.inputMode==='touch')void install.enterPlay();
  overlay('출동 준비',$('districtName').textContent+' · 비행 장비 준비 중',true);
  try{
    const selected=await pilot.selectAircraft(heli);if(!selected.ok)throw Error(selected.message);
    campaignCity=$('careerMode').value==='career'&&$('missionSelect').value==='auto'?district:null;
    const receipt=await pilot.beginSession(undefined,heli,campaignCity);if(!receipt.ok)throw Error(receipt.message);sessionId=receipt.sessionId;
    store.set('city',size);store.set('heli',heli);store.set('mission',$('missionSelect').value);store.set('shift',$('shift').value);
    store.set('weather',$('weatherSelect').value);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    scale=1;slow=fast=0;clockSamples.length=0;nextScale=elapsed+3;
    ctx=createWorld(quality==='native',{night:$('shift').value==='city'?((seed>>>8)%4===0):$('shift').value==='night',mobile:quality==='mobile'});ctx.sound=sound;$('viewport').append(ctx.renderer.domElement);resize();
    departureLens={near:ctx.camera.near,fov:ctx.camera.fov};
    ctx.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();failure(new Error('그래픽 장치 연결이 끊겼습니다. 격납고로 돌아가 다시 출동하세요.'));});
    stage('생성된 도시의 도로와 건물을 배치하고 있습니다.');const {loadCity}=await import('./city.js');city=await loadCity(ctx,id,getDepartureCity(id));addHorizon(ctx.THREE,ctx.scene,city);
    stage('기체와 로터를 점검하고 있습니다.');homeBase=await createHomeBase(ctx,city);
    flight=await prepareFlight(ctx,heli);flight.restoreCondition(pilot.snapshot().airframes?.[heli]);
    stage('관제 무전과 출동 현장을 연결하고 있습니다.');[transit,civic]=await Promise.all([createTransit(ctx,city),createCivic(ctx,city)]);
    addGroundDetail(ctx.THREE,ctx.scene,city,ctx.night);
    activeAircraft=heli;activeLoadout=pilot.loadout(heli);
    ctx.transit=transit;missions=await prepareMissions(ctx,flight,activeLoadout,event=>radio.notify(event));
    const stock=pilot.snapshot().airframes[heli]?.gas;if(Number.isInteger(stock))missions.state.supplies.gas=stock;
    stage('도시의 조명과 기체 재질을 준비하고 있습니다.');await missions.ready;await city.ready;
    ctx.prepareLighting(city,flight);
    if(ctx.renderer.compileAsync)await Promise.race([ctx.renderer.compileAsync(ctx.scene,ctx.camera),new Promise(r=>setTimeout(r,12000))]);
    ctx.frame(city,flight);$('hangar').hidden=true;$('hud').hidden=false;$('overlay').hidden=true;document.body.classList.add('flying');
    mode='flight';setPanels(true);syncTouch();last=performance.now();lastLedger=-1;
    $('location').textContent=city.name+'   /   '+flight.state.name;sound.setActive(true);drawHUD();sound.cue(false);
    if(diag)window.__sim={get ctx(){return ctx;},city,get flight(){return flight;},get missions(){return missions;},
      get transit(){return transit;},civic,touch,homeBase,radio,get mode(){return mode;},snapshot,frames:diagFrames};
    if(document.hidden)setPause(true);
  }catch(e){failure(e);}
}
function setPause(p){
  if(p&&mode==='flight'){mode='paused';syncTouch();flight.setPaused?.(true);sound.setActive(false);overlay('비행 일시 정지',city.name+' · '+flight.state.name,false,true);$('soundBtn').textContent='게임 소리 '+(soundOn?'켜짐':'꺼짐');$('resume').focus();}
  else if(!p&&mode==='paused'){sound.init();mode='flight';$('overlay').hidden=true;document.activeElement?.blur();flight.setPaused?.(false);syncTouch();sound.setActive(true);last=performance.now();}
}

const resetDialog=$('resetDialog');
const resetLabels=['resetTitle','resetDescription','resetResult','resetConfirm'];
const careerResetCopy=resetLabels.map(id=>$(id).textContent);
const flightRestartCopy=['현재 비행을 다시 시작할까요?',
  '이번 비행의 미정산 보상과 벌금을 반영하고 기지로 돌아갑니다. 같은 도시·기체·근무 시간·임무로 다시 출발합니다.',
  '연료·피해·최루탄 수량은 현재 상태로 이어집니다. 수리와 보급에는 기존 정비 요금이 적용됩니다.','비행 재시작'];
let resetRequest=null,resetBusy=false;
function openResetDialog(kind){
  const restarting=kind==='flight';
  if(resetDialog.open||resetBusy||(restarting?mode!=='paused'||!sessionId:mode!=='menu'||!menuReady))return;
  const opener=$(restarting?'restartFlight':'resetCareer'),profileId=pilot.snapshot()?.profileId;
  if(opener.disabled||!profileId)return;
  resetRequest={kind,opener,profileId,sessionId};
  const copy=restarting?flightRestartCopy:careerResetCopy;
  resetLabels.forEach((id,i)=>{$(id).textContent=copy[i];});
  $('resetNotice').textContent='';
  resetDialog.showModal();$('resetCancel').focus();
}
function closeResetDialog(){
  const opener=resetRequest?.opener;
  resetRequest=null;resetDialog.close();
  if(opener?.offsetWidth)opener.focus();
}
$('resetCareer').onclick=()=>openResetDialog('career');
$('restartFlight').onclick=()=>openResetDialog('flight');
$('resetCancel').onclick=()=>{if(!resetBusy)closeResetDialog();};
resetDialog.oncancel=e=>{e.preventDefault();if(!resetBusy)closeResetDialog();};
resetDialog.addEventListener('keydown',e=>e.stopPropagation());

function resetDispatchSelections(){
  const defaults={careerMode:'career',city:'small',heli:'SCWZR300',mission:'auto',shift:'city',weather:'auto'};
  const url=new URL(location.href);
  for(const [key,value] of Object.entries(defaults)){
    store.set(key,value);url.searchParams.delete(key==='careerMode'?'career':key);
  }
  history.replaceState(history.state,'',url);
  $('careerMode').value=defaults.careerMode;$('citySelect').value=defaults.city;
  $('heliSelect').value=defaults.heli;$('missionSelect').value=defaults.mission;$('shift').value=defaults.shift;
  $('weatherSelect').value=defaults.weather;
  showPlane();updateCareer();
  $('menuInfo').textContent='새 경력을 시작했습니다. 도시 규모를 선택하세요.';
}

async function restartFlight(oldSessionId){
  if(!oldSessionId||sessionId!==oldSessionId||mode!=='paused')throw Error('다시 시작할 비행을 확인하세요.');
  const condition=aircraftCondition(),loadout=pilot.loadout(activeAircraft);
  // Keep the paused flight and its input handlers until every replacement is ready.
  // The city and renderer are shared, but the mission hooks and traffic colliders are per flight.
  const nextWorld={...ctx,transit:null,onFlightImpact:null,walkingActorAt:null};
  const previousCamera=ctx.camera.clone();
  let nextFlight,nextMissions,pendingRadio=[];
  try{
    Object.assign(ctx.camera,departureLens);ctx.camera.updateProjectionMatrix();
    nextFlight=await prepareFlight(nextWorld,activeAircraft);
    nextFlight.setPaused(true);nextFlight.restoreCondition(condition);
    nextWorld.transit=await createTransit(nextWorld,city);
    nextMissions=await prepareMissions(nextWorld,nextFlight,loadout,event=>{
      if(pendingRadio)pendingRadio.push(event);else radio.notify(event);
    });
    nextMissions.state.supplies.gas=missions.state.supplies.gasStock;
    await nextMissions.ready;
    if(saving)await saving;
    if(mode!=='paused'||sessionId!==oldSessionId||ctx.renderer.getContext().isContextLost())
      throw Error('비행 상태가 변경되어 재시작을 중단했습니다.');
    const receipt=await pilot.restartSession(oldSessionId,flightTotals(),activeAircraft,condition);
    if(!receipt.ok)throw Error(receipt.message);
    sessionId=receipt.sessionId;
  }catch(e){
    nextMissions?.dispose();nextFlight?.dispose();nextWorld.transit?.dispose();
    ctx.camera.copy(previousCamera);
    if(mode==='error')closeResetDialog();
    throw e;
  }
  missions.dispose();flight.dispose();transit.dispose();
  flight=nextFlight;missions=nextMissions;ctx=nextWorld;transit=nextWorld.transit;activeLoadout=loadout;
  updateCareer();
  sound.frame(0);touch.reset();cockpit.trackIncident(null);setPanels(true);
  enteredDoor=false;wasOnFoot=flight.state.onFoot;promotionCalled=false;
  lastLedger=-1;retrySaveAt=0;saveError='';lastConditionAt=elapsed;hudDue=civicDue=0;
  $('fieldTool').value='context';$('radioMessage').textContent='';$('dropSight').hidden=true;
  say('기지에서 새 비행을 시작했습니다.');
  closeResetDialog();
  if(mode==='error'||ctx.renderer.getContext().isContextLost())return;
  $('overlay').hidden=true;returnToFlight();
  for(const event of pendingRadio)radio.notify(event);
  pendingRadio=null;
  drawHUD();
}

$('resetConfirm').onclick=async()=>{
  if(resetBusy||!resetDialog.open||!resetRequest)return;
  resetBusy=true;$('resetCancel').disabled=$('resetConfirm').disabled=true;
  const request=resetRequest;
  try{
    if(request.kind==='flight'){
      // Unlock audio from the player's button press while playback is still paused.
      sound.init();radio.init();
      $('resetNotice').textContent='기지 출발을 준비하고 있습니다.';
      await restartFlight(request.sessionId);
    }else{
      const result=await pilot.resetCareer(request.profileId);
      if(!result.ok)throw Error(result.message);
      closeResetDialog();resetDispatchSelections();$('start').focus();
    }
  }catch(error){
    $('resetNotice').textContent=error.message;
  }finally{
    resetBusy=false;$('resetCancel').disabled=$('resetConfirm').disabled=false;
    if(resetDialog.open)$('resetCancel').focus();
  }
};
function action(tool=$('fieldTool').value){
  if(mode!=='flight')return;
  if(flight.state.onFoot){if(homeBase.nearDoor(flight.playerPosition))openHangar();else changeBoarding();return;}
  if(externalSelected(tool)){
    if(mountedExternalTool()==='hook'){missions.beginHook();missions.endHook();}
    else missions.act('bucket');
    drawHUD();return;
  }
  missions.act(tool);sound.cue(false);drawHUD();
}
function mountedExternalTool(){return activeLoadout?.hook?'hook':'bucket';}
function externalSelected(tool=$('fieldTool').value){
  const selected=tool==='context'?missions?.state.suggestedTool:tool;
  return selected==='bucket'||selected==='hook';
}
function mountedRig(){return missions.state[mountedExternalTool()];}
function beginExternalAction(source,direct=false){
  if(mode!=='flight'||flight.state.onFoot||(!direct&&!externalSelected()))return false;
  if(!externalHolds.size){
    heldTool=mountedExternalTool();
    if(heldTool==='hook')missions.beginHook();
    else missions.beginBucket(performance.now());
  }
  externalHolds.add(source);
  return true;
}
function releaseExternalAction(source){
  if(externalHolds.delete(source)&&!externalHolds.size)finishExternalAction();
}
function cancelExternalAction(){
  if(externalHolds.size){externalHolds.clear();finishExternalAction();}
}
function finishExternalAction(){
  if(heldTool==='hook')missions?.endHook();
  else if(heldTool==='bucket')missions?.endBucket(performance.now());
  heldTool=null;
}
function changeCable(lower){
  if(mode!=='flight'||flight.state.onFoot)return;
  if(lower===undefined||lower!==mountedRig().deployed){
    if(mountedExternalTool()==='hook')missions.toggleHookCable();
    else missions.toggleBucketCable();
  }
  drawHUD();
}
function toggleDropView(){
  if(mode!=='flight'||flight.state.onFoot)return;
  flight.toggleDropView();drawHUD();
}
function nextCall(){if(mode==='flight'){cockpit.changeTarget(1,missions);drawHUD();}}
function nextTool(){cancelExternalAction();const e=$('fieldTool');for(let i=0;i<e.length;i++){e.selectedIndex=(e.selectedIndex+1)%e.length;if(!e.selectedOptions[0].disabled)break;}drawHUD();}
function aircraftCondition(){
  const stock=missions?.state.supplies.gasStock;
  return {...flight.condition(),...(Number.isInteger(stock)&&(activeLoadout?.gas||stock<10)?{gas:stock}:{})};
}
async function saveCondition(){
  if(!flight||!activeAircraft||!sessionId)return;
  const result=await pilot.maintainAircraft(sessionId,activeAircraft,aircraftCondition());
  if(!result.ok&&result.code!=='aircraft-busy')saveError=result.message;
  return result;
}
async function switchStoredAircraft(id){
  async function keepCurrent(message){
    const restored=await pilot.selectAircraft(activeAircraft);
    $('heliSelect').value=activeAircraft;showPlane();
    return {ok:false,message:restored.ok?message:restored.message};
  }
  if(missions.state.hook?.attached)return keepCurrent('컨테이너를 내려놓고 고리를 해제한 뒤 기체를 교체하세요.');
  if(missions.state.cabinUsed)return keepCurrent('승객 인계 후에 기체를 교체하세요.');
  const saved=await saveCondition();
  if(saved&&!saved.ok&&saved.code!=='aircraft-busy')return keepCurrent(saved.message);
  const changed=await pilot.assignAircraft(sessionId,id);
  if(!changed.ok)return keepCurrent(changed.message);
  try{
    await flight.switchHelicopter(id,{parkAtBase:true});activeAircraft=id;flight.restoreCondition(pilot.snapshot().airframes[id]);
    Object.assign(activeLoadout,pilot.loadout(id));missions.state.supplies.gas=pilot.snapshot().airframes[id]?.gas??10;
    $('location').textContent=city.name+' / '+flight.state.name;updateCareer();
  }catch(error){
    await pilot.assignAircraft(sessionId,activeAircraft);return keepCurrent(error.message);
  }
}
function stopForPanel(next){
  mode=next;syncTouch();flight.setPaused(true);sound.setActive(false);
}
function returnToFlight(){
  mode='flight';flight.setPaused(false);syncTouch();sound.setActive(true);last=performance.now();
  document.activeElement?.blur();if(document.hidden)setPause(true);
}
function canPadCommand(command){
  const s=flight?.state;
  if(!s)return false;
  if(command==='hangar')return s.onFoot&&homeBase.nearDoor(flight.playerPosition);
  if(command==='service')return s.onFoot&&s.grounded;
  if(command==='board')return s.onFoot||(s.grounded&&!missions.state.hook?.attached);
  if(command==='cable')return !s.onFoot&&(activeLoadout?.hook||activeLoadout?.bucket&&missions.state.bucket.kind!=='tank');
  if(command.startsWith('use-')){
    const tool=command.slice(4),choice=Array.from($('fieldTool').options).find(o=>o.value===tool);
    return !s.onFoot&&!!choice&&!choice.disabled;
  }
  if(command.startsWith('tilt-'))return !s.onFoot&&['chase','cockpit'].includes(s.cameraId);
  if(['camera-near','camera-far','camera-up','camera-down'].includes(command))return !s.onFoot&&['chase','overhead'].includes(s.cameraId);
  if(command==='cockpit'||/^(camera-|aim-|recall-)/.test(command))return !s.onFoot;
  return true;
}
const cameraSteps={'camera-near':{distance:-4},'camera-far':{distance:4},'camera-up':{elevation:2},'camera-down':{elevation:-2},
  'tilt-up':{tilt:2},'tilt-down':{tilt:-2}};
const beamSteps={'aim-left':[-12,0],'aim-right':[12,0],'aim-up':[0,10],'aim-down':[0,-10]};
function runPadCommand(command){
  if(command==='help'){$('padHelp').showModal();return;}
  if(mode!=='flight'||!canPadCommand(command))return;
  if(command.startsWith('use-')){
    const tool=command.slice(4);
    if(tool==='bucket'||tool==='hook'){
      $('fieldTool').value=tool;$('fieldTool').dispatchEvent(new Event('change'));
      say(tool==='hook'?'화물 고리 선택 · A로 컨테이너를 연결하거나 해제합니다.':'물 투하 준비 · A를 누르는 동안 방수합니다.');
    }else action(tool);
    return;
  }
  if(command.startsWith('recall-')){missions.recall(command.slice(7));drawHUD();return;}
  if(cameraSteps[command]){flight.adjustCamera(cameraSteps[command]);return;}
  if(beamSteps[command]){missions.aim(...beamSteps[command]);return;}
  switch(command){
    case 'board':changeBoarding();break;
    case 'hangar':openHangar();break;
    case 'service':openService();break;
    case 'map':openMap();break;
    case 'pause':setPause(true);break;
    case 'cable':changeCable();break;
    case 'next-call':nextCall();break;
    case 'radar-in':cockpit.zoom(-1);break;
    case 'radar-out':cockpit.zoom(1);break;
    case 'radar-prev':cockpit.changeTarget(-1,missions);break;
    case 'radar-next':cockpit.changeTarget(1,missions);break;
    case 'camera-center':flight.recenterCamera();break;
    case 'camera-drop':toggleDropView();break;
    case 'cockpit':flight.setCameraMode('cockpit');break;
    case 'camera-overhead':flight.setCameraMode('overhead');break;
    case 'camera-chase':flight.setCameraMode('chase');break;
  }
}
const padActions=createPadActions({available:canPadCommand,run:runPadCommand,
  onClose:()=>{if(mode==='actions')returnToFlight();}});
function openPadActions(){
  if(mode!=='flight'||document.hidden)return;
  cancelExternalAction();stopForPanel('actions');padActions.open();
}
$('openPadActions').onclick=openPadActions;
$('padHelpMenu').onclick=$('padHelpPause').onclick=()=>{if(!$('padHelp').open)$('padHelp').showModal();};
$('closePadHelp').onclick=()=>$('padHelp').close();
function changeBoarding(){
  if(mode!=='flight')return;
  if(!flight.state.onFoot&&missions.state.hook?.attached){
    say('하차하려면 컨테이너를 지면에 내려놓고 고리를 먼저 해제하세요.');return;
  }
  const result=flight.boardOrExit();say(result.message);
  if(result.ok)cancelExternalAction();
  if(result.ok)sound.sceneCue(result.onFoot?'doorOpen':'doorClose',0);
  if(result.ok&&result.onFoot&&flight.state.atBase&&flight.serviceQuote({refuel:true,repair:true}).cost>0)openService();
}
function openHangar(){
  if(mode!=='flight'||!flight.state.onFoot||!homeBase.nearDoor(flight.playerPosition))return;
  stopForPanel('hangar');enteredDoor=true;updateCareer();
  $('panoImage').src='./art/hangar-'+(ctx.night?'night':'day')+'.webp';$('deskLogbook').hidden=true;$('hangarPano').hidden=false;
  $('hangarDesk').showModal();void reviewPromotion();
}
$('hangarDesk').onclose=async()=>{if(swapJob)await swapJob;if(mode==='hangar')returnToFlight();};
async function reviewPromotion(){
  $('nextCity').hidden=true;if(!campaignCity)return;
  await saveFlight();const profile=pilot.snapshot(),route=districtRoute(campaignCity);
  if((profile.cityScores?.[campaignCity]??0)<route.goal)return;
  const result=await pilot.finishCity(campaignCity);$('nextCity').hidden=!result.ok;
  if(result.code==='promoted')say(result.message);
}
$('nextCity').onclick=async()=>{if(await saveFlight(true)){install.leavePlay();location.href=location.pathname;}};
$('deskExit').onclick=()=>$('hangarDesk').close();
$('hangarDesk').addEventListener('padview',event=>{
  const {x,y,dt}=event.detail,book=$('deskLogbook'),pano=$('hangarPano');
  if(!pano.hidden&&x)pano.scrollLeft+=x*dt*500;
  if(!book.hidden&&y)book.scrollTop+=y*dt*350;
});
$('deskCatalog').onclick=()=>shop.open('aircraft');
$('deskRig').onclick=()=>shop.open('equipment',activeAircraft);
$('deskInventory').onclick=()=>shop.open('inventory');
$('deskLog').onclick=()=>{
  const book=$('deskLogbook');book.hidden=!book.hidden;$('hangarPano').hidden=!book.hidden;
  const p=pilot.snapshot();
  book.replaceChildren(...['비행 일지',city.name+' · 누적 '+p.score+'점 · '+money(p.cash),
    ...(campaignCity?['지역 점수 '+(p.cityScores?.[campaignCity]||0)+' / '+districtRoute(campaignCity).goal]:[]),
    ...(missions.state.journal??[]).slice(-20).reverse().map(entry=>{
      const change=(n,unit)=>(n>0?'+':'')+n+unit;
      const amounts=[entry.cash&&change(entry.cash,'달러'),entry.points&&change(entry.points,'점')].filter(Boolean);
      return entry.subject+(amounts.length?' · '+amounts.join(' · '):'');
    })].map(line=>{
      const row=document.createElement('p');row.textContent=line;return row;
    }));
};
$('boardBtn').onclick=changeBoarding;$('hangarBtn').onclick=openHangar;
let paying=false;
// SIMCOPT.EXE 0x4911B0 bills 50 per canister, with ten rounds in the launcher.
const CANISTER_PRICE=50;
function serviceEstimate(){
  const repair=$('repairChoice').checked,refuel=$('fuelChoice').checked;
  const gas=$('gasChoice').checked?Math.max(0,10-missions.state.supplies.gas):0;
  let quote=flight.serviceQuote({repair,refuel});
  if(!repair&&!refuel&&gas){
    const check=flight.serviceQuote({refuel:true});
    if(check.ok)quote={ok:true,cost:0,repairCost:0,fuelCost:0,deliveryCost:0,after:flight.condition()};
  }
  return {...quote,gas,cost:quote.cost+gas*CANISTER_PRICE};
}
function drawService(){
  const q=serviceEstimate(),p=pilot.snapshot();
  $('serviceBalance').textContent=money(p.cash);
  $('repairPrice').textContent=money(q.repairCost||0);$('fuelPrice').textContent=money((q.fuelCost||0)+(q.deliveryCost||0));
  $('gasPrice').textContent=money(q.gas*CANISTER_PRICE);
  $('serviceNote').textContent=!q.ok?q.message:'전체 비용 '+money(q.cost)+(!flight.state.atBase?' · 현장 수리·급유 3배':'')+(q.cost>p.cash?' · 자금 부족':'');
  $('payService').disabled=paying||!q.ok||q.cost<=0||q.cost>p.cash;
}
function openService(){
  if(mode!=='flight'||!flight.state.onFoot)return;
  const check=flight.serviceQuote({repair:true,refuel:true});
  if(!check.ok){say(check.message);return;}
  if(!flight.state.atBase&&!check.cost){say('현장 정비는 수리 또는 급유가 필요할 때 호출할 수 있습니다.');return;}
  stopForPanel('service');$('repairChoice').checked=true;$('repairChoice').disabled=false;
  $('fuelChoice').checked=true;$('gasChoice').checked=!!activeLoadout.gas&&missions.state.supplies.gas<10;
  $('gasChoice').disabled=!activeLoadout.gas;
  drawService();$('serviceDialog').showModal();
}
for(const id of ['repairChoice','fuelChoice','gasChoice'])$(id).onchange=drawService;
$('serviceBtn').onclick=openService;
$('cancelService').onclick=()=>{if(!paying)$('serviceDialog').close();};
$('serviceDialog').oncancel=e=>{if(paying)e.preventDefault();};
$('serviceDialog').onclose=()=>{if(mode==='service')returnToFlight();};
$('payService').onclick=async()=>{
  const q=serviceEstimate();if(paying||!q.ok||q.cost<=0)return;
  paying=true;drawService();$('cancelService').disabled=true;
  try{
    const after={...q.after,...(activeLoadout.gas?{gas:missions.state.supplies.gas+q.gas}:{})};
    const result=await pilot.maintainAircraft(sessionId,activeAircraft,after,{id:crypto.randomUUID(),cost:q.cost});
    if(!result.ok){$('serviceNote').textContent=result.message;return;}
    flight.restoreCondition(q.after);if(q.gas)missions.state.supplies.gas+=q.gas;
    say('검사 완료 · '+money(q.cost)+' 지급');$('serviceDialog').close();
  }finally{paying=false;$('cancelService').disabled=false;if($('serviceDialog').open)$('payService').disabled=false;}
};
$('radarIn').onclick=()=>cockpit.zoom(-1);$('radarOut').onclick=()=>cockpit.zoom(1);
$('radarPrev').onclick=()=>cockpit.changeTarget(-1,missions);$('radarNext').onclick=()=>cockpit.changeTarget(1,missions);
$('radioToggle').onclick=()=>{const panel=$('radioTuner');panel.hidden=!panel.hidden;$('radioToggle').setAttribute('aria-expanded',String(!panel.hidden));};
$('station').onchange=()=>{store.set('station',$('station').value);radio.setStation($('station').value);};
function missionKey(e){
  if(mode!=='flight'||e.defaultPrevented||e.repeat||e.altKey||e.ctrlKey||e.metaKey||e.target?.closest?.('input,select,textarea,[contenteditable=true]'))return;
  if(!flight.state.onFoot){
    if(e.code==='KeyB'){e.preventDefault();beginExternalAction('key:B',true);return;}
    if(e.code==='KeyX'){e.preventDefault();toggleDropView();return;}
    if(e.code==='KeyZ'||e.code==='KeyV'||e.code==='KeyC'&&flight.state.controlScheme==='classic'){
      e.preventDefault();changeCable(e.code==='KeyZ'?undefined:e.code==='KeyV');return;
    }
  }
  if(e.code==='Tab'){e.preventDefault();nextCall();return;}
  if(e.code==='KeyG'){e.preventDefault();nextTool();return;}
  if(SHORTCUTS[e.code]){e.preventDefault();if(e.shiftKey&&['F2','F3','F4','F5'].includes(e.code))missions.recall(SHORTCUTS[e.code]);
    else action(SHORTCUTS[e.code]);return;}
  const aimKeys=flight.state.controlScheme==='classic'?
    {Numpad4:[-12,0],Numpad6:[12,0],Numpad8:[0,10],Numpad2:[0,-10]}:
    {KeyJ:[-12,0],KeyL:[12,0],KeyI:[0,10],KeyK:[0,-10]};
  const offset=aimKeys[e.code];
  if(offset){e.preventDefault();missions.aim(...offset);}
}
window.addEventListener('keydown',missionKey);
window.addEventListener('keyup',e=>{releaseExternalAction(e.code==='KeyB'?'key:B':'key:'+e.code);});
function openMap(){if(mode!=='flight')return;mode='map';syncTouch();flight.setPaused(true);sound.setActive(false);showMap(city,flight,missions,routeId=>{if(routeId)cockpit.trackIncident(routeId);sound.init();mode='flight';flight.setPaused(false);syncTouch();sound.setActive(true);document.activeElement?.blur();last=performance.now();if(document.hidden)setPause(true);}).catch(failure);}
function fullscreen(){if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});else void install.enterPlay({fullscreen:true});}
$('dispatch').addEventListener('submit',e=>{e.preventDefault();start();});$('heliSelect').onchange=showPlane;
for(const el of fields)el.addEventListener('change',()=>validateSelection().catch(failure));
$('controlsSelect').addEventListener('change',()=>{store.set('controls',$('controlsSelect').value);touch.setMode($('controlsSelect').value);syncTouch();});
$('touchModeBtn').onclick=()=>{const active=touch.inputMode==='touch'||touch.inputMode==='auto'&&mobileDevice();$('controlsSelect').value=active?'off':'touch';$('controlsSelect').dispatchEvent(new Event('change'));};
$('touchPanelToggle').onclick=()=>setPanels(!document.body.classList.contains('touch-panels-collapsed'));
for(const button of document.querySelectorAll('[data-aim]'))button.onclick=()=>{if(mode!=='flight')return;const offset={left:[-12,0],right:[12,0],up:[0,10],down:[0,-10]}[button.dataset.aim];missions.aim(...offset);};
$('recallUnit').onclick=()=>{if(mode==='flight'){missions.recall($('fieldTool').value);drawHUD();}};
$('installApp').onclick=async()=>{$('installHint').hidden=false;await install.requestInstall();$('installHint').textContent=install.state.instructions;};
$('nextCall').onclick=nextCall;
$('fieldTool').onchange=()=>{cancelExternalAction();if(document.activeElement===$('fieldTool'))$('fieldTool').blur();if(mode==='flight')drawHUD();};
$('bucketCable').onclick=()=>changeCable();
$('bucketView').onclick=toggleDropView;
function bindExternalButton(button,direct){
  const source=id=>button.id+':'+id;
  let consumed=false;
  button.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    consumed=beginExternalAction(source(e.pointerId),direct);
    if(!consumed)return;
    e.preventDefault();try{button.setPointerCapture(e.pointerId);}catch{}
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture']){
    button.addEventListener(type,e=>releaseExternalAction(source(e.pointerId)));
  }
  button.addEventListener('keydown',e=>{
    if(!['Space','Enter'].includes(e.code))return;
    if(!e.repeat)consumed=beginExternalAction('key:'+e.code,direct);
    if(consumed){e.preventDefault();e.stopPropagation();}
  });
  button.onclick=e=>{
    if(consumed){consumed=false;e.preventDefault();return;}
    action(direct?mountedExternalTool():$('fieldTool').value);
  };
}
bindExternalButton($('useTool'),false);bindExternalButton($('bucketValve'),true);
$('pauseBtn').onclick=()=>setPause(true);$('resume').onclick=()=>setPause(false);$('homeBtn').onclick=async()=>{const button=$('homeBtn');button.disabled=true;if(pilot.status.code==='profile-replaced'||await saveFlight(true)){install.leavePlay();location.href=location.pathname;}else{$('dialogBody').textContent=saveError+' 다시 눌러 정산을 재시도하세요.';button.disabled=false;}};
$('fitMissionGear').onclick=()=>shop.open('equipment',$('heliSelect').value);
$('openShop').onclick=()=>{if(mode==='menu')shop.open();};
$('mapBtn').onclick=openMap;
$('cockpitView').onclick=()=>{
  if(mode!=='flight'||flight.state.onFoot)return;
  flight.setCameraMode(flight.state.cameraId==='cockpit'?'chase':'cockpit');
  document.activeElement?.blur();
};
$('fullBtn').onclick=fullscreen;$('soundBtn').onclick=()=>{soundOn=!soundOn;if(soundOn)sound.init();store.set('sound',soundOn?'on':'off');sound.setEnabled(soundOn);radio.setEnabled(soundOn);$('soundBtn').textContent='게임 소리 '+(soundOn?'켜짐':'꺼짐');};
$('previewAircraft').onclick=()=>import('./inspect.js').then(m=>m.openInspection('',$('heliSelect').value)).catch(failure);
$('inspect').onclick=()=>import('./inspect.js').then(m=>m.openInspection()).catch(failure);
window.addEventListener('keydown',e=>{if(e.defaultPrevented||e.repeat||resetDialog.open||$('soundEditor').open||$('inspection').open||shop.openNow)return;if(mode==='menu'&&e.code==='KeyH'){e.preventDefault();shop.open();}else if(e.code==='Escape'){if(mode==='flight'||mode==='paused'){e.preventDefault();setPause(mode==='flight');}}else if(e.code==='KeyM'&&(mode==='flight'||mode==='map')){e.preventDefault();if(mode==='map')$('network').close();else openMap();}else if(mode==='flight'&&e.code==='KeyE'){e.preventDefault();if(flight.state.controlScheme==='classic')changeBoarding();else if(!beginExternalAction('key:KeyE'))action();}else if(mode==='flight'&&e.code==='Enter'){e.preventDefault();if(!beginExternalAction('key:Enter'))action();}else if((mode==='flight'||mode==='paused')&&e.code==='KeyF'){e.preventDefault();fullscreen();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='flight'){setPause(true);void saveCondition();void saveFlight();}});
window.addEventListener('pagehide',()=>{void saveCondition();touch.reset();if(mode==='flight')setPause(true);void saveFlight();});
window.addEventListener('resize',resize);
window.visualViewport?.addEventListener('resize',resize);
new ResizeObserver(resize).observe($('viewport'));
function resetFlightPadHolds(){
  flightPadGestures.reset();padDownControlsCable=false;releaseExternalAction('pad');
}
function flightPadButtons(b,edge){
  const now=performance.now();
  const read=(i,repeat=false)=>flightPadGestures.read(i,b[i],edge(i),now,repeat);
  if(edge(9)){resetFlightPadHolds();setPause(true);return;}
  const view=read(8);
  if(view){
    resetFlightPadHolds();
    if(view==='hold')openPadActions();else openMap();
    return;
  }
  const drop=flight.state.cameraId==='drop',onFoot=flight.state.onFoot;
  const rs=read(11),tool=read(2);
  if(rs==='tap'&&!onFoot)toggleDropView();
  if(rs==='hold'&&!onFoot)flight.recenterCamera();
  if(tool==='tap')nextTool();
  if(tool==='hold'&&!onFoot)action('harness');
  if(edge(0)&&!beginExternalAction('pad',drop))action();
  if(edge(1))changeBoarding();
  if(edge(10))nextCall();
  if(mode!=='flight'||onFoot)return;
  if(edge(13))padDownControlsCable=drop||externalSelected();
  const dpad=i=>{
    const event=read(i,true);
    if(i===13&&padDownControlsCable){
      if(event==='tap')changeCable();
      return event==='hold'||event==='repeat';
    }
    return edge(i)||event==='hold'||event==='repeat';
  };
  const yaw=12*(Number(dpad(15))-Number(dpad(14))),reach=10*(Number(dpad(12))-Number(dpad(13)));
  if(yaw||reach)missions.aim(yaw,reach);
}
const padUI=createPadNavigation();
let activePadKey=null;
const uiPadActions={
  menu:$('hangar'),paused:$('overlay'),start:()=>{if(menuReady)start();},back:()=>setPause(false),
  shop:()=>{if(menuReady){$('openShop').focus();$('openShop').click();}},
  reset:()=>{if(menuReady){$('resetCareer').focus();$('resetCareer').click();}}
};
function pad(){
  let p;
  try{p=Array.from(navigator.getGamepads?.()||[]).find(v=>v?.connected&&v.mapping==='standard');}catch{}
  document.body.classList.toggle('pad-connected',!!p);
  const key=p?p.index+'/'+p.id:null;
  if(key!==activePadKey){held=[];padUI.clear(p);resetFlightPadHolds();activePadKey=key;}
  if(!p){releaseExternalAction('pad');return;}
  if(document.hidden||!document.hasFocus()){padUI.clear(p);resetFlightPadHolds();held=p.buttons.map(v=>v.pressed||v.value>.55);return;}
  const b=p.buttons.map(v=>v.pressed||v.value>.55),edge=i=>b[i]&&!held[i],current=mode;
  if(!b[0])releaseExternalAction('pad');
  if(padUI.poll(p,edge,{...uiPadActions,mode:current})||current!=='flight'||!flightPadAllowed(p)){
    resetFlightPadHolds();held=b;return;
  }
  if(current==='flight'){
    flightPadButtons(b,edge);
  }
  held=b;
}
const clamp=(v,l,h)=>Math.min(h,Math.max(l,v)),distfmt=n=>n>=1000?(n/1000).toFixed(1)+' km':Math.round(n)+' m';
function compass(h){return ['N','NE','E','SE','S','SW','W','NW'][Math.round(h/45)%8];}
let beaconVec;
const sight=$('dropSight');
let impactVec;
function drawDropSight(){
  const impact=flight.state.cameraId==='drop'?(activeLoadout?.hook?missions.getHookAim():missions.getBucketAim()):null;
  if(!impact){sight.hidden=true;return;}
  impactVec??=new ctx.THREE.Vector3();
  impactVec.set(impact.x,impact.y,impact.z).project(ctx.camera);
  sight.hidden=impactVec.z< -1||impactVec.z>1||Math.abs(impactVec.x)>.98||Math.abs(impactVec.y)>.98;
  if(!sight.hidden){sight.style.left=(50+impactVec.x*50)+'%';sight.style.top=(50-impactVec.y*50)+'%';}
}
function drawHUD(){
  if(!flight||!missions)return;const s=flight.state,m=missions.state;
  updateWeatherDisplay(s.weather);
  $('objective').textContent=m.title;$('instruction').textContent=m.instruction;$('distance').textContent=m.target?(m.destination||'목표')+' · '+distfmt(m.distance):'현장 관제';
  $('count').textContent=m.completed+'건 · '+m.score+'점 · §'+m.cash;$('prog').firstElementChild.style.width=clamp((m.progress||0)*100,0,100)+'%';
  const seconds=m.secondsLeft;
  $('dispatchTimer').textContent=Number.isFinite(seconds)?'남은 시간 '+Math.floor(seconds/60)+':'+String(Math.max(0,Math.floor(seconds)%60)).padStart(2,'0'):'순찰 무전';
  $('nextCall').textContent='호출 '+m.activeCount+'건 ↻';
  const bucket=m.bucket,hook=m.loadout?.hook?m.hook:null,rig=hook||bucket,drop=s.cameraId==='drop';
  const litres=Math.round(m.supplies.water*bucket.capacityLitres/100);
  const cargoLabel=hook?.attached?'컨테이너 '+Math.round(hook.massKg)+' kg · '+(hook.grounded?'지면 안착':'인양 중'):'빈 고리';
  const loadLabel=hook?cargoLabel:'물 '+litres+'/'+bucket.capacityLitres+' L';
  $('cabinStatus').textContent='탑승 '+m.cabinUsed+'/'+m.cabinCapacity+'　'+loadLabel+'　최루탄 '+m.supplies.gas;
  $('bucketControls').hidden=s.onFoot||!(hook||m.loadout?.bucket)||!(externalSelected()||rig.deployed||rig.extension>.1||drop);
  $('bucketCable').hidden=!hook&&bucket.kind==='tank';
  const waterOption=$('fieldTool').querySelector('option[value="bucket"]');
  if(waterOption&&waterOption.textContent!==bucket.name)waterOption.textContent=bucket.name;
  $('bucketCable').textContent=rig.deployed?'줄 감기':'줄 내리기';
  $('bucketCable').setAttribute('aria-pressed',String(rig.deployed));
  $('bucketView').textContent=drop?'시점 복귀':hook?'하방 시점':'투하 시점';
  $('bucketView').setAttribute('aria-pressed',String(drop));
  const valve=$('bucketValve');
  valve.textContent=hook?(hook.attached?'고리 해제':'고리 연결'):'물 투하';
  valve.title=hook?'B 또는 Xbox A 한 번: 컨테이너 연결 · 안착 후 해제':'B 또는 Xbox A를 누르는 동안 물 투하';
  valve.setAttribute('aria-label',hook?valve.textContent:bucket.name+' · 누르고 있는 동안 물 투하');
  valve.setAttribute('aria-pressed',String(hook?hook.attached:bucket.dispensing));
  const gauge=$('waterGauge'),readout=$('waterReadout');
  gauge.hidden=!!hook;
  gauge.value=m.supplies.water;
  gauge.setAttribute('aria-label',bucket.name+' 남은 물');
  gauge.setAttribute('aria-valuetext',litres+' / '+bucket.capacityLitres+' L');
  readout.textContent=hook?cargoLabel:litres+' L';
  gauge.parentElement.title=hook?'화물 연결 상태':bucket.name+' 남은 물';
  readout.title=hook?cargoLabel:bucket.filling?'급수 중':bucket.dispensing?'투하 중':'남은 물';
  const chosen=m.calls?.find(c=>c.focused),incident=chosen&&rankIncidents([chosen],flight.position)[0];
  $('incidentPriority').hidden=!incident;
  if(incident){$('incidentPriority').textContent=incident.label;$('incidentPriority').style.setProperty('--priority-color',incident.color);}
  const responding=m.serviceUnits.filter(u=>u.status==='responding'||u.status==='at-scene')
    .map(u=>({police:'경찰',hospital:'구급',fire:'소방'})[u.kind]+(u.status==='responding'?' 이동 중':' 현장 도착'));
  const details=m.remainingCrowd==null?responding:['군중 '+m.remainingCrowd+'명',...responding];
  $('unitStatus').textContent=details.join(' · ');
  const recommended=m.suggestedTool==='bucket'?bucket.name:TOOLS[m.suggestedTool];
  $('fieldTool').options[0].textContent=recommended&&m.suggestedTool!=='context'?'권장 · '+recommended:TOOLS.context;
  $('alt').textContent=Math.round(s.altitudeAGL);$('spd').textContent=Math.round(s.speed*3.6);$('hdg').textContent=String(Math.round(s.heading)%360).padStart(3,'0');
  $('performance').textContent=Math.round(avg||0)+' FPS';$('navlabel').textContent=compass(s.heading)+' · '+(s.grounded?'지상 대기':'비행 중');
  const mobile=document.body.classList.contains('mobile-layout');
  let direction='';
  if(m.target){const p=flight.position,az=(Math.atan2(m.target.x-p.x,p.z-m.target.z)*180/Math.PI+360)%360,d=((az-s.heading+540)%360)-180;
    direction=Math.abs(d)<12?'정면':(d<0?'◂ 좌측 ':'우측 ▸ ')+Math.round(Math.abs(d))+'°';
    $('course').textContent='목표 '+String(Math.round(az)%360).padStart(3,'0')+'°  ·  '+direction;}else $('course').textContent='관제 대기';
  if(mobile){
    const priority=incident?.level<=1?incident.label+' · ':'';
    $('touchMission').textContent=priority+m.title;
    $('touchBrief').style.setProperty('--touch-priority',incident?.color??'#9ddce6');
    $('touchCourse').textContent=m.target?distfmt(m.distance)+' · '+direction:'';
    $('touchReadings').textContent='고도 '+Math.round(s.altitudeAGL)+' m　속도 '+Math.round(s.speed*3.6)+' km/h';
  }
  const help=s.controlScheme==='classic'?'방향키 이동·선회　Q/W 상승·하강　E 하차　T 시점　Enter 작업':'WASD 이동　Space/Shift 상승·하강　C 시점　E 작업';
  $('quick').textContent=s.gamepad?'A 작업　B 탑승·하차　View 지도 / 길게 조작 메뉴':touch.visible?(tilt.enabled&&!s.onFoot?'기울기 피치·뱅크 · 스틱 선회 · 버튼 상승·하강':'왼쪽 스틱 이동·선회 · 오른쪽 버튼 조종'):help;
  $('schemeHelp').textContent=help+'　Tab 호출　M 지도 · 화면의 빈 곳을 끌거나 Xbox 오른쪽 스틱으로 둘러보기';
  $('touchUse').setAttribute('aria-label',($('fieldTool').selectedOptions[0]?.textContent||'현장 권장 작업')+' 사용');
  $('recallUnit').disabled=!['firetruck','ambulance','police','follow'].includes($('fieldTool').value);
  cockpit.update(flight,missions);cockpit.drawRadar(city,flight,missions);
  const inCockpit=s.cameraId==='cockpit',cameraKey=s.controlScheme==='classic'?'T':'C';
  $('cockpitView').hidden=s.onFoot;
  $('cockpitView').textContent=inCockpit?'추적 시점':'조종석';
  $('cockpitView').title=(inCockpit?'추적 시점':'1인칭 조종석')+'으로 전환';
  $('cameraHelp').textContent=cameraKey+' / Xbox Y 시점 전환 · X / Xbox 오른쪽 스틱 클릭 투하 시점';
  const nextView=inCockpit?'상공':s.cameraId==='overhead'||drop?'추적':'조종석';
  $('touchCamera').textContent=nextView;
  $('touchCamera').setAttribute('aria-label',nextView+' 시점으로 전환');
  if(elapsed>radioUntil)$('radioMessage').textContent='';
  $('hangarBtn').disabled=!s.onFoot||!homeBase.nearDoor(flight.playerPosition);
  $('serviceBtn').disabled=!s.grounded||!s.onFoot;
  const compactRadio=mobile&&document.body.classList.contains('touch-panels-collapsed')?$('radioMessage').textContent:'';
  $('feedback').textContent=saveError||(elapsed<noticeUntil?playerNotice:m.feedback)||compactRadio||'';
  if(s.onFoot){
    $('instruction').textContent=m.phase==='patient-carry'?m.instruction:m.phase==='patient-scene'?'부상자에게 걸어가 헬기로 데려오세요.':'헬기 옆문까지 걸어가면 탑승합니다. 격납고 입구에서는 카탈로그를 열 수 있습니다.';
    $('touchUse').setAttribute('aria-label','기체 또는 격납고 입구 사용');
  }
  const b=$('beacon');b.hidden=true;
  if(qs.get('guide')==='1'&&m.target&&m.distance>18){beaconVec??=new ctx.THREE.Vector3();beaconVec.set(m.target.x,m.target.y+12,m.target.z).project(ctx.camera);
    if(beaconVec.z>0&&beaconVec.z<1&&Math.abs(beaconVec.x)<.92&&Math.abs(beaconVec.y)<.81){b.hidden=false;b.style.left=(50+beaconVec.x*50)+'%';b.style.top=(50-beaconVec.y*50)+'%';b.lastElementChild.textContent=distfmt(m.distance);}}
  if(m.ledger!==lastLedger&&!saving&&performance.now()>=retrySaveAt)void saveFlight();
  if(campaignCity&&!promotionCalled){
    const profile=currentProfile,route=districtRoute(campaignCity);
    if(!profile.clearedCities?.includes(campaignCity)&&(profile.cityScores?.[campaignCity]??0)>=route.goal){
      promotionCalled=true;radio.notify({kind:'promotion',message:'도시 근무 완료. 격납고로 복귀하세요.'});
    }
  }
  prevPhase=m.phase;
}
function snapshot(){if(!ctx||!flight)return {mode};const s=flight.state,m=missions.state,r=ctx.renderer,gl=r.getContext(),dbg=gl.getExtension('WEBGL_debug_renderer_info');
  return {mode,city:city.name,helicopter:s.name,position:flight.position.toArray(),agl:s.agl,speed:s.speed,grounded:s.grounded,heading:s.heading,gamepad:s.gamepad,touch:touch.visible,quality:$('quality').value,phase:m.phase,onFoot:s.onFoot,fuel:s.fuel,damage:s.damage,night:ctx.night,completed:m.completed,agents:[m.activePeople,m.activeCars,m.activeBoats],transit:transit?.state,civic:civic?.state,loads:ctx.assets.loaded,assetErrors:[...ctx.assets.failed,...(m.assetErrors||[]),...(civic?.state.assetErrors||[])],size:[gl.drawingBufferWidth,gl.drawingBufferHeight],scale,drawCalls:r.info.render.calls,triangles:r.info.render.triangles,renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):'unknown',fps:avg};}
function animate(t){
  requestAnimationFrame(animate);pad();if(mode!=='flight')return;const raw=(t-last)/1000;last=t;if(raw<=0)return;
  try{
    const dt=Math.min(.1,raw);elapsed+=dt;
    flight.setPayload({passengers:missions.state.cabinUsed,waterFraction:activeLoadout?.bucket?missions.state.supplies.water/100:0,
      externalLoadKg:missions.state.hook?.externalLoadKg??0});
    flight.setFireSources(missions.getFireSources());
    const tiltFlying=touch.visible&&!flight.state.onFoot;
    tilt.setFlying(tiltFlying);
    if(tilt.enabled){
      const cyclic=tilt.sample(dt),manual=touch.state;
      flight.setTouchInput(tiltFlying?{...manual,forward:manual.forward||cyclic.forward,strafe:manual.strafe||cyclic.strafe}:manual);
    }
    flight.update(dt);
    if(!flight.state.onFoot&&document.hasFocus())haptics.turbulence(flight.state.turbulence);
    const focus=flight.focusPosition;
    if((civicDue-=dt)<=0){civic.update(focus);civicDue=.14;}city.update?.(focus,elapsed);missions.update(dt);
    flight.syncBucketView(mountedRig());drawDropSight();
    transit.update(dt,focus);ctx.frame(city,flight);sound.frame(flight.state.rpm);
    const near=flight.state.onFoot&&homeBase.nearDoor(focus);
    if(near&&!enteredDoor&&flight.state.walkSpeed>.05){enteredDoor=true;openHangar();}
    if(!near)enteredDoor=false;
    if(wasOnFoot!==flight.state.onFoot){say(flight.state.onFoot?'기체에서 내렸습니다.':'기체 탑승. 상승 입력으로 시동을 거세요.');wasOnFoot=flight.state.onFoot;}
    if(elapsed-lastConditionAt>15){lastConditionAt=elapsed;void saveCondition();}
    if(diag){diagFrames.push(raw*1000);if(diagFrames.length>30000)diagFrames.splice(0,2000);}
    clockSamples.push(raw);if(clockSamples.length>120)clockSamples.shift();avg=clockSamples.length/clockSamples.reduce((a,b)=>a+b,0);
    if(elapsed>=nextScale&&['balanced','mobile'].includes($('quality').value)){
      nextScale=elapsed+2;slow=avg<58.5?slow+1:0;fast=avg>59.7?fast+1:0;
      const next=slow>=2?Math.max($('quality').value==='mobile'?.6:.67,scale-.085):fast>=8?Math.min(1,scale+.05):scale;
      if(next!==scale){scale=next;resize();slow=fast=0;}
    }
    if((hudDue-=dt)<=0){drawHUD();hudDue=.09;}
  }catch(e){failure(e);}
}
if(location.hostname==='127.0.0.1' && Number(location.port)>=42861 && Number(location.port)<42881)
  setInterval(()=>fetch('/health').catch(()=>{}),25000);
menu().catch(failure);requestAnimationFrame(animate);
