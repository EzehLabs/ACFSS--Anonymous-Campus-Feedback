const fs=require('fs');
const p='C:/Users/USER/Desktop/Anonymous website/new.html';
let s=fs.readFileSync(p,'utf8');
const oldStr = "                        'Authorization': `******\n";
const idx = s.indexOf(oldStr);
console.log('idx', idx);
if(idx === -1) {
  console.log('oldStr not found, fallback search');
  const alt = "'Authorization': `";
  const idx2 = s.indexOf(alt);
  console.log('idx2', idx2);
  if(idx2 !== -1) {
    const start = idx2;
    const end = s.indexOf('\n', idx2);
    console.log('line', s.slice(start, end));
  }
  process.exit(0);
}
s = s.replace(oldStr, "                        'Authorization': 'Bearer ' + auth.token\n");
fs.writeFileSync(p,s,'utf8');
console.log('replaced');
