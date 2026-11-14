// Fade the local depth map before its camera boundary. The baked city map
// takes over the same ground pixels outside this range.
export const shadowEdgeGLSL=`
float flightShadowCoverage(vec4 lightCoord){
  vec3 p=lightCoord.xyz/lightCoord.w;
  vec2 edge=min(p.xy,1.-p.xy);
  return smoothstep(.015,.16,min(edge.x,edge.y))*step(0.,p.z)*step(p.z,1.);
}`;

function skyReflection(T,renderer,sunDirection,night){
  const width=128,height=64,data=new Uint16Array(width*height*4);
  const turf=night?[.013,.016,.019]:[.12,.14,.12];
  const horizon=night?[.075,.098,.15]:[.67,.76,.84];
  const zenith=night?[.013,.024,.053]:[.22,.42,.72];
  const lamp=night?[1.5,1.85,2.8]:[7.2,6.3,4.8];
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){
    const phi=((j+.5)/height-.5)*Math.PI,theta=((i+.5)/width-.5)*2*Math.PI;
    const y=Math.sin(phi),r=Math.cos(phi),k=(j*width+i)*4;
    const dot=sunDirection.x*r*Math.cos(theta)+sunDirection.y*y+sunDirection.z*r*Math.sin(theta);
    const disc=Math.exp(-Math.max(0,1-dot)*260);
    const end=y>=0?zenith:turf,blend=Math.min(1,(Math.abs(y)*(y<0?2.9:1.35))**.64);
    for(let c=0;c<3;c++)data[k+c]=T.DataUtils.toHalfFloat(horizon[c]+(end[c]-horizon[c])*blend+lamp[c]*disc);
    data[k+3]=T.DataUtils.toHalfFloat(1);
  }
  const tex=new T.DataTexture(data,width,height,T.RGBAFormat,T.HalfFloatType);
  tex.mapping=T.EquirectangularReflectionMapping;tex.needsUpdate=true;
  const pm=new T.PMREMGenerator(renderer),target=pm.fromEquirectangular(tex);
  tex.dispose();pm.dispose();return target;
}

export function createFlightLighting(T,renderer,scene,{night,mobile}){
  const sun=new T.DirectionalLight(night?0xbccde9:0xffe5bb,night?.66:2.58);
  sun.name=night?'Coastal moonlight':'Coastal sunlight';
  const hemi=new T.HemisphereLight(night?0xacc6e6:0xc6e0ff,night?0x342d2a:0x998578,night?.8:1.06);
  const direction=new T.Vector3(-.66,night?.94:.91,-.54).normalize();
  sun.position.copy(direction).multiplyScalar(600);scene.add(hemi,sun,sun.target);
  const env=skyReflection(T,renderer,direction,night);
  scene.environment=env.texture;scene.environmentIntensity=night?.38:.65;

  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  const halfSize=mobile?62:77;
  sun.castShadow=true;
  const shadow=sun.shadow,cam=shadow.camera;
  cam.left=cam.bottom=-halfSize;cam.right=cam.top=halfSize;
  cam.near=1;cam.far=425;cam.updateProjectionMatrix();
  shadow.mapSize.setScalar(mobile?512:1024);
  shadow.bias=-.00016;shadow.normalBias=mobile?.09:.06;
  const texel=2*halfSize/shadow.mapSize.x;
  const xAxis=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize();
  const yAxis=new T.Vector3().crossVectors(direction,xAxis).normalize();
  const center=new T.Vector3(),cache=new WeakSet();
  // Ground materials read this same strength for distant baked shadows.
  sun.userData.bakedShadowStrength={value:1};
  const practicals=[];
  if(night)for(let i=0;i<(mobile?1:2);i++){
    const lamp=new T.PointLight(0xffd39b,0,18,2);lamp.name='Street luminaire';
    scene.add(lamp);practicals.push(lamp);
  }
  let previousCity=null,previousCraft=null,lastTime=-Infinity,nextMap=0,nextLamp=0;
  function prepare(object){
    if(!object.isMesh)return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    const solid=materials.some(m=>m && (m.isMeshStandardMaterial||m.isMeshPhongMaterial||m.isMeshLambertMaterial)
      && !m.transparent && m.depthWrite!==false);
    const crown=materials.some(m=>m?.alphaTest>0);
    if(!solid&&!crown){object.castShadow=false;return;}
    object.castShadow=solid||crown;
    object.receiveShadow=solid;
    for(const m of materials){
      if(!m||cache.has(m))continue;
      cache.add(m);
      const previous=m.onBeforeCompile,previousKey=m.customProgramCacheKey();
      m.onBeforeCompile=function(shader,gl){
        previous.call(this,shader,gl);
        if(!shader.fragmentShader.includes('#include <lights_fragment_begin>'))return;
        const lights=T.ShaderChunk.lights_fragment_begin.replace('directionalLightShadow.shadowIntensity,',
          'directionalLightShadow.shadowIntensity*flightShadowCoverage(vDirectionalShadowCoord[i]),');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+shadowEdgeGLSL)
          .replace('#include <lights_fragment_begin>',lights);
      };
      m.customProgramCacheKey=()=>previousKey+' / local sunlight v1';m.needsUpdate=true;
    }
  }
  function update(city,flight,cloudShade){
    const weather=flight.state.weather;
    const now=weather?.elapsed??0,reset=city!==previousCity||flight.state.id!==previousCraft||now<lastTime;
    if(reset){
      scene.traverse(prepare);previousCity=city;previousCraft=flight.state.id;nextMap=nextLamp=now;
    }
    lastTime=now;
    const p=flight.state.onFoot?(flight.playerPosition??flight.position):flight.position;
    if(now>=nextMap){
      const land=city.surfaceAt?.(p.x,p.z)??city.groundAt(p.x,p.z);
      center.set(p.x,Math.min(p.y,land+32),p.z);
      // Quantize both shadow-plane axes. The shadow texels stay fixed in the
      // world between updates instead of sliding with each camera movement.
      const x=center.dot(xAxis),y=center.dot(yAxis);
      center.addScaledVector(xAxis,Math.round(x/texel)*texel-x);
      center.addScaledVector(yAxis,Math.round(y/texel)*texel-y);
      sun.target.position.copy(center);sun.position.copy(center).addScaledVector(direction,210);
      renderer.shadowMap.needsUpdate=true;nextMap=now+1/(mobile?12:18);
    }
    shadow.intensity=(night?.73:.96)*cloudShade;
    sun.userData.bakedShadowStrength.value=cloudShade;
    if(practicals.length&&now>=nextLamp){
      const lamps=city.streetLamps??[];
      const nearby=lamps.map(l=>({lamp:l,d:(p.x-l.x)**2+(p.y-l.y)**2+(p.z-l.z)**2}))
        .filter(item=>item.d<42**2).sort((a,b)=>a.d-b.d);
      for(let i=0;i<practicals.length;i++){
        const item=nearby[i],lamp=practicals[i];
        if(item){
          lamp.position.set(item.lamp.x,item.lamp.y-.16,item.lamp.z);
          lamp.intensity=42*(1-T.MathUtils.smoothstep(Math.sqrt(item.d),27,42));
        }else lamp.intensity=0;
      }
      nextLamp=now+.2;
    }
  }
  return {sun,hemi,update,dispose(){env.dispose();shadow.dispose();for(const lamp of practicals)lamp.removeFromParent();}};
}
