import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const host = process.env.DSH_TEST_HOST;
const hostCheck = async (name, fn) => host ? check(name, fn) : console.log('SKIP', name, '(set DSH_TEST_HOST for installed-host checks)');
const hostURL = host ? pathToFileURL(host.endsWith('/') ? host : host + '/') : undefined;
const read = (p) => readFile(new URL(p, root), 'utf8');
const upstream = (p) => readFile(new URL('node_modules/@deepseek-ai/' + p, hostURL), 'utf8');
const evidence = [];
async function check(name, fn) { await fn(); evidence.push({ name, status: 'passed' }); console.log('PASS', name); }
const clean = (x) => JSON.parse(JSON.stringify(x));
let cursor = 0;
const cells = [];
const react = {
  useState(initial) { const key = cursor++; if (!(key in cells)) cells[key] = typeof initial === 'function' ? initial() : initial; return [cells[key], (v) => { cells[key] = typeof v === 'function' ? v(cells[key]) : v; }]; },
  useRef(initial) { const key = cursor++; return cells[key] ??= { current: initial }; },
  useMemo(fn) { return fn(); },
  useEffect() {},
};
const jsx = (type, props) => ({ type, props });
const seed = {
  '@deepseek-ai/dsh-client-store': { defineStore: (spec) => ({ spec, create() { return { actions: spec.actions }; } }) },
  '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, { get: (_, name) => name }),
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
};
const fetches = [];
const context = vm.createContext({ console, AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => { fetches.push({ url, options }); return { ok: true }; },
  window: { __ModuleLoader__: { load(record) { context.record = record; } } },
});
function loadClient(text, instrument = false) {
  if (instrument) {
    text = text.replace('exports.apply = apply;', 'exports.test = { mainSessionId, indexRunningChildren, projectSessionList, deriveGroups, deriveTopLevel, deriveSearchMatches, deriveSearchGroups, GroupsBrowser, moveBefore, moveAfter, createGroupsViewStore };\nexports.apply = apply;');
    text = text.replace('const now = Date.now();', 'globalThis.handlers = { setConfig, setManual, setGroupDialog, setGroupDraft, setGroupDeleteTarget, confirmGroupDialog, confirmGroupDelete, moveWorkspaceTo, moveCategory, onDropRow, manual };\nconst now = Date.now();');
  }
  vm.runInContext(text, context);
  return context.record.factory((id) => { if (!(id in seed)) throw new Error('unregistered module: ' + id); return seed[id]; });
}
const originalClient = await read('tests/fixtures/upstream/lib/client.js');
const clientText = await read('lib/client.js');
await check('Original boot failure reproduced at retired runtime require', () => {
  assert.throws(() => loadClient(originalClient), /unregistered module: @deepseek-ai\/dsh-client-runtime\/client/);
});
await hostCheck('Actual installed ClientModuleSystem reproduces original failure and materializes adapted factory', async () => {
  const modules = loadClient(await upstream('dsh-client-modules/lib/client.js'));
  const options = { manifest: { modules: [] }, staticModules: seed,
    bootstrapModule: { id: '@deepseek-ai/dsh-client-modules', exports: modules },
    registrationTarget: { mode: 'queue', pendingQueue: [] } };
  const oldLoader = new modules.ClientModuleSystem(options);
  vm.runInContext(originalClient, context); oldLoader.register(context.record);
  assert.throws(() => oldLoader.materialize('dsh-workspace-groups'), /dsh-client-runtime\/client.*missed the module table/);
  const newLoader = new modules.ClientModuleSystem({ ...options, registrationTarget: { mode: 'queue', pendingQueue: [] } });
  vm.runInContext(clientText, context); newLoader.register(context.record);
  assert.equal(typeof newLoader.materialize('dsh-session-sorts').exports.apply, 'function');
});
const exported = loadClient(clientText, true);
const api = exported.test;
await check('Adapted client factory loads using DSH 0.2 shell seed names', async () => {
  assert.equal(typeof exported.apply, 'function');
  assert.equal(context.record.id, 'dsh-session-sorts');
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.name, 'dsh-session-sorts');
  assert.equal(manifest.displayName, 'DSH session sorts');
  assert.equal(manifest.engines.dsh, '0.2.1-rc.2');
  assert.match(await read('cordis.patch.yml'), /id: workspace-groups/);
  assert.match(await read('cordis.patch.yml'), /name: 'dsh-session-sorts'/);
  assert(!clientText.includes('@deepseek-ai/dsh-client-runtime'));
});
await hostCheck('Actual installed shell seeds export every required store and UI symbol', async () => {
  const files = await readdir(new URL('node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/', hostURL));
  const shell = await readFile(new URL('node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/' + files.find((f) => /^index-.*\.js$/.test(f)), hostURL), 'utf8');
  for (const [moduleName, names] of [
    ['@deepseek-ai/dsh-client-store', ['defineStore']],
    ['@deepseek-ai/dsh-client-ui-primitives', [...clientText.matchAll(/_deepseek_ai_dsh_client_ui_primitives\.(\w+)/g)].map((m) => m[1])],
  ]) {
    const symbol = shell.match(new RegExp('"' + moduleName.replaceAll('/', '\\/') + '":(\\w+)'))?.[1];
    assert(symbol, 'shell seed missing ' + moduleName);
    const object = shell.match(new RegExp('\\b' + symbol + '=Object\\.freeze\\((?:Object\\.defineProperty\\()?\\{([\\s\\S]*?)\\}'))?.[1];
    assert(object, 'seed export map missing ' + symbol);
    if (process.env.DSH_TEST_DEBUG) console.log('SEED', symbol, object.slice(0, 12000));
    for (const name of new Set(names)) assert(new RegExp('(?:^|,)' + name + ':').test(object), 'missing seeded export ' + name);
  }
});
const calls = [];
let slot;
const recording = (name, value) => (...args) => { calls.push([name, ...args]); return value; };
const ctx = {
  effect: (fn) => fn(),
  locale: { register: recording('dictionary') },
  uiWorkspace: { startSession: recording('start'), openSession: recording('open'), pickDirectory: recording('pick', Promise.resolve('C:/fixture')), archiveSession: recording('archive', Promise.resolve()) },
  sessions: { searchResultLimit: 50, search: recording('search', Promise.resolve({ ok: true, value: { items: [], hasMore: false } })),
    using: async (id, options, fn) => { calls.push(['using', id, options]); return fn({ binding: { session: { rename: recording('renameSession', Promise.resolve({ ok: true })) } } }); },
    fork: recording('fork', Promise.resolve('child')) },
  workspaces: Object.fromEntries(['rename','delete','insertBefore','insertSessionBefore','create'].map((n) => [n, recording(n, Promise.resolve({ workspaceId: 'new' }))])),
  slots: { inject: (_name, fn) => fn(), register: (spec, component) => { slot = { spec, component }; } },
};
exported.apply(ctx);
const injected = slot.spec.inject();
await check('Service injection and sidebar registration use uiWorkspace and independent view key', () => {
  assert(exported.inject.includes('uiWorkspace'));
  assert(!exported.inject.includes('connection'));
  assert.equal(slot.spec.name, 'sidebar.workspaces');
  assert.equal(slot.spec.priority, -1);
  assert.equal(slot.spec.store.spec.persist, 'dsh.workspace.groups.view.v1');
  assert.equal(slot.spec.locale, 'workspaceGroups');
  assert.equal(slot.spec.registrant, 'dsh-session-sorts');
});
await check('New/open/pick/archive and retained-scope rename/fork bridge invokes current APIs', async () => {
  injected.startSession('w1'); injected.open('s1');
  assert.equal(await injected.pickDirectory(), 'C:/fixture');
  await injected.archiveSession('s1'); await injected.renameSession('s1', 'new title');
  injected.forkSession('s1'); await Promise.resolve();
  for (const n of ['start','open','pick','archive','using','renameSession','fork']) assert(calls.some((c) => c[0] === n), n);
  assert(calls.some((c) => c[0] === 'open' && c[1] === 'child'));
  assert.equal(calls.find((c) => c[0] === 'using')[2].source, 'workspaceOperation');
});
const sessions = {
 ids: ['s1','s2','child','blank'], phase: 'ready',
 byId: {
  s1: { id:'s1', displayTitle:'Alpha', cwd:'C:/code/one', updatedAt:10, retainedBy:{mainView:1} },
  s2: { id:'s2', displayTitle:'Beta', cwd:'C:/other', updatedAt:9, retainedBy:{} },
  child: { id:'child', origin:'subagent', running:true, retainedBy:{} },
  blank: { id:'blank', blank:true, displayTitle:'blank', retainedBy:{} },
 },
 projectionsBySession: { s1: { values: { subagentCatalog:[{id:'child'}] } } },
};
const statuses = new Map([['s1',{running:true, completionUnread:true, pendingInteraction:{kind:'question'}}]]);
const list = api.projectSessionList(sessions, statuses);
const workspaces = [
 { workspaceId:'w1', path:'C:/code/one', title:'One', createdAt:'2026-10-01', sessionIds:['s1','child','blank'] },
 { workspaceId:'w2', path:'C:/other', title:'Two', createdAt:'2026-10-02', sessionIds:['s2'] },
];
const config = {categories:[{name:'Code',rules:[{pathPrefix:'C:/code'}]}]};
const manual = {categories:[], assignments:{}, workspaceOrder:{}, categoryOrder:[], hidden:[], renamed:{}};
await check('Main-view selection, live status and projection child count adapt 0.2 snapshots', () => {
 assert.equal(list.current, 's1'); assert.equal(list.byId.s1.pendingInteraction,'question');
 assert.equal(list.byId.s1.completed,true); assert.equal(api.indexRunningChildren(list).get('s1').runningCount,1);
 const tree=api.deriveGroups(list,workspaces,[],config,{expandedCategories:['Code'],expandedWorkspaces:['w1']},manual);
 assert.equal(tree[0].workspaces[0].sessions.length,1);
 assert.equal(tree[0].workspaces[0].sessions[0].runningSubagentCount,1);
 assert.equal(tree[0].containsCurrent,true);
 assert.equal(api.deriveTopLevel(list,workspaces,[],config,{expandedWorkspaces:[]},manual)[0].workspaceId,'w2');
});
await check('Rule/manual override, archive filtering, ordering and three-level search retained', () => {
 const m={...manual,categories:['Manual'],assignments:{w1:'Manual'},categoryOrder:['Manual','Code']};
 const tree=api.deriveGroups(list,workspaces,[],config,{expandedCategories:[],expandedWorkspaces:[]},m);
 assert.equal(tree[0].key,'Manual');
 assert.deepEqual(clean(api.moveBefore(['a','b','c'],'c','a')),['c','a','b']);
 assert.deepEqual(clean(api.moveAfter(['a','b','c'],'a','b')),['b','a','c']);
 const hits=api.deriveSearchMatches(list,workspaces,config,'alpha',[],{items:[],hasMore:false},50);
 assert.deepEqual([...hits.matchedIds],['s1']);
 const search=api.deriveSearchGroups(list,workspaces,config,hits.matchedIds,[],manual,new Map());
 assert.equal(search.categories[0].workspaces[0].sessions[0].matched,true);
 assert.equal(api.deriveSearchMatches(list,workspaces,config,'alpha',['s1'],{items:[],hasMore:false},50).matchedIds.size,0);
});
const props={ ...injected, wide:true, expandSidebar() {},
 useSessions:(select)=>select(sessions),useSessionStatus:(select)=>select(statuses),
 useWorkspaces:(select)=>select({items:workspaces,phase:'ready',archivedSessionIds:[]}),
 useStore:(select)=>select({categoryExpansion:{},workspaceExpansion:{}}),
 actions:{setCategoryExpanded(){},setWorkspaceExpanded(){},retainKeys(){}},t:(key)=>key,
};
function render() { cursor=0; api.GroupsBrowser(props); return context.handlers; }
const flush=async()=>{await new Promise((resolve)=>setImmediate(resolve));};
render(); context.handlers.setConfig(config); context.handlers.setManual(manual);
await check('Original group create/rename/delete handlers preserve overlay-only semantics', async () => {
 let h=render(); h.setGroupDialog({mode:'create'});h.setGroupDraft('Team');h=render();h.confirmGroupDialog();await flush();
 h=render();assert.deepEqual(clean(h.manual.categories),['Team']);
 h.setGroupDialog({mode:'rename',from:'Team'});h.setGroupDraft('Team 2');h=render();h.confirmGroupDialog();await flush();
 h=render();assert.deepEqual(clean(h.manual.categories),['Team 2']);
 h.setGroupDeleteTarget('Team 2');h=render();h.confirmGroupDelete();await flush();
 h=render();assert.deepEqual(clean(h.manual.categories),[]);
 h.setGroupDialog({mode:'rename',from:'Code'});h.setGroupDraft('Dev');h=render();h.confirmGroupDialog();await flush();
 h=render();assert.equal(h.manual.renamed.Code,'Dev');
 h.setGroupDeleteTarget('Dev');h=render();h.confirmGroupDelete();await flush();
 h=render();assert.deepEqual(clean(h.manual.hidden),['Code']);assert.equal(h.manual.assignments.w1,null);
 for(const item of fetches) {assert.equal(item.url,'/workspace-groups/manual');assert.equal(item.options.method,'PUT');}
});
await check('Drag handlers retain grouping, project ordering, group ordering and move-out', async () => {
 let h=render();h.setManual({...manual,categories:['A','B']});h=render();
 await h.moveWorkspaceTo('w1','A');h=render();assert.equal(h.manual.assignments.w1,'A');
 await h.moveWorkspaceTo('w2','A','w1');h=render();assert.deepEqual(clean(h.manual.workspaceOrder.A),['w2','w1']);
 await h.moveCategory('B','A');h=render();assert.deepEqual(clean(h.manual.categoryOrder),['Code','B','A']);
 const event={preventDefault(){},stopPropagation(){},clientY:1,currentTarget:{getBoundingClientRect:()=>({top:0,height:20})},dataTransfer:{getData:(type)=>type==='application/x-dsh-workspace-groups'?'w1':''}};
 h.onDropRow('未分类',{kind:'topLevel',key:'未分类'})(event);await flush();h=render();
 assert.equal(h.manual.assignments.w1,null);assert.deepEqual(clean(h.manual.workspaceOrder.__topLevel__),['w1']);
});
// Test-only dependency mapping: production still uses the normal declared js-yaml dependency.
if (host) {
 const yamlURL = new URL('node_modules/js-yaml/dist/js-yaml.mjs',hostURL).href;
 registerHooks({resolve(specifier,ctx,next){return next(specifier==='js-yaml'?yamlURL:specifier,ctx);}});
}
const fixture=new URL('../out/fixture/',import.meta.url);
await mkdir(fixture,{recursive:true});
const yaml='categories:\n  - name: Code\n    rules:\n      - pathPrefix: "C:/code"\n';
await writeFile(new URL('workspace-groups.yaml',fixture),yaml);
process.env.DSH_HOME = fileURLToPath(fixture);
const hostPlugin = await import(new URL('../lib/index.js',import.meta.url));
const routes=new Map();hostPlugin.apply({effect:(fn)=>fn(),webServer:{register:(route)=>{routes.set(route.path,route.handler);return()=>{};}}});
async function request(path,method,body) {
 const req=Readable.from(body===undefined?[]:[body]);req.method=method;
 const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
 await routes.get(path)(req,res);return res;
}
await check('Host routes load actual YAML dependency and atomically round-trip isolated overlay',async()=>{
 let res=await request('/workspace-groups/config','GET');assert.equal(res.status,200);assert.equal(JSON.parse(res.body).categories[0].name,'Code');
 const overlay={categories:['Team'],assignments:{w1:'Team'},workspaceOrder:{Team:['w1']},categoryOrder:['Team']};
 res=await request('/workspace-groups/manual','PUT',JSON.stringify(overlay));assert.equal(res.status,200);
 assert.deepEqual(JSON.parse(await readFile(new URL('workspace-groups.manual.json',fixture),'utf8')),overlay);
 res=await request('/workspace-groups/config','GET');assert.deepEqual(JSON.parse(res.body).manual,overlay);
 assert.equal(await readFile(new URL('workspace-groups.yaml',fixture),'utf8'),yaml);
 assert.deepEqual((await readdir(fixture)).sort(),['workspace-groups.manual.json','workspace-groups.yaml']);
});
await check('Host boundary rejects malformed JSON, unknown category and oversized requests',async()=>{
 assert.equal((await request('/workspace-groups/manual','PUT','{')).status,400);
 assert.equal((await request('/workspace-groups/manual','PUT',JSON.stringify({assignments:{w1:'Missing'}}))).status,400);
 assert.equal((await request('/workspace-groups/manual','PUT','x'.repeat(65537))).status,413);
 assert.equal((await request('/workspace-groups/config','POST')).status,405);
 const head=await request('/workspace-groups/config','HEAD');assert.equal(head.status,200);assert.equal(head.body,undefined);
});
await hostCheck('Current host compatibility preflight accepts unchanged profile-free candidate manifest',async()=>{
 const pkg=JSON.parse(await read('package.json'));
 const appBoot=await import(new URL('node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',hostURL));
 assert.equal(appBoot.evaluatePluginCompatibility(pkg,{},'0.2.1-rc.2'),undefined);
});
const hashes={};for(const p of ['tests/fixtures/upstream/lib/client.js','tests/fixtures/upstream/lib/index.js','lib/client.js','lib/index.js']) hashes[p]=createHash('sha256').update(await read(p)).digest('hex');
await writeFile(new URL('out/test-results.json',root),JSON.stringify({timestamp:new Date().toISOString(),node:process.version,host:host ? 'installed DSH 0.2.1-rc.2 (path omitted)' : null,tests:evidence,hashes,limitations:['No real browser DOM or interaction/render validation','No profile changes, plugin enable, reload, restart or real user data access','UI handler tests use deterministic React hook fixtures; host routes use Node streams and fixture sidecars']},null,2)+'\n');
console.log(`Completed ${evidence.length} checks. Evidence: out/test-results.json`);
