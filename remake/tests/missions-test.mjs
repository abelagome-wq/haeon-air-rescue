// node remake/tests/missions-test.mjs, from any working directory (Node 24+).
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs/promises';
const vendor = new URL('../vendor/three/', import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: new URL('three.module.min.js', vendor).href, shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: new URL(specifier.slice(6), vendor).href, shortCircuit: true };
    return nextResolve(specifier, context);
} });
globalThis.self = globalThis;
const defaultFetch=globalThis.fetch;
globalThis.fetch=async (input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.protocol!=='file:')return defaultFetch(input,init);
    const bytes=await fs.readFile(url);
    return new Response(bytes,{headers:{'Content-Type':'image/png','Content-Length':String(bytes.length)}});
};
globalThis.createImageBitmap = async blob => {
    const bytes=Buffer.from(await blob.arrayBuffer());
    assert.equal(bytes.toString('ascii',1,4),'PNG');
    return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),close(){}};
};
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, values); } };
const T = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { createMissions } = await import('../src/missions.js');
const { PILOT_SEATS } = await import('../src/pilot.js');
const { HELICOPTERS,createFlight } = await import('../src/flight.js');
const { createCitySampler } = await import('../src/city.js');
const cache = new Map(), loader = new GLTFLoader();
const assets = { load(path) {
    if (!cache.has(path)) {
        cache.set(path, (async () => {
            const url=new URL('../../'+path,import.meta.url),data=await fs.readFile(url);
            const gltf=await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),new URL('./',url).href);
            gltf.scene.animations = gltf.animations;
            return gltf.scene;
        })());
    }
    return cache.get(path);
} };
const specimen = {
    spawn: { x: 24, y: 0, z: 24 }, landmarks: [
        { kind: 'hospital', code:209, x:152,z:136 }, { kind:'fire',code:211,x:40,z:136 },
        { kind:'police',code:210,x:88,z:104 }, { kind:'port',x:456,z:136 },
    ],
    tileToWorld: (col, row) => ({ x: 8 + 16 * col, z: 8 + 16 * row }),
    tileAt(x, z) {
        const water = x > 350 && x < 590 && z < 330;
        return { water, waterY: water ? 0 : null, building: 0, road: !water };
    },
    surfaceAt: () => 0, groundAt: () => 0, roofAt: () => -Infinity, buildingAt: () => null, placements: [],
    roads: Array.from({ length: 12 }, (_, i) => ({ col: i + 1, row: 7, x: 24 + i * 16, z: 120, y: 0,
        neighbors: [i > 0 ? 7 * 128 + i : null, i < 11 ? 7 * 128 + i + 2 : null].filter(Number.isFinite) })),
};
// A genuine three-way road is required for the traffic-jam call.
specimen.roads[5].neighbors.push(8*128+6);
specimen.roads.push({col:6,row:8,x:104,z:136,y:0,neighbors:[7*128+6]});
const scene = new T.Scene(), camera = new T.PerspectiveCamera(), position = new T.Vector3(0, 0, 0);
const flight = { object: new T.Group(), position, state: { id: 'JETRANG', grounded: true, speed: 0, position } };
const sim = await createMissions({ THREE: T, scene, camera, assets }, specimen, flight, {selection:'traffic/gridlock'});
const tick = seconds => { for (let i = 0; i < Math.ceil(seconds * 20); i++) sim.update(.05); };
const atGoal = dy => { const p = sim.state.target; position.set(p.x, p.y + dy, p.z); camera.position.copy(position); };
try {
    assert.equal(sim.state.type, 'traffic');assert.equal(sim.act('traffic'),false);
    const police=sim.state.serviceUnits.find(u=>u.kind==='police');
    assert.equal(police.status,'station');
    atGoal(9);tick(.05);assert.equal(sim.act('police'),true);
    assert.equal(police.destination,'at-scene');
    for(let i=0;i<300 && sim.state.phase!=='complete';i++){sim.act('traffic');tick(.1);}
    assert.equal(sim.state.completed,1);assert.equal(sim.state.history[0].outcome,'success');
    // Awaiting the same barrier also covers jobs enqueued by earlier jobs.
    const barrier = sim.ready;
    const completion = await barrier;
    assert.equal(sim.ready, barrier); assert.deepEqual(completion, { status: 'ready', errors: [] });
    let loaded = 0, proxies = 0;
    scene.traverse(o => {
        if (!o.name.startsWith('models/')) return;
        if (o.children.some(c => c.isGroup)) loaded++;
        if (o.children.some(c => (c.isMesh || c.isPoints) && c.geometry.attributes.color)) proxies++;
    });
    assert.deepEqual(sim.state.assetErrors, []); assert.ok(loaded >= 15); assert.ok(proxies >= 13);
    const cockpit = flight.object.getObjectByName('Seated City-Pilot');
    assert.ok(cockpit && cockpit.isMesh && !cockpit.isSkinnedMesh && !Array.isArray(cockpit.material));
    assert.equal(cockpit.geometry.index.count / 3, 8135);
    const seatBounds = cockpit.geometry.boundingBox;
    assert.ok(seatBounds.min.y < -.13 && seatBounds.min.y > -.29 && seatBounds.max.y > .8 && seatBounds.min.z > -.38 && seatBounds.max.z > .45);
    console.log('Baked seated pilot local extents:', seatBounds.min.toArray(), seatBounds.max.toArray());
    for (const spec of HELICOPTERS) {
        const airframe = await assets.load(spec.path);
        airframe.updateMatrixWorld(true);
        const [x, y, z, scale] = PILOT_SEATS[spec.id];
        const seats = [], hull = [];
        airframe.traverse(o => {
            if (!o.isMesh) return;
            o.material.side = T.DoubleSide;  // Independent headless templates only.
            if (/upholstery|seat insert|seat cushion|^Seat$/i.test(o.material.name)) seats.push(o);
            if (!/rotor|blade|mast/i.test(o.name + ' ' + o.parent.name + ' ' + o.material.name)) hull.push(o);
        });
        const down = new T.Raycaster(new T.Vector3(x, y + .10, z), new T.Vector3(0, -1, 0), 0, .30);
        const seatHit = down.intersectObjects(seats, false)[0];
        assert.ok(seatHit && Math.abs(seatHit.point.y - y) < .038, spec.id + ' does not meet its seat cushion');
        const up = new T.Raycaster(new T.Vector3(x, y + .54, z), new T.Vector3(0, 1, 0), 0, 2.8);
        const ceiling = up.intersectObjects(hull, false)[0];
        const helmet = y + seatBounds.max.y * scale;
        const clearance = ceiling ? ceiling.point.y - helmet : null;
        console.log(spec.id, 'seat gap', (seatHit.point.y - y).toFixed(3), 'm, overhead shell clearance', clearance?.toFixed(3), 'm');
        assert.ok(clearance == null || clearance > -.015, spec.id + ' helmet intersects overhead shell');
        flight.state.id = spec.id; sim.update(0); assert.deepEqual(cockpit.position.toArray(), [x, y, z]);
    }
    const car = scene.getObjectByName('models/traffic/lod1/AUTO-LOD1.glb');
    const originalCar = await assets.load('models/traffic/lod1/AUTO-LOD1.glb');
    const glazing = root => { const panes = []; root.traverse(o => { if (o.isMesh && o.material.name === 'glass') panes.push(o.material); }); return panes; };
    assert.ok(glazing(originalCar).some(m => m.transmission > .7));
    assert.ok(glazing(car).length && glazing(car).every(m => m.transmission === 0 && m.forceSinglePass && Math.abs(m.opacity - .36) < .001));
    for (const vehicle of ['Fire-Engine', 'Ambulance', 'Police-Cruiser']) {
        const o = scene.getObjectByName(`models/world/vehicles/${vehicle}.glb`);
        assert.ok(o && glazing(o).length && glazing(o).every(m => m.transmission === 0 && m.forceSinglePass));
        assert.ok(o.children.some(c => c.isMesh && c.geometry.attributes.color));
    }
    const before = car.position.clone(); tick(2); assert.ok(before.distanceTo(car.position) > 1);
    const walker = scene.getObjectByName('models/complete/actors/SUIT/SUIT-LOD1.glb');
    camera.position.copy(walker.position).add(new T.Vector3(0, 3, 9)); camera.lookAt(walker.position);
    const bones = []; walker.traverse(o => { if (o.isBone) bones.push(o); });
    assert.equal(bones.length, 60);
    const old = bones.map(o => [...o.position.toArray(), ...o.quaternion.toArray()]);
    tick(.25);
    assert.ok(bones.some((b, i) => [...b.position.toArray(), ...b.quaternion.toArray()]
        .some((v, j) => Math.abs(v - old[i][j]) > .002)));
    const sailing = scene.getObjectByName('models/traffic/lod1/Harbor-Sailboat-LOD1.glb');
    const previousWater = sailing.position.clone(); tick(1); assert.ok(previousWater.distanceTo(sailing.position) > .8);
    assert.equal(specimen.tileAt(sailing.position.x, sailing.position.z).water, true);
    assert.ok(sim.state.activePeople >= 5 && sim.state.activeCars === 8 && sim.state.activeBoats === 1);
    camera.position.set(120, 180, 120); camera.lookAt(car.position); tick(.05);
    assert.ok(sim.state.visibleActorDraws <= 15 && sim.state.activeSkeletons === 0);
    const farCar=car.children.find(c=>c.isMesh&&c.visible&&c.name==='Traffic exterior · single draw');
    assert.ok(farCar&&farCar.geometry.index.count/3<1600,'far coachwork must stay within its one-draw budget');
    const nearBounds=new T.Box3().setFromObject(car.children.find(c=>c.isGroup),true);
    const farBounds=new T.Box3().setFromObject(farCar,true);
    assert.ok(nearBounds.min.distanceTo(farBounds.min)<.16&&nearBounds.max.distanceTo(farBounds.max)<.16,'far car footprint must track the authored car');
    console.log('180 m traffic profile:', sim.state.visibleActorDraws, 'visible actor draws,', sim.state.activeSkeletons, 'animated characters.');
    console.log('PASS: real GLBs and all rigs loaded, traffic moving, safe hover checks, hoist retry, dispatch traffic, service arrival and award.');
} finally {
    sim.dispose(); assert.equal(scene.children.length, 0);
}
const stalled = await createMissions({ THREE: T, scene, camera, assets: { load: () => new Promise(() => {}) } }, specimen, flight, {selection:'traffic/gridlock'});
stalled.dispose();
assert.equal((await stalled.ready).status, 'disposed');
const failingPath = 'models/traffic/people/lod1/Hangar-Mechanic-LOD1.glb';
const warning = console.warn;
try {
    console.warn = () => {};
    const partial = await createMissions({ THREE: T, scene, camera, assets: {
        load: path => path === failingPath ? Promise.reject(new Error('deliberate unavailable GLB')) : assets.load(path),
    } }, specimen, flight, {selection:'traffic/gridlock'});
    const barrier = await partial.ready;
    assert.equal(barrier.status, 'ready'); assert.ok(barrier.errors.includes(failingPath)); partial.dispose();
} finally { console.warn = warning; }
console.log('PASS: stable warmup barrier, late proxies, partial failure and disposal during pending I/O.');

// The real Schweizer envelopes query the moving Sea Cliff GLB anchors.
// Control speed/pose at contact; all injury, stop timers and ledger entries
// are produced by the regular city update, without calling reportIncident.
const actualCity=createCitySampler(JSON.parse(await fs.readFile(new URL('../data/cities/sea-cliff.json',import.meta.url))));
const contactScene=new T.Scene(),contactCamera=new T.PerspectiveCamera();
const contactContext={THREE:T,scene:contactScene,camera:contactCamera,assets};
const aircraft=await createFlight(contactContext,actualCity,'SCWZR300',{startOnFoot:false,renderPilot:false});
const living=await createMissions(contactContext,actualCity,aircraft,{selection:'transport/vip'});
try{
    await living.ready;
    const advance=n=>{for(let i=0;i<n;i++)living.update(.05);};
    const journalAt=key=>(living.state.journal??[]).filter(row=>row.key===key).map(row=>[row.cash,row.points]);
    const walker=contactScene.getObjectByName('models/complete/actors/SUIT/SUIT-LOD1.glb');
    const car=contactScene.getObjectByName('models/traffic/lod1/AUTO-LOD1.glb');
    assert.ok(walker&&car,'actual Sea Cliff cast must contain a pedestrian and a road car');
    advance(3);
    const start=car.position.clone();
    advance(8);
    assert.ok(car.position.distanceTo(start)>.3,'select a car with a live driving route');
    aircraft.state.grounded=true;
    aircraft.state.rpm=0;
    aircraft.state.speed=0;
    aircraft.position.copy(walker.position);
    const probe=walker.position.clone();probe.y+=1.20;
    const safe=aircraft.contactAt(probe,.35);
    assert.ok(safe&&!safe.dangerous,'stationary contact with the actual fuselage must be safe');
    advance(6);
    assert.deepEqual(journalAt('civilianHarmed'),[]);
    assert.deepEqual(journalAt('trafficObstructed'),[]);
    aircraft.state.speed=4;
    assert.ok(aircraft.contactAt(probe,.35)?.dangerous);
    advance(2);
    assert.deepEqual(journalAt('civilianHarmed'),[[-300,-100]]);
    assert.ok(walker.rotation.z>.9,'the same visible pedestrian is injured');
    advance(20);
    aircraft.position.copy(actualCity.spawn);
    advance(2);
    aircraft.position.copy(walker.position);
    advance(6);
    assert.deepEqual(journalAt('civilianHarmed'),[[-300,-100]],'a hurt citizen cannot be fined again on a later frame or contact');
    aircraft.state.speed=0;
    aircraft.position.copy(car.position);
    const stoppedAt=car.position.clone();
    advance(58);
    assert.deepEqual(journalAt('trafficObstructed'),[],'an obstruction shorter than three seconds has no fine');
    assert.ok(car.position.distanceTo(stoppedAt)<.001,'the actual moving car was physically held');
    advance(4);
    assert.deepEqual(journalAt('trafficObstructed'),[[-50,-50]]);
    advance(70);
    assert.deepEqual(journalAt('trafficObstructed'),[[-50,-50]],'one continuous obstruction produces one fine');
    assert.deepEqual(journalAt('civilianHarmed'),[[-300,-100]]);
    console.log('PASS: real Sea Cliff Schweizer contact: stationary bystander safe, single civilian harm –300/–100, single 3 s road obstruction –50/–50.');
}finally{
    living.dispose();aircraft.dispose();
    assert.equal(contactScene.children.length,0);
}
