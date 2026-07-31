const fs = require('fs');
const p = 'C:/Users/USER/Desktop/Anonymous website/new.html';
const s = fs.readFileSync(p,'utf8');
const parts = s.split(/<script[^>]*>/i).slice(1).map(x=>x.split(/<\/script>/i)[0]);
console.log('Found', parts.length, 'script blocks');
parts.forEach((b,i)=>{
  const backticks=(b.match(/`/g)||[]).length;
  const lines=b.split(/\r\n|\r|\n/);
  console.log('--- script',i+1,'backticks=',backticks,'lines=',lines.length);
  console.log(lines.slice(0,10).map((l,idx)=> (idx+1)+': '+l).join('\n'));
});
