const fs = require('fs');
let text = fs.readFileSync('new.html', 'utf8');
const oldPattern = "'Authorization': `******";
const replacement = "                        'Authorization': `Bearer ${auth.token}`";
let count = 0;
let lines = text.split(/\r\n|\r|\n/).map(line => {
  if (line.includes(oldPattern)) {
    count++;
    return replacement;
  }
  return line;
});
console.log('count', count);
fs.writeFileSync('new.html', lines.join('\r\n'), 'utf8');
