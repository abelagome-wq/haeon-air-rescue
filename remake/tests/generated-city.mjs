import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {CITY_SIZES,generatedCityId,parseGeneratedCityId,generateCity} from '../src/generated-city.js';

const vendor=new URL('../vendor/three/',import.meta.url);
registerHooks({resolve(id,context,next){
  if(id==='three')return {url:new URL('three.module.min.js',vendor).href,shortCircuit:true};
  if(id.startsWith('three/addons/'))return {url:new URL(id.slice(6),vendor).href,shortCircuit:true};
  return next(id,context);
}});
const {createCitySampler}=await import('../src/city.js');
const {planDispatchSites,responseRoute}=await import('../src/missions.js');
const {planHomeBase}=await import('../src/home-base.js');
const {hasTrainRoute}=await import('../src/transit.js');
function checkMap(size,seed){
  const raw=generateCity(size,seed),city=createCitySampler(raw),n=CITY_SIZES[size].tiles;
  const check=(v,message)=>assert.ok(v,raw.id+' '+message);
  assert.deepEqual(parseGeneratedCityId(raw.id),{size,seed});
  assert.equal(raw.playBounds.maxX-raw.playBounds.minX,n*16);
  const inBounds=p=>p.x>=raw.playBounds.minX&&p.x<raw.playBounds.maxX&&p.z>=raw.playBounds.minZ&&p.z<raw.playBounds.maxZ;
  const sites=planDispatchSites(city);
  for(const p of [city.spawn,...city.roads,...city.placements,...city.ships])check(inBounds(p),'outside active territory');
  const seen=new Set(),queue=[city.roads[0].id],graph=new Map(city.roads.map(p=>[p.id,p]));
  seen.add(queue[0]);
  for(let j=0;j<queue.length;j++)for(const next of graph.get(queue[j]).neighbors){
    check(graph.get(next).neighbors.includes(queue[j]),'nonreciprocal road');
    if(!seen.has(next)){seen.add(next);queue.push(next);}
  }
  assert.equal(seen.size,city.roads.length,'isolated road(s) in '+raw.id);
  check(city.roads.some(p=>p.neighbors.length===4),'missing traffic junction');
  check(city.roads.some(p=>p.code===83&&city.tileAt(p.x,p.z).water),'missing working bridge');
  for(const p of city.roads.filter(p=>city.tileAt(p.x,p.z).water)){
    check(p.code===83&&Number.isFinite(p.y)&&p.y>city.tileAt(p.x,p.z).waterY,'road under tidal water');
  }
  check(hasTrainRoute(city),'no usable railway for train rescue');
  check(city.placements.filter(p=>p.code===221).length>=5,'no airstrip');
  check(city.ships.length&&city.tileAt(city.ships[0].x,city.ships[0].z).water,'dry freighter');
  check(city.landmarks.some(p=>p.kind==='port'),'no waterfront terminal');
  const home=planHomeBase(city);
  check(home.kind==='original'&&home.route.length>=2,'no walkable route from pad to actual hangar');
  check(sites.stations.length===3,'lost a road-connected emergency station');
  for(const s of sites.stations){
    check(s.lot.w===3&&s.lot.h===3,'incorrect emergency lot footprint');
    check(!city.tileAt(s.park.x,s.park.z).water,'flooded station parking');
    const destination=sites.stations.find(p=>p!==s).park;
    check(responseRoute(sites.roads,s.park,destination,1)?.length,'emergency vehicles cannot reach another station');
  }
  for(const key of ['pickup','hospitals','medical','fire','riot','rescueWater','harbor']){
    check(sites[key]?.length,'no '+key+' sites');
    check(sites[key].every(inBounds),key+' outside active territory');
  }
  for(const p of [...sites.pickup,...sites.medical])for(const dx of [-7,0,7])for(const dz of [-7,0,7]){
    const x=p.x+dx,z=p.z+dz,t=city.tileAt(x,z);
    check(t&&!t.rail&&!t.water&&!city.buildingAt(x,z)&&Math.abs(city.surfaceAt(x,z)-p.y)<.65,'obstructed landing site');
  }
  return {lots:city.placements.length,roads:city.roads.length};
}
assert.equal(parseGeneratedCityId('sea-cliff'),null);
assert.equal(parseGeneratedCityId('proc-small-1'),null);
assert.throws(()=>generatedCityId('unknown',4),RangeError);
assert.throws(()=>generatedCityId('small',-1),RangeError);
const previous=new Map(),observed={};
for(const size of Object.keys(CITY_SIZES)){
  let lots=0,roads=0;
  for(const seed of [0,1,5,31,4172,73992,0x853912fe,0xffffffff]){
    const result=checkMap(size,seed);lots+=result.lots;roads+=result.roads;
    const prev=previous.get(seed);
    if(prev){assert.ok(result.roads>prev.roads);assert.ok(result.lots>prev.lots);}
    previous.set(seed,result);
  }
  const a=generateCity(size,43),b=generateCity(size,44);
  assert.deepEqual(a,generateCity(size,43));
  for(const key of ['height','terrain','building','zone'])assert.notEqual(a.layers[key],b.layers[key],key+' repeated across seeds');
  observed[size]={meanLots:Math.round(lots/8),meanRoadTiles:Math.round(roads/8)};
}
console.log('24 deterministic cities have connected streets, service routes, safe boarding, rail/runway and water missions.',observed);
