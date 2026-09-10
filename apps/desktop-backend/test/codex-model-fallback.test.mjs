import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CodexModelSelector, CodexTurnRunner, isCodexModelUnavailable } from '../src/core/agent/codex-model-fallback.ts'
const quota = { message: "You've hit your usage limit. Upgrade to Pro", codexErrorInfo: 'usageLimitExceeded' }
const models = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna'].map((model, i) => ({ model, isDefault: i === 0, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }))
function catalog(model = null) { return async method => method === 'config/read' ? { config: { model, model_reasoning_effort: 'ultra' } } : { data: models } }
const tick = () => new Promise(resolve => setImmediate(resolve))
function runner(rpc, choices = models) {
 const notices = []; const errors = []; const started = []
 const selector = new CodexModelSelector()
 const run = new CodexTurnRunner(rpc, selector, choices, { threadId: 'same-thread', cwd: '/tmp', input: [{ type: 'text', text: 'deploy once' }] }, {
   switched: model => notices.push(model), failed: error => errors.push(error), started: (id, model) => started.push({id, model})
 })
 return { run, notices, errors, selector, started }
}
test('follows current Codex config each time, default catalog otherwise; normalizes effort', async () => {
 const selector = new CodexModelSelector()
 assert.equal((await selector.choices(catalog(), '/tmp'))[0].model, 'gpt-6-astra')
 const choices = await selector.choices(catalog('gpt-5.6-luna'), '/tmp')
 assert.deepEqual(choices[0], {model:'gpt-5.6-luna', effort:'medium'})
})
test('quota rejection falls back to 5.6 on same thread and caches the unavailable model', async () => {
 const calls = []
 const {run,selector} = runner(async (method, params) => { calls.push(params); if (params.model === 'gpt-6-astra') throw quota; return { turn: { id: 'second' } } })
 await run.start()
 assert.deepEqual(calls.map(x=>x.model), ['gpt-6-astra','gpt-5.6-sol'])
 assert.ok(calls.every(x=>x.threadId === 'same-thread'))
 assert.equal((await selector.choices(catalog(), '/tmp'))[0].model, 'gpt-5.6-sol')
})
test('streaming quota waits for completion, resumes without replaying deployment; ignores duplicate terminal events', async () => {
 const calls=[]
 const {run,notices} = runner(async (method,params)=>{calls.push(params);return {turn:{id:`turn-${calls.length}`}}})
 await run.start()
 assert.equal(run.handle('error',{turnId:'turn-1',willRetry:false,error:quota}),true)
 assert.equal(calls.length,1)
 const completion={turn:{id:'turn-1',status:'failed',error:quota}}
 assert.equal(run.handle('turn/completed',completion),true)
 run.handle('turn/completed',completion)
 await tick()
 assert.equal(calls.length,2)
 assert.equal(calls[1].threadId,'same-thread')
 assert.match(calls[1].input[0].text,/不要重复部署/)
 assert.notEqual(calls[1].input[0].text,'deploy once')
 assert.deepEqual(notices,['gpt-5.6-sol'])
})
test('all models exhausted terminates without retry loops; auth/network failures do not downgrade', async () => {
 let calls=0
 const {run}=runner(async()=>{calls++;throw quota})
 await assert.rejects(run.start())
 assert.equal(calls,3)
 for (const message of ['unauthorized','fetch failed','Kubernetes resource quota exceeded']) {
   assert.equal(isCodexModelUnavailable(new Error(message)), false)
 }
 const normal=runner(async()=>{throw new Error('unauthorized')})
 await assert.rejects(normal.run.start(),/unauthorized/)
 assert.deepEqual(normal.notices,[])
})
test('cancel during fallback prevents any further attempt and interrupts late start response', async () => {
 let resolve; const calls=[]
 const {run}=runner(async(method,params)=>{calls.push({method,params});if(method==='turn/interrupt')return {};return new Promise(r=>resolve=r)})
 const pending=run.start();await tick();await run.cancel();resolve({turn:{id:'late'}});await pending
 assert.deepEqual(calls.map(x=>x.method),['turn/start','turn/interrupt'])
})
test('failed model becomes eligible after cooldown',async()=>{
 let now=0;const selector=new CodexModelSelector(()=>now);selector.block('gpt-6-astra')
 assert.equal((await selector.choices(catalog(),'/tmp'))[0].model,'gpt-5.6-sol')
 now=300001
 assert.equal((await selector.choices(catalog(),'/tmp'))[0].model,'gpt-6-astra')
})
test('configured GPT-6 absent from live catalog uses Codex default GPT-5.6 before starting', async () => {
 const selector = new CodexModelSelector()
 const rpc=async method=>method==='config/read'?{config:{model:'gpt-6-astra'}}:{data:models.slice(1).map((m,i)=>({...m,isDefault:i===0}))}
 assert.equal((await selector.choices(rpc,'/tmp'))[0].model,'gpt-5.6-sol')
 assert.equal(isCodexModelUnavailable({codexErrorInfo:{httpConnectionFailed:{httpStatusCode:429}}}),true)
})
