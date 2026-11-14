import {residentialPresets,residentialLow,residentialMid} from './presets-residential.js';
import {commercialPresets,commercialLow,commercialTall} from './presets-commercial.js';
import {industrialPresets,industrialLow,industrialLarge} from './presets-industrial.js';

export const cityPresets={...residentialPresets,...commercialPresets,...industrialPresets};
const directions=[[0,-1],[1,0],[0,1],[-1,0]];

function lotHash(seed,x,z){
    let n=seed^Math.imul(x+19,0x9e3779b1)^Math.imul(z+101,0x85ebca6b);
    n=Math.imul(n^(n>>>16),0x21f0aaad);
    return (n^(n>>>15))>>>0;
}
function streetEdge(p,streetTiles,fallback){
    // Prefer the edge with real street frontage. Corners can face either
    // street; retain a deterministic tie-break for a saved city's seed.
    let best=fallback,score=0;
    for(let k=0;k<4;k++){
        const edge=(fallback+k)%4,[dx,dz]=directions[edge];
        let count=0;
        for(let i=0;i<(edge%2?p.h:p.w);i++){
            const col=p.col+[i,p.w-1,i,0][edge]+dx,row=p.row+[0,i,p.h-1,i][edge]+dz;
            if(col>=0&&col<128&&row>=0&&row<128&&streetTiles.has(row*128+col))count++;
        }
        if(count>score){best=edge;score=count;}
    }
    return best;
}
export function planCityPreset(p,zone,seed,streetTiles,formerHeight,neighbors=[]){
    if(p.code<112||p.code>193||zone<1||zone>6)return null;
    const key=lotHash(seed,p.col,p.row),district=lotHash(seed,p.col>>3,p.row>>3);
    const homes=zone<=2,shops=zone===3||zone===4,compact=Math.min(p.w,p.h)===1;
    const taller=!compact&&(homes?formerHeight>=15:shops?formerHeight>=26:true);
    const list=homes?(taller?residentialMid:residentialLow):shops?(taller?commercialTall:commercialLow):
        (taller?industrialLarge:industrialLow);
    const start=((key%6===0?district:key)>>>4)%list.length;
    let name=list[start],cost=Infinity;
    for(let offset=0;offset<list.length;offset++){
        const option=list[(start+offset)%list.length];
        let score=offset*.025;
        for(const q of neighbors)if(q.preset.name===option){
            const distance=Math.hypot(q.x-p.x,q.z-p.z);
            score+=Math.max(0,1-distance/100)**2;
        }
        if(score<cost){cost=score;name=option;}
    }
    const turn=streetEdge(p,streetTiles,key%4);
    const frontage=16*(turn%2?p.h:p.w),depth=16*(turn%2?p.w:p.h);
    const w=frontage-(compact?2.8:4),d=depth-(compact?3.4:5.2);
    // Restrict floor counts to a small set so identical shells can share the
    // mesh and collision acceleration structure at many street addresses.
    let h;
    if(homes)h=taller?Math.max(15,Math.min(58,Math.round(formerHeight/3.1)*3.1)):[6.8,8.4,9.6][(key>>>12)%3];
    else if(shops)h=taller?Math.max(28,Math.min(81,Math.round(formerHeight/3.6)*3.6)):
        Math.max(6.6,Math.min(19.8,Math.round(formerHeight/3.3)*3.3));
    else h=taller?Math.max(13,Math.min(46,Math.round(formerHeight/4)*4)):
        [8.5,10,12.5][(key>>>12)%3];
    return {name,w,d,h,turn,key:name+'|'+w+'|'+d+'|'+h};
}

export function createPresetPlanner(seed,streetTiles){
    const blocks=new Map();
    return (lot,zone,formerHeight)=>{
        const col=lot.col>>3,row=lot.row>>3,neighbors=[];
        for(let z=row-1;z<=row+1;z++)for(let x=col-1;x<=col+1;x++){
            const block=blocks.get(x+','+z);if(block)neighbors.push(...block);
        }
        const preset=planCityPreset(lot,zone,seed,streetTiles,formerHeight,neighbors);
        if(preset){
            const key=col+','+row;
            if(!blocks.has(key))blocks.set(key,[]);
            blocks.get(key).push({x:lot.x,z:lot.z,preset});
        }
        return preset;
    };
}
