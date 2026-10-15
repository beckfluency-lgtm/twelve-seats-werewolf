import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {checkRelease} from './check-release.mjs';import {root,extensionFiles,sourceFiles} from './release-files.mjs';import {zip} from './zip.mjs';
const {version}=checkRelease(),dist=path.join(root,'dist');fs.mkdirSync(dist,{recursive:true});
const sums=[];
for(const [kind,files] of [['extension',extensionFiles],['source',sourceFiles()]]){
 const name=`twelve-seats-${kind}-v${version}.zip`,buffer=zip([...files].sort().map(file=>({name:'twelve-seats/'+file,data:fs.readFileSync(path.join(root,file))})));
 fs.writeFileSync(path.join(dist,name),buffer);sums.push(crypto.createHash('sha256').update(buffer).digest('hex')+'  '+name);console.log(name+' '+buffer.length+' bytes');
}
fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),sums.join('\n')+'\n');
