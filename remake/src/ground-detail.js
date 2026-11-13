// A world-space texture for the terrain mesh. Roads, structures and water have separate materials.
import {bakeLotShadows} from './lot-shadows.js';
import {bakeParcelLandscape} from './parcel-landscape.js';
export function addGroundDetail(T,scene,city,night=false){
  const mesh=scene.getObjectByName('city-terrain');if(!mesh)return;
  const tex=new T.TextureLoader().load('./art/terrain-detail.webp');tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=4;
  const pavement=new T.TextureLoader().load('./art/service-yard.webp');
  pavement.wrapS=pavement.wrapT=T.RepeatWrapping;pavement.colorSpace=T.SRGBColorSpace;pavement.anisotropy=4;
  const sun=scene.children.find(o=>o.isDirectionalLight);
  const lots=bakeLotShadows(T,city,sun,night);
  const parcels=city.generated?bakeParcelLandscape(T,city):null;
  if(parcels?.borders)mesh.parent.add(parcels.borders);
  const bounds=city.bounds;
  const parcelTransform=parcels?new T.Vector3(bounds.minX,bounds.minZ,1/(bounds.maxX-bounds.minX)):null;
  const strength=sun.userData.bakedShadowStrength??{value:1};
  const farShadow=sun.userData.bakedShadowStrength?`
    float bakedWeight=bakedStrength;
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      bakedWeight*=1.-flightShadowCoverage(vDirectionalShadowCoord[0]);
    #endif`:'float bakedWeight=bakedStrength;';
  // Continue the city's baked shadows from the verge onto the carriageway.
  const asphalt=new Set();
  scene.traverse(o=>{if(o.isMesh&&o.name.startsWith('Continuous roads '))asphalt.add(o.material);});
  for(const material of asphalt){
    const original=material.onBeforeCompile.bind(material);
    material.onBeforeCompile=(shader,renderer)=>{
      original(shader,renderer);shader.uniforms.streetShadows={value:lots};shader.uniforms.bakedStrength=strength;
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D streetShadows;uniform float bakedStrength;')
        .replace('#include <alphatest_fragment>',farShadow+'\nvec4 roadLight=texture2D(streetShadows,roadXZ/2048.+.5); diffuseColor.rgb*=roadLight.a*mix(1.,roadLight.r,.85*bakedWeight);\n#include <alphatest_fragment>');
      if(night)shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight+=roadLight.b*(diffuseColor.rgb+vec3(.035))*vec3(1.22,.73,.35);\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey=()=>night?'road-frontage-night-v2':'road-frontage-day-v2';material.needsUpdate=true;
  }
  const materials=new Set();mesh.traverse(o=>{if(o.isMesh)for(const m of [].concat(o.material||[]))materials.add(m);});
  for(const m of materials){
    const previous=m.onBeforeCompile.bind(m);m.onBeforeCompile=(sh,renderer)=>{
      previous(sh,renderer);sh.uniforms.groundRelief={value:tex};sh.uniforms.lotShadow={value:lots};sh.uniforms.yardConcrete={value:pavement};sh.uniforms.bakedStrength=strength;
      if(parcels){
        sh.uniforms.parcelGround={value:parcels.texture};sh.uniforms.parcelTransform={value:parcelTransform};
        sh.fragmentShader='uniform sampler2D parcelGround;uniform vec3 parcelTransform;\n'+sh.fragmentShader;
      }
      sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 naturalGround;').replace('#include <project_vertex>','#include <project_vertex>\nnaturalGround=(modelMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D groundRelief;uniform sampler2D lotShadow;uniform sampler2D yardConcrete;uniform float bakedStrength;varying vec3 naturalGround;').replace('#include <color_fragment>',`#include <color_fragment>
        ${farShadow}
        float groundDist=distance(cameraPosition,naturalGround);
        vec4 lot=texture2D(lotShadow,naturalGround.xz/2048.+.5);
        float coarse=texture2D(groundRelief,naturalGround.xz*.024).r-.5;
        diffuseColor.rgb*=1.+coarse*.52*(1.-smoothstep(140.,580.,groundDist));
        vec3 concrete=texture2D(yardConcrete,naturalGround.xz/5.6).rgb;
        vec2 joint=abs(fract(naturalGround.xz/vec2(5.6,4.8)+.5)-.5)*vec2(5.6,4.8);
        float distToJoint=min(joint.x,joint.y),pixel=max(.02,max(fwidth(naturalGround.x),fwidth(naturalGround.z)));
        float groove=(1.-smoothstep(.012,.012+pixel,distToJoint))*.025/(.025+pixel);
        concrete*=.86+.18*coarse-.5*groove;
        diffuseColor.rgb=mix(diffuseColor.rgb,concrete,lot.g);
        ${parcels?`vec4 plot=texture2D(parcelGround,(naturalGround.xz-parcelTransform.xy)*parcelTransform.z);
        diffuseColor.rgb=mix(diffuseColor.rgb,plot.rgb*(.98+coarse*.23),plot.a);`:''}
        diffuseColor.rgb*=lot.a*mix(1.,lot.r,bakedWeight);`);
      if(night)sh.fragmentShader=sh.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight+=lot.b*(diffuseColor.rgb+vec3(.018))*vec3(.87,.54,.28);\n#include <opaque_fragment>');
    };m.customProgramCacheKey=()=> (parcels?'city-parcels-v2':'coastal-industrial-ground-v4')+(night?' night':' day');m.needsUpdate=true;
  }
  // The road and terrain materials share the same district maps for one city.
  const landMat=materials.values().next().value;
  landMat?.addEventListener('dispose',()=>{
    tex.dispose();pavement.dispose();lots.dispose();parcels?.texture.dispose();
    const borders=parcels?.borders;
    if(borders){borders.removeFromParent();borders.geometry.dispose();borders.material.dispose();}
  });
}
