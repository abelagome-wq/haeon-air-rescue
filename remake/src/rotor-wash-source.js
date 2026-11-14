import {FLEET} from './fleet.js';

const aircraft=new Map(FLEET.map(spec=>[spec.id,spec]));
const airframes=new WeakMap();
const yieldByKind={dust:1,grass:.64,pavement:.39,spray:1};
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const smooth=n=>n*n*(3-2*n);

// Use the same ground/water/network layers and roof sampler as the city.
// A higher deck occludes the rotor column rather than letting its dust or
// spray appear on the other side. A helicopter above a roof washes the roof.
export function rotorWashSurface(city,x,z,ceiling,out={}){
  const tile=city.tileAt(x,z);
  if(!tile)return null;
  const {building=0,terrain=0,zone=0,groundY,roadY,railY,waterY}=tile;
  const deck=Math.max(roadY??-Infinity,railY??-Infinity);
  const roof=city.roofAt?.(x,z)??-Infinity;
  const top=Math.max(groundY,deck,waterY??-Infinity,roof);
  if(!Number.isFinite(top)||top>ceiling+.04)return null;
  const roofSurface=roof>groundY+.12&&roof>=top-.04;
  const onPad=Math.abs(x-city.spawn.x)<=7.65&&Math.abs(z-city.spawn.z)<=7.65;
  let kind='grass';
  if(roofSurface||deck>=top-.04)kind='pavement';
  else if(waterY!=null&&waterY>=top-.04)kind='spray';
  else if(onPad||building>=198||building>=112&&zone!==1&&zone!==2)kind='pavement';
  else if(building>=1&&building<=5||building<6&&(terrain>0&&terrain<13||terrain>=32&&terrain<48))kind='dust';
  out.kind=kind;out.y=top;
  out.yield=roofSurface?.19:yieldByKind[kind];
  return out;
}

// At a rain-soaked hardstand, downwash carries a low veil of droplets
// instead of ejecting brown soil. Open water always yields spray.
export function rotorWashKind(surface,rain){
  return surface.kind==='pavement'&&rain>=.50?'spray':surface.kind;
}

export function rotorWashYield(surface,rain){
  if(surface.kind==='spray')return surface.yield;
  const dry=surface.yield*(1-rain)**2;
  return surface.kind==='pavement'&&rain>=.50?Math.max(dry,surface.yield*rain):dry;
}

function hubProbe(flight,spec){
  let probe=airframes.get(flight);
  if(probe?.id!==spec.id||probe.model&&probe.model.parent!==flight.object){
    const object=flight.object;
    probe={id:spec.id,hub:object?.getObjectByName?.('MainRotor'),rear:spec.tail==='SecondMainRotor'?object?.getObjectByName?.('SecondMainRotor'):null,
      point:object?.position?.clone?.(),rearPoint:object?.position?.clone?.(),surface:{},sensor:{},wind:{}};
    let node=probe.hub;
    while(node&&node.parent!==object)node=node.parent;
    probe.model=node;
    airframes.set(flight,probe);
  }
  if(probe.hub&&probe.point){
    probe.hub.getWorldPosition(probe.point);
    if(probe.rear)probe.point.lerp(probe.rear.getWorldPosition(probe.rearPoint),.5);
    probe.x=probe.point.x;probe.y=probe.point.y;probe.z=probe.point.z;
  }else{
    probe.x=flight.position.x;probe.y=flight.position.y+spec.diameter*.28;probe.z=flight.position.z;
  }
  return probe;
}

export function sampleRotorWash(city,flight,out={}){
  const state=flight.state,spec=aircraft.get(state.id);
  if(!spec||state.onFoot||state.destroyed||state.paused||state.rpm<=.22)return null;
  const radius=spec.diameter/2;
  if(state.altitudeAGL>radius*4.3)return null;
  const p=hubProbe(flight,spec);
  const surface=rotorWashSurface(city,p.x,p.z,p.y,p.surface);
  if(!surface)return null;
  const height=Math.max(0,p.y-surface.y);
  const reach=4.3*radius;
  if(height>=reach)return null;
  const diskArea=Math.PI*radius*radius*(spec.tail==='SecondMainRotor'?2:1);
  const perf=state.rotorPerformance;
  const thrust=perf?.thrustNewtons??(spec.emptyKg+80)*9.80665*state.rpm**2;
  // Rotor momentum theory gives induced velocity at the disk. The ground
  // jet loses speed with standoff distance and as the rotor winds down.
  const induced=Math.sqrt(Math.max(0,thrust)/(2*1.225*diskArea));
  const standoff=1-smooth(clamp((height/radius-.6)/3.7,0,1));
  const outflow=1.65*induced*standoff;
  const jetStrength=clamp((1.65*induced-1.1)/12,0,1)*standoff*smooth(clamp((state.rpm-.22)/.48,0,1));
  if(jetStrength<.015)return null;
  p.sensor.x=p.x;p.sensor.y=surface.y+1;p.sensor.z=p.z;
  const wind=flight.sampleWeather?.(p.sensor,1,p.wind)??state.weather;
  const rain=clamp(wind?.rain??0,0,1);
  out.kind=rotorWashKind(surface,rain);out.openWater=surface.kind==='spray';out.surfaceYield=surface.yield;
  out.x=p.x;out.y=surface.y;out.z=p.z;out.hubY=p.y;out.radius=radius;
  out.jetStrength=jetStrength;out.strength=jetStrength*rotorWashYield(surface,rain);
  out.outflow=outflow;out.windX=wind?.windX??0;out.windZ=wind?.windZ??0;out.rain=rain;
  // Retain a dry/wet boundary source even with a wet/turf center. Its ring
  // can straddle open water or hardstand; individual births sample locally.
  return out;
}
