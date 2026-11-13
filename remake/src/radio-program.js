import catalog from './original-radio-data.js';
import {radioSongs} from './radio-songs.js';

export const songsById=new Map(radioSongs.map(song=>[song.id,song]));
const saveKey='simcopter.radio-program.v1';

function shuffled(list,rng){
  const items=list.slice();
  for(let i=items.length-1;i>0;i--){
    const j=Math.floor(rng()*(i+1));
    [items[i],items[j]]=[items[j],items[i]];
  }
  return items;
}

export function createStationProgram({rng=Math.random,storage,isNight=()=>false}={}){
  let log={};
  try{
    const record=JSON.parse(storage?.getItem(saveKey));
    if(record&&typeof record==='object'&&!Array.isArray(record))log=record;
  }catch{}
  function save(){try{storage?.setItem(saveKey,JSON.stringify(log));}catch{}}
  function draw(key,pool,avoid,preferred){
    const signature=pool.join('|'),record=log[key];
    let choices=record?.signature===signature&&Array.isArray(record.remaining)
      ?record.remaining.filter(id=>pool.includes(id)):[];
    if(!choices.length)choices=shuffled(pool,rng);
    let at=choices.findIndex(id=>id!==avoid&&(!preferred||preferred(id)));
    if(at<0)at=choices.findIndex(id=>id!==avoid);
    // Switching a station can leave a sole shared track in its bag. Play a
    // different track first; this one remains eligible on the next visit.
    if(at<0&&pool.length>1){
      const alternatives=shuffled(pool.filter(id=>id!==avoid),rng);
      choices.push(alternatives[0]);at=choices.length-1;
    }
    const [id]=choices.splice(Math.max(0,at),1);
    log[key]={signature,remaining:choices,last:id};save();return id;
  }
  function nextTrack(station){
    const pool=radioSongs.filter(s=>station==='mix'||s.genre===station).map(s=>s.id);
    if(!pool.length)return '';
    const previous=songsById.get(log.lastSong);
    const id=draw('track:'+station,pool,log.lastSong,station==='mix'&&previous
      ?id=>songsById.get(id).genre!==previous.genre:null);
    log.lastSong=id;save();return id;
  }
  function interlude(station,next){
    const genre=songsById.get(next)?.genre;
    if(!genre)return [];
    let until=Number.isInteger(log.untilNotice)?log.untilNotice:2;
    const announcement=--until<=0;
    log.untilNotice=announcement?3+Math.floor(rng()*3):until;save();
    const ids=[];
    if(rng()<(announcement?.42:.60)){
      // Only use a specialist station ID on that station. The first-song
      // greeting and tempo comparison do not describe a shuffled segue.
      const allowed=catalog.stations[genre].dj.filter(id=>id!=='DJ01'&&id!=='DJ05'
        &&(id!=='DJ08'||isNight())&&(station!=='mix'||!['DJ02','DJ03'].includes(id)));
      const id=draw('dj:'+genre,allowed,log.lastDJ);
      if(id){ids.push(id);log.lastDJ=id;save();}
    }
    if(announcement){
      const id=draw('notices',catalog.ads,log.lastNotice);
      ids.push(id);log.lastNotice=id;save();
    }
    return ids;
  }
  return {nextTrack,interlude};
}
