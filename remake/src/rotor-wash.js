import {cloudField} from './weather-effects.js';
import {sampleRotorWash,rotorWashSurface,rotorWashKind,rotorWashYield} from './rotor-wash-source.js';

// Width, loft and lifetime are metres and seconds. Each parcel starts in the
// radially spreading jet, then loses jet momentum and follows the surface wind.
const media={
  dust:    {index:0,width:1.08,rise:2.05,life:3.8,alpha:.88},
  grass:   {index:1,width:.88,rise:1.45,life:3.1,alpha:.73},
  pavement:{index:2,width:.91,rise:1.25,life:2.65,alpha:.72},
  spray:   {index:3,width:1.07,rise:1.75,life:2.35,alpha:.90},
};

function puffBatch(T,scene,capacity,night,noiseMap) {
  const geometry=new T.InstancedBufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0],3));
  geometry.setIndex([0,1,2,0,2,3]);
  function attribute(name,n) {
    const a=new T.InstancedBufferAttribute(new Float32Array(capacity*n),n).setUsage(T.DynamicDrawUsage);
    geometry.setAttribute(name,a);return a;
  }
  const pose=attribute('pose',4),shape=attribute('shape',4),surface=attribute('surface',1);
  const material=new T.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,
    uniforms:{grain:{value:noiseMap},clock:{value:0},light:{value:night?.32:1},eyeFade:{value:2.1}},
    vertexShader:`attribute vec4 pose,shape;
      attribute float surface; uniform float eyeFade,clock;
      varying vec2 uvP,pattern; varying float strength,medium,above,fleck;
      void main(){
        vec4 center=modelViewMatrix*vec4(pose.xyz,1.);
        // The body of the cloud has a horizontal footprint visible even
        // when the pilot looks straight down through the drop sight.
        float overhead=abs(viewMatrix[1][2]);
        fleck=step(shape.z,-.01);
        float h=mix(shape.x,pose.w*.8,overhead*overhead);
        vec2 offset=position.xy*vec2(pose.w,h);
        if(fleck>.5){
          float roll=shape.z*11.+clock*3.;
          offset=mat2(cos(roll),sin(roll),-sin(roll),cos(roll))*offset;
        }
        uvP=position.xy;
        float angle=shape.z*23.; float c=cos(angle),s=sin(angle);
        pattern=vec2(c*uvP.x-s*uvP.y,s*uvP.x+c*uvP.y)+vec2(shape.z*11.3,shape.z*5.9);
        strength=shape.y*smoothstep(eyeFade,eyeFade+3.,length(center.xyz));
        above=pose.y-shape.w+dot(offset,vec2(viewMatrix[1][0],viewMatrix[1][1]));
        medium=surface;
        center.xy+=offset;gl_Position=projectionMatrix*center;
      }`,
    fragmentShader:`uniform sampler2D grain; uniform float clock,light;
      varying vec2 uvP,pattern;varying float strength,medium,above,fleck;
      void main(){
        float t=clock*.065;
        float n=texture2D(grain,pattern*.62+vec2(t*.21,-t*.16)).r;
        float detail=texture2D(grain,pattern*1.43+vec2(n*.23-t*.12,t*.22)).r;
        float edge=length(uvP*vec2(1.,.94))+(n-.50)*.37+(detail-.50)*.15;
        float a=(1.-smoothstep(.17,.49,edge))*smoothstep(-.06,.13,above)*strength;
        float billow=smoothstep(.22,.79,n*.68+detail*.32-.13*uvP.y);
        vec3 col;
        if(medium<.5)col=mix(vec3(.26,.164,.073),vec3(.88,.63,.35),billow);
        else if(medium<1.5)col=mix(vec3(.16,.145,.064),vec3(.66,.55,.33),billow);
        else if(medium<2.5)col=mix(vec3(.27,.22,.139),vec3(.86,.68,.44),billow);
        else {col=mix(vec3(.28,.43,.46),vec3(.87,.95,.97),billow);
          a*=.66+.34*detail;}
        if(fleck>.5){
          a=strength*(1.-smoothstep(.23,.49,length(uvP)))*smoothstep(0.,.06,above);
          col=medium>2.5?vec3(.75,.87,.9):medium>.5&&medium<1.5?vec3(.16,.15,.063):vec3(.23,.18,.107);
        }else a*=.64+.36*billow;
        if(a<.008)discard;
        gl_FragColor=vec4(col*light,a);
        #include <colorspace_fragment>
      }`});
  const mesh=new T.Mesh(geometry,material);
  mesh.name='Rotor downwash';mesh.frustumCulled=false;mesh.visible=false;
  geometry.instanceCount=0;scene.add(mesh);
  return {mesh,geometry,material,pose,shape,surface};
}

export function createRotorWash(T,scene,{mobile=false,night=false,noiseMap}={}) {
  const capacity=mobile?92:140,particles=[],sample={},local={};
  let batch,ownedTexture,elapsed,previousFlight,credit=0,seed=0x193c9bf1,serial=0;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);

  function emit(city,source) {
    // Successive sectors receive air throughout the disk circumference.
    // Jitter breaks up the front and keeps it continuous at low frame rates.
    const angle=serial++*2.399963+(random()-.5)*.85;
    const nx=Math.cos(angle),nz=Math.sin(angle);
    // Wall jets scour the verge beyond the paved touchdown pad as well as
    // the ground immediately below the blade tips.
    const spread=source.radius*(.48+1.40*random()**1.35);
    const x=source.x+nx*spread,z=source.z+nz*spread;
    const floor=rotorWashSurface(city,x,z,source.hubY,local);
    if(!floor||Math.abs(floor.y-source.y)>source.radius*.7)return;
    const power=source.jetStrength*rotorWashYield(floor,source.rain);
    if(power<.018)return;
    const type=media[rotorWashKind(floor,source.rain)],jitter=.82+random()*.46;
    const width=Math.max(1.35,source.radius*type.width*jitter);
    const radialSpeed=source.outflow*(.48+.42*random());
    const cloud={x,z,floor:floor.y,loft:.20+random()*.34,
      jetX:nx*radialSpeed,jetZ:nz*radialSpeed,
      windX:source.windX,windZ:source.windZ,age:0,life:type.life*jitter,
      width,rise:type.rise*jitter,alpha:type.alpha*Math.sqrt(Math.min(1,power)),
      kind:type.index,seed:random(),nextFloor:.24+random()*.13,depth:0};
    particles.push(cloud);
    // Occasional turf fragments, grit and droplets tumble through the veil.
    if(particles.length<capacity&&random()<(type===media.grass?.70:.36)){
      particles.push({...cloud,loft:.20,width:.12+random()*.18,rise:1.7+random()*1.5,
        life:.38+random()*.40,alpha:.75,seed:-.02-random()*.98});
    }
  }

  function advance(city,dt,wind,camera) {
    const view=camera.matrixWorldInverse.elements;
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];p.age+=dt;
      if(p.age>=p.life){particles.splice(i,1);continue;}
      // Air entrainment grows as parcels leave the rotor's ground jet.
      // Released dust still travels when the source fades or lifts away.
      const jet=Math.exp(-1.13*p.age),advection=1-.76*Math.exp(-1.52*p.age);
      if(wind){
        const follow=1-Math.exp(-.55*dt);
        p.windX+=(wind.windX-p.windX)*follow;p.windZ+=(wind.windZ-p.windZ)*follow;
      }
      p.x+=(jet*p.jetX+advection*p.windX)*dt;
      p.z+=(jet*p.jetZ+advection*p.windZ)*dt;
      p.loft+=(p.seed<0?p.rise-7.2*p.age:p.rise*(.22+.78*jet))*dt;
      if(p.age>=p.nextFloor){
        p.nextFloor=p.age+.25;
        const floor=rotorWashSurface(city,p.x,p.z,p.floor+p.loft+1.3,local);
        if(!floor||Math.abs(floor.y-p.floor)>1.6){particles.splice(i,1);continue;}
        p.floor=floor.y;
      }
      p.depth=view[2]*p.x+view[6]*(p.floor+p.loft)+view[10]*p.z;
    }
  }

  function draw(time,cockpit) {
    if(!particles.length){if(batch){batch.mesh.visible=false;batch.geometry.instanceCount=0;}return;}
    if(!batch){
      if(!noiseMap)ownedTexture=cloudField(T);
      batch=puffBatch(T,scene,capacity,night,noiseMap??ownedTexture);
    }
    // This is a single transparent draw: sort its parcels back to front.
    particles.sort((a,b)=>a.depth-b.depth);
    for(let i=0;i<particles.length;i++){
      const p=particles[i],age=p.age/p.life;
      const width=p.width*(.76+1.46*age);
      const fade=Math.min(1,p.age*8)*(1-age*age)*(1-age*.62);
      batch.pose.setXYZW(i,p.x,p.floor+p.loft,p.z,width);
      batch.shape.setXYZW(i,width*(.43+.16*age),p.alpha*fade,p.seed,p.floor);
      batch.surface.setX(i,p.kind);
    }
    batch.material.uniforms.clock.value=time;
    batch.material.uniforms.eyeFade.value=cockpit?4.0:1.75;
    batch.geometry.instanceCount=particles.length;batch.mesh.visible=true;
    for(const a of [batch.pose,batch.shape,batch.surface]){
      a.clearUpdateRanges();a.addUpdateRange(0,particles.length*a.itemSize);a.needsUpdate=true;
    }
  }

  function update(city,flight,camera) {
    const time=flight.state.weather?.elapsed??0;
    if(previousFlight!==flight||time<elapsed){
      particles.length=0;credit=0;elapsed=time;previousFlight=flight;
    }
    const source=sampleRotorWash(city,flight,sample);
    const dt=Math.max(0,Math.min(.22,time-elapsed));elapsed=time;
    if(dt>0){
      if(source){
        credit+=dt*(mobile?35:43)*Math.sqrt(source.jetStrength);
        while(credit>=1){
          if(particles.length<capacity)emit(city,source);
          credit--;
        }
      }else credit=0;
      if(particles.length)advance(city,dt,source,camera);
    }
    draw(time,flight.state.cameraId==='cockpit');return source;
  }
  function dispose(){
    if(batch){batch.mesh.removeFromParent();batch.geometry.dispose();batch.material.dispose();}
    ownedTexture?.dispose();particles.length=0;batch=null;
  }
  return {update,dispose};
}
