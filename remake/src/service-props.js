// Fixed equipment uses one indexed, vertex-coloured mesh per assembly,
// including the geometry registered with the flight/walking collision grid.
function metalwork(T) {
  const positions=[],normals=[],colors=[],uv=[],indices=[],tint=new T.Color(),up=new T.Vector3(0,1,0);
  function piece(g,ink,x,y,z,q) {
    if(q)g.applyQuaternion(q);
    g.translate(x,y,z);
    g.computeBoundingBox();
    const start=positions.length/3,p=g.attributes.position,n=g.attributes.normal,b=g.boundingBox;
    const sx=Math.max(.001,b.max.x-b.min.x),sy=Math.max(.001,b.max.y-b.min.y),sz=Math.max(.001,b.max.z-b.min.z);
    tint.setHex(ink);
    for(let i=0;i<p.count;i++){
      positions.push(p.getX(i),p.getY(i),p.getZ(i));
      const nx=n.getX(i),ny=n.getY(i),nz=n.getZ(i);
      normals.push(nx,ny,nz);
      const occlusion=.83+.17*Math.min(1,Math.max(0,p.getY(i)/1.1));
      colors.push(tint.r*occlusion,tint.g*occlusion,tint.b*occlusion);
      const top=Math.abs(ny)>.7;
      const u=!top&&Math.abs(nx)>Math.abs(nz)?(p.getZ(i)-b.min.z)/sz:(p.getX(i)-b.min.x)/sx;
      const v=top?(p.getZ(i)-b.min.z)/sz:(p.getY(i)-b.min.y)/sy;
      uv.push((395+u*106)/512,1-(93+(1-v)*135)/512);
    }
    if(g.index)for(const i of g.index.array)indices.push(start+i);
    else for(let i=0;i<p.count;i++)indices.push(start+i);
    g.dispose();
  }
  function box(x,y,z,w,h,d,ink) {piece(new T.BoxGeometry(w,h,d),ink,x,y,z);}
  function tube(a,b,r1,r2,ink,sides=12) {
    const delta=new T.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    const len=delta.length(),q=new T.Quaternion().setFromUnitVectors(up,delta.divideScalar(len));
    piece(new T.CylinderGeometry(r2,r1,len,sides),ink,(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,q);
  }
  function hose(points,r,ink,segments) {
    const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
    piece(new T.TubeGeometry(curve,segments,r,6,false),ink,0,0,0);
  }
  function ring(x,y,z,r,thickness,ink,lateral=false) {
    const g=new T.TorusGeometry(r,thickness,6,20);
    if(lateral)g.rotateX(Math.PI/2);
    piece(g,ink,x,y,z);
  }
  function lathe(profile,ink) {
    piece(new T.LatheGeometry(profile.map(([r,y])=>new T.Vector2(r,y)),20),ink,0,0,0);
  }
  function shell(points,halfWidth,ink) {
    const shape=new T.Shape();shape.moveTo(...points[0]);
    for(const p of points.slice(1))shape.lineTo(...p);
    shape.closePath();
    const bevel=.035;
    piece(new T.ExtrudeGeometry(shape,{depth:halfWidth*2-2*bevel,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1}),ink,0,0,-halfWidth+bevel);
  }
  function stamp(corners,[x,y,w,h],ink=0xffffff) {
    const first=positions.length/3;
    const pts=corners.map(p=>new T.Vector3(...p));
    const normal=pts[2].clone().sub(pts[0]).cross(pts[1].clone().sub(pts[0])).normalize();
    tint.setHex(ink);
    for(const p of pts){positions.push(p.x,p.y,p.z);normals.push(normal.x,normal.y,normal.z);colors.push(tint.r,tint.g,tint.b);}
    for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]])uv.push((x+u*w)/512,1-(y+v*h)/512);
    indices.push(first,first+2,first+1,first,first+3,first+2);
  }
  function finish() {
    const g=new T.BufferGeometry();
    for(const [name,a] of [['position',positions],['normal',normals],['color',colors]])g.setAttribute(name,new T.Float32BufferAttribute(a,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
  return {box,tube,hose,ring,lathe,shell,stamp,finish};
}

const tyre=0x293034,frame=0x45535a,steel=0xabb2ae,yellow=0xca9b43,black=0x272d2c,red=0xb24435;
export function apronGearGeometry(T) {
  const {box,tube,hose,ring,shell,stamp,finish}=metalwork(T);
  // Flush, jointed hardstand under the two pieces of parked equipment.
  box(.38,-.037,.31,4.95,.10,3.38,0x777c77);
  stamp([[-2.095,.017,-1.38],[2.855,.017,-1.38],[2.855,.017,2.00],[-2.095,.017,2.00]], [8,268,495,232],0xb5b9b1);
  function wheel(x,y,z,r,w,side) {
    const shoulder=w*.35;
    tube([x,y,z-w/2],[x,y,z-shoulder],r*.9,r,tyre,16);
    tube([x,y,z-shoulder],[x,y,z+shoulder],r,r,tyre,16);
    tube([x,y,z+shoulder],[x,y,z+w/2],r,r*.9,tyre,16);
    const f=z+side*w/2;
    tube([x,y,f],[x,y,f+side*.023],r*.55,r*.48,steel,16);
    tube([x,y,f+side*.024],[x,y,f+side*.055],r*.20,r*.16,frame,10);
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2+.45,dx=x+Math.cos(a)*r*.32,dy=y+Math.sin(a)*r*.32;
      tube([dx,dy,f+side*.018],[dx,dy,f+side*.031],r*.068,r*.068,frame,6);
    }
  }
  // Towable ground-power unit. The sheet-metal hood steps down toward
  // the hitch. Both axles, step, drawbar and reel belong to its chassis.
  box(0,.40,0,2.83,.14,1.32,frame);
  shell([[-1.37,.52],[1.33,.52],[1.33,1.18],[1.07,1.38],[-.77,1.53],[-1.37,1.53]],.64,yellow);
  for(const x of [-.93,.88]){
    tube([x,.33,-.76],[x,.33,.76],.085,.085,frame,8);
    for(const s of [-1,1]) {
      wheel(x,.33,s*.75,.33,.24,s);
      box(x,.70,s*.77,.84,.065,.33,yellow);
    }
  }
  for(const s of [-1,1]){
    const z=s*.66;
    box(-.51,.99,z,1.12,.59,.025,frame);
    for(let n=0;n<7;n++)box(-.52,.76+n*.075,z+s*.022,1.00,.029,.046,0x797a66);
    box(.58,.99,z,.87,.64,.026,0x9a792f);
    box(.58,.99,z+s*.019,.82,.59,.025,yellow);
    box(.88,1.04,z+s*.043,.15,.045,.05,black);
    for(const x of [.26,.47])box(x,.706,z+s*.036,.085,.043,.035,steel);
    box(0,.59,z+s*.035,2.61,.047,.02,0xf5d996);
    const side=s*.697;
    const left=s>0?.30:.83,right=s>0?.83:.30;
    stamp([[left,1.20,side],[right,1.20,side],[right,1.035,side],[left,1.035,side]], [12,14,187,55]);
  }
  // Front control bezel has a voltage dial, breaker and keyed connector.
  box(1.363,.956,0,.040,.44,1.02,frame);
  stamp([[1.385,1.144,.464],[1.385,1.144,-.464],[1.385,.768,-.464],[1.385,.768,.464]], [12,88,365,145]);
  tube([1.388,.903,-.295],[1.439,.903,-.295],.070,.067,frame);
  tube([1.439,.903,-.295],[1.449,.903,-.295],.053,.050,black);
  for(const z of [-.315,-.271])tube([1.448,.903,z],[1.458,.903,z],.009,.009,steel,6);
  // Cooling outlet, exhaust stack and a protected fuel filler on top.
  box(-.87,1.57,0,.74,.10,.94,frame);
  for(let n=0;n<8;n++)box(-1.15+n*.084,1.63,0,.031,.055,.83,steel);
  hose([[.83,1.32,-.30],[.83,1.56,-.30],[.80,1.65,-.30],[.67,1.71,-.30]],.084,frame,9);
  tube([-.24,1.50,-.38],[-.24,1.57,-.38],.103,.095,steel);
  // Cable reel at the rear: dark helical windings, steel cheek plates,
  // flex down to the plug dock, and an axle bracket at each end.
  box(-1.48,.62,0,.31,.12,1.10,frame);
  for(const z of [-.32,.32]){
    box(-1.47,.83,z,.13,.40,.07,steel);
    tube([-1.57,.99,z-.018],[-1.57,.99,z+.018],.29,.29,yellow,16);
  }
  tube([-1.57,.99,-.27],[-1.57,.99,.27],.215,.215,black,16);
  for(let i=0;i<7;i++)ring(-1.57,.99,-.228+.076*i,.212,.035,0x383e3a);
  hose([[-1.74,.89,.22],[-1.84,.64,.42],[-1.73,.58,.58],[-1.65,.84,.63]],.037,black,12);
  box(-1.64,.89,.63,.16,.12,.10,frame);
  for(const s of [-1,1]){
    tube([1.1,.42,s*.49],[2.45,.35,0],.047,.047,steel,8);
    box(-1.40,.61,s*.51,.05,.115,.17,red);
  }
  ring(2.51,.35,0,.105,.032,steel,true);
  tube([1.95,.38,0],[1.95,.10,0],.048,.045,frame,8);box(1.95,.07,0,.24,.06,.19,steel);
  // Wheeled airfield extinguisher, with shoulder dome, cylinder straps,
  // brass regulator, hose/horn and folding handrail beside the unit.
  const x=-.60,z=1.36;
  for(const s of [-1,1])wheel(x,.225,z+s*.34,.225,.13,s);
  box(x,.23,z,.50,.09,.72,frame);
  tube([x,.29,z],[x,.39,z],.19,.25,red,16);
  tube([x,.39,z],[x,1.02,z],.25,.25,red,16);
  tube([x,1.02,z],[x,1.15,z],.25,.13,red,16);
  tube([x,1.15,z],[x,1.22,z],.13,.065,red,16);
  for(const y of [.47,.89])tube([x,y,z],[x,y+.037,z],.255,.255,steel,16);
  for(let i=0;i<6;i++){
    const rim=a=>[x+Math.sin(a)*.252,z+Math.cos(a)*.252];
    const [ax,az]=rim(-.83+i*1.66/6),[bx,bz]=rim(-.83+(i+1)*1.66/6);
    stamp([[ax,.846,az],[bx,.846,bz],[bx,.559,bz],[ax,.559,az]], [264+i*35,13,35,62]);
  }
  tube([x,1.21,z],[x,1.34,z],.062,.061,0xb29258,8);
  box(x+.03,1.35,z,.25,.035,.055,black);
  hose([[x+.09,1.24,z],[x+.34,1.05,z+.04],[x+.35,.54,z+.02],[x+.23,.41,z+.04],[x+.20,.78,z+.13]],.035,black,18);
  tube([x+.20,.76,z+.13],[x+.26,1.02,z+.13],.052,.091,black,10);
  for(const s of [-1,1])tube([x-.27,.28,z+s*.22],[x-.51,1.21,z+s*.22],.029,.029,steel,8);
  tube([x-.51,1.21,z-.22],[x-.51,1.21,z+.22],.034,.034,black,8);
  return finish();
}

export function hydrantGeometry(T) {
  const {tube,hose,lathe,ring,finish}=metalwork(T),paint=0xa74839;
  function barrel(a,b,r1,r2,color,sides=12){tube([0,a,0],[0,b,0],r1,r2,color,sides);}
  lathe([[.29,.005],[.29,.026],[.278,.046],[.241,.047],[.237,.079],[.198,.082],[.178,.126],[.169,.163],[.164,.44],[.169,.58],[.180,.63]],0x734137);
  lathe([[.169,.15],[.165,.40],[.171,.59],[.185,.634],[.223,.637],[.225,.656],[.219,.663],[.187,.665],[.179,.698],[.182,.762],[.178,.80],[.160,.845],[.131,.879],[.087,.910],[.065,.92],[.065,.942]],paint);
  ring(0,.632,0,.186,.014,0x82483b,true);
  barrel(.934,1.024,.052,.047,0x848781,5);
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3+.2,x=Math.cos(a),z=Math.sin(a);
    tube([x*.174,.682,z*.174],[x*.139,.849,z*.139],.013,.009,paint,7);
    tube([x*.23,.047,z*.23],[x*.23,.065,z*.23],.020,.018,0x776b61,6);
  }
  for(const [x,z,r] of [[1,0,.099],[-1,0,.099],[0,1,.133]]){
    tube([x*.095,.53,z*.095],[x*.228,.53,z*.228],r,r,paint);
    tube([x*.226,.53,z*.226],[x*.257,.53,z*.257],r+.022,r+.018,0x694e42);
    tube([x*.258,.53,z*.258],[x*.298,.53,z*.298],r,r*.86,paint);
    tube([x*.298,.53,z*.298],[x*.327,.53,z*.327],.043,.041,0x96917f,5);
  }
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3,x=Math.cos(a)*.201,z=Math.sin(a)*.201;
    tube([x,.67,z],[x,.699,z],.02,.019,steel,6);
  }
  hose([[.025,.48,.277],[.066,.27,.20],[.13,.24,.105],[.187,.41,.08],[.240,.48,.033]],.011,0x534c41,11);
  return finish();
}

// The equipment shares one small atlas for riveted plates, instrumentation
// and the concrete hardstand. Unmarked metal samples the mottled paint tile.
export function apronEquipmentFinish(T) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const g=canvas.getContext('2d');
  let seed=19034;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const rect=(x,y,w,h,fill)=>{g.fillStyle=fill;g.fillRect(x,y,w,h);};
  function text(s,x,y,size,ink){g.fillStyle=ink;g.font='bold '+size+'px sans-serif';g.fillText(s,x,y);}
  function disc(x,y,r,color){g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fillStyle=color;g.fill();}
  function shadow(x,y,rx,ry,dark){
    g.save();g.translate(x,y);g.scale(rx,ry);
    const soft=g.createRadialGradient(0,0,0,0,0,1);
    soft.addColorStop(0,'rgba(32,34,31,'+dark+')');soft.addColorStop(1,'rgba(32,34,31,0)');
    rect(-1,-1,2,2,soft);g.restore();
  }
  rect(0,0,512,512,'#fff');
  rect(9,11,193,61,'#dedfce');rect(15,17,181,49,'#56636a');
  text('28 V  DC',25,43,27,'#f0eee0');text('GROUND POWER',25,59,12,'#e2dfce');
  g.fillStyle='#efbf57';g.beginPath();g.moveTo(167,22);g.lineTo(148,57);g.lineTo(186,57);g.closePath();g.fill();
  g.fillStyle='#232b34';g.beginPath();g.moveTo(170,29);g.lineTo(158,44);g.lineTo(166,44);g.lineTo(162,53);g.lineTo(176,39);g.lineTo(168,39);g.closePath();g.fill();
  rect(7,83,376,156,'#414d51');rect(14,90,361,144,'#6c7775');
  for(const x of [21,365])for(const y of [98,222]){disc(x,y,3.5,'#38434a');rect(x-2,y-.6,4,1,'#cbd2c6');}
  text('GROUND SUPPLY',33,111,13,'#e0e0ce');
  for(const [x,label,angle] of [[77,'VOLT',-1.0],[179,'AMP',-2.16]]){
    disc(x,158,38,'#364349');disc(x,158,32,'#c5c7b9');
    for(let i=0;i<13;i++){const a=-2.70+.187*i;g.strokeStyle='#46555a';g.lineWidth=i%3===0?2.8:1.4;
      g.beginPath();g.moveTo(x+Math.cos(a)*(i%3===0?22:25),158+Math.sin(a)*(i%3===0?22:25));g.lineTo(x+Math.cos(a)*29,158+Math.sin(a)*29);g.stroke();}
    g.strokeStyle='#b34539';g.lineWidth=2.8;g.beginPath();g.moveTo(x,161);g.lineTo(x+Math.cos(angle)*25,158+Math.sin(angle)*25);g.stroke();
    disc(x,161,3.3,'#242e34');text(label,x-13,177,9,'#283236');
  }
  for(const [x,col] of [[253,'#8baf81'],[305,'#cea75a'],[340,'#aa5b4e']]){disc(x,137,9,'#354046');disc(x,137,6,col);}
  text('OUTPUT',234,165,10,'#f2e7cc');text('DC',56,210,10,'#e1dfc9');text('LOAD',162,210,10,'#e1dfc9');
  rect(260,9,218,71,'#e4e2d2');rect(266,14,208,17,'#873f32');text('CARBON DIOXIDE',279,27,12,'#fff4e0');
  text('CO₂',277,62,31,'#353d3f');
  for(let i=0;i<5;i++)rect(347,40+i*5,110-(i%3)*15,1.4,'#596463');
  rect(391,88,116,145,'#f5f5f1');
  for(let i=0;i<2500;i++){
    const k=204+Math.floor(random()*50);
    rect(392+random()*113,89+random()*142,1+random()*1.5,1,`rgba(${k},${k},${k-2},.48)`);
  }
  for(let i=0;i<50;i++)rect(394+random()*105,93+random()*131,1+random()*3,1,'#d9d9d3');
  rect(5,265,501,238,'#d5d4c9');
  for(let n=0;n<10500;n++){
    const k=Math.floor(104+random()*104);
    rect(6+random()*497,267+random()*233,.5+random()*1.6,.5+random(),`rgba(${k},${k},${k-5},.46)`);
  }
  rect(9,276,492,3,'#d4b879');rect(9,489,492,3,'#d4b879');
  rect(284,268,1.5,232,'#8b8b83');rect(286,268,1,232,'#e7e2d6');
  shadow(207,371,164,64,.79);shadow(144,449,52,26,.7);
  for(const xx of [123,304])for(const yy of [319,422])shadow(xx,yy,23,11,.65);
  for(let n=0;n<130;n++)rect(10+random()*487,274+random()*219,1+random()*4,1,'#b5b6af');
  const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;return tex;
}

export function apronEquipmentSite(city,site,windsock) {
  const start=city.spawn;
  // Prefer a service lay-by beside the outbound view, then try the other
  // edges of the apron in cities whose departure corridor is built up.
  for(const sector of [[-34,34,-55,55,-9,9],[-90,90,-128,128,0,180]])
  for(const radius of [20,25,30,33,38,46])for(const side of sector){
    const a=(start.heading+side)*Math.PI/180,x=start.x+Math.sin(a)*radius,z=start.z-Math.cos(a)*radius;
    const yaw=Math.atan2(start.x-x,start.z-z),s=Math.sin(yaw),c=Math.cos(yaw);
    const y=city.surfaceAt(x,z);
    if(windsock&&Math.hypot(x-windsock.x,z-windsock.z)<5.5)continue;
    let clear=true;
    for(let i=1;i<site.route.length;i++){
      const p=site.route[i],prev=site.route[i-1],dx=p.x-prev.x,dz=p.z-prev.z;
      const t=Math.max(0,Math.min(1,((x-prev.x)*dx+(z-prev.z)*dz)/(dx*dx+dz*dz||1)));
      if(Math.hypot(x-prev.x-t*dx,z-prev.z-t*dz)<5)clear=false;
    }
    if(!clear)continue;
    for(let u=-2;u<=3;u+=.8)for(let v=-1.2;v<=2;v+=.8){
      const px=x+u*c+v*s,pz=z-u*s+v*c,tile=city.tileAt(px,pz);
      if(!tile||tile.water||tile.road||tile.railY!=null||![0,221,222].includes(tile.building)
        ||Math.abs(city.surfaceAt(px,pz)-y)>.075||city.roofAt(px,pz)>y+.12||city.flightScenery?.floorAt(px,pz,y+8)>y+.16)clear=false;
    }
    if(clear)return {x,y,z,yaw};
  }
  return null;
}
