// Ground plans use the generated city's 16 m survey grid. The first edge of
// each plan faces a real street, so a driveway or pedestrian gate leads out.
const N=128,cell=16,halfWorld=1024;
const dirs=[[0,-1],[1,0],[0,1],[-1,0]];
function hash(x,y,seed){
  let h=seed^Math.imul(x+1,0x9e3779b1)^Math.imul(y+1,0x85ebca6b);
  h=Math.imul(h^(h>>>16),0x21f0aaad);
  return (h^(h>>>15))>>>0;
}
function use(zone){
  if(zone===1||zone===2)return 'home';
  if(zone===3||zone===4)return 'shop';
  if(zone===5||zone===6)return 'works';
  return '';
}
function frontage(rect,roads,free,maxGap){
  const {col,row,w,h}=rect;
  let best=null;
  for(let edge=0;edge<4;edge++){
    const [dx,dz]=dirs[edge],length=edge%2?h:w;
    for(let u=0;u<length;u++){
      const x=[col+u,col+w-1,col+w-1-u,col][edge],z=[row,row+u,row+h-1,row+h-1-u][edge];
      const link=[];
      for(let step=1;step<=maxGap+1;step++){
        const a=x+step*dx,b=z+step*dz;
        if(a<0||a>=N||b<0||b>=N)break;
        const i=b*N+a;
        if(roads[i]){
          const cost=step+Math.abs((u+.5)/length-.5)*.4;
          if(!best||cost<best.cost)best={edge,gate:(u+.5)*cell,link,cost};
          break;
        }
        if(!free[i])break;
        link.push(i);
      }
    }
  }
  return best;
}

export function planCityParcels(city){
  const {building,terrain,height,zone}=city.layers,seed=city.generated.seed;
  const free=new Uint8Array(N*N),roads=new Uint8Array(N*N);
  const side=city.generated.tiles,pad=(N-side)/2;
  for(let z=pad;z<pad+side;z++)for(let x=pad;x<pad+side;x++){
    const i=z*N+x;free[i]=building[i]===0&&terrain[i]===0&&height[i]===8;
  }
  for(const node of city.roads)if(node.level==='street')roads[node.row*N+node.col]=1;
  // Keep all airfield strips, the departure apron and the service vehicles'
  // entrances clear of ornamental parking stripes or a second landed-H cue.
  for(const p of city.placements){
    if(p.code!==221&&p.code!==246&&!(p.code>=209&&p.code<=211))continue;
    for(let z=Math.max(0,p.row-1);z<Math.min(N,p.row+p.h+1);z++)
      free.fill(0,z*N+Math.max(0,p.col-1),z*N+Math.min(N,p.col+p.w+1));
  }
  const {col,row}=city.spawn;
  for(let z=Math.max(0,row-2);z<=Math.min(N-1,row+2);z++)
    free.fill(0,z*N+Math.max(0,col-2),z*N+Math.min(N,col+3));
  const yards=[];
  for(const p of city.placements){
    const kind=use(zone[p.row*N+p.col]&15);
    if(!kind)continue;
    const front=frontage(p,roads,free,0);
    if(front)yards.push({col:p.col,row:p.row,w:p.w,h:p.h,kind,...front,key:hash(p.col,p.row,seed)});
  }
  const candidates=[];
  for(let z=pad+1;z<pad+side-2;z++)for(let x=pad+1;x<pad+side-2;x++){
    if(free[z*N+x])candidates.push({col:x,row:z,key:hash(x,z,seed)});
  }
  candidates.sort((a,b)=>a.key-b.key);
  const commons=[];
  for(const c of candidates){
    const {col:x,row:z,key}=c;
    const w=2+((key>>>4)%2),h=2+((key>>>7)%2);
    if(x+w>=pad+side-1||z+h>=pad+side-1)continue;
    let clear=true;
    for(let j=0;j<h&&clear;j++)for(let i=0;i<w;i++)if(!free[(z+j)*N+x+i]){clear=false;break;}
    if(!clear||commons.some(p=>Math.abs((x+w/2)-(p.col+p.w/2))<6&&Math.abs((z+h/2)-(p.row+p.h/2))<6))continue;
    const front=frontage({col:x,row:z,w,h},roads,free,2);
    if(!front)continue;
    const mix={home:0,shop:0,works:0};let neighbors=0;
    for(let j=Math.max(0,z-2);j<Math.min(N,z+h+2);j++)for(let i=Math.max(0,x-2);i<Math.min(N,x+w+2);i++){
      const kind=use(zone[j*N+i]&15);
      if(kind){mix[kind]++;neighbors++;}
    }
    if(neighbors<3)continue;
    const kind=mix.works>mix.shop&&mix.works>=mix.home?'loading':
      mix.shop>mix.home?(key%3?'parking':'square'):
      ['court','allotment','allotment','garden','garden','green','green','green'][key%8];
    commons.push({...c,w,h,kind,...front});
    for(let j=0;j<h;j++)free.fill(0,(z+j)*N+x,(z+j)*N+x+w);
    for(const i of front.link)free[i]=0;
  }
  return {yards,commons};
}

function fill(g,color,x,y,w,h){g.fillStyle=color;g.fillRect(x,y,w,h);}
function stroke(g,color,width,points){
  g.strokeStyle=color;g.lineWidth=width;g.beginPath();
  points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();
}
function oval(g,color,x,y,a,b){
  g.fillStyle=color;g.beginPath();g.ellipse(x,y,a,b,0,0,Math.PI*2);g.fill();
}
function garden(g,w,h,gate,square,key){
  const x=w*(.44+(key%19)*.006),y=h*.52,stone=square?'#c4b69d':'#c3b391';
  fill(g,square?'#b1aca0':'#80975b',0,0,w,h);
  if(square){
    fill(g,'#c0b7a5',1.2,1.2,w-2.4,h-2.4);
    for(let a=3;a<w;a+=4.5)fill(g,'#b2a995',a,1.2,.24,h-2.4);
    for(let b=3;b<h;b+=4.5)fill(g,'#b2a995',1.2,b,w-2.4,.24);
  }else{
    for(let j=0;j<h;j+=5)fill(g,'#859c60',0,j,w,2.5);
  }
  // A promenade, a central planted oval, and individual perimeter beds.
  const a=w*.29,b=h*.27;
  g.strokeStyle=stone;g.lineWidth=square?2.9:2.15;g.beginPath();g.ellipse(x,y,a,b,0,0,2*Math.PI);g.stroke();
  g.beginPath();g.moveTo(gate,-.2);g.bezierCurveTo(gate,h*.16,x,y-b-h*.095,x,y-b);g.stroke();
  stroke(g,stone,1.9,[[x-a,y],[1.4,y]]);
  oval(g,'#658752',x,y,a*.71,b*.69);oval(g,'#778e50',x-.35,y-.4,a*.60,b*.55);
  for(let i=0;i<4;i++){
    const xx=i%2?w-3.5:3.5,yy=i>1?h-3.2:3.2;
    if(Math.abs(xx-gate)<3&&i<2)continue;
    oval(g,'#667c50',xx,yy,2.45,1.5);oval(g,i%2?'#ad9d6e':'#9b8b73',xx,yy,1.75,.86);
  }
}
function neighborhoodGreen(g,w,h,gate,key){
  fill(g,'#829761',0,0,w,h);
  const farGate=w*(key%2?.22:.76),bend=w*(key%2?.70:.33);
  g.strokeStyle='#bfaf90';g.lineWidth=1.9;g.beginPath();g.moveTo(gate,0);
  g.bezierCurveTo(gate,h*.27,bend,h*.35,w/2,h*.57);
  g.bezierCurveTo(w*.33,h*.75,farGate,h*.78,farGate,h);g.stroke();
  for(let n=0;n<5;n++){
    const x=n%2?w-2.7:2.7,y=(n+1)*h/6;
    oval(g,'#71895b',x,y,2.2,2.4);oval(g,'#85965b',x+.2,y-.3,1.3,1.6);
  }
}
function allotment(g,w,h,gate,key){
  fill(g,'#899769',0,0,w,h);
  stroke(g,'#c0af8b',2.2,[[gate,0],[gate,3.0],[w*.5,3.0],[w*.5,h-2]]);
  const crops=['#829057','#72905c','#8c9862','#96975b','#6b8451','#9c835b'];
  for(let j=4;j+4<h-1.5;j+=5.5){
    for(const [x,length] of [[2,w*.5-4],[w*.5+2,w*.5-4]]){
      fill(g,'#8a795b',x,j,length,4);
      const tone=crops[(key+Math.floor(j)+Math.floor(x))%crops.length];
      for(let y=j+.35;y<j+4;y+=1.13)fill(g,tone,x+.25,y,length-.5,.67);
    }
  }
}
function sportsCourt(g,w,h,gate){
  fill(g,'#7a955e',0,0,w,h);stroke(g,'#bcb29a',2.2,[[gate,0],[gate,h*.15],[w*.5,h*.15]]);
  const cw=Math.min(w-5,25),ch=Math.min(h-6,31),x=(w-cw)/2,y=(h-ch)/2;
  fill(g,'#b17863',x,y,cw,ch);fill(g,'#548477',x+1.7,y+2.2,cw-3.4,ch-4.4);
}
function hardstand(g,w,h,gate,loading){
  fill(g,loading?'#918f85':'#687173',0,0,w,h);
  const setback=1.15;
  fill(g,'#abafa2',0,0,w,setback);fill(g,'#a8ae9e',0,0,setback,h);
  const spacing=loading?4.6:3.05,depth=loading?8:5.35;
  if(loading){
    for(let x=0;x<w;x+=6)for(let y=0;y<h;y+=6){
      if(((Math.floor(x/6)+Math.floor(y/6)*7)%4)===0)fill(g,'#a1a096',x+.32,y+.32,5.65,5.65);
    }
    for(let x=0;x<w;x+=6)fill(g,'#767a74',x,0,.34,h);
    for(let y=0;y<h;y+=6)fill(g,'#767a74',0,y,w,.34);
    fill(g,'#68726e',1.5,h-9.3,w-3,8.0);
  }
  for(let x=3;x+spacing<w-1;x+=spacing){
    if(loading)fill(g,'#73736c',x+.4,h-depth+.85,spacing-1.4,.34);
  }
  if(!loading){
    for(const x of [2.7,w-2.7])oval(g,'#788e63',x,h*.51,1.15,3.1);
  }
}
function paintYard(g,p,w,h){
  const {kind,key,gate}=p;
  if(kind==='home'){
    fill(g,['#82965e','#8a9c67','#829161','#8b9a62'][key%4],.24,.24,w-.48,h-.48);
    fill(g,'#c2b79e',.2,.2,w-.4,1.55);
    const drive=key%2?2:w-5.2;
    fill(g,'#aca99b',drive,.2,3.15,h*.59);
    fill(g,'#919a81',drive+1.15,1.7,.76,h*.48);
    stroke(g,'#c9bda5',1.05,[[gate,1.4],[gate,h*.29],[w*.5,h*.36]]);
    fill(g,'#687f55',1.0,h-2.25,w-2,1.15);
  }else if(kind==='shop'){
    fill(g,key%3===0?'#aa9f8a':'#b5ad9c',.12,.12,w-.24,h-.24);
    fill(g,'#c6bdad',.12,.12,w-.24,Math.min(3.0,h*.16));
    for(let x=2;x<w;x+=3.5)fill(g,'#a59c8e',x,.2,.22,2.65);
    if(w>=32)for(const x of [w*.16,w*.84])fill(g,'#798461',x-.9,1.1,1.8,1.25);
  }else{
    fill(g,'#9d9b92',.15,.15,w-.3,h-.3);
    for(let x=3;x<w;x+=5.4)fill(g,'#898a82',x,.5,.20,h-1);
    for(let x=1.5;x<w-2;x+=3.9){
      if(Math.abs(x-gate)>2.4)stroke(g,'#d5b36c',.38,[[x,.8],[x+1.2,2.05]]);
    }
  }
}
function paintParcel(g,p){
  const x=p.col*cell-halfWorld,z=p.row*cell-halfWorld,width=p.w*cell,depth=p.h*cell;
  const w=p.edge%2?depth:width,h=p.edge%2?width:depth;
  g.save();g.translate([x,x+width,x+width,x][p.edge],[z,z,z+depth,z+depth][p.edge]);g.rotate(p.edge*Math.PI/2);
  if(p.link.length){
    const vehicular=p.kind==='loading'||p.kind==='parking',lane=vehicular?5.2:2.3;
    fill(g,vehicular?'#898d89':'#c3b391',p.gate-lane/2,-cell*p.link.length,lane,cell*p.link.length);
  }
  g.beginPath();g.rect(.12,.12,w-.24,h-.24);g.clip();
  if(p.kind==='garden'||p.kind==='square')garden(g,w,h,p.gate,p.kind==='square',p.key);
  else if(p.kind==='green')neighborhoodGreen(g,w,h,p.gate,p.key);
  else if(p.kind==='allotment')allotment(g,w,h,p.gate,p.key);
  else if(p.kind==='court')sportsCourt(g,w,h,p.gate);
  else if(p.kind==='parking'||p.kind==='loading')hardstand(g,w,h,p.gate,p.kind==='loading');
  else paintYard(g,p,w,h);
  g.restore();
}
// Soft borders take less than a pilot's knee in height. Their geometry
// follows the planted beds, leaving paths, flight pads and parking bays clear.
function plantedBorders(T,city,commons){
  const positions=[],colors=[],indices=[];
  const palette=['#657d4e','#798d50','#96a064','#a49666','#687e5f'].map(c=>new T.Color(c));
  const chalk=new T.Color('#e3e1c9'),freightPaint=new T.Color('#e5bb68'),net=new T.Color('#4d5551');
  for(const p of commons){
    const across=(p.edge%2?p.h:p.w)*cell,depth=(p.edge%2?p.w:p.h)*cell;
    const baseX=p.col*cell-halfWorld+[0,p.w*cell,p.w*cell,0][p.edge];
    const baseZ=p.row*cell-halfWorld+[0,0,p.h*cell,p.h*cell][p.edge];
    const [dx,dz]=dirs[p.edge],ax=-dz,az=dx;
    // The city-size texture is suited to broad paving and plant beds. Court
    // lines and parking paint need metre-scale widths, including on approach.
    function stripe(u,v,s,t,width,ink=chalk){
      const len=Math.hypot(s-u,t-v),nu=(v-t)*width/(len*2),nv=(s-u)*width/(len*2),start=positions.length/3;
      for(const [a,b] of [[u-nu,v-nv],[s-nu,t-nv],[s+nu,t+nv],[u+nu,v+nv]]){
        const x=baseX+ax*a-dx*b,z=baseZ+az*a-dz*b;
        positions.push(x,city.groundAt(x,z)+.038,z);colors.push(ink.r,ink.g,ink.b);
      }
      indices.push(start,start+2,start+1,start,start+3,start+2);
    }
    if(p.kind==='parking'||p.kind==='loading'){
      const freight=p.kind==='loading',depthOfBay=freight?8:5.35,spacing=freight?4.6:3.05;
      for(let u=3;u+spacing<across-1;u+=spacing){
        stripe(u,depth-1,u,depth-depthOfBay,freight?.28:.20,freight?freightPaint:chalk);
        if(!freight&&Math.abs(u-p.gate)>4.8)stripe(u,1.5,u,depthOfBay+1,.20);
      }
      if(freight){
        stripe(1.5,depth-9.4,across-1.5,depth-9.4,.34,freightPaint);
        for(let u=1.7;u<across-4;u+=4.1)stripe(u,depth-10.2,u+2.3,depth-12.5,.32,freightPaint);
      }
      continue;
    }
    if(p.kind==='court'){
      const w=Math.min(across-5,25),h=Math.min(depth-6,31),l=(across-w)/2+3.8,r=across-l,t=(depth-h)/2+4.6,b=depth-t;
      stripe(l,t,r,t,.22);stripe(r,t,r,b,.22);stripe(r,b,l,b,.22);stripe(l,b,l,t,.22);
      stripe(l+1.6,t,l+1.6,b,.18);stripe(r-1.6,t,r-1.6,b,.18);stripe(l+1.6,t+3.4,r-1.6,t+3.4,.18);
      stripe(l+1.6,b-3.4,r-1.6,b-3.4,.18);stripe(across/2,t+3.4,across/2,b-3.4,.18);
      stripe(l-.8,depth/2,r+.8,depth/2,.22,net);continue;
    }
    const beds=[];
    if(p.kind==='green'){
      for(let n=0;n<5;n++)beds.push([n%2?across-2.7:2.7,(n+1)*depth/6,1.45,1.75]);
    }else if(p.kind==='allotment'){
      for(let j=4;j+4<depth-1.5;j+=5.5)beds.push([across*.25,j+2,across*.17,1.0],[across*.75,j+2,across*.17,1.0]);
    }else{
      for(let i=0;i<4;i++){
        const u=i%2?across-3.5:3.5,v=i>1?depth-3.2:3.2;
        if(i>=2||Math.abs(u-p.gate)>=3)beds.push([u,v,1.7,1.0]);
      }
    }
    let n=0;
    for(const [u,v,r,s] of beds)for(let k=0;k<3;k++){
      const key=hash(++n,p.row,p.key),cu=u+(k-1)*r*.60,cv=v+((key%13)/12-.5)*s*.56;
      const cx=baseX+ax*cu-dx*cv,cz=baseZ+az*cu-dz*cv,y=city.groundAt(cx,cz);
      const top=.31+(key%21)*.011,sides=7,index=positions.length/3,color=palette[(p.key+(key%7===0?k:0))%palette.length];
      function vertex(x,h,z,shade){
        positions.push(cx+ax*x-dx*z,y+h,cz+az*x-dz*z);
        colors.push(color.r*shade,color.g*shade,color.b*shade);
      }
      for(let ring=0;ring<2;ring++)for(let i=0;i<sides;i++){
        const a=i*2*Math.PI/sides+(key%17)*.12;
        const shape=.78+((key>>>(i*3))&7)*.025,scale=(ring?.72:1)*shape;
        vertex(Math.cos(a)*r*.51*scale,ring?top*(.48+shape*.29):.025,Math.sin(a)*s*.77*scale,ring?.90:.52);
      }
      vertex(.06,top,0,1.10);
      for(let i=0;i<sides;i++){
        const j=(i+1)%sides;
        indices.push(index+i,index+sides+i,index+j,index+j,index+sides+i,index+sides+j,index+sides+i,index+2*sides,index+sides+j);
      }
    }
  }
  if(!positions.length)return null;
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();geo.computeBoundingSphere();
  const mesh=new T.Mesh(geo,new T.MeshLambertMaterial({vertexColors:true}));
  mesh.name='Pocket garden planting';mesh.receiveShadow=true;return mesh;
}
export function bakeParcelLandscape(T,city){
  const {yards,commons}=city.parcelPlan??planCityParcels(city);
  const span=city.bounds.maxX-city.bounds.minX,canvas=document.createElement('canvas');
  canvas.width=canvas.height=Math.min(2048,Math.ceil(span*1.5));
  const g=canvas.getContext('2d'),scale=canvas.width/span;
  g.setTransform(scale,0,0,scale,-city.bounds.minX*scale,-city.bounds.minZ*scale);
  for(const plot of yards)paintParcel(g,plot);
  for(const plot of commons)paintParcel(g,plot);
  const texture=new T.CanvasTexture(canvas);texture.name='City parcel ground plans';texture.flipY=false;
  texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
  return {texture,borders:plantedBorders(T,city,commons)};
}
