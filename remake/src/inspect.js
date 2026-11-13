import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createTexturePolicy,closeTextureImages} from './texture-policy.js';
import {createInspectorGestures} from './inspect-gestures.js';
import {FLEET} from './fleet.js';
import {hangarEnvironment} from './hangar-lighting.js';
import {airframeReferences} from './airframe-references.js';
const $=id=>document.getElementById(id);
let rows,objectCatalog,session=null,turn=0,opening=0;
const fleetCatalog=FLEET.map(h=>({id:h.id,title:h.name,group:'항공기',source:h.inspiration,path:h.path}));
function freeModel(model){
  if(!model)return;const gs=new Set(),ms=new Set(),ts=new Set(),sks=new Set();
  model.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.skeleton)sks.add(o.skeleton);for(const m of [].concat(o.material||[])){ms.add(m);for(const v of Object.values(m))if(v?.isTexture)ts.add(v);}});
  gs.forEach(g=>g.dispose());sks.forEach(s=>s.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());closeTextureImages(ts);
}
function activateClip(){
  if(!session?.mixer)return;session.mixer.stopAllAction();const clip=session.clips[Number($('animation').value)];if(clip)session.mixer.clipAction(clip).play();
}
async function choose(){
  const ticket=++turn,s=session,row=rows?.find(r=>r.id===$('objectSelect').value);
  if(!s)return;s.gestures?.reset();s.mixer?.stopAllAction();if(s.current){s.scene.remove(s.current);freeModel(s.current);s.current=null;}s.mixer=null;$('animationLabel').hidden=true;
  if(!row){$('modelInfo').textContent='조건에 맞는 객체가 없습니다.';return;}
  $('modelInfo').textContent=row.id+' · 모델을 여는 중…';
  try{
    const url=new URL('../../'+(row.path??'models/complete/'+row.glb),import.meta.url).href;
    const gltf=await s.loader.loadAsync(url);
    // A new pool per inspected model makes close/late-load cleanup independent
    // of other inspector loads and of the flight renderer's cached bitmaps.
    await createTexturePolicy(s.r).prepare(gltf,url);
    if(session!==s||turn!==ticket){freeModel(gltf.scene);return;}
    const aircraft=row.group==='항공기';
    if(aircraft&&!s.hangarEnv)s.hangarEnv=hangarEnvironment(T,s.r);
    s.scene.environment=aircraft?s.hangarEnv.texture:null;s.scene.environmentIntensity=.75;
    s.current=gltf.scene;s.scene.add(s.current);s.current.updateWorldMatrix(true,true);
    const box=new T.Box3().setFromObject(s.current,true),center=box.getCenter(new T.Vector3()),extent=box.getSize(new T.Vector3());
    s.gestures?.reset();s.current.position.sub(center);s.radius=Math.max(.05,extent.length()*.52);s.zoom=aircraft?.86:1;s.yaw=.72;s.pitch=aircraft?.19:.32;
    s.clips=gltf.animations;if(s.clips.length){s.mixer=new T.AnimationMixer(s.current);$('animation').replaceChildren(...s.clips.map((c,i)=>new Option(c.name,i)));$('animationLabel').hidden=false;activateClip();}
    $('modelInfo').textContent=row.id+'  /  '+row.title+'  ·  '+row.source+'  ·  '+(s.clips.length?s.clips.length+'개 동작':aircraft?'비행 기체':'정적 모델');
    if(aircraft&&airframeReferences[row.id]){
      const link=document.createElement('a');link.href=airframeReferences[row.id];link.target='_blank';link.rel='noopener noreferrer';
      link.textContent='실기 사진 ↗';link.setAttribute('aria-label',row.source+' 실기 사진 새 창에서 보기');
      $('modelInfo').append('　',link);
    }
  }catch(e){if(ticket===turn)$('modelInfo').textContent='모델 읽기 실패: '+e.message;}
}
function filter(preferred=''){
  const q=$('findModel').value.trim().toLowerCase(),g=$('groups').value,sel=$('objectSelect'),old=preferred||sel.value;
  const result=rows.filter(r=>(!g||r.group===g)&&[r.id,r.title,r.group,r.source].join(' ').toLowerCase().includes(q));
  sel.replaceChildren(...result.map(r=>new Option(r.id+' · '+r.title,r.id)));if(result.some(r=>r.id===old))sel.value=old;choose();
}
export async function openInspection(initial='',aircraftId=''){
  const modal=$('inspection');if(modal.open)return;
  const request=++opening;modal.showModal();
  $('inspectionHeading').textContent=aircraftId?'항공기 3D 점검':'객체 점검실';
  $('modelInfo').textContent='모델 목록을 불러오는 중입니다.';
  try{
    const catalog=aircraftId?fleetCatalog:(objectCatalog??=await fetch('./data/objects.json').then(r=>r.json()));
    if(!modal.open||opening!==request)return;
    rows=catalog;
    const el=$('inspectorView'),r=new T.WebGLRenderer({antialias:true,powerPreference:'low-power'});
    r.setPixelRatio(Math.min(devicePixelRatio,1.7));r.toneMapping=T.ACESFilmicToneMapping;el.replaceChildren(r.domElement);
    const scene=new T.Scene();scene.background=new T.Color(0x44575e);
    scene.add(new T.HemisphereLight(0xe3f3ff,0xc4b69b,2.1));const sun=new T.DirectionalLight(0xffe3b5,3.2);sun.position.set(-2,4,3);scene.add(sun);
    const camera=new T.PerspectiveCamera(38,1,.015,4000),loader=new GLTFLoader(),s={r,scene,camera,loader,radius:1,zoom:1,yaw:.72,pitch:.32,clips:[]};session=s;
    s.gestures=createInspectorGestures(r.domElement,s);
    $('groups').replaceChildren(new Option('전체 · '+rows.length+'종',''),...[...new Set(rows.map(o=>o.group))].map(g=>new Option(g,g)));
    $('findModel').value=initial;filter(aircraftId);
    let last=performance.now();
    const draw=t=>{if(session!==s)return;const w=el.clientWidth,h=el.clientHeight;if(w!==s.w||h!==s.h){r.setSize(w,h,false);camera.aspect=w/h;s.w=w;s.h=h;}
      const d=s.radius*3.2*s.zoom*Math.max(1,h/w);camera.near=Math.max(.005,d*.003);camera.far=d+s.radius*6+10;camera.updateProjectionMatrix();camera.position.set(d*Math.sin(s.yaw)*Math.cos(s.pitch),d*Math.sin(s.pitch),d*Math.cos(s.yaw)*Math.cos(s.pitch));camera.lookAt(0,0,0);
      s.mixer?.update(Math.min(.05,(t-last)/1000));last=t;r.render(scene,camera);requestAnimationFrame(draw);};requestAnimationFrame(draw);
  }catch(e){$('modelInfo').textContent='점검실을 열 수 없습니다: '+e.message;}
}
$('groups').onchange=$('findModel').oninput=()=>rows&&filter();$('objectSelect').onchange=choose;$('animation').onchange=activateClip;
$('inspection').addEventListener('padview',event=>{
  const s=session;if(!s)return;
  const {x,y,lt,rt,dt}=event.detail;
  if(!x&&!y&&!lt&&!rt)return;
  s.yaw-=x*dt*2.4;s.pitch=Math.min(1.4,Math.max(-1.2,s.pitch+y*dt*1.9));
  s.zoom=Math.min(4,Math.max(.48,s.zoom*Math.exp((lt-rt)*dt*1.8)));
});
$('closeInspect').onclick=()=>$('inspection').close();$('inspection').onclose=()=>{turn++;const s=session;session=null;if(!s)return;s.gestures?.dispose();s.mixer?.stopAllAction();freeModel(s.current);s.hangarEnv?.dispose();s.r.dispose();s.r.forceContextLoss();$('inspectorView').replaceChildren();};
