// Static hosting needs no build server. Regenerate after changing a shell asset.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const files=['index.html','app.js','updates.js','manifest.webmanifest','icon.svg'];
const revision=createHash('sha256');
for(const file of files)revision.update(file).update(readFileSync(new URL('../'+file,import.meta.url)));
const path=new URL('../sw.js',import.meta.url);
const worker=readFileSync(path,'utf8');
revision.update(worker.replace(/const CACHE='subscription-tracker-[^']+';/,"const CACHE='subscription-tracker-REVISION';"));
const updated=worker.replace(/const CACHE='subscription-tracker-[^']+';/,`const CACHE='subscription-tracker-${revision.digest('hex').slice(0,16)}';`);
if(process.argv.includes('--check')){
  if(updated!==worker){console.error('Run npm run prepare:update to refresh the service worker revision.');process.exitCode=1}
}else writeFileSync(path,updated);
