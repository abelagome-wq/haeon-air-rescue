// Fan-remake upgrades and water carriers. The original five tool IDs also act
// as defaults for saves created before individual aircraft could be outfitted.
const catalog = rows => Object.freeze(rows.map(row => Object.freeze(row)));
export const BASE_WATER_LITRES = 240;

export const ADDON_CATALOG = catalog([
  {id:'bucket', name:'물양동이 소', slot:'water', kind:'bucket', capacityLitres:BASE_WATER_LITRES, price:500, starter:true, description:'240 L · 수면에 줄을 내려 급수하고 공중에서 투하합니다.'},
  {id:'megaphone', name:'확성기', slot:'megaphone', price:500, starter:true, description:'교통 우회, 정차, 대피, 군중 해산을 지시합니다.'},
  {id:'harness', name:'구조 밧줄', slot:'harness', price:800, description:'착륙할 수 없는 현장에서 시민을 끌어 올립니다.'},
  {id:'cannon', name:'물대포', slot:'cannon', price:1500, description:'장착한 물양동이나 물탱크의 물을 전방으로 분사합니다.'},
  {id:'gas', name:'최루탄 발사대', slot:'gas', price:2500, description:'폭동 진압과 도보 범죄자 검거에 사용합니다.'},
  {id:'bucket-medium', name:'물양동이 중', slot:'water', kind:'bucket', capacityLitres:420, price:900, description:'420 L · 수면에 내려 급수하는 중형 물양동이입니다.'},
  {id:'bucket-large', name:'물양동이 대', slot:'water', kind:'bucket', capacityLitres:620, price:1500, description:'620 L · 대량 투하가 가능하며 만수 시 상승력이 줄어듭니다.'},
  {id:'tank-small', name:'물탱크 소', slot:'water', kind:'tank', capacityLitres:300, price:700, description:'300 L · 기체 하부에 고정해 줄을 내리지 않고 투하합니다.'},
  {id:'tank-medium', name:'물탱크 중', slot:'water', kind:'tank', capacityLitres:520, price:1350, description:'520 L · 기체 하부에 장착하는 중형 고정식 물탱크입니다.'},
  {id:'tank-large', name:'물탱크 대', slot:'water', kind:'tank', capacityLitres:760, price:2100, description:'760 L · 고정식 대형 물탱크이며 만수 시 상승력이 줄어듭니다.'},
  // The existing save slot "water" is the underbelly station shared by all three fittings.
  {id:'hook', name:'화물 고리', slot:'water', kind:'hook', price:0, starter:true, description:'줄을 내려 컨테이너를 연결하고, 하역장에 내려놓은 뒤 분리합니다.'},
]);

const upgradeTypes = {
  engine: {name:'엔진', prices:[650,1500,3000], effect:tier => `최고 속도 +${5*tier}%`},
  rotor: {name:'로터', prices:[550,1300,2500], effect:tier => `상승 속도 +${9*tier}%, 선회 속도 +${6*tier}%`},
  generator: {name:'발전기', prices:[400,950,1800], effect:tier => `로터 시동 응답과 급수 펌프 속도 +${15*tier}%`},
};
export const UPGRADE_CATALOG = catalog(Object.entries(upgradeTypes).flatMap(([category,type]) =>
  type.prices.map((price,index) => {
    const tier=index+1;
    return {id:`${category}-${tier}`, category, tier, price, name:`${type.name} ${tier}단계`, description:type.effect(tier)};
  })
));

const addons = new Map(ADDON_CATALOG.map(item => [item.id,item]));
const slots = {water:'bucket', megaphone:'megaphone', harness:'harness', cannon:'cannon', gas:'gas'};
const record = value => !!value && typeof value==='object' && !Array.isArray(value);
export const hasWaterCarrier = owned => owned.some(id => addons.get(id)?.capacityLitres > 0);

// Only explicit overrides are persisted. Missing slots inherit any original
// tools owned by the pilot. An explicit null means intentionally unmounted.
export function validAircraftFits(profile) {
  if (profile.manualMounts !== undefined && (!Array.isArray(profile.manualMounts) ||
      !profile.manualMounts.every(id => profile.ownedEquipment.includes(id)) ||
      new Set(profile.manualMounts).size!==profile.manualMounts.length)) return false;
  if (profile.fittings === undefined) return true;
  if (!record(profile.fittings)) return false;
  return Object.entries(profile.fittings).every(([id,fit]) => {
    if (!profile.ownedAircraft.includes(id) || !record(fit)) return false;
    if (fit.levels !== undefined && (!record(fit.levels) || !Object.entries(fit.levels).every(([category,tier]) =>
      Object.hasOwn(upgradeTypes,category) && Number.isInteger(tier) && tier>=0 && tier<=3))) return false;
    return fit.mounted === undefined || (record(fit.mounted) && Object.entries(fit.mounted).every(([slot,item]) =>
      Object.hasOwn(slots,slot) && (item===null || (addons.get(item)?.slot===slot && profile.ownedEquipment.includes(item)))));
  });
}

export function getUpgradeModifiers({engine=0, rotor=0, generator=0} = {}) {
  return {
    speedFactor:1 + .05*engine, climbFactor:1 + .09*rotor, yawFactor:1 + .06*rotor,
    spoolFactor:1 + .15*generator, pumpFactor:1 + .15*generator,
  };
}

export function getAircraftFit(profile, id=profile?.selectedAircraft) {
  const permitted = !!profile?.ownedAircraft.includes(id);
  const saved = permitted ? profile.fittings?.[id] : null;
  const levels = {engine:0, rotor:0, generator:0, ...saved?.levels};
  const mounted = {};
  for (const [slot,original] of Object.entries(slots)) {
    const fallback = permitted && profile.ownedEquipment.includes(original) &&
      !profile.manualMounts?.includes(original) ? original : null;
    mounted[slot] = saved?.mounted && Object.hasOwn(saved.mounted,slot) ? saved.mounted[slot] : fallback;
  }
  const external = addons.get(mounted.water);
  const water = external?.capacityLitres > 0 ? external : null;
  const tools = {bucket:!!water, hook:external?.kind === 'hook', megaphone:!!mounted.megaphone, harness:!!mounted.harness,
    cannon:!!mounted.cannon && !!water, gas:!!mounted.gas, spotlight:permitted};
  return {levels, mounted, water, tools, modifiers:getUpgradeModifiers(levels)};
}
