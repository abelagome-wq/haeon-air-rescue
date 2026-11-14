export const citySizes = Object.freeze({small:'소형',medium:'중형',large:'대형'});

// A pilot's randomly assigned ID fixes the initial layout across reloads and
// devices that restore the same save. Rotating a size advances only that slot.
export function citySeed(profile,size) {
  if (!Object.hasOwn(citySizes,size)) throw Error('도시 규모를 확인하세요.');
  let hash=2166136261;
  for (const char of profile.profileId+'|'+size) hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return (hash+Math.imul(profile.cityLayouts?.[size]??0,0x9e3779b9))>>>0;
}

export function campaignDistrict(size,level=1) {
  return 'district-'+size+'-'+Math.max(1,Math.min(10,level));
}

const goals=[400,700,1000,1200,1500,1800,2000,2200,2400,2700];
const bonuses=[500,500,450,400,350,300,250,200,150,100];
export function districtRoute(key) {
  const parsed=/^district-(small|medium|large)-(10|[1-9])$/.exec(key);
  if (!parsed) return null;
  const level=Number(parsed[2]);
  return {level,goal:goals[level-1],bonus:bonuses[level-1]};
}
