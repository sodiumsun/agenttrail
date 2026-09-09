import {build} from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('public/build',{recursive:true});
await fs.mkdir('public/fonts',{recursive:true});
for(const weight of [400,600,700,800])await fs.copyFile(`node_modules/@fontsource/nunito/files/nunito-latin-${weight}-normal.woff2`,`public/fonts/nunito-${weight}.woff2`);
await build({entryPoints:['public/src/app.js'],bundle:true,format:'esm',target:'es2022',outfile:'public/build/app.js',minify:true,legalComments:'eof'});
console.log('Kitchen built.');
