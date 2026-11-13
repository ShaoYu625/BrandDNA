import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=path.join(root,'.wrangler','foodtruck-pages');
fs.mkdirSync(stage,{recursive:true});
fs.cpSync(path.join(root,'pages','public'),path.join(stage,'public'),{recursive:true});
fs.cpSync(path.join(root,'pages','functions'),path.join(stage,'functions'),{recursive:true});
fs.copyFileSync(path.join(root,'pages','wrangler.foodtruck.toml'),path.join(stage,'wrangler.toml'));
console.log(`Prepared Cloudflare Pages package: ${path.relative(root,stage)}`);
