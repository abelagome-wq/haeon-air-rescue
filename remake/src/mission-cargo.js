import {neighborhoodSites, pickIncidentSite} from './incident-sites.js';
import {Box3} from 'three';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const MIN_ROUTE = 144;
const PAD_RADIUS = 6;
const LOAD_KG = 160;

// Reserve level, off-road ground already cleared for a helicopter. Prefer
// depot lots near the port, industrial premises or airport on each city map.
export function cargoDepots(city, landings, roadside) {
    const sites = landings.filter(p => !city.tileAt(p.x, p.z).road);
    if (sites.length < 2) return [];
    const byCell = new Map(sites.map(p => [p.row * 128 + p.col, p]));
    const tagged = new Map();
    function mark(anchor, label) {
        const origin = sites[0], size = city.tileSize ?? 16;
        const row = origin.row + Math.round((anchor.z - origin.z) / size);
        const col = origin.col + Math.round((anchor.x - origin.x) / size);
        const extent = 5;
        for (let dr = -extent; dr <= extent; dr++) {
            for (let dc = -extent; dc <= extent; dc++) {
                if (col + dc < 0 || col + dc >= 128) continue;
                const p = byCell.get((row + dr) * 128 + col + dc);
                if (!p) continue;
                const d = distance(anchor, p);
                if (d <= 80 && d < (tagged.get(p)?.d ?? Infinity)) tagged.set(p, {d, label});
            }
        }
    }
    for (const p of city.landmarks) {
        if (p.kind === 'port') mark(p, '항만 화물장');
        if (p.kind === 'airport') mark(p, '공항 화물장');
    }
    for (const p of city.placements ?? []) {
        const zone = city.tileAt(p.x, p.z)?.zone;
        if (zone === 5 || zone === 6) mark(p, '산업단지 화물장');
    }
    // Reject street furniture, trees and overhead obstructions within the
    // approach. Limit the collision queries to the neighborhood shortlist.
    const approach = new Box3();
    const clear = p => {
        if (!city.flightScenery) return true; // The sampler's landings already exclude building footprints.
        approach.min.set(p.x-7, p.y+.70, p.z-7);
        approach.max.set(p.x+7, p.y+30, p.z+7);
        return !city.flightScenery.visit(approach, triangle => triangle.intersectsBox(approach));
    };
    function routeSites(pool) {
        const distinct = neighborhoodSites(pool).filter(clear);
        return distinct.filter(p => distinct.some(other => distance(p, other) >= MIN_ROUTE))
            .map(p => ({...p, label: tagged.get(p)?.label ?? '지역 화물장'}));
    }
    const preferred = routeSites(Array.from(tagged.keys()));
    if (preferred.length) return preferred;
    const shared = routeSites([...new Set([...tagged.keys(), ...roadside])]);
    return shared.length ? shared : routeSites(sites);
}

// Ground paint follows the terrain so the receiving area is visible from the
// sling camera and doesn't float or disappear into the upward side of a slope.
function receivingPad(T, group, city, site) {
    const verts = [];
    const add = (angle, r) => {
        const x = site.x + Math.cos(angle) * r, z = site.z + Math.sin(angle) * r;
        verts.push(x, city.surfaceAt(x, z) + .10, z);
    };
    for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16, b = (i + .82) * Math.PI / 16;
        add(a, PAD_RADIUS); add(b, PAD_RADIUS); add(b, PAD_RADIUS - .48);
        add(a, PAD_RADIUS); add(b, PAD_RADIUS - .48); add(a, PAD_RADIUS - .48);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
    const paint = new T.MeshBasicMaterial({color:0xf9c253,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const mesh = new T.Mesh(geometry, paint);
    mesh.name = 'Freight receiving zone';
    group.add(mesh);
    return () => { mesh.removeFromParent(); geometry.dispose(); paint.dispose(); };
}

export function createCargoIncident(api) {
    const {state, sites, hook} = api;
    const pickup = pickIncidentSite(api, 'cargo/pickup', sites.cargo);
    const destinations = sites.cargo.filter(p => distance(p, pickup) >= MIN_ROUTE);
    const otherDepots = destinations.filter(p => p.label !== pickup.label);
    const drop = pickIncidentSite(api, 'cargo/delivery', otherDepots.length ? otherDepots : destinations);
    const cash = 180 + Math.round(distance(pickup, drop) * .15);
    const removePaint = receivingPad(api.ctx.THREE, api.group, api.city, drop);
    let ended = false, removed = false;
    function directPickup(position, label) {
        Object.assign(state, {phase:'pickup', target:position, destination:label, progress:0,
            instruction:'컨테이너 위에 정지 비행하세요. 고리 줄을 내려 인양점에 맞춘 뒤 작업을 누르세요.'});
    }
    state.incidentSite = pickup;
    state.suggestedTool = 'hook';
    const load = hook.register({
        position:new api.ctx.THREE.Vector3(pickup.x, pickup.y, pickup.z), massKg:LOAD_KG,
        onAttach() {
            if (ended) return;
            Object.assign(state, {phase:'deliver', target:drop, destination:drop.label+' · 하역 구역', progress:.5,
                instruction:'목적지의 노란 원 안에 컨테이너를 천천히 내려놓고 작업을 눌러 고리를 해제하세요.'});
            api.notice('컨테이너 연결 · '+drop.label+'까지 수송하세요.', 3);
        },
        onRelease(cargo, reason) {
            if (ended) return;
            if (reason !== 'reset' && cargo.grounded && distance(cargo.position, drop) <= PAD_RADIUS) {
                api.finish({points:60, cash, message:'컨테이너 인도 완료 · 운송료 §'+cash});
                return;
            }
            directPickup(cargo.position, '컨테이너 회수 위치');
            api.notice('컨테이너를 다시 연결해 하역 구역으로 운반하세요.', 4);
        }
    });
    directPickup(load.position, pickup.label+' · 인양 지점');
    function close() {
        if (removed) return;
        ended = removed = true;
        load.dispose();
        removePaint();
    }
    return {update(){}, act:()=>false, onFinish(outcome) {
        ended = true;
        if (outcome === 'success') load.retire();
        else close();
    }, dispose:close};
}
