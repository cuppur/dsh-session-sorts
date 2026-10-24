import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { load } from "js-yaml";
//#region src/core/types.ts
/**
* Legacy label of the fallback bucket. The top-level (ungrouped) concept
* replaced the rendered "未分类" bucket: workspaces in no group render as
* top-level rows beside the group folders. The constant survives for data
* compatibility (reserved name, assignment null marker).
*/
const UNCATEGORIZED_LABEL = "未分类";
//#endregion
//#region src/core/matcher.ts
/** Display name of a rule category: the rename override when present. */
function ruleDisplayName(manual, originalName) {
	return manual?.renamed?.[originalName] ?? originalName;
}
//#endregion
//#region src/host-config.ts
/**
* Sidecar config reading for dsh-workspace-groups. The classification rules
* live in a user-editable YAML file (default `~/.dsh/workspace-groups.yaml`),
* read and validated on the host, served to the browser half as JSON. The
* core workspace.json and session storage are never touched.
*/
/** Default sidecar location: `$DSH_HOME/workspace-groups.yaml` (DSH_HOME falls back to ~/.dsh). */
function defaultConfigPath() {
	const home = process.env.DSH_HOME !== void 0 && process.env.DSH_HOME !== "" ? process.env.DSH_HOME : resolve(homedir(), ".dsh");
	return resolve(home, "workspace-groups.yaml");
}
/** Parse + validate a raw sidecar document into a GroupsConfig (throws on malformed input). */
function parseGroupsConfig(raw) {
	if (raw === void 0 || raw === null) return { categories: [] };
	if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("workspace-groups.yaml: top-level value must be a mapping");
	const categoriesValue = raw.categories;
	const categories = [];
	if (categoriesValue === void 0) return { categories: [] };
	if (!Array.isArray(categoriesValue)) throw new Error("workspace-groups.yaml: categories must be a list");
	for (const entry of categoriesValue) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error("workspace-groups.yaml: each category must be a mapping");
		const name = entry.name;
		if (typeof name !== "string" || name.trim() === "") throw new Error("workspace-groups.yaml: each category needs a non-empty name");
		const rulesValue = entry.rules;
		if (rulesValue === void 0) throw new Error(`workspace-groups.yaml: category "${name}" needs a rules list`);
		if (!Array.isArray(rulesValue)) throw new Error(`workspace-groups.yaml: category "${name}" rules must be a list`);
		const rules = [];
		for (const rule of rulesValue) {
			if (typeof rule !== "object" || rule === null || Array.isArray(rule)) throw new Error(`workspace-groups.yaml: category "${name}" rule must be a mapping`);
			const r = rule;
			const normalized = {};
			for (const key of [
				"pathPrefix",
				"nameContains",
				"basenameContains",
				"pathExact"
			]) {
				const value = r[key];
				if (value !== void 0) {
					if (typeof value !== "string" || value === "") throw new Error(`workspace-groups.yaml: category "${name}" rule ${key} must be a non-empty string`);
					normalized[key] = value;
				}
			}
			if (Object.keys(normalized).length === 0) throw new Error(`workspace-groups.yaml: category "${name}" has a rule with no matchers`);
			rules.push(normalized);
		}
		if (rules.length === 0) throw new Error(`workspace-groups.yaml: category "${name}" needs at least one rule`);
		categories.push({
			name: name.trim(),
			rules
		});
	}
	return { categories };
}
/**
* Read + parse the sidecar config file. A missing file yields an empty config
* (all workspaces fall into the uncategorized bucket); malformed YAML throws
* so the operator sees the problem instead of silently ungrouping everything.
*/
async function readGroupsConfig(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return { categories: [] };
		throw error;
	}
	return parseGroupsConfig(load(text));
}
//#endregion
//#region src/host-manual.ts
/**
* Runtime grouping overlay for dsh-workspace-groups: manual groups created in
* the sidebar UI and per-workspace category overrides. Stored in a plugin-
* owned JSON sidecar (`$DSH_HOME/workspace-groups.manual.json`), separate from
* the operator YAML — the YAML stays the rule source, this file only records
* runtime decisions, and writes are atomic (temp file + fsync + rename).
*
* The browser PUT route writes the whole overlay (idempotent, last write
* wins); reads tolerate hand-edited content (parse-only) while the write
* boundary cross-validates against the current rule categories.
*/
/** Default overlay location: `$DSH_HOME/workspace-groups.manual.json`. */
function defaultManualPath() {
	const home = process.env.DSH_HOME !== void 0 && process.env.DSH_HOME !== "" ? process.env.DSH_HOME : resolve(homedir(), ".dsh");
	return resolve(home, "workspace-groups.manual.json");
}
/**
* Parse + shape-validate a raw overlay document into a ManualGroups.
* Validates types only — category references are checked against the rule set
* at the write boundary (validateManualGroups), because reads must tolerate
* files written while the rule set was different.
* @param raw - parsed JSON value.
* @returns the normalized overlay.
* @throws when the shape is malformed (non-mapping, bad names, duplicates,
* the reserved uncategorized label, bad assignment/order values).
*/
function parseManualGroups(raw) {
	if (raw === void 0 || raw === null) return {
		categories: [],
		assignments: {}
	};
	if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("workspace-groups.manual.json: top-level value must be a mapping");
	const source = raw;
	const categories = [];
	if (source.categories !== void 0) {
		if (!Array.isArray(source.categories)) throw new Error("workspace-groups.manual.json: categories must be a list");
		const seen = /* @__PURE__ */ new Set();
		for (const entry of source.categories) {
			if (typeof entry !== "string" || entry.trim() === "") throw new Error("workspace-groups.manual.json: each manual category must be a non-empty string");
			const name = entry.trim();
			if (name === "未分类") throw new Error(`workspace-groups.manual.json: manual category name "${name}" is reserved`);
			if (seen.has(name)) throw new Error(`workspace-groups.manual.json: duplicate manual category "${name}"`);
			seen.add(name);
			categories.push(name);
		}
	}
	const assignments = {};
	if (source.assignments !== void 0) {
		if (typeof source.assignments !== "object" || source.assignments === null || Array.isArray(source.assignments)) throw new Error("workspace-groups.manual.json: assignments must be a mapping");
		for (const [workspaceId, category] of Object.entries(source.assignments)) {
			if (workspaceId.trim() === "") throw new Error("workspace-groups.manual.json: assignment keys must be non-empty");
			if (category === null) {
				assignments[workspaceId] = null;
				continue;
			}
			if (typeof category !== "string" || category.trim() === "") throw new Error(`workspace-groups.manual.json: assignment "${workspaceId}" must be a category name or null`);
			assignments[workspaceId] = category.trim();
		}
	}
	const manual = {
		categories,
		assignments
	};
	if (source.categoryOrder !== void 0) manual.categoryOrder = parseStringList(source.categoryOrder, "categoryOrder", true);
	if (source.hidden !== void 0) manual.hidden = parseStringList(source.hidden, "hidden", true);
	if (source.renamed !== void 0) {
		if (typeof source.renamed !== "object" || source.renamed === null || Array.isArray(source.renamed)) throw new Error("workspace-groups.manual.json: renamed must be a mapping");
		const renamed = {};
		for (const [original, display] of Object.entries(source.renamed)) {
			if (original.trim() === "") throw new Error("workspace-groups.manual.json: renamed keys must be non-empty");
			if (typeof display !== "string" || display.trim() === "") throw new Error(`workspace-groups.manual.json: renamed "${original}" must be a non-empty string`);
			renamed[original] = display.trim();
		}
		manual.renamed = renamed;
	}
	if (source.workspaceOrder !== void 0) {
		if (typeof source.workspaceOrder !== "object" || source.workspaceOrder === null || Array.isArray(source.workspaceOrder)) throw new Error("workspace-groups.manual.json: workspaceOrder must be a mapping");
		const workspaceOrder = {};
		for (const [categoryKey, ids] of Object.entries(source.workspaceOrder)) {
			if (categoryKey.trim() === "") throw new Error("workspace-groups.manual.json: workspaceOrder keys must be non-empty");
			workspaceOrder[categoryKey] = parseStringList(ids, `workspaceOrder["${categoryKey}"]`, true);
		}
		manual.workspaceOrder = workspaceOrder;
	}
	return manual;
}
/** Parse a list of non-empty strings, optionally de-duplicated. */
function parseStringList(value, field, unique) {
	if (!Array.isArray(value)) throw new Error(`workspace-groups.manual.json: ${field} must be a list`);
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const entry of value) {
		if (typeof entry !== "string" || entry.trim() === "") throw new Error(`workspace-groups.manual.json: ${field} entries must be non-empty strings`);
		const trimmed = entry.trim();
		if (unique && seen.has(trimmed)) throw new Error(`workspace-groups.manual.json: ${field} has duplicate entry "${trimmed}"`);
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}
/**
* Cross-validate a parsed overlay against the current rule categories
* (write boundary only). Every assignment value must be `null`, a rule
* display name, a manual category name, or the uncategorized label; order
* keys must reference existing categories; renames/hides must reference
* actual rule categories.
* @param manual - parsed overlay.
* @param ruleCategoryNames - current YAML rule category original names.
* @throws when the overlay references categories that do not exist.
*/
function validateManualGroups(manual, ruleCategoryNames) {
	const ruleNames = new Set(ruleCategoryNames);
	const allowed = new Set(ruleCategoryNames.map((name) => ruleDisplayName(manual, name)));
	for (const name of manual.categories) allowed.add(name);
	allowed.add(UNCATEGORIZED_LABEL);
	for (const [workspaceId, category] of Object.entries(manual.assignments)) {
		if (category === null) continue;
		if (!allowed.has(category)) throw new Error(`workspace-groups.manual.json: assignment "${workspaceId}" references unknown category "${category}"`);
	}
	for (const key of manual.categoryOrder ?? []) if (!allowed.has(key) || key === "未分类") throw new Error(`workspace-groups.manual.json: categoryOrder references unknown category "${key}"`);
	for (const key of Object.keys(manual.workspaceOrder ?? {})) {
		if (key === "__topLevel__") continue;
		if (!allowed.has(key) || key === "未分类") throw new Error(`workspace-groups.manual.json: workspaceOrder references unknown category "${key}"`);
	}
	for (const original of Object.keys(manual.renamed ?? {})) if (!ruleNames.has(original)) throw new Error(`workspace-groups.manual.json: renamed references unknown rule category "${original}"`);
	for (const original of manual.hidden ?? []) if (!ruleNames.has(original)) throw new Error(`workspace-groups.manual.json: hidden references unknown rule category "${original}"`);
}
/** Read + parse the overlay file. A missing file yields an empty overlay. */
async function readManualGroups(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return {
			categories: [],
			assignments: {}
		};
		throw error;
	}
	return parseManualGroups(JSON.parse(text));
}
/**
* Atomically replace the overlay file: write a same-directory temp file,
* fsync it, then rename over the target. A crash never leaves a torn JSON at
* the real path (readers see either the old or the new file).
* @param path - target file path.
* @param manual - overlay to persist.
*/
async function writeManualGroups(path, manual) {
	const json = `${JSON.stringify(manual, null, 2)}\n`;
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	const handle = await open(tmp, "w");
	try {
		await handle.writeFile(json, "utf8");
		await handle.sync();
	} catch (error) {
		await handle.close().catch(() => {});
		await unlink(tmp).catch(() => {});
		throw error;
	}
	await handle.close();
	try {
		await rename(tmp, path);
	} catch (error) {
		await unlink(tmp).catch(() => {});
		throw error;
	}
}
//#endregion
//#region src/index.ts
/** Plugin identity for cordis.yml rows. */
const name = "dsh-session-sorts";
/** Services required before mounting: the webserver route. */
const inject = ["webServer"];
/** Cap on the PUT body: the overlay is tiny; anything bigger is a client bug. */
const MAX_MANUAL_BODY_BYTES = 65536;
/** Error with an HTTP status, mapped to a plain-text 4xx/5xx response. */
var HttpError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
	}
};
/** Write a plain-text error response with the given status. */
function writeError(res, status, message) {
	res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
	res.end(message);
}
/** Collect the request body as UTF-8 text, rejecting oversized bodies. */
async function readBody(req, limit) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > limit) throw new HttpError(413, "request body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) throw new HttpError(400, "empty request body");
	return Buffer.concat(chunks).toString("utf8");
}
/** Plugin body: mount the config snapshot route and the overlay write route. */
function apply(ctx) {
	const configPath = defaultConfigPath();
	const manualPath = defaultManualPath();
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/workspace-groups/config",
		handler: async (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				writeError(res, 405, "method not allowed");
				return;
			}
			let config;
			let manual;
			try {
				[config, manual] = await Promise.all([readGroupsConfig(configPath), readManualGroups(manualPath)]);
			} catch (error) {
				writeError(res, 500, `workspace-groups: failed to read config: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			const body = JSON.stringify({
				...config,
				manual
			});
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-cache",
				"Content-Length": Buffer.byteLength(body)
			});
			res.end(req.method === "HEAD" ? void 0 : body);
		}
	}), "dsh-workspace-groups: /workspace-groups/config route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/workspace-groups/manual",
		handler: async (req, res) => {
			if (req.method !== "PUT") {
				writeError(res, 405, "method not allowed");
				return;
			}
			let raw;
			try {
				raw = JSON.parse(await readBody(req, MAX_MANUAL_BODY_BYTES));
			} catch (error) {
				writeError(res, error instanceof HttpError ? error.status : 400, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			let manual;
			try {
				manual = parseManualGroups(raw);
				const ruleConfig = (await readGroupsConfig(configPath)).categories;
				validateManualGroups(manual, ruleConfig.map((category) => category.name));
			} catch (error) {
				writeError(res, 400, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			try {
				await writeManualGroups(manualPath, manual);
			} catch (error) {
				writeError(res, 500, `workspace-groups: failed to write manual overlay: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			const body = JSON.stringify({ ok: true });
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store",
				"Content-Length": Buffer.byteLength(body)
			});
			res.end(body);
		}
	}), "dsh-workspace-groups: /workspace-groups/manual route");
}
//#endregion
export { apply, inject, name };
