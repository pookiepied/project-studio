const fs = require('fs');
// Check if Desktop path is accessible
const paths = [
  'C:/Users/Administrator/Desktop',
  'C:/Users/Administrator',
  'C:/Users',
  process.cwd(),
];
paths.forEach(p => {
  try {
    const stat = fs.statSync(p);
    console.log(p + ' EXISTS (isDir=' + stat.isDirectory() + ')');
  } catch(e) {
    console.log(p + ' NOT_FOUND');
  }
});
