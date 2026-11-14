import {FLEET} from './fleet.js';
// The original nine use HELI.TWK capacity/burn/damage and the EXE repair
// table at 0x505408. The additional aircraft use their own service limits.
export const AIRFRAME_LIMITS = Object.freeze(Object.fromEntries(
  FLEET.map(({id, gallons, burn, damage, repairPrice}) =>
    [id, Object.freeze({gallons, burn, damage, fuelPrice:4, repairPrice})])
));

export function createAirframeSystems(state, aircraftPosition, pilotPosition, base) {
  const records = new Map();
  let id,limits,record;
  const baseDistance = () => Math.hypot(aircraftPosition.x-base.x,aircraftPosition.z-base.z);
  function refresh() {
    state.fuelGallons=record.fuel;
    state.fuel=100*record.fuel/limits.gallons;
    state.damagePoints=record.damage;
    state.damage=100*record.damage/limits.damage;
    state.atBase=baseDistance()<32&&Math.abs(aircraftPosition.y-base.y)<5;
    state.engine=state.damage>=100?'파손':state.fuel<=0?'연료 고갈':state.rpm<.04?'정지':state.rpm<.68?'시동 중':'가동';
    state.serviceCost=null;
    if(state.onFoot&&state.grounded){
      const q=quote({repair:state.atBase,refuel:true});
      if(q.ok)state.serviceCost=q.cost;
    }
  }
  function select(aircraftId) {
    id=aircraftId;limits=AIRFRAME_LIMITS[id];
    if(!records.has(id))records.set(id,{fuel:limits.gallons,damage:0});
    record=records.get(id);refresh();
  }
  function tick(dt) {
    // The original file supplies the hourly rate. Scaling that rate by rotor
    // speed during spool-up/down is a remake approximation.
    if(!state.onFoot&&state.rpm>.01)record.fuel=Math.max(0,record.fuel-limits.burn*state.rpm*dt/3600);
    refresh();
  }
  function impact(fraction,reason) {
    if(fraction<=0)return;
    record.damage=Math.min(limits.damage,record.damage+limits.damage*fraction);
    state.notice=reason;refresh();
  }
  function quote({repair=false,refuel=false}={}) {
    let message='';
    if(!state.grounded||!state.onFoot)message='안전하게 착륙한 뒤 기체에서 내려주세요.';
    else if(Math.hypot(pilotPosition.x-aircraftPosition.x,pilotPosition.z-aircraftPosition.z)>9)message='정비할 기체 옆으로 돌아가세요.';
    else if(!repair&&!refuel)message='급유 또는 수리를 선택하세요.';
    if(message)return {ok:false,cost:0,message};
    const gallons=refuel?limits.gallons-record.fuel:0;
    const damagePoints=repair?record.damage:0;
    const multiplier=state.atBase?1:3;
    const fuelCost=Math.floor(Math.max(0,gallons*limits.fuelPrice))*multiplier;
    const repairCost=Math.floor(Math.max(0,damagePoints*limits.repairPrice))*multiplier;
    const deliveryCost=0;
    const cost=fuelCost+repairCost;
    const after={fuelGallons:refuel?limits.gallons:record.fuel,damagePoints:repair?0:record.damage};
    return {ok:true,id,repair,refuel,fuelCost,repairCost,deliveryCost,cost,gallons,damagePoints,after,
      message:cost?'정비 견적 §'+cost:'기체가 정비되어 있습니다.'};
  }
  function service(options={}) {
    const q=quote(options);
    if(!q.ok)return q;
    if(q.refuel)record.fuel=limits.gallons;
    if(q.repair)record.damage=0;
    refresh();
    return {...q,message:q.cost?'정비 완료 · 연료 §'+q.fuelCost+' · 수리 §'+q.repairCost+
      (q.deliveryCost?' · 출장 §'+q.deliveryCost:''):'정비할 항목이 없습니다.'};
  }
  function condition(){return {fuelGallons:record.fuel,damagePoints:record.damage};}
  function restoreCondition(value){
    if(!Number.isFinite(value?.fuelGallons)||!Number.isFinite(value?.damagePoints))return false;
    record.fuel=Math.min(limits.gallons,Math.max(0,value.fuelGallons));
    record.damage=Math.min(limits.damage,Math.max(0,value.damagePoints));
    refresh();return true;
  }
  return {select,tick,impact,quote,service,refresh,condition,restoreCondition};
}
