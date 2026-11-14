import {buildArchitecturalRelief} from './building-relief.js';
import {acquireUrbanFinish,applyDetailFinish} from './urban-finishes.js';

// Add the Blender-authored close geometry to the same city placements with a
// bounded vertex buffer. One draw covers visible architectural/road details.
export async function createDetails(T,group,{night=false,glass=null}={}){
    const prefix=new URL('../data/cities/detail/',import.meta.url);
    const fetchOK=async(name,method)=>{
        const r=await fetch(new URL(name,prefix));if(!r.ok)throw Error('도시 근경 자료 오류: '+name);
        return r[method]();
    };
    const [records,bytes,texture,parts,partBytes,finish,signs]=await Promise.all([fetchOK('index.json','json'),fetchOK('detail.bin','arrayBuffer'),
        new T.TextureLoader().loadAsync(new URL('surfaces.webp',prefix).href),
        fetchOK('roof-parts.json','json'),fetchOK('roof-parts.bin','arrayBuffer'),acquireUrbanFinish(T),
        new T.TextureLoader().loadAsync(new URL('../art/district-signs.webp',import.meta.url).href)]);
    signs.flipY=false;signs.colorSpace=T.NoColorSpace;signs.anisotropy=4;
    const roofKit={index:parts,raw:new DataView(partBytes)};
    const raw=new DataView(bytes),maxTriangles=22000,maxVertices=maxTriangles*3;
    const g=new T.BufferGeometry();
    const attrib=(name,array,size,normalized=false)=>{
        const attribute=new T.BufferAttribute(array,size,normalized);attribute.setUsage(T.DynamicDrawUsage);
        g.setAttribute(name,attribute);return attribute;
    };
    const pos=attrib('position',new Float32Array(maxVertices*3),3),nor=attrib('normal',new Int8Array(maxVertices*3),3,true);
    const uv=attrib('uv',new Float32Array(maxVertices*2),2),color=attrib('color',new Uint8Array(maxVertices*3),3,true);
    const indices=new T.BufferAttribute(new Uint32Array(maxTriangles*3),1).setUsage(T.DynamicDrawUsage);
    g.setIndex(indices);g.setDrawRange(0,0);
    texture.flipY=false;texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
    const material=new T.MeshLambertMaterial({map:texture,vertexColors:true,side:T.DoubleSide});
    material.onBeforeCompile=s=>{
        s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',
            'if(vMapUv.x>=0.)diffuseColor*=texture2D(map,vMapUv);');
    };
    applyDetailFinish(material,{night,texture:finish.texture,glass,signs});
    const mesh=new T.Mesh(g,material);mesh.name='Original Blender close city detail';mesh.frustumCulled=false;
    group.add(mesh);
    const replaced=new Set();
    const isBuilding=code=>code>=112&&code!==221&&code!==222;
    function update(focus,batches,overrides){
        const candidates=[];
        for(const [id,b] of batches){
            const rec=records[b.code];if(!rec||isBuilding(b.code))continue;
            const tree=b.code>=6&&b.code<=12,street=b.code>=14&&b.code<=111;
            const reach=tree?46:street?80:122;
            for(const item of b.items){
                if(overrides.has(item.placement))continue;
                const foot=item.matrix.elements[13],alt=Math.max(0,focus.y-foot-b.source.max[1]);
                const sq=(item.x-focus.x)**2+(item.z-focus.z)**2+alt*alt;
                if(sq<reach*reach)candidates.push({id,b,rec,item,tree,d:Math.sqrt(sq)*(tree?1.35:street?1.15:1)});
            }
        }
        candidates.sort((a,b)=>a.d-b.d);
        let vertexCount=0,indexCount=0;
        replaced.clear();
        for(const {b,rec,item,tree} of candidates){
            const [offset,n,ni]=rec;
            if(vertexCount+n>maxVertices||indexCount+ni>maxTriangles*3)continue;
            const m=item.matrix.elements;
            const flipped=b.swap;
            const sy=m[5];
            for(let i=0;i<n;i++){
                const k=offset+i*16,t=vertexCount+i;
                const px=raw.getInt16(k,true)/128,py=raw.getInt16(k+2,true)/128,pz=raw.getInt16(k+4,true)/128;
                const x=flipped?pz:px,z=flipped?px:pz;
                pos.array[t*3]=x*m[0]+z*m[8]+m[12];pos.array[t*3+1]=py*sy+m[13];pos.array[t*3+2]=x*m[2]+z*m[10]+m[14];
                const a=raw.getInt8(k+6),ny=raw.getInt8(k+7)/Math.max(.001,sy),c=raw.getInt8(k+8);
                const nx=flipped?c:a,nz=flipped?a:c,len=127/(Math.hypot(nx,ny,nz)||127);
                nor.array[t*3]=Math.round((nx*m[0]+nz*m[8])*len);nor.array[t*3+1]=Math.round(ny*len);nor.array[t*3+2]=Math.round((nx*m[2]+nz*m[10])*len);
                color.array[t*3]=raw.getUint8(k+9);color.array[t*3+1]=raw.getUint8(k+10);color.array[t*3+2]=raw.getUint8(k+11);
                const u=raw.getUint16(k+12,true);
                uv.array[t*2]=u===65535?-1:u/65534;uv.array[t*2+1]=raw.getUint16(k+14,true)/65534;
            }
            const io=offset+n*16;
            for(let i=0;i<ni;i+=3){
                indices.array[indexCount+i]=vertexCount+raw.getUint16(io+i*2,true);
                indices.array[indexCount+i+1]=vertexCount+raw.getUint16(io+(i+(flipped?2:1))*2,true);
                indices.array[indexCount+i+2]=vertexCount+raw.getUint16(io+(i+(flipped?1:2))*2,true);
            }
            if(tree)replaced.add(item);
            vertexCount+=n;indexCount+=ni;
        }
        for(const a of [pos,nor,uv,color,indices]){
            a.clearUpdateRanges();
            const length=a===indices?indexCount:vertexCount*a.itemSize;
            if(length){a.addUpdateRange(0,length);a.needsUpdate=true;}
        }
        g.setDrawRange(0,indexCount);mesh.visible=indexCount>0;
    }
    // One immutable copy per model, shared across all its city placements.
    const shapes=new Map();
    function geometryFor(code){
        if(shapes.has(code))return shapes.get(code);
        const rec=records[code];if(!rec)return null;
        const [offset,count,indexCount]=rec,positions=new Float32Array(count*3),refs=new Uint16Array(indexCount);
        const normals=new Int8Array(count*3),colors=new Uint8Array(count*3),uvs=new Float32Array(count*2);
        for(let i=0;i<count;i++){
            const k=offset+16*i;
            for(let j=0;j<3;j++){
                positions[3*i+j]=raw.getInt16(k+2*j,true)/128;
                normals[3*i+j]=raw.getInt8(k+6+j);colors[3*i+j]=raw.getUint8(k+9+j);
            }
            const u=raw.getUint16(k+12,true);
            uvs[2*i]=u===65535?-1:u/65534;uvs[2*i+1]=raw.getUint16(k+14,true)/65534;
        }
        for(let i=0;i<indexCount;i++)refs[i]=raw.getUint16(offset+count*16+2*i,true);
        const shape=new T.BufferGeometry();
        shape.setAttribute('position',new T.BufferAttribute(positions,3));
        shape.setAttribute('normal',new T.BufferAttribute(normals,3,true));shape.setAttribute('color',new T.BufferAttribute(colors,3,true));
        shape.setAttribute('uv',new T.BufferAttribute(uvs,2));shape.setIndex(new T.BufferAttribute(refs,1));
        shapes.set(code,shape);return shape;
    }
    const fitted=new Map();
    function buildingGeometry(code,base){
        if(fitted.has(code))return fitted.get(code);
        const original=geometryFor(code),model=buildArchitecturalRelief(T,code,base,original,roofKit);
        fitted.set(code,model);return model;
    }
    return {replaced,update,geometryFor,buildingGeometry,isBuilding,material,finishTexture:finish.texture,dispose(){
        mesh.removeFromParent();g.dispose();material.dispose();texture.dispose();signs.dispose();finish.release();
        for(const [code,model] of fitted)if(model&&model!==shapes.get(code))model.dispose();
        for(const shape of shapes.values())shape.dispose();
    }};
}
