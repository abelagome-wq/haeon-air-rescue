import {FLEET} from './fleet.js';
// Cargo extends the eight categories listed in the Korean 18REF reference.
export const MISSIONS = {
  speeder:{name:'과속 단속',variants:{patrol:'순찰 중 과속 차량 발견'}},
  traffic:{name:'교통 정체',variants:{gridlock:'교차로 정체',burning:'불타는 장애물'}},
  fire:{name:'화재 진압',variants:{small:'소규모 화재',large:'대형 화재'}},
  rescue:{name:'인명 구조',variants:{boat:'전복 선박',roof:'불타는 건물 옥상',train:'폭주 열차'}},
  medevac:{name:'의료 후송',variants:{street:'중상자 현장 후송'}},
  criminal:{name:'범죄자 검거',variants:{robber:'절도범',mugger:'노상강도',arsonist:'방화범',getaway:'도주 차량'}},
  transport:{name:'승객 수송',variants:{vip:'귀빈 예약 수송'}},
  cargo:{name:'화물 수송',variants:{container:'컨테이너 외부 인양'}},
  riot:{name:'폭동 진압',variants:{crowd:'거리 군중',major:'대규모 폭동'}},
};
export const TOOLS = {
  context:'현장 권장 작업', bucket:'물양동이', hook:'화물 고리', cannon:'물대포', harness:'구조 밧줄',
  board:'탑승 / 하차 · 운반', doctor:'의사 탑승 / 하차', officer:'경관 탑승 / 하차',
  firetruck:'소방차 급파', ambulance:'구급차 급파', police:'경찰차 급파', follow:'경찰 추적',
  traffic:'확성기 · 교통 우회', stop:'확성기 · 정차', evacuate:'확성기 · 대피', disperse:'확성기 · 해산', greet:'확성기 · 인사', gas:'최루탄',
};
export const SHORTCUTS = {F2:'firetruck',F3:'ambulance',F4:'police',F5:'follow',F6:'traffic',F7:'stop',F8:'evacuate',F9:'disperse',F10:'greet'};
// 40REF quotes total seats, including the pilot. Use the upper configuration of variable-seat civil models.
const SEATS=Object.fromEntries(FLEET.map(h => [h.id, h.seats]));
export function cabinCapacity(id){return SEATS[id]??1;}
export function splitMission(value){
  const [type,variant]=String(value||'').split('/');
  return MISSIONS[type] && Object.hasOwn(MISSIONS[type].variants,variant)?{type,variant}:null;
}
