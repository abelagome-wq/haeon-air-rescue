import {planCityParcels} from './parcel-landscape.js';
import {makeVehicleProxy} from './traffic-exterior.js';

// Positions are measured along the same two stall rows painted by hardstand().
// The gate, central aisle, streets and emergency service sites stay open.
export function planParcelProps(plan){
  const items=[];
  for(const p of plan.commons){
    const cargo=p.kind==='loading';
    if(!cargo&&p.kind!=='parking')continue;
    const wide=p.w*16,deep=p.h*16,w=p.edge%2?deep:wide,h=p.edge%2?wide:deep;
    const x0=p.col*16-1024+[0,wide,wide,0][p.edge],z0=p.row*16-1024+[0,0,deep,deep][p.edge];
    const yaw=-p.edge*Math.PI/2,cs=Math.round(Math.cos(yaw)),sn=Math.round(Math.sin(yaw));
    const step=cargo?4.6:3.05;
    for(let i=0,left=3;left+2*step<w-1;left+=step,i++){
      const u=left+step/2;
      for(let row=0;row<(cargo?1:2);row++){
        const key=(Math.imul(p.key^0x94d049bb,i+3) ^ Math.imul(row+5,0x85ebca6b))>>>0;
        if(key%10>(cargo?4:3)||row&&Math.abs(left-p.gate)<=4.8)continue;
        const v=row?3.85:h-(cargo?4.7:3.45),x=x0+cs*u+sn*v,z=z0-sn*u+cs*v;
        items.push({kind:cargo?'cargo':'car',x,z,yaw:yaw+(row?Math.PI:0),tint:key%8,
          levels:cargo&&((key>>>12)%3===0)?2:1,col:p.col,row:p.row});
      }
    }
  }
  return items;
}
function crateGeometry(T){
  const positions=[],normals=[],colors=[];
  function box(x,y,z,w,h,d,hex){
    const g=new T.BoxGeometry(w,h,d),v=g.attributes.position,n=g.attributes.normal,c=new T.Color(hex);
    for(let j=0;j<g.index.count;j++){
      const i=g.index.getX(j);
      positions.push(v.getX(i)+x,v.getY(i)+y,v.getZ(i)+z);normals.push(n.getX(i),n.getY(i),n.getZ(i));
      colors.push(c.r,c.g,c.b);
    }
    g.dispose();
  }
  for(const x of [-.82,0,.82])box(x,.09,0,.22,.18,2.65,'#62584b');
  box(0,.88,0,2.16,1.42,2.58,'#b69267');
  for(const z of [-1.02,1.02]){
    box(0,1.61,z,2.18,.055,.13,'#69726b');
    for(const x of [-1.088,1.088])box(x,.89,z,.035,1.45,.13,'#66716a');
  }
  for(const z of [-1.30,1.30]){
    box(0,1.41,z,2.18,.16,.06,'#c3a37a');box(0,.36,z,2.18,.16,.06,'#a5845f');
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
async function parkedCarGeometry(T,ctx,owned,mat){
  const template=await ctx.assets.load('models/traffic/lod1/AUTO-LOD1.glb');
  const mesh=makeVehicleProxy(T,template,mat,g=>{owned.push(g);return g;});
  const geo=mesh.geometry,box=geo.boundingBox,center=box.getCenter(new T.Vector3()),span=box.getSize(new T.Vector3());
  geo.translate(-center.x,-box.min.y,-center.z);
  if(span.x>span.z)geo.rotateY(Math.PI/2);
  geo.computeBoundingBox();geo.boundingBox.getSize(span);
  geo.scale(1.83/span.x,1.47/span.y,4.46/span.z);geo.computeBoundingBox();geo.computeBoundingSphere();
  // Keep glass, tires and lamps from the released Blender car. Only paint
  // panels pick up an instance's body colour.
  let paint;
  template.traverse(o=>{for(const m of [].concat(o.material||[]))if(m.name==='paint')paint=m.color;});
  const color=geo.attributes.color,mask=new Float32Array(color.count);
  if(paint)for(let i=0;i<color.count;i++){
    if(Math.abs(color.getX(i)-paint.r)+Math.abs(color.getY(i)-paint.g)+Math.abs(color.getZ(i)-paint.b)<.0001){
      mask[i]=1;color.setXYZ(i,1,1,1);
    }
  }
  geo.setAttribute('bodyPaint',new T.Float32BufferAttribute(mask,1));
  mat.onBeforeCompile=s=>{
    const part=T.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;','vColor.xyz *= mix(vec3(1.),instanceColor.xyz,bodyPaint);');
    s.vertexShader='attribute float bodyPaint;\n'+s.vertexShader.replace('#include <color_vertex>',part);
  };
  mat.customProgramCacheKey=()=>'parked-car-paint-v1';return geo;
}
function reserveLanding(city,bounds){
  const cells=city.noLandingTiles??=new Set(),tile=v=>Math.floor((v+1024)/16),pad=6;
  for(let z=tile(bounds.min.z-pad);z<=tile(bounds.max.z+pad);z++)for(let x=tile(bounds.min.x-pad);x<=tile(bounds.max.x+pad);x++){
    if(x>=0&&x<128&&z>=0&&z<128)cells.add(z*128+x);
  }
}
export async function addParcelProps(ctx,city,group,owned){
  if(!city.generated)return;
  const T=ctx.THREE,plan=city.parcelPlan=planCityParcels(city),props=planParcelProps(plan);
  const body=['#b4b7ae','#455668','#8e5145','#d0c7b4','#45564e','#6f8490','#766959','#b1b3a1'];
  const crate=['#f4f0d8','#d4d6bd','#e7dbc3','#e1d0b3'];
  for(const kind of ['car','cargo']){
    const items=props.filter(p=>p.kind===kind);
    if(!items.length)continue;
    const mat=new T.MeshLambertMaterial({vertexColors:true});owned.push(mat);
    const geo=kind==='car'?await parkedCarGeometry(T,ctx,owned,mat):crateGeometry(T);
    if(kind==='cargo')owned.push(geo);
    const count=items.reduce((n,p)=>n+p.levels,0),batch=new T.InstancedMesh(geo,mat,count);
    const o=new T.Object3D(),box=new T.Box3(),paint=new T.Color();let i=0;
    for(const p of items){
      o.rotation.y=p.yaw;o.position.set(p.x,city.groundAt(p.x,p.z),p.z);
      for(let level=0;level<p.levels;level++){
        o.updateMatrix();batch.setMatrixAt(i,o.matrix);
        batch.setColorAt(i++,paint.set(kind==='car'?body[p.tint]:crate[(p.tint+level)%crate.length]));
        const remove=city.flightScenery.add(geo,o.matrix,'equipment');
        if(remove)owned.push({dispose:remove});
        box.copy(geo.boundingBox).applyMatrix4(o.matrix);reserveLanding(city,box);
        o.position.y+=geo.boundingBox.max.y;
      }
    }
    batch.computeBoundingSphere();batch.receiveShadow=true;batch.castShadow=true;
    batch.name=kind==='car'?'Parked district cars':'Timber freight crates';group.add(batch);owned.push(batch);
  }
}
