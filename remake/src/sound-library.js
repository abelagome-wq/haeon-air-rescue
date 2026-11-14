import radio from './original-radio-data.js';
import spokenLines from './spoken-lines.js';
import {dialogueLines} from './dialogue-lines.js';
import {songsById} from './radio-program.js';

const effects = {
  COPLOOP:'헬기 로터 · 회전음', CHOPSTAR:'헬기 엔진 · 시동',
  BLIP1:'조작 확인음', CA_CHING:'보상 지급',
  TSCREECH:'타이어 급제동', SIREN:'긴급 차량 사이렌',
  FIRESTAR:'발화', WATERCAN:'물 분사', FIREDMG:'화염 피해',
  GASOUT:'최루가스 분사', CRSH2:'강한 충돌', SOFTBMP2:'가벼운 충돌',
  CHOPSTOP:'헬기 엔진 · 정지', WINCHLP:'구조 윈치', SPLISH:'양동이 급수', DOUSE:'화점 진화',
  DOROPN:'기체 문 열기', DORCLS:'기체 문 닫기', HORN1:'차량 경적', TRAIN1:'열차 통과',
  FIREALRT:'화재 경보', FIRESIRE:'소방차 사이렌', AMBSRN11:'구급차 사이렌',
  POLICESI:'경찰차 사이렌', TGPOP:'최루탄 발사',
};
const genres = {jazz:'재즈',rock:'록',techno:'테크노',classic:'클래식'};
const audioRoot = new URL('../art/audio/synth/', import.meta.url);
const megaphoneGroups = ['교통 우회','정차','대피','해산','인사'];
function recordingURL(id, language='ko') {
  const spoken = Object.hasOwn(spokenLines,id);
  const url = new URL((spoken && language==='en'?'en/':'')+id+'.mp3',audioRoot);
  if (spoken) url.searchParams.set('voice','4');
  return url.href;
}

function radioEntry([id, clip]) {
  const song=songsById.get(id);
  if(song)return {id,group:'라디오 음악',label:genres[song.genre]+' · '+song.title,url:recordingURL(id)};
  let label = clip.text, group = '출동 무전';
  if (id.startsWith('L')) group = '위치 안내';
  if (id.startsWith('DIS')) group = '임무 결과';
  if (id.startsWith('POL') || id.startsWith('MDVC')) {
    group = '지원 무전';
    label = (id.startsWith('POL') ? '경찰' : '구급대') + ' 무전 ' + id.match(/\d+$/)[0];
  } else if (id.startsWith('AD')) {
    group = '광고';
    label = '라디오 광고 ' + Number(id.slice(2));
  } else if (id.startsWith('DJ') || clip.file.endsWith('.mp3')) {
    const isDJ = id.startsWith('DJ'), list = isDJ ? 'dj' : 'tracks';
    const genre = Object.keys(genres).find(key => radio.stations[key][list].includes(id));
    group = isDJ ? 'DJ 멘트' : '라디오 음악';
    label = genres[genre] + (isDJ ? ' 방송 멘트 ' : ' 음악 ') + (radio.stations[genre][list].indexOf(id) + 1);
  }
  return {id, group, label:spokenLines[id] || label, url:recordingURL(id)};
}

function fieldEntry([id,label]) {
  let group = '현장 음성';
  if (id.startsWith('MG_')) group = '확성기 · ' + megaphoneGroups[Number(id.slice(3,5))];
  else if (/^D\d{4}$/.test(id)) group = '출동 무전';
  else if (/^(?:POL|MDVC)/.test(id)) group = '지원 무전';
  else if (id.startsWith('DIS')) group = Number(id.slice(3)) <= 105 || ['DIS118','DIS121','DIS122'].includes(id) ? '지원 무전' : '임무 결과';
  return {id,group,label,url:recordingURL(id)};
}

export const soundEntries = [
  ...Object.entries(spokenLines).filter(([id]) => !Object.hasOwn(radio.clips,id)).map(fieldEntry),
  ...Object.entries(radio.clips).map(radioEntry),
  ...[...songsById.keys()].filter(id=>!Object.hasOwn(radio.clips,id)).map(id=>radioEntry([id,{}])),
  ...Object.entries(effects).map(([id,label]) => ({id, group:'효과음', label, url:new URL(id+'.wav', audioRoot).href})),
];
const entriesById = new Map(soundEntries.map(entry => [entry.id, entry]));
const isSpeech = id => Object.hasOwn(spokenLines,id);
const originalURL = (id,lang) => isSpeech(id) ? recordingURL(id,lang) : entriesById.get(id)?.url;
const labelFor = (id,lang) => dialogueLines(lang)[id] || entriesById.get(id)?.label || '';
// Existing Korean uploads keep their old IndexedDB keys. An English voice
// replacement has its own key; music and effects stay shared.
const keyFor = (id,lang) => isSpeech(id) && lang==='en' ? 'en:'+id : id;
const idOf = key => key.startsWith('en:') ? key.slice(3) : key;
const custom = new Map(), listeners = new Set();
const collection = 'replacements';

function openDatabase() {
  return new Promise((resolve,reject) => {
    const opening = indexedDB.open('simcopter-sound-files', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(collection, {keyPath:'id'});
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => {
      opening.onsuccess = () => opening.result.close();
      reject(Error('다른 게임 탭을 닫은 뒤 다시 시도하세요.'));
    };
  });
}

async function access(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction(collection, mode);
      const request = action(tx.objectStore(collection));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || request.error || Error('파일 저장을 마치지 못했습니다.'));
    });
  } finally { db.close(); }
}

function apply(key, record) {
  const id = idOf(key), previous = custom.get(key);
  const preset=entriesById.get(record?.sourceId);
  if(preset&&preset.id!==id)custom.set(key,{sourceId:preset.id});
  else if(record?.file instanceof Blob)custom.set(key,{name:record.file.name,url:URL.createObjectURL(record.file),blob:true});
  else custom.delete(key);
  try {
    for (const notify of listeners) notify(id,isSpeech(id)?(key.startsWith('en:')?'en':'ko'):undefined);
  } finally {
    if (previous?.blob) URL.revokeObjectURL(previous.url);
  }
}

const ready = access('readonly', store => store.getAll()).then(rows => {
  for (const row of rows) if (typeof row.id==='string' && entriesById.has(idOf(row.id))) apply(row.id,row);
}).catch(() => {}); // Originals are playable even when the browser disallows storage.

let pending = ready;
function inOrder(action) {
  const operation = pending.then(action);
  pending = operation.catch(() => {});
  return operation;
}

let channel;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel('simcopter-sound-files');
    channel.onmessage = ({data:id}) => {
      if (typeof id==='string' && entriesById.has(idOf(id))) inOrder(async () => apply(id, await access('readonly', store => store.get(id))));
    };
  } catch { /* Cross-tab notifications are optional. */ }
}

async function validate(file) {
  if (!(file instanceof Blob) || !file.size) throw Error('내용이 있는 오디오 파일을 선택하세요.');
  const Decoder = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Decoder) throw Error('이 브라우저에서 오디오 파일을 확인할 수 없습니다.');
  try {
    const decoder = new Decoder(1, 1, 44100);
    const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
    if (!decoded.length) throw Error();
  } catch { throw Error('재생할 수 없는 오디오 파일입니다. WAV 또는 MP3 등 브라우저가 지원하는 파일을 선택하세요.'); }
}

function change(id, record, language) {
  const key=keyFor(id,language);
  return inOrder(async () => {
    if (!entriesById.has(id)) throw Error('목록에 없는 소리입니다.');
    if(record&&Object.hasOwn(record,'sourceId')){
      if(!entriesById.has(record.sourceId)||record.sourceId===id)throw Error('교체에 사용할 다른 내장 소리를 선택하세요.');
    }else if(record) await validate(record.file);
    try {
      await access('readwrite', store => record ? store.put({...record,id:key}) : store.delete(key));
    } catch (error) {
      throw Error(error.name === 'QuotaExceededError' ? '브라우저 저장 공간이 부족합니다. 다른 교체 파일을 기본 소리로 복원한 뒤 다시 시도하세요.' : '이 브라우저에 변경 사항을 저장할 수 없습니다. 사이트 저장 권한을 확인하세요.');
    }
    apply(key, record);
    channel?.postMessage(key);
  });
}

export const soundLibrary = {
  ready,
  originalURL, label:labelFor,
  url(id,lang='ko') { const r=custom.get(keyFor(id,lang));return r?.url || originalURL(r?.sourceId || id,lang); },
  filename(id,lang='ko') { const r=custom.get(keyFor(id,lang));return r?.sourceId ? labelFor(r.sourceId,lang) : r?.name || ''; },
  preset(id,lang='ko') { return custom.get(keyFor(id,lang))?.sourceId || ''; },
  caption(id,lang='ko') { const r=custom.get(keyFor(id,lang));return r?.blob ? '' : dialogueLines(lang)[r?.sourceId || id] || ''; },
  replace(id,file,lang='ko') { return change(id,file===null?null:{file},lang); },
  replaceWithPreset(id,sourceId,lang='ko') { return change(id,{sourceId},lang); },
  reset(id,lang='ko') { return change(id,null,lang); },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
