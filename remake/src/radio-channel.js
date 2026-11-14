// Only transmissions from the operations desk and responding units use the handheld radio.
export function isRadioVoice(id) {
  return /^(?:D\d{4}|DIS\d{3}|L\d{3}|POL\d+|MDVC\d+)$/.test(id);
}

export function createRadioChannel(context, output) {
  if (typeof context.createBiquadFilter !== 'function') {
    return {input:output, key:() => context.currentTime, release:() => Promise.resolve(),
      cancel() {}, dispose() {}};
  }
  function filter(type, hz, q, gain = 0) {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = hz;
    node.Q.value = q;
    node.gain.value = gain;
    return node;
  }
  const input = filter('highpass',360,.7);
  const presence = filter('peaking',1650,.85,4);
  const lowpass = filter('lowpass',3120,.66);
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 9;
  compressor.ratio.value = 3.3;
  compressor.attack.value = .004;
  compressor.release.value = .09;
  const drive = context.createWaveShaper();
  const curve = new Float32Array(1025);
  for (let i=0;i<curve.length;i++) {
    const x = 2*i/(curve.length-1)-1;
    curve[i] = Math.tanh(1.4*x)/1.25;
  }
  drive.curve = curve;
  input.connect(presence).connect(compressor).connect(drive).connect(lowpass).connect(output);

  // A squelch opens before the first syllable, stays quiet while the transmitter is keyed,
  // and briefly reveals the receiver noise again when the microphone is released.
  const noiseFilter = filter('bandpass',2100,.88);
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0;
  noiseFilter.connect(noiseGain).connect(output);
  const noise = context.createBuffer(1,Math.round(context.sampleRate*.47),context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i=0;i<samples.length;i++) samples[i] = Math.random()*2-1;
  let carrier = null, releaseDone = null, endRelease = null;
  function key() {
    const now = context.currentTime;
    if (carrier) return now;
    carrier = context.createBufferSource();
    carrier.buffer = noise;
    carrier.loop = true;
    carrier.connect(noiseFilter);
    const gain = noiseGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0,now);
    gain.linearRampToValueAtTime(.23,now+.006);
    gain.exponentialRampToValueAtTime(.038,now+.031);
    gain.exponentialRampToValueAtTime(.012,now+.055);
    carrier.start(now);
    return now+.055;
  }
  function clearCarrier() {
    if (!carrier) return;
    carrier.onended = null;
    carrier.disconnect();
    carrier = null;
    endRelease?.();
    releaseDone = endRelease = null;
  }
  function release() {
    if (!carrier) return Promise.resolve();
    if (releaseDone) return releaseDone;
    const now = context.currentTime, gain = noiseGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(.012,now);
    gain.linearRampToValueAtTime(.27,now+.012);
    gain.exponentialRampToValueAtTime(.065,now+.06);
    gain.exponentialRampToValueAtTime(.0001,now+.114);
    releaseDone = new Promise(resolve => { endRelease = resolve; });
    carrier.onended = clearCarrier;
    carrier.stop(now+.12);
    return releaseDone;
  }
  function cancel() {
    if (!carrier) return;
    carrier.stop();
    clearCarrier();
  }
  function dispose() {
    cancel();
    for (const node of [input,presence,compressor,drive,lowpass,noiseFilter,noiseGain]) node.disconnect();
  }
  return {input,key,release,cancel,dispose};
}

// Called directly from a preview-button gesture so the AudioContext can unlock on mobile.
export function playRadioPreview(url) {
  const abort = new AbortController();
  let context, channel, source, endClip, stopped = false;
  const finished = (async () => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    context = new Context();
    try {
      const [,buffer] = await Promise.all([context.resume(),(async () => {
        const response = await fetch(url,{signal:abort.signal});
        if (!response.ok) throw Error('HTTP '+response.status);
        return context.decodeAudioData(await response.arrayBuffer());
      })()]);
      if (stopped) return;
      const level = context.createGain();
      level.gain.value = .78;
      level.connect(context.destination);
      channel = createRadioChannel(context,level);
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(channel.input);
      const ended = new Promise(resolve => { endClip = source.onended = resolve; });
      source.start(channel.key());
      await ended;
      if (!stopped) await channel.release();
    } catch (error) {
      if (!stopped) throw error;
    } finally {
      source?.disconnect();
      channel?.dispose();
      if (context.state !== 'closed') await context.close().catch(() => {});
    }
  })();
  return {finished,stop() {
    if (stopped) return;
    stopped = true;
    abort.abort();
    if (source) { try { source.stop(); } catch {} endClip?.(); }
    channel?.cancel();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }};
}
