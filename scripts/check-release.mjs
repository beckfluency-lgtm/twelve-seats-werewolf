import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {PROVIDERS,DEFAULT_ADAPTERS} from '../core.js';
import {root,runtimeFiles,sourceFiles} from './release-files.mjs';
export function checkRelease(base=root){
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8'));
 if(manifest.version!==pkg.version)throw Error('Package and extension versions differ');
 if(manifest.manifest_version!==3)throw Error('Expected Manifest V3');
 if(JSON.stringify([...manifest.permissions].sort())!==JSON.stringify(['scripting','storage','tabs']))throw Error('Unexpected permissions');
 for(const [id,p] of Object.entries(PROVIDERS)){
   if(!manifest.host_permissions.includes(new URL(p.home).origin+'/*'))throw Error('Missing host permission: '+id);
   const adapter=DEFAULT_ADAPTERS[id];if(!adapter?.input||!adapter.send||!adapter.reply||adapter.nativeSend)throw Error('Missing background preset: '+id);
 }
 for(const host of manifest.host_permissions)if(!/^https:\/\/[a-z0-9.-]+\/\*$/.test(host))throw Error('Overbroad host permission');
 const files=sourceFiles(base);
 const privatePatterns=[/[A-Za-z]:\\(?:Users|Tools|CodexData)\\/i,/chrome-extension:\/\/[a-p]{32}/,/\b(?:sk-[A-Za-z0-9]{24,}|gh[pousr]_[A-Za-z0-9]{24,})\b/,/https:\/\/(?:chat\.deepseek\.com\/a\/chat\/s|claude\.ai\/chat|chatgpt\.com\/c|zchat\.z\.ai\/c)\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i];
 for(const file of files){
   const text=fs.readFileSync(path.join(base,file),'utf8');
   if(privatePatterns.some(pattern=>pattern.test(text)))throw Error('Possible personal data in '+file);
 }
 for(const file of runtimeFiles){
   const text=fs.readFileSync(path.join(base,file),'utf8');
   for(const match of text.matchAll(/(?:from\s+|(?:src|href)=)["'](\.\/[^"']+|[^:"']+\.(?:js|css))["']/g)){
     const relative=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));if(!runtimeFiles.includes(relative))throw Error('Runtime dependency not shipped: '+relative);
   }
   if(/\bfetch\s*\(|XMLHttpRequest|connectNative|sendNativeMessage/.test(text))throw Error('Unexpected direct network/native dependency in '+file);
 }
 return {version:pkg.version,sourceFiles:files.length,platforms:Object.keys(PROVIDERS).length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(checkRelease()));
