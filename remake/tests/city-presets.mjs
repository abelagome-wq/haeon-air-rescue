import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import * as T from '../vendor/three/three.module.min.js';
import {generateCity} from '../src/generated-city.js';
import {cityPresets,planCityPreset} from '../src/city-presets.js';
import {buildPresetMesh} from '../src/preset-mesh.js';
import {createFlightScenery} from '../src/flight-scenery.js';

const vendor=new URL('../vendor/three/',import.meta.url);
registerHooks({resolve(id,ctx,next){
    if(id==='three')return {url:new URL('three.module.min.js',vendor).href,shortCircuit:true};
    if(id.startsWith('three/addons/'))return {url:new URL(id.slice(6),vendor).href,shortCircuit:true};
    return next(id,ctx);
}});
const {createCitySampler}=await import('../src/city.js');
const seen=new Map(),signatures=new Set();
for(const size of ['small','medium','large']){
    for(const seed of [42,417,7001]){
        const city=createCitySampler(generateCity(size,seed));
        const lots=city.placements.filter(p=>p.preset),names=new Set(lots.map(p=>p.preset.name));
        assert.ok(names.size>=10,size+' district variety');
        for(const p of lots){
            const {name,key,w,d,h}=p.preset;
            if(seen.has(key))continue;
            const geometry=buildPresetMesh(T,cityPresets[name],w,d,h),bounds=geometry.boundingBox;
            const eps=.012;
            assert.ok(bounds.min.y>=-eps&&Math.abs(bounds.max.y-h)<eps,name+' height');
            assert.ok(bounds.min.x>=-w/2-eps&&bounds.max.x<=w/2+eps&&bounds.min.z>=-d/2-eps&&bounds.max.z<=d/2+eps,name+' setback');
            assert.ok(geometry.index.count/3<1100,name+' uses bounded geometry');
            assert.ok(new Set(geometry.attributes.urbanKind.array).size>=3,name+' finishes');
            seen.set(key,name);geometry.dispose();
        }
        const signature=lots.map(p=>p.preset.key+'@'+p.preset.turn).join(',');
        assert.ok(!signatures.has(signature));signatures.add(signature);
        if(seed===42)console.log(size,seed,lots.length,'lots;',names.size,'designs');
    }
}
assert.deepEqual(new Set(seen.values()),new Set(Object.keys(cityPresets)));
// A single street edge unambiguously sets the entrance, regardless of the seed.
const lot={col:8,row:6,w:2,h:2,code:157};
for(const [edge,tile] of [[0,5*128+8],[1,6*128+10],[2,8*128+9],[3,7*128+7]]){
    const streets=new Set([tile]);
    assert.equal(planCityPreset(lot,4,123,streets,40).turn,edge);
    assert.deepEqual(planCityPreset(lot,4,123,streets,40),planCityPreset(lot,4,123,streets,40));
}
assert.equal(planCityPreset({...lot,code:209},4,123,new Set(),40),null);
// A hollow shop court and stepped skybridge are useful regression fixtures:
// a hidden legacy box would falsely fill both empty spaces.
for(const name of ['courtyard-parade','bridge-house']){
    const geometry=buildPresetMesh(T,cityPresets[name],32,31,name==='bridge-house'?55:12);
    const world=createFlightScenery(T),matrix=new T.Matrix4().makeRotationY(Math.PI/2);
    matrix.setPosition(64,7,112);world.add(geometry,matrix,'building',lot);
    const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.matrixAutoUpdate=false;mesh.matrixWorld.copy(matrix);
    let samples=0;const heights=new Set();
    for(let x=50;x<79;x+=2)for(let z=97;z<127;z+=2){
        const ray=new T.Raycaster(new T.Vector3(x,100,z),new T.Vector3(0,-1,0));
        const first=ray.intersectObject(mesh)[0]?.point.y??-Infinity,value=world.floorAt(x,z,100);
        assert.ok(first===value||Math.abs(first-value)<1e-5,name+' ray mismatch');
        if(Number.isFinite(value)){heights.add(Math.round(value));samples++;}
    }
    assert.ok(samples>45&&heights.size>=3,name+' stepped/open roofs');
    if(name==='bridge-house'){
        // A closed glass block would pass the downward roof checks. Shoot at
        // eye height along the gallery from inside one lobby to the other.
        const axis=new T.Vector3(1,0,0).transformDirection(matrix);
        const origin=new T.Vector3(-6.05,32.6,1.08).applyMatrix4(matrix);
        assert.equal(new T.Raycaster(origin,axis,0,12.10).intersectObject(mesh).length,0,'tower doorways connect through the gallery');
        const across=new T.Vector3(0,0,1).transformDirection(matrix);
        let clear=0;
        for(let x=-4.3;x<=4.3;x+=.25){
            origin.set(x,32.6,-3).applyMatrix4(matrix);
            if(!new T.Raycaster(origin,across,0,9).intersectObject(mesh).length)clear++;
        }
        assert.ok(clear>=21,'open viewing strip between the glazed railing and clerestory');
    }
    mesh.material.dispose();geometry.dispose();
}
console.log('Verified',new Set(seen.values()).size,'building designs and',seen.size,'sized meshes.');
