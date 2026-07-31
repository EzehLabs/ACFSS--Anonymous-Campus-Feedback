const fs=require('fs');
const p='C:/Users/USER/Desktop/Anonymous website/new.html';
let s=fs.readFileSync(p,'utf8');
const before = s.indexOf("'Authorization': `");
console.log('before index', before);
if(before!==-1){
  s = s.replace(/'Authorization':\s*`\*{6}/g, "'Authorization': 'Bearer ' + auth.token");
  fs.writeFileSync(p,s,'utf8');
  console.log('replaced');
} else console.log('pattern not found');
