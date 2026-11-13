// Each city sector stores a low and a high view of the surrounding roofline.
// Linear filtering along bearings and interpolation between sectors keep the
// reflected horizon continuous as the pilot changes height or orbits a block.
const sectors=16,bearings=64,width=2048;
const encodeSlope=s=>Math.round(127.5*(1+s/Math.hypot(1,s)));

export function buildRoofline(city){
  const pixels=new Uint8Array(sectors*sectors*bearings*4);
  for(let row=0;row<sectors;row++)for(let col=0;col<sectors;col++){
    const x=(col+.5)*width/sectors-width/2,z=(row+.5)*width/sectors-width/2;
    const base=city.groundAt(x,z),self=city.obstacleAt(x,z);
    for(let a=0;a<bearings;a++){
      const angle=(a+.5)*2*Math.PI/bearings,dx=Math.cos(angle),dz=Math.sin(angle);
      let low=0,high=0,waterfrontLight=0;
      for(let distance=24;distance<=408;distance+=16){
        const px=x+dx*distance,pz=z+dz*distance;
        if(Math.abs(px)>=width/2||Math.abs(pz)>=width/2)break;
        const lot=city.obstacleAt(px,pz);
        const top=lot&&lot!==self?lot.roofY:city.groundAt(px,pz);
        const slope=(top-base-4)/distance;
        if(slope>low){
          low=slope;
          // Only a building on the actual skyline contributes artificial
          // light. Open water, land slopes and the back of this lot stay dark.
          waterfrontLight=lot&&lot!==self?(lot.code>=132&&lot.code<=157?.95:.48)*Math.max(.30,1-distance/520):0;
        }
        high=Math.max(high,(top-base-36)/distance);
      }
      const i=((row*sectors+col)*bearings+a)*4;
      pixels[i]=encodeSlope(low);pixels[i+1]=encodeSlope(high);
      pixels[i+2]=Math.round(Math.max(0,Math.min(1,base/512))*255);pixels[i+3]=Math.round(waterfrontLight*255);
    }
  }
  return pixels;
}

export function createCityGlass(T,night){
  const uniforms={
    glassRoofline:{value:null}, glassHaze:{value:new T.Color(night?0x223348:0xafc9d6)},
    glassLightDir:{value:new T.Vector3(-.48,.74,-.47).normalize()}, glassCloud:{value:0}
  };
  let texture;
  return {
    uniforms,
    bake(city){
      texture=new T.DataTexture(buildRoofline(city),bearings,sectors*sectors,T.RGBAFormat);
      texture.wrapS=T.RepeatWrapping;texture.minFilter=texture.magFilter=T.LinearFilter;
      texture.needsUpdate=true;uniforms.glassRoofline.value=texture;
    },
    update(weather,light,fogColor){
      if(light)uniforms.glassLightDir.value.subVectors(light.position,light.target.position).normalize();
      if(fogColor)uniforms.glassHaze.value.copy(fogColor);
      uniforms.glassCloud.value=weather?.cloud??0;
    },
    dispose(){texture?.dispose();}
  };
}

export const rooflineShader=`
    uniform sampler2D glassRoofline;
    uniform vec3 glassHaze,glassLightDir;
    uniform float glassCloud;
    vec4 rooflineAt(vec2 sector,float bearing){
        return texture2D(glassRoofline,vec2(bearing,(sector.y*16.+sector.x+.5)/256.));
    }
    vec4 citySkyline(vec3 position,float az){
        vec2 cell=clamp((position.xz+1024.)/128.-.5,vec2(0.),vec2(15.)),ij=floor(cell);
        vec2 k=fract(cell);vec2 upper=min(ij+1.,vec2(15.));
        return mix(mix(rooflineAt(ij,az),rooflineAt(vec2(upper.x,ij.y),az),k.x),
                         mix(rooflineAt(vec2(ij.x,upper.y),az),rooflineAt(upper,az),k.x),k.y);
    }
`;
export const glassShader=rooflineShader+`
    vec3 exteriorReflection(vec3 position,vec3 n,vec3 eye,float night,out float reflectance){
        vec3 r=reflect(-eye,n);
        vec3 profile=citySkyline(position,atan(r.z,r.x)*.159154943).rgb;
        float agl=max(0.,position.y-profile.b*512.);
        float skyline=mix(profile.r,profile.g,clamp((agl-4.)/32.,0.,1.))*2.-1.;
        skyline*=min(1.,36./max(36.,agl));
        float clearSky=smoothstep(skyline-.018,skyline+.018,r.y);
        vec3 zenith=mix(vec3(.17,.35,.55),vec3(.013,.027,.052),night);
        vec3 daylight=mix(glassHaze,mix(zenith,glassHaze,.72*glassCloud),smoothstep(.0,.85,r.y));
        vec3 street=mix(vec3(.052,.064,.069),vec3(.004,.009,.013),night);
        vec3 outside=mix(street,daylight,clearSky);
        float sun=pow(max(0.,dot(glassLightDir,r)),110.)*(1.-glassCloud)*(1.-night);
        outside+=vec3(1.35,1.08,.73)*sun*clearSky;
        float cosine=clamp(abs(dot(eye,n)),0.,1.);
        reflectance=.075+.79*pow(1.-cosine,5.);
        return outside;
    }
`;
