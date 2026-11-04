import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
await build({entryPoints:['node_modules/motion/dist/es/mini.mjs'],bundle:true,minify:true,format:'iife',globalName:'PuliMotionEngine',target:['es2020'],outfile:'public/motion-vendor.js',legalComments:'eof',banner:{js:'/*! Motion 14.9.0 · MIT · see motion-LICENSE.txt */'}});
await copyFile('node_modules/motion/LICENSE.md','public/motion-LICENSE.txt');
console.log('Motion mini local browser bundle ready');
