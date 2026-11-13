// A skylight and two long hangar windows give curved glazing, sheet metal and
// painted composite skins readable reflections throughout a turntable orbit.
export function hangarEnvironment(T,renderer){
  const width=128,height=64,pixels=new Uint16Array(width*height*4);
  const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
  for(let j=0;j<height;j++){
    const latitude=((j+.5)/height-.5)*Math.PI,y=Math.sin(latitude),r=Math.cos(latitude);
    for(let i=0;i<width;i++){
      const longitude=((i+.5)/width-.5)*Math.PI*2,x=r*Math.cos(longitude),z=r*Math.sin(longitude);
      const roof=smooth(-.02,.94,y),skylight=smooth(.56,.78,y)*(1-smooth(.35,.76,Math.abs(x+.12)));
      const window=smooth(.62,.82,x)*smooth(-.10,.03,y)*(1-smooth(.46,.60,y));
      const warm=smooth(.57,.87,-z)*smooth(-.05,.16,y)*(1-smooth(.66,.84,y));
      const index=(j*width+i)*4;
      for(let c=0;c<3;c++){
        const light=[.10,.11,.12][c]+roof*[.14,.20,.28][c]+skylight*[1.65,1.80,2.00][c]
          +window*[1.72,1.92,2.15][c]+warm*[.98,.82,.62][c];
        pixels[index+c]=T.DataUtils.toHalfFloat(light);
      }
      pixels[index+3]=T.DataUtils.toHalfFloat(1);
    }
  }
  const map=new T.DataTexture(pixels,width,height,T.RGBAFormat,T.HalfFloatType);
  map.mapping=T.EquirectangularReflectionMapping;map.needsUpdate=true;
  const generator=new T.PMREMGenerator(renderer);
  try{return generator.fromEquirectangular(map);}
  finally{generator.dispose();map.dispose();}
}
