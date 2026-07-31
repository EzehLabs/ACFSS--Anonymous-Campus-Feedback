const fs=require('fs');
const html=fs.readFileSync('C:/Users/USER/Desktop/Anonymous website/new.html','utf8');
const regex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
let m; let count=0;
while((m=regex.exec(html))){
  count++;
  const code=m[1];
  try{ new Function(code); console.log('script',count,'valid'); }
  catch(err){ console.error('script',count,'invalid',err.message); process.exit(1); }
}
console.log('checked',count,'script blocks');
