// The full call is recorded in one take so the dispatcher carries the same
// intonation from the location into the instruction.
const location = ['도시 북동부','도시 북부','도시 북서부','도시 동부','도심','도시 서부','도시 남동부','도시 남부','도시 남서부'];
const calls = {
  D1001: area => `구조 헬기, ${area}에서 화재 신고가 들어왔습니다. 출동하세요.`,
  D1005: area => `${area}에서 구조 요청이 들어왔습니다. 상공에서 위치를 확인해 주세요.`,
  D1006: area => `${area}에 승객이 기다리고 있습니다. 그쪽으로 가 주세요.`,
  D1007: area => `${area}에서 강도 신고가 들어왔습니다. 경찰이 항공 지원을 요청했습니다.`,
  D1008: area => `${area}에서 차량 한 대가 도주 중입니다. 상공에서 추적하세요.`,
  D1009: area => `${area}에서 방화가 의심되는 불이 났습니다. 주변에서 용의자를 찾아 주세요.`,
  D1010: area => `${area}에서 절도 신고가 들어왔습니다. 경찰의 용의자 수색을 도와주세요.`,
  D1012: area => `${area}에서 행인이 강도를 당했습니다. 달아난 용의자를 찾아 주세요.`,
  D1013: area => `구조대, ${area}에 부상자가 있습니다. 병원까지 이송해 주세요.`,
  D1014: area => `${area}의 교차로에서 차들이 꼼짝을 못 합니다. 교통 정리 부탁합니다.`,
  D1015: area => `${area}에서 군중 사이에 싸움이 벌어졌습니다. 현장 지원 바랍니다.`,
};
const results = {
  DIS053:'불이 꺼졌습니다. 진화 지원 고맙습니다.',
  DIS055:'승객 도착 확인했습니다. 수고하셨습니다.',
  DIS056:'용의자를 확보했습니다. 지원 고맙습니다.',
  DIS057:'순찰대가 차량 단속을 마쳤습니다. 수고하셨습니다.',
  DIS059:'차들이 다시 움직입니다. 교통 지원 고맙습니다.',
  DIS060:'군중이 해산했습니다. 수고하셨습니다.',
  DIS061:'구조 완료 확인했습니다. 수고하셨습니다.',
  DIS062:'전복된 배에서 구조한 분이 병원에 도착했습니다. 수고하셨습니다.',
};

const englishLocation = ['on the northeast side', 'on the north side', 'on the northwest side',
  'on the east side', 'downtown', 'on the west side',
  'on the southeast side', 'on the south side', 'on the southwest side'];
const englishCalls = {
  D1001: area => `Air Rescue, we have a fire ${area}. Respond to the scene.`,
  D1005: area => `Air Rescue, someone ${area} is calling for help. Can you take a look?`,
  D1006: area => `There's a passenger waiting for a pickup ${area}.`,
  D1007: area => `We've had a robbery reported ${area}. Police are asking for air support.`,
  D1008: area => `Air Rescue, a vehicle is fleeing the scene ${area}. See if you can keep it in sight.`,
  D1009: area => `Possible arson ${area}. Help ground units find the suspect.`,
  D1010: area => `We've had a theft reported ${area}. Head that way.`,
  D1012: area => `A pedestrian's just been robbed ${area}. See if you can spot the suspect.`,
  D1013: area => `Air Rescue, we have an injured person ${area}. We need a flight to the hospital.`,
  D1014: area => `Traffic's at a standstill ${area}. Can you help get it moving?`,
  D1015: area => `A fight's broken out in a crowd ${area}. Ground units need your help.`,
};
const englishResults = {
  DIS053: "Ground crews confirm the fire's out. Thanks for the assist.",
  DIS055: "Copy, your passenger's at the destination. You're clear.",
  DIS056: "Police have the suspect in custody. Thanks for the assist.",
  DIS057: "Patrol has finished the traffic stop. You're clear.",
  DIS059: "Traffic's moving again. Thanks for your help up there.",
  DIS060: "The crowd has dispersed. Air Rescue, you're clear.",
  DIS061: "Everyone's accounted for. Good work up there.",
  DIS062: "The survivor from the capsized boat is at the hospital. Good work, Air Rescue.",
};

function makePhrases(locations, callScripts, resultScripts) {
  const phrases = new Map();
  for (const [call, line] of Object.entries(callScripts)) {
    locations.forEach((area, index) => {
      const sector = 'L00'+(index+1);
      const key = call+'-'+sector+(call==='D1013' ? '-D2018' : '');
      phrases.set(key, line(area));
    });
  }
  for (const [id, line] of Object.entries(resultScripts)) phrases.set(id+'-DIS067', line);
  return phrases;
}

// Each entry names an entire recording, shared by the renderer and the radio.
export const dispatchPhrases = makePhrases(location, calls, results);
export const dispatchPhrasesEn = makePhrases(englishLocation, englishCalls, englishResults);

export function dispatchPhrase(ids, language = 'ko') {
  const english = language === 'en';
  const key = ids.join('-'), text = (english ? dispatchPhrasesEn : dispatchPhrases).get(key);
  if (!text) return null;
  const folder = english ? '../art/audio/dispatch/en/' : '../art/audio/dispatch/';
  const url=new URL(folder+key+'.mp3',import.meta.url);
  url.searchParams.set('voice','4');
  return {text,url:url.href};
}
