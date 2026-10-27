const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hello, lockLine, Service, preferredPort, servicePort } = require('../service.cjs');
test('decodes the real hello wire shape and rejects alien greetings', () => {
  assert.deepEqual(hello(Buffer.from('a1696261636b706c616e6565312e322e33', 'hex')), { backplane: '1.2.3' });
  assert.throws(() => hello(Buffer.from('a0', 'hex')));
  assert.throws(() => hello(Buffer.from('ff', 'hex')));
});
test('owned-service port allocation preserves origin across sequential app restarts', async t => {
  const net=require('node:net'),crypto=require('node:crypto');const home='/tmp/bp-owned-origin-'+crypto.randomUUID();
  const candidate=preferredPort(home),probe=net.createServer();
  try { await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(candidate,'127.0.0.1',resolve);}); }
  catch(error){if(error.code==='EADDRINUSE'){t.skip('Preferred synthetic port already occupied');return;}throw error;}
  await new Promise(resolve=>probe.close(resolve));
  const first=await servicePort(home),second=await servicePort(home+'/child/..');assert.equal(first,candidate);assert.equal(second,first);
});
test('an occupied preferred port falls back without attaching to or signalling its owner', async()=>{
  const net=require('node:net'),crypto=require('node:crypto');const home='/tmp/bp-owned-collision-'+crypto.randomUUID(),server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(preferredPort(home),'127.0.0.1',resolve);});
  try { const chosen=await servicePort(home);assert.notEqual(chosen,server.address().port);assert(server.listening); }
  finally { await new Promise(resolve=>server.close(resolve)); }
});
test('discovery accepts only the existing explicit flock contract', () => {
  assert.deepEqual(lockLine('123 3787 flock\n'), { posixPid: 123, port: 3787 });
  for (const line of ['0 3787 flock', '123 65536 flock', '123 3787', '123 3787 flock\nextra']) assert.throws(() => lockLine(line));
});
test('does not signal a service it merely discovered', () => {
  const manager = new Service({ home: '/tmp/test-backplane-electron' });
  manager.connection = { pid: process.pid }; manager.stop();
  assert.equal(manager.child, null);
});
test('authenticates the endpoint without treating POSIX lock IDs as native PIDs', async () => {
  const http = require('node:http');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'bp-lock-identity-'));
  const token = 'a'.repeat(32);
  const server = http.createServer((req,res) => {
    if(req.url === '/hello') { res.end(Buffer.from('a1696261636b706c616e6565312e322e33','hex')); return; }
    res.statusCode=req.headers.authorization === `Bearer ${token}` ? 200 : 401; res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try {
    await fs.writeFile(path.join(home,'token'),token);
    await fs.writeFile(path.join(home,'hub.lock'),`2147483647 ${port} flock\n`);
    const service=new Service({home,expectedVersion:'1.2.3'});
    const connection=await service.discover();
    assert.deepEqual(connection.lockIdentity,{posixPid:2147483647});
    assert.equal(service.child,null);
    await fs.writeFile(path.join(home,'token'),'b'.repeat(32));
    await assert.rejects(()=>service.discover(),/does not authenticate/);
  } finally { await new Promise(resolve=>server.close(resolve)); await fs.rm(home,{recursive:true,force:true}); }
});
test('a hub elsewhere (host): its home is never made from here, and its own /proc says a refused hub is restoring history', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bp-host-')), home = path.join(root, 'home'), proc = path.join(root, 'proc');
  try {
    const service = new Service({ home, host: { procRoot: proc, plan: async () => { throw Object.assign(new Error('Backplane is not installed in Fake.'), { code: 'ERR_HUB_NOT_INSTALLED' }); } } });
    await assert.rejects(service.start(), e => e.code === 'ERR_HUB_NOT_INSTALLED');
    await assert.rejects(fs.access(home), 'the home was not made from outside');
    const closed = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
    await fs.mkdir(home); await fs.mkdir(path.join(proc, '4242'), { recursive: true });
    await fs.writeFile(path.join(home, 'hub.lock'), `4242 ${closed} flock\n`);
    await assert.rejects(service.discover(), e => e.code === 'ERR_SERVICE_BUSY');
    await fs.rm(path.join(proc, '4242'), { recursive: true });
    assert.equal(await service.discover(), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('a hub elsewhere starts from its host\'s plan and is found like any other, at any version', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bp-host-')), home = path.join(root, 'home');
  const hub = `const [home, port] = process.argv.slice(1), fs = require('fs'), token = 'c'.repeat(32); fs.writeFileSync(home + '/token', token);
require('http').createServer((q, s) => { if (q.url === '/hello') return s.end(Buffer.from('a1696261636b706c616e6565392e392e39', 'hex')); s.statusCode = q.headers.authorization === 'Bearer ' + token ? 200 : 401; s.end(); })
  .listen(+port, '127.0.0.1', () => fs.writeFileSync(home + '/hub.lock', process.pid + ' ' + port + ' flock\\n'));`;
  const plans = [];
  const service = new Service({ home, host: { procRoot: path.join(root, 'proc'), plan: async port => { plans.push(port); return { file: process.execPath, args: ['-e', hub, home, String(port)], env: process.env }; } } });
  try {
    await fs.mkdir(home);
    const found = await service.start();
    assert.equal(found.version, '9.9.9'); assert.equal(found.origin, `http://127.0.0.1:${plans[0]}`); assert.equal(plans.length, 1);
    assert.equal(service.child.spawnfile, process.execPath);
  } finally { service.stop(); await fs.rm(root, { recursive: true, force: true }); }
});
