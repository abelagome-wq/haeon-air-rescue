// This tile is sampled on the sky dome. Both axes repeat so the same cloud
// sheet can drift across the coast without an edge or a new texture upload.
export function cloudField(T) {
  const size=128,bytes=new Uint8Array(size*size);
  function noise(x,y,cells) {
    const ix=Math.floor(x),iy=Math.floor(y);
    function corner(dx,dy) {
      let h=Math.imul((ix+dx)%cells+19,374761393)^Math.imul((iy+dy)%cells+71,668265263);
      h=Math.imul(h^(h>>>13),1274126177);
      return ((h^(h>>>16))>>>0)/4294967296;
    }
    const fx=x-ix,fy=y-iy,s=fx*fx*(3-2*fx),t=fy*fy*(3-2*fy);
    const a=corner(0,0)*(1-s)+corner(1,0)*s,b=corner(0,1)*(1-s)+corner(1,1)*s;
    return a*(1-t)+b*t;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    let value=0,weight=.55,cells=4;
    for(let octave=0;octave<5;octave++) {
      value+=weight*noise(x*cells/size,y*cells/size,cells);
      cells*=2;weight*=.48;
    }
    bytes[y*size+x]=Math.min(255,Math.round(value*250));
  }
  const texture=new T.DataTexture(bytes,size,size,T.RedFormat);
  texture.wrapS=texture.wrapT=T.RepeatWrapping;
  texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}

function createRain(T,scene,mobile,night) {
  const count=mobile?520:960,seeds=new Float32Array(count*6),ends=new Float32Array(count*2);
  let seed=55841;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let i=0;i<count;i++) {
    const x=random()*40,y=random()*26,z=random()*40;
    seeds.set([x,y,z,x,y,z],i*6);ends[i*2+1]=1;
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(seeds,3));
  geometry.setAttribute('tip',new T.BufferAttribute(ends,1));
  const uniforms={offset:{value:new T.Vector3()},velocity:{value:new T.Vector3()},
    ground:{value:0},opacity:{value:.42},nearFade:{value:1},tint:{value:night?new T.Vector3(.57,.72,.84):new T.Vector3(.81,.88,.91)}};
  const material=new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,toneMapped:false,
    vertexShader:`attribute float tip;
      uniform vec3 offset,velocity; uniform float ground,nearFade; varying float strength;
      void main(){
        vec3 span=vec3(40.,26.,40.);
        vec3 local=mod(position+offset-cameraPosition+span*.5,span)-span*.5;
        vec3 drop=cameraPosition+local;
        float distanceToEye=length(local);
        strength=(1.-smoothstep(13.,20.,distanceToEye))*smoothstep(nearFade,nearFade+1.2,distanceToEye)
            *smoothstep(-.1,.25,drop.y-ground)*mix(.42,1.,tip);
        gl_Position=projectionMatrix*viewMatrix*vec4(drop+tip*velocity*.045,1.);
      }`,
    fragmentShader:`uniform vec3 tint;uniform float opacity;varying float strength;
      void main(){gl_FragColor=vec4(tint,opacity*strength);}`});
  const lines=new T.LineSegments(geometry,material);
  lines.name='Wind-driven rain';lines.frustumCulled=false;lines.renderOrder=3;scene.add(lines);
  return {
    update(sample,dt,ground,cockpit) {
      lines.visible=sample.rain>.012;
      if(!lines.visible)return;
      geometry.setDrawRange(0,Math.round(count*sample.rain)*2);
      const u=uniforms,offset=u.offset.value;
      u.velocity.value.set(sample.windX,-9.5+Math.min(1,sample.windUp),sample.windZ);
      offset.addScaledVector(u.velocity.value,dt);
      offset.set(offset.x%40,offset.y%26,offset.z%40);
      u.ground.value=ground;u.nearFade.value=cockpit?2.6:1;
      u.opacity.value=(night?.58:.49)*(.6+sample.rain*.4);
    },
    dispose(){lines.removeFromParent();geometry.dispose();material.dispose();}
  };
}

export function createWeatherEffects(T,{scene,sky,sun,hemi,night,mobile}) {
  const fogClear=scene.fog.color.clone(),fogWet=new T.Color(night?0x293949:0x99a8b0);
  const baseSun=sun.intensity,baseHemi=hemi.intensity,baseEnv=scene.environmentIntensity;
  const u=sky.material.uniforms;
  let lastTime=null,rain=null;
  return {
    update(sample,city,camera,cockpit) {
      if(!sample)return 1;
      const dt=lastTime===null?0:Math.max(0,Math.min(.25,sample.elapsed-lastTime));
      lastTime=sample.elapsed;
      const cover=sample.cloud,veil=Math.min(1,Math.max(0,(1550-sample.visibility)/950));
      const density=1.98/Math.max(80,sample.visibility);
      scene.fog.density=Math.max(night?.00105:.00068,density);
      scene.fog.color.copy(fogClear).lerp(fogWet,Math.max(cover*.84,veil));
      sun.intensity=baseSun*(1-.78*cover);hemi.intensity=baseHemi*(1+.12*cover-.12*sample.rain);
      scene.environmentIntensity=baseEnv*(1-.32*cover);
      u.cover.value=cover;u.veil.value=veil;
      // Keep the projected cloud base tied to the city while the wind
      // advects the sheet. The offset is continuous through changing winds.
      u.cloudShift.value.x=(u.cloudShift.value.x-sample.windX*dt/2400)%1;
      u.cloudShift.value.y=(u.cloudShift.value.y-sample.windZ*dt/2400)%1;
      u.cloudOrigin.value.set(camera.position.x/2400,camera.position.z/2400);
      u.mist.value.copy(scene.fog.color).convertLinearToSRGB();
      if(!rain && sample.rain>.012)rain=createRain(T,scene,mobile,night);
      if(rain) {
        const ground=sample.rain>.012?(city.surfaceAt?.(camera.position.x,camera.position.z)
          ??city.groundAt(camera.position.x,camera.position.z)):0;
        rain.update(sample,dt,ground,cockpit);
      }
      return 1-cover*.68;
    },
    dispose(){rain?.dispose();u.cloudMap.value.dispose();}
  };
}
