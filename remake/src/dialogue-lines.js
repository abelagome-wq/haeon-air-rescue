import korean from './spoken-lines.js';
import english from './spoken-lines-en.js';

export function dialogueLines(language = 'ko') {
  return language === 'en' ? english : korean;
}
