import assert from 'node:assert/strict';
import * as T from '../vendor/three/three.module.min.js';
import {generateCity} from '../src/generated-city.js';
import {createCitySampler} from '../src/city.js';
import {buildBridgeGeometry} from '../src/bridge-architecture.js';
import {bridgeLevel,planBridgeSpans,addBridgeSpans} from '../src/bridge-spans.js';
import {createFlightScenery} from '../src/flight-scenery.js';
import {createFlightCollision} from '../src/flight-collision.js';

const designs=new Set(),seeds=[0,42,417,13759],tol=.00015;
for(const size of ['small','medium','large'])for(const seed of seeds){
    const city=createCitySampler(generateCity(size,seed)),spans=planBridgeSpans(city);
    const tiles=spans.flatMap(s=>s.tiles);
    assert.deepEqual(new Set(tiles),new Set(Array.from(city.layers.building).flatMap((code,i)=>bridgeLevel(code)?[i]:[])));
    assert.equal(tiles.length,new Set(tiles).size);
    for(const s of spans){
        const step=s.axis==='x'?1:128;
        s.tiles.forEach((id,i)=>{
            if(i)assert.equal(id-s.tiles[i-1],step);
            const p=city.tileToWorld(id%128,id>>7);
            assert.ok(Math.abs(s.yAt(16*i+8-s.length/2)-city.roadHeightAt(p.x,p.z,s.level))<tol);
        });
        designs.add(s.style);
    }
    if(size==='large'&&seed===42){
        assert.deepEqual(new Set(spans.map(s=>s.style)),new Set(['girder','arch','truss','cable']));
        assert.deepEqual(planBridgeSpans(city).map(s=>s.style),spans.map(s=>s.style));
    }
}
assert.equal(designs.size,4);
assert.equal(bridgeLevel(89),null);assert.equal(bridgeLevel(92),null);

const city=createCitySampler(generateCity('large',42)),group=new T.Group(),owned=[];
city.flightScenery=createFlightScenery(T);addBridgeSpans(T,city,group,owned,buildBridgeGeometry);
group.updateMatrixWorld(true);
const airspace=createFlightCollision(T,city,group);
let clearRays=0,deckRays=0;
for(const s of city.bridgeSpans){
    // Below the longitudinal midpoint there must be navigable openings
    // between piers. The deck, tie, rails and any transverse beams above are
    // all sampled from the rendered mesh at the actual world transformation.
    for(let x=-s.length/2+6.137;x<s.length/2-5;x+=2.731)for(const side of [-1.31,1.31]){
        const v=new T.Vector3(x,0,side).applyMatrix4(s.matrix);
        const ray=new T.Raycaster(new T.Vector3(v.x,s.yAt(x,side)+30,v.z),new T.Vector3(0,-1,0));
        const visible=ray.intersectObject(s.mesh)[0];
        assert.ok(visible);
        const floor=city.flightScenery.floorAt(v.x,v.z,Infinity);
        assert.ok(Math.abs(floor-visible.point.y)<tol,s.style+' at '+[x,side]+': '+floor+' vs '+visible.point.y);
        deckRays++;
        if(!Number.isFinite(city.flightScenery.floorAt(v.x,v.z,s.yAt(x,side)-2.5)))clearRays++;
    }
    assert.ok(city.flightScenery.floorAt(s.x,s.z,Infinity)>s.bedAt(0));
    const along=-s.length/2+11.3,below=s.yAt(along)-3.4;
    const a=new T.Vector3(along,below,-12).applyMatrix4(s.matrix),b=new T.Vector3(along,below,12).applyMatrix4(s.matrix);
    assert.equal(airspace.cameraRange(a,b),1,s.style+' transverse passage under the bridge');
    const above=new T.Vector3(along,s.yAt(along)+1,0).applyMatrix4(s.matrix);
    const under=above.clone();under.y=below;
    assert.ok(airspace.cameraRange(above,under)<.5,s.style+' deck obstructs a descending camera');
    assert.ok(airspace.floorAt(under.x,under.z,under.y)<under.y,s.style+' does not lift an aircraft under the deck onto the road');
}
assert.ok(clearRays>deckRays*.65);
for(const item of owned)item.dispose();

// An open leaf splits the continuous neighbouring highway/road steel. It is
// not covered by a replacement deck or closed over by a render LOD.
const saved=generateCity('large',42),layout=Uint8Array.from(Buffer.from(saved.layers.building,'base64'));
const original=city.bridgeSpans[0],middle=Math.floor(original.tiles.length/2),leaf=original.tiles[middle];
layout[leaf]=89;saved.layers.building=layout;
const opened=planBridgeSpans(createCitySampler(saved));
assert.ok(!opened.some(s=>s.tiles.includes(leaf)));
const ends=opened.filter(s=>s.tiles.includes(original.tiles[0])||s.tiles.includes(original.tiles.at(-1)));
assert.equal(ends.length,2);assert.equal(ends.reduce((n,s)=>n+s.length,0),original.length-16);
console.log('Four styles in 12 generated maps, split drawbridge;',deckRays,'matched ray tests and',clearRays,'clear under-deck positions.');
