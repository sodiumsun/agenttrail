#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Explicit artifact metadata only. This command never reads the artifact body.
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Read explicit artifact metadata as JSON from stdin.\nUsage: node bin/plate.mjs [--state-dir /path/to/state]\nSee docs/HANDOFFS.md for the produced/offered/received contract.');process.exit(0);}
const stateDir=args[0]==='--state-dir'&&args[1]?path.resolve(args[1]):path.join(os.homedir(),'.agent-office');
try{
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>32_000)throw new Error('Metadata is too large.');}
  const event=JSON.parse(raw),registration=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));
  if(!Number.isInteger(registration.port)||registration.port<1024||registration.port>65535)throw new Error('No valid kitchen service is registered.');
  const response=await fetch(`http://127.0.0.1:${registration.port}/api/artifact`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${registration.hookToken}`},body:JSON.stringify(event),signal:AbortSignal.timeout(3000)});
  const result=await response.json();if(!response.ok||!result.accepted)throw new Error(result.error||'Event was duplicate, stale, or missing valid artifact metadata.');
  console.log('Plate event accepted.');
}catch(error){console.error(error.message);process.exitCode=1;}
