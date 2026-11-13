// Water mains on generated streets follow reciprocal links in the same road
// graph used by vehicles. The underground view uses each tile's actual ports.
const ports={N:1,E:2,S:4,W:8},letters='TRBL';
const modelByMask={3:'19',5:'11',6:'16',7:'1A',9:'18',10:'10',11:'1D',12:'17',13:'1C',14:'1B',15:'1E'};
export function generatedWaterMains(city){
  const rows=new Map(city.roads.filter(road=>road.level==='street').map(road=>[road.id,road]));
  const raw=new Uint8Array(128*128),definitions={};
  for(const road of rows.values()){
    let mask=0;
    for(let i=0;i<road.neighbors.length;i++){
      if(rows.has(road.neighbors[i]))mask|=ports[road.ports[i]];
    }
    if(!mask)continue;
    raw[road.row*128+road.col]=mask;
    if(definitions[mask])continue;
    const ends=Array.from(letters).filter((_,i)=>mask&(1<<i)).join('');
    const shape=ends.length===1?'끝단':ends.length===4?'교차':ends.length===3?'분기':
      mask===5||mask===10?'직선':'곡선';
    definitions[mask]={family:'pipe',ports:ends,label:'상수도관 · '+shape,
      name:modelByMask[mask]?'XUND'+modelByMask[mask]:null};
  }
  return {raw,definitions};
}
