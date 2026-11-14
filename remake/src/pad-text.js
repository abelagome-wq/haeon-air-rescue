const initials='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const vowels='ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
// Index zero is the syllable without a final consonant.
const finals=' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
const vowelPairs={'ㅗㅏ':'ㅘ','ㅗㅐ':'ㅙ','ㅗㅣ':'ㅚ','ㅜㅓ':'ㅝ','ㅜㅔ':'ㅞ','ㅜㅣ':'ㅟ','ㅡㅣ':'ㅢ'};
const finalPairs={'ㄱㅅ':'ㄳ','ㄴㅈ':'ㄵ','ㄴㅎ':'ㄶ','ㄹㄱ':'ㄺ','ㄹㅁ':'ㄻ','ㄹㅂ':'ㄼ','ㄹㅅ':'ㄽ','ㄹㅌ':'ㄾ','ㄹㅍ':'ㄿ','ㄹㅎ':'ㅀ','ㅂㅅ':'ㅄ'};
const splitFinal=Object.fromEntries(Object.entries(finalPairs).map(([pair,jamo])=>[jamo,pair]));

export function composePadText(sequence){
  let result='',initial='',vowel='',final='';
  function commit(){
    if(initial&&vowel){
      const block=(initials.indexOf(initial)*21+vowels.indexOf(vowel))*28+(final?finals.indexOf(final):0);
      result+=String.fromCharCode(0xac00+block);
    }else result+=initial+vowel;
    initial=vowel=final='';
  }
  for(const ch of sequence){
    if(vowels.includes(ch)){
      if(final){
        // The second consonant of a complex final moves to the next syllable.
        const pair=splitFinal[final],next=pair?pair[1]:final;
        final=pair?pair[0]:'';commit();initial=next;vowel=ch;
      }else if(!vowel)vowel=ch;
      else if(vowelPairs[vowel+ch])vowel=vowelPairs[vowel+ch];
      else{commit();vowel=ch;}
    }else if(initials.includes(ch)){
      if(initial&&vowel&&!final&&finals.includes(ch))final=ch;
      else if(final&&finalPairs[final+ch])final=finalPairs[final+ch];
      else{commit();initial=ch;}
    }else{commit();result+=ch;}
  }
  commit();return result;
}
