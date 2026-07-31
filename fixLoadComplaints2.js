const fs=require('fs');
const p='C:/Users/USER/Desktop/Anonymous website/new.html';
let s=fs.readFileSync(p,'utf8');
const search = "'Authorization': `******";
const idx = s.indexOf(search);
if(idx === -1) {
  console.log('search not found');
  process.exit(1);
}
const start = idx;
const endLine = s.indexOf('\n', idx);
const oldLine = s.slice(start, endLine);
console.log('oldLine:', JSON.stringify(oldLine));
const newLine = "'Authorization': 'Bearer ' + auth.token";
s = s.slice(0, start) + newLine + s.slice(endLine);
fs.writeFileSync(p,s,'utf8');
console.log('replaced');
