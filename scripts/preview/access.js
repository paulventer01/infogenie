'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../../.preview-workspace/access.json');
if (!fs.existsSync(file)) {console.error('Preview is not ready. Check /tmp/infogenie-preview.log.');process.exitCode=1;}
else {const account=JSON.parse(fs.readFileSync(file,'utf8'));console.log(`Synthetic preview login\nEmail: ${account.email}\nPassword: ${account.password}\nKeep port 5000 private. These credentials are for this disposable workspace only.`);}
