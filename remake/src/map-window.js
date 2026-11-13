// City minimaps always cover the 128 × 128 source raster. Flight and map
// controls use the playable bounds, which can occupy only part of that raster.
const full={minX:-1024,minZ:-1024,maxX:1024,maxZ:1024};
export function mapWindow(city,position,width,height=width){
  const bounds=city.bounds??full;
  function area(center,span,lo,hi){
    if(span>=hi-lo)return (lo+hi-span)/2;
    return Math.min(hi-span,Math.max(lo,center-span/2));
  }
  return {x:area(position.x,width,bounds.minX,bounds.maxX),
    z:area(position.z,height,bounds.minZ,bounds.maxZ),width,height};
}
export function drawMapRaster(g,city,view,width,height){
  const raster=city.minimap;
  if(!raster)return;
  const b=city.bounds??full;
  const x=Math.max(view.x,b.minX),z=Math.max(view.z,b.minZ);
  const dx=Math.min(view.x+view.width,b.maxX)-x,dz=Math.min(view.z+view.height,b.maxZ)-z;
  if(dx<=0||dz<=0)return;
  const u=raster.width/2048,v=raster.height/2048;
  g.drawImage(raster,(x+1024)*u,(z+1024)*v,dx*u,dz*v,
    (x-view.x)/view.width*width,(z-view.z)/view.height*height,dx/view.width*width,dz/view.height*height);
}
