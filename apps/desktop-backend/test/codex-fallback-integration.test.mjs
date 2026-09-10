import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

test('runtime keeps the assistant pending across quota error and continues same Codex thread', async () => {
 const dir=await mkdtemp(join(tmpdir(),'sealos-fallback-test-'))
 try {
 const outfile=join(dir,'runtime.cjs')
 await build({entryPoints:[new URL('../src/core/agent/runtime.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile,logLevel:'silent',plugins:[{name:'test-protocol',setup(b){
   b.onLoad({filter:/agent\/runtime\.ts$/},async a=>({contents:(await readFile(a.path,'utf8'))+'\nexport {runCodexExecutor as testRun, handleCodexMessage as testMessage};',loader:'ts'}))
   b.onLoad({filter:/agent\/codex-app-server\.ts$/},()=>({contents:`export const requests=[];
     export async function requestCodex(command, method, params) {
       requests.push({method,params});
       if(method==='config/read')return {config:{model:'gpt-6-astra'}};
       if(method==='model/list')return {data:[{model:'gpt-6-astra',isDefault:true},{model:'gpt-5.6-sol'}]};
       if(method==='thread/start')return {thread:{id:'original-thread'}};
       if(method==='turn/start')return {turn:{id:'turn-'+requests.filter(x=>x.method==='turn/start').length}};
       return {};
     }
     export const subscribeCodexThread=()=>()=>{};
     export const rejectCodexRequest=()=>{};export const respondCodexRequest=()=>{};export const stopCodexAppServer=async()=>{};`,loader:'ts'}))
   b.onLoad({filter:/core\/desktop-host\.ts$/},()=>({contents:`export const desktopHost=()=>({appRoot:'/tmp/sealos/apps/desktop',emit:()=>{}});`,loader:'ts'}))
 }}]})
 const {testRun,testMessage}=createRequire(import.meta.url)(outfile)
 let settled=false
 const session={conversationId:'ui-chat',workspaceId:'test',turnBusy:true,turnWaiter:{resolve:()=>{settled=true},reject:e=>{throw e}},codexMessages:new Map(),codexThinking:new Map(),codexRequests:new Map(),activities:new Map(),record:{messages:[{role:'user',text:'deploy once'},{role:'assistant',text:'',pending:true}]}}
 await testRun(session,{command:'codex'},'deploy once')
 assert.equal(session.localTurnId,'turn-1')
 const quota={message:"You've hit your usage limit",codexErrorInfo:'usageLimitExceeded'}
 testMessage(session,{method:'error',params:{threadId:'original-thread',turnId:'turn-1',error:quota,willRetry:false}})
 assert.equal(settled,false)
 assert.equal(session.record.messages.at(-1).pending,true)
 testMessage(session,{method:'turn/completed',params:{threadId:'original-thread',turn:{id:'turn-1',status:'failed',error:quota}}})
 await new Promise(r=>setImmediate(r))
 assert.equal(session.localTurnId,'turn-2')
 assert.equal(session.record.executorThreads.codex,'original-thread')
 assert.equal(session.codexRunner.model,'gpt-5.6-sol')
 assert.equal(session.record.messages.at(-1).error,undefined)
 assert.equal(settled,false)
 testMessage(session,{method:'turn/completed',params:{turn:{id:'turn-2',status:'completed'}}})
 assert.equal(settled,true)
 assert.equal(session.record.messages.at(-1).pending,false)
 } finally {await rm(dir,{recursive:true,force:true})}
})
