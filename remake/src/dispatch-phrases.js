// The full call is recorded in one take so the dispatcher carries the same
// intonation from the location into the instruction.
const location = ['북동쪽','북쪽','북서쪽','동쪽','도심','서쪽','남동쪽','남쪽','남서쪽'];
const calls = {
  D1001: area => `구조대, 화재 출동입니다. 현장은 ${area}입니다.`,
  D1005: area => `${area}에서 구조 요청이 들어왔습니다. 현장 확인 바랍니다.`,
  D1006: area => `${area}에 승객이 기다리고 있습니다. 수송 부탁합니다.`,
  D1007: area => `${area}에서 강도 신고 들어왔습니다. 경찰 지원 바랍니다.`,
  D1008: area => `${area}에서 차량 한 대가 도주 중입니다. 상공에서 추적 바랍니다.`,
  D1009: area => `${area}에 방화 신고 들어왔습니다. 용의자 확인 바랍니다.`,
  D1010: area => `${area}에서 절도 신고가 들어왔습니다. 현장으로 가 주세요.`,
  D1012: area => `${area}에서 행인이 강도를 당했습니다. 현장 확인 바랍니다.`,
  D1013: area => `구조대, ${area}에 부상자가 있습니다. 병원까지 이송해 주세요.`,
  D1014: area => `${area} 도로가 꽉 막혔습니다. 교통 정리 부탁합니다.`,
  D1015: area => `${area}에서 군중이 충돌하고 있습니다. 현장 지원 바랍니다.`,
};
const results = {
  DIS053:'현장 진화 확인했습니다. 수고하셨습니다.',
  DIS055:'승객 도착 확인했습니다. 수고하셨습니다.',
  DIS056:'용의자를 확보했습니다. 지원 고맙습니다.',
  DIS057:'차량 단속 끝났습니다. 수고하셨습니다.',
  DIS059:'차들이 다시 움직입니다. 교통 지원 고맙습니다.',
  DIS060:'군중이 해산했습니다. 수고하셨습니다.',
  DIS061:'구조 완료 확인했습니다. 수고하셨습니다.',
  DIS062:'선원 전원 구조됐습니다. 수고하셨습니다.',
};

// This same list feeds the offline speech renderer and the game's lookup.
export const dispatchPhrases = new Map();
for (const [call,line] of Object.entries(calls)) {
  location.forEach((area, index) => {
    const sector = 'L00'+(index+1);
    const key = call+'-'+sector+(call==='D1013' ? '-D2018' : '');
    dispatchPhrases.set(key,line(area));
  });
}
for (const [id,line] of Object.entries(results)) dispatchPhrases.set(id+'-DIS067',line);

export function dispatchPhrase(ids) {
  const key = ids.join('-'), text = dispatchPhrases.get(key);
  if (!text) return null;
  return {text,url:new URL('../art/audio/dispatch/'+key+'.mp3',import.meta.url).href};
}
