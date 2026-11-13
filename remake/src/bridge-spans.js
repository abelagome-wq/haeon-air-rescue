// A crossing follows one physical transport channel from bank to bank.
// Its road paint, railhead, and structural deck use the same surveyed grade.
const N=128,TILE=16;

export function bridgeLevel(code){
    if(code>=81&&code<=88)return 'street';
    if(code===90||code===91)return 'rail';
    if(code===106||code===107)return 'highway';
    return null;
}

function makeSpan(city,tiles,vertical,level){
    const start=city.tileToWorld(tiles[0]%N,tiles[0]>>7),length=tiles.length*TILE;
    const x=start.x+(vertical?0:(length-TILE)/2),z=start.z+(vertical?(length-TILE)/2:0);
    const profiles=tiles.map(id=>city.roadProfileAt(id%N,id>>7,level));
    const wx=(along,side)=>x+(vertical?-side:along),wz=(along,side)=>z+(vertical?along:side);
    function yAt(along,side=0){
        // At the outermost endpoint, sample the span's last tile even if the
        // neighboring cell is dry, disconnected, a ramp, or an open leaf.
        const j=Math.max(0,Math.min(tiles.length-1,Math.floor((along+length/2)/TILE)));
        return profiles[j].heightAt(wx(along,side),wz(along,side));
    }
    const bedAt=(along,side=0)=>city.groundAt(wx(along,side),wz(along,side));
    return {tiles,level,axis:vertical?'z':'x',x,z,center:{x,z},length,
        halfWidth:level==='rail'?2.75:level==='highway'?6.25:5.6,yAt,bedAt};
}

function chooseStyle(span,seed,counts){
    const {length,tiles,level}=span;
    const choices=length<=32?['girder']:level==='rail'?['truss','girder','arch']:
        length>=96?['girder','arch','truss','cable']:['arch','truss','girder'];
    let salt=(seed^Math.imul(tiles[0]+1,0x9e3779b1))>>>0;
    salt=(salt^(salt>>>16))>>>0;
    const start=salt%choices.length;
    let choice=choices[start];
    for(let i=1;i<choices.length;i++){
        const next=choices[(start+i)%choices.length];
        if((counts.get(next)??0)<(counts.get(choice)??0))choice=next;
    }
    return choice;
}

export function planBridgeSpans(city){
    const {building,flags}=city.layers,spans=[],seen=new Set(),counts=new Map(),byTile=new Map();
    for(let id=0;id<building.length;id++){
        const level=bridgeLevel(building[id]);
        if(!level||seen.has(id))continue;
        const vertical=!!(flags[id]&2),step=vertical?N:1,tiles=[];
        // Closed bridge codes have reciprocal straight ports along their flag
        // axis. Stop at an open drawbridge, a different axis or channel, or a
        // map edge. Adjacent parallel carriageways never share a centreline.
        for(let i=id;i<building.length&&bridgeLevel(building[i])===level&&!!(flags[i]&2)===vertical;i+=step){
            seen.add(i);tiles.push(i);
            if(!vertical&&i%N===N-1)break;
        }
        const span=makeSpan(city,tiles,vertical,level);
        // RD106's reinforced 2×2 motorway modules carry two parallel decks.
        // Keep the two structures alike without inserting a pier or slab in
        // the median between their independently surveyed profiles.
        const neighbor=level==='highway'&&tiles.some(i=>building[i]===106)
            ?byTile.get(id-(vertical?1:N)):null;
        const twin=neighbor?.level===level&&neighbor.axis===span.axis&&neighbor.tiles.length===tiles.length;
        span.style=twin?neighbor.style:chooseStyle(span,city.generated?.seed??0,counts);
        counts.set(span.style,(counts.get(span.style)??0)+1);
        for(const i of tiles)byTile.set(i,span);
        spans.push(span);
    }
    return spans;
}

export function addBridgeSpans(T,city,group,owned,buildGeometry){
    const spans=planBridgeSpans(city);
    city.bridgeSpans=spans;
    if(!spans.length)return;
    const material=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
    material.name='Bridge steel, concrete and timber';owned.push(material);
    for(const span of spans){
        const geometry=buildGeometry(T,span),mesh=new T.Mesh(geometry,material);
        mesh.position.set(span.x,0,span.z);
        mesh.rotation.y=span.axis==='z'?-Math.PI/2:0;
        mesh.name='Coastal bridge '+span.style+' '+span.tiles[0];
        mesh.receiveShadow=true;mesh.updateMatrix();group.add(mesh);owned.push(geometry);
        span.matrix=mesh.matrix;span.mesh=mesh;
        city.flightScenery.add(geometry,mesh.matrix,'bridge');
    }
}
