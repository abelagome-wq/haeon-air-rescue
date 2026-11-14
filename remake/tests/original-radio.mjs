import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalRadio,originalTransmission} from '../src/original-radio.js';
import {setVoiceMode} from '../src/device-speech.js';
import spokenLines from '../src/spoken-lines.js';
import {dialogueLines} from '../src/dialogue-lines.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fakeEnvironment() {
  const fetches = [], paths = [], sources = [], media = [];
  const document = new EventTarget();
  document.hidden = false;
  class Audio extends EventTarget {
    paused = true;
    constructor() { super(); media.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
    removeAttribute() {}
  }
  class AudioContext {
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createGain() { return {gain:{value:0,setTargetAtTime(){}},connect(){},disconnect(){}}; }
    createMediaElementSource() { return {connect(){},disconnect(){}}; }
    decodeAudioData(bytes) { return Promise.resolve(bytes); }
    createBufferSource() {
      const source = {connect(){},disconnect(){},start(){ sources.push(source); },stop(){ source.stopped=true; }};
      return source;
    }
  }
  async function fetch(url) {
    fetches.push(url.pathname.split('/').pop());
    paths.push(url.pathname);
    return {ok:true,arrayBuffer:async () => new ArrayBuffer(2)};
  }
  return {document,Audio,AudioContext,fetch,fetches,paths,sources,media};
}

test('medical call and result captions match the Korean synthesis scripts',() => {
  assert.deepEqual(originalTransmission({kind:'dispatch',type:'medevac',sector:'C'}),{
    ids:['D1013','L005','D2018'],text:[spokenLines.D1013,spokenLines.L005,spokenLines.D2018].join(' ')});
  assert.deepEqual(originalTransmission({kind:'complete',type:'medevac'}),{
    ids:['DIS116','DIS067'],text:[spokenLines.DIS116,spokenLines.DIS067].join(' ')});
  assert.deepEqual(originalTransmission({kind:'dispatch',type:'speeder'}).ids,[]);
  assert.deepEqual(originalTransmission({kind:'dispatch',type:'traffic',sector:'NE'}).ids,['D1014','L001']);
  assert.deepEqual(originalTransmission({kind:'complete',type:'transport'}).ids,['DIS055','DIS067']);
});

test('calls identify the incident and actual sector, then report the observed outcome',()=>{
  for(const [type,variant,clip] of [['rescue','boat','D1018'],['rescue','roof','D1017'],['rescue','train','D1019'],
    ['fire','large','D1020'],['traffic','burning','D1021'],['riot','major','D1016']]){
    const {ids,text}=originalTransmission({kind:'dispatch',type,variant,sector:'남서'});
    assert.deepEqual(ids,[clip,'L009']);assert.equal(text,spokenLines[clip]+' '+spokenLines.L009);
  }
  for (const [kind,reason,clip] of [['failed','escapedSuspect','DIS107'],['failed','escapedDriver','DIS108'],
    ['failed','reservationExpired','DIS109'],['failed','casualty','DIS110'],['partial','incompleteTransfer','DIS111'],
    ['partial','groundFireCrew','DIS113'],['partial','fireLoss','DIS112'],['partial','delayedTraffic','DIS114'],
    ['partial','crowdReport','DIS115'],['failed','timeout','DIS106'],['failed','unavailable','DIS117'],
    ['failed','blockedTraffic','DIS119'],['failed','fireExpired','DIS120']]){
    assert.deepEqual(originalTransmission({kind,reason}),{ids:[clip],text:spokenLines[clip]});
  }
  assert.deepEqual(originalTransmission({kind:'update',clip:'D1023'}),{ids:['D1023'],text:spokenLines.D1023});
});

test('a single-take dispatch uses its own caption and returns to the component clips when one is replaced', async () => {
  const environment = fakeEnvironment(), captions = [], files = new Map();
  const url = filename => new URL(filename,'https://game.test/').href;
  let notifyFile;
  const library = {
    ready:Promise.resolve(), filename:id => files.get(id),
    url:id => url(files.get(id) || id+'.mp3'),
    subscribe(fn) { notifyFile = fn; return () => {}; },
  };
  const phrase = {url:url('full-medical-call.mp3'),text:'구조대, 도심에 부상자가 있습니다. 병원으로 후송 바랍니다.'};
  const radio = createOriginalRadio({environment,library,station:'off', phraseURL:() => phrase,
    onSpeech:caption => captions.push(caption.text)});
  try {
    await radio.init();
    radio.notify({kind:'dispatch',type:'medevac',sector:'C'});
    await settle();
    assert.deepEqual(environment.fetches,['full-medical-call.mp3']);
    assert.deepEqual(captions,[phrase.text]);
    files.set('L005','custom-center.wav');
    notifyFile('L005');
    for (const id of ['D1013','L005','D2018']) {
      await settle();
      assert.equal(radio.state.clip,id);
      environment.sources.at(-1).onended();
    }
    await settle();
    assert.equal(radio.state.speaking,false);
    assert.deepEqual(environment.fetches,['full-medical-call.mp3','D1013.mp3','custom-center.wav','D2018.mp3']);
    assert.deepEqual(captions,[phrase.text,[spokenLines.D1013,spokenLines.L005,spokenLines.D2018].join(' ')]);
  } finally { radio.dispose(); }
});

test('local device narration finishes before the newest loudspeaker request starts and stops on pause',async () => {
  const environment = fakeEnvironment(), said = [], captions = [];
  const localKorean = {lang:'ko-KR',localService:true};
  let cancelled = 0;
  environment.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  environment.speechSynthesis = {
    getVoices:() => [{lang:'ko-KR',localService:false}, {lang:'en-US',localService:true}, localKorean],
    speak(line) { said.push(line); line.onstart(); },
    cancel() { cancelled++; },
  };
  const radio = createOriginalRadio({environment,station:'off',onSpeech:value => captions.push(value.text)});
  setVoiceMode('device');
  try {
    await radio.init();
    for (const clip of ['MG_00_00','MG_01_00','MG_04_00']) radio.notify({kind:'megaphone',clip});
    await settle();
    assert.deepEqual(said.map(line => line.text), [spokenLines.MG_00_00]);
    assert.equal(said[0].voice,localKorean);
    assert.deepEqual(captions,[spokenLines.MG_00_00]);
    said[0].onend();
    await settle();
    assert.deepEqual(captions,[spokenLines.MG_00_00,spokenLines.MG_04_00]);
    assert.deepEqual(said.map(line => line.text),captions);
    radio.pause();
    await settle();
    assert.equal(cancelled,1);
    assert.equal(radio.state.speaking,false);
    assert.deepEqual(environment.fetches,[]);
  } finally { radio.dispose(); setVoiceMode('builtin'); }
});

test('unavailable Korean device voice falls back to the bundled field recording',async () => {
  const environment = fakeEnvironment();
  environment.SpeechSynthesisUtterance = class {};
  environment.speechSynthesis = {getVoices:() => [{localService:false,lang:'ko-KR'},{localService:true,lang:'en-US'}]};
  const radio = createOriginalRadio({environment,station:'off'});
  setVoiceMode('device');
  try {
    await radio.init();
    radio.notify({kind:'field',clip:'FIELD_RESCUE'}); await settle();
    assert.deepEqual(environment.fetches,['FIELD_RESCUE.mp3']);
    assert.equal(radio.state.clip,'FIELD_RESCUE');
    environment.sources[0].onended(); await settle();
    assert.equal(radio.state.speaking,false);
  } finally { radio.dispose(); setVoiceMode('builtin'); }
});

test('a language switch stops the active transmission and voices it and queued calls in the new language',async () => {
  const environment = fakeEnvironment(), captions = [], ducks = [];
  const english = dialogueLines('en');
  const {ids,text} = originalTransmission({kind:'dispatch',type:'cargo',sector:'SE'},'en');
  assert.deepEqual(ids,['D1024','L007']);
  assert.equal(text,[english.D1024,english.L007].join(' '));
  const radio = createOriginalRadio({environment,station:'off',onSpeech:x=>captions.push(x),onDuck:x=>ducks.push(x)});
  try {
    await radio.init();
    radio.notify({kind:'field',clip:'FIELD_RESCUE',id:1});
    radio.notify({kind:'service',clip:'MDVC5',id:2});
    await settle();
    const original = environment.sources.at(-1);
    assert.equal(radio.state.clip,'FIELD_RESCUE');
    assert.equal(radio.setLanguage('en'),true);
    await settle();
    assert.ok(original.stopped);
    assert.equal(radio.state.clip,'FIELD_RESCUE');
    environment.sources.at(-1).onended(); await settle();
    assert.equal(radio.state.clip,'MDVC5');
    environment.sources.at(-1).onended(); await settle();
    assert.deepEqual(captions.map(c=>[c.language,c.text]),[
      ['ko',spokenLines.FIELD_RESCUE],['en',english.FIELD_RESCUE],['en',english.MDVC5]]);
    assert.match(environment.paths[0],/\/synth\/FIELD_RESCUE\.mp3$/);
    assert.match(environment.paths[1],/\/synth\/en\/FIELD_RESCUE\.mp3$/);
    assert.match(environment.paths[2],/\/synth\/en\/MDVC5\.mp3$/);
    assert.equal(ducks.at(-1),1);
    radio.setEnabled(false);
    radio.notify({kind:'field',clip:'FIELD_HARNESS',id:3});
    assert.equal(captions.at(-1).text,english.FIELD_HARNESS);
    assert.equal(environment.paths.length,3);
  } finally { radio.dispose(); }
});

test('device speech selects an English local voice and falls back to English recordings when unavailable',async () => {
  const environment=fakeEnvironment(), said=[];
  const voice={lang:'en_GB',localService:true};
  let voices=[{lang:'ko-KR',localService:true},{lang:'en-US',localService:false},voice];
  environment.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  environment.speechSynthesis={getVoices:()=>voices,speak(line){said.push(line);line.onstart();},cancel(){}};
  const radio=createOriginalRadio({environment,station:'off',language:'en'});
  setVoiceMode('device');
  try {
    await radio.init();
    radio.notify({kind:'field',clip:'FIELD_RESCUE',id:1});await settle();
    assert.equal(said[0].voice,voice);
    assert.equal(said[0].text,dialogueLines('en').FIELD_RESCUE);
    said[0].onend();await settle();
    voices=voices.filter(v=>v!==voice);
    radio.notify({kind:'megaphone',clip:'MG_00_00'});await settle();
    assert.equal(said.length,1);
    assert.match(environment.paths.at(-1),/\/synth\/en\/MG_00_00\.mp3$/);
  } finally {radio.dispose();setVoiceMode('builtin');}
});

test('speech remains on with the station off, deduplicates a call, and resumes the rotor after speech',async () => {
  const environment = fakeEnvironment(), ducks = [], captions = [];
  const radio = createOriginalRadio({environment,onDuck:v => ducks.push(v),onSpeech:v => captions.push(v)});
  radio.setStation('off');
  const call = {kind:'dispatch',type:'medevac',sector:'C',id:7};
  radio.notify(call);
  assert.equal(radio.notify(call),false);
  await radio.init();
  for (const id of ['D1013','L005','D2018']) {
    await settle();
    assert.equal(radio.state.clip,id);
    environment.sources.at(-1).onended();
  }
  await settle();
  assert.deepEqual(ducks,[.38,1]);
  assert.deepEqual(environment.fetches,['D1013.mp3','L005.mp3','D2018.mp3']);
  assert.equal(captions.length,1);
  assert.equal(radio.state.playing,false);
  radio.dispose();
});

test('station interludes advance, dispatch interrupts ads, hidden and muted game audio clears',async () => {
  const environment = fakeEnvironment();
  const captions=[];
  const radio = createOriginalRadio({environment,station:'rock',language:'en',rng:()=>.1,onSpeech:x=>captions.push(x)});
  await radio.init(); await settle();
  assert.equal(radio.state.stationName,'KROC');
  assert.equal(radio.state.playing,true);
  const music = environment.media[0];
  const firstSong=radio.state.track;
  music.paused = true;
  music.dispatchEvent(new Event('ended'));
  await settle();
  assert.match(radio.state.clip,/^DJ/);
  assert.equal(captions.at(-1).event.kind,'station');
  assert.equal(captions.at(-1).text,dialogueLines('en')[radio.state.clip]);
  assert.match(environment.paths.at(-1),/\/synth\/en\/DJ/);
  environment.sources.at(-1).onended(); await settle();
  assert.notEqual(radio.state.track,firstSong);
  music.paused=true;music.dispatchEvent(new Event('ended'));await settle();
  if(radio.state.clip.startsWith('DJ')){environment.sources.at(-1).onended();await settle();}
  assert.match(radio.state.clip,/^AD/);
  assert.equal(captions.at(-1).text,dialogueLines('en')[radio.state.clip]);
  radio.notify({kind:'complete',type:'transport',id:1}); await settle();
  assert.equal(radio.state.clip,'DIS055');
  assert.ok(radio.state.track&&radio.state.title);
  environment.document.hidden = true;
  environment.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(radio.state.playing,false);
  assert.equal(radio.state.speaking,false);
  environment.document.hidden = false;
  environment.document.dispatchEvent(new Event('visibilitychange'));
  await settle(); assert.equal(radio.state.playing,true);
  radio.pause(); assert.equal(radio.state.paused,true);
  radio.pause(false); await settle();
  radio.setEnabled(false); assert.equal(radio.state.playing,false);
  radio.notify({kind:'failed',type:'rescue'}); await settle();
  assert.equal(radio.state.speaking,false);
  radio.dispose();
});
