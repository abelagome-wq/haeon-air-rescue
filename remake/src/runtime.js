import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createTexturePolicy} from './texture-policy.js';
import {applyOriginalLivery} from './original-livery.js';
import {soundLibrary} from './sound-library.js';
import {cloudField,createWeatherEffects} from './weather-effects.js';
import {createRotorWash} from './rotor-wash.js';
import {createFlightLighting} from './flight-lighting.js';

const resourceRoot = new URL('../../', import.meta.url);

export class Assets {
  constructor(renderer=null,{night=false}={}){this.loader=new GLTFLoader();this.cache=new Map();this.failed=[];this.loaded=0;this.texturePolicy=createTexturePolicy(renderer);this.night=night;}
  load(path){
    const key=new URL(String(path).replace(/^\/+/,''),resourceRoot).href;
    if(!this.cache.has(key)){
      this.cache.set(key,this.loader.loadAsync(key).then(g=>this.texturePolicy.prepare(g,key)).then(g=>{applyOriginalLivery(g.scene,key,{night:this.night});g.scene.animations=g.animations;this.loaded++;return g.scene;}).catch(e=>{this.cache.delete(key);this.failed.push(key);throw e;}));
    }
    return this.cache.get(key);
  }
}
export function createWorld(highQuality=false,{night=false,mobile=false}={}){
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(55,1,.32,4300);
  const renderer=new THREE.WebGLRenderer({antialias:highQuality,powerPreference:'high-performance',alpha:false});
  renderer.setClearColor(night?0x14243a:0xadc8dc);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  scene.fog=new THREE.FogExp2(night?0x192c44:0xadcbdf,night?.00105:.00068);
  const lighting=createFlightLighting(THREE,renderer,scene,{night,mobile});
  const {hemi,sun}=lighting;
  // The photographic horizon is scenery beyond the playable city. Sample
  // the plate in its authored display space in this unlit background shader.
  const coast=new THREE.TextureLoader().load(new URL(`../art/haeon-coast-${night?'night':'day'}.webp`,import.meta.url).href);
  coast.wrapS=THREE.RepeatWrapping;
  const sky=new THREE.Mesh(new THREE.SphereGeometry(3300,36,18),new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false,
    uniforms:{coast:{value:coast},zenith:{value:night?new THREE.Vector3(.012,.025,.069):new THREE.Vector3(.18,.41,.70)},
      skyLightDir:{value:sun.position.clone().normalize()},skyLightTint:{value:night?new THREE.Vector3(.81,.85,.93):new THREE.Vector3(1,.96,.83)},
      cloudMap:{value:cloudField(THREE)},cover:{value:0},veil:{value:0},cloudShift:{value:new THREE.Vector2()},
      cloudOrigin:{value:new THREE.Vector2()},mist:{value:scene.fog.color.clone().convertLinearToSRGB()},
      cloudShadow:{value:night?new THREE.Vector3(.068,.091,.126):new THREE.Vector3(.38,.435,.49)},
      cloudLight:{value:night?new THREE.Vector3(.17,.205,.254):new THREE.Vector3(.83,.86,.88)}},
    vertexShader:'varying vec3 ray;void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec3 ray;uniform sampler2D coast,cloudMap;uniform vec3 zenith,mist,cloudLight,cloudShadow,skyLightDir,skyLightTint;
      uniform float cover,veil;uniform vec2 cloudShift,cloudOrigin;
      void main(){
        vec3 v=normalize(ray);
        float az=atan(v.z,v.x)/6.283185+.5;
        float el=.15+asin(clamp(v.y,-1.,1.))*.98;
        vec3 plate=texture2D(coast,vec2(az,clamp(el,.002,.998))).rgb;
        vec3 sky=mix(plate,zenith,smoothstep(.82,1.32,el));
        float separation=length(v-skyLightDir);
        float disk=1.-smoothstep(.0038,.0059,separation);
        float glow=exp(-separation*(${night?'18.':'11.'}))*${night?'.22':'.45'};
        sky=mix(sky,skyLightTint,max(glow,disk));
        if(cover>.01 && v.y>-.06){
          vec2 uv=v.xz/max(.065,v.y+.09)*.20+cloudOrigin+cloudShift;
          float field=texture2D(cloudMap,uv).r;
          float base=1.-cover*.98;
          float opacity=smoothstep(base-.17,base+.09,field)*smoothstep(-.06,.08,v.y);
          vec3 cloud=mix(cloudShadow,cloudLight,smoothstep(.24,.76,field));
          sky=mix(sky,cloud,opacity);
        }
        sky=mix(sky,mist,veil*(1.-smoothstep(.015,.32,v.y)));
        gl_FragColor=vec4(sky,1.);
      }`
  }));
  sky.name='Southern coast horizon';sky.renderOrder=-999;sky.frustumCulled=false;scene.add(sky);
  const weatherEffects=createWeatherEffects(THREE,{scene,sky,sun,hemi,night,mobile});
  const rotorWash=createRotorWash(THREE,scene,{night,mobile,noiseMap:sky.material.uniforms.cloudMap.value});
  sky.material.addEventListener('dispose',()=>{rotorWash.dispose();weatherEffects.dispose();lighting.dispose();});
  function prepareLighting(city,flight){
    const shadowStrength=weatherEffects.update(flight.state.weather,city,camera,flight.state.cameraId==='cockpit');
    lighting.update(city,flight,shadowStrength);
    city.updateFacadeLighting?.(flight.state.weather,sun,scene.fog.color);
    city.updateWaterWind?.(flight.state.weather);
  }
  function frame(city,flight){
    sky.position.copy(camera.position);
    prepareLighting(city,flight);
    const wash=rotorWash.update(city,flight,camera);
    city.updateWaterWash?.(wash,flight);
    city.windsock?.update(flight,camera);
    renderer.render(scene,camera);
  }
  return {THREE,scene,camera,renderer,assets:new Assets(renderer,{night}),prepareLighting,frame,night};
}
const sceneSounds = {screech:'TSCREECH',siren:'SIREN',ignition:'FIRESTAR',water:'WATERCAN',
  heat:'FIREDMG',gas:'GASOUT',collision:'CRSH2',bump:'SOFTBMP2',
  winch:'WINCHLP',splash:'SPLISH',doorOpen:'DOROPN',doorClose:'DORCLS',horn:'HORN1',train:'TRAIN1',
  fireAlarm:'FIREALRT',fireSiren:'FIRESIRE',ambulanceSiren:'AMBSRN11',policeSiren:'POLICESI',gasPop:'TGPOP',douse:'DOUSE'};

export function makeSound(library = soundLibrary) {
  let ac, master, rotor, rotorGain, rotorURL, rpm = 0, spinning = false;
  let active = false, on = true, duck = 1, sequence = 0;
  const clips = new Map(), playing = new Map();

  function decode(id,url) {
    if (clips.has(id)) return clips.get(id);
    const sample = fetch(url).then(response => {
      if (!response.ok) throw Error(response.status);
      return response.arrayBuffer();
    }).then(bytes => ac.decodeAudioData(bytes)).catch(() => {
      if (clips.get(id) === sample) clips.delete(id);
      return null;
    });
    clips.set(id,sample);
    return sample;
  }
  async function refreshRotor() {
    await library.ready;
    const url = library.url('COPLOOP');
    if (rotorURL === url) return;
    const buffer = await decode('COPLOOP',url);
    if (!buffer || rotorURL === url || url !== library.url('COPLOOP')) return;
    if (rotor) { rotor.stop(); rotor.disconnect(); }
    rotor = ac.createBufferSource();
    rotor.loop = true;
    rotor.buffer = buffer;
    rotorURL = url;
    rotor.playbackRate.value = .56+.48*rpm;
    rotorGain.gain.value = rpm;
    rotor.connect(rotorGain);
    rotor.start();
  }
  async function init() {
    try {
      if (!ac) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        ac = new Context();
        master = ac.createGain();
        master.gain.value = 0;
        master.connect(ac.destination);
        rotorGain = ac.createGain();
        rotorGain.connect(master);
        mix();
      }
      await ac.resume();
      await refreshRotor();
    } catch { /* The flight can run without audio. */ }
  }
  async function playEffect(id,volume = 1) {
    if (!active || !on || !ac) return;
    const ticket = sequence;
    await library.ready;
    const url = library.url(id), buffer = await decode(id,url);
    if (!buffer || sequence !== ticket || url !== library.url(id)) return;
    const source = ac.createBufferSource(), level = ac.createGain();
    level.gain.value = volume;
    source.buffer = buffer;
    source.connect(level);
    level.connect(master);
    playing.set(source,id);
    source.onended = () => { playing.delete(source); source.disconnect(); level.disconnect(); };
    source.start();
  }
  function mix() {
    if (!ac) return;
    master.gain.setTargetAtTime(active && on ? .22*duck : 0,ac.currentTime,.08);
    if (!active || !on) {
      sequence++;
      for (const source of playing.keys()) source.stop();
    }
  }
  library.subscribe(id => {
    clips.delete(id);
    if (id === 'COPLOOP' && ac) void refreshRotor();
    for (const [source,key] of playing) if (key === id) source.stop();
  });
  return {init,
    setDuck(value) { duck = value; mix(); },
    setActive(value) { active = value; mix(); },
    setEnabled(value) { on = value; mix(); },
    frame(value = 1) {
      if (spinning && value < .02) { spinning = false; void playEffect('CHOPSTOP'); }
      if (!spinning && value > .06) { spinning = true; void playEffect('CHOPSTAR'); }
      if (Math.abs(rpm-value) <= .009) return;
      rpm = value;
      if (rotor) {
        rotorGain.gain.setTargetAtTime(rpm,ac.currentTime,.12);
        rotor.playbackRate.setTargetAtTime(.56+.48*rpm,ac.currentTime,.17);
      }
    },
    sceneCue(name,distance) {
      if (sceneSounds[name] && distance <= 150) void playEffect(sceneSounds[name],Math.max(.04,1-distance/155));
    },
    cue(success) { void playEffect(success ? 'CA_CHING' : 'BLIP1'); }
  };
}
