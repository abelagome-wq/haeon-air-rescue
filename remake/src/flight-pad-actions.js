// Each physical press produces a tap or a hold, never both. Polling against
// monotonic time keeps the bindings independent of the renderer's frame rate.
export function createFlightPadGestures(){
  const presses=new Map();
  function read(index,down,edge,now,repeat=false){
    if(edge)presses.set(index,{start:now,next:now+450,held:false});
    const press=presses.get(index);
    if(!press)return '';
    if(!down)presses.delete(index);
    if(!press.held&&now-press.start>=450){
      press.held=true;press.next=now+130;return 'hold';
    }
    if(down&&press.held&&repeat&&now>=press.next){press.next=now+130;return 'repeat';}
    return !down&&!press.held?'tap':'';
  }
  return {read,reset:()=>presses.clear()};
}
