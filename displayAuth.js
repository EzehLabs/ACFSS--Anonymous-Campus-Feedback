const fs = require('fs');
let text = fs.readFileSync('new.html', 'utf8');
let lines = text.split(/\r\n|\r|\n/);
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Authorization')) {
    console.log('line', i+1, JSON.stringify(lines[i]));
    console.log('includes oldPattern?', lines[i].includes("'Authorization': `******"));
    console.log('chars', lines[i].split('').map(c => c.charCodeAt(0)));
  }
}
