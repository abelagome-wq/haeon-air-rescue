import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { createPilot } from './pilot.js';
import { createDispatch } from './dispatch.js';
import { roadDrivingPoint,roadEdgeLength } from './road-path.js';
import { makeVehicleProxy } from './traffic-exterior.js';
import {neighborhoodSites} from './incident-sites.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const roadKey = p => p.id ?? p.row * 128 + p.col;
const sourceActor = name => `models/complete/actors/${name}/${name}-LOD1.glb`;
const person = name => `models/traffic/people/lod1/${name}-LOD1.glb`;
const vehicle = name => `models/traffic/lod1/${name}-LOD1.glb`;
const SERVICES = [
    ['hospital', 'Ambulance', 'CARAMBUL'],
    ['fire', 'Fire-Engine', 'CARFIRET'],
    ['police', 'Police-Cruiser', 'CARPOLIC'],
];

function dotProxy(T, template, commonMaterial, own) {
    template.updateMatrixWorld(true);
    const vertices = [], rgb = [], point = new T.Vector3();
    template.traverse(o => {
        if (!o.isPoints) return;
        const attr = o.geometry.getAttribute('position');
        for (let i = 0; i < attr.count; i++) {
            point.fromBufferAttribute(attr, i).applyMatrix4(o.matrixWorld);
            vertices.push(point.x, point.y, point.z);
            rgb.push(o.material.color.r, o.material.color.g, o.material.color.b);
        }
    });
    if (!vertices.length) throw new Error('The source actor distance mask contains no points');
    const geometry = own(new T.BufferGeometry());
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(rgb, 3));
    return new T.Points(geometry, commonMaterial);
}

function seedRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 4294967296;
    };
}

function nearby(points, at, accept = () => true) {
    let best = null, score = Infinity;
    for (const point of points) {
        if (!accept(point)) continue;
        const d = distance(point, at);
        if (d < score) { score = d; best = point; }
    }
    return best;
}

export function planDispatchSites(city) {
    const roads = new Map();
    const b=city.bounds;
    const playable=p=>!b||p.x>=b.minX&&p.x<b.maxX&&p.z>=b.minZ&&p.z<b.maxZ;
    const streetTiles=new Set(city.roads.filter(playable).map(roadKey));
    for (const road of city.roads) {
        if (!streetTiles.has(roadKey(road)))continue;
        const neighbors=road.neighbors.filter(id=>streetTiles.has(id));
        if(neighbors.length)roads.set(roadKey(road),neighbors.length===road.neighbors.length?road:
            {...road,neighbors,ports:road.ports.filter((_,i)=>streetTiles.has(road.neighbors[i]))});
    }
    const water = new Map();
    const land = [];
    for (let row = 0; row < 128; row++) {
        for (let col = 0; col < 128; col++) {
            const center = city.tileToWorld(col, row);
            if(!playable(center))continue;
            const tile = city.tileAt(center.x, center.z);
            if (!tile) continue;
            const p = { col, row, x: center.x, z: center.z, y: city.surfaceAt(center.x, center.z) };
            const structure = city.buildingAt?.(p.x, p.z);
            if (structure) continue;
            if (tile.water && tile.waterY != null && tile.building === 0 && p.y <= tile.waterY + .03) {
                p.y = tile.waterY;
                p.neighbors = [];
                water.set(roadKey(p), p);
            } else if (!tile.water && (tile.road || tile.building === 0 && !city.noLandingTiles?.has(row*128+col))) {
                land.push(p);
            }
        }
    }
    for (const [key, p] of water) {
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const col = p.col + dc, row = p.row + dr;
            const other = water.get(key + dr * 128 + dc);
            if (col >= 0 && col < 128 && row >= 0 && row < 128 && other && Math.abs(p.y - other.y) < .28) {
                p.neighbors.push(key + dr * 128 + dc);
            }
        }
    }
    // Open-water centers leave room for the hull and the rescue hoist.
    const rescueWater = [...water.values()].filter(p => {
        if (!p.neighbors.length) return false;
        // Also test the wreck's hull corners. A stream may be wet only along
        // a two-metre centerline within an otherwise dry 16-metre tile.
        return [[4,3], [2,0], [6,8], [1,5], [7,2]].every(([dx, dz]) => {
            const x = p.x + dx, z = p.z + dz, t = city.tileAt(x, z);
            return t?.water && t.building === 0 && Math.abs(t.waterY - p.y) < .05 && !city.buildingAt?.(x,z);
        });
    });
    const open = rescueWater.filter(p => p.neighbors.length === 4);
    const wet = open.length ? open : rescueWater;
    const landmarks = kind => city.landmarks.filter(l => l.kind === kind&&playable(l));
    const port = nearby(landmarks('port'), city.spawn);
    const waterStart = nearby(wet, city.spawn);
    const anchors = [waterStart, port, nearby(wet, { x: -city.spawn.x, z: -city.spawn.z })].filter(Boolean);
    const harbor = anchors.map(anchor => nearby(wet, anchor)).filter(Boolean);
    function hospitalStreet(center) {
        const qualifies = p => distance(p, center) < 105;
        const level = p => {
            if (!qualifies(p)) return false;
            const edges = [[-5, 0], [5, 0], [0, -5], [0, 5]];
            return edges.every(([dx, dz]) => Math.abs(city.surfaceAt(p.x + dx, p.z + dz) - p.y) < 2.8);
        };
        return nearby(land,center,level)||nearby(land,center,qualifies);
    }
    const hospitals = landmarks('hospital')
        .map(hospitalStreet).filter(Boolean);
    const street = [...roads.values()];
    const airport = { x: city.spawn.x, z: city.spawn.z, y: city.surfaceAt(city.spawn.x, city.spawn.z) };
    const stations = [], taken = new Set();
    for (const [kind, model, original] of SERVICES) {
        const lots = landmarks(kind).sort((a,b) => distance(a, city.spawn) - distance(b, city.spawn));
        for (const lot of lots) {
            const park = nearby(street, lot, p => {
                // An adjacent public street lies just beyond the real lot's edge.
                const dx = Math.max(0, Math.abs(p.x-lot.x) - (lot.w || 1) * 8);
                const dz = Math.max(0, Math.abs(p.z-lot.z) - (lot.h || 1) * 8);
                const t = city.tileAt(p.x,p.z);
                return Math.hypot(dx,dz) <= 23 && !taken.has(roadKey(p)) && !t.water && !city.buildingAt?.(p.x,p.z);
            });
            if (!park) continue;
            stations.push({ kind, model, original, lot, park }); taken.add(roadKey(park)); break;
        }
    }
    // Ground fire crews operate within 44m, while generic dispatch accepts a
    // road up to 78m away. Choose new calls inside the actual connected fire
    // station's reach, with room for lane offset, rather than sending a truck
    // to an "at-scene" position that can never extinguish the fire.
    const landByTile=new Map(land.map(p=>[p.row*128+p.col,p]));
    function serviceArea(kind,maxTravel=Infinity){
        const station=stations.find(s=>s.kind===kind);
        if(!station)return null;
        const nearestRoad=new Map();
        const queue=[roadKey(station.park)],travel=new Map([[queue[0],0]]);
        for(let i=0;i<queue.length;i++){
            const road=roads.get(queue[i]),length=travel.get(queue[i]);
            for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
                const col=road.col+dc,row=road.row+dr;if(col<0||col>=128||row<0||row>=128)continue;
                const key=row*128+col,p=landByTile.get(key);
                if(!p)continue;
                const gap=distance(p,road);
                if(gap<=40&&gap<(nearestRoad.get(key)?.gap??Infinity))
                    nearestRoad.set(key,{gap,length,level:Math.abs(p.y-road.y)<=12});
            }
            for(const id of road.neighbors)if(roads.has(id)&&!travel.has(id)){
                travel.set(id,length+roadEdgeLength(road,roads.get(id),1.65));queue.push(id);
            }
        }
        return new Set([...nearestRoad].filter(([,r])=>r.level&&r.length<=maxTravel).map(([key])=>key));
    }
    // The engine advances at 6 m/s. Leave time in the 190 s fire lifetime for
    // the crew to extinguish the original patch after the player orders help.
    const byEngine=serviceArea('fire',720),byAmbulance=serviceArea('hospital'),byPolice=serviceArea('police');
    const served=(p,area)=>!area||area.has(p.row*128+p.col);
    const offPad=p=>distance(city.spawn,p)>=48;
    const edges=[[-7,-7],[-7,0],[-7,7],[0,-7],[0,7],[7,-7],[7,0],[7,7]];
    const beside=[[-1,0],[1,0],[0,-1],[0,1]];
    const landings=land.filter(p=>!city.tileAt(p.x,p.z).rail&&offPad(p)&&edges.every(([dx,dz])=>{
        const x=p.x+dx,z=p.z+dz,t=city.tileAt(x,z);
        return t&&!t.water&&!t.rail&&!city.buildingAt?.(x,z)&&Math.abs(city.surfaceAt(x,z)-p.y)<.65;
    }));
    const nearRoad=p=>beside.some(([dc,dr])=>city.tileAt(p.x+16*dc,p.z+16*dr)?.road);
    const nearBuilding=p=>beside.some(([dc,dr])=>{
        const code=city.tileAt(p.x+16*dc,p.z+16*dr)?.building;return code>=112&&code<=197;
    });
    const lots=landings.filter(p=>!city.tileAt(p.x,p.z).road&&nearRoad(p));
    const pickup=neighborhoodSites(lots.length?lots:landings);
    const medLots=landings.filter(p=>served(p,byAmbulance));
    const medOffRoad=medLots.filter(p=>!city.tileAt(p.x,p.z).road&&nearRoad(p));
    const medical=neighborhoodSites(medOffRoad.length?medOffRoad:medLots);
    const fireLand=land.filter(p=>served(p,byEngine)&&offPad(p));
    const blocks=fireLand.filter(nearBuilding);
    const fire=neighborhoodSites(blocks.length?blocks:fireLand);
    if(!fire.length){const p=land.find(p=>served(p,byEngine));if(p)fire.push(p);}
    const riot=street.filter(p=>served(p,byPolice)&&!city.tileAt(p.x,p.z)?.water&&p.level==='street');
    return {roads,water,street,harbor,hospitals,fire,airport,stations,pickup,medical,riot,
        rescueWater:neighborhoodSites(wet)};
}

// Only roads reachable from the station can serve an incident. Return null if
// there is no road within reach, or [] if the unit is already at its destination.
export function responseRoute(roads, start, destination, radius = 78) {
    const first = roadKey(start), preceding = new Map([[first, -1]]), queue = [first];
    let best = first, bestDistance = distance(start,destination);
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i], point = roads.get(id), d = distance(point,destination);
        if (d < bestDistance) { bestDistance = d; best = id; }
        if (d < .01) break;
        for (const next of point.neighbors) {
            if (!roads.has(next) || preceding.has(next)) continue;
            preceding.set(next,id); queue.push(next);
        }
    }
    if (bestDistance > radius) return null;
    const result = [];
    for (let id = best; id !== first; id = preceding.get(id)) result.push(id);
    return result.reverse();
}

function turnYaw(now, desired, dt) {
    const delta = Math.atan2(Math.sin(desired - now), Math.cos(desired - now));
    return now + delta * Math.min(1, dt * 6);
}

// Staggered traffic uses actual cardinal links, and reverses only at a dead end.
function follow(actor, graph, dt) {
    let left = actor.speed * dt;
    while (left > 0 && actor.from && actor.to) {
        const len = actor.kind==='boat'?distance(actor.from,actor.to):roadEdgeLength(actor.from,actor.to,actor.offset);
        if (len < .01) break;
        const step = Math.min(left, len - actor.along);
        actor.along += step; left -= step;
        const pos = actor.node.position;
        if(actor.kind==='boat'){
            const dx=(actor.to.x-actor.from.x)/len,dz=(actor.to.z-actor.from.z)/len;
            pos.x=actor.from.x+dx*actor.along;pos.z=actor.from.z+dz*actor.along;
            actor.node.rotation.y=turnYaw(actor.node.rotation.y,Math.atan2(dx,dz),dt);
        }else{
            const sample=roadDrivingPoint(actor.from,actor.to,actor.along,actor.offset);
            pos.x=sample.x;pos.z=sample.z;actor.roadLevel=sample.level;
            actor.node.rotation.y=turnYaw(actor.node.rotation.y,Math.atan2(sample.dx,sample.dz),dt);
        }
        if (actor.along < len - .0001) break;
        if (actor.service) {
            actor.from = actor.to; actor.along = 0;
            actor.to = graph.get(actor.route.shift()) || null;
            if (!actor.to) actor.service.status = actor.service.destination;
            continue;
        }
        const previous = roadKey(actor.from);
        const choices = actor.to.neighbors.filter(k => k !== previous && graph.has(k));
        const next = choices.length ? choices[Math.floor(actor.rng() * choices.length)] : previous;
        actor.from = actor.to; actor.to = graph.get(next); actor.along = 0;
    }
}

export async function createMissions(ctx, city, flight, options = {}) {
    const { THREE: T, scene, assets } = ctx;
    const places = planDispatchSites(city);
    const group = new T.Group();
    group.name = city.name+' dispatch';
    scene.add(group);
    const cockpitPilot = createPilot(ctx, flight);
    const owned = new Set();
    const actors = [];
    const jobs = [];
    let disposed = false, loaders = 0, clock = 0;
    let pilotSettled = false, dispatchSettled = false, resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    // A slow or unavailable local GLB must not trap the player on the dispatch board.
    const warmupDeadline = setTimeout(() => settleReady('timeout'), 15000);
    let noticeUntil = 0;
    const state = {
        type: 'patrol', phase: '', title: '', instruction: '', target: null, distance: 0,
        completed: 0, score: 0, progress: 0, feedback: '', activePeople: 0, activeCars: 0, activeBoats: 0,
        destination: '', lastResult: '', assetErrors: [], visibleActorDraws: 0, activeSkeletons: 0, serviceUnits: [],
    };
    const surface = (x, z) => city.surfaceAt(x, z);
    const own = value => { owned.add(value); return value; };
    const proxyTemplates = new Map();
    const glassByMaterial = new Map();
    function trafficGlass(original) {
        const refractive = original.transmission > 0;
        if (!refractive && !(original.transparent && original.side === T.DoubleSide)) return original;
        if (!glassByMaterial.has(original)) {
            const glass = own(original.clone());
            if (refractive) { glass.transmission = 0; glass.transparent = true; glass.depthWrite = false; }
            glass.forceSinglePass = true;
            glassByMaterial.set(original, glass);
        }
        return glassByMaterial.get(original);
    }
    const solidMat = own(new T.MeshStandardMaterial({ vertexColors: true, roughness:.60,metalness:.16,side:T.DoubleSide }));
    const dotMat = own(new T.PointsMaterial({ vertexColors: true, size: 2, sizeAttenuation: false }));
    const material = (color, extra = {}) => own(new T.MeshBasicMaterial({ color, ...extra }));
    const spawnMesh = (parent, geometry, mat) => {
        const o = new T.Mesh(geometry, mat); parent.add(o); return o;
    };
    const mount = name => { const o = new T.Group(); o.name = name; group.add(o); return o; };
    function notice(message, seconds = 3) {
        state.feedback = message; noticeUntil = clock + seconds;
    }
    function settleReady(status) {
        if (!resolveReady) return;
        const resolve = resolveReady;
        resolveReady = null; clearTimeout(warmupDeadline);
        try {
            if (!disposed) update(0);  // Select the first visible LOD before precompile.
        } catch (error) {
            state.assetErrors.push('dispatch/initial-visibility');
            console.warn('[Sea Cliff dispatch] initial visibility', error);
        }
        resolve({ status, errors: [...state.assetErrors] });
    }
    function checkReady() {
        if (pilotSettled && dispatchSettled && !loaders && !jobs.length) settleReady('ready');
    }
    cockpitPilot.loaded.then(() => { pilotSettled = true; checkReady(); });

    // Preserve independent bones and playback state while sharing cached geometry and textures.
    function pumpLoads() {
        while (!disposed && loaders < 2 && jobs.length) {
            const { actor, path, clip, proxy } = jobs.shift();
            loaders++;
            Promise.resolve().then(() => assets.load(path)).then(template => {
                if (disposed) return;
                if (proxy) {
                    if (!proxyTemplates.has(path)) proxyTemplates.set(path,dotProxy(T, template, dotMat, own));
                    const object = proxyTemplates.get(path).clone();
                    object.visible = false; actor.node.add(object); actor.proxy = object;
                    return;
                }
                const model = clip ? cloneSkinned(template) : template.clone(true);
                if (actor.kind==='car'||actor.kind==='boat') {
                    if(!proxyTemplates.has(path))proxyTemplates.set(path,makeVehicleProxy(T,template,solidMat,own));
                    actor.proxy=proxyTemplates.get(path).clone();actor.proxy.visible=false;
                    actor.node.add(actor.proxy);
                }
                actor.node.add(model); actor.model = model;
                model.traverse(o => { if (o.isMesh || o.isPoints) actor.draws += Array.isArray(o.material) ? o.geometry.groups.length : 1; });
                if (clip) {
                    const animation = template.animations.find(a => a.name === clip);
                    if (!animation) throw new Error(`Missing clip ${clip} in ${path}`);
                    actor.mixer = new T.AnimationMixer(model);
                    actor.action = actor.mixer.clipAction(animation);
                    actor.action.play(); actor.action.time = actor.phase * Math.max(animation.duration, .001);
                }
                if (actor.kind === 'car') model.traverse(o => {
                    if (o.userData.axis === 'local +X') actor.wheels.push(o);
                    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(trafficGlass) : trafficGlass(o.material);
                });
                if (actor.proxyPath) jobs.push({ actor, path: actor.proxyPath, proxy: actor.proxyType });
            }).catch(error => {
                if (disposed) return;
                state.assetErrors.push(path); console.warn('[Sea Cliff dispatch]', path, error);
            }).finally(() => { loaders--; pumpLoads(); });
        }
        checkReady();
    }
    function actor(kind, path, clip = null, proxyPath = null, proxyType = 'solid') {
        const a = { kind, id:actors.length, node: mount(path), phase: (actors.length * .381966) % 1,
            mixer: null, animDebt: 0, wheels: [], active: true, draws: 0, proxyPath, proxyType };
        actors.push(a); jobs.push({ actor: a, path, clip }); return a;
    }
    const ringMat = material(0x58edce, { side: T.DoubleSide, transparent: true, opacity: .88, depthWrite: false });
    const marker = mount('Current dispatch point');
    const outline = spawnMesh(marker, own(new T.RingGeometry(5.6, 6.05, 48)), ringMat);
    outline.rotation.x = -Math.PI / 2; outline.position.y = .15;
    const mast = spawnMesh(marker, own(new T.CylinderGeometry(.09, .09, 10, 5)), ringMat);
    mast.position.y = 5;
    const arrow = spawnMesh(marker, own(new T.ConeGeometry(1.25, 2.5, 5)), ringMat);
    arrow.rotation.z = Math.PI; arrow.position.y = 11;

    const mechanic = actor('mechanic', person('Hangar-Mechanic'), 'Check and turn spanner');
    const dutyPilot = actor('pilot', person('City-Pilot'), 'Listen to dispatch');
    for (const [a, dx, dz] of [[mechanic, 13, 7], [dutyPilot, 10, 8]]) {
        const p = places.airport;
        a.node.position.set(p.x + dx, surface(p.x + dx, p.z + dz), p.z + dz);
        a.node.rotation.y = Math.atan2(p.x - a.node.position.x, p.z - a.node.position.z);
    }
    function mobile(a, start, graph, speed, offset, seed) {
        if (!start) { a.active = false; return; }
        a.rng = seedRandom(seed); a.from = start; a.to = graph.get(start.neighbors[Math.floor(a.rng() * start.neighbors.length)]);
        a.along = 0; a.speed = speed; a.offset = offset; a.graph = graph;
        a.node.position.set(start.x, start.y, start.z);
        if (a.to) a.node.rotation.y = Math.atan2(a.to.x - start.x, a.to.z - start.z);
    }
    const cast = ['SUIT', 'Blonde', 'Child', 'Kopp'];
    const bodies = ['AUTO', 'AUTO2', 'AUTO4'];
    const streetAnchors = [places.airport, ...places.hospitals, ...places.fire, ...places.harbor];
    const occupiedStarts = new Set(), services = [];
    for (const station of places.stations) {
        const car = actor('car', `models/world/vehicles/${station.model}.glb`);
        const p = station.park, neighbor = places.roads.get(p.neighbors[0]);
        const dx = (neighbor.x-p.x)/distance(neighbor,p), dz = (neighbor.z-p.z)/distance(neighbor,p);
        car.graph = places.roads; car.from = p; car.to = null; car.along = 0; car.route = [];
        car.speed = station.kind === 'fire' ? 6 : 7.2; car.offset = 1.65;
        car.node.position.set(p.x-dz*car.offset,p.y,p.z+dx*car.offset);
        car.node.rotation.y = Math.atan2(dx,dz); car.station = station;
        car.service = { kind:station.kind, stationCode:station.lot.code, homeRoad:roadKey(p), status:'station', destination:'station', position:car.node.position };
        services.push(car); state.serviceUnits.push(car.service); occupiedStarts.add(roadKey(p));
    }
    function sendUnit(car, goal, destination) {
        // A unit already moving continues its current segment before rerouting.
        const start = car.to || car.from, path = responseRoute(places.roads, start, goal);
        if (!path) return false;
        car.service.destination = destination; car.route = path;
        if (!car.to && path.length) { car.to = places.roads.get(path.shift()); car.along = 0; }
        car.service.status = car.to ? 'responding' : destination;
        return true;
    }
    for (let i = 0; i < 8 - services.length && places.street.length; i++) {
        const anchor = streetAnchors[i % streetAnchors.length];
        const prefer = { x: anchor.x + Math.cos(i * 1.9) * (25 + i * 8), z: anchor.z + Math.sin(i * 1.9) * 55 };
        const start = nearby(places.street, prefer, p => !occupiedStarts.has(roadKey(p))) || nearby(places.street, prefer);
        occupiedStarts.add(roadKey(start));
        const body = bodies[i % bodies.length];
        const car = actor('car', vehicle(body));
        mobile(car, start, places.roads, 4.3 + (i % 4) * .8, 1.65, 462 + i);
        if (i >= cast.length) continue;
        const pedestrian = actor('pedestrian', sourceActor(cast[i]), '1Wal', sourceActor(cast[i]).replace('LOD1','LOD2'), 'dots');
        mobile(pedestrian, start, places.roads, 1.1 + i * .06, (i % 2 ? -1 : 1) * 5.5, 823 + i);
    }
    if (places.harbor.length) {
        const boat = actor('boat', vehicle('Harbor-Sailboat'));
        const start = nearby([...places.water.values()], places.harbor[0], p => p.neighbors.length > 1 && distance(p, places.harbor[0]) > 30);
        mobile(boat, start, places.water, 2.6, 0, 104);
    }
    if(places.street.length){
        const dog=actor('pedestrian','models/complete/actors/2DOGG/2DOGG.glb','DgRn');
        dog.animal=true;
        const street=nearby(places.street,places.airport,p=>p.neighbors.length>0);
        mobile(dog,street,places.roads,1.9,-5.2,619);
    }
    function greetPilot(a,dt){
        if(a.kind!=='pedestrian'||!flight.playerPosition)return false;
        const pos=a.node.position,person=flight.playerPosition;
        const d=distance(pos,person);
        if(flight.state.onFoot&&d<21&&Math.abs(pos.y-person.y)<1.5){
            a.pathReturn??={x:pos.x,y:pos.y,z:pos.z};
            a.node.rotation.y=turnYaw(a.node.rotation.y,Math.atan2(person.x-pos.x,person.z-pos.z),dt);
            if(d>2+a.phase*1.8)walkToward(a,person,dt);
            return true;
        }
        if(a.pathReturn){
            if(distance(pos,a.pathReturn)>.28&&walkToward(a,a.pathReturn,dt))return true;
            a.pathReturn=null;
        }
        return false;
    }
    function walkToward(a,goal,dt){
        const p=a.node.position,d=distance(p,goal);if(d<.01)return false;
        const f=Math.min(1,a.speed*dt/d),x=p.x+(goal.x-p.x)*f,z=p.z+(goal.z-p.z)*f;
        const t=city.tileAt(x,z),y=city.surfaceAt(x,z);
        if(!t||t.water||city.buildingAt?.(x,z)||Math.abs(y-p.y)>.7)return false;
        p.set(x,y+.04,z);return true;
    }

    const view = new T.Frustum(), projection = new T.Matrix4(), actorVolume = new T.Sphere(new T.Vector3(), 4);
    const serviceAudio = {
        police: {request:'DIS100', missing:'DIS094', unreachable:'DIS103', recall:'DIS097', arrival:'POL3', siren:'policeSiren'},
        fire: {request:'DIS101', missing:'DIS121', busy:'DIS095', unreachable:'DIS104', recall:'DIS098', arrival:'DIS118', siren:'fireSiren'},
        hospital: {request:'DIS102', missing:'DIS122', busy:'DIS096', unreachable:'DIS105', recall:'DIS099', arrival:'MDVC5', siren:'ambulanceSiren'},
    };
    function serviceVoice(clip, owner) {
        options.onRadio?.({kind:'service',clip,id:owner+'-'+clip});
    }
    function requestUnit(kind, goal, owner, quiet=false) {
        const car = services.find(value => value.station.kind === kind);
        const audio = serviceAudio[kind];
        const busy=car && car.incident!=null && car.incident!==owner;
        if (!car || busy || !sendUnit(car, goal, 'at-scene')) {
            if (!quiet && audio) serviceVoice(!car?audio.missing:busy?(audio.busy??audio.missing):audio.unreachable,owner);
            return false;
        }
        if (car.incident !== owner) {
            if (!quiet) serviceVoice(audio.request,owner);
            car.announcedArrival=null;
            ctx.sound?.sceneCue?.('siren',distance(flight.position,car.node.position));
            car.nextSiren=clock+3;
        }
        car.incident = owner;
        return true;
    }
    function unitAt(kind, target, radius, owner) {
        const car = services.find(value => value.station.kind === kind);
        return !!car && (owner==null || car.incident===owner && car.service.status==='at-scene') && distance(car.node.position, target) <= radius;
    }
    function releaseUnits(owner,kind) {
        let released=false;
        for (const car of services) if (car.incident === owner && (!kind||kind===car.station.kind)) {
            car.incident = null;
            sendUnit(car, car.station.park, 'station');
            if (kind) serviceVoice(serviceAudio[kind].recall,owner);
            released=true;
        }
        return released;
    }
    const director = createDispatch({ctx, city, flight, sites:places, parent:group, worldState:state,
        send:requestUnit, arrived:unitAt, release:releaseUnits, notice, prepare:trafficGlass, ...options,loadout:options.loadout});
    const vehicleColliders=actors.filter(a=>a.kind==='car'||a.kind==='boat').map(a=>({
        kind:a.kind,body:a.node,get active(){return a.active;},get collisionMesh(){return a.proxy??a.model;},
        get speed(){return a.to && !a.stopped && !a.touching ? a.speed : 0;},
    }));
    ctx.transit?.collisionObjects?.push(...vehicleColliders);
    let nextHeatNotice=0;
    ctx.onFlightImpact = event => {
        if (event.destroyed) director.reportIncident('helicopterCrash', flight.state.name);
        if(event.kind==='fire'&&!event.destroyed&&clock<nextHeatNotice)return;
        const object={building:'건물',terrain:'지면',tree:'나무',bridge:'다리',soffit:'교량 하부',pier:'교각',
          deck:'교량 상판',tunnel:'터널',powerline:'전선',aircraft:'항공기',train:'열차',boat:'선박',water:'수면',
          car:'차량',pedestrian:'보행자',mechanic:'정비사'}[event.kind]??'장애물';
        const cause=event.kind==='fire'?'화염 피해':event.kind==='landing'?'거친 착륙':
          (event.part==='rotor'?'로터':'동체')+' 충돌 · '+object;
        const message=(event.destroyed?'기체 파손 · ':'')+cause+' · 손상 '+Math.ceil(event.damage)+'%';
        notice(message,5);options.onImpact?.(message,event);
        if(event.kind==='fire')nextHeatNotice=clock+3;
        ctx.sound?.sceneCue?.(event.kind==='fire'?'heat':event.destroyed||event.damageDelta>=8?'collision':'bump',0);
    };
    // Parked and moving vehicles retain solid footprints when off-camera.
    // A pilot already brushed by a moving object must be able to walk away.
    ctx.walkingActorAt=(x,y,z,radius,prev)=>{
        for(const a of actors){
            if(!a.active||a.kind==='pilot')continue;
            const p=a.node.position;
            if(Math.abs(p.x-x)>12||Math.abs(p.z-z)>12)continue;
            if(a.nearBounds){
                const b=a.nearBounds;
                if(y+1.65<=p.y+b.min.y || y>=p.y+b.max.y)continue;
                const c=Math.cos(a.node.rotation.y),s=Math.sin(a.node.rotation.y);
                const clearance=(px,pz)=>{
                    const dx=px-p.x,dz=pz-p.z,u=c*dx-s*dz,v=s*dx+c*dz;
                    const gu=Math.max(b.min.x-u,u-b.max.x),gv=Math.max(b.min.z-v,v-b.max.z);
                    return gu>0||gv>0?Math.hypot(Math.max(0,gu),Math.max(0,gv)):Math.max(gu,gv);
                };
                const d=clearance(x,z);
                if(d<radius&&d<clearance(prev.x,prev.z))return true;
            }else{
                const bodyRadius=a.kind==='boat'?1.15:a.kind==='car'?.85:a.animal?.24:.28;
                if(y>=p.y+(a.animal?.58:1.65)||y+1.65<=p.y)continue;
                const d=Math.hypot(x-p.x,z-p.z);
                if(d<radius+bodyRadius&&d<Math.hypot(prev.x-p.x,prev.z-p.z))return true;
            }
        }
        return false;
    };
    const contactProbe=new T.Vector3();
    function checkContact(a,dt) {
        if(!flight.contactAt||flight.state.onFoot||distance(flight.position,a.node.position)>21 || a.injured){
            a.touching=false;a.obstructedFor=0;return;
        }
        const boat=a.kind==='boat',vehicle=a.kind==='car',person=!vehicle&&!boat;
        const radius=boat?1.15:vehicle?.81:a.animal?.25:.35;
        const offsets=boat?[-3,-1,1,3]:vehicle?[-1,0,1]:[0];
        let contact;
        for(const offset of offsets){
            contactProbe.copy(a.node.position);
            contactProbe.y+=person?(a.animal?.46:1.20):boat?1.12:.87;
            contactProbe.x+=offset*Math.sin(a.node.rotation.y);
            contactProbe.z+=offset*Math.cos(a.node.rotation.y);
            contact=flight.contactAt(contactProbe,radius);
            if(contact)break;
        }
        if(!contact){a.touching=false;a.obstructedFor=0;return;}
        if(vehicle && a.to && flight.state.grounded){
            a.obstructedFor=(a.obstructedFor||0)+dt;
            if(a.obstructedFor>=3&&!a.trafficReported){
                ctx.sound?.sceneCue?.('horn',distance(flight.position,a.node.position));
                director.reportIncident('trafficObstructed','도로 차량','traffic-'+a.id+'-'+a.contactCount);
                a.trafficReported=true;
            }
        }
        if(!a.touching || (!a.dangerousContact && contact.dangerous)){
            if(!a.touching){a.contactCount=(a.contactCount||0)+1;a.trafficReported=false;}
            if(contact.dangerous){
                flight.impactActor(a.kind,contact);
                if(person){
                    a.injured=true;a.mixer?.stopAllAction();a.node.rotation.z=Math.PI*.43;
                    if(!a.animal)director.reportIncident('civilianHarmed','시민','ambient-'+a.id);
                }
            }
        }
        a.touching=true;a.dangerousContact=contact.dangerous;
    }
    function update(dt) {
        if (disposed) return;
        dt = clamp(dt, 0, .25); clock += dt;
        director.update(dt);
        marker.visible = !!state.target && options.navigationAid===true;
        if (state.target) {
            marker.position.set(state.target.x,state.target.y,state.target.z);
            arrow.position.y = 11 + Math.sin(clock * 3) * .65;
        }
        if (clock >= noticeUntil) state.feedback = '';
        const counts = { people: 0, cars: 0, boats: 0, draws: 0, skins: 0 }, eye = ctx.camera.position;
        ctx.camera.updateMatrixWorld();
        view.setFromProjectionMatrix(projection.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse));
        for (const a of actors) {
            if (a.kind === 'pilot') a.active = !flight.state.hasPilot && !!flight.state.grounded && (flight.state.rpm || 0) < .18 && distance(flight.position, places.airport) < 30;
            if (!a.active) { a.node.visible = false; continue; }
            checkContact(a,dt);
            if (a.graph && !a.injured && !a.touching && !greetPilot(a,dt)) {
                // Cars in the same lane leave room for the vehicle ahead.
                const leader = a.kind === 'car' && actors.some(b => b !== a && b.kind === 'car' && b.from === a.from
                    && b.to === a.to && b.along > a.along && b.along - a.along < 5.5);
                if (!leader) follow(a, a.graph, dt);
                a.stopped = !!leader || !a.to;
                const p=a.node.position;
                p.y=a.kind==='boat' ? surface(p.x,p.z)+Math.sin(clock*1.8)*.08
                    : (city.roadHeightAt?.(p.x,p.z,a.roadLevel??a.from?.level)??surface(p.x,p.z))+.04;
            }
            const dist = eye.distanceTo(a.node.position);
            if (a.incident != null) {
                const audio = serviceAudio[a.service.kind];
                if (a.service.status === 'responding' && clock >= a.nextSiren) {
                    ctx.sound?.sceneCue?.(audio.siren,flight.position.distanceTo(a.node.position));
                    a.nextSiren=clock+6;
                } else if (a.service.status === 'at-scene' && a.announcedArrival !== a.incident) {
                    if (audio.arrival) serviceVoice(audio.arrival,a.incident);
                    a.announcedArrival=a.incident;
                }
            }
            const boat = a.kind === 'boat' || a.kind === 'wreck';
            actorVolume.center.copy(a.node.position); actorVolume.center.y += boat ? 2.5 : 1;
            actorVolume.radius = boat ? 9 : a.kind === 'car' ? 5 : 2;
            a.node.visible = dist < (boat ? 730 : a.kind === 'car' ? 440 : a.proxyPath ? 260 : 120) && view.intersectsSphere(actorVolume);
            if (boat) counts.boats++; else if (a.kind === 'car') counts.cars++; else counts.people++;
            if (!a.node.visible) continue;
            // Hysteresis avoids toggling the near and reduced exteriors on
            // successive frames when hovering at the transition distance.
            const vehicleRange=boat?90:56;
            const threshold=boat||a.kind==='car'?vehicleRange+(a.proxy?.visible?-6:6):102;
            const useProxy = a.proxy && dist > threshold;
            if (a.model) a.model.visible = !useProxy;
            if (a.proxy) a.proxy.visible = !!useProxy;
            counts.draws += useProxy ? 1 : a.draws;
            if (useProxy) continue;
            if (a.wheels.length && !a.stopped) for (const wheel of a.wheels) wheel.rotation.x += dt * a.speed / .34;
            if (a.mixer) {
                counts.skins++;
                a.animDebt += dt;
                const step = dist < 50 ? 0 : dist < 110 ? 1 / 15 : 1 / 6;
                if (a.animDebt >= step) { a.mixer.update(a.animDebt); a.animDebt = 0; }
            }
        }
        state.activePeople = counts.people; state.activeCars = counts.cars; state.activeBoats = counts.boats;
        state.visibleActorDraws = counts.draws; state.activeSkeletons = counts.skins;
        cockpitPilot.update(!dutyPilot.active);
        if (cockpitPilot.error && !state.assetErrors.includes('cockpit/City-Pilot')) state.assetErrors.push('cockpit/City-Pilot');
    }
    function dispose() {
        ctx.onFlightImpact=null;
        ctx.walkingActorAt=null;
        const moving=ctx.transit?.collisionObjects;
        if(moving)for(const actor of vehicleColliders){const i=moving.indexOf(actor);if(i>=0)moving.splice(i,1);}
        if (disposed) return;
        disposed = true; jobs.length = 0; scene.remove(group);
        settleReady('disposed');
        director.dispose();
        cockpitPilot.dispose();
        for (const a of actors) {
            if (a.mixer) { a.mixer.stopAllAction(); a.mixer.uncacheRoot(a.model); }
            if (a.model) a.model.traverse(o => {
                // Bone textures belong to independent skeleton clones.
                if (o.isSkinnedMesh) o.skeleton.dispose();
            });
        }
        for (const resource of owned) resource.dispose();
        group.clear();
    }
    pumpLoads(); update(0);
    director.ready().then(()=>{dispatchSettled=true;checkReady();});
    return { state, ready, update, act:director.act, cycle:director.cycle, aim:director.aim,
        beginBucket:director.beginBucket,endBucket:director.endBucket,toggleBucketCable:director.toggleBucketCable,getBucketAim:director.getBucketAim,
        choose:director.choose, recall:director.recall, getFireSources:director.getFireSources,
        reportIncident:director.reportIncident, getAdjustments:director.getAdjustments,
        ackAdjustments:director.ackAdjustments, dispose };
}
