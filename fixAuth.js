const fs = require('fs');
const path = 'C:/Users/USER/Desktop/Anonymous website/new.html';
let s = fs.readFileSync(path, 'utf8');
if (s.indexOf('`******') === -1) {
  console.log('Pattern not found.');
  process.exit(0);
}
// Replace backtick+6stars with proper header expression
s = s.replace(/`\*{6}/g, "'Bearer ' + auth.token");
fs.writeFileSync(path, s, 'utf8');
console.log('Replaced pattern');
