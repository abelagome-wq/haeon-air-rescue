import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const vendor=new URL('../vendor/three/',import.meta.url);
registerHooks({resolve(id,ctx,next){
  if(id==='three')return {url:new URL('three.module.min.js',vendor).href,shortCircuit:true};
  if(id.startsWith('three/addons/'))return {url:new URL(id.slice(6),vendor).href,shortCircuit:true};
  return next(id,ctx);
}});
const {generateCity}=await import('../src/generated-city.js');
const {createCitySampler}=await import('../src/city.js');
const {planDispatchSites,responseRoute}=await import('../src/missions.js');
const {hasTrainRoute}=await import('../src/transit.js');
const {generatedWaterMains}=await import('../src/city-utilities.js');
const {mapWindow,drawMapRaster}=await import('../src/map-window.js');
const {planHomeBase}=await import('../src/home-base.js');
for(const size of ['small','medium','large']){
  for(const seed of [0,42,31337,0xffffffff]){
    const city=createCitySampler(generateCity(size,seed)),sites=planDispatchSites(city),b=city.bounds;
    assert.ok(city.generated);
    function inside(p){
      assert.ok(p&&p.x>=b.minX&&p.x<b.maxX&&p.z>=b.minZ&&p.z<b.maxZ,city.cityId+' '+JSON.stringify(p));
    }
    inside(city.spawn);inside(planHomeBase(city).door);
    assert.deepEqual(sites.stations.map(p=>p.kind).sort(),['fire','hospital','police']);
    assert.ok(sites.cargo.length>=2,city.cityId+' lacks freight depots');
    for(const list of [sites.roads.values(),sites.water.values(),sites.hospitals,sites.harbor,sites.medical,sites.pickup,sites.fire,sites.riot,sites.rescueWater,sites.cargo])
      for(const p of list)inside(p);
    for(const [kind,targets] of [['hospital',sites.medical],['fire',sites.fire],['police',sites.riot]]){
      assert.ok(targets.length>0,city.cityId+' '+kind);
      const station=sites.stations.find(s=>s.kind===kind);
      // The call is reachable from the service's actual station, and the route
      // stays on the same reciprocal generated streets as the drive geometry.
      for(const target of [targets[0],targets.at(-1)]){
        const route=responseRoute(sites.roads,station.park,target);
        assert.ok(route,city.cityId+' '+kind+' disconnected');
        let p=station.park;
        for(const id of route){assert.ok(p.neighbors.includes(id));p=sites.roads.get(id);inside(p);}
        assert.ok(Math.hypot(p.x-target.x,p.z-target.z)<=78.001);
      }
    }
    assert.ok(hasTrainRoute(city),city.cityId+' disconnected rail');
    const net=generatedWaterMains(city);
    for(const road of sites.street){
      const def=net.definitions[net.raw[road.tileId]];
      if(road.level!=='street')continue;
      const neighbors=road.neighbors.filter(id=>sites.roads.get(id)?.level==='street');
      assert.equal(def?.ports.length??0,neighbors.length);
    }
    const span=b.maxX-b.minX,view=mapWindow(city,city.spawn,span);
    assert.equal(view.x,b.minX);assert.equal(view.z,b.minZ);
    const close=mapWindow(city,{x:b.maxX,z:b.minZ},span/2);
    assert.equal(close.x+close.width,b.maxX);assert.equal(close.z,b.minZ);
    let args;city.minimap={width:512,height:512};
    drawMapRaster({drawImage(...v){args=v;}},city,view,640,640);
    assert.deepEqual(args.slice(1),[(1024+b.minX)/4,(1024+b.minZ)/4,span/4,span/4,0,0,640,640]);
  }
}
console.log('PASS 12 generated cities: bounds-clipped traffic and incident sites, service trips, rail, underground mains, cropped maps, walkable base');
