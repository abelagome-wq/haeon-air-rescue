// Reduce the actual traffic model in its own reference frame. Clustering
// positions before building material vertices keeps panel boundaries watertight.
export function makeVehicleProxy(T,template,material,own){
    template.updateWorldMatrix(true,true);
    const bounds=new T.Box3().setFromObject(template,true);
    const span=bounds.getSize(new T.Vector3());
    const cell=Math.max(.14,Math.min(.45,Math.max(span.x,span.y,span.z)/17));
    const grid=new Map(),clusters=[],triangles=[];
    const p=new T.Vector3(),n=new T.Vector3(),normalMatrix=new T.Matrix3();
    const palette=new Map(),glass=new T.Color(0x3e6275);
    function cluster(x,y,z){
        const ix=Math.round((x-bounds.min.x)/cell),iy=Math.round((y-bounds.min.y)/cell),iz=Math.round((z-bounds.min.z)/cell);
        const key=ix+256*(iy+256*iz);
        let id=grid.get(key);
        if(id===undefined){id=clusters.length;grid.set(key,id);clusters.push({sum:new T.Vector3(),low:new T.Vector3(Infinity,Infinity,Infinity),high:new T.Vector3(-Infinity,-Infinity,-Infinity),count:0});}
        const c=clusters[id];c.sum.add(p);c.low.min(p);c.high.max(p);c.count++;
        return id;
    }
    template.traverse(o=>{
        if(!o.isMesh)return;
        for(let ancestor=o;ancestor;ancestor=ancestor.parent){
            if(/interior|cabin and controls/i.test(ancestor.name))return;
        }
        const g=o.geometry,a=g.attributes.position,norm=g.attributes.normal,index=g.index;
        if(!a)return;
        normalMatrix.getNormalMatrix(o.matrixWorld);
        const ids=new Uint32Array(a.count),normals=[];
        for(let i=0;i<a.count;i++){
            p.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);
            ids[i]=cluster(p.x,p.y,p.z);
            n.set(0,1,0);if(norm)n.fromBufferAttribute(norm,i).applyNormalMatrix(normalMatrix);
            normals.push(n.x,n.y,n.z);
        }
        const groups=g.groups.length?g.groups:[{start:0,count:index?.count??a.count,materialIndex:0}];
        for(const group of groups){
            const mat=Array.isArray(o.material)?o.material[group.materialIndex]:o.material;
            if(!mat)continue;
            if(!palette.has(mat)){
                const tint=mat.color?.clone()??new T.Color(0xffffff);
                if(/glass|glazing/i.test(mat.name)||mat.transmission>.15)tint.lerp(glass,.82);
                palette.set(mat,tint);
            }
            for(let i=group.start;i+2<group.start+group.count;i+=3){
                const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;
                if(ids[a]===ids[b]||ids[b]===ids[c]||ids[c]===ids[a])continue;
                triangles.push({ids:[ids[a],ids[b],ids[c]],normals:[...normals.slice(a*3,a*3+3),...normals.slice(b*3,b*3+3),...normals.slice(c*3,c*3+3)],mat});
            }
        }
    });
    for(const c of clusters){
        c.sum.multiplyScalar(1/c.count);
        // Keep exterior extremities on exactly the same planes as the near
        // model, including tire-ground contact and the masthead.
        for(const axis of ['x','y','z']){
            if(Math.abs(c.low[axis]-bounds.min[axis])<.0001)c.sum[axis]=bounds.min[axis];
            if(Math.abs(c.high[axis]-bounds.max[axis])<.0001)c.sum[axis]=bounds.max[axis];
        }
    }
    const positions=[],colors=[],normals=[],indices=[],vertices=new Map(),faces=new Set();
    for(const face of triangles){
        const [a,b,c]=face.ids;const low=Math.min(a,b,c),high=Math.max(a,b,c);
        const key=face.mat.id+'/'+low+'/'+(a+b+c-low-high)+'/'+high;
        if(faces.has(key))continue;
        faces.add(key);
        for(let i=0;i<3;i++){
            const id=face.ids[i],j=i*3,nx=face.normals[j],ny=face.normals[j+1],nz=face.normals[j+2];
            const normalKey=Math.round(nx*3)+8*(Math.round(ny*3)+8*Math.round(nz*3));
            const key=id+'/'+face.mat.id+'/'+normalKey;
            let target=vertices.get(key);
            if(target===undefined){
                target=positions.length/3;vertices.set(key,target);
                const q=clusters[id].sum,tint=palette.get(face.mat);
                positions.push(q.x,q.y,q.z);colors.push(tint.r,tint.g,tint.b);normals.push(nx,ny,nz);
            }
            indices.push(target);
        }
    }
    const geometry=own(new T.BufferGeometry());
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
    geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new T.Mesh(geometry,material);mesh.name='Traffic exterior · single draw';return mesh;
}

