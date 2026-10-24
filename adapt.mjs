import { readFile, writeFile, rm } from 'node:fs/promises';
const root = new URL('./', import.meta.url);
const get = (p) => readFile(new URL(p, root), 'utf8');
const put = (p, text) => writeFile(new URL(p, root), text);
function replace(text, from, to) {
  if (!text.includes(from)) throw new Error(`Patch anchor missing: ${from.slice(0, 90)}`);
  return text.replace(from, to);
}
let client = await get('tests/fixtures/upstream/lib/client.js');
client = replace(client, 'let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");', 'let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");');
client = client.replaceAll('_deepseek_ai_dsh_client_runtime_client.defineStore', '_deepseek_ai_dsh_client_store.defineStore');
// 0.2 icons are weight-named instead of size-named; retain the original pixel sizes.
for (const [, oldName, family, size] of [...client.matchAll(/_deepseek_ai_dsh_client_ui_primitives\.(Icon(\w+?)(\d+))/g)]) {
  const newName = 'Icon' + family + 'Regular';
  client = client.replaceAll(`_deepseek_ai_dsh_client_ui_primitives.${oldName}, {}`, `_deepseek_ai_dsh_client_ui_primitives.${newName}, { size: ${size} }`);
  client = client.replaceAll(`_deepseek_ai_dsh_client_ui_primitives.${oldName}`, `_deepseek_ai_dsh_client_ui_primitives.${newName}`);
}
client = client.replaceAll('(0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId)', 'indexRunningChildren(list)');
// This computation discarded its result; eliminate the redundant full catalog pass.
client = replace(client, '\n\t\t\tindexRunningChildren(list);', '');
const helpers = `
		// DSH 0.2: selection belongs to UiWorkspace and child counts to projections.
		function mainSessionId(list) {
			return Object.values(list.byId).find((session) => (session.retainedBy?.mainView ?? 0) > 0)?.id;
		}
		function indexRunningChildren(list) {
			return new Map(Object.entries(list.projectionsBySession ?? {}).map(([id, projection]) => [id, {
				runningCount: projection.values?.subagentCatalog?.reduce((count, child) => count + (list.byId[child.id]?.running === true ? 1 : 0), 0) ?? 0
			}]));
		}
		function projectSessionList(list, statuses) {
			const byId = Object.fromEntries(Object.entries(list.byId).map(([id, summary]) => {
				const status = statuses.get(id);
				const kind = status?.pendingInteraction?.kind;
				return [id, { ...summary,
					running: status?.running ?? summary.running,
					completed: status?.completionUnread === true,
					pendingInteraction: ["approval", "plan-review", "question"].includes(kind) ? kind : undefined
				}];
			}));
			return { ...list, byId, current: mainSessionId(list) };
		}
`;
client = replace(client, '\t\t//#region src/client/store-core.ts', helpers + '\t\t//#region src/client/store-core.ts');
client = replace(client, 'function GroupsBrowser({ wide, expandSidebar, useSessions, useWorkspaces,', 'function GroupsBrowser({ wide, expandSidebar, useSessions, useSessionStatus, useWorkspaces,');
client = replace(client, 'const list = useSessions((s) => s);', 'const rawList = useSessions((s) => s);\n\t\t\tconst statuses = useSessionStatus((s) => s);\n\t\t\tconst list = (0, react.useMemo)(() => projectSessionList(rawList, statuses), [rawList, statuses]);');
client = replace(client, '\t\t\t"connection"\n', '\t\t\t"uiWorkspace"\n');
client = replace(client, 'ctx.workspaces.startSession(workspaceId);', 'ctx.uiWorkspace.startSession(workspaceId);');
client = client.replaceAll('ctx.sessions.open(', 'ctx.uiWorkspace.openSession(');
client = replace(client, 'const session = ctx.sessions.binding(sessionId)?.session;\n\t\t\t\t\tif (session === void 0) throw new Error(`unknown session "${sessionId}"`);\n\t\t\t\t\tconst result = await session.rename(title);', 'const result = await ctx.sessions.using(sessionId, { source: "workspaceOperation" }, (reference) => reference.binding.session.rename(title));');
client = replace(client, 'await ctx.workspaces.archiveSession(sessionId);', 'await ctx.uiWorkspace.archiveSession(sessionId);');
client = replace(client, 'pickDirectory: () => ctx.workspaces.pickDirectory(),\n\t\t\t\thooks: { hostDescription: ctx.get("connection").hostDescription }', 'pickDirectory: () => ctx.uiWorkspace.pickDirectory()');
client = client.replace(/\n\/\/# sourceMappingURL=client\.js\.map\s*$/, '\n');
client = client.replace('id: "dsh-workspace-groups"', 'id: "dsh-session-sorts"')
  .replace('registrant: "dsh-workspace-groups"', 'registrant: "dsh-session-sorts"')
  .replace('style.setAttribute("data-plugin", "dsh-workspace-groups")', 'style.setAttribute("data-plugin", "dsh-session-sorts")')
  .replaceAll('dsh-workspace-groups: dictionaries', 'DSH session sorts: dictionaries');
await put('lib/client.js', client);
let host = await get('tests/fixtures/upstream/lib/index.js');
const start = host.indexOf('//#region node_modules/');
const end = host.indexOf('//#region src/core/types.ts');
if (start < 0 || end < start) throw new Error('YAML bundle anchors missing');
host = host.slice(0, start) + 'import { load } from "js-yaml";\n' + host.slice(end);
host = host.replace('const name = "dsh-workspace-groups"', 'const name = "dsh-session-sorts"');
await put('lib/index.js', host);
const pkg = JSON.parse(await get('tests/fixtures/upstream/package.json'));
pkg.name = 'dsh-session-sorts';
pkg.displayName = 'DSH session sorts';
pkg.version = '0.1.0';
pkg.repository = { type: 'git', url: 'https://github.com/cuppur/dsh-session-sorts.git' };
pkg.homepage = 'https://github.com/cuppur/dsh-session-sorts#readme';
pkg.bugs = { url: 'https://github.com/cuppur/dsh-session-sorts/issues' };
pkg.description = 'DSH session sorts — DSH 0.2.1-rc.2 workspace groups compatibility edition; preserves grouping, ordering, search and isolated sidecars.';
pkg.engines.dsh = '0.2.1-rc.2';
delete pkg.types;
delete pkg.exports['.'].types;
delete pkg.exports['./client'].types;
delete pkg.devDependencies;
pkg.files = ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'LICENSE'];
pkg.scripts = { build: 'node adapt.mjs', check: 'node --check lib/index.js && node --check lib/client.js', test: 'node tests/offline.mjs' };
pkg.dsh.client.inject = ['@deepseek-ai/dsh-client-ui-workspace'];
pkg.peerDependencies = {
  '@deepseek-ai/cordis': '~4.0.5',
  '@deepseek-ai/dsh-client-ui-workspace': '0.2.1-rc.2',
  '@deepseek-ai/dsh-host-webserver': '0.2.1-rc.2',
  react: '^18.2.0'
};
delete pkg.peerDependenciesMeta;
pkg.dependencies = { 'js-yaml': '^4.3.2' };
await put('package.json', JSON.stringify(pkg, null, 2) + '\n');
await rm(new URL('lib/client.js.map', root), { force: true });
await rm(new URL('lib/types', root), { recursive: true, force: true });
console.log('Adapted package from immutable original snapshot. No profile/host files changed.');
