import {FLEET} from './fleet.js';
// Original prices and starter ownership come from the Korean executable / HELI.TWK.
// Tool ownership follows the pilot. Upgrades and fitting choices belong to one airframe.
import routes from './career-routes.js';
import {citySizes,districtRoute} from './city-worlds.js';
import {ADDON_CATALOG, UPGRADE_CATALOG, getAircraftFit, hasWaterCarrier, validAircraftFits} from './aircraft-loadout.js';
export const CAREER_KEY = 'simcopter.career.v1';
export const STARTING_CASH = 1000;
// Pre-reset builds only accept v1. They must refuse writes to a replacement
// profile, even when an old tab still has that build loaded.
export const PROFILE_VERSION = 2;
const freezeCatalog = rows => Object.freeze(rows.map(row => Object.freeze({
  ...row, ...(row.requires ? {requires:Object.freeze(row.requires)} : {}),
})));
export const AIRCRAFT_CATALOG = freezeCatalog(FLEET.map(({id, name, designation, price}) => ({
  id, name, designation, price,
  ...(id === 'SCWZR300' ? {starter:true} : {}),
  ...(id === 'APACHE' ? {special:true, description:'원작의 특수 기체로, 격납고에서 구매할 수 있습니다.'} : {}),
})));
export const EQUIPMENT_CATALOG = ADDON_CATALOG;
const aircraft = new Map(AIRCRAFT_CATALOG.map(v=>[v.id,v]));
const equipment = new Map(EQUIPMENT_CATALOG.map(v=>[v.id,v]));
const upgrades = new Map(UPGRADE_CATALOG.map(v=>[v.id,v]));
const counters = ['cash','score','completed','failed','partial'];
const zeroTotals = () => ({ledger:0,cash:0,score:0,completed:0,failed:0,partial:0});
const clone = value => JSON.parse(JSON.stringify(value));
const numeric = value => typeof value==='number' && Number.isFinite(value) && Math.abs(value)<=Number.MAX_SAFE_INTEGER;
const count = value => Number.isSafeInteger(value) && value>=0;
const sameTotals = (a,b) => counters.every(k=>a[k]===b[k]);
const identifier = value => typeof value==='string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) &&
  !['__proto__','constructor','prototype'].includes(value);
const owns = (p,id) => p.ownedAircraft.includes(id);
class CareerError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
const fail = (code,message) => {throw new CareerError(code,message);};

function validateTotals(value){
  if(!value || !count(value.ledger) || !numeric(value.cash) || !numeric(value.score) ||
     !['completed','failed','partial'].every(k=>count(value[k])) || value.partial>value.completed)
    fail('invalid-receipt','출동 정산 값이 올바르지 않습니다.');
  return Object.fromEntries(['ledger',...counters].map(k=>[k,value[k]]));
}
function validateProfile(value){
  if(!value || (value.version!==1 && value.version!==PROFILE_VERSION))
    fail('unsupported-version','이 저장 기록은 다른 버전입니다. 기존 기록을 유지합니다.');
  if(!identifier(value.profileId) || !count(value.revision) || !numeric(value.cash) || !numeric(value.score) ||
     !['completed','failed','partial'].every(k=>count(value[k])) || value.partial>value.completed ||
     !Array.isArray(value.ownedAircraft) || !Array.isArray(value.ownedEquipment) ||
     !value.ownedAircraft.includes('SCWZR300') || !value.ownedAircraft.every(id=>aircraft.has(id)) ||
     !value.ownedEquipment.every(id=>equipment.has(id)) ||
     new Set(value.ownedAircraft).size!==value.ownedAircraft.length ||
     new Set(value.ownedEquipment).size!==value.ownedEquipment.length ||
     !value.ownedAircraft.includes(value.selectedAircraft) || !value.sessions ||
     typeof value.sessions!=='object' || Array.isArray(value.sessions))
    fail('invalid-profile','저장 기록을 읽지 못했습니다. 기존 기록을 유지합니다.');
  for(const [id,session] of Object.entries(value.sessions)){
    if(!identifier(id))fail('invalid-profile','출동 영수증 식별자가 올바르지 않습니다.');
    validateTotals(session);
    if(typeof session.closed!=='boolean')fail('invalid-profile','출동 영수증 상태가 올바르지 않습니다.');
  }
  if(value.ownedEquipment.includes('cannon')&&!hasWaterCarrier(value.ownedEquipment))
    fail('invalid-profile','물대포 저장 기록에 물양동이나 물탱크가 없습니다.');
  if(!validAircraftFits(value))fail('invalid-profile','기체별 장착 기록을 읽을 수 없습니다.');
  return value;
}

/**
 * Synchronous factory; await ready before mutations. Durable mutations use Web
 * Locks plus one localStorage profile write. No racy localStorage lease fallback
 * is used: if cross-tab locks are unavailable, reads remain usable and writes
 * return locking-unavailable. HTTPS/loopback modern browsers expose Web Locks.
 * Tests may inject {storage,locks,events,now,idFactory,key} without browser globals.
 * Snapshot is flat: cash, score, completed, failed, partial, ownedAircraft,
 * ownedEquipment, selectedAircraft, version, revision, profileId and sessions.
 */
export function createCareer(options={}){
  const key=options.key??CAREER_KEY, now=options.now??(()=>Date.now());
  const makeId=options.idFactory??(()=>globalThis.crypto?.randomUUID?.()??
    ('session-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)));
  let storage, locks;
  try{storage=Object.hasOwn(options,'storage')?options.storage:globalThis.localStorage;}catch{}
  try{locks=Object.hasOwn(options,'locks')?options.locks:globalThis.navigator?.locks;}catch{}
  const events=options.events??globalThis.window;
  const subscribers=new Set();let state=null,boundProfileId=null,disposed=false,tail=Promise.resolve();
  const replacedMessage='다른 창에서 경력이 초기화되었습니다. 새 경력으로 계속하려면 격납고를 다시 열어 주세요.';
  const status={ready:false,writable:!!storage&&typeof locks?.request==='function',code:'initializing',message:''};
  const snapshot=()=>state?clone(state):null;
  const notify=()=>{for(const fn of subscribers){try{fn(snapshot());}catch{}}};
  function readStored(){
    if(!storage)fail('storage-unavailable','브라우저 저장소를 사용할 수 없습니다.');
    let raw;try{raw=storage.getItem(key);}catch{fail('storage-unavailable','저장 기록에 접근할 수 없습니다.');}
    if(raw==null)return null;
    try{return validateProfile(JSON.parse(raw));}catch(e){
      if(e instanceof CareerError)throw e;
      fail('invalid-profile','저장 기록을 읽지 못했습니다. 기존 기록을 유지합니다.');
    }
  }
  function migrateInitialProfile(){
    let legacy=null,source='new',old=null;
    try{old=storage?.getItem('simcopter.record');}catch{fail('storage-unavailable','기존 비행 기록을 읽지 못했습니다.');}
    if(old!=null){
      try{legacy=JSON.parse(old);}catch{fail('invalid-legacy','이전 비행 기록이 손상되었습니다. 원본 기록을 유지합니다.');}
      if(!legacy || typeof legacy!=='object' || !numeric(legacy.cash))
        fail('invalid-legacy','이전 잔액을 확인할 수 없습니다. 원본 기록을 유지합니다.');
      source='simcopter.record';
    }else{
      const points=storage?.getItem('simcopter.points'), completed=storage?.getItem('simcopter.dispatches');
      if(points!=null||completed!=null){
        legacy={cash:0,score:Number(points)||0,completed:Number(completed)||0};source='legacy-counters';
      }
    }
    return freshProfile(legacy,source);
  }
  function freshProfile(legacy=null,source='new'){
    const p={version:PROFILE_VERSION,revision:0,profileId:makeId(),cash:legacy?legacy.cash:STARTING_CASH,
      ownedAircraft:['SCWZR300'],ownedEquipment:['bucket','megaphone','hook'],selectedAircraft:'SCWZR300',
      score:legacy&&numeric(legacy.score)?legacy.score:0,
      completed:legacy&&count(legacy.completed)?legacy.completed:0,
      failed:legacy&&count(legacy.failed)?legacy.failed:0,
      partial:legacy&&count(legacy.partial)?legacy.partial:0,
      campaignLevel:1,sessions:{},createdAt:now(),updatedAt:now(),migration:{source,at:now(),initialCashBonus:legacy?0:STARTING_CASH}};
    // No bonus and no floor/rounding for migrated cash, including negative cash.
    p.partial=Math.min(p.partial,p.completed);return validateProfile(p);
  }
  function result(ok,code,message,extra={}){return {ok,code,message,profile:snapshot(),...extra};}
  function noteError(e){status.code=e.code??'storage-failed';status.message=e.message;return result(false,status.code,status.message);}
  function commit(previous,candidate){
    candidate.revision=(previous?.revision??0)+1;candidate.updatedAt=now();
    validateProfile(candidate);
    const encoded=JSON.stringify(candidate);
    try{storage.setItem(key,encoded);}catch{fail('storage-failed','저장에 실패했습니다. 잔액과 구매 상태를 변경하지 않았습니다.');}
    // setItem is atomic, and the Web Lock covers every writer. A fallible
    // second read could report failure after a restart had already committed.
    state=candidate;boundProfileId=candidate.profileId;status.code='ready';status.message='';notify();
  }
  async function underLock(fn){
    if(disposed)return result(false,'disposed','이미 종료된 비행 기록입니다.');
    if(!storage)return result(false,'storage-unavailable','브라우저 저장소를 사용할 수 없습니다.');
    if(typeof locks?.request!=='function')return result(false,'locking-unavailable','이 브라우저에서 안전한 동시 저장을 사용할 수 없습니다.');
    try{return await locks.request('simcopter-career:'+key,{mode:'exclusive'},()=>{
      if(disposed)return result(false,'disposed','이미 종료된 비행 기록입니다.');
      return fn(readStored());
    });}catch(e){return noteError(e);}
  }
  const ready=underLock(current=>{
    if(!current)commit(null,migrateInitialProfile());
    else if(!current.ownedEquipment.includes('hook')){
      // Issue the new standard fitting without replacing the pilot's selected water carrier.
      commit(current,{...current,ownedEquipment:[...current.ownedEquipment,'hook']});
    }
    else {state=current;boundProfileId=current.profileId;}
    status.code='ready';status.message='';return result(true,'ready','');
  }).then(value=>{
    status.ready=true;
    if(!value.ok){status.code=value.code;status.message=value.message;try{state=readStored();}catch{}}
    notify();return {...value,profile:snapshot()};
  });
  function replaced(current){
    const changed=status.code!=='profile-replaced'||state?.revision!==current.revision||state?.profileId!==current.profileId;
    state=current;status.writable=false;status.code='profile-replaced';status.message=replacedMessage;
    if(changed)notify();
    return result(false,status.code,status.message);
  }
  function inCareer(fn,expectedProfileId=boundProfileId){
    const work=tail.catch(()=>{}).then(()=>ready).then(()=>underLock(current=>{
      if(!current)fail('missing-profile','비행 기록이 삭제되었습니다. 격납고를 다시 열어 주세요.');
      // A storage event can refresh the visible balance, but cannot rebind an
      // old tab's shop, flight, or pending confirmation to a different pilot.
      if(current.profileId!==boundProfileId)return replaced(current);
      state=current;
      if(expectedProfileId!=null&&current.profileId!==expectedProfileId)
        return result(false,'profile-replaced','초기화 전 경력에 대한 요청입니다.');
      return fn(current);
    }));
    tail=work;return work;
  }
  function transaction(change){
    return inCareer(current=>{
      const next=clone(current),outcome=change(next,current);
      if(outcome?.changed===false)return result(outcome.ok??true,outcome.code??'unchanged',outcome.message??'',outcome.extra);
      commit(current,next);return result(true,outcome?.code??'ok',outcome?.message??'',outcome?.extra);
    });
  }
  function resetCareer(expectedProfileId){
    if(!identifier(expectedProfileId))return Promise.resolve(result(false,'invalid-profile-id','초기화할 경력을 다시 확인하세요.'));
    return inCareer(current=>{
      const fresh=freshProfile(null,'reset');
      if(fresh.profileId===current.profileId)fail('profile-id-conflict','새 경력 식별자를 생성하지 못했습니다. 다시 시도하세요.');
      // Replace the key in one write. Removing it would allow initial migration
      // to import a retired simcopter.record again on the next load.
      commit(current,fresh);
      return result(true,'career-reset','경력을 초기화했습니다.');
    },expectedProfileId);
  }
  function ownedTarget(p,target) {
    const aircraftId=target??p.selectedAircraft;
    if(!owns(p,aircraftId))fail('not-owned','보유 중인 기체를 선택하세요.');
    return aircraftId;
  }
  function fitting(p,aircraftId) {
    p.fittings??={};
    return p.fittings[aircraftId]??={};
  }
  function mount(p,aircraftId,slot,id) {
    const record=fitting(p,aircraftId);
    record.mounted??={};
    record.mounted[slot]=id;
  }
  function pay(p,item) {
    if(p.cash<item.price)fail('insufficient-funds','§'+Math.ceil(item.price-p.cash)+'이 부족합니다.');
    p.cash-=item.price;
  }
  function purchase(id,kind,target){
    return transaction(p=>{
      const table=kind==='aircraft'?aircraft:equipment, list=kind==='aircraft'?p.ownedAircraft:p.ownedEquipment;
      const item=table.get(id);
      if(!item)fail('unknown-item','카탈로그에 없는 품목입니다.');
      const aircraftId=kind==='equipment'?ownedTarget(p,target):null;
      if(list.includes(id))return {changed:false,ok:false,code:'already-owned',message:'이미 보유하고 있습니다.'};
      if(id==='cannon'&&!hasWaterCarrier(p.ownedEquipment))
        fail('missing-requirement','먼저 물양동이나 물탱크를 구입하세요.');
      pay(p,item);list.push(id);
      // A shop order names its installation target. Untargeted legacy tool
      // purchases retain their original automatic installation on all aircraft.
      if(aircraftId && target!=null){
        p.manualMounts??=[];p.manualMounts.push(id);
      }
      if(aircraftId && getAircraftFit(p,aircraftId).mounted[item.slot]!==id)
        mount(p,aircraftId,item.slot,id);
      return {code:'purchased',message:item.name+' 구입 완료 · §'+item.price,extra:{itemId:id,paid:item.price}};
    });
  }
  function purchaseUpgrade(id,target) {
    return transaction(p=>{
      const aircraftId=ownedTarget(p,target),item=upgrades.get(id);
      if(!item)fail('unknown-item','카탈로그에 없는 업그레이드입니다.');
      const current=getAircraftFit(p,aircraftId).levels[item.category];
      if(item.tier<=current)return {changed:false,ok:false,code:'already-owned',message:'이미 설치한 단계입니다.'};
      if(item.tier!==current+1)fail('missing-requirement','이전 단계부터 설치하세요.');
      pay(p,item);
      const record=fitting(p,aircraftId);
      record.levels??={};record.levels[item.category]=item.tier;
      return {code:'upgraded',message:item.name+' 설치 완료',extra:{itemId:id,paid:item.price}};
    });
  }
  function changeMount(id,target,install) {
    return transaction(p=>{
      const aircraftId=ownedTarget(p,target),item=equipment.get(id);
      if(!item)fail('unknown-item','카탈로그에 없는 부품입니다.');
      if(!p.ownedEquipment.includes(id))fail('not-owned','먼저 부품을 구입하세요.');
      const current=getAircraftFit(p,aircraftId).mounted[item.slot];
      if(install ? current===id : current!==id)return {changed:false,code:'unchanged'};
      mount(p,aircraftId,item.slot,install?id:null);
      return {code:install?'equipped':'unequipped',message:item.name+(install?' 장착 완료':' 분리 완료')};
    });
  }
  const fit=id=>getAircraftFit(state,id);
  const loadout=id=>fit(id).tools;
  function assignAircraft(sessionId,id){
    return transaction(p=>{
      if(!owns(p,id)||!p.sessions[sessionId]||p.sessions[sessionId].closed)fail('not-owned','운항 가능한 기체를 선택하세요.');
      p.sessions[sessionId].aircraft=id;p.airframes??={};
      p.airframes[id]={...p.airframes[id],owner:sessionId};return {code:'aircraft-assigned'};
    });
  }
  function updateCondition(p,sessionId,id,condition,invoice=null){
    const session=p.sessions[sessionId],record=p.airframes?.[id];
    if(!session||session.closed||session.aircraft!==id||record?.owner!==sessionId)
      fail('aircraft-busy','같은 기체가 다른 출동에 배정됐습니다.');
    if(!condition||!numeric(condition.fuelGallons)||!numeric(condition.damagePoints)||
      condition.fuelGallons<0||condition.damagePoints<0)fail('invalid-condition','기체 상태를 확인할 수 없습니다.');
    if(invoice){
      if(!identifier(invoice.id)||!count(invoice.cost))fail('invalid-invoice','검사 비용을 확인할 수 없습니다.');
      if(record.invoice===invoice.id)return {changed:false,code:'already-serviced'};
      if(p.cash<invoice.cost)fail('insufficient-funds','정비 비용이 부족합니다.');
      p.cash-=invoice.cost;record.invoice=invoice.id;
    }else if(record.fuelGallons===condition.fuelGallons&&record.damagePoints===condition.damagePoints&&
      (condition.gas===undefined||condition.gas===record.gas))
      return {changed:false};
    Object.assign(record,{fuelGallons:condition.fuelGallons,damagePoints:condition.damagePoints});
    if(condition.gas!==undefined){
      if(!Number.isInteger(condition.gas)||condition.gas<0||condition.gas>10)fail('invalid-condition','최루가스 수량 오류');
      record.gas=condition.gas;
    }
    return {code:invoice?'serviced':'condition-saved'};
  }
  function settleReceipt(p,sessionId,totals,close=false){
    if(!identifier(sessionId)||!Object.hasOwn(p.sessions,sessionId))fail('unknown-session','출동 영수증이 없습니다.');
    const incoming=validateTotals(totals),receipt=p.sessions[sessionId];
    if(receipt.closed)return {changed:false,code:'session-closed',message:'이미 정산한 출동입니다.'};
    if(incoming.ledger<receipt.ledger)return {changed:false,code:'stale-receipt',message:'이전 정산 요청을 건너뛰었습니다.'};
    if(incoming.ledger===receipt.ledger){
      if(!sameTotals(incoming,receipt))fail('receipt-conflict','같은 출동 번호의 정산 금액이 다릅니다.');
      if(!close)return {changed:false,code:'duplicate-receipt',message:'이미 반영한 출동 정산입니다.'};
    }
    if(['completed','failed','partial'].some(k=>incoming[k]<receipt[k]))
      fail('invalid-receipt','출동 누적 건수가 이전 정산보다 작습니다.');
    const deltas={};for(const field of counters)deltas[field]=incoming[field]-receipt[field];
    const rows=totals.adjustments?.filter(row=>row.id>receipt.ledger);
    if(rows && (rows.length!==incoming.ledger-receipt.ledger ||
      !rows.every((row,i)=>row.id===receipt.ledger+i+1 && numeric(row.cash) && numeric(row.points)) ||
      rows.reduce((sum,r)=>sum+r.cash,0)!==deltas.cash || rows.reduce((sum,r)=>sum+r.points,0)!==deltas.score))
      fail('invalid-receipt','사건별 원장과 출동 합계가 일치하지 않습니다.');
    const city=receipt.city&&(districtRoute(receipt.city)||Object.hasOwn(routes,receipt.city))?receipt.city:null;
    if(city)p.cityScores??={};
    // Native account and score clamp after each signed event. A reward after
    // insolvency must still be paid in full, even if both events settle together.
    for(const row of rows??[{cash:deltas.cash,points:deltas.score}]){
      if(row.cash)p.cash=Math.max(0,p.cash+row.cash);
      if(row.points){
        p.score=Math.max(0,p.score+row.points);
        if(city)p.cityScores[city]=Math.max(0,(p.cityScores[city]??0)+row.points);
      }
    }
    for(const field of ['completed','failed','partial'])p[field]+=deltas[field];
    p.sessions[sessionId]={...receipt,...incoming,closed:close,updatedAt:now()};
    return {code:close?'session-closed':'settled',message:'',extra:{sessionId,deltas}};
  }
  function openSession(p,id,aircraftId,cityId){
    if(!identifier(id))fail('invalid-session','출동 식별자가 올바르지 않습니다.');
    if(Object.hasOwn(p.sessions,id))return {changed:false,ok:false,code:'session-exists',message:'이미 존재하는 출동입니다.',extra:{sessionId:id}};
    p.sessions[id]={...zeroTotals(),closed:false,createdAt:now(),updatedAt:now()};
    if(cityId){
      const route=districtRoute(cityId)||routes[cityId];if(!route||route.level>(p.campaignLevel??1))fail('city-locked','이 도시의 근무 단계가 아직 열리지 않았습니다.');
      p.sessions[id].city=cityId;
    }
    if(aircraftId){
      if(!owns(p,aircraftId))fail('not-owned','보유하지 않은 기체입니다.');
      p.sessions[id].aircraft=aircraftId;p.airframes??={};
      p.airframes[aircraftId]={...p.airframes[aircraftId],owner:id};
    }
    return {code:'session-started',extra:{sessionId:id}};
  }
  function restartSession(sessionId,totals,aircraftId,condition){
    return transaction(p=>{
      if(!identifier(sessionId)||!Object.hasOwn(p.sessions,sessionId))fail('unknown-session','출동 영수증이 없습니다.');
      const session=p.sessions[sessionId];
      if(session.closed)fail('session-closed','이미 마감한 비행입니다.');
      updateCondition(p,sessionId,aircraftId,condition);
      const closed=settleReceipt(p,sessionId,totals,true);
      if(closed.changed===false)return {...closed,ok:false};
      return openSession(p,makeId(),aircraftId,session.city);
    });
  }
  function refresh(){
    try{
      const incoming=readStored();
      if(!incoming){status.code='missing-profile';status.message='비행 기록이 삭제되었습니다.';state=null;notify();return result(false,status.code,status.message);}
      if(boundProfileId!=null&&incoming.profileId!==boundProfileId)return replaced(incoming);
      if(!state||incoming.profileId!==state.profileId||incoming.revision!==state.revision){state=incoming;notify();}
      return result(true,'refreshed','');
    }catch(e){return noteError(e);}
  }
  function onStorage(e){if((e.key===key||e.key===null)&&(!e.storageArea||e.storageArea===storage))refresh();}
  events?.addEventListener?.('storage',onStorage);
  return {
    ready,snapshot,fit,loadout,refresh,resetCareer,get status(){return {...status};},
    subscribe(fn){subscribers.add(fn);if(state)fn(snapshot());return()=>subscribers.delete(fn);},
    purchaseAircraft:id=>purchase(id,'aircraft'),purchaseEquipment:(id,target)=>purchase(id,'equipment',target),
    purchaseUpgrade,equipAddon:(id,target)=>changeMount(id,target,true),unequipAddon:(id,target)=>changeMount(id,target,false),
    selectAircraft(id){return transaction(p=>{
      if(!owns(p,id))fail('not-owned','먼저 이 헬리콥터를 구입해야 합니다.');
      if(p.selectedAircraft===id)return {changed:false};p.selectedAircraft=id;return {code:'selected'};
    });},
    maintainAircraft:(id,aircraftId,condition,invoice)=>transaction(p=>updateCondition(p,id,aircraftId,condition,invoice)),
    assignAircraft,restartSession,
    regenerateCity(size){return transaction(p=>{
      if(!Object.hasOwn(citySizes,size))fail('invalid-city-size','도시 규모를 확인하세요.');
      p.cityLayouts??={};
      p.cityLayouts[size]=((p.cityLayouts[size]??0)+1)>>>0;
      return {code:'city-generated'};
    });},
    finishCity(cityId){return transaction(p=>{
      const route=districtRoute(cityId)||routes[cityId];const score=p.cityScores?.[cityId]??0;
      if(!route||score<route.goal)fail('city-incomplete','도시 승진 점수에 도달하지 않았습니다.');
      p.clearedCities??=[];
      if(p.clearedCities.includes(cityId))return {changed:false,code:'already-cleared'};
      p.clearedCities.push(cityId);p.campaignLevel=Math.min(10,Math.max(p.campaignLevel??1,route.level+1));
      p.cash+=route.bonus;
      return {code:'promoted',message:'도시 근무 완료 · 승급 보너스 §'+route.bonus};
    });},
    beginSession:(id=makeId(),aircraftId=null,cityId=null)=>transaction(p=>openSession(p,id,aircraftId,cityId)),
    settleSession:(id,totals)=>transaction(p=>settleReceipt(p,id,totals)),
    closeSession:(id,totals)=>transaction(p=>settleReceipt(p,id,totals,true)),
    canUse(tool,id){const kit=loadout(id),required={bucket:'bucket',hook:'hook',cannon:'cannon',harness:'harness',gas:'gas',
      traffic:'megaphone',stop:'megaphone',evacuate:'megaphone',disperse:'megaphone',greet:'megaphone',megaphone:'megaphone'}[tool];return required?kit[required]:true;},
    dispose(){disposed=true;events?.removeEventListener?.('storage',onStorage);subscribers.clear();},
  };
}
