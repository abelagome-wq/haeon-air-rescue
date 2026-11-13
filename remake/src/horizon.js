// Continue the terminal land/water colours beyond the flight boundary. Only the
// 128×128 original map is playable; these low-cost strips avoid a cut-off ocean.
export function addHorizon(T,scene,city){
  const water=scene.getObjectByName('SC2 water')?.material,land=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide}),sea=water||land;
  const parts=[{p:[],c:[],ix:[],depth:[]},{p:[],c:[],ix:[],depth:[]}],levels=[0,48,180,500,1100,2150];
  const side=(s,t)=>s===0?[-1024,t]:s===1?[1024,t]:s===2?[t,-1024]:[t,1024];
  const inside=(n)=>Math.max(-1023.97,Math.min(1023.97,n));
  for(let s=0;s<4;s++)for(let i=0;i<128;i++){
    const t=i*16-1024,mid=side(s,t+8),tile=city.tileAt(inside(mid[0]),inside(mid[1])),wet=tile?.water===true;
    const out=parts[+wet],a=side(s,t),b=side(s,t+16),ia=[inside(a[0]),inside(a[1])],ib=[inside(b[0]),inside(b[1])];
    const ay=wet?tile.waterY:city.surfaceAt(...ia),by=wet?tile.waterY:city.surfaceAt(...ib);
    for(let j=0;j<levels.length-1;j++){
      const first=out.p.length/3;
      for(const [end,d,y] of [[a,levels[j],ay],[b,levels[j],by],[b,levels[j+1],by],[a,levels[j+1],ay]]){
        const factor=1+d/1024,x=end[0]*factor,z=end[1]*factor,fade=Math.min(1,d/800);
        const h=y+(wet?0:fade*(18+11*Math.sin(x*.0047)+8*Math.cos(z*.0031)+3*Math.sin((x+z)*.009)));
        out.p.push(x,h-.055,z);out.c.push(...(wet?[.019,.124,.177]:[.103+fade*.028,.153+fade*.022,.101+fade*.047]));out.depth.push(12);
      }
      if(s===1||s===2)out.ix.push(first,first+1,first+2,first,first+2,first+3);
      else out.ix.push(first,first+2,first+1,first,first+3,first+2);
    }
  }
  for(let i=0;i<2;i++){const a=parts[i];if(!a.p.length)continue;const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(a.p,3));g.setAttribute('color',new T.Float32BufferAttribute(a.c,3));g.setAttribute('waterDepth',new T.Float32BufferAttribute(a.depth,1));g.setIndex(a.ix);g.computeVertexNormals();
    const m=new T.Mesh(g,i?sea:land);m.name=i?'Beyond city · estuary':'Beyond city · landscape';scene.add(m);}
}
