import {FLEET} from './fleet.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { PILOT_SEATS } from './pilot.js';
import { createWalkingPilot } from './walking-pilot.js';
import { createAirframeSystems } from './flight-service.js';
import {aircraftEnvelope,createFlightCollision} from './flight-collision.js';
import {createFireAirflow} from './fire-airflow.js';
import {createWeather} from './weather.js';
import {getRotorPerformance} from './rotor-performance.js';
import {createExteriorAddons} from './exterior-addons.js';
import {createAirframeDamageVisuals} from './aircraft-damage.js';
import {createRebound} from './flight-rebound.js';
import {createFlightDynamics,skidRetention,verticalForceStep} from './flight-dynamics.js';

// All source GLBs use metres, +Y up, +Z nose and a landing-gear ground origin.
// The nine original types keep their 40REF / HELI.TWK profiles. The eleven
// additional airframes have game-tuned handling values in the fleet catalog.
export const HELICOPTERS = FLEET;

const RAD = Math.PI / 180;
const TAU = 2 * Math.PI;
const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
const blend = (rate, dt) => -Math.expm1(-rate * dt);
const damp = (v, target, rate, dt) => v + (target - v) * blend(rate, dt);
const cameraModes = ['추적', '조종실', '상공', '투하'];
const cameraIds = ['chase', 'cockpit', 'overhead', 'drop'];
const modernKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyR', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC']);
const classicKeys = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyA','KeyS','KeyQ','KeyW','KeyT','KeyR','KeyI','KeyK','KeyJ','KeyL','KeyO','KeyP']);

// Apply the dead zone radially, preserving partial analog input in all directions.
function stick(axes, offset, dead = .16) {
  const x = axes[offset] || 0;
  const y = axes[offset + 1] || 0;
  const length = Math.hypot(x, y);
  if (length <= dead) return [0, 0];
  const magnitude = Math.min(1, (length - dead) / (1 - dead)) / length;
  return [x * magnitude, y * magnitude];
}

function makeInputs(onCameraChange, initialScheme, canvas, canLook, getLookXSign, padAllowed) {
  const keys = new Set();
  let scheme=initialScheme;
  const touch = {forward:0,turn:0,strafe:0,lift:0,lookX:0,lookY:0};
  let paused = false, focused = true, cameraWasDown = false, waitForNeutral = true, lastPad = null;
  const win = globalThis.window;
  const doc = globalThis.document;
  let drag=null;
  function clearLook(e){
    if(!drag||(e&&drag.id!==e.pointerId))return;
    const id=drag.id;drag=null;
    if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
  }
  const reset = () => { keys.clear(); clearLook(); Object.keys(touch).forEach(key=>touch[key]=0); waitForNeutral = true; cameraWasDown = false; };
  const available = () => !paused && focused && !doc?.hidden;
  function startLook(e){
    if(drag||e.button!==0||!available()||!canLook())return;
    const bounds=canvas.getBoundingClientRect();
    drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:0,y:0,span:clamp(Math.min(bounds.width,bounds.height)*.3,55,160)};
    e.preventDefault();
    try{canvas.setPointerCapture(e.pointerId);}catch{/* Window listeners also handle uncaptured drags. */}
  }
  function moveLook(e){
    if(!drag||drag.id!==e.pointerId)return;
    drag.x=clamp((e.clientX-drag.startX)/drag.span,-1,1);
    drag.y=clamp((e.clientY-drag.startY)/drag.span,-1,1);
  }
  canvas?.addEventListener('pointerdown',startLook);
  win?.addEventListener('pointermove',moveLook);
  win?.addEventListener('pointerup',clearLook);
  win?.addEventListener('pointercancel',clearLook);
  canvas?.addEventListener('lostpointercapture',clearLook);
  function cycleCamera() { if (available()) onCameraChange(); }
  function onKeyDown(e) {
    const classic=scheme==='classic';
    if (paused || !focused || doc?.hidden || !(classic?classicKeys:modernKeys).has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.closest?.('input, select, textarea, [contenteditable="true"], [role="dialog"]')) return;
    e.preventDefault();
    keys.add(e.code);
    if (!e.repeat && e.code===(classic?'KeyT':'KeyC')) onCameraChange();
    if (!e.repeat && classic && e.code==='KeyR') onCameraChange('chase');
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onBlur() { focused = false; reset(); }
  function onFocus() { focused = true; reset(); }
  function onVisibility() { reset(); }
  win?.addEventListener('keydown', onKeyDown);
  win?.addEventListener('keyup', onKeyUp);
  win?.addEventListener('blur', onBlur);
  win?.addEventListener('focus', onFocus);
  win?.addEventListener('orientationchange', reset);
  doc?.addEventListener('visibilitychange', onVisibility);
  function poll() {
    let pads;
    // WebView2 on localhost normally exposes getGamepads; a browser or host
    // policy that disables it must still leave keyboard flight usable.
    try { pads = globalThis.navigator?.getGamepads?.(); } catch { pads = null; }
    const connected = pads && Array.from(pads).find(p => p?.connected && p.mapping === 'standard');
    const pad = connected && (!padAllowed || padAllowed(connected)) ? connected : null;
    const identity = pad ? `${pad.index}/${pad.id}` : null;
    if (identity !== lastPad) { waitForNeutral = true; cameraWasDown = false; lastPad = identity; }
    let [x, y] = stick(pad?.axes || [], 0);
    let [lookX, lookY] = stick(pad?.axes || [], 2, .2);
    const btn = n => pad?.buttons[n]?.value ?? Number(!!pad?.buttons[n]?.pressed);
    const trigger = n => clamp((btn(n)-.035)/.965,0,1);
    let rise = trigger(7)-trigger(6), side = btn(5)-btn(4), cameraDown = btn(3)>.5;
    if (waitForNeutral || !focused || doc?.hidden) {
      if (focused && !doc?.hidden && Math.max(Math.abs(x), Math.abs(y), Math.abs(lookX), Math.abs(lookY), btn(4), btn(5), btn(6), btn(7)) < .08 && !cameraDown) waitForNeutral = false;
      x = y = lookX = lookY = rise = side = 0; cameraDown = false;
    }
    if (!paused && cameraDown && !cameraWasDown) onCameraChange();
    cameraWasDown = cameraDown;
    const any = (...codes) => codes.some(code => keys.has(code)) ? 1 : 0;
    const classic=scheme==='classic';
    return {
      forward: clamp(any('ArrowUp')-any('ArrowDown')+(classic?0:any('KeyW')-any('KeyS'))-y+touch.forward,-1,1),
      turn: clamp(any('ArrowRight')-any('ArrowLeft')+(classic?0:any('KeyD')-any('KeyA'))+x+touch.turn,-1,1),
      lateral: clamp((classic?any('KeyS')-any('KeyA'):any('KeyR')-any('KeyQ'))+side+touch.strafe,-1,1),
      lift: clamp((classic?any('KeyQ')-any('KeyW'):any('Space')-any('ShiftLeft','ShiftRight'))+rise+touch.lift,-1,1),
      zoom:classic?any('KeyK')-any('KeyI'):0,elevate:classic?any('KeyJ')-any('KeyL'):0,tilt:classic?any('KeyO')-any('KeyP'):0,
      lookX:clamp(lookX+touch.lookX+(drag?.x??0),-1,1)*(getLookXSign?.()===-1?-1:1),
      lookY:clamp(lookY+touch.lookY+(drag?.y??0),-1,1),gamepad: !!pad,
      touch:Object.values(touch).some(value=>value!==0),
    };
  }
  return {
    poll,
    reset,clearLook,
    setScheme(value){if(!['classic','modern'].includes(value))throw new Error('알 수 없는 조종 방식');scheme=value;reset();},
    setTouchInput(value={}) {
      for (const key of Object.keys(touch)) touch[key] = available() && Number.isFinite(value[key]) ? clamp(value[key],-1,1) : 0;
    },
    cycleCamera,
    setPaused(value) { paused = !!value; reset(); },
    dispose() {
      clearLook();
      canvas?.removeEventListener('pointerdown',startLook);
      win?.removeEventListener('pointermove',moveLook);
      win?.removeEventListener('pointerup',clearLook);
      win?.removeEventListener('pointercancel',clearLook);
      canvas?.removeEventListener('lostpointercapture',clearLook);
      win?.removeEventListener('keydown', onKeyDown);
      win?.removeEventListener('keyup', onKeyUp);
      win?.removeEventListener('blur', onBlur);
      win?.removeEventListener('focus', onFocus);
      win?.removeEventListener('orientationchange', reset);
      doc?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

// Blender groups rigid parts for editing. The GPU only needs one submission
// per material and independently moving pivot. Bake into each pivot's local
// coordinates, leaving the source template and its exported pivots untouched.
function batchRigidGeometry(THREE, model, pivots) {
  model.updateMatrixWorld(true);
  const domains = new Map();
  const resources = [];
  function collect(node, anchor) {
    if (pivots.has(node)) anchor = node;
    if (node.isMesh && !node.children.length && !node.isSkinnedMesh && !Array.isArray(node.material)
        && !node.geometry.groups.length && !Object.keys(node.geometry.morphAttributes).length && node.matrixWorld.determinant() > 0) {
      if (!domains.has(anchor)) domains.set(anchor, new Map());
      const grouped = domains.get(anchor);
      if (!grouped.has(node.material)) grouped.set(node.material, []);
      grouped.get(node.material).push(node);
    }
    for (const child of node.children) collect(child, anchor);
  }
  collect(model, model);
  for (const [anchor, groups] of domains) {
    const inverse = anchor.matrixWorld.clone().invert();
    for (const [material, pieces] of groups) {
      if (pieces.length < 2) continue;
      const needsUV = pieces.some(o => o.geometry.hasAttribute('uv'));
      const prepared = pieces.map(o => {
        const geometry = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
        // Apache's solid-colour panels sometimes carry unused UVs. The
        // missing glTF TEXCOORD value is (0,0); do not drop authored UV data.
        if (needsUV && !geometry.hasAttribute('uv')) {
          geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(2 * geometry.attributes.position.count),2));
        }
        return geometry;
      });
      const merged = mergeGeometries(prepared);
      prepared.forEach(g => g.dispose());
      if (!merged) continue; // A future incompatible group keeps its original meshes.
      merged.computeBoundingSphere();
      const batch = new THREE.Mesh(merged,material);
      batch.name = `${anchor === model ? 'Airframe' : anchor.name} / ${material.name}`;
      batch.castShadow = batch.receiveShadow = true;
      anchor.add(batch);
      for (const o of pieces) o.removeFromParent();
      resources.push(merged);
    }
  }
  return resources;
}

function instantiate(THREE, template, definition) {
  const model = template.clone(true);
  const main = model.getObjectByName('MainRotor');
  const tail = definition.tail && model.getObjectByName(definition.tail);
  if (!main || (definition.tail && !tail)) throw new Error(`${definition.name}: 회전축 데이터를 읽을 수 없습니다.`);
  const replacements = new Map();
  const glazing=[];
  // Windshields retain their actual colours and opacity. Blended glass keeps
  // WebGL from rendering the whole city a second time for refraction.
  function runtimeMaterial(source) {
    const isGlazing=source.transmission>0 || source.transparent&&/glaz|canopy|glass|windshield/i.test(source.name);
    if (!isGlazing) return source;
    if (!replacements.has(source)) {
      const glass = source.clone();
      if(glass.transmission>0)glass.opacity=Math.min(glass.opacity,Math.max(.25,1-glass.transmission));
      glass.transmission = 0;
      glass.transparent = true;
      glass.depthWrite = false;
      glass.forceSinglePass = true;
      glazing.push({material:glass,exteriorOpacity:glass.opacity});
      replacements.set(source, glass);
    }
    return replacements.get(source);
  }
  model.traverse(o => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(runtimeMaterial) : runtimeMaterial(o.material);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  const domains = new Set([main, tail, model.getObjectByName('ChinSensor')].filter(Boolean));
  const batchedGeometry = batchRigidGeometry(THREE, model, domains);
  return {model, main, tail, setCockpit(enabled) {
    for(const {material,exteriorOpacity} of glazing)material.opacity=enabled?Math.min(.16,exteriorOpacity):exteriorOpacity;
  }, dispose() {
    batchedGeometry.forEach(g => g.dispose()); replacements.forEach(m => m.dispose());
  }};
}

export async function createFlight(ctx, city, helicopterId = HELICOPTERS[0].id, options={}) {
  const {THREE, scene, camera, assets} = ctx;
  const object = new THREE.Group();
  object.name = 'Player helicopter';
  object.rotation.order = 'YXZ';
  const position = object.position;
  const spawn = city.spawn;
  const collisions=createFlightCollision(THREE,city,scene),airflow=createFireAirflow();
  const weather=options.weather??createWeather({mode:'calm',seed:0});
  const surfaceAt=(x,z,y=position.y)=>collisions.floorAt(x,z,y);
  const spawnFloor=surfaceAt(spawn.x,spawn.z);
  // The city spawn includes a small authoring clearance above its landing pad.
  position.set(spawn.x,spawn.y <= spawnFloor+.15 ? spawnFloor : spawn.y,spawn.z);
  let heading = (Number.isFinite(spawn.heading) ? spawn.heading : 0) * RAD;
  const state = {
    position, id: '', name: '', altitudeAGL: 0, agl: 0, altitude: 0, speed: 0, verticalSpeed: 0,
    airspeed:0,weather:sampleWeather(position,Math.max(0,position.y-spawnFloor)),turbulence:0,updraft:0,
    heading:0,grounded:true,rpm:0,gamepad:false,touch:false,cameraMode:cameraModes[0],cameraId:cameraIds[0],
    onFoot:false,hasPilot:true,pilotHeading:0,walkSpeed:0,notice:'',controlScheme:options.controlScheme??'classic',
  };
  let active,spec,dynamics,referenceMass,request=0,disposed=false,paused=false;
  let vx = 0, vz = 0, vy = 0, yawRate = 0, bank = 0, pitch = 0;
  let groundIdle = 0, rotorAngle = 0, tailAngle = 0, cameraMode = 0, orbit = 0, orbitHeight = 0;
  let bucketState=null,previousView='chase';
  let cameraDistance=0,cameraElevation=0,cameraTilt=0,collisionCooldown=0;
  let gustX=0,gustY=0,gustZ=0,heatTimer=0;
  let lastObstacle='',separationTime=0;
  const lastImpactPosition=new THREE.Vector3(),lastImpactNormal=new THREE.Vector3();
  const velocity=new THREE.Vector3(),trial=new THREE.Vector3();
  const rebound=createRebound(THREE);
  const payload={passengers:0,waterFraction:0,externalLoadKg:0};
  const cameraTarget = new THREE.Vector3();
  const desiredCamera = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const exteriorNear=camera.near,exteriorFov=camera.fov;
  const walker=createWalkingPilot(ctx,city,object,state,options.renderPilot!==false,{
    blockWorld:collisions.blocksWalker,floorAt:collisions.floorAt,contactAircraft:contactAt,
  });
  const systems=createAirframeSystems(state,position,walker.position,spawn);
  function updatePerformance(){
    state.rotorPerformance=getRotorPerformance(spec.id,{...payload,fuelGallons:state.fuelGallons,damage:state.damage,
      waterCapacityLitres:state.fit ? state.fit.water?.capacityLitres ?? 0 : null,
      climbFactor:state.fit?.modifiers.climbFactor ?? 1,
      rpm:state.rpm,pilotOnBoard:!state.onFoot,verticalFactor:Math.max(0,Math.cos(pitch)*Math.cos(bank))});
    return state.rotorPerformance;
  }
  function rotateRotors(dt) {
    const spin = state.rpm * dt * 392 / spec.diameter;
    rotorAngle = (rotorAngle + spin) % TAU;
    active.main.rotation.y = rotorAngle;
    if (!active.tail) return;
    if (spec.tail === 'SecondMainRotor') {
      active.tail.rotation.y = -rotorAngle;
    } else {
      tailAngle = (tailAngle + spin * (spec.tail === 'FenestronRotor' ? 6.3 : 4.65)) % TAU;
      active.tail.rotation.x = tailAngle;
    }
  }
  function refreshFit(){
    state.fit=options.getFit?.(spec.id)??null;
    active.exterior?.setFit(state.fit);
    updatePerformance();
  }
  function setPayload(value={}){
    for(const key of Object.keys(payload))payload[key]=Math.max(0,Number.isFinite(value[key])?value[key]:0);
    if(spec)updatePerformance();
  }
  function updateDamageVisuals(dt=0){
    active?.damageVisuals?.update(state.damage,state.rpm,dt);
  }
  function impact(kind,part,speed,fraction,message,contact){
    if(!(fraction>0)||state.damage>=100)return false;
    const before=state.damage;
    systems.impact(fraction,message);
    const linearEnergy=kind==='fire'?0:.5*(state.rotorPerformance?.massKg??1)*((vx+gustX)**2+(vy+gustY)**2+(vz+gustZ)**2);
    ctx.onFlightImpact?.({kind,part,speed,reason:message,damageDelta:state.damage-before,position:position.clone(),energy:linearEnergy,
      ...(contact?{normal:{x:contact.normal.x,y:contact.normal.y,z:contact.normal.z},colliderId:contact.colliderId??kind}:{}),
      aircraftId:state.id,damage:state.damage,damagePoints:state.damagePoints,destroyed:before<100&&state.damage>=100});
    return true;
  }
  function selectView(index){
    inputs.clearLook();
    orbit=orbitHeight=0;
    cameraMode=index;state.cameraMode=cameraModes[index];state.cameraId=cameraIds[index];
    object.visible=index!==3;
    const cockpit=index===1;
    camera.near=cockpit?.085:exteriorNear;camera.fov=cockpit?68:exteriorFov;
    camera.updateProjectionMatrix();active?.setCockpit(cockpit);
  }
  function setCameraMode(id){
    const index=cameraIds.indexOf(id);
    if(disposed||paused||state.onFoot||index<0)return false;
    if(id==='drop'&&cameraMode!==3)previousView=state.cameraId;
    if(id==='chase'){cameraDistance=0;cameraElevation=0;cameraTilt=0;}
    selectView(index);follow(0,{lookX:0,lookY:0},true);return true;
  }
  function adjustCamera({distance=0,elevation=0,tilt=0}={}){
    if(disposed||state.onFoot)return false;
    cameraDistance=clamp(cameraDistance+distance,-18,58);
    cameraElevation=clamp(cameraElevation+elevation,-6,25);
    cameraTilt=clamp(cameraTilt+tilt,-12,12);
    follow(0,{lookX:0,lookY:0},true);return true;
  }
  function recenterCamera(){
    if(disposed||state.onFoot)return false;
    inputs.clearLook();orbit=orbitHeight=cameraDistance=cameraElevation=cameraTilt=0;
    follow(0,{lookX:0,lookY:0},true);return true;
  }
  const inputs = makeInputs(command=>setCameraMode(command??cameraIds[cameraMode>=2?0:cameraMode+1]),
    state.controlScheme,ctx.renderer?.domElement,()=>!state.onFoot&&cameraMode<2,options.getLookXSign,options.padAllowed);

  async function switchHelicopter(id,{parkAtBase=false}={}) {
    const definition = HELICOPTERS.find(h => h.id === id);
    if (!definition) throw new Error(`알 수 없는 기종: ${id}`);
    if (disposed) return false;
    const ticket = ++request;
    if (active && spec === definition) return true;
    const template = await assets.load(definition.path);
    if (disposed || request !== ticket) return false;
    const next = instantiate(THREE, template, definition);
    next.envelope=aircraftEnvelope(THREE,next.model,next.main,next.tail,definition.diameter);
    collisions.setEnvelope(next.envelope);
    if(parkAtBase && state.onFoot && state.grounded && Number.isInteger(spawn.col)){
      if(!fitDeparturePad(walker.position)){
        collisions.setEnvelope(active.envelope);
        next.dispose();
        throw new Error('기지 주변에 기체와 로터가 들어갈 주기 공간이 없습니다.');
      }
    }
    if (active) { active.exterior?.dispose();active.damageVisuals.dispose();object.remove(active.model);active.dispose(); }
    active = next; spec = definition;
    referenceMass=getRotorPerformance(spec.id).massKg;
    dynamics=createFlightDynamics(spec,next.envelope,referenceMass);
    object.add(active.model);
    state.id = spec.id; state.name = spec.name;
    systems.select(spec.id);
    rebound.reset();lastObstacle='';separationTime=0;
    active.damageVisuals=createAirframeDamageVisuals(THREE,scene,next.model,next.main,next.tail,spec.diameter);
    if(options.getFit)active.exterior=createExteriorAddons(THREE,next.model,spec);
    updateDamageVisuals();
    active.setCockpit(cameraMode===1);
    refreshFit();
    return true;
  }

  function step(dt, control) {
    const floor = surfaceAt(position.x, position.z);
    const agl = Math.max(0, position.y - floor);
    const ambient=localWeather(dt,position,agl);
    if (state.grounded && control.lift <= 0) groundIdle += dt; else groundIdle = 0;
    collisionCooldown=Math.max(0,collisionCooldown-dt);
    const powered=state.fuelGallons>0&&state.damage<100;
    const targetRpm = !powered?(state.grounded?0:.42):state.grounded && control.lift <= 0 ? (groundIdle < 4 && state.rpm > .01 ? .62 : 0) : 1;
    const mods=state.fit?.modifiers;
    state.rpm = damp(state.rpm, targetRpm, targetRpm > state.rpm ? 1.6*(mods?.spoolFactor??1) : .64, dt);
    const performance=updatePerformance();
    const verticalAuthority=performance.verticalThrustToWeight??performance.thrustToWeight;
    if (state.grounded && powered && control.lift > .025 && verticalAuthority>1) state.grounded = false;

    // Fixed small substeps, exponential damping, no acceleration tied to RAF.
    // Neutral collective holds height; the close-to-ground limiter softens touchdown.
    const health=1-state.damage*.004;
    const descent=control.lift<-.8?spec.climb:Math.min(spec.climb,1.25+agl*.47);
    let climb = Math.max(control.lift, 0)*spec.climb*Math.min(1.75*(mods?.climbFactor??1),performance.climbScale) + Math.min(control.lift, 0)*descent;
    if(!powered&&!state.grounded){
      // 14TUT: keep the rotor turning with forward flight, flare just before contact.
      const flare=agl<8?Math.max(0,-control.forward)*2.6:0;
      climb=-5+Math.max(0,control.forward)*1.3+flare;
    }
    if(!state.grounded)climb+=ambient.windUp;
    climb = Math.min(climb, Math.max(0, 600 - agl) * .7);
    const response=control.lift>0&&powered?Math.max(.25,Math.min(2.6,1.2+performance.climbScale*1.4)):control.lift===0?1.85:2.6;
    let verticalLift=0;
    if(state.grounded)vy=0;
    else if(powered){
      const step=verticalForceStep(vy,climb,response,performance,dt);
      vy=step.velocity;verticalLift=step.lift;
    }else vy=damp(vy,climb,response,dt); // Autorotative descent/flare schedule above.
    const wind=airflow.sample(position,dt);
    state.turbulence=state.grounded?0:Math.max(wind.strength,ambient.turbulence);
    state.updraft=wind.up;
    const aerodynamicScale=state.grounded?0:1;
    gustX=gustX*Math.exp(-dt*1.1)+wind.x*dt*aerodynamicScale;
    gustY=gustY*Math.exp(-dt*.95)+wind.up*dt*aerodynamicScale;
    gustZ=gustZ*Math.exp(-dt*1.1)+wind.z*dt*aerodynamicScale;
    heatTimer+=dt;
    if(heatTimer>=.45){
      if(wind.heat>.06)impact('fire','airframe',0,wind.heat*heatTimer*.018,'화염과 연기로 기체가 손상되었습니다.');
      heatTimer=0;
    }
    const previousHeading=heading,previousPitch=pitch,previousBank=bank;
    const turnCommand=control.turn*spec.yaw*(mods?.yawFactor??1)*RAD;
    yawRate=state.grounded?0:dynamics.yaw(yawRate,turnCommand,performance,dt);
    heading = (heading + yawRate * dt + TAU) % TAU;
    const sin = Math.sin(heading), cos = Math.cos(heading);
    const authority = state.grounded ? 0 : clamp(agl / 4, .06, 1)*health;
    const speed=spec.speedKmh*(mods?.speedFactor??1)/3.6;
    const forward = control.forward * speed * (control.forward < 0 ? .35 : 1);
    const sideways = control.lateral * speed * .40;
    // Cyclic commands velocity relative to the air mass. Ground momentum
    // follows gradually, so a hover in a crosswind requires upwind cyclic.
    const goalX = (sin * forward + cos * sideways) * authority + ambient.windX*aerodynamicScale;
    const goalZ = (-cos * forward + sin * sideways) * authority + ambient.windZ*aerodynamicScale;
    const momentum=Math.hypot(vx,vz);
    if(state.grounded){
      const retention=skidRetention(momentum,9.80665*dt,ambient.rain);
      vx*=retention;vz*=retention;
    }else{
      velocity.set(vx,vy,vz);
      dynamics.translate(velocity,goalX,goalZ,ambient,performance,verticalLift,dt);
      vx=velocity.x;vz=velocity.z;
    }
    velocity.set(vx+gustX,vy+gustY,vz+gustZ);
    if(!state.grounded)rebound.afterControls(velocity,dt);
    vx=velocity.x-gustX;vy=velocity.y-gustY;vz=velocity.z-gustZ;
    let nextX = position.x + (vx+gustX) * dt, nextZ = position.z + (vz+gustZ) * dt;
    const limits = city.bounds;
    if (limits) {
      if (nextX < limits.minX || nextX > limits.maxX) { nextX = clamp(nextX, limits.minX, limits.maxX); vx = 0; }
      if (nextZ < limits.minZ || nextZ > limits.maxZ) { nextZ = clamp(nextZ, limits.minZ, limits.maxZ); vz = 0; }
    }
    let nextFloor = surfaceAt(nextX, nextZ);
    let nextY = position.y + (vy+gustY) * dt;
    let skidSupport=null;
    const descentSpeed=vy+gustY;
    // The assisted approach keeps the fuselage near level during low hovers.
    // Blend into full cyclic attitude over two rotor diameters, so one input
    // beside a roof or tree cannot pitch the cabin steeply toward the ground.
    const air=state.grounded?0:clamp((nextY-nextFloor)/(spec.diameter*2),0,1);
    const gustPitch=(ambient.gustX*sin-ambient.gustZ*cos)*.017;
    const gustBank=(ambient.gustX*cos+ambient.gustZ*sin)*.020;
    // Rotor flapping lets the disk tilt ahead of the fuselage. Body attitude
    // follows that force through its own inertia, including the nose-up flare
    // when a pilot releases forward cyclic to brake.
    const liftReference=Math.max(verticalLift,performance.weightNewtons*.5);
    const rotorForce=dynamics.horizontalThrust;
    const diskPitch=Math.atan2(rotorForce.x*sin-rotorForce.z*cos,liftReference);
    const diskRoll=Math.atan2(rotorForce.x*cos+rotorForce.z*sin,liftReference);
    const targetPitch=(diskPitch*.64+control.forward*spec.pitch*RAD*.25+wind.pitch+gustPitch)*air;
    const targetBank=(diskRoll*.64+(control.lateral*spec.slide*.28+
      control.turn*Math.min(1,state.speed/22)*spec.bank*.52)*RAD+wind.bank+gustBank)*air;
    if(state.grounded){
      dynamics.resetRates();pitch=damp(pitch,0,4,dt);bank=damp(bank,0,4,dt);
    }else{
      pitch=dynamics.pitch(pitch,targetPitch,performance,dt);
      bank=dynamics.roll(bank,targetBank,performance,dt);
    }
    let hit=null,hitFraction=1;
    // A fast aircraft can cross a wire or the underside of a deck between
    // endpoints. Search along the proposed motion before accepting its pose.
    const checks=Math.max(1,Math.ceil(Math.max(Math.hypot(nextX-position.x,nextZ-position.z)/.65,Math.abs(nextY-position.y)/.12)));
    for(let i=1;i<=checks&&!hit;i++){
      const u=i/checks;
      trial.set(position.x+(nextX-position.x)*u,Math.max(floor,position.y+(nextY-position.y)*u),position.z+(nextZ-position.z)*u);
      collisions.setPose(trial.x,trial.y,trial.z,
        previousHeading+yawRate*dt*u,previousPitch+(pitch-previousPitch)*u,previousBank+(bank-previousBank)*u);
      hit=collisions.contact(state.rpm,ctx.transit?.collisionObjects,position);
      if(hit)hitFraction=u;
    }
    if(!hit && nextFloor>nextY+.18 && nextFloor>floor+.10){
      const normal=new THREE.Vector3(position.x-nextX,0,position.z-nextZ).normalize();
      if(normal.lengthSq()>0)hit={normal,depth:Math.hypot(nextX-position.x,nextZ-position.z),
        kind:'terrain',part:'airframe'};
    }
    if(hit){
      const obstacle=hit.colliderId??hit.kind;
      const speed=Math.hypot(velocity.x-(hit.vx??0),velocity.y-(hit.vy??0),velocity.z-(hit.vz??0));
      const supporting=hit.part==='airframe'&&hit.normal.y>.60&&velocity.y<=0&&
        ['terrain','building','deck'].includes(hit.kind)&&position.y-floor<=.45;
      const newFace=lastObstacle!==obstacle||lastImpactNormal.dot(hit.normal)<.35;
      const damaging=!supporting&&newFace&&!collisionCooldown&&(speed>.75||hit.part==='rotor'&&state.rpm>.18);
      if(damaging){
        impact(hit.kind,hit.part,speed,Math.min(.48,.025+speed*.009+(hit.part==='rotor'?state.rpm*.10:0)),
          hit.part==='rotor'?'회전 날개가 장애물에 부딪혔습니다.':'기체가 장애물과 충돌했습니다.',hit);
        collisionCooldown=.8;lastObstacle=obstacle;lastImpactPosition.copy(trial);lastImpactNormal.copy(hit.normal);
      }
      separationTime=0;
      if(supporting){
        // The uphill skid reaches an uneven road or rooftop first. Keep the
        // ordinary touchdown and hard-landing damage paths for that contact.
        if(nextFloor>floor+.10){nextX=position.x;nextZ=position.z;nextFloor=floor;}
        skidSupport=state.grounded?nextFloor:Math.max(nextFloor,position.y);
        nextY=skidSupport;vy=gustY=0;
      }else{
        heading=previousHeading+yawRate*dt*hitFraction;
        pitch=previousPitch+(pitch-previousPitch)*hitFraction;
        bank=previousBank+(bank-previousBank)*hitFraction;
        // Resolve against the geometry at the sampled impact, including a
        // second wall in an inside corner. Clearance is measured at this pose.
        let contact=hit;
        for(let iteration=0;iteration<8&&contact;iteration++){
          rebound.respond(velocity,contact,state.rpm>.18,newFace&&iteration===0);
          trial.addScaledVector(contact.normal,Math.max(0,contact.depth)+.035);
          collisions.setPose(trial.x,trial.y,trial.z,heading,pitch,bank);
          contact=collisions.contact(state.rpm,ctx.transit?.collisionObjects,position);
        }
        if(contact){
          // A tight gap can constrain both sides. Prefer the last known clear
          // sample before the collision to an unresolved, penetrating pose.
          collisions.setPose(position.x,position.y,position.z,previousHeading,previousPitch,previousBank);
          if(!collisions.contact(state.rpm,ctx.transit?.collisionObjects,position)){
            trial.copy(position);heading=previousHeading;pitch=previousPitch;bank=previousBank;yawRate=0;
          }
        }
        if(limits){
          trial.x=clamp(trial.x,limits.minX,limits.maxX);
          trial.z=clamp(trial.z,limits.minZ,limits.maxZ);
        }
        nextX=trial.x;nextY=trial.y;nextZ=trial.z;nextFloor=surfaceAt(nextX,nextZ,nextY);
        vx=velocity.x-gustX;vy=velocity.y-gustY;vz=velocity.z-gustZ;
      }
    }else if(lastObstacle){
      separationTime+=dt;
      const steeringIntoSurface=goalX*lastImpactNormal.x+climb*lastImpactNormal.y+goalZ*lastImpactNormal.z<-.15;
      const farEnough=lastImpactPosition.distanceToSquared(position)>Math.max(14,spec.diameter)**2;
      if(separationTime>.35&&(!steeringIntoSurface||farEnough))lastObstacle='';
    }
    if (nextY <= nextFloor + .68 && vy <= 0) {
      const tile = city.tileAt?.(nextX,nextZ);
      if (powered && tile?.water && Number.isFinite(tile.waterY) && Math.abs(nextFloor-tile.waterY)<.5) {
        if(!collisionCooldown&&(vy< -2.8||momentum>10)){
          impact('water','airframe',Math.hypot(momentum,vy),Math.min(.34,Math.max(0,-vy-2.8)*.035+Math.max(0,momentum-10)*.008),'수면 충돌로 기체가 손상되었습니다.');
          collisionCooldown=1;
        }
        // The fleet has wheels or skids. Maintain a low hover over open water
        // rather than letting the aircraft park on a lake or sink to its bed.
        nextY = nextFloor + .68; vy=gustY=0; state.grounded = false;
      } else if (nextY <= nextFloor + .008 || skidSupport!==null) {
        rebound.reset();
        if(!state.grounded&&!collisionCooldown){
          const slope=Math.abs(nextFloor-city.groundAt(nextX,nextZ))<.3?
            Math.hypot(city.groundAt(nextX+.5,nextZ)-city.groundAt(nextX-.5,nextZ),city.groundAt(nextX,nextZ+.5)-city.groundAt(nextX,nextZ-.5)):0;
          const sink=Math.max(0,-descentSpeed);
          const severity=(Math.max(0,sink*sink-2.8**2)*.008+Math.max(0,momentum-7)*.012)*performance.massKg/referenceMass+Math.max(0,slope-.22)*.20;
          if(severity>.002)impact('landing','airframe',Math.hypot(momentum,descentSpeed),Math.min(.65,severity),'거친 착륙으로 기체가 손상되었습니다.');
          collisionCooldown=.7;
        }
        if(!state.grounded){
          const retention=skidRetention(Math.hypot(vx+gustX,vz+gustZ),-descentSpeed,ambient.rain);
          vx=(vx+gustX)*retention;vz=(vz+gustZ)*retention;
        }
        nextY=skidSupport??nextFloor;vy=gustX=gustY=gustZ=0;state.grounded=true;
      }
    }
    // Follow solid ground while sliding, but fall if the gear runs off a roof.
    if(state.grounded&&nextY-nextFloor>.12)state.grounded=false;
    position.set(nextX, Math.max(nextFloor, nextY), nextZ);
    object.rotation.set(pitch, Math.PI - heading, bank, 'YXZ');
    state.agl = state.altitudeAGL = state.altitude = Math.max(0, position.y - nextFloor);
    state.heading=heading/RAD;state.speed=Math.hypot(vx+gustX,vz+gustZ);state.verticalSpeed=vy+gustY;
    state.airspeed=Math.hypot(vx+gustX-ambient.windX,vz+gustZ-ambient.windZ);
    if(state.grounded)state.turbulence=0;
    rotateRotors(dt);
    systems.tick(dt);
  }

  function keepCameraInSight(target){
    const t=collisions.cameraRange?.(target,camera.position,.35)??1;
    if(t<1)camera.position.lerp(target,1-t);
  }
  function follow(dt, control, snap = false) {
    camera.up.set(0,1,0);
    if(state.onFoot){
      const p=walker.position,h=walker.heading;
      focus.set(p.x,p.y+1.45,p.z);
      desiredCamera.set(p.x-Math.sin(h)*4.7,p.y+2.45,p.z+Math.cos(h)*4.7);
      desiredCamera.y=Math.max(desiredCamera.y,surfaceAt(desiredCamera.x,desiredCamera.z,desiredCamera.y)+.65);
      camera.position.lerp(desiredCamera,snap?1:blend(8,dt));keepCameraInSight(focus);camera.lookAt(focus);return;
    }
    cameraDistance=clamp(cameraDistance+(control.zoom||0)*dt*16,-18,58);
    cameraElevation=clamp(cameraElevation+(control.elevate||0)*dt*8,-6,25);
    cameraTilt=clamp(cameraTilt+(control.tilt||0)*dt*8,-12,12);
    orbit = damp(orbit, control.lookX * 1.65, 4.2, dt);
    orbitHeight = damp(orbitHeight, -control.lookY * 5, 4.2, dt);
    if(cameraMode===1){
      // Seat and pilot scale are authored in each GLB. The look vector is
      // relative to the cabin, so it follows pitch and bank around the horizon.
      const seat=PILOT_SEATS[spec.id];
      object.updateWorldMatrix(true,false);
      const shake=active.damageVisuals?.shake;
      desiredCamera.set(seat[0]+(shake?.x??0),seat[1]+.78*seat[3]+(shake?.y??0),seat[2]+.08+(shake?.z??0));
      const yaw=(control.lookX||0)*1.2,tilt=-.07-(control.lookY||0)*.65+cameraTilt*.06;
      // The aircraft nose is local +Z, so the pilot's right is local -X.
      focus.set(-Math.sin(yaw)*Math.cos(tilt),Math.sin(tilt),Math.cos(yaw)*Math.cos(tilt)).multiplyScalar(40).add(desiredCamera);
      object.localToWorld(desiredCamera);object.localToWorld(focus);
      camera.position.copy(desiredCamera);camera.up.set(0,1,0).applyQuaternion(object.quaternion);camera.lookAt(focus);
      if(shake){camera.rotateX(shake.pitch);camera.rotateZ(shake.roll);}
      return;
    }
    if(cameraMode===2){
      // 07TUT locates the crosshair directly under the tail. Keep the nose
      // at the top of the screen and the view vertical for precise landings.
      const tail=spec.diameter*.34;
      focus.set(position.x-Math.sin(heading)*tail,position.y,position.z+Math.cos(heading)*tail);
      desiredCamera.copy(focus);desiredCamera.y+=Math.max(6,18+spec.diameter*.45+cameraDistance*.4+cameraElevation);
      camera.position.copy(desiredCamera);keepCameraInSight(focus);camera.up.set(Math.sin(heading),0,-Math.cos(heading));camera.lookAt(focus);return;
    }
    if(cameraMode===3){
      followBucket();
      return;
    }
    const lookAngle = heading + orbit;
    const range = Math.max(9,34+spec.diameter*1.30+cameraDistance);
    const height = Math.max(1.5,range*.17+2+orbitHeight+cameraElevation);
    const lead = 1.3 + Math.min(3.0, state.speed * .055);
    focus.set(position.x + Math.sin(heading) * lead, position.y + 1.7+cameraTilt, position.z - Math.cos(heading) * lead);
    if(bucketState?.extension>0&&bucketState.outlet){
      focus.y-=Math.min(9,Math.max(0,position.y-bucketState.outlet.y)*.48);
    }
    desiredCamera.set(position.x - Math.sin(lookAngle) * range, position.y + height,
      position.z + Math.cos(lookAngle) * range);
    const n = Math.ceil(range / 2.5);
    // Lift the boom enough for a rising hillside anywhere between focus and eye.
    for (let i = 1; i <= n; ++i) {
      const t = i / n;
      const floor=surfaceAt(focus.x+(desiredCamera.x-focus.x)*t,focus.z+(desiredCamera.z-focus.z)*t,focus.y+(desiredCamera.y-focus.y)*t);
      desiredCamera.y = Math.max(desiredCamera.y, focus.y + (floor + .65 - focus.y) / t);
    }
    camera.position.lerp(desiredCamera, snap ? 1 : blend(5.5, dt));
    camera.position.y=Math.max(camera.position.y,surfaceAt(camera.position.x,camera.position.z,camera.position.y)+.8);
    keepCameraInSight(focus);
    cameraTarget.lerp(focus, snap ? 1 : blend(8, dt));
    camera.lookAt(cameraTarget);
  }

  function followBucket(){
    const outlet=bucketState?.outlet??position;
    // A vertical belly view. Leave the suspended vessel beside the sight so
    // its bottom does not cover the point where a hovering drop will land.
    const side=1.65;
    camera.position.set(outlet.x+Math.cos(heading)*side,Math.max(position.y+.7,outlet.y+4),outlet.z+Math.sin(heading)*side);
    camera.up.set(Math.sin(heading),0,-Math.cos(heading));
    focus.copy(camera.position);focus.y-=10;camera.lookAt(focus);
    camera.updateMatrixWorld();
  }

  function dispose() {
    if (disposed) return;
    disposed = true; request++;
    inputs.dispose();walker.dispose();scene.remove(object);
    if (active) { active.exterior?.dispose();active.damageVisuals?.dispose();object.remove(active.model);active.dispose(); }
  }
  function fitDeparturePad(standingPilot=null) {
    // A city uses one pad for the whole fleet. Check the rendered hull and
    // spinning disks before parking a long crane or tandem beside a hangar.
    if(!Number.isInteger(spawn.col)) return false;
    const originalHeading=(spawn.heading || 0)*RAD;
    for(let radius=0;radius<=24;radius+=2){
      const count=radius ? 12 : 1;
      for(let point=0;point<count;point++){
        const angle=point*TAU/count;
        const x=spawn.x+radius*Math.sin(angle), z=spawn.z+radius*Math.cos(angle);
        const y=surfaceAt(x,z,spawnFloor);
        const tile=city.tileAt(x,z);
        if(!tile || tile.water || ![0,221,222].includes(tile.building) || Math.abs(y-spawnFloor)>.35) continue;
        for(const turn of [0,30,-30,60,-60,90,-90,120,-120,150,-150,180]){
          const candidate=originalHeading+turn*RAD;
          collisions.setPose(x,y,z,candidate,0,0);
          trial.set(x,y,z);
          if(collisions.contact(1,[],trial)) continue;
          if(standingPilot && [.37,.89,1.43].some(h=>collisions.contactAt(
            trial.set(standingPilot.x,standingPilot.y+h,standingPilot.z),.35,0))) continue;
          position.set(x,y,z);heading=candidate;
          bank=pitch=yawRate=vx=vy=vz=gustX=gustY=gustZ=0;
          object.rotation.set(0,Math.PI-heading,0,'YXZ');
          state.heading=((heading/RAD)%360+360)%360;
          state.agl=state.altitudeAGL=state.altitude=0;
          state.speed=state.verticalSpeed=state.rpm=0;
          return true;
        }
      }
    }
    return false;
  }
  try {
    await switchHelicopter(helicopterId);
    if(position.y<=spawnFloor+.15)fitDeparturePad();
    state.heading = ((heading / RAD) % 360 + 360) % 360;
    object.rotation.y = Math.PI - heading;
    state.agl = state.altitudeAGL = state.altitude = position.y - surfaceAt(position.x, position.z);
    state.grounded = state.agl < .06;
    if(!state.grounded)state.rpm=1;
    updatePerformance();
    scene.add(object);
    walker.board();
    if(options.startOnFoot!==false&&state.grounded)walker.leave();
    systems.refresh();
    updatePerformance();
    await walker.ready;
    if(state.pilotError)throw new Error('조종사 모델을 읽지 못했습니다. '+state.pilotError);
    follow(0, {lookX: 0, lookY: 0}, true);
  } catch (error) { dispose(); throw error; }

  function sampleWeather(point,agl,out){
    const ambient=weather.sample(point,agl,out);
    ambient.sheltered=(ambient.speed>0||ambient.rain>0)&&surfaceAt(point.x,point.z,Infinity)>point.y+1.5;
    if(ambient.sheltered){
      // A roof or overhead deck blocks rain and attenuates wind below it.
      for(const key of ['windX','windZ','windUp','gustX','gustZ','speed','gustSpeed','turbulence'])ambient[key]*=.20;
      ambient.rain=0;
    }
    return ambient;
  }
  function localWeather(dt,point,agl){
    weather.update(dt);
    state.weather=sampleWeather(point,agl,state.weather);
    return state.weather;
  }
  function update(dt) {
    if (disposed || paused || !Number.isFinite(dt) || dt <= 0) return;
    const control = inputs.poll();
    state.gamepad = control.gamepad;
    state.touch = control.touch;
    // A long background-tab delay must not fly the player into the next block.
    const elapsed = Math.min(.22, dt), steps = Math.ceil(elapsed * 60);
    if(state.onFoot){
      for(let i=0;i<steps&&state.onFoot;i++){
        const sub=elapsed/steps;
        localWeather(sub,walker.position,0);
        state.turbulence=0;state.updraft=0;
        state.rpm=damp(state.rpm,0,.9,sub);
        rotateRotors(sub);
        systems.tick(sub);
        updatePerformance();
        if(walker.update(sub,control))board();
      }
    }else{
      for (let i = 0; i < steps; ++i) step(elapsed / steps, control);
      walker.update(0,control);
    }
    updateDamageVisuals(elapsed);
    follow(elapsed, control);
  }
  function board(){
    walker.board();inputs.reset();state.notice='헬리콥터에 탑승했습니다.';systems.refresh();updatePerformance();
    selectView(0);follow(0,{lookX:0,lookY:0},true);
    return {ok:true,onFoot:false,message:state.notice};
  }
  function boardOrExit(){
    if(disposed||paused)return {ok:false,message:'비행을 재개한 뒤 사용할 수 있습니다.'};
    if(state.onFoot){
      if(walker.doorDistance()>2.1)return {ok:false,message:'기체 옆문으로 걸어가세요.'};
      return board();
    }
    if(!state.grounded||state.speed>1)return {ok:false,message:'착륙해 기체가 멈춘 뒤 내리세요.'};
    if(!walker.leave())return {ok:false,message:'옆문 아래에 안전한 발판이 없습니다.'};
    // Walking leaves a parked aircraft. Never resume the tail end of a skid
    // hours later when its pilot boards again.
    vx=vz=yawRate=0;state.speed=0;dynamics.resetRates();
    selectView(0);
    inputs.reset();state.touch=false;state.notice='기체에서 내렸습니다.';systems.refresh();updatePerformance();
    follow(0,{lookX:0,lookY:0},true);
    return {ok:true,onFoot:true,message:state.notice};
  }
  function setControlScheme(scheme){inputs.setScheme(scheme);state.controlScheme=scheme;}
  function contactAt(point,radius=.4){
    if(disposed||!active||!point)return null;
    collisions.setPose(position.x,position.y,position.z,heading,pitch,bank);
    const contact=collisions.contactAt(point,Math.max(0,radius),state.rpm);
    if(!contact)return null;
    const speed=Math.max(contact.speed,Math.hypot(state.speed,state.verticalSpeed));
    return {part:contact.part,speed,rpm:state.rpm,dangerous:contact.part==='rotor'?state.rpm>.18&&speed>3:speed>1.5,position:{x:point.x,y:point.y,z:point.z}};
  }
  function impactActor(kind,contact){
    if(!contact?.dangerous||collisionCooldown)return false;
    const result=impact(kind,contact.part,contact.speed,contact.part==='rotor'?.045:Math.min(.22,.018+contact.speed*.007),'기체가 움직이는 대상과 충돌했습니다.');
    vx*=.55;vz*=.55;collisionCooldown=.8;return result;
  }
  function setPaused(value) { paused = !!value; inputs.setPaused(paused); state.touch=false; }
  return {object,position,playerPosition:walker.position,focusPosition:walker.position,get doorPosition(){return walker.nearestDoor();},state,update,dispose,switchHelicopter,setPaused,sampleWeather,
    setControlScheme,boardOrExit,serviceQuote:systems.quote,service:options=>{const result=systems.service(options);updatePerformance();updateDamageVisuals();return result;},
    setPayload,refreshFit,setFireSources:s=>{airflow.setSources(s);if(!s?.length||state.onFoot){state.turbulence=state.onFoot||state.grounded?0:state.weather.turbulence;state.updraft=0;}},contactAt,impactActor,
    condition:systems.condition,restoreCondition:value=>{const ok=systems.restoreCondition(value);if(ok){updatePerformance();updateDamageVisuals();}return ok;},
    setTouchInput:value=>{if(!disposed)inputs.setTouchInput(value);},
    setCameraMode,adjustCamera,recenterCamera,toggleDropView:()=>setCameraMode(cameraMode===3?previousView:'drop'),
    syncBucketView:bucket=>{bucketState=bucket;if(cameraMode===3&&!state.onFoot)followBucket();},
    cycleCamera:()=>{if(!disposed)inputs.cycleCamera();}};
}
