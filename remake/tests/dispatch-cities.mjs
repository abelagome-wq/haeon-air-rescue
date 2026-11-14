// Runs the actual city sampler against every shipped map, without starting WebGL.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs/promises';
const vendor = new URL('../vendor/three/', import.meta.url);
registerHooks({ resolve(id, ctx, next) {
    if (id === 'three') return { url: new URL('three.module.min.js', vendor).href, shortCircuit: true };
    if (id.startsWith('three/addons/')) return { url: new URL(id.slice(6), vendor).href, shortCircuit: true };
    return next(id, ctx);
} });
const T = await import('three');
const { planDispatchSites, responseRoute } = await import('../src/missions.js');
const { createCitySampler } = await import('../src/city.js');
const input = new URL('../data/cities/', import.meta.url);
const roster = JSON.parse(await fs.readFile(new URL('index.json', input)));
assert.equal(roster.length, 47);
const result = [];
for (const entry of roster) {
    const raw = JSON.parse(await fs.readFile(new URL(entry.id + '.json', input)));
    const city = createCitySampler(raw, T), sites = planDispatchSites(city);
    assert.ok(sites.roads.size > 0, entry.id + ' has no traffic route');
    assert.ok(sites.harbor.length > 0, entry.id + ' has no accessible rescue/scoop location');
    assert.ok(sites.hospitals.length && sites.fire.length, entry.id + ' has no dry handoff/fire location');
    const dry = [...new Map([...sites.hospitals, ...sites.fire].map(p => [p.row * 128 + p.col, p])).values()];
    for (const p of dry) {
        const tile = city.tileAt(p.x, p.z);
        assert.ok(!tile.water && (tile.building === 0 || tile.road), entry.id + ' target on occupied or flooded tile');
        assert.ok(!city.buildingAt?.(p.x, p.z), entry.id + ' target inside a building');
        assert.ok(Math.abs(p.y - city.surfaceAt(p.x, p.z)) < .02);
    }
    assert.ok(sites.pickup.length>=2 && sites.medical.length,entry.id+' lacks public landing areas');
    assert.ok(sites.cargo.length>=2,entry.id+' lacks freight depots');
    for(const p of sites.cargo){
        assert.ok(!city.tileAt(p.x,p.z).road && sites.cargo.some(q=>Math.hypot(p.x-q.x,p.z-q.z)>=144),
            entry.id+' has an unsafe or isolated freight depot');
    }
    for(const p of [...sites.pickup,...sites.medical,...sites.cargo]){
        for(const dx of [-7,0,7])for(const dz of [-7,0,7]){
            const x=p.x+dx,z=p.z+dz,t=city.tileAt(x,z);
            assert.ok(t&&!t.water&&!t.rail&&!city.buildingAt(x,z),entry.id+' unsafe landing footprint');
            assert.ok(Math.abs(city.surfaceAt(x,z)-p.y)<.65,entry.id+' uneven landing footprint');
        }
    }
    for (const p of [...sites.harbor,...sites.rescueWater]) {
        for (const [dx, dz] of [[0,0], [4,3]]) {
            const tile = city.tileAt(p.x + dx, p.z + dz);
            assert.ok(tile.water && tile.building === 0 && tile.waterY != null, entry.id + ' rescue at an obstructed/dry tile');
            assert.ok(!city.buildingAt?.(p.x+dx, p.z+dz), entry.id + ' rescue site intersects a structure');
            assert.ok(Math.abs(p.y - tile.waterY) < .06 && city.groundAt(p.x+dx, p.z+dz) <= p.y + .06,
                entry.id + ' rescue point behind terrain or water');
        }
    }
    const services = sites.stations.map(s => {
        const t = city.tileAt(s.park.x,s.park.z);
        assert.ok(t.road && !t.water && !city.buildingAt(s.park.x,s.park.z));
        const gap = Math.hypot(Math.max(0, Math.abs(s.lot.x-s.park.x)-s.lot.w*8),Math.max(0, Math.abs(s.lot.z-s.park.z)-s.lot.h*8));
        assert.ok(gap <= 23 && city.landmarks.some(p => p === s.lot && p.kind === s.kind));
        const goal = s.kind === 'fire' ? sites.fire[0] : s.kind === 'hospital' ? sites.hospitals[0] : sites.harbor[0];
        const path = responseRoute(sites.roads,s.park,goal);
        let previous = s.park;
        for (const id of path || []) { assert.ok(previous.neighbors.includes(id)); previous = sites.roads.get(id); }
        if (path) assert.ok(Math.hypot(previous.x-goal.x,previous.z-goal.z)<=78.001);
        return { kind:s.kind, station:s.lot.code, parkingCell:s.park.row*128+s.park.col, edgeGapM:+gap.toFixed(1),
            exampleResponseRoadSegments:path?.length ?? null };
    });
    result.push({ id: entry.id, roads: sites.roads.size, waterTrafficTiles: sites.water.size,
        rescueCells: [...new Set(sites.harbor.map(p => p.row * 128 + p.col))],
        hospitalCells: [...new Set(sites.hospitals.map(p => p.row * 128 + p.col))],
        fireCells: [...new Set(sites.fire.map(p => p.row * 128 + p.col))], services });
}
if (process.argv.includes('--write')) await fs.writeFile(new URL('../verification/dispatch-cities.json', import.meta.url),
    JSON.stringify({ passed: result.length, cities: result }, null, 2) + '\n');
console.log('PASS:', result.length, 'real maps with safe afloat rescue/refill, dry handoff/fire locations, and connected traffic.');
