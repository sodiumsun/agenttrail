#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Bind an observed session to a workflow chef. Read JSON from stdin.\nUsage: node bin/role.mjs [--state-dir /path]\nFields: provider, sessionId, cwd, roleId; optional workflowId, runId, itemId, orderId.\nUse roleId: null to clear the binding. This does not start or stop work.');process.exit(0);}
const stateDir=args[0]==='--state-dir'&&args[1]?path.resolve(args[1]):path.join(os.homedir(),'.agent-office');
try{
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>4000)throw new Error('Role metadata is too large.');}
  const input=JSON.parse(raw),registration=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));
  if(!Number.isInteger(registration.port)||registration.port<1024||registration.port>65535)throw new Error('No valid kitchen service is registered.');
  const event={id:crypto.randomUUID(),kind:'role',provider:input.provider,sessionId:input.sessionId,cwd:input.cwd,roleId:input.roleId,workflowId:input.workflowId,runId:input.runId,itemId:input.itemId,orderId:input.orderId};
  const response=await fetch(`http://127.0.0.1:${registration.port}/api/hook`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${registration.hookToken}`},body:JSON.stringify(event),signal:AbortSignal.timeout(3000)});
  const result=await response.json();if(!response.ok||!result.accepted)throw new Error(result.error||'Use a valid role and an already observed session in this project.');
  console.log(input.roleId===null?'Role binding cleared.':'Role binding recorded.');
}catch(error){console.error(error.message);process.exitCode=1;}
