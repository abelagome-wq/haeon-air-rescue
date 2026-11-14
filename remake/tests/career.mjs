import test from 'node:test';
import assert from 'node:assert/strict';
import {createCareer,CAREER_KEY,STARTING_CASH,AIRCRAFT_CATALOG,EQUIPMENT_CATALOG} from '../src/career.js';
import {citySeed,campaignDistrict} from '../src/city-worlds.js';

class Store {
  map=new Map(); fail=false; writes=0;
  getItem(k){return this.map.get(k)??null;}
  setItem(k,v){if(this.fail)throw Error('QuotaExceededError');this.writes++;this.map.set(k,String(v));}
}
class Locks {
  tail=Promise.resolve();
  request(name,options,fn){assert.equal(options.mode,'exclusive');const next=this.tail.catch(()=>{}).then(fn);this.tail=next;return next;}
}
class Events {
  listeners=new Set();addEventListener(name,fn){if(name==='storage')this.listeners.add(fn);}
  removeEventListener(name,fn){this.listeners.delete(fn);}
  fire(event){for(const fn of this.listeners)fn(event);}
}
function fixture(cash){
  const storage=new Store(),locks=new Locks(),events=new Events();let n=0;
  if(cash!==undefined)storage.setItem('simcopter.record',JSON.stringify({cash,score:40,completed:2,failed:1,partial:1}));
  const options={storage,locks,events,idFactory:()=>`test-id-${++n}`,now:()=>123456};
  return {storage,locks,events,create:()=>createCareer(options)};
}
const totals=(ledger,cash,extra={})=>({ledger,cash,score:0,completed:0,failed:0,partial:0,...extra});

test('a new layout changes only its own size and preserves earned regional qualification',async()=>{
  const f=fixture(730),pilot=f.create();await pilot.ready;
  const original=pilot.snapshot(),area=campaignDistrict('large',1);
  assert.ok((await pilot.beginSession('large-shift','SCWZR300',area)).ok);
  assert.ok((await pilot.closeSession('large-shift',totals(1,200,{score:400,completed:1}))).ok);
  await pilot.regenerateCity('large');
  const after=pilot.snapshot();
  assert.notEqual(citySeed(after,'large'),citySeed(original,'large'));
  assert.equal(citySeed(after,'small'),citySeed(original,'small'));
  assert.equal(after.cash,930);assert.equal(after.cityScores[area],400);
  const next=f.create();await next.ready;
  assert.equal(citySeed(next.snapshot(),'large'),citySeed(after,'large'));
  assert.equal((await next.finishCity(area)).code,'promoted');
  assert.equal((await next.finishCity(area)).code,'already-cleared');
  assert.ok((await next.beginSession('second','SCWZR300',campaignDistrict('medium',2))).ok);
});

test('City qualification and maintenance survive reload and stale sessions cannot overwrite a serviced aircraft',async()=>{
  const f=fixture(),pilot=f.create();await pilot.ready;
  assert.equal((await pilot.beginSession('locked','SCWZR300','city-3')).code,'city-locked');
  await pilot.beginSession('first','SCWZR300','sea-cliff');
  await pilot.settleSession('first',totals(1,240,{score:100,completed:1}));
  assert.equal((await pilot.finishCity('sea-cliff')).code,'city-incomplete');
  const condition={fuelGallons:38.5,damagePoints:0,gas:5};
  await pilot.maintainAircraft('first','SCWZR300',condition,{id:'inspection1',cost:61});
  await pilot.maintainAircraft('first','SCWZR300',condition,{id:'inspection1',cost:61});
  assert.equal(pilot.snapshot().cash,1179);
  await pilot.settleSession('first',totals(2,960,{score:400,completed:4}));
  assert.equal((await pilot.finishCity('sea-cliff')).code,'promoted');
  assert.equal((await pilot.finishCity('sea-cliff')).code,'already-cleared');
  assert.equal(pilot.snapshot().cash,2399,'promotion bonus paid exactly once');
  const next=f.create();await next.ready;
  assert.equal(next.snapshot().campaignLevel,2);
  assert.equal(next.snapshot().airframes.SCWZR300.gas,5);
  assert.ok((await next.beginSession('next','SCWZR300','city-3')).ok);
  assert.equal((await pilot.maintainAircraft('first','SCWZR300',{fuelGallons:0,damagePoints:495})).code,'aircraft-busy');
  assert.equal(next.snapshot().airframes.SCWZR300.fuelGallons,38.5);
});

test('source-backed prices and initial loadout',async()=>{
  assert.equal(STARTING_CASH,1000);
  assert.equal(AIRCRAFT_CATALOG.length,20);
  assert.deepEqual(AIRCRAFT_CATALOG.slice(0,9).map(v=>v.price),[3400,7800,8800,11000,13500,16500,18500,20500,50000]);
  assert.deepEqual(EQUIPMENT_CATALOG.slice(0,5).map(v=>[v.id,v.price]),[['bucket',500],['megaphone',500],['harness',800],['cannon',1500],['gas',2500]]);
  const f=fixture(),c=f.create();assert.equal((await c.ready).ok,true);
  const p=c.snapshot();assert.equal(p.cash,1000);assert.deepEqual(p.ownedAircraft,['SCWZR300']);
  assert.deepEqual(p.ownedEquipment,['bucket','megaphone','hook']);assert.equal(p.revision,1);
  assert.deepEqual(c.loadout(),{bucket:true,hook:false,megaphone:true,harness:false,cannon:false,gas:false,spotlight:true});
  assert.equal(c.canUse('traffic'),true);assert.equal(c.canUse('board'),true);assert.equal(c.canUse('harness'),false);
  p.cash=500000;assert.equal(c.snapshot().cash,1000);c.dispose();
});

test('legacy cash keeps positive, zero, negative and fractional values, without a starter cash bonus',async()=>{
  for(const cash of [9200,0,-90,-12.5,.25]){
    const f=fixture(cash),c=f.create();await c.ready;
    assert.equal(c.snapshot().cash,cash);assert.equal(c.snapshot().migration.initialCashBonus,0);
    assert.deepEqual(c.snapshot().ownedEquipment,['bucket','megaphone','hook']);
    assert.equal(c.snapshot().score,40);assert.equal(c.snapshot().completed,2);
    const again=f.create();await again.ready;assert.equal(again.snapshot().cash,cash);assert.equal(again.snapshot().revision,1);
    assert.equal(JSON.parse(f.storage.getItem('simcopter.record')).cash,cash);c.dispose();again.dispose();
  }
});

test('atomic purchases reject duplicates, missing funds and unowned selections',async()=>{
  const f=fixture(),c=f.create();await c.ready;
  assert.equal((await c.purchaseEquipment('harness')).ok,true);assert.equal(c.snapshot().cash,200);
  assert.equal((await c.purchaseEquipment('harness')).code,'already-owned');
  assert.equal((await c.purchaseEquipment('cannon')).code,'insufficient-funds');
  assert.equal((await c.purchaseAircraft('JETRANG')).code,'insufficient-funds');
  assert.equal((await c.selectAircraft('JETRANG')).code,'not-owned');
  assert.equal((await c.purchaseAircraft('not-real')).code,'unknown-item');
  assert.equal(c.snapshot().cash,200);assert.equal(c.snapshot().revision,2);
});

test('two contexts serialize purchases and do not double-spend or double-migrate',async()=>{
  const f=fixture(1600),a=f.create(),b=f.create();await Promise.all([a.ready,b.ready]);
  assert.equal(a.snapshot().profileId,b.snapshot().profileId);
  const results=await Promise.all([a.purchaseEquipment('harness'),b.purchaseEquipment('harness'),b.purchaseEquipment('cannon')]);
  assert.equal(results.filter(v=>v.ok).length,1);
  assert.deepEqual(results.map(v=>v.code),['purchased','already-owned','insufficient-funds']);
  a.refresh();b.refresh();assert.equal(a.snapshot().cash,800);assert.equal(b.snapshot().cash,800);
  assert.equal(a.snapshot().revision,2);
});

test('session receipts apply only cumulative deltas, preserving purchases between receipts',async()=>{
  const f=fixture(),c=f.create();await c.ready;const session=await c.beginSession();assert.equal(session.ok,true);
  const id=session.sessionId;
  assert.equal((await c.settleSession(id,totals(1,8000,{score:100,completed:1}))).ok,true);
  assert.equal(c.snapshot().cash,9000);
  assert.equal((await c.purchaseAircraft('JETRANG')).ok,true);assert.equal(c.snapshot().cash,1200);
  await c.selectAircraft('JETRANG');assert.equal(c.loadout().bucket,true);assert.equal(c.loadout().megaphone,true);
  await c.purchaseEquipment('harness');assert.equal(c.snapshot().cash,400);
  assert.equal(c.loadout('SCWZR300').harness,true);assert.equal(c.loadout('JETRANG').harness,true);
  await c.settleSession(id,totals(2,8100,{score:150,completed:2}));assert.equal(c.snapshot().cash,500);
  const revision=c.snapshot().revision;
  assert.equal((await c.settleSession(id,totals(2,8100,{score:150,completed:2}))).code,'duplicate-receipt');
  assert.equal((await c.settleSession(id,totals(1,8000,{score:100,completed:1}))).code,'stale-receipt');
  assert.equal(c.snapshot().revision,revision);assert.equal(c.snapshot().cash,500);
  assert.equal((await c.settleSession(id,totals(2,9999,{score:150,completed:2}))).code,'receipt-conflict');
  await c.closeSession(id,totals(3,8075,{score:150,completed:2}));assert.equal(c.snapshot().cash,475);
  const reload=f.create();await reload.ready;
  assert.equal((await reload.settleSession(id,totals(4,999999,{score:200,completed:3}))).code,'session-closed');
  assert.equal(reload.snapshot().cash,475);
});

test('receipt replay across tabs, out-of-order receipts and negative session cash',async()=>{
  const f=fixture(0),a=f.create(),b=f.create();await Promise.all([a.ready,b.ready]);
  const {sessionId:id}=await a.beginSession();
  const out=await Promise.all([a.settleSession(id,totals(1,125)),b.settleSession(id,totals(1,125))]);
  assert.deepEqual(out.map(v=>v.code),['settled','duplicate-receipt']);b.refresh();assert.equal(b.snapshot().cash,125);
  await b.settleSession(id,totals(3,-75));assert.equal(b.snapshot().cash,0);
  assert.equal((await a.settleSession(id,totals(2,500))).code,'stale-receipt');
  assert.equal(a.snapshot().cash,0);assert.equal((await a.purchaseEquipment('harness')).code,'insufficient-funds');
  const batch={...totals(5,-65,{score:-90}),adjustments:[{id:4,cash:-40,points:-100},{id:5,cash:50,points:10}]};
  assert.equal((await a.settleSession(id,batch)).ok,true);assert.equal(a.snapshot().cash,50);assert.equal(a.snapshot().score,10);
  assert.equal((await a.settleSession('unknown',totals(1,500))).code,'unknown-session');
  assert.equal((await a.beginSession('__proto__')).code,'invalid-session');
});

test('storage event refreshes snapshots; failed writes do not create phantom ownership',async()=>{
  const f=fixture(),a=f.create(),b=f.create();await Promise.all([a.ready,b.ready]);
  let notified=0;b.subscribe(()=>notified++);
  await a.purchaseEquipment('harness');
  f.events.fire({key:CAREER_KEY,storageArea:f.storage});assert.equal(b.snapshot().cash,200);assert(notified>=2);
  const previous=f.storage.getItem(CAREER_KEY);f.storage.fail=true;
  const denied=await b.beginSession();assert.equal(denied.ok,false);assert.equal(denied.code,'storage-failed');
  assert.equal(f.storage.getItem(CAREER_KEY),previous);assert.equal(Object.keys(b.snapshot().sessions).length,0);
  a.dispose();b.dispose();assert.equal(f.events.listeners.size,0);
});

test('corrupt/future profiles and unsupported locks never overwrite records',async()=>{
  for(const raw of ['{broken',JSON.stringify({version:88})]){
    const f=fixture();f.storage.setItem(CAREER_KEY,raw);const before=f.storage.writes,c=f.create();
    assert.equal((await c.ready).ok,false);assert.equal((await c.purchaseEquipment('harness')).ok,false);
    assert.equal(f.storage.getItem(CAREER_KEY),raw);assert.equal(f.storage.writes,before);
  }
  const f=fixture(),working=f.create();await working.ready;const prior=f.storage.getItem(CAREER_KEY);
  const readonly=createCareer({storage:f.storage,locks:null});assert.equal((await readonly.ready).code,'locking-unavailable');
  assert.equal(readonly.snapshot().cash,1000);assert.equal((await readonly.purchaseEquipment('harness')).ok,false);
  assert.equal(f.storage.getItem(CAREER_KEY),prior);
});

test('new profile, legacy counters and cannon prerequisite keep the original record intact',async()=>{
  const f=fixture();f.storage.setItem('simcopter.points','60');f.storage.setItem('simcopter.dispatches','3');
  const c=f.create();await c.ready;assert.equal(c.snapshot().cash,0);assert.equal(c.snapshot().score,60);
  const profile=c.snapshot();profile.ownedEquipment=[];profile.cash=5000;
  f.storage.setItem(CAREER_KEY,JSON.stringify(profile));c.refresh();
  assert.equal((await c.purchaseEquipment('cannon')).code,'missing-requirement');
  assert.equal((await c.purchaseEquipment('bucket')).ok,true);
  assert.equal((await c.purchaseEquipment('cannon')).ok,true);assert.equal(c.snapshot().cash,3000);
});

test('legacy tools and per-aircraft water selections survive reload and swapping',async()=>{
  const f=fixture(30000),a=f.create();await a.ready;
  await a.purchaseAircraft('JETRANG');
  await a.purchaseEquipment('cannon');
  assert.equal(a.fit('JETRANG').water.id,'bucket');
  assert.equal(a.fit('JETRANG').tools.cannon,true);
  const bought=await a.purchaseEquipment('tank-medium','JETRANG');
  assert.equal(bought.ok,true);
  assert.equal(a.fit('JETRANG').water.capacityLitres,520);
  assert.equal(a.fit('SCWZR300').water.id,'bucket');
  assert.equal((await a.equipAddon('tank-medium','SCWZR300')).ok,true);
  assert.equal((await a.unequipAddon('tank-medium','JETRANG')).ok,true);
  const again=f.create();await again.ready;
  assert.equal(again.fit('SCWZR300').water.kind,'tank');
  assert.equal(again.fit('JETRANG').water,null);
  assert.equal(again.loadout('JETRANG').cannon,false);
  assert.equal(again.fit('JETRANG').mounted.cannon,'cannon');
  assert.equal((await again.equipAddon('bucket','JETRANG')).ok,true);
  assert.equal(again.loadout('JETRANG').cannon,true);
  assert.equal((await again.equipAddon('tank-large','SCWZR300')).code,'not-owned');
  assert.equal((await again.purchaseEquipment('bucket-large','MD520')).code,'not-owned');
  assert.equal(again.snapshot().cash,bought.profile.cash);
  await again.purchaseEquipment('harness','JETRANG');
  assert.equal(again.loadout('JETRANG').harness,true);
  assert.equal(again.loadout('SCWZR300').harness,false,'targeted order installs a tool only on its target');
  assert.equal((await again.equipAddon('harness','SCWZR300')).ok,true);
  await again.purchaseAircraft('HUGH500');
  assert.equal(again.loadout('HUGH500').harness,false,'new airframes retain manual fitting choices');
  assert.equal(again.loadout('HUGH500').cannon,true,'legacy fleet-wide order stays available');
});

test('legacy pilot receives one free hook, retaining the active water carrier and independent aircraft fits', async()=>{
  const f=fixture(12000),pilot=f.create();await pilot.ready;
  assert.ok((await pilot.purchaseAircraft('JETRANG')).ok);
  assert.ok((await pilot.purchaseEquipment('tank-small','JETRANG')).ok);
  assert.ok((await pilot.purchaseEquipment('cannon')).ok);
  const old=pilot.snapshot();
  old.ownedEquipment=old.ownedEquipment.filter(id=>id!=='hook');
  f.storage.setItem(CAREER_KEY,JSON.stringify(old));pilot.dispose();
  const a=f.create(),b=f.create();await Promise.all([a.ready,b.ready]);
  assert.deepEqual(a.snapshot().fittings,old.fittings);
  assert.equal(a.snapshot().revision,old.revision+1);
  assert.equal(a.snapshot().cash,old.cash);
  assert.equal(a.fit('JETRANG').water.kind,'tank');
  assert.ok((await a.equipAddon('hook','SCWZR300')).ok);
  assert.equal(a.canUse('hook','SCWZR300'),true);
  assert.equal(a.fit('SCWZR300').water,null);
  assert.equal(a.canUse('bucket','SCWZR300'),false);
  assert.equal(a.canUse('cannon','SCWZR300'),false);
  assert.equal(a.canUse('hook','JETRANG'),false);
  const reload=f.create();await reload.ready;
  assert.equal(reload.fit('SCWZR300').mounted.water,'hook');
  assert.equal(reload.fit('JETRANG').water.id,'tank-small');
  assert.ok((await reload.equipAddon('bucket','SCWZR300')).ok);
  assert.equal(reload.canUse('hook','SCWZR300'),false);
  assert.equal(reload.canUse('cannon','SCWZR300'),true);
  assert.equal(reload.snapshot().cash,old.cash);
  assert.equal((await reload.equipAddon('hook','MD520')).code,'not-owned');
  a.dispose();b.dispose();reload.dispose();
});

test('sequential upgrades are paid once, independently for each airframe',async()=>{
  const f=fixture(30000),a=f.create(),b=f.create();await Promise.all([a.ready,b.ready]);
  assert.equal((await a.purchaseUpgrade('engine-2')).code,'missing-requirement');
  assert.equal((await a.purchaseUpgrade('engine-1','JETRANG')).code,'not-owned');
  const both=await Promise.all([a.purchaseUpgrade('engine-1'),b.purchaseUpgrade('engine-1')]);
  assert.deepEqual(both.map(v=>v.code).sort(),['already-owned','upgraded']);
  await a.purchaseUpgrade('engine-2');
  const beforeFailure=a.snapshot();
  f.storage.fail=true;
  assert.equal((await a.purchaseUpgrade('engine-3')).code,'storage-failed');
  assert.deepEqual(a.snapshot(),beforeFailure);
  f.storage.fail=false;
  await a.purchaseAircraft('JETRANG');
  await a.purchaseUpgrade('generator-1','JETRANG');
  await a.purchaseUpgrade('rotor-1','JETRANG');
  const reload=f.create();await reload.ready;
  const starter=reload.fit('SCWZR300'),jet=reload.fit('JETRANG');
  assert.equal(starter.modifiers.speedFactor,1.10);
  assert.equal(starter.modifiers.climbFactor,1);
  assert.deepEqual(jet.levels,{engine:0,rotor:1,generator:1});
  assert.equal(jet.modifiers.speedFactor,1);
  assert.equal(jet.modifiers.climbFactor,1.09);
  assert.equal(jet.modifiers.yawFactor,1.06);
  assert.equal(jet.modifiers.spoolFactor,1.15);
  assert.equal(jet.modifiers.pumpFactor,1.15);
});

test('career reset replaces a progressed pilot once and fences out every old tab',async()=>{
  const f=fixture(30000),pilot=f.create(),oldTab=f.create();
  await Promise.all([pilot.ready,oldTab.ready]);
  const oldId=pilot.snapshot().profileId;
  const settings={'simcopter.sound':'off','simcopter.quality':'mobile','simcopter.scheme':'modern'};
  for(const [name,value] of Object.entries(settings))f.storage.setItem(name,value);
  assert.ok((await pilot.purchaseAircraft('JETRANG')).ok);
  assert.ok((await pilot.selectAircraft('JETRANG')).ok);
  assert.ok((await pilot.purchaseEquipment('harness','JETRANG')).ok);
  assert.ok((await pilot.purchaseUpgrade('engine-1','JETRANG')).ok);
  assert.ok((await pilot.beginSession('old-flight','JETRANG','sea-cliff')).ok);
  assert.ok((await pilot.maintainAircraft('old-flight','JETRANG',{fuelGallons:15,damagePoints:61,gas:4})).ok);
  assert.ok((await pilot.settleSession('old-flight',totals(1,200,{score:400,completed:4}))).ok);
  assert.ok((await pilot.finishCity('sea-cliff')).ok);
  const beforeReset=f.storage.writes;
  const results=await Promise.all([pilot.resetCareer(oldId),oldTab.resetCareer(oldId)]);
  assert.equal(results.filter(r=>r.ok).length,1);
  assert.equal(f.storage.writes,beforeReset+1,'replacement is one profile write under the same lock');
  const p=JSON.parse(f.storage.getItem(CAREER_KEY));
  assert.notEqual(p.profileId,oldId);
  assert.equal(p.cash,1000);
  assert.equal(p.selectedAircraft,'SCWZR300');
  assert.deepEqual(p.ownedAircraft,['SCWZR300']);
  assert.deepEqual(p.ownedEquipment,['bucket','megaphone','hook']);
  for(const stat of ['score','completed','partial','failed'])assert.equal(p[stat],0);
  for(const field of ['sessions','fittings','airframes','cityScores'])assert.deepEqual(p[field]??{},{});
  assert.deepEqual(p.clearedCities??[],[]);
  assert.equal(p.campaignLevel??1,1);
  for(const [name,value] of Object.entries(settings))assert.equal(f.storage.getItem(name),value);
  const obsolete=results[0].ok?oldTab:pilot;
  f.events.fire({key:CAREER_KEY,storageArea:f.storage});
  const stale=await Promise.all([
    obsolete.purchaseEquipment('harness'),obsolete.settleSession('old-flight',totals(2,2000)),
    obsolete.resetCareer(oldId),obsolete.beginSession('stale','SCWZR300','sea-cliff'),
  ]);
  assert.ok(stale.every(r=>!r.ok));
  assert.equal(f.storage.writes,beforeReset+1,'stale commands cannot mutate the new pilot');
  const reopened=f.create();await reopened.ready;
  assert.deepEqual(reopened.snapshot(),p,'legacy money does not migrate again on reload');
  assert.ok((await reopened.purchaseEquipment('harness')).ok);
  assert.equal(reopened.snapshot().cash,200);
});

test('a failed career replacement can be retried while the original save stays usable',async()=>{
  const f=fixture(5400),pilot=f.create();await pilot.ready;
  const before=f.storage.getItem(CAREER_KEY),oldId=pilot.snapshot().profileId;
  f.storage.fail=true;
  assert.equal((await pilot.resetCareer(oldId)).ok,false);
  assert.equal(f.storage.getItem(CAREER_KEY),before);
  f.storage.fail=false;
  assert.ok((await pilot.purchaseEquipment('harness')).ok);
  assert.ok((await pilot.resetCareer(oldId)).ok);
  assert.equal(pilot.snapshot().cash,1000);
});

test('opening an existing v1 pilot preserves the save, resetting it fences out v1-only clients',async()=>{
  const f=fixture(5400),previous=f.create();await previous.ready;
  const original={...previous.snapshot(),version:1};previous.dispose();
  f.storage.setItem(CAREER_KEY,JSON.stringify(original));
  const writes=f.storage.writes,next=f.create();await next.ready;
  assert.deepEqual(next.snapshot(),original);
  assert.equal(f.storage.writes,writes,'reading an existing pilot must not rewrite it');
  assert.ok((await next.resetCareer(original.profileId)).ok);
  assert.equal(next.snapshot().version,2,'older clients reject this replacement at their version check');
});

test('a successful write is durable even when storage loses read access immediately afterward',async()=>{
  for(const operation of ['restart','reset']){
    const f=fixture(),pilot=f.create();await pilot.ready;
    assert.ok((await pilot.beginSession('shift','SCWZR300','sea-cliff')).ok);
    const oldProfileId=pilot.snapshot().profileId,writes=f.storage.writes;
    let committed=false;
    f.storage.getItem=function(key){
      if(committed)throw Error('Storage read access revoked after successful write');
      return Store.prototype.getItem.call(this,key);
    };
    f.storage.setItem=function(key,value){Store.prototype.setItem.call(this,key,value);committed=true;};
    const result=operation==='restart'?
      await pilot.restartSession('shift',totals(1,135),'SCWZR300',{fuelGallons:21,damagePoints:10,gas:4}):
      await pilot.resetCareer(oldProfileId);
    assert.equal(result.ok,true,'return the outcome of the completed '+operation+' transaction');
    assert.equal(f.storage.writes,writes+1);
    const durable=JSON.parse(f.storage.map.get(CAREER_KEY));
    assert.deepEqual(pilot.snapshot(),durable);assert.deepEqual(result.profile,durable);
    if(operation==='restart'){
      assert.equal(durable.sessions.shift.closed,true);assert.equal(durable.sessions[result.sessionId].closed,false);
      assert.equal(durable.cash,1135);
    }else{
      assert.notEqual(durable.profileId,oldProfileId);assert.deepEqual(durable.sessions,{});assert.equal(durable.cash,1000);
    }
  }
});

test('flight restart atomically settles the old receipt, preserves condition and opens one replacement',async()=>{
  const f=fixture(),pilot=f.create();await pilot.ready;
  const city='sea-cliff',aircraft='SCWZR300',condition={fuelGallons:16.25,damagePoints:54,gas:3};
  assert.ok((await pilot.beginSession('shift',aircraft,city)).ok);
  assert.ok((await pilot.settleSession('shift',totals(1,60,{score:10}))).ok);
  const receipt={...totals(2,95,{score:30,completed:1}),adjustments:[{id:2,cash:35,points:20}]};
  const before=f.storage.getItem(CAREER_KEY),writes=f.storage.writes;
  f.storage.fail=true;
  assert.equal((await pilot.restartSession('shift',receipt,aircraft,condition)).ok,false);
  assert.equal(f.storage.getItem(CAREER_KEY),before,'the old shift stays open when replacement cannot commit');
  f.storage.fail=false;
  const duplicates=await Promise.all(Array.from({length:2},()=>pilot.restartSession('shift',receipt,aircraft,condition)));
  const p=pilot.snapshot(),next=Object.keys(p.sessions).find(id=>id!=='shift');
  assert.ok(duplicates.some(result=>result.ok));
  assert.equal(f.storage.writes,writes+1,'double confirmation makes a single durable change');
  assert.equal(Object.keys(p.sessions).length,2);
  assert.equal(p.sessions.shift.closed,true);
  assert.equal(p.sessions.shift.ledger,2);
  assert.equal(p.sessions[next].closed,false);
  assert.equal(p.sessions[next].ledger,0);
  assert.equal(p.sessions[next].city,city);
  assert.equal(p.sessions[next].aircraft,aircraft);
  assert.equal(p.airframes[aircraft].owner,next);
  for(const [name,value] of Object.entries(condition))assert.equal(p.airframes[aircraft][name],value);
  assert.equal(p.cash,1095);assert.equal(p.score,30);assert.equal(p.completed,1);
  assert.equal(p.cityScores[city],30);
  assert.equal((await pilot.maintainAircraft('shift',aircraft,{fuelGallons:38.5,damagePoints:0})).ok,false);
  assert.equal((await pilot.closeSession('shift',receipt)).code,'session-closed');
  assert.equal(f.storage.writes,writes+1);
});
