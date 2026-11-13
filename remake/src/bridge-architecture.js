// Metres in bridge coordinates: X follows the crossing, Z runs across it.
// Members are closed solids. The space between ribs, cables and piers is also
// the space available to the aircraft when this mesh enters flightScenery.
const concrete=0xc8c1ad, soffit=0x8b918c, coping=0xe2d8bd, bearing=0x475454;
const zinc=0xaebfba, railSteel=0x6c7f7b, darkSteel=0x455659;
const ochre=0xc99f63, archPaint=0xab5a43, trussPaint=0x547b72;
const clamp=(n,a,b)=>Math.max(a,Math.min(n,b));

function meshWriter(T){
    const positions=[],normals=[],colors=[],indices=[],swatches=new Map();
    function face(points,inside,paint){
        let [a,b,c]=points;
        const ab=new T.Vector3().subVectors(b,a),ac=new T.Vector3().subVectors(c,a);
        const n=ab.cross(ac);
        if(n.lengthSq()<1e-13)return;
        if(n.dot(new T.Vector3().subVectors(a,inside))<0){
            points=points.slice().reverse();n.negate();
        }
        n.normalize();
        if(!swatches.has(paint)){
            const rgb=new T.Color(paint);
            swatches.set(paint,[rgb.r,rgb.g,rgb.b].map(v=>Math.round(255*v)));
        }
        const start=positions.length/3;
        for(const v of points){
            positions.push(v.x,v.y,v.z);normals.push(n.x,n.y,n.z);colors.push(...swatches.get(paint));
        }
        for(let j=1;j<points.length-1;j++)indices.push(start,start+j,start+j+1);
    }
    function loft(rings,paint){
        for(let i=1;i<rings.length;i++){
            const back=rings[i-1],front=rings[i],n=back.length,inside=new T.Vector3();
            for(const ring of [back,front])for(const p of ring)inside.add(p);
            inside.divideScalar(n*2);
            for(let j=0;j<n;j++){
                const k=(j+1)%n;
                face([back[j],back[k],front[k],front[j]],inside,paint);
            }
            if(i===1)face(back,inside,paint);
            if(i===rings.length-1)face(front,inside,paint);
        }
    }
    function beam(a,b,width,height,paint){
        const dir=new T.Vector3().subVectors(b,a);
        if(dir.lengthSq()<1e-12)return;
        dir.normalize();
        // 'height' measures the depth of the member in its vertical plane.
        const side=Math.abs(dir.y)>.999?new T.Vector3(0,0,1):new T.Vector3(-dir.z,0,dir.x).normalize();
        const up=new T.Vector3().crossVectors(side,dir).normalize();
        side.multiplyScalar(width*.5);up.multiplyScalar(height*.5);
        const ring=p=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,u])=>p.clone().addScaledVector(side,s).addScaledVector(up,u));
        loft([ring(a),ring(b)],paint);
    }
    function finish(){
        const g=new T.BufferGeometry();
        g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
        g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
        g.setAttribute('color',new T.Uint8BufferAttribute(colors,3,true));
        g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();return g;
    }
    return {loft,beam,finish};
}

export function buildBridgeGeometry(T,span){
    const {style,level,length,halfWidth:w,yAt,bedAt}=span;
    const end=length/2,rail=level==='rail',g=meshWriter(T);
    const slabTop=rail?-.44:-.025,slabBottom=slabTop-.52;
    const point=(x,y,z)=>new T.Vector3(x,y,z);
    const at=(x,z,dy=0)=>point(x,yAt(x,z)+dy,z);
    const stations=(a,b,count)=>Array.from({length:count+1},(_,i)=>a+(b-a)*i/count);
    const cuts=stations(-end,end,Math.ceil(length/4));
    function sweep(xs,section,paint){
        g.loft(xs.map(x=>section(x).map(([z,dy])=>at(x,z,dy))),paint);
    }
    function strip(xs,z,half,top,bottom,paint){
        sweep(xs,()=>[[z-half,top],[z+half,top],[z+half,bottom],[z-half,bottom]],paint);
    }
    function crossbar(x,z1,z2,dy,width,height,paint){
        g.beam(at(x,z1,dy),at(x,z2,dy),width,height,paint);
    }
    function pier(x,abutment=false){
        const along=abutment?Math.min(1.38,length*.04):.86;
        const spread=w-(abutment?.18:.9);
        const padTop=yAt(x,0)+slabBottom-(style==='girder'?1.46:0);
        const top=padTop-.18;
        const bottom=Math.min(bedAt(x,0),bedAt(x,-spread),bedAt(x,spread))-.35;
        if(top-bottom<.15)return;
        // Point the two noses into the tidal current, across the bridge axis.
        const pierRing=(y,a,b)=>[[-a,-b*.70],[0,-b],[a,-b*.70],[a,b*.70],[0,b],[-a,b*.70]]
            .map(([dx,z])=>point(x+dx,y,z));
        const cap=top-Math.min(.27,(top-bottom)*.3);
        const flare=Math.max(bottom+(cap-bottom)*.1,cap-.85);
        g.loft([pierRing(bottom,along,spread*.86),pierRing(flare,along*.84,spread*.78),
            pierRing(cap,along*1.12,spread)],concrete);
        g.loft([pierRing(cap,along*1.12,spread),pierRing(top,along*1.12,spread)],soffit);
        for(const side of [-1,1]){
            const z=side*spread*.67;
            g.beam(point(x-.44,top+.09,z),point(x+.44,top+.09,z),.68,.19,bearing);
        }
    }
    const bearingInset=Math.min(1.55,length*.095);
    const left=-end+bearingInset,right=end-bearingInset;
    pier(left,true);pier(right,true);

    // The wearing course comes from the road mesh. Rail datum is the head of
    // the running rail, above the sleepers and ballast trough.
    for(const s of [-1,1]){
        const a=s*w,b=s*(w-.24),c=s*(w-.63);
        sweep(cuts,()=>[[0,slabTop],[a,slabTop],[a,slabTop-.22],[b,slabTop-.34],
            [c,slabBottom],[0,slabBottom]],concrete);
        strip(cuts,s*(w-.17),.17,.12,slabTop,coping);
        const railZ=s*(w-.13);
        strip(cuts,railZ,.076,1.14,1.02,railSteel);
        strip(cuts,railZ,.043,.68,.60,zinc);
        for(const x of stations(-end+.15,end-.15,Math.max(1,Math.ceil(length/3.55)))){
            g.beam(at(x,railZ,.1),at(x,railZ,1.04),.10,.12,railSteel);
        }
    }
    if(rail){
        for(const x of stations(-end+.35,end-.35,Math.max(1,Math.round(length/.95)))){
            crossbar(x,-1.35,1.35,-.327,.25,.20,0x736d61);
        }
        for(const s of [-1,1]){
            strip(cuts,s*.74,.09,-.17,-.25,darkSteel);
            strip(cuts,s*.74,.035,-.075,-.19,railSteel);
            strip(cuts,s*.74,.075,0,-.082,zinc);
        }
    }

    function girder(){
        const bays=Math.max(1,Math.ceil((right-left)/35)),supports=stations(left,right,bays);
        for(const x of supports.slice(1,-1))pier(x);
        for(const s of [-1,1]){
            const z=s*w*.64;
            sweep(cuts,x=>{
                const gap=Math.min(...supports.map(p=>Math.abs(x-p)));
                const depth=.68+.78*Math.max(0,1-gap/9)**2;
                return [[z-.50,slabBottom+.06],[z+.50,slabBottom+.06],[z+.29,slabBottom-depth],[z-.29,slabBottom-depth]];
            },soffit);
        }
        // Each diaphragm ties the longitudinal concrete girders together.
        for(const x of supports)crossbar(x,-w*.76,w*.76,slabBottom-.33,.56,.72,soffit);
    }
    function sideTie(s,color){
        const z=s*(w-.21);
        strip(cuts,z,.23,.28,-.42,color);
        strip(cuts,z,.34,.34,.23,color);
        strip(cuts,z,.32,-.33,-.48,darkSteel);
    }
    function arch(){
        const spanLength=right-left,rise=clamp(spanLength*.185,3.5,19);
        const bays=Math.max(6,2*Math.ceil(spanLength/12)),xs=stations(left,right,bays);
        const archPoint=(x,s)=>{
            const u=(x-left)/spanLength,p=4*u*(1-u);
            return at(x,s*(w-.22-.5*p),.28+rise*p);
        };
        for(const s of [-1,1]){
            sideTie(s,archPaint);
            // Loft the curved box rib through common joints; no gaps between
            // straight approximations to its upper and lower edges.
            const rings=xs.map(x=>{
                const p=archPoint(x,s),wide=clamp(spanLength*.006,.18,.42),deep=wide*1.36;
                return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>point(x,p.y+b*deep,p.z+a*wide));
            });
            g.loft(rings,archPaint);
            for(let i=2;i<xs.length-1;i++){
                const x=xs[i],foot=x+(i<=bays/2?-.42:.42)*(spanLength/bays);
                g.beam(at(foot,s*(w-.21),.33),archPoint(x,s),.105,.12,zinc);
            }
        }
        for(let i=1;i<bays;i++){
            const x=xs[i],a=archPoint(x,-1),b=archPoint(x,1);
            if(a.y-yAt(x,0)<6.1||i%2)continue;
            g.beam(a,b,.23,.25,archPaint);
        }
    }
    function truss(){
        const run=right-left,panels=Math.max(4,2*Math.ceil(run/13)),xs=stations(left,right,panels);
        const rise=clamp(run*.155,5.9,13.8);
        const line=(i,s,top=false)=>{
            const x=xs[i],z=s*(w-.20);
            const crown=.80+.20*Math.sin(i*Math.PI/panels);
            return at(x,z,top?rise*crown:.26);
        };
        for(const s of [-1,1]){
            sideTie(s,trussPaint);
            for(let i=0;i<panels;i++){
                const a=line(i,s,i%2===1),b=line(i+1,s,i%2===0);
                g.beam(a,b,.22,.32,trussPaint);
                if(i>0&&i<panels-1)g.beam(line(i,s,true),line(i+1,s,true),.40,.42,trussPaint);
            }
            for(let i=1;i<panels;i++){
                const upper=line(i,s,true),lower=line(i,s);
                if(i%2===0)g.beam(lower,upper,.16,.20,trussPaint);
                // Broad gussets make the web/chord connection readable at flight height.
                g.beam(lower,at(xs[i],s*(w-.20),.64),.30,.49,trussPaint);
            }
        }
        for(let i=1;i<panels;i++){
            const a=line(i,-1,true),b=line(i,1,true);
            if(a.y-yAt(xs[i],0)<5.5)continue;
            g.beam(a,b,.25,.28,trussPaint);
            if(i<panels-1&&i%2)g.beam(a,line(i+1,1,true),.14,.16,zinc);
        }
    }
    function cable(){
        const towers=length>=84?[left+(right-left)*.24,left+(right-left)*.76]:[left+(right-left)*.40];
        for(const s of [-1,1])sideTie(s,railSteel);
        for(let i=0;i<towers.length;i++){
            const x=towers[i],top=clamp(length*(towers.length===1?.32:.235),10,34);
            pier(x);
            for(const s of [-1,1]){
                const baseZ=s*(w-.13),shoulder=at(x,baseZ,5.6),head=at(x,s*.63,top);
                g.beam(at(x,baseZ,-.54),shoulder,.75,.92,concrete);
                g.beam(shoulder,head,.80,1.00,concrete);
                g.beam(head,at(x,s*.63,top+.48),.89,1.10,ochre);
                const limits=[i===0?left:(towers[i-1]+x)/2,i===towers.length-1?right:(x+towers[i+1])/2];
                for(const limit of limits){
                    const reach=limit-x,number=clamp(Math.round(Math.abs(reach)/4.5),2,9);
                    for(let k=1;k<=number;k++){
                        const t=(k+.32)/(number+.44),ax=x+reach*t;
                        const from=at(x,s*(.63+1.08*(1-t)),top-(1-t)*3.2);
                        const to=at(ax,baseZ,.39),socket=to.clone().lerp(from,.075);
                        g.beam(from,to,.112,.112,zinc);g.beam(to,socket,.21,.22,ochre);
                    }
                }
            }
            g.beam(at(x,-.65,top-.38),at(x,.65,top-.38),.93,.65,concrete);
            crossbar(x,-w,w,-.60,1.18,.86,soffit);
        }
    }
    if(style==='arch')arch();
    else if(style==='truss')truss();
    else if(style==='cable')cable();
    else girder();
    const geometry=g.finish();geometry.name='River bridge / '+style;return geometry;
}
