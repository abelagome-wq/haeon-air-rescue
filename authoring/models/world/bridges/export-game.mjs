// Read the same survey, bridge builder and close-range road surface as the game.
import * as T from '../../../../remake/vendor/three/three.module.min.js';
import {createCitySampler} from '../../../../remake/src/city.js';
import {generateCity} from '../../../../remake/src/generated-city.js';
import {planBridgeSpans} from '../../../../remake/src/bridge-spans.js';
import {buildBridgeGeometry} from '../../../../remake/src/bridge-architecture.js';
import {buildRoadSurfaces} from '../../../../remake/src/road-surface.js';
import {cityPresets} from '../../../../remake/src/city-presets.js';
import {buildPresetMesh,presetFinishes} from '../../../../remake/src/preset-mesh.js';

const city=createCitySampler(generateCity('large',42)),spans=planBridgeSpans(city);
const title={arch:'타이드 아치교',cable:'사장교',girder:'콘크리트 거더교',truss:'워런 트러스교'};
const coating=new Map([
    [0xc8c1ad,'콘크리트'],[0x8b918c,'하부 주형·교각 머리'],[0xe2d8bd,'가장자리 덮개'],[0x475454,'교량 받침'],
    [0xaebfba,'강선·보강재'],[0x6c7f7b,'난간·강재'],[0x455659,'하부 플랜지'],[0xc99f63,'케이블 정착구'],
    [0xab5a43,'아치 리브·연결재'],[0x547b72,'트러스 현·복재'],[0x736d61,'침목']
].map(([paint,name])=>[new T.Color(paint).toArray().map(c=>Math.round(c*255)).join(','),name]));
const surfaces=['아스팔트','측구','보도','노면 표시','상판 측면','강재'];
const sections=new Map(spans.flatMap(s=>s.tiles.map(tile=>[tile,s])));
const roads=new Map(spans.map(s=>[s,[]]));
for(const data of buildRoadSurfaces(city).values()){
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(data.positions,3));
    g.setAttribute('color',new T.Uint8BufferAttribute(data.colors,3,true));
    g.setAttribute('kind',new T.Float32BufferAttribute(data.kinds,1));
    g.setIndex(data.indices);g.computeVertexNormals();
    const p=g.attributes.position;
    for(let i=0;i<g.index.count;i+=3){
        const ix=[0,1,2].map(j=>g.index.getX(i+j));
        const col=Math.floor((1024+ix.reduce((s,v)=>s+p.getX(v),0)/3)/16);
        const row=Math.floor((1024+ix.reduce((s,v)=>s+p.getZ(v),0)/3)/16);
        const span=sections.get(row*128+col);
        if(span)roads.get(span).push([g,ix]);
    }
}
// Keep each source triangle. Welding coincident positions within a finish gives
// an editor connected faces while loop normals retain the source shading.
function model(name,metadata){
    const parts=new Map(),bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    let triangles=0;
    function add(g,ix,category,finish,transform){
        const a=g.attributes, rgb=Array.from(a.color.array.slice(ix[0]*3,ix[0]*3+3));
        const key=[category,finish,...rgb].join('|');
        if(!parts.has(key))parts.set(key,{category,finish,rgb,points:[],faces:[],normals:[],byPoint:new Map()});
        const part=parts.get(key),face=[];
        for(const i of ix){
            const read=att=>[att.getX(i),att.getY(i),att.getZ(i)];
            const from=read(a.position),normal=read(a.normal);
            const [x,y,z]=transform?transform(from,false):from;
            const [nx,ny,nz]=transform?transform(normal,true):normal;
            const pos=[x,-z,y].map(Math.fround),pk=pos.join(',');
            pos.forEach((v,k)=>{bounds[k]=Math.min(bounds[k],v);bounds[k+3]=Math.max(bounds[k+3],v);});
            if(!part.byPoint.has(pk)){part.byPoint.set(pk,part.points.length);part.points.push(pos);}
            face.push(part.byPoint.get(pk));part.normals.push([nx,-nz,ny]);
        }
        part.faces.push(face);triangles++;
    }
    function all(g,category,finish){
        for(let i=0;i<g.index.count;i+=3){
            const ix=[0,1,2].map(j=>g.index.getX(i+j));
            add(g,ix,category,finish(g.attributes,ix[0]));
        }
    }
    function record(){
        for(const part of parts.values())delete part.byPoint;
        return {name,metadata,triangles,bounds,parts:[...parts.values()]};
    }
    return {add,all,record};
}
const models=[];
for(const span of spans){
    const shape=model(title[span.style],{start_tile:span.tiles[0],length_m:span.length,axis:span.axis,
        game_center_XYZ:[span.x,0,span.z],road_level:span.level,style:span.style});
    const g=buildBridgeGeometry(T,span);
    shape.all(g,'교량 구조',(a,i)=>coating.get(Array.from(a.color.array.slice(i*3,i*3+3)).join(','))??'도장 강재');
    const transform=([x,y,z],direction)=>{
        if(!direction){x-=span.x;z-=span.z;}
        return span.axis==='z'?[z,y,-x]:[x,y,z];
    };
    for(const [g,ix] of roads.get(span)){
        shape.add(g,ix,'도로 마감',surfaces[g.attributes.kind.getX(ix[0])],transform);
    }
    models.push(shape.record());
}
const office=city.placements.filter(p=>p.preset?.name==='bridge-house').sort((a,b)=>b.preset.h-a.preset.h)[0];
const {w,d,h,turn}=office.preset;
const towers=model('연결교 사옥',{start_tile:office.row*128+office.col,design:'bridge-house',width_depth_height:[w,d,h],
    street_turn:turn,game_center_XYZ:[office.x,office.y+.015,office.z]});
towers.all(buildPresetMesh(T,cityPresets['bridge-house'],w,d,h),'사옥 구조',(a,i)=>presetFinishes[a.urbanKind.getX(i)-1]);
models.push(towers.record());
process.stdout.write(JSON.stringify({cityId:city.cityId,models}));
