import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {stat} from 'node:fs/promises';
const vendor = new URL('../vendor/three/', import.meta.url);
registerHooks({resolve(id, ctx, next) {
    if (id === 'three') return {url:new URL('three.module.min.js',vendor).href,shortCircuit:true};
    if (id.startsWith('three/addons/')) return {url:new URL(id.slice(6),vendor).href,shortCircuit:true};
    return next(id,ctx);
}});
const T = await import('three');
const {createDispatch} = await import('../src/dispatch.js');
const {createCitySampler} = await import('../src/city.js');
const {generateCity} = await import('../src/generated-city.js');
const {planDispatchSites} = await import('../src/missions.js');
const {originalTransmission} = await import('../src/original-radio.js');
const city = createCitySampler(generateCity('small', 42)), sites = planDispatchSites(city);

function run(selection, hook, sample) {
    const object = new T.Group(), scene = new T.Group(), state = {assetErrors:[]}, radio = [];
    object.position.copy(city.spawn);
    const flight = {object,position:object.position,state:{id:'SCHWEIZR',altitudeAGL:16,heading:0,speed:0,rpm:1}};
    const api = createDispatch({ctx:{THREE:T,camera:new T.PerspectiveCamera(),assets:{load:async()=>new T.Group()}},
        parent:scene, city, sites, flight, selection, worldState:state, rng:()=>sample, loadout:{hook},
        onRadio:e=>radio.push(e), send:()=>false, arrived:()=>false, release:()=>false, notice:()=>{}, prepare:m=>m});
    api.update(0);
    const press = () => { const result = api.beginHook(); api.endHook(); return result; };
    function move(p, height) {
        object.position.set(p.x, p.y+height, p.z);
        flight.state.altitudeAGL = height;
        api.update(.1);
    }
    function lower() {
        assert.ok(api.toggleHookCable());
        for(let i=0; i<48; i++) api.update(.1);
    }
    return {api, state, scene, radio, flight, move, press, lower};
}

for (const equipped of [false,true]) {
    const {api,state} = run('auto',equipped,.9999);
    assert.equal(state.calls.some(c=>c.type==='cargo'),equipped);
    api.dispose();
}
const disabled = run('cargo/container',false,.1);
assert.equal(disabled.state.calls.length,0);
disabled.api.dispose();

const origins = new Set();
for (const sample of [.01,.33,.66,.99]) {
    const {api,state,scene,radio,flight,move,press,lower} = run('cargo/container',true,sample);
    assert.equal(state.phase,'pickup');
    const pickup = state.target.clone();
    origins.add(pickup.x+'/'+pickup.z);
    move(pickup,12); lower();
    assert.ok(press()); assert.equal(state.phase,'deliver');
    const drop = state.target;
    assert.ok(Math.hypot(drop.x-pickup.x,drop.z-pickup.z)>=144);
    move(pickup,32);
    assert.equal(state.hook.externalLoadKg,160);
    assert.equal(press(),false,'airborne release');
    flight.state.destroyed=true; api.update(.1); flight.state.destroyed=false; api.update(.1);
    assert.equal(state.phase,'pickup'); assert.deepEqual(state.target,pickup);
    move(pickup,12); lower(); assert.ok(press());
    assert.ok(press(),'set down back at origin');
    assert.equal(state.phase,'pickup'); assert.equal(state.history.length,0);
    assert.ok(press(),'wrong depot still allows pickup');
    move(pickup,32); move(drop,32); move(drop,12);
    assert.ok(state.hook.grounded);
    assert.ok(press(),'grounded inside destination pad');
    assert.equal(state.phase,'complete');
    assert.equal(state.cash,180+Math.round(.15*Math.hypot(drop.x-pickup.x,drop.z-pickup.z)));
    assert.equal(state.score,60); assert.equal(api.getAdjustments(0).length,1);
    assert.equal(state.history[0].outcome,'success');
    assert.equal(scene.getObjectByName('Corrugated cargo container').position.distanceTo(new T.Vector3(drop.x,drop.y,drop.z))<1,true);
    assert.equal(press(),false,'delivered cargo is visible and retired');
    assert.equal(radio.filter(e=>e.type==='cargo'&&e.kind==='complete').length,1);
    assert.equal(state.history.length,1);
    const previousContainer = scene.getObjectByName('Corrugated cargo container');
    api.update(4.1);
    assert.equal(previousContainer.parent,null);
    assert.equal(state.phase,'pickup','practice restarts');
    api.dispose(); assert.equal(scene.children.length,0);
}
assert.ok(origins.size>=3,'pickup locations vary with city dispatch RNG');
{
    const {api,state,scene,move,press,lower} = run('cargo/container',true,.5);
    move(state.target,12); lower(); assert.ok(press()); move(state.target,35);
    assert.equal(state.hook.externalLoadKg,160);
    api.update(601);
    assert.equal(state.hook.attached,false);
    assert.equal(state.cash,0);
    assert.equal(state.history[0].outcome,'failed');
    assert.equal(scene.getObjectByName('Corrugated cargo container'),undefined);
    api.dispose();
}
for (const kind of ['dispatch','complete']) {
    const {ids,text} = originalTransmission({kind,type:'cargo',variant:'container',sector:'북동'});
    assert.match(text,/컨테이너/);
    for(const id of ids) assert.ok((await stat(new URL('../art/audio/synth/'+id+'.mp3',import.meta.url))).size>1000);
}
console.log('Cargo dispatch passed: equipment gating, automatic calls, random routes, reset, wrong-site recovery, load mass, safe release, timeout and one-time reward.');
