#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeHook } from '../src/connectors/events.mjs';

const deadline=setTimeout(()=>process.exit(0),650);
try{
  const [provider,stateDir]=process.argv.slice(2);let input='';
  for await(const chunk of process.stdin){input+=chunk;if(input.length>2*1024*1024)process.exit(0);}
  const raw=JSON.parse(input);raw.office_event_id=crypto.randomUUID();
  const event=normalizeHook(provider,raw);if(!event)process.exit(0);
  // Raw tool arguments, prompts, emails and responses never leave this process.
  const registration=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));
  if(!Number.isInteger(registration.port)||registration.port<1024||registration.port>65535)process.exit(0);
  await fetch(`http://127.0.0.1:${registration.port}/api/hook`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${registration.hookToken}`},body:JSON.stringify(event),signal:AbortSignal.timeout(400)});
}catch{}finally{clearTimeout(deadline);process.exit(0);}
