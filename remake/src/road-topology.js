// SC2 XBLD transport channels in normalized raster space (+x east, +row south).
// build_city.py reversed the raw right-to-left rows. XZON corners still
// use the saved camera compass; it does not rotate the road or rail raster.
const N=128,TILE=16,UPPER=N*N;
const DIR={N:[0,-1,'S'],E:[1,0,'W'],S:[0,1,'N'],W:[-1,0,'E']};
const shapes=['WE','NS','NS','WE','NS','WE','SE','SW','NW','NE','ENS','SWE','NWS','WNE','NWSE'];
const cornerFlags=[[8,1,4,2],[1,2,8,4],[2,4,1,8],[4,8,2,1]];
const regular={63:'S',64:'W',65:'N',66:'E',67:'EW',68:'NS',69:'EW',70:'NS'};
const freeway={73:'EW',74:'NS',77:'EW',78:'NS',79:'EW',80:'NS',97:'NS',98:'EW',99:'NS',100:'EW',105:'NESW'};
const rails={59:'NS',60:'EW',61:'NS',62:'EW',69:'NS',70:'EW',71:'EW',72:'NS',77:'NS',78:'EW',108:'NS',109:'EW',110:'NS',111:'EW'};
const ramps=[
    [{street:'S',highway:'E'},{street:'W',highway:'N'}],
    [{street:'N',highway:'E'},{street:'E',highway:'N'}],
    [{street:'N',highway:'W'},{street:'E',highway:'S'}],
    [{street:'S',highway:'W'},{street:'W',highway:'S'}]
];

export function rampPorts(code,rotate=false){return ramps[code-93]?.[+!!rotate]??null;}

function bendPorts(code,compass,corner){
    const bend=['SE','SW','NW','NE'][code-101];
    const q=cornerFlags[compass]?.indexOf(corner)??-1;
    if(q<0)return bend;
    // A freeway curve covers a 2x2 lot. Two quadrants turn. The other
    // two carry the outside carriageway straight across to its next tile.
    const east=!!(q&1),south=!!(q&2),atEndX=east===bend.includes('E'),atEndZ=south===bend.includes('S');
    if(atEndX===atEndZ)return bend;
    return atEndX?'EW':'NS';
}

function channels(code,rotate,compass,corner){
    if(code===75)return [{level:'street',ports:'NS'},{level:'highway',ports:'EW'}];
    if(code===76)return [{level:'street',ports:'EW'},{level:'highway',ports:'NS'}];
    const ramp=rampPorts(code,rotate);
    if(ramp)return [{level:'ramp',ports:ramp.street+ramp.highway,ramp}];
    const road=code>=29&&code<=43?shapes[code-29]:code>=81&&code<=88?(rotate?'NS':'EW'):regular[code];
    if(road)return [{level:'street',ports:road}];
    const high=code>=101&&code<=104?bendPorts(code,compass,corner):
        code===106||code===107?(rotate?'NS':'EW'):freeway[code];
    return high?[{level:'highway',ports:high}]:[];
}

export function networkPorts(code,rotate=false,kind='road',compass=0,corner=0){
    if(kind==='rail'){
        const r=code>=44&&code<=58?shapes[code-44]:code===90||code===91?(rotate?'NS':'EW'):rails[code];
        return Array.from(r??'');
    }
    return channels(code,rotate,compass,corner).flatMap(c=>Array.from(c.ports));
}

function levelAt(node,direction){
    if(node.level!=='ramp')return node.level;
    return node.ramp.street===direction?'street':'highway';
}

export function buildRoadGraph(layers,compass,heightAt){
    const nodes=[],byTile=new Array(UPPER);
    for(let i=0;i<UPPER;i++){
        const code=layers.building[i],col=i%N,row=i>>7;
        const layersHere=channels(code,!!(layers.flags[i]&2),compass,layers.zone[i]>>4);
        if(!layersHere.length)continue;
        byTile[i]=[];
        for(const c of layersHere){
            const id=i+(layersHere.length>1&&c.level==='highway'?UPPER:0);
            const x=(col+.5-N/2)*TILE,z=(row+.5-N/2)*TILE;
            const node={id,tileId:i,col,row,x,y:heightAt(i,x,z,c.level),z,code,level:c.level,shapePorts:Array.from(c.ports),
                ports:[],neighbors:[]};
            if(c.ramp)node.ramp=c.ramp;
            byTile[i].push(node);nodes.push(node);
        }
    }
    // SC2 encodes the side merge in the *ramp* tile. The adjoining
    // carriageway usually retains its ordinary straight XBLD code.
    for(const p of nodes)if(p.ramp){
        const [dx,dz,back]=DIR[p.ramp.highway],x=p.col+dx,z=p.row+dz;
        if(x<0||x>=N||z<0||z>=N)continue;
        const highway=byTile[z*N+x]?.find(q=>q.level==='highway');
        if(highway&&!highway.shapePorts.includes(back))highway.shapePorts.push(back);
    }
    for(const p of nodes){
        for(const side of p.shapePorts){
            const [dx,dz,back]=DIR[side],x=p.col+dx,z=p.row+dz;
            if(x<0||x>=N||z<0||z>=N)continue;
            const neighbor=byTile[z*N+x]?.find(q=>q.shapePorts.includes(back)&&levelAt(p,side)===levelAt(q,back));
            if(neighbor){p.ports.push(side);p.neighbors.push(neighbor.id);}
        }
    }
    // A matched opposing portal identifies a true buried run. Expose the
    // pair for tunnel-aware clients; ordinary neighbors are surface edges.
    for(const p of nodes){
        if(p.code!==63&&p.code!==64)continue;
        const inward=p.code===63?'N':'E',[dx,dz]=DIR[inward];
        for(let x=p.col+dx,z=p.row+dz;x>=0&&x<N&&z>=0&&z<N;x+=dx,z+=dz){
            const q=byTile[z*N+x]?.[0];
            if(!q||q.code<63||q.code>66)continue;
            if(q.code===p.code+2){p.tunnelPeer=q.id;q.tunnelPeer=p.id;}
            break;
        }
    }
    return nodes;
}
