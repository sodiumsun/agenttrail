import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

const run=promisify(execFile);
const archive=process.argv[2]&&path.resolve(process.argv[2]);
if(!archive)throw new Error('Provide the .tgz produced by npm pack.');
const fixture=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'agenttrail-kitchen-package-')));
let service;
try{
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  await run(npm,['install','--prefix',fixture,'--omit=dev','--ignore-scripts','--offline','--no-audit','--no-fund',archive],{timeout:60000});
  const installed=path.join(fixture,'node_modules/agenttrail-kitchen');
  const pkg=JSON.parse(await fs.readFile(path.join(installed,'package.json'),'utf8'));
  assert.equal(pkg.license,'MIT');
  assert.equal(pkg.private,undefined);
  assert.deepEqual(Object.keys(pkg.dependencies||{}),[]);
  for(const excluded of ['test','scripts','concepts','recordings','.office','.runs','public/src']){
    await assert.rejects(fs.access(path.join(installed,excluded)),{code:'ENOENT'});
  }
  await assert.rejects(fs.access(path.join(fixture,'node_modules/three')),{code:'ENOENT'});
  const cli=path.join(installed,pkg.bin['agenttrail-kitchen']);
  assert.match((await run(process.execPath,[cli,'--help'])).stdout,/agenttrail-kitchen/);
  const first=path.join(fixture,'first repo'),second=path.join(fixture,"repo with spaces ' and $(literal)");
  const stateDir=path.join(fixture,'state'),observerHome=path.join(fixture,'empty-observer-home');
  await Promise.all([first,second,observerHome].map(p=>fs.mkdir(p)));
  const {startOffice}=await import(pathToFileURL(path.join(installed,'src/server.mjs')));
  service=await startOffice({roots:[first],home:observerHome,stateDir,port:0,observe:false});
  for(const [asset,mime] of [['/','text/html'],['/build/app.js','text/javascript'],['/kitchen.css','text/css'],['/fonts/nunito-800.woff2','font/woff2'],['/favicon.svg','image/svg+xml']]){
    const response=await fetch(service.url+asset);
    assert.equal(response.status,200,asset);
    assert.equal(response.headers.get('content-type')?.split(';')[0],mime);
    assert.ok((await response.arrayBuffer()).byteLength>20,asset);
  }
  const initial=await fetch(service.url+'/api/state').then(r=>r.json());
  assert.equal(initial.app,'agenttrail-kitchen');
  assert.deepEqual(initial.executors,[]);
  const {stdout}=await run(process.execPath,[cli,second,'--state-dir',stateDir,'--no-open'],{timeout:15000});
  const live=new URL(stdout.split('\n')[0].replace('Kitchen updated: ',''));
  assert.equal(live.searchParams.get('project'),second);
  assert.equal(live.searchParams.get('mode'),'live');
  const example=await run(process.execPath,[cli,second,'--example','--state-dir',stateDir,'--no-open'],{timeout:15000});
  const demo=new URL(example.stdout.split('\n')[0].replace('Kitchen updated: ',''));
  assert.equal(demo.searchParams.get('mode'),'demo');
  assert.equal(demo.searchParams.has('project'),false);
  assert.deepEqual(await fs.readdir(first),[]);
  assert.deepEqual(await fs.readdir(second),[]);
  console.log('Packed kitchen verified: offline install, no dev dependencies, local assets, live attachment and labeled example launch.');
}finally{
  await service?.close();
  await fs.rm(fixture,{recursive:true,force:true});
}
