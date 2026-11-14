const separation=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const randomItem=(points,rng)=>points[Math.min(points.length-1,Math.floor(rng()*points.length))]??null;

// Keep the last few locations between dispatches, including returns to the
// hangar/reloads in this tab. No save profile, cash or mission receipt is used.
export function createIncidentPicker(cityId,rng,storage){
  const key='simcopter.incident-sites.v1.'+cityId;
  let history=[];
  try{
    const rows=JSON.parse(storage?.getItem(key)??'[]');
    if(Array.isArray(rows))history=rows.filter(p=>typeof p?.role==='string'&&Number.isFinite(p.x)&&Number.isFinite(p.z)).slice(-32);
  }catch{}
  return (role,candidates,active=[])=>{
    if(!candidates.length)return null;
    const recent=history.filter(p=>p.role===role).slice(-4);
    // Prefer a different block, then a different tile. Small towns can reuse
    // older locations when all eligible sites have previously been called.
    let pool=[];
    for(let oldest=0;oldest<=recent.length&&!pool.length;oldest++){
      const avoid=[...active,...recent.slice(oldest)];
      for(const gap of [96,32,1]){
        pool=candidates.filter(p=>avoid.every(q=>separation(p,q)>=gap));
        if(pool.length)break;
      }
    }
    const chosen=randomItem(pool.length?pool:candidates,rng);
    history.push({role,x:chosen.x,z:chosen.z});
    if(history.length>32)history.shift();
    try{storage?.setItem(key,JSON.stringify(history));}catch{}
    return chosen;
  };
}

// Standalone mission handlers (without a dispatch director) also select a
// valid site. Inject rng for deterministic scenarios without altering the game.
export const pickIncidentSite=(api,role,candidates)=>api.pickSite
  ?api.pickSite(role,candidates):randomItem(candidates,api.rng??Math.random);

// Represent each neighborhood once instead of weighting a large open lake or
// parking lot by the number of 16 m tiles it occupies.
export function neighborhoodSites(points){
  const regions=new Map(),tiles=4;
  for(const p of points){
    const col=Math.floor(p.col/tiles),row=Math.floor(p.row/tiles),key=row*32+col;
    const score=(p.col-(col+.5)*tiles+.5)**2+(p.row-(row+.5)*tiles+.5)**2;
    if(!regions.has(key)||score<regions.get(key).score)regions.set(key,{p,score});
  }
  // A small pond or isolated block may have no second neighborhood. Retain
  // the valid individual locations there instead of collapsing it to one.
  return regions.size<4?points:Array.from(regions.values(),entry=>entry.p);
}
