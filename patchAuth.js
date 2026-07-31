const fs = require('fs');
const path = 'new.html';
let text = fs.readFileSync(path, 'utf8');
const oldSubstring = "'Authorization': `******";
const newLine = "                        'Authorization': `Bearer ${auth.token}`";
let count = 0;
text = text.split(/\r?\n/).map(line => {
  if (line.includes(oldSubstring)) {
    count++;
    return newLine;
  }
  return line;
}).join('\r\n');
console.log('replaced', count, 'lines');
fs.writeFileSync(path, text, 'utf8');
