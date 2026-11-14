import catalog from './original-radio-data.js';

import {dialogueLines} from './dialogue-lines.js';
import {speakOnDevice} from './device-speech.js';
import {createRadioChannel,isRadioVoice} from './radio-channel.js';
import {createStationProgram,songsById} from './radio-program.js';

const mediaRoot = new URL('../art/audio/synth/', import.meta.url);
export const RADIO_STATIONS = Object.freeze(['off', 'jazz', 'rock', 'techno', 'classic', 'mix']);
const sectorNumbers = {NE:1,N:2,NW:3,E:4,C:5,W:6,SE:7,S:8,SW:9,
  북동:1,북:2,북서:3,동:4,중앙:5,서:6,남동:7,남:8,남서:9};
const baseCalls = {fire:'D1001', rescue:'D1005', transport:'D1006',
  criminal:'D1007', medevac:'D1013', traffic:'D1014', riot:'D1015', cargo:'D1024'};
const variantCalls = {
  criminal:{arsonist:'D1009',robber:'D1010',mugger:'D1012',getaway:'D1008'},
  rescue:{roof:'D1017',boat:'D1018',train:'D1019'}, fire:{large:'D1020'},
  traffic:{burning:'D1021'},riot:{major:'D1016'},
};
const outcomes = {fire:'DIS053', transport:'DIS055', criminal:'DIS056', speeder:'DIS057',
  traffic:'DIS059', riot:'DIS060', medevac:'DIS116', rescue:'DIS061', cargo:'DIS123'};
const incidentResults = {
  timeout:'DIS106', escapedSuspect:'DIS107', escapedDriver:'DIS108', reservationExpired:'DIS109',
  casualty:'DIS110', incompleteTransfer:'DIS111', fireLoss:'DIS112', groundFireCrew:'DIS113',
  delayedTraffic:'DIS114', crowdReport:'DIS115', unavailable:'DIS117', blockedTraffic:'DIS119', fireExpired:'DIS120',
};

// Resolve the incident before choosing the language. Both recordings describe the same call.
export function originalTransmission(event = {}, language = 'ko') {
  const spokenLines = dialogueLines(language);
  const {kind,type,variant} = event;
  let ids = [];
  if (kind === 'dispatch' && Object.hasOwn(baseCalls,type)) {
    const call = variantCalls[type]?.[variant] || baseCalls[type];
    ids.push(call);
    const sector = Number.isInteger(event.sector) ? event.sector : sectorNumbers[String(event.sector || '').toUpperCase()];
    if (sector >= 1 && sector <= 9) ids.push('L'+String(sector).padStart(3,'0'));
    if (type === 'medevac') ids.push('D2018');
  } else if (kind === 'failed' || kind === 'partial') {
    ids = [incidentResults[event.reason] || 'DIS058'];
  } else if (kind === 'complete' && Object.hasOwn(outcomes,type)) {
    ids = [type === 'rescue' && variant === 'boat' ? 'DIS062' : outcomes[type], 'DIS067'];
  } else if (kind === 'promotion') {
    ids = ['DIS063'];
  } else if (Object.hasOwn(spokenLines,event.clip) && (
    (kind === 'megaphone' && event.clip.startsWith('MG_')) ||
    (kind === 'update' && /^D\d{4}$/.test(event.clip)) ||
    (kind === 'field' && event.clip.startsWith('FIELD_')) ||
    (kind === 'service' && /^(?:POL|MDVC|DIS)/.test(event.clip)))) {
    ids = [event.clip];
  }
  const text = ids.map(id => spokenLines[id]).filter(Boolean).join(' ');
  return {ids,text};
}

export function createOriginalRadio({onState = () => {}, onSpeech = () => {}, onDuck = () => {},
  station = 'mix', language = 'ko', environment = globalThis, library, phraseURL, rng=Math.random, isNight=()=>false} = {}) {
  const doc = environment.document;
  const state = {language:language === 'en' ? 'en' : 'ko',station:'off',stationName:'OFF',track:'',title:'',playing:false,speaking:false,
    enabled:true,paused:false,error:'',clip:''};
  function clipURL(id) {
    if (library) return library.url(id,state.language);
    const spoken = Object.hasOwn(dialogueLines(state.language),id);
    const url = new URL((spoken && state.language === 'en' ? 'en/' : '')+id+'.mp3',mediaRoot);
    if (spoken) url.searchParams.set('voice','4');
    return url.href;
  }
  function captionFor(id) {
    return library?.caption?.(id,state.language) ?? dialogueLines(state.language)[id] ?? '';
  }
  function caption(job, ids = job.ids, text = ids.map(captionFor).filter(Boolean).join(' ')) {
    onSpeech({text,event:job.event,ids:[...ids],language:state.language});
  }
  const queue = [], cache = new Map(), recent = new Map();
  let storage;
  try{storage=environment.sessionStorage;}catch{}
  const program=createStationProgram({rng,storage,isNight});
  let context, music, musicLevel, speechLevel, radioChannel, mediaSource, spokenSource, speakingJob;
  let disposed = false, initialized = false, paused = false, generation = 0, duck = 1, upcoming='';
  let pendingBreak = false, trackSerial = 0, finishClip = null, deviceLine = null;
  const abort = new AbortController();
  const audible = () => initialized && state.enabled && !paused && !doc?.hidden && !disposed;
  function changed() { onState({...state}); }
  function report(error) {
    if (disposed || error?.name === 'AbortError') return;
    state.error = String(error?.message || error);
    changed();
  }
  function levels(factor) {
    if (musicLevel) musicLevel.gain.setTargetAtTime(.36*factor,context.currentTime,.06);
    if (duck !== factor) { duck = factor; onDuck(factor); }
  }
  function playMusic() {
    if (!audible() || pendingBreak || state.station === 'off') return;
    const key = state.track || upcoming || program.nextTrack(state.station);
    upcoming='';
    if(!key)return;
    const url = clipURL(key);
    if (state.track !== key || music.src !== url) {
      stopMusic();
      state.track = key;
      state.title = songsById.get(key)?.title??key;
      music.src = url;
    }
    if (!music.paused && !music.ended) return;
    const serial = ++trackSerial;
    let result;
    try { result = music.play(); } catch (error) { report(error); return; }
    Promise.resolve(result).then(() => {
      if (serial !== trackSerial || !audible()) return;
      state.playing = true;
      state.error = '';
      changed();
    }).catch(error => { if (serial === trackSerial && audible()) report(error); });
  }
  function stopMusic() {
    ++trackSerial;
    music?.pause();
    state.playing = false;
  }
  function stopSpeech(clearQueue = true) {
    ++generation;
    if (clearQueue) queue.length = 0;
    speakingJob = null;
    radioChannel?.cancel();
    deviceLine?.stop();
    deviceLine = null;
    if (spokenSource) {
      try { spokenSource.stop(); } catch {}
      finishClip?.();
    }
    state.speaking = false;
    state.clip = '';
    levels(1);
  }
  function clipBuffer(id,url) {
    if (cache.has(url)) return cache.get(url);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    abort.signal.addEventListener('abort',cancel,{once:true});
    const timer = setTimeout(cancel,12_000);
    const promise = environment.fetch(new URL(url),{credentials:'same-origin',signal:controller.signal})
      .then(response => {
        if (!response.ok) throw Error(id+' HTTP '+response.status);
        return response.arrayBuffer();
      }).then(bytes => context.decodeAudioData(bytes)).finally(() => {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort',cancel);
      });
    cache.set(url,promise);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    promise.catch(() => { if (cache.get(url) === promise) cache.delete(url); });
    return promise;
  }
  function playClip(buffer,id) {
    const overRadio = isRadioVoice(id);
    state.clip = id;
    state.speaking = true;
    levels(.38);
    changed();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(overRadio ? radioChannel.input : speechLevel);
    spokenSource = source;
    return new Promise(resolve => {
      finishClip = source.onended = () => {
        source.onended = null;
        source.disconnect();
        if (spokenSource === source) spokenSource = null;
        finishClip = null;
        resolve();
      };
      source.start(overRadio ? radioChannel.key() : context.currentTime);
    });
  }
  async function speak(id,token) {
    while (generation === token && audible()) {
      const url = clipURL(id);
      try {
        // Device speech has no AudioNode output to transmit through the radio.
        if (!isRadioVoice(id) && !library?.filename?.(id,state.language)) {
          const playback = speakOnDevice(captionFor(id),environment,state.language);
          if (playback) {
            deviceLine = playback;
            state.clip = id;
            state.speaking = true;
            levels(.38);
            changed();
            const finished = await playback.finished;
            if (deviceLine === playback) deviceLine = null;
            if (generation !== token || !audible()) return;
            if (url !== clipURL(id)) continue;
            if (finished) return;
          }
        }
        const buffer = await clipBuffer(id,url);
        if (generation !== token || !audible()) return;
        if (url !== clipURL(id)) continue;
        await playClip(buffer,id);
      } catch (error) {
        if (url === clipURL(id)) throw error;
      }
      if (url === clipURL(id)) return;
    }
  }
  function mergedPhrase(ids) {
    if (!phraseURL || ids.length < 2 || !ids.every(isRadioVoice) ||
      ids.some(id => library?.filename?.(id,state.language))) return null;
    const phrase = phraseURL(ids,state.language);
    return typeof phrase === 'string' ? {url:phrase} : phrase;
  }
  async function playMerged(job,token,phrase) {
    try {
      const buffer = await clipBuffer(phrase.url,phrase.url);
      if (generation !== token || !audible()) return true;
      if (mergedPhrase(job.ids)?.url !== phrase.url) return false;
      job.merged = true;
      caption(job,job.ids,phrase.text);
      await playClip(buffer,job.ids[0]);
      return mergedPhrase(job.ids)?.url === phrase.url;
    } catch { return false; } // The constituent clips remain playable.
    finally { job.merged = false; }
  }
  async function pump() {
    if (!audible() || speakingJob || !queue.length) return;
    const job = queue.shift(), token = generation;
    speakingJob = job;
    try {
      if (library) await library.ready;
      if (generation !== token || !audible()) return;
      const phrase = mergedPhrase(job.ids);
      if (!(phrase && await playMerged(job,token,phrase))) {
        if (generation !== token || !audible()) return;
        if (!job.break) caption(job);
        // Decode the next radio fragments before the microphone opens to avoid network gaps.
        if (job.ids.length > 1 && job.ids.every(isRadioVoice)) {
          for (const id of job.ids) void clipBuffer(id,clipURL(id)).catch(() => {});
        }
        for (const id of job.ids) {
          if (job.break) caption(job,[id]);
          await speak(id,token);
          if (generation !== token) return;
        }
      }
      if (generation === token) await radioChannel.release();
    } catch (error) {
      if (generation === token) { radioChannel.cancel(); report(error); }
    }
    finally {
      if (generation === token) {
        speakingJob = null;
        state.speaking = false;
        state.clip = '';
        levels(1);
        if (job.break) { pendingBreak = false; playMusic(); }
        changed();
        void pump();
      }
    }
  }
  function ended() {
    if (!audible() || state.station === 'off') return;
    state.playing = false;
    state.track='';state.title='';
    upcoming=program.nextTrack(state.station);
    const ids=speakingJob||queue.some(job=>!job.break)?[]:program.interlude(state.station,upcoming);
    if(!ids.length){playMusic();changed();return;}
    pendingBreak = true;
    queue.push({ids,break:true,event:{kind:'station',station:state.station}});
    changed();
    void pump();
  }
  function reconcile() {
    state.paused = paused || !!doc?.hidden;
    if (!audible()) {
      stopMusic();
      stopSpeech();
      pendingBreak = false;
    } else {
      playMusic();
      void pump();
    }
    changed();
  }
  function init() {
    if (disposed) return Promise.resolve(false);
    try {
      if (!context) {
        const Context = environment.AudioContext || environment.webkitAudioContext;
        context = new Context();
        music = new environment.Audio();
        music.preload = 'none';
        music.addEventListener('ended',ended);
        music.addEventListener('error',musicError);
        musicLevel = context.createGain();
        musicLevel.gain.value = .36;
        speechLevel = context.createGain();
        speechLevel.gain.value = .78;
        radioChannel = createRadioChannel(context,speechLevel);
        mediaSource = context.createMediaElementSource(music);
        mediaSource.connect(musicLevel);
        musicLevel.connect(context.destination);
        speechLevel.connect(context.destination);
      }
      // Start both playback mechanisms within the originating user gesture.
      const resume = context.resume();
      initialized = true;
      reconcile();
      return Promise.resolve(resume).then(() => true).catch(error => { report(error); return false; });
    } catch (error) { report(error); return Promise.resolve(false); }
  }
  function musicError() { if (audible()) report('방송 음악을 읽을 수 없습니다. '+state.track); }
  function setStation(value) {
    if (!RADIO_STATIONS.includes(value) || disposed) return false;
    if (value !== state.station) {
      stopMusic();
      for (let i = queue.length-1; i >= 0; i--) if (queue[i].break) queue.splice(i,1);
      if (speakingJob?.break) stopSpeech(false);
      pendingBreak = false;
      state.station = value;
      state.stationName = catalog.stations[value]?.name || 'OFF';
      state.track = '';
      upcoming = '';
      state.title = '';
      state.error = '';
      playMusic();
      void pump();
      changed();
    }
    return true;
  }
  function setLanguage(value) {
    if (disposed || (value !== 'ko' && value !== 'en')) return false;
    if (value === state.language) return true;
    // Jobs contain clip IDs and the original event. Restart the current call and
    // resolve every recording and caption in the chosen language at playback.
    const interrupted = speakingJob && {...speakingJob,merged:false};
    stopSpeech(false);
    state.language = value;
    if (interrupted) queue.unshift(interrupted);
    changed();
    void pump();
    return true;
  }
  function notify(event) {
    const message = originalTransmission(event,state.language);
    if (!message.ids.length || disposed) return false;
    const now = Date.now();
    if (event.id !== undefined) {
      const key = event.kind+'|'+event.type+'|'+event.id;
      if (now-(recent.get(key) || 0) < 10_000) return false;
      recent.set(key,now);
      if (recent.size > 40) recent.delete(recent.keys().next().value);
    }
    message.event = event;
    if (state.enabled && !paused && !doc?.hidden) {
      message.megaphone = event.kind === 'megaphone';
      // Discard a queued introduction when dispatch takes the channel.
      if(pendingBreak&&!speakingJob?.break){
        for(let i=queue.length-1;i>=0;i--)if(queue[i].break)queue.splice(i,1);
        pendingBreak=false;playMusic();
      }
      if (speakingJob?.break) {
        stopSpeech(false);
        pendingBreak = false;
        playMusic();
      }
      if (message.megaphone) {
        const pending = queue.findIndex(job => job.megaphone);
        if (pending !== -1) queue.splice(pending,1);
        queue.unshift(message);
      } else {
        const index = queue.findIndex(job => job.break);
        queue.splice(index === -1 ? queue.length : index,0,message);
      }
      if (queue.length > 12) {
        const discard = queue.findIndex(job => !job.break && !job.megaphone && job !== message);
        if (discard >= 0) queue.splice(discard,1);
      }
      void pump();
    } else caption(message);
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    abort.abort();
    stopMusic();
    stopSpeech();
    doc?.removeEventListener('visibilitychange',reconcile);
    music?.removeEventListener('ended',ended);
    music?.removeEventListener('error',musicError);
    if (music) { music.removeAttribute('src'); music.load(); }
    mediaSource?.disconnect();
    radioChannel?.dispose();
    musicLevel?.disconnect();
    speechLevel?.disconnect();
    context?.close().catch(() => {});
    cache.clear();
  }
  const unsubscribe = library?.subscribe((id,language) => {
    if (language && language !== state.language) return;
    if (state.track === id) playMusic();
    if (speakingJob && !speakingJob.merged && speakingJob.ids.includes(id)) {
      if (!speakingJob.break) caption(speakingJob);
      else if (state.clip === id) caption(speakingJob,[id]);
    }
    if (state.clip === id) deviceLine?.stop();
    if (spokenSource && (state.clip === id || (speakingJob?.merged && speakingJob.ids.includes(id)))) {
      try { spokenSource.stop(); } catch {}
      finishClip?.();
    }
  });
  doc?.addEventListener('visibilitychange',reconcile);
  // Avoid invoking the consumer during construction.
  if (RADIO_STATIONS.includes(station)) {
    state.station = station;
    state.stationName = catalog.stations[station]?.name || 'OFF';
  }
  return {state,init,notify,setStation,setLanguage,dispose,
    pause(value = true) { paused = !!value; reconcile(); },
    setEnabled(value) { state.enabled = !!value; reconcile(); }};
}
