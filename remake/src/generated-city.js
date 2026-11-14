// The simulation's terrain, roads and lot metadata all address the same 128² raster.
// A size sets the playable boundary inside that raster, in native 16 m tiles.
const N=128,TILE=16;
export const CITY_SIZES=Object.freeze({
  small:{label:'소형',tiles:64},medium:{label:'중형',tiles:92},large:{label:'대형',tiles:128}
});
const validSize=size=>Object.hasOwn(CITY_SIZES,size);
export function generatedCityId(size,seed){
  if(!validSize(size)||!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('도시 크기 또는 시드 오류');
  return 'proc-'+size+'-'+seed.toString(16).padStart(8,'0');
}
export function parseGeneratedCityId(id){
  const m=/^proc-(small|medium|large)-([0-9a-f]{8})$/.exec(id);
  return m?{size:m[1],seed:parseInt(m[2],16)}:null;
}
function seeded(seed){
  let state=seed>>>0;
  return ()=>{
    state=(state+0x6d2b79f5)>>>0;
    let t=Math.imul(state^(state>>>15),1|state);
    t^=t+Math.imul(t^(t>>>7),61|t);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
const choose=(items,rng)=>items[Math.floor(rng()*items.length)];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(v,hi));
const prefixes=['솔','해','연','온','은','청','금','백','새','길','별','담','가람','한','송','달'];
const suffixes=['나루','포','여울','강','해안','만','곶','들','항','울','물결','모래'];
const bits=[[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]];
const roadCodes=[0,30,29,38,30,30,35,39,29,37,29,42,36,41,40,43];
const housing=[112,113,114,115,116,117,118,119,120,121,122,123,140,141,142,143,144,145,146,147,174,175];
const commercial=[124,125,126,127,128,129,130,131,148,149,150,151,152,153,154,155,156,157,158,159,160,161,180,181,182,183,184,185,186,187];
const industry=[136,137,138,139,162,163,164,165,166,167,168,169,188,189,190,191,192,193];
const footprint=code=>code===246?2:code>=174?3:code>=140?2:1;
function spaced(first,last,rng){
  // Jitter block depth while avoiding short slivers at the end of an avenue.
  const steps=Math.max(1,Math.round((last-first)/(7.1+rng()*1.7))),out=[first];
  for(let i=1;i<steps;i++)out.push(Math.round(first+(last-first)*i/steps+(rng()-.5)*2));
  out.push(last);
  return out;
}
function makeDistrict(size,seed){
  const side=CITY_SIZES[size].tiles,origin=(N-side)/2,rng=seeded(seed);
  const turns=Math.floor(rng()*4),flip=rng()>.5;
  // The layout is authored in coast-relative coordinates, then transformed.
  // The inverse is defined outside the town too, so terrain joins the horizon.
  function local(col,row){
    let x=col-origin,y=row-origin;
    for(let i=0;i<turns;i++)[x,y]=[y,side-1-x];
    return [flip?side-1-x:x,y];
  }
  function cell(x,y){
    if(flip)x=side-1-x;
    for(let i=0;i<turns;i++)[x,y]=[side-1-y,x];
    return (y+origin)*N+x+origin;
  }
  const layers=Object.fromEntries(['terrain','height','water','building','zone','flags'].map(k=>[k,new Uint8Array(N*N)]));
  const blocked=new Uint8Array(N*N),road=new Uint8Array(N*N),rail=new Uint8Array(N*N);
  const placements=[],ships=[];
  const phi=()=>rng()*Math.PI*2,p=[phi(),phi(),phi(),phi(),phi(),phi()];
  const riverCentre=side*(.525+rng()*.102),riverHalf=side*(.023+rng()*.012);
  const landform=choose(['bay','headland','island-sound','estuary'],rng);
  const inletY=side*(.32+rng()*.39),isletY=side*(.73+rng()*.10);
  const isletX=side*(.945+rng()*.012);
  const coastAt=y=>{
    const feature=(y-inletY)/(side*.125);
    const headland=landform==='headland'?.054:landform==='bay'?-.075:0;
    return side*clamp(.835+.039*Math.sin(y/side*8+p[0])+.018*Math.sin(y/side*17+p[1])
      +headland*Math.exp(-feature*feature),.759,.905);
  };
  const riverAt=x=>riverCentre+side*(.018*Math.sin(x/side*12+p[2])+.013*Math.sin(x/side*6+p[3]));
  const maxRoadX=Math.floor(side*(.68+rng()*.035)),minRoadX=Math.round(side*(.075+rng()*.025));
  const cityTop=Math.round(side*(.135+rng()*.035)),cityBottom=Math.floor(side*(.88+rng()*.032));
  const northBank=Math.floor(riverCentre-side*.031-riverHalf-1.7),southBank=Math.ceil(riverCentre+side*.031+riverHalf+1.7);
  for(let row=0;row<N;row++)for(let col=0;col<N;col++){
    const i=row*N+col,[x,y]=local(col,row),coast=coastAt(y)-x;
    // A single continuous tidal river meets a wider estuary toward the coast.
    const delta=landform==='estuary'?1.75*Math.max(0,(x/side-.72)/.28):0;
    const bank=Math.abs(y-riverAt(x))-riverHalf*(1+.28*clamp(x/side,0,1)+delta);
    // A barrier islet changes the navigable coast, not just its texture.
    // Its western shore remains separated from the mainland at high tide.
    const islet=(1-Math.hypot((x-isletX)/(.027*side),(y-isletY)/(.092*side)))*side*.027;
    const shore=landform==='island-sound'?Math.max(islet,Math.min(coast,bank)):Math.min(coast,bank);
    if(shore<0){
      layers.water[i]=6;layers.terrain[i]=16;
      layers.height[i]=Math.round(Math.max(1,4.6+shore*.62));continue;
    }
    // Terraces stay level in the inhabited valley. Upland relief grows away
    // from it without creating steep streets or stretching native lot models.
    const upland=Math.min(1,Math.max(0,(minRoadX-3-x)/(.16*side),(cityTop-4-y)/(.15*side),(y-cityBottom-3)/(.18*side)));
    const ridge=.65+.25*Math.sin(x/(side*.12)+p[4])+.1*Math.cos(y/(side*.09)+p[5]);
    layers.height[i]=Math.round(6+Math.min(2,shore*1.25)+upland*ridge*Math.min(8,Math.max(0,shore-2)));
  }
  const xs=spaced(minRoadX,maxRoadX,rng),north=spaced(cityTop,northBank,rng),south=spaced(southBank,cityBottom,rng);
  function line(field,x1,y1,x2,y2){
    const dx=Math.sign(x2-x1),dy=Math.sign(y2-y1);
    for(let n=0;n<=Math.abs(x2-x1)+Math.abs(y2-y1);n++)field[cell(x1+dx*n,y1+dy*n)]=1;
  }
  // Both banks have an unbroken quay and perimeter. Individual side streets
  // terminate at different blocks; all of them meet the through avenues.
  for(const ys of [north,south]){
    for(let b=0;b<ys.length;b++){
      for(let a=0;a<xs.length-1;a++){
        if(b>0&&b<ys.length-1&&a>0&&a<xs.length-2&&rng()<.23)continue;
        line(road,xs[a],ys[b],xs[a+1],ys[b]);
      }
    }
    for(let a=0;a<xs.length;a++)line(road,xs[a],ys[0],xs[a],ys.at(-1));
  }
  const piers=Math.max(2,Math.floor(xs.length/3));
  for(let b=0;b<piers;b++){
    const a=clamp(Math.round((b+.5)*xs.length/piers+(rng()-.5)),0,xs.length-1);
    line(road,xs[a],northBank,xs[a],southBank);
  }
  const harborY=north.at(-2),shoreX=coastAt(harborY);
  const dockGate=Math.max(maxRoadX+1,Math.floor(shoreX)-3);
  line(road,maxRoadX,harborY,dockGate,harborY);
  // Rail runs from the edge of town to the working waterfront on the north bank.
  const trackY=Math.floor((north[0]+north[1])/2);
  line(rail,Math.max(2,minRoadX-3),trackY,maxRoadX+3,trackY);
  const maskAt=(field,i)=>bits.reduce((mask,[dx,dy,b])=>mask|(field[i+dx+dy*N]?b:0),0);
  for(let i=0;i<N*N;i++){
    if(!road[i]&&!rail[i])continue;
    const mask=maskAt(road,i),railMask=maskAt(rail,i),vertical=!!(mask&5),verticalRail=!!(railMask&5);
    if(road[i]&&rail[i])layers.building[i]=verticalRail?69:70;
    else if(rail[i])layers.building[i]=verticalRail?45:44;
    else if(layers.terrain[i]===16){
      layers.building[i]=83;if(vertical)layers.flags[i]|=2;
    }else layers.building[i]=roadCodes[mask];
  }
  function clear(x,y,w,h){
    if(x<1||y<1||x+w>=side||y+h>=side)return false;
    for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++){
      const i=cell(x+dx,y+dy);
      if(blocked[i]||layers.building[i]||layers.terrain[i]||layers.height[i]!==8)return false;
    }
    return true;
  }
  function mark(x,y,w,h){
    for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)blocked[cell(x+dx,y+dy)]=1;
  }
  function place(code,x,y,w,zone){
    const indices=[cell(x,y),cell(x+w-1,y),cell(x,y+w-1),cell(x+w-1,y+w-1)];
    placements.push([code,Math.min(...indices.map(i=>i%N)),Math.min(...indices.map(i=>i>>7)),w,w]);
    for(let dy=0;dy<w;dy++)for(let dx=0;dx<w;dx++){
      const i=cell(x+dx,y+dy);layers.building[i]=code;layers.zone[i]=zone;
    }
  }
  function streetSide(x,y,w){
    for(let t=0;t<w;t++)if(road[cell(x-1,y+t)]||road[cell(x+w,y+t)]||road[cell(x+t,y-1)]||road[cell(x+t,y+w)])return true;
    return false;
  }
  function service(code,tx,ty){
    const w=footprint(code),apron=code===246?1:0;
    let nearest=null,score=Infinity;
    for(let y=cityTop-2;y<=cityBottom;y++)for(let x=minRoadX-2;x<=maxRoadX;x++){
      if(!clear(x-apron,y-apron,w+2*apron,w+2*apron)||!streetSide(x-apron,y-apron,w+2*apron))continue;
      const d=(x-tx)**2+(y-ty)**2;
      if(d<score){score=d;nearest=[x,y];}
    }
    if(!nearest)throw Error('시립 시설 부지 부족: '+code);
    const [x,y]=nearest;mark(x-apron,y-apron,w+2*apron,w+2*apron);
    place(code,x,y,w,code===246?7:9);
    return {x,y};
  }
  // Vary the base along the inhabited north bank. The protected apron keeps
  // the pilot's route to the real hangar door and the takeoff pad clear.
  const base=service(246,side*(.19+rng()*.22),side*(.22+rng()*.14));
  service(209,side*(.39+rng()*.19),side*(.3+rng()*.14));
  service(210,side*(.19+rng()*.15),side*(.70+rng()*.12));
  service(211,side*(.50+rng()*.15),side*(.69+rng()*.14));
  for(let x=dockGate+1;x>=maxRoadX;x--){
    const spot=[harborY,harborY+1,harborY-1].find(y=>clear(x,y,1,1)&&streetSide(x,y,1));
    if(spot!==undefined){place(224,x,spot,1,8);break;}
  }
  const runwayLength=side<80?5:7;
  let strip=null,bestStrip=Infinity;
  // Keep a clear grass shoulder along both edges of the landing strip. Test
  // both headings on the same airfield so a through road is never removed.
  for(let y=2;y<northBank;y++)for(let x=2;x<maxRoadX;x++)for(const alongX of [true,false]){
    const w=alongX?runwayLength:1,h=alongX?1:runwayLength;
    const d=(x+(w-1)/2-base.x-.5)**2+(y+(h-1)/2-base.y-.5)**2;
    if(d>=bestStrip||!clear(x-1,y-1,w+2,h+2))continue;
    bestStrip=d;strip={x,y,w,h,alongX};
  }
  if(!strip)throw Error('공항 활주로 부지 부족');
  mark(strip.x-1,strip.y-1,strip.w+2,strip.h+2);
  for(let t=0;t<runwayLength;t++){
    place(221,strip.x+(strip.alongX?t:0),strip.y+(strip.alongX?0:t),1,7);
  }
  const shipCell=cell(Math.min(side-3,Math.ceil(shoreX)+4),harborY);
  ships.push({slot:1,col:shipCell%N,row:shipCell>>7,rotation:(2*turns+2)%8});
  const coreX=side*(.36+rng()*.20),coreY=side*(.30+rng()*.14);
  const industryNorth=rng()>.5,deck=[];
  for(let y=cityTop-2;y<=cityBottom+2;y++)for(let x=minRoadX-2;x<=maxRoadX+2;x++)deck.push([x,y]);
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  const maxLots=Math.round(side*side*.080);
  for(const [x,y] of deck){
    if(placements.length>=maxLots)break;
    const business=Math.hypot(x-coreX,(y-coreY)*1.1)<side*.20;
    const industrial=x>maxRoadX-side*.18&&(industryNorth?y<riverCentre:y>riverCentre);
    const zone=industrial?6:business?4:1;
    const code=choose(industrial?industry:business?commercial:housing,rng),w=footprint(code);
    if(!clear(x,y,w,w)||!streetSide(x,y,w)||rng()>(business?.72:industrial?.66:.48))continue;
    place(code,x,y,w,zone);
  }
  for(let y=1;y<side-1;y++)for(let x=1;x<side-1;x++){
    const i=cell(x,y);
    if(blocked[i]||layers.building[i]||layers.terrain[i]||layers.height[i]<7)continue;
    const canopy=.5+.27*Math.cos(x*.105+p[2])+.23*Math.sin(y*.128+p[3]);
    const developed=x>=minRoadX-2&&x<=maxRoadX+2&&y>=cityTop-2&&y<=cityBottom+2;
    if(rng()<(developed?.022:.16)*canopy)layers.building[i]=6+Math.floor(rng()*7);
  }
  return {side,layers,placements,ships,landform};
}
export function generateCity(size,seed){
  const id=generatedCityId(size,seed),{side,layers,placements,ships,landform}=makeDistrict(size,seed);
  const rng=seeded(seed^0x53bd0179),name=choose(prefixes,rng)+choose(suffixes,rng),half=side*TILE/2;
  return {id,name,source:'procedural',group:'generated',width:N,height:N,tileSize:TILE,compass:0,
    citySize:size,seed,generated:{size,seed,tiles:side,landform},playBounds:{minX:-half,maxX:half,minZ:-half,maxZ:half},
    placements,remnants:[],ships,layers:Object.fromEntries(Object.entries(layers).map(([k,v])=>[k,btoa(String.fromCharCode(...v))]))};
}
