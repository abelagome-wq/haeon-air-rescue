// One immutable, indexed mesh per design and size. The city uses these same
// faces for its sector render batches, roof queries and helicopter contacts.
export const presetFinishes=['solid','plaster','brick','metal','tile','glass','shop','plant','stone','wood','pv'];

export function buildPresetMesh(T,design,w,d,h){
    const positions=[],normals=[],colors=[],kinds=[],indices=[],swatches=new Map();
    function face(points,color,finish='solid'){
        if(points.length<3)return;
        const n=[0,0,0];
        for(let i=0;i<points.length;i++){
            const a=points[i],b=points[(i+1)%points.length];
            n[0]+=(a[1]-b[1])*(a[2]+b[2]);
            n[1]+=(a[2]-b[2])*(a[0]+b[0]);
            n[2]+=(a[0]-b[0])*(a[1]+b[1]);
        }
        const length=Math.hypot(...n);
        if(length<1e-8)return;
        const normal=n.map(v=>Math.round(127*v/length)),first=positions.length/3;
        const kind=presetFinishes.indexOf(finish);
        if(kind<0)throw Error('Unknown architectural finish: '+finish);
        if(!swatches.has(color)){
            const tint=new T.Color(color);
            swatches.set(color,[tint.r,tint.g,tint.b].map(v=>Math.round(255*v)));
        }
        for(const point of points){
            positions.push(...point);normals.push(...normal);colors.push(...swatches.get(color));kinds.push(kind+1);
        }
        for(let i=1;i<points.length-1;i++)indices.push(first,first+i,first+i+1);
    }
    function prism(outline,lo,hi,color,finish){
        // Viewed on the X/Z plan, an anticlockwise rim gives outward side
        // normals in the vertex order below. Concave roofs use ear clipping.
        const area=outline.reduce((sum,[x,z],i)=>{
            const next=outline[(i+1)%outline.length];return sum+x*next[1]-z*next[0];
        },0);
        const rim=area<0?[...outline].reverse():outline;
        const bottom=rim.map(([x,z])=>[x,lo,z]),top=rim.map(([x,z])=>[x,hi,z]);
        for(let i=0;i<rim.length;i++){
            const j=(i+1)%rim.length;face([bottom[i],top[i],top[j],bottom[j]],color,finish);
        }
        const triangles=T.ShapeUtils.triangulateShape(rim.map(([x,z])=>new T.Vector2(x,z)),[]);
        // Each cap triangle has its own winding, including across concave corners.
        for(const [a,b,c] of triangles){
            face([top[c],top[b],top[a]],color,finish);
            face([bottom[a],bottom[b],bottom[c]],color,finish);
        }
    }
    function box(cx,y,cz,width,height,depth,color,finish){
        const x0=cx-width/2,x1=cx+width/2,z0=cz-depth/2,z1=cz+depth/2,y1=y+height;
        const a=[x0,y,z0],b=[x1,y,z0],c=[x1,y,z1],e=[x0,y,z1];
        const A=[x0,y1,z0],B=[x1,y1,z0],C=[x1,y1,z1],E=[x0,y1,z1];
        face([a,A,B,b],color,finish);face([b,B,C,c],color,finish);
        face([c,C,E,e],color,finish);face([e,E,A,a],color,finish);
        face([A,E,C,B],color,finish);face([a,b,c,e],color,finish);
    }
    design({box,prism,face},w,d,h);
    // Some roofs end just below their design envelope (arched roofs in
    // particular). Match the surveyed peak used in approach and skyline data.
    let peak=0;
    for(let i=1;i<positions.length;i+=3)peak=Math.max(peak,positions[i]);
    const heightScale=h/peak;
    if(Math.abs(heightScale-1)>.000001){
        for(let i=1;i<positions.length;i+=3){
            positions[i]*=heightScale;
            const x=normals[i-1],y=normals[i]/heightScale,z=normals[i+1],k=127/Math.hypot(x,y,z);
            normals[i-1]=Math.round(k*x);normals[i]=Math.round(k*y);normals[i+1]=Math.round(k*z);
        }
    }
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setAttribute('normal',new T.Int8BufferAttribute(normals,3,true));
    g.setAttribute('color',new T.Uint8BufferAttribute(colors,3,true));
    g.setAttribute('urbanKind',new T.Float32BufferAttribute(kinds,1));
    g.setAttribute('uv',new T.BufferAttribute(new Float32Array(kinds.length*2),2));
    g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();
    return g;
}
