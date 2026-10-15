import fs from 'node:fs';
import path from 'node:path';
export const root=path.resolve(import.meta.dirname,'..');
export const runtimeFiles=['manifest.json','background.js','core.js','rules.js','review.js','adapters.js','dashboard.html','dashboard.js','style.css','transport.js','render-assist.js','scheduler.js','options.html','options.js'];
export const documentFiles=['README.md','LICENSE','CHANGELOG.md','docs/QUICKSTART.md','docs/PLATFORMS.md','docs/PRIVACY.md'];
export const extensionFiles=[...runtimeFiles,...documentFiles];
export function sourceFiles(base=root){
 const listed=['package.json','.gitignore','CONTRIBUTING.md','SECURITY.md',...extensionFiles];
 for(const folder of ['tests','scripts','.github']){
   const visit=relative=>{for(const item of fs.readdirSync(path.join(base,relative),{withFileTypes:true})){const name=relative+'/'+item.name;if(item.isDirectory())visit(name);else if(/\.(?:test\.js|mjs|ya?ml)$/.test(item.name))listed.push(name);}};visit(folder);
 }
 return [...new Set(listed)].sort();
}
