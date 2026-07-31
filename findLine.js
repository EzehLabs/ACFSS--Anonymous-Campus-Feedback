const fs = require('fs');
const p='C:/Users/USER/Desktop/Anonymous website/new.html';
const s=fs.readFileSync(p,'utf8');
const needle='id="complaintsContainer"';
const idx=s.indexOf(needle);
if(idx===-1){console.log('Not found'); process.exit(0);}const before=s.slice(0,idx);
const lineNumber=before.split(/\r\n|\r|\n/).length;
console.log('Found at approx line', lineNumber);
const lines=s.split(/\r\n|\r|\n/);
for(let i=Math.max(0,lineNumber-5);i<Math.min(lines.length,lineNumber+5);i++){
  console.log((i+1)+': '+lines[i]);
}
