const fs = require('fs');
const path = 'C:/Users/Administrator/Desktop/speed-test';
try {
  fs.mkdirSync(path, {recursive:true});
  console.log('dir created at ' + path);
} catch(e) {
  console.log('Error: ' + e.message);
}
