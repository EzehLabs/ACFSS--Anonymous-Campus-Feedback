const fs = require('fs');
const path = 'C:/Users/USER/Desktop/Anonymous website/new.html';
const s = fs.readFileSync(path, 'utf8');
const idx = s.indexOf("Authorization");
if (idx === -1) { console.log('Authorization not found'); process.exit(0); }
const start = Math.max(0, idx-40);
const end = Math.min(s.length, idx+80);
const snippet = s.slice(start,end);
console.log('SNIPPET:\n' + snippet.replace(/\r/g,'\\r').replace(/\n/g,'\\n'));
for (let i=0;i<snippet.length;i++) {
  const ch = snippet.charAt(i);
  process.stdout.write(ch + '[' + snippet.charCodeAt(i) + ']');
}
console.log('\nDone');
