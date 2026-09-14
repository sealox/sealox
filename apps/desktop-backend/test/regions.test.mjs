import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('region switching preserves context on failure and scopes kubeconfig with private permissions', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sealos-regions-'))
  try {
    const bundle = join(folder, 'auth.cjs')
    await build({ entryPoints: [new URL('../src/core/sealos/auth.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: bundle })
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const a = require(${JSON.stringify(bundle)});
      const kc = (host, ns) => 'server: https://' + host + '\\nnamespace: ' + ns + '\\ntoken: test\\n';
      (async () => {
        assert.equal(a.KNOWN_REGIONS.length, 5);
        await a.saveCredentials('https://usw-1.sealos.io', 'test', 'test', kc('usw-1.sealos.io', 'ns-one'), null);
        const first = a.getStatus().kubeconfigPath;
        assert.equal(first, path.join(process.env.HOME, '.sealos/usw-1.sealos.io/ns-one/kubeconfig'));
        assert.equal(fs.statSync(first).mode & 0o777, 0o600);
        global.fetch = async () => new Response(JSON.stringify({code:401}), {status:200});
        assert.equal(await a.switchRegion('https://bja.sealos.run'), null);
        assert.equal(a.getStatus().kubeconfigPath, first);
        global.fetch = async (url) => new Response(JSON.stringify(url.endsWith('globalToken') ? {code:200,data:{token:'global'}} : url.endsWith('regionToken') ? {code:200,data:{token:'regional',kubeconfig:kc('bja.sealos.run','ns-two')}} : {code:200,data:{namespaces:[{id:'ns-two',uid:'two',teamName:'Two'}]}}));
        const switched = await a.switchRegion('https://bja.sealos.run');
        assert.equal(switched.namespace, 'ns-two');
        assert.equal(switched.workspaceName, 'Two');
        assert.equal(fs.readFileSync(first,'utf8'),kc('usw-1.sealos.io','ns-one'));
        assert.throws(() => a.scopedKubeconfigPath(kc('bja.sealos.run','../escape')));
        await a.logout();
        assert.equal(a.getStatus().authenticated,false);
        // Legacy credentials migrate on first read.
        fs.writeFileSync(path.join(process.env.HOME,'.sealos/kubeconfig'),kc('usw-1.sealos.io','ns-old'));
        assert.equal(a.getStatus().namespace,'ns-old');
        assert.ok(a.getStatus().kubeconfigPath.endsWith('/usw-1.sealos.io/ns-old/kubeconfig'));
      })().catch(e => { console.error(e); process.exit(1); });
    `], { env: { ...process.env, HOME: folder, SEALOS_KUBECONFIG: join(folder,'.sealos/kubeconfig') }, stdio: 'pipe' })
    assert.ok(true)
  } finally { await rm(folder, { recursive: true, force: true }) }
})
