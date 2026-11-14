// Paint the actual static silhouettes once at city load. An industrial chimney
// and a low workshop on the same lot cast different shadows across the street.
function makeStamp(geometry,matrix,dx,dz,ink){
  const pos=geometry.attributes.position,ix=geometry.index,m=matrix.elements;
  const xy=new Float32Array(pos.count*2);
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),h=m[1]*x+m[5]*y+m[9]*z;
    const px=m[0]*x+m[4]*y+m[8]*z+dx*h,pz=m[2]*x+m[6]*y+m[10]*z+dz*h;
    xy[2*i]=px;xy[2*i+1]=pz;minX=Math.min(minX,px);maxX=Math.max(maxX,px);
    minZ=Math.min(minZ,pz);maxZ=Math.max(maxZ,pz);
  }
  const w=maxX-minX,h=maxZ-minZ;
  if(!(w>.05&&h>.05))return null;
  const scale=Math.min(1.5,224/Math.max(w,h)),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(w*scale)+2;canvas.height=Math.ceil(h*scale)+2;
  const ctx=canvas.getContext('2d');
  ctx.setTransform(scale,0,0,scale,1-minX*scale,1-minZ*scale);ctx.fillStyle=ink;ctx.beginPath();
  for(let k=0,end=ix?.count??pos.count;k+2<end;k+=3){
    const a=2*(ix?ix.getX(k):k),b=2*(ix?ix.getX(k+1):k+1),c=2*(ix?ix.getX(k+2):k+2);
    const turn=(xy[b]-xy[a])*(xy[c+1]-xy[a+1])-(xy[b+1]-xy[a+1])*(xy[c]-xy[a]);
    if(Math.abs(turn)<.004)continue;
    // Orient the projected triangles consistently so overlapping faces
    // form a silhouette and genuine openings still let light through.
    const second=turn<0?c:b,third=turn<0?b:c;
    ctx.moveTo(xy[a],xy[a+1]);ctx.lineTo(xy[second],xy[second+1]);ctx.lineTo(xy[third],xy[third+1]);ctx.closePath();
  }
  ctx.fill();
  return {canvas,x:minX-1/scale,z:minZ-1/scale,w:canvas.width/scale,h:canvas.height/scale};
}

export function bakeLotShadows(T,city,light,night){
  const side=1024,world=2048;
  const mask=document.createElement('canvas');mask.width=mask.height=side;
  const g=mask.getContext('2d');g.fillStyle='white';g.fillRect(0,0,side,side);
  g.setTransform(side/world,0,0,side/world,side/2,side/2);
  const dx=-light.position.x/light.position.y,dz=-light.position.z/light.position.y;
  const ink=night?'#c1c3c6':'#98a1aa',cache=new WeakMap();
  city.flightScenery.forEachSolid(s=>{
    if(s.kind!=='building'&&s.kind!=='tree')return;
    const m=s.matrix.elements,x=m[12],z=m[14],ground=s.placement?.y??city.groundAt(x,z);
    if(s.bounds.max.y-ground<1.2)return;
    let variants=cache.get(s.geometry);if(!variants){variants=new Map();cache.set(s.geometry,variants);}
    const key=[m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]].join(',');
    if(!variants.has(key))variants.set(key,makeStamp(s.geometry,s.matrix,dx,dz,ink));
    const stamp=variants.get(key);if(!stamp)return;
    const offset=m[13]-ground;
    g.drawImage(stamp.canvas,x+dx*offset+stamp.x,z+dz*offset+stamp.z,stamp.w,stamp.h);
  });
  const soft=document.createElement('canvas');soft.width=soft.height=side;
  const ctx=soft.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,side,side);
  ctx.filter=night?'blur(1.35px)':'blur(.65px)';ctx.drawImage(mask,0,0);
  // The red channel carries cast shadows; green marks the surveyed industrial
  // lot. Leave a narrow verge at its boundary with the adjacent road or bank.
  const pixels=ctx.getImageData(0,0,side,side);
  g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,side,side);
  g.setTransform(side/world,0,0,side/world,side/2,side/2);g.fillStyle='#fff';
  for(const lot of city.placements){
    if(!lot.model.startsWith('IN'))continue;
    const w=lot.w*16,h=lot.h*16;
    g.fillRect(lot.x-w/2+.52,lot.z-h/2+.52,w-1.04,h-1.04);
  }
  const areas=g.getImageData(0,0,side,side).data;
  let spill;
  if(night){
    // Bake spill at the feet of the real lamps and on street-facing sides of
    // occupied shopfronts. This also lights streets far outside the moving
    // pair of point lights, without adding dynamic lights to each material.
    g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,side,side);
    g.setTransform(side/world,0,0,side/world,side/2,side/2);
    const stamp=document.createElement('canvas');stamp.width=stamp.height=48;
    const ink=stamp.getContext('2d'),radial=ink.createRadialGradient(24,24,1,24,24,24);
    radial.addColorStop(0,'white');radial.addColorStop(.23,'rgba(255,255,255,.73)');
    radial.addColorStop(.7,'rgba(255,255,255,.15)');radial.addColorStop(1,'rgba(255,255,255,0)');
    ink.fillStyle=radial;ink.fillRect(0,0,48,48);g.globalCompositeOperation='lighter';
    for(const lamp of city.streetLamps??[]){
      g.globalAlpha=.85;g.drawImage(stamp,lamp.x-10,lamp.z-10,20,20);
    }
    for(const p of city.placements){
      const shop=p.model.startsWith('CO'),clinic=p.code===209;
      if(!shop&&!clinic)continue;
      for(const [dx,dz] of [[0,1],[1,0],[0,-1],[-1,0]]){
        const x=p.x+dx*(p.widthM*.5+2),z=p.z+dz*(p.depthM*.5+2);
        if(!city.tileAt(x+dx*4,z+dz*4)?.road)continue;
        const w=dx?13:Math.min(30,p.widthM*.85),h=dz?13:Math.min(30,p.depthM*.85);
        g.globalAlpha=clinic?.46:.60;g.drawImage(stamp,x-w*.5,z-h*.5,w,h);
      }
    }
    spill=g.getImageData(0,0,side,side).data;
  }
  // Nearby walls occlude some skylight even inside the live sun-shadow map.
  // Use the actual object footprint rather than darkening the entire parcel.
  g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,side,side);
  g.setTransform(side/world,0,0,side/world,side/2,side/2);
  g.globalCompositeOperation='source-over';g.globalAlpha=1;g.fillStyle='#fff';
  for(const p of city.placements){
    if(!Number.isFinite(p.x0)||p.roofY-p.y<3)continue;
    g.fillRect(p.x0-.65,p.z0-.65,p.x1-p.x0+1.3,p.z1-p.z0+1.3);
  }
  ctx.clearRect(0,0,side,side);ctx.filter='blur(1.55px)';ctx.drawImage(mask,0,0);
  const contact=ctx.getImageData(0,0,side,side).data;
  for(let i=0;i<pixels.data.length;i+=4){
    pixels.data[i+1]=areas[i+3];pixels.data[i+2]=spill?spill[i+3]:0;
    pixels.data[i+3]=255-Math.round(contact[i+3]*.24);
  }
  ctx.putImageData(pixels,0,0);
  const tex=new T.CanvasTexture(soft);tex.flipY=false;tex.generateMipmaps=true;return tex;
}
