// Ctrl index, original label and Value, read from SIMCOPT/TWEAK/SIM3D.TWK.
// Keep literal labels: the Korean executable binds several to a different
// type of award than the English slider label suggests (see EVENTS below).
export const MISSION_CONTROLS = {
  "General Miss": [["Max Easy",2],["Easy Interval (secs)",380],["Interval Adj",0.2],["UFO Money",2000],["UFO Points",1000]],
  "Riot Miss": [["Riot End Money",725],["Riot End Points",505],["End Money Penalty",0],["End Points Penalty",250],["Riot Timer (secs)",197.8]],
  "Rescue Miss": [["Resc End Money(pp)",200],["Resc End Points(pp)",100],["Resc Inc Money(pp)",50]],
  "Transport Miss": [["End Money(pp)",100],["End Points(pp)",50],["Inc Trans (pp$)",20],["Inc Pickup (pp$)",10]],
  "Medevac Miss": [["Med End Money(pp)",200],["Med End Points(pp)",100],["Inc Medevac (pp$)",30]],
  "Fire Miss": [["End Money(*size)",150],["End Points(*size)",100],["End Money Penalty",0],["End Points Penalty",50],["Plane Crash($)",200],["Plane Crash(pts)",100],["Train Crash($)",100],["Train Crash(pts)",100],["Car Fire($)",100],["Car Fire(pts)",50],["Debris Fire($)",50],["Debris Fire(pts)",50],["Flame($)",20],["Flame(neg pts)",50],["Bldg Dest(neg pts)",200],["Bldg Saved($)",150],["New Debris(neg pts)",50],["Debris Doused($)",20],["Car Doused($)",30],["Car Burned(neg pts)",20]],
  "Criminal Miss": [["End Money",500],["End Points",300]],
  "Speeder Miss": [["End Money",200],["End Points",100],["Incmtl Points",5]],
  "Traffic Miss": [["End Jam Money",100],["End Jam Points",50],["Jam Timer (secs)",60]],
};
export const AUTO_SCAN = {fire:5,road:5}; // AUTOMSSN.TWK, controls 0 and 1
// 21REF requires a ground-response fee; 22/23REF require a clinician fee.
// Their exact prices have not been established from the original. These are
// the existing remake rates, explicitly separate from verified awards.
export const REMAKE_SERVICE_FEES=Object.freeze({response:10,doctor:25,officer:25});
const setting=(section,index)=>MISSION_CONTROLS[section+' Miss'][index][1];
export const JAM_SECONDS=setting('Traffic',2), RIOT_SECONDS=setting('Riot',4);
const names={traffic:'Traffic',transport:'Transport',medevac:'Medevac',rescue:'Rescue',
  fire:'Fire',criminal:'Criminal',speeder:'Speeder',riot:'Riot'};
export const ORIGINAL_END_REWARDS=Object.freeze(Object.fromEntries(Object.entries(names).map(([key,section])=>
  [key,Object.freeze({cash:setting(section,0),points:setting(section,1)})])));

// Korean EXE 004ABAD0 computes completion separately from intermediate
// events. 004ABE2E clamps negative completion money to zero, permits negative points.
export function completion(type,units=1){
  const base=ORIGINAL_END_REWARDS[type];
  return {cash:Math.max(0,Math.trunc(base.cash*units)),points:Math.trunc(base.points*units)};
}
export function passengerCompletion(type,delivered,picked,lost,train=false){
  // Event 19 increments +A4. Native integer SAR 2 counts only full groups
  // of four pickups; the relevant lost person counter subtracts one unit.
  // 004ABBC7..004ABC0F: rescue bit 0x100 doubles rescued people and
  // does not quarter pickup count. 0x110/0x118 use RT574 "열차 구조".
  return completion(type,train&&type==='rescue'?2*delivered+picked-lost:delivered+(picked>>2)-lost);
}
export function riotCompletion(remaining){
  return completion('riot',Math.max(0,6-remaining)/6);
}

// RT_STRING 540 formats cash; 541 formats points. Korean EXE 004AB030's
// switch calls 0047A550 for cash and 0047A5F0 for points. 004AC0AC..004AC29F
// binds these globals to the TWK indices. 941's $3 and 939's 40-point
// loss are data defaults at 00507234 and 005071E0, not editable TWK fields.
// Event 20 awards BOTH 10 cash and 10 points per departing rioter.
const event=(id,label,cash,points)=>Object.freeze({id,label,cash,points});
export const ECONOMY_EVENTS=Object.freeze({
  fireSpread:event(930,'화재가 확산중',0,-setting('Fire',12)),
  flameDoused:event(931,'화재가 진압됨',setting('Fire',13),0),
  buildingLost:event(932,'화재로 황폐된 지역',0,-setting('Fire',14)),
  buildingSaved:event(933,'지역이 보전됨',setting('Fire',15),0),
  debrisDoused:event(934,'잔해가 제거됨',setting('Fire',17),0),
  personRescued:event(935,'시민 구조',setting('Rescue',2),0),
  personTransported:event(936,'승객 목적지 도착',setting('Transport',2),0),
  patientDelivered:event(937,'부상자 병원 인계',setting('Medevac',2),0),
  personPickedUp:event(938,'시민 탑승',setting('Transport',3),0),
  personDied:event(939,'시민 사망',0,-40),
  carDoused:event(940,'화재 차량 제거',setting('Fire',18),0),
  trafficReleased:event(941,'차량이 풀림',3,0),
  carBurned:event(942,'차량이 전소됨',0,-setting('Fire',19)),
  speederWait:event(943,'헬기를 기다림',setting('Speeder',2),0),
  // The native roaming speeder reports event 38 with no associated call;
  // in the remake the same payment is posted by its incident's finish().
  speederCaught:event(944,'폭주족이 잡혔음',setting('Speeder',0),setting('Speeder',1)),
  ufoDown:event(945,'UFO가 격추됨',setting('General',3),setting('General',4)),
  personAssaulted:event(946,'시민 피습',0,-10),
  sos:event(947,'SOS',0,-10),
  robbery:event(948,'강도',0,-10),
  arsonistEscaped:event(949,'방화범 도주',0,-10),
  personWaiting:event(950,'시민이 기다림',0,-10),
  trafficWaiting:event(951,'차량이 기다림',0,-10),
  personInjured:event(952,'시민이 다쳤음',0,-40),
  helicopterCrash:event(953,'헬기가 추락했음',0,-100),
  civilianHarmed:event(954,'시민을 해쳤음',-300,-100),
  planeShotDown:event(955,'비행기가 격추됨',-200,-100),
  shipGrounded:event(956,'배가 좌초됨',-100,-100),
  trafficObstructed:event(957,'교통을 방해했음',-50,-50),
  trainDestroyed:event(958,'기차가 파괴됨',-150,-100),
  pilotFault:event(959,'조종사 과실',-75,-100),
  missileDamage:event(960,'미사일 피해',-200,-200),
  rioterDispersed:event(961,'폭도 해산',10,10),
});
const byId=new Map(Object.entries(ECONOMY_EVENTS).map(([key,r])=>[r.id,key]));
const nativeEvents={1:'fireSpread',2:'flameDoused',4:'buildingLost',6:'buildingSaved',9:'debrisDoused',
  16:'personRescued',17:'personTransported',18:'patientDelivered',19:'personPickedUp',20:'rioterDispersed',
  23:'personDied',26:'carDoused',27:'trafficReleased',28:'carBurned',33:'speederWait',38:'speederCaught',
  39:'ufoDown',40:'personAssaulted',41:'sos',42:'robbery',43:'arsonistEscaped',44:'personWaiting',
  45:'trafficWaiting',46:'helicopterCrash',47:'civilianHarmed',48:'planeShotDown',49:'shipGrounded',
  50:'trafficObstructed',51:'trainDestroyed',52:'pilotFault',53:'missileDamage'};
export function economyKey(value){
  if(typeof value==='number')return byId.get(value)??nativeEvents[value];
  return Object.hasOwn(ECONOMY_EVENTS,value)?value:undefined;
}

