window.__ModuleLoader__.load({
	id: "dsh-session-sorts",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");

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
		//#region src/client/store-core.ts
		/** Collapse writes `false` (key retained); expand writes `true`. */
		function setCategoryExpandedImpl(state, key, expanded) {
			state.categoryExpansion[key] = expanded;
		}
		/** Collapse writes `false` (key retained); expand writes `true`. */
		function setWorkspaceExpandedImpl(state, key, expanded) {
			state.workspaceExpansion[key] = expanded;
		}
		/** Drop expansion keys that no longer exist (renames/deletes/config edits). */
		function retainKeysImpl(state, categoryKeys, workspaceKeys) {
			state.categoryExpansion = Object.fromEntries(Object.entries(state.categoryExpansion).filter(([key]) => categoryKeys.includes(key)));
			state.workspaceExpansion = Object.fromEntries(Object.entries(state.workspaceExpansion).filter(([key]) => workspaceKeys.includes(key)));
		}
		//#endregion
		//#region src/client/stores.ts
		/**
		* The workspace-groups viewing store: category / workspace folder expansion,
		* persisted across reloads under an independent key (the official
		* ui-workspace store keeps its own `dsh.workspace.view.v5` — we never touch
		* it). Module level exports the factory only (a module-level handle would pin
		* the store identity across plugin reloads); register() receives the factory
		* and the browser derives its PropsStore share from the return type.
		*
		* The action implementations live in `store-core.ts` (pure, runtime-free) so
		* unit tests exercise the real semantics without a browser module loader;
		* this file only binds them through defineStore.
		*/
		/**
		* Create the workspace-groups viewing store handle.
		* @returns the store handle (spec + type + identity + factory in one).
		*/
		function createGroupsViewStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({
					categoryExpansion: {},
					workspaceExpansion: {}
				}),
				persist: "dsh.workspace.groups.view.v1",
				actions: {
					setCategoryExpanded: setCategoryExpandedImpl,
					setWorkspaceExpanded: setWorkspaceExpandedImpl,
					retainKeys: retainKeysImpl
				}
			});
		}
		//#endregion
		//#region src/core/types.ts
		/**
		* Legacy label of the fallback bucket. The top-level (ungrouped) concept
		* replaced the rendered "未分类" bucket: workspaces in no group render as
		* top-level rows beside the group folders. The constant survives for data
		* compatibility (reserved name, assignment null marker).
		*/
		const UNCATEGORIZED_LABEL = "未分类";
		/**
		* Reserved key under `workspaceOrder` holding the manual order of TOP-LEVEL
		* (ungrouped) project rows. Distinct from any real group display name (a group
		* may not be named this), so it can never collide; the top-level list's order
		* is preserved exactly like a group's, and top-level rows can be reordered by
		* dragging.
		*/
		const TOP_LEVEL_ORDER_KEY = "__topLevel__";
		/** Normalize a path for prefix matching: trailing slashes stripped. */
		function normalizePath(path) {
			return path.replace(/[/\\]+$/, "");
		}
		//#endregion
		//#region src/core/matcher.ts
		/**
		* Pure classification + ordering logic: decides which category a workspace
		* belongs to and how categories/workspaces are ordered. Shared by the host
		* half (validation) and the client half (tree derivation), so the semantics
		* can never drift between the config surface and the rendered tree.
		*
		* Category identity: a category's STABLE origin is its YAML rule category
		* name (or a manual-group name). Its DISPLAY key is what the tree renders and
		* what assignments reference — for rule categories that is the rename
		* override when present. Hidden rule categories are inert: workspaces that
		* would match them become top-level (ungrouped).
		*/
		/** One rule match against a workspace's path and title. */
		function ruleMatches(rule, path, title) {
			const normalized = normalizePath(path);
			if (rule.pathPrefix !== void 0 && normalized.startsWith(normalizePath(rule.pathPrefix))) return true;
			if (rule.pathExact !== void 0 && normalized === normalizePath(rule.pathExact)) return true;
			if (rule.nameContains !== void 0 && title.toLowerCase().includes(rule.nameContains.toLowerCase())) return true;
			if (rule.basenameContains !== void 0) {
				if ((path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "").toLowerCase().includes(rule.basenameContains.toLowerCase())) return true;
			}
			return false;
		}
		/** Classify a workspace by rules only; hidden categories are inert. */
		function classify(categories, path, title) {
			for (const category of categories) if (category.rules.some((rule) => ruleMatches(rule, path, title))) return category;
		}
		/** Display name of a rule category: the rename override when present. */
		function ruleDisplayName(manual, originalName) {
			return manual?.renamed?.[originalName] ?? originalName;
		}
		/** Whether a rule category has been hidden by a UI delete. */
		function isHiddenRule(manual, originalName) {
			return manual?.hidden?.includes(originalName) ?? false;
		}
		/** Original YAML rule name whose display name equals `key` (undefined when none). */
		function originalRuleNameForDisplay(categories, manual, key) {
			return categories.find((c) => ruleDisplayName(manual, c.name) === key)?.name;
		}
		function effectiveCategories(config, manual) {
			const entries = [];
			const seen = /* @__PURE__ */ new Set();
			for (const category of config.categories) {
				if (isHiddenRule(manual, category.name)) continue;
				const key = ruleDisplayName(manual, category.name);
				if (seen.has(key)) continue;
				seen.add(key);
				entries.push({
					key,
					source: "rule"
				});
			}
			for (const name of manual?.categories ?? []) {
				if (seen.has(name)) continue;
				seen.add(name);
				entries.push({
					key: name,
					source: "manual"
				});
			}
			const order = manual?.categoryOrder;
			if (order === void 0 || order.length === 0) return entries;
			const position = new Map(order.map((key, index) => [key, index]));
			return [...entries].sort((a, b) => {
				const pa = position.get(a.key);
				const pb = position.get(b.key);
				if (pa !== void 0 && pb !== void 0) return pa - pb;
				if (pa !== void 0) return -1;
				if (pb !== void 0) return 1;
				return 0;
			});
		}
		/** Display keys of all effective categories (top-level workspaces excluded). */
		function displayCategoryKeys(config, manual) {
			return effectiveCategories(config, manual).map((e) => e.key);
		}
		/**
		* Resolve the category key a workspace renders under, or `undefined` when it
		* is top-level (ungrouped). Precedence: manual override (`null` = forced
		* top-level) → rule classification (hidden rules inert) → top-level.
		*/
		function resolveCategory(config, manual, workspaceId, path, title) {
			const override = manual?.assignments[workspaceId];
			if (override !== void 0) return override ?? void 0;
			const matched = classify(config.categories, path, title);
			if (matched === void 0) return void 0;
			if (isHiddenRule(manual, matched.name)) return void 0;
			return ruleDisplayName(manual, matched.name);
		}
		/**
		* Names that may not be used for a new/renamed group: the legacy reserved
		* label plus every current display key.
		*/
		function takenCategoryNames(config, manual) {
			const taken = new Set(displayCategoryKeys(config, manual));
			taken.add(UNCATEGORIZED_LABEL);
			return taken;
		}
		/**
		* Order a bucket of workspace ids: the stored per-category order first
		* (filtered to actual members), then any remaining members in `fallback`
		* (host) order. Deterministic; the renderer never re-sorts on its own.
		*/
		function orderedWorkspaceIds(manual, categoryKey, members) {
			const stored = manual?.workspaceOrder?.[categoryKey];
			if (stored === void 0 || stored.length === 0) return [...members];
			const memberSet = new Set(members);
			const ordered = [];
			const seen = /* @__PURE__ */ new Set();
			for (const id of stored) {
				if (!memberSet.has(id) || seen.has(id)) continue;
				seen.add(id);
				ordered.push(id);
			}
			for (const id of members) {
				if (seen.has(id)) continue;
				ordered.push(id);
			}
			return ordered;
		}
		/** Move `id` before `beforeId` (undefined = append) within an ordered list. */
		function moveBefore(list, id, beforeId) {
			const rest = list.filter((x) => x !== id);
			if (beforeId === void 0) return [...rest, id];
			const index = rest.indexOf(beforeId);
			if (index === -1) return [...rest, id];
			rest.splice(index, 0, id);
			return rest;
		}
		/** Move `id` after `afterId` (undefined = append) within an ordered list. */
		function moveAfter(list, id, afterId) {
			const rest = list.filter((x) => x !== id);
			if (afterId === void 0) return [...rest, id];
			const index = rest.indexOf(afterId);
			if (index === -1) return [...rest, id];
			rest.splice(index + 1, 0, id);
			return rest;
		}
		//#endregion
		//#region src/client/tree.ts
		/**
		* Derives the three-level workspace-groups tree: 分类文件夹 → 项目文件夹 →
		* 会话行. Pure derivation — all inputs are snapshots; the renderer never
		* scans. Session visibility rules mirror the official ui-workspace tree
		* (blank rows only when current, archived excluded, subagent rows excluded).
		*/
		/** Key of the uncategorized bucket (matches the config fallback label). */
		const UNCATEGORIZED_KEY = UNCATEGORIZED_LABEL;
		/** Directory display label: basename of the path (both separators accepted). */
		function workspaceLabel(cwd) {
			if (cwd === void 0 || cwd === "") return UNCATEGORIZED_LABEL;
			const base = cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
			return base !== void 0 && base !== "" ? base : cwd;
		}
		/** Ordinary sessions are visible; blank only when current; archived/subagent never. */
		function sessionVisible(session, current, archived) {
			return session.origin !== "subagent" && !archived.has(session.id) && (!session.blank || session.id === current);
		}
		/** Blank rows display the localized New Session label (never enters search). */
		function sessionTitle(session) {
			return session.blank ? "New Session" : session.displayTitle;
		}
		function sessionNode(s, descendants) {
			return {
				id: s.id,
				title: sessionTitle(s),
				blank: s.blank,
				running: s.running,
				runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
				completed: s.completed === true,
				updatedAt: s.updatedAt,
				...s.pendingInteraction === void 0 ? {} : { pendingInteraction: s.pendingInteraction }
			};
		}
		/** Visible sessions of one workspace in its stored account order. */
		function workspaceSessions(list, workspace, archived, descendants) {
			const nodes = [];
			for (const id of workspace.sessionIds) {
				const summary = list.byId[id];
				if (summary === void 0) continue;
				if (!sessionVisible(summary, list.current, archived)) continue;
				nodes.push(sessionNode(summary, descendants));
			}
			return nodes;
		}
		/**
		* Derive the three-level tree.
		* @param list - sessions list snapshot (`current` feeds containsCurrent).
		* @param workspaces - real workspaces in stable Host order.
		* @param archivedSessionIds - registry-global archive set.
		* @param config - sidecar grouping config (rule categories).
		* @param view - local expansion arrays.
		* @param manual - runtime overlay (manual groups + overrides). A workspace's
		* manual override wins over rule classification; removing it reverts to rules.
		* @returns category sections in render order (rule categories first, then
		* manual-only ones, uncategorized last). Manual groups render even while
		* empty; empty rule buckets stay hidden.
		*/
		function deriveGroups(list, workspaces, archivedSessionIds, config, view, manual) {
			const archived = new Set(archivedSessionIds);
			const expandedCategories = new Set(view.expandedCategories);
			const expandedWorkspaces = new Set(view.expandedWorkspaces);
			const descendants = indexRunningChildren(list);
			const byCategory = /* @__PURE__ */ new Map();
			for (const { key } of effectiveCategories(config, manual)) byCategory.set(key, []);
			for (const workspace of workspaces) {
				const key = resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title);
				if (key === void 0) continue;
				if (!byCategory.has(key)) byCategory.set(key, []);
				byCategory.get(key).push(workspace);
			}
			const manualCategories = new Set(manual.categories);
			const currentWorkspaceId = list.current === void 0 ? void 0 : workspaces.find((w) => w.sessionIds.includes(list.current))?.workspaceId;
			const nodes = [];
			for (const key of effectiveCategories(config, manual).map((e) => e.key)) {
				const bucket = byCategory.get(key) ?? [];
				if (bucket.length === 0 && !manualCategories.has(key)) continue;
				const expanded = expandedCategories.has(key);
				const ordered = orderedWorkspaceIds(manual, key, bucket.map((w) => w.workspaceId));
				const workspaceNodes = [];
				let containsCurrent = false;
				for (const workspaceId of ordered) {
					const workspace = bucket.find((w) => w.workspaceId === workspaceId);
					if (workspace === void 0) continue;
					const sessions = workspaceSessions(list, workspace, archived, descendants);
					const wsExpanded = expandedWorkspaces.has(workspace.workspaceId);
					const wsContainsCurrent = workspace.workspaceId === currentWorkspaceId;
					if (wsContainsCurrent) containsCurrent = true;
					workspaceNodes.push({
						workspaceId: workspace.workspaceId,
						path: workspace.path,
						label: workspace.title,
						createdAt: Date.parse(workspace.createdAt),
						sessionCount: sessions.length,
						expanded: wsExpanded,
						containsCurrent: wsContainsCurrent,
						sessions: wsExpanded ? sessions : []
					});
				}
				nodes.push({
					key,
					label: key,
					expanded,
					containsCurrent,
					workspaces: workspaceNodes
				});
			}
			return nodes;
		}
		/**
		* Top-level (ungrouped) workspace rows: workspaces resolving to no category
		* (no manual override and no matching rule, or a forced `null` override).
		* Rendered after the group folders as plain project rows (not inside any
		* folder), in manual top-level order (`workspaceOrder[TOP_LEVEL_ORDER_KEY]`),
		* falling back to host registration order.
		*/
		function deriveTopLevel(list, workspaces, archivedSessionIds, config, view, manual) {
			const archived = new Set(archivedSessionIds);
			const expandedWorkspaces = new Set(view.expandedWorkspaces);
			const descendants = indexRunningChildren(list);
			const currentWorkspaceId = list.current === void 0 ? void 0 : workspaces.find((w) => w.sessionIds.includes(list.current))?.workspaceId;
			const topLevelIds = workspaces.filter((w) => resolveCategory(config, manual, w.workspaceId, w.path, w.title) === void 0).map((w) => w.workspaceId);
			const ordered = orderedWorkspaceIds(manual, TOP_LEVEL_ORDER_KEY, topLevelIds);
			const nodes = [];
			for (const workspaceId of ordered) {
				const workspace = workspaces.find((w) => w.workspaceId === workspaceId);
				if (workspace === void 0) continue;
				const sessions = workspaceSessions(list, workspace, archived, descendants);
				const wsExpanded = expandedWorkspaces.has(workspaceId);
				nodes.push({
					workspaceId: workspace.workspaceId,
					path: workspace.path,
					label: workspace.title,
					createdAt: Date.parse(workspace.createdAt),
					sessionCount: sessions.length,
					expanded: wsExpanded,
					containsCurrent: workspace.workspaceId === currentWorkspaceId,
					sessions: wsExpanded ? sessions : []
				});
			}
			return nodes;
		}
		/** Recency comparator: newest first, id as the deterministic tiebreak. */
		function byRecency(a, b) {
			if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
			return a.id < b.id ? -1 : 1;
		}
		/**
		* Compute the matched-session set: immediate title/Workspace substring matches
		* from the local list, merged with ranked Host content matches. The consumer
		* (SearchBody) derives the pruned three-level tree from these ids.
		*/
		function deriveSearchMatches(list, workspaces, config, query, archivedSessionIds, content, limit) {
			const q = query.trim().toLowerCase();
			if (q === "") return {
				matchedIds: /* @__PURE__ */ new Set(),
				snippetsBySession: /* @__PURE__ */ new Map(),
				hasMore: false
			};
			const archived = new Set(archivedSessionIds);
			const workspaceBySession = /* @__PURE__ */ new Map();
			for (const workspace of workspaces) for (const sessionId of workspace.sessionIds) if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace);
			const labelOf = (summary) => workspaceBySession.get(summary.id)?.title ?? workspaceLabel(summary.cwd);
			const local = [];
			for (const id of list.ids) {
				const summary = list.byId[id];
				if (summary === void 0 || summary.blank || !sessionVisible(summary, list.current, archived)) continue;
				if (sessionTitle(summary).toLowerCase().includes(q) || labelOf(summary).toLowerCase().includes(q)) local.push(summary);
			}
			local.sort(byRecency);
			const ordered = [];
			const included = /* @__PURE__ */ new Set();
			const include = (summary) => {
				if (included.has(summary.id)) return;
				included.add(summary.id);
				ordered.push(summary);
			};
			for (const summary of local) include(summary);
			for (const item of content.items) {
				const summary = list.byId[item.sessionId];
				if (summary !== void 0 && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary);
			}
			const snippets = /* @__PURE__ */ new Map();
			for (const item of content.items) if (item.snippet !== void 0) snippets.set(item.sessionId, item.snippet);
			return {
				matchedIds: ordered.slice(0, limit).reduce((set, summary) => {
					set.add(summary.id);
					return set;
				}, /* @__PURE__ */ new Set()),
				snippetsBySession: snippets,
				hasMore: content.hasMore || ordered.length > limit
			};
		}
		/**
		* Build a three-level search tree containing ONLY the branches that hold a
		* matched session: 分类文件夹 → 项目文件夹 → 命中会话行. Every matched
		* session carries `matched: true` so rows render with the search-hit tint.
		* Classification uses the same precedence as the idle tree (manual override →
		* rules), so search shows the same grouping the user sees. Matched top-level
		* workspaces are returned separately (rendered as plain rows).
		*
		* @param list - sessions list snapshot.
		* @param workspaces - real workspaces in stable Host order.
		* @param config - sidecar grouping config.
		* @param matchedIds - set of session ids that matched the query.
		* @param archivedSessionIds - registry-global archive set.
		* @param manual - runtime overlay (manual groups + overrides).
		* @param snippetsBySession - optional content-match snippets keyed by session id.
		* @returns group folders in render order plus top-level matched workspaces,
		* pruned to matched branches only.
		*/
		function deriveSearchGroups(list, workspaces, config, matchedIds, archivedSessionIds, manual, snippetsBySession) {
			const archived = new Set(archivedSessionIds);
			const descendants = indexRunningChildren(list);
			const byCategory = /* @__PURE__ */ new Map();
			for (const key of effectiveCategories(config, manual).map((e) => e.key)) byCategory.set(key, []);
			const topLevel = [];
			for (const workspace of workspaces) {
				const nodes = [];
				for (const id of workspace.sessionIds) {
					const summary = list.byId[id];
					if (summary === void 0 || !matchedIds.has(id)) continue;
					if (!sessionVisible(summary, list.current, archived)) continue;
					const node = sessionNode(summary, descendants);
					const snippet = snippetsBySession?.get(id);
					nodes.push({
						...node,
						matched: true,
						...snippet === void 0 ? {} : { snippet }
					});
				}
				if (nodes.length === 0) continue;
				const node = {
					workspaceId: workspace.workspaceId,
					path: workspace.path,
					label: workspace.title,
					createdAt: Date.parse(workspace.createdAt),
					sessionCount: nodes.length,
					expanded: true,
					containsCurrent: false,
					sessions: nodes
				};
				const key = resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title);
				if (key === void 0) {
					topLevel.push(node);
					continue;
				}
				if (!byCategory.has(key)) byCategory.set(key, []);
				byCategory.get(key).push(node);
			}
			const categories = [];
			for (const key of effectiveCategories(config, manual).map((e) => e.key)) {
				const workspaceNodes = byCategory.get(key);
				if (workspaceNodes === void 0 || workspaceNodes.length === 0) continue;
				categories.push({
					key,
					label: key,
					expanded: true,
					containsCurrent: false,
					workspaces: workspaceNodes
				});
			}
			return {
				categories,
				topLevel
			};
		}
		//#endregion
		//#region src/client/rows.tsx
		/**
		* Row components for the workspace-groups tree. Kept dependency-light: they
		* consume only React, primitives (StateDot/Menu/icons), and the shared CSS
		* string. Each row owns its hover actions menu; dialogs live in the browser
		* root so they survive row unmounts during collapse.
		*
		* Drag & drop: workspace rows are draggable sources; category rows (and
		* workspace rows, standing for their containing category) are drop targets.
		* The payload is a custom dataTransfer type so only in-plugin drags land.
		*/
		/** dataTransfer type carrying the dragged workspace id (in-plugin drags only). */
		const DND_WORKSPACE_TYPE = "application/x-dsh-workspace-groups";
		/** dataTransfer type carrying the dragged category key (group reorder). */
		const DND_CATEGORY_TYPE = "application/x-dsh-workspace-groups-category";
		/** Whether a drag carries any of the plugin's payloads (drop targets accept both). */
		function hasPluginDragType(types) {
			const list = Array.from(types);
			return list.includes("application/x-dsh-workspace-groups") || list.includes("application/x-dsh-workspace-groups-category");
		}
		/** Pending interaction status → primitives StateDot state. */
		function pendingState(status) {
			switch (status) {
				case "approval":
				case "plan-review":
				case "question": return "warning";
				default: return;
			}
		}
		/** Primary status dot state for a session row. */
		function sessionDotState(node) {
			if (pendingState(node.pendingInteraction) !== void 0) return "warning";
			if (node.running || node.runningSubagentCount > 0) return "ongoing";
			return node.completed ? "done" : "done";
		}
		/** Compact relative time ("now"/"5min"/"3h"/"2d"/"4mo"/"1y"). */
		function relativeTimeLabel(updatedAt, now) {
			const diff = Math.max(0, now - updatedAt);
			const MIN = 6e4;
			const HOUR = 36e5;
			const DAY = 864e5;
			if (diff < MIN) return "now";
			if (diff < HOUR) return `${Math.floor(diff / MIN)}min`;
			if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
			if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d`;
			if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}mo`;
			return `${Math.floor(diff / (365 * DAY))}y`;
		}
		/**
		* One category folder row: toggle, rename/delete menu (every group — rule
		* groups via overlay renames/hides), draggable source for group reorder and
		* drop target for both workspace moves and group reorders.
		*/
		function CategoryRow({ node, t, onToggle, onRename, onDelete, dropActive = false, insertLine, onRowDragOver, onRowDragLeave, onRowDrop, onDragStartCategory }) {
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const count = node.workspaces.length;
			const manageable = onRename !== void 0 && onDelete !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `wgCategoryRow${dropActive ? " wgDropTarget" : ""}${insertLine === "before" ? " wgInsertBefore" : insertLine === "after" ? " wgInsertAfter" : ""}`,
				role: "treeitem",
				"aria-expanded": node.expanded,
				"aria-label": t("section.workspaces"),
				"data-wg-category": node.key,
				draggable: onDragStartCategory !== void 0,
				onClick: onToggle,
				onDragStart: onDragStartCategory,
				onDragOver: onRowDragOver,
				onDragLeave: onRowDragLeave,
				onDrop: onRowDrop,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: `wgChevron${node.expanded ? " wgChevronOpen" : ""}`,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFillRegular, { size: 14 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgCategoryIcon",
						"data-wg-row-icon": "group",
						children: node.expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenRegular, { size: 16 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular, { size: 16 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgCategoryLabel",
						children: node.label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgCategoryCount",
						children: count
					}),
					manageable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgRowActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							items: [{
								id: "rename",
								label: t("group.rename"),
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 16 })
							}, {
								id: "delete",
								label: t("group.delete"),
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 16 }),
								danger: true
							}],
							onSelect: (id) => {
								setMenuOpen(false);
								if (id === "rename") onRename();
								if (id === "delete") onDelete();
							},
							portal: true,
							closeOnPointerLeave: true,
							anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wgIconButton",
								draggable: false,
								"aria-label": `${t("group.rename")} ${node.label}`,
								onClick: (e) => {
									e.stopPropagation();
									setMenuOpen((v) => !v);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, { size: 16 })
							})
						})
					})
				]
			});
		}
		/** One workspace folder row inside a category: draggable source + drop target. */
		function WorkspaceRow({ node, t, onToggle, onNewSession, onRename, onDelete, canMoveOut = false, onMoveOut, flat = false, dropActive = false, insertLine, onRowDragOver, onRowDragLeave, onRowDrop, onDragStartExtra }) {
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const menuItems = [
				...canMoveOut && onMoveOut !== void 0 ? [{
					id: "moveOut",
					label: t("workspace.moveOutOfGroup"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutlineRegular, { size: 16 })
				}] : [],
				{
					id: "rename",
					label: t("workspace.rename"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 16 })
				},
				{
					id: "delete",
					label: t("workspace.delete"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 16 }),
					danger: true
				}
			];
			const onDragStart = (event) => {
				event.dataTransfer.setData(DND_WORKSPACE_TYPE, node.workspaceId);
				event.dataTransfer.effectAllowed = "move";
				onDragStartExtra?.();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `wgProjectRow${node.containsCurrent ? " wgProjectActive" : ""}${flat ? " wgProjectFlat" : ""}${dropActive ? " wgDropTarget" : ""}${insertLine === "before" ? " wgInsertBefore" : insertLine === "after" ? " wgInsertAfter" : ""}`,
				role: "treeitem",
				"aria-expanded": node.expanded,
				"data-wsid": node.workspaceId,
				draggable: true,
				onClick: onToggle,
				onDragStart,
				onDragOver: onRowDragOver,
				onDragLeave: onRowDragLeave,
				onDrop: onRowDrop,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: `wgChevron${node.expanded ? " wgChevronOpen" : ""}`,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFillRegular, { size: 14 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgCategoryIcon",
						"data-wg-row-icon": "project",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutlineRegular, { size: 16 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgProjectLabel",
						title: node.path,
						children: node.label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "wgRowActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							items: menuItems,
							onSelect: (id) => {
								setMenuOpen(false);
								if (id === "moveOut") onMoveOut?.();
								if (id === "rename") onRename();
								if (id === "delete") onDelete();
							},
							portal: true,
							closeOnPointerLeave: true,
							anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wgIconButton",
								draggable: false,
								"aria-label": `${t("workspace.rename")} ${node.label}`,
								onClick: (e) => {
									e.stopPropagation();
									setMenuOpen((v) => !v);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, { size: 16 })
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "wgIconButton",
							draggable: false,
							"aria-label": `${t("session.new")} ${node.label}`,
							onClick: (e) => {
								e.stopPropagation();
								onNewSession();
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 })
						})]
					})
				]
			});
		}
		/** One session leaf row. */
		function SessionRow({ node, currentId, now, t, onOpen, onRename, onFork, onArchive }) {
			const selected = node.id === currentId;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const menuItems = [
				{
					id: "rename",
					label: t("session.rename"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 16 })
				},
				{
					id: "fork",
					label: t("session.fork"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 16 })
				},
				{
					id: "archive",
					label: t("session.archive"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 16 })
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `wgSessionRow${selected ? " wgSelected" : ""}${node.matched === true ? " wgMatched" : ""}`,
				role: "treeitem",
				"aria-selected": selected,
				onClick: () => {
					onOpen(node.id);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgStatusSlot",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: sessionDotState(node) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgSessionTitle",
						children: node.title
					}),
					!node.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgSessionTime",
						children: relativeTimeLabel(node.updatedAt, now)
					}),
					node.snippet !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgSessionSnippet",
						title: node.snippet,
						children: node.snippet
					}),
					!node.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wgRowActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							items: menuItems,
							onSelect: (id) => {
								setMenuOpen(false);
								if (id === "rename") onRename(node.id, node.title);
								if (id === "fork") onFork(node.id);
								if (id === "archive") onArchive(node.id);
							},
							portal: true,
							closeOnPointerLeave: true,
							anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wgIconButton",
								"aria-label": `${t("session.rename")} ${node.title}`,
								onClick: (e) => {
									e.stopPropagation();
									setMenuOpen((v) => !v);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, { size: 16 })
							})
						})
					})
				]
			});
		}
		//#endregion
		//#region upstream-inline-css
		var styles_css_default = ".wgRoot{box-sizing:border-box;flex-direction:column;flex:1;width:100%;min-height:0;display:flex;overflow:hidden}.wgSectionHeader{flex:none;align-items:center;gap:4px;height:36px;padding:0 12px;display:flex}.wgSectionLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:45%;color:var(--dsw-fg-1,inherit);flex:none;font-size:12px;font-weight:600;overflow:hidden}.wgIconButton{width:26px;height:26px;color:var(--dsw-fg-2,inherit);cursor:pointer;background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}.wgIconButton:hover{background:var(--dsw-bg-hover,#7f7f7f1f);color:var(--dsw-fg-1,inherit)}.wgIconButton:disabled{opacity:.5;cursor:default}.wgSearch{flex:1;align-items:center;min-width:0;max-width:28px;margin-left:auto;transition:max-width .18s;display:flex}.wgSearchExpanded{max-width:100%}.wgSearchInput{min-width:0;color:var(--dsw-fg-1,inherit);background:0 0;border:none;outline:none;flex:1;padding:0;font-size:12px}.wgTreeBody{flex:1;min-height:0;padding:0 8px 8px;overflow-y:auto}.wgList{flex-direction:column;gap:1px;display:flex}.wgEmpty{text-align:center;color:var(--dsw-fg-3,#7f7f7fcc);padding:16px 8px;font-size:12px}.wgCategoryRow{cursor:pointer;user-select:none;border-radius:6px;align-items:center;gap:4px;height:28px;padding:0 4px;display:flex;position:relative}.wgCategoryRow:hover{background:var(--dsw-bg-hover,#7f7f7f1f)}.wgCategoryRow:hover .wgRowActions,.wgCategoryRow:focus-within .wgRowActions{opacity:1}.wgDropTarget{background:var(--dsw-bg-selected,#4a90d92e);outline:1px dashed var(--dsw-accent,#4a90d9);outline-offset:-1px}.wgInsertBefore:before,.wgInsertAfter:after{content:\"\";background:var(--dsw-accent,#4a90d9);height:2px;box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-accent,#4a90d9) 25%, transparent);pointer-events:none;z-index:6;border-radius:1px;position:absolute;left:2px;right:2px}.wgInsertBefore:before{top:-1px}.wgInsertAfter:after{bottom:-1px}.wgChevron{width:14px;height:14px;color:var(--dsw-fg-3,#7f7f7fcc);flex:none;justify-content:center;align-items:center;transition:transform .12s;display:inline-flex}.wgChevronOpen{transform:rotate(90deg)}.wgCategoryIcon{color:var(--dsw-fg-2,inherit);flex:none;justify-content:center;align-items:center;display:inline-flex}.wgCategoryLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-fg-1,inherit);flex:1;font-size:12px;font-weight:600;overflow:hidden}.wgCategoryCount{color:var(--dsw-fg-3,#7f7f7fcc);flex:none;font-size:11px}.wgProjectRow{cursor:pointer;user-select:none;border-radius:6px;align-items:center;gap:4px;height:28px;padding:0 4px 0 20px;display:flex;position:relative}.wgProjectFlat{padding-left:4px}.wgTopLevelArea{margin-top:2px;padding-bottom:10px}.wgTopLevelEmpty{border-radius:4px;height:14px;position:relative}.wgTopLevelEmptyLine{background:var(--dsw-accent,#4a90d9);height:2px;box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-accent,#4a90d9) 25%, transparent);pointer-events:none;border-radius:1px;position:absolute;top:50%;left:2px;right:2px}.wgTopLevelEmptyActive{background:var(--dsw-bg-selected,#4a90d92e)}.wgProjectRow:hover{background:var(--dsw-bg-hover,#7f7f7f1f)}.wgProjectActive{color:var(--dsw-accent,#4a90d9)}.wgProjectLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-fg-1,inherit);flex:1;font-size:12px;overflow:hidden}.wgRowActions{opacity:0;flex:none;align-items:center;gap:2px;display:inline-flex}.wgProjectRow:hover .wgRowActions,.wgProjectRow:focus-within .wgRowActions{opacity:1}.wgSessionRow{cursor:pointer;user-select:none;border-radius:6px;align-items:center;gap:6px;height:30px;padding:0 4px 0 40px;display:flex}.wgSessionRow:hover{background:var(--dsw-bg-hover,#7f7f7f1f)}.wgSessionRow:hover .wgRowActions,.wgSessionRow:focus-within .wgRowActions{opacity:1}.wgSelected{background:var(--dsw-bg-selected,#4a90d92e)}.wgStatusSlot{flex:none;justify-content:center;align-items:center;width:14px;height:14px;display:inline-flex}.wgSessionTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-fg-1,inherit);flex:1;font-size:12px;overflow:hidden}.wgSessionTime{color:var(--dsw-fg-3,#7f7f7fcc);flex:none;font-size:11px}.wgVisuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.wgMatched{background:var(--dsw-bg-selected,#4a90d92e)}.wgSessionSnippet{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-fg-3,#7f7f7fcc);flex:1;font-size:11px;overflow:hidden}.wgSearchStatus{color:var(--dsw-fg-3,#7f7f7fcc);text-align:center;padding:8px;font-size:11px}.wgManualError{color:var(--dsw-fg-1,inherit);text-align:left;word-break:break-word}.wgRail{flex-direction:column;align-items:center;gap:12px;padding:8px 0 0;display:flex;overflow:hidden}.wgRail .wgSectionHeader{flex-direction:column;align-self:center;align-items:center;gap:12px;width:36px;height:auto;padding:0}.wgRail .wgIconButton{border-radius:50%;width:36px;height:36px}.wgRail .wgTreeBody{display:none}.wgAddError{color:var(--dsw-fg-1,inherit);white-space:pre-wrap;word-break:break-word;max-height:200px;font-size:12px;overflow-y:auto}.wgRenameInput{border:1px solid var(--dsw-border,#7f7f7f4d);background:var(--dsw-bg-1,transparent);width:100%;color:var(--dsw-fg-1,inherit);border-radius:6px;outline:none;padding:6px 8px;font-size:13px}.wgRenameInput:focus{border-color:var(--dsw-accent,#4a90d9)}";
		//#endregion
		//#region src/client/GroupsBrowser.tsx
		/**
		* The workspace-groups browsing region filling the sidebar shell's
		* `sidebar.workspaces` hole: section header (title + right-aligned search +
		* new-group + add workspace), the three-level tree (category → workspace →
		* session), group management dialogs, and the workspace/session dialogs. Wide
		* state renders the full browser; rail state renders the two region icons
		* (search / add workspace) as 36px controls on the shell's shared rail entry
		* path, each requesting expansion through the owner share.
		*
		* Data: workspaces/sessions via the framework global hooks; grouping config
		* via the host half's `/workspace-groups/config` route (refetched on mount).
		* Runtime group management (create/rename/delete any group, drag workspaces
		* between groups and into position, drag groups into position) persists
		* through `PUT /workspace-groups/manual`; the sidecar YAML is never rewritten
		* (rule-group rename/delete ride the overlay `renamed`/`hidden` maps).
		*/
		const SEARCH_DEBOUNCE_MS = 250;
		const SEARCH_QUERY_MAX_CODE_UNITS = 500;
		const EMPTY_MANUAL = {
			categories: [],
			assignments: {},
			categoryOrder: [],
			workspaceOrder: {},
			renamed: {},
			hidden: []
		};
		/** Materialize optional overlay fields so every update is a plain object edit. */
		function normalizeManual(manual) {
			return {
				categories: manual.categories,
				assignments: manual.assignments,
				categoryOrder: manual.categoryOrder ?? [],
				workspaceOrder: manual.workspaceOrder ?? {},
				renamed: manual.renamed ?? {},
				hidden: manual.hidden ?? []
			};
		}
		function sanitizeSearchQuery(value) {
			const withoutNul = value.replaceAll("\0", "");
			if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul;
			return withoutNul.slice(0, SEARCH_QUERY_MAX_CODE_UNITS);
		}
		/** Light runtime guard for the manual overlay attached to the config fetch. */
		function isManualGroups(value) {
			if (typeof value !== "object" || value === null) return false;
			const candidate = value;
			return Array.isArray(candidate.categories) && typeof candidate.assignments === "object" && candidate.assignments !== null;
		}
		/** Minimal fetch of the grouping config + runtime overlay (no-cache revalidation). */
		async function fetchGroupsConfig() {
			const response = await fetch("/workspace-groups/config", { cache: "no-cache" });
			if (!response.ok) throw new Error(`config request failed: ${response.status}`);
			const body = await response.json();
			return {
				config: Array.isArray(body.categories) ? body : { categories: [] },
				manual: isManualGroups(body.manual) ? normalizeManual(body.manual) : EMPTY_MANUAL
			};
		}
		/** Persist the whole runtime overlay (idempotent; the host validates + writes). */
		async function saveManualOverlay(manual) {
			const response = await fetch("/workspace-groups/manual", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(manual)
			});
			if (!response.ok) {
				let message = `manual save failed: ${response.status}`;
				try {
					const text = await response.text();
					if (text !== "") message = text;
				} catch {}
				throw new Error(message);
			}
		}
		/**
		* Render the browsing region.
		* @param props - composed slot props (shell owner share + store + injected actions).
		* @returns the region element tree.
		*/
		function GroupsBrowser({ wide, expandSidebar, useSessions, useSessionStatus, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, pickDirectory, searchSessions, searchResultLimit, t }) {
			(0, react.useEffect)(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "dsh-session-sorts");
				style.textContent = styles_css_default;
				document.head.append(style);
				return () => {
					style.remove();
				};
			}, []);
			const [config, setConfig] = (0, react.useState)({ categories: [] });
			const [manual, setManual] = (0, react.useState)(EMPTY_MANUAL);
			const [configError, setConfigError] = (0, react.useState)(null);
			const reloadConfig = () => {
				setConfigError(null);
				fetchGroupsConfig().then(({ config: nextConfig, manual: nextManual }) => {
					setConfig(nextConfig);
					setManual(nextManual);
				}).catch((reason) => {
					setConfigError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			(0, react.useEffect)(() => {
				reloadConfig();
			}, []);
			const [manualError, setManualError] = (0, react.useState)(null);
			const [manualSaving, setManualSaving] = (0, react.useState)(false);
			const workspaces = useWorkspaces((state) => state.items);
			const workspacePhase = useWorkspaces((state) => state.phase);
			const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
			const categoryExpansion = useStore((s) => s.categoryExpansion);
			const workspaceExpansion = useStore((s) => s.workspaceExpansion);
			const rawList = useSessions((s) => s);
			const statuses = useSessionStatus((s) => s);
			const list = (0, react.useMemo)(() => projectSessionList(rawList, statuses), [rawList, statuses]);
			const current = list.current;
			const currentWorkspaceKey = current === void 0 ? void 0 : workspaces.find((w) => w.sessionIds.includes(current))?.workspaceId;
			(0, react.useEffect)(() => {
				if (current === void 0 || currentWorkspaceKey === void 0) return;
				const category = categoriesForCurrent(config, workspaces, current, manual);
				if (category !== void 0 && !Object.hasOwn(categoryExpansion, category)) actions.setCategoryExpanded(category, true);
				if (!Object.hasOwn(workspaceExpansion, currentWorkspaceKey)) actions.setWorkspaceExpanded(currentWorkspaceKey, true);
			}, [
				current,
				currentWorkspaceKey,
				config,
				workspaces,
				manual,
				categoryExpansion,
				workspaceExpansion,
				actions
			]);
			(0, react.useEffect)(() => {
				if (workspacePhase !== "ready") return;
				actions.retainKeys(displayCategoryKeys(config, manual), workspaces.map((w) => w.workspaceId));
			}, [
				actions,
				config,
				manual,
				workspacePhase,
				workspaces
			]);
			const [query, setQuery] = (0, react.useState)("");
			const [searchExpanded, setSearchExpanded] = (0, react.useState)(false);
			const normalizedQuery = sanitizeSearchQuery(query).trim();
			const [remoteSearch, setRemoteSearch] = (0, react.useState)({
				query: "",
				status: "idle",
				items: [],
				hasMore: false
			});
			const searchInput = (0, react.useRef)(null);
			const searchRoot = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (normalizedQuery === "") {
					setRemoteSearch({
						query: "",
						status: "idle",
						items: [],
						hasMore: false
					});
					return;
				}
				const controller = new AbortController();
				setRemoteSearch({
					query: normalizedQuery,
					status: "loading",
					items: [],
					hasMore: false
				});
				const timer = window.setTimeout(() => {
					searchSessions(normalizedQuery, controller.signal).then((result) => {
						if (controller.signal.aborted) return;
						setRemoteSearch({
							query: normalizedQuery,
							status: "ready",
							items: result.items,
							hasMore: result.hasMore
						});
					}).catch(() => {
						if (controller.signal.aborted) return;
						setRemoteSearch({
							query: normalizedQuery,
							status: "error",
							items: [],
							hasMore: false
						});
					});
				}, SEARCH_DEBOUNCE_MS);
				return () => {
					window.clearTimeout(timer);
					controller.abort();
				};
			}, [normalizedQuery, searchSessions]);
			(0, react.useEffect)(() => {
				if (!wide || !searchExpanded) return;
				const onClick = (event) => {
					if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return;
					searchInput.current?.blur();
					if (normalizedQuery !== "") return;
					setSearchExpanded(false);
				};
				document.addEventListener("click", onClick);
				return () => {
					document.removeEventListener("click", onClick);
				};
			}, [
				normalizedQuery,
				wide,
				searchExpanded
			]);
			const expandedCategories = (0, react.useMemo)(() => Object.entries(categoryExpansion).filter(([, v]) => v).map(([k]) => k), [categoryExpansion]);
			const expandedWorkspaces = (0, react.useMemo)(() => Object.entries(workspaceExpansion).filter(([, v]) => v).map(([k]) => k), [workspaceExpansion]);
			const [dragging, setDragging] = (0, react.useState)(null);
			const groups = (0, react.useMemo)(() => deriveGroups(list, workspaces, archivedSessionIds, config, {
				expandedCategories,
				expandedWorkspaces
			}, manual), [
				list,
				workspaces,
				archivedSessionIds,
				config,
				manual,
				expandedCategories,
				expandedWorkspaces
			]);
			const topLevel = (0, react.useMemo)(() => deriveTopLevel(list, workspaces, archivedSessionIds, config, {
				expandedCategories,
				expandedWorkspaces
			}, manual), [
				list,
				workspaces,
				archivedSessionIds,
				config,
				manual,
				expandedCategories,
				expandedWorkspaces
			]);
			const topLevelDropActive = dragging === "workspace" && topLevel.length === 0;
			const topLevelRef = {
				kind: "topLevel",
				key: UNCATEGORIZED_KEY
			};
			const [adding, setAdding] = (0, react.useState)(false);
			const [addError, setAddError] = (0, react.useState)(null);
			const [addErrorOpen, setAddErrorOpen] = (0, react.useState)(false);
			const addWorkspace = async () => {
				if (adding) return;
				setAdding(true);
				setAddError(null);
				setAddErrorOpen(false);
				try {
					const path = await pickDirectory();
					if (path === null) return;
					startSession((await createWorkspace({ path })).workspaceId);
				} catch (reason) {
					const message = reason instanceof Error ? reason.message : String(reason);
					setAddError(message);
					setAddErrorOpen(true);
				} finally {
					setAdding(false);
				}
			};
			const [renameTarget, setRenameTarget] = (0, react.useState)(null);
			const [renameDraft, setRenameDraft] = (0, react.useState)("");
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [renameError, setRenameError] = (0, react.useState)(null);
			const renameTrimmed = renameDraft.trim();
			const renameDuplicate = renameTarget !== null && renameTrimmed !== "" && renameTrimmed !== renameTarget.currentTitle && workspaces.some((w) => w.title === renameTrimmed);
			const renameBlocked = renaming || renameTrimmed === "" || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate;
			const confirmRename = () => {
				if (renameBlocked || renameTarget === null) return;
				setRenaming(true);
				setRenameError(null);
				renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
					setRenaming(false);
					setRenameTarget(null);
				}).catch((reason) => {
					setRenaming(false);
					setRenameError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const [deleteTarget, setDeleteTarget] = (0, react.useState)(null);
			const [deleting, setDeleting] = (0, react.useState)(false);
			const [deleteError, setDeleteError] = (0, react.useState)(null);
			const confirmDelete = () => {
				if (deleting || deleteTarget === null) return;
				setDeleting(true);
				setDeleteError(null);
				deleteWorkspace(deleteTarget.workspaceId).then(() => {
					setDeleting(false);
					setDeleteTarget(null);
				}).catch((reason) => {
					setDeleting(false);
					setDeleteError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const [sessionRenameTarget, setSessionRenameTarget] = (0, react.useState)(null);
			const [sessionRenameDraft, setSessionRenameDraft] = (0, react.useState)("");
			const [sessionRenaming, setSessionRenaming] = (0, react.useState)(false);
			const [sessionRenameError, setSessionRenameError] = (0, react.useState)(null);
			const sessionRenameTrimmed = sessionRenameDraft.trim();
			const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === "" || sessionRenameTarget === null;
			const confirmSessionRename = () => {
				if (sessionRenameBlocked || sessionRenameTarget === null) return;
				setSessionRenaming(true);
				setSessionRenameError(null);
				renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
					setSessionRenaming(false);
					setSessionRenameTarget(null);
				}).catch((reason) => {
					setSessionRenaming(false);
					setSessionRenameError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const onSessionRename = (sessionId, currentTitle) => {
				setSessionRenameTarget({
					sessionId,
					currentTitle
				});
				setSessionRenameDraft(currentTitle);
				setSessionRenameError(null);
			};
			const onSessionArchive = (sessionId) => {
				archiveSession(sessionId).catch((reason) => {
					console.warn("session archive rejected:", reason);
				});
			};
			const [groupDialog, setGroupDialog] = (0, react.useState)(null);
			const [groupDraft, setGroupDraft] = (0, react.useState)("");
			const [groupError, setGroupError] = (0, react.useState)(null);
			const [groupBusy, setGroupBusy] = (0, react.useState)(false);
			const [groupDeleteTarget, setGroupDeleteTarget] = (0, react.useState)(null);
			const [groupDeleting, setGroupDeleting] = (0, react.useState)(false);
			const [groupDeleteError, setGroupDeleteError] = (0, react.useState)(null);
			const takenNames = (0, react.useMemo)(() => takenCategoryNames(config, manual), [config, manual]);
			const groupTrimmed = groupDraft.trim();
			const groupNameIssue = groupDialog !== null && groupTrimmed !== "" ? groupTrimmed === "未分类" ? t("group.nameReserved") : groupDialog.mode === "rename" && groupTrimmed === groupDialog.from ? null : takenNames.has(groupTrimmed) ? t("group.nameDuplicate") : null : null;
			const groupBlocked = groupBusy || groupTrimmed === "" || groupNameIssue !== null || groupDialog !== null && groupDialog.mode === "rename" && groupTrimmed === groupDialog.from;
			const confirmGroupDialog = () => {
				if (groupBlocked || groupDialog === null) return;
				const name = groupTrimmed;
				const from = groupDialog.mode === "rename" ? groupDialog.from : void 0;
				const renaming = groupDialog.mode === "rename" && from !== name;
				let next;
				if (groupDialog.mode === "create") next = {
					...manual,
					categories: [...manual.categories, name]
				};
				else {
					const originalRule = from !== void 0 ? originalRuleNameForDisplay(config.categories, manual, from) : void 0;
					next = {
						...manual,
						...originalRule !== void 0 ? { renamed: {
							...manual.renamed,
							[originalRule]: name
						} } : { categories: manual.categories.map((c) => c === from ? name : c) },
						assignments: Object.fromEntries(Object.entries(manual.assignments).map(([id, category]) => [id, category === from ? name : category])),
						workspaceOrder: Object.fromEntries(Object.entries(manual.workspaceOrder).map(([key, ids]) => [key === from ? name : key, ids])),
						categoryOrder: manual.categoryOrder.map((key) => key === from ? name : key)
					};
				}
				setGroupBusy(true);
				setGroupError(null);
				saveManualOverlay(next).then(() => {
					setManual(next);
					setManualError(null);
					setGroupBusy(false);
					setGroupDialog(null);
					setGroupDraft("");
					if (renaming) actions.setCategoryExpanded(name, true);
				}).catch((reason) => {
					setGroupBusy(false);
					setGroupError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const confirmGroupDelete = () => {
				if (groupDeleting || groupDeleteTarget === null) return;
				const name = groupDeleteTarget;
				const originalRule = originalRuleNameForDisplay(config.categories, manual, name);
				const assignments = { ...manual.assignments };
				for (const workspace of workspaces) if (resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title) === name) assignments[workspace.workspaceId] = null;
				const workspaceOrder = Object.fromEntries(Object.entries(manual.workspaceOrder).filter(([key]) => key !== name));
				const next = {
					...manual,
					assignments,
					workspaceOrder,
					categoryOrder: manual.categoryOrder.filter((key) => key !== name),
					...originalRule !== void 0 ? {
						renamed: Object.fromEntries(Object.entries(manual.renamed).filter(([key]) => key !== originalRule)),
						hidden: [...manual.hidden, originalRule]
					} : { categories: manual.categories.filter((c) => c !== name) }
				};
				setGroupDeleting(true);
				setGroupDeleteError(null);
				saveManualOverlay(next).then(() => {
					setManual(next);
					setManualError(null);
					setGroupDeleting(false);
					setGroupDeleteTarget(null);
				}).catch((reason) => {
					setGroupDeleting(false);
					setGroupDeleteError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const [dragIndicator, setDragIndicator] = (0, react.useState)(null);
			const expansionSnapshot = (0, react.useRef)(null);
			const liveExpansionRef = (0, react.useRef)({
				categoryExpansion,
				workspaceExpansion,
				actions
			});
			liveExpansionRef.current = {
				categoryExpansion,
				workspaceExpansion,
				actions
			};
			(0, react.useEffect)(() => {
				const clear = () => {
					setDragIndicator(null);
					setDragging(null);
					const snapshot = expansionSnapshot.current;
					if (snapshot === null) return;
					expansionSnapshot.current = null;
					const { categoryExpansion: currentCategories, workspaceExpansion: currentWorkspaces, actions: currentActions } = liveExpansionRef.current;
					for (const [key, value] of Object.entries(snapshot.categories)) if (currentCategories[key] !== value) currentActions.setCategoryExpanded(key, value);
					for (const [key, value] of Object.entries(snapshot.workspaces)) if (currentWorkspaces[key] !== value) currentActions.setWorkspaceExpanded(key, value);
				};
				document.addEventListener("dragend", clear);
				return () => {
					document.removeEventListener("dragend", clear);
				};
			}, []);
			/** Move a workspace into a category (or reorder inside it when `beforeWorkspaceId`/`afterWorkspaceId`). */
			const moveWorkspaceTo = async (workspaceId, categoryKey, beforeWorkspaceId, afterWorkspaceId) => {
				if (manualSaving) return;
				const workspace = workspaces.find((w) => w.workspaceId === workspaceId);
				if (workspace === void 0) return;
				setManualSaving(true);
				try {
					let next;
					if (categoryKey === UNCATEGORIZED_KEY) {
						const assignments = {
							...manual.assignments,
							[workspaceId]: null
						};
						const workspaceOrder = {};
						for (const [key, ids] of Object.entries(manual.workspaceOrder)) {
							if (key === "__topLevel__") continue;
							workspaceOrder[key] = ids.filter((id) => id !== workspaceId);
						}
						const topLevelIds = workspaces.filter((w) => w.workspaceId !== workspaceId && resolveCategory(config, manual, w.workspaceId, w.path, w.title) === void 0).map((w) => w.workspaceId);
						workspaceOrder[TOP_LEVEL_ORDER_KEY] = afterWorkspaceId !== void 0 ? moveAfter(topLevelIds, workspaceId, afterWorkspaceId) : moveBefore(topLevelIds, workspaceId, beforeWorkspaceId);
						next = {
							...manual,
							assignments,
							workspaceOrder
						};
					} else {
						const currentKey = resolveCategory(config, manual, workspaceId, workspace.path, workspace.title);
						const movingAcross = currentKey !== categoryKey;
						const assignments = movingAcross ? {
							...manual.assignments,
							[workspaceId]: categoryKey
						} : manual.assignments;
						const targetOrder = afterWorkspaceId !== void 0 ? moveAfter(manual.workspaceOrder[categoryKey] ?? [], workspaceId, afterWorkspaceId) : moveBefore(manual.workspaceOrder[categoryKey] ?? [], workspaceId, beforeWorkspaceId);
						const workspaceOrder = {
							...manual.workspaceOrder,
							[categoryKey]: targetOrder
						};
						if (movingAcross && currentKey !== void 0 && workspaceOrder[currentKey] !== void 0) workspaceOrder[currentKey] = workspaceOrder[currentKey].filter((id) => id !== workspaceId);
						next = {
							...manual,
							assignments,
							workspaceOrder
						};
					}
					await saveManualOverlay(next);
					setManual(next);
					setManualError(null);
					if (categoryKey !== UNCATEGORIZED_KEY) actions.setCategoryExpanded(categoryKey, true);
				} catch (reason) {
					setManualError(reason instanceof Error ? reason.message : String(reason));
				} finally {
					setManualSaving(false);
				}
			};
			/** Reorder groups: move `draggedKey` before `beforeKey` or after `afterKey` (未分类 target = append). */
			const moveCategory = async (draggedKey, beforeKey, afterKey) => {
				if (manualSaving || draggedKey === beforeKey || draggedKey === afterKey) return;
				setManualSaving(true);
				try {
					const order = displayCategoryKeys(config, manual);
					const categoryOrder = afterKey !== void 0 ? moveAfter(order, draggedKey, afterKey) : moveBefore(order, draggedKey, beforeKey);
					const next = {
						...manual,
						categoryOrder
					};
					await saveManualOverlay(next);
					setManual(next);
					setManualError(null);
				} catch (reason) {
					setManualError(reason instanceof Error ? reason.message : String(reason));
				} finally {
					setManualSaving(false);
				}
			};
			/**
			* Drop on a row. The insertion point is re-derived from the drop event's
			* position (top half = before, bottom half = after), so it always matches
			* the indicator the user last saw — even when dragover and drop arrive in
			* the same tick.
			*/
			const onDropRow = (categoryKey, row) => (event) => {
				event.preventDefault();
				event.stopPropagation();
				setDragIndicator(null);
				setDragging(null);
				const draggedCategory = event.dataTransfer.getData(DND_CATEGORY_TYPE);
				if (draggedCategory !== "") {
					const rect = event.currentTarget.getBoundingClientRect();
					const before = event.clientY < rect.top + rect.height / 2;
					const beforeKey = row.kind === "category" && before ? row.key : void 0;
					const afterKey = row.kind === "category" && !before ? row.key : void 0;
					moveCategory(draggedCategory, beforeKey, afterKey);
					return;
				}
				const workspaceId = event.dataTransfer.getData("application/x-dsh-workspace-groups") || event.dataTransfer.getData("text/plain");
				if (workspaceId === "") return;
				if (row.kind === "topLevel") {
					const rect = event.currentTarget.getBoundingClientRect();
					const before = event.clientY < rect.top + rect.height / 2;
					const specificKey = row.key === UNCATEGORIZED_KEY ? void 0 : row.key;
					moveWorkspaceTo(workspaceId, UNCATEGORIZED_KEY, before ? specificKey : void 0, !before ? specificKey : void 0);
					return;
				}
				const rect = event.currentTarget.getBoundingClientRect();
				const before = event.clientY < rect.top + rect.height / 2;
				const beforeWsid = row.kind === "workspace" && before ? row.key : void 0;
				const afterWsid = row.kind === "workspace" && !before ? row.key : void 0;
				moveWorkspaceTo(workspaceId, categoryKey, beforeWsid, afterWsid);
			};
			const onDragOverRow = (row) => (event) => {
				if (!hasPluginDragType(event.dataTransfer.types)) return;
				const draggingCategory = Array.from(event.dataTransfer.types).includes(DND_CATEGORY_TYPE);
				if (draggingCategory && row.kind !== "category") return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = "move";
				const rect = event.currentTarget.getBoundingClientRect();
				const before = event.clientY < rect.top + rect.height / 2;
				if (draggingCategory || row.kind === "workspace" || row.kind === "topLevel") setDragIndicator((prev) => prev?.mode === "line" && prev.row.kind === row.kind && prev.row.key === row.key && prev.before === before ? prev : {
					mode: "line",
					row,
					before
				});
				else setDragIndicator((prev) => prev?.mode === "into" && prev.categoryKey === row.key ? prev : {
					mode: "into",
					categoryKey: row.key
				});
			};
			const onDragLeaveRow = (event) => {
				if (event.currentTarget.contains(event.relatedTarget)) return;
				setDragIndicator(null);
			};
			/**
			* Drag over the TOP-LEVEL AREA's blank space (not on a row — rows stop
			* propagation). An insertion line shows the landing spot: empty top level →
			* a standalone line under the last group; non-empty → a line below the last
			* top-level row (end of the list).
			*/
			const onDragOverTopLevelArea = (event) => {
				if (!hasPluginDragType(event.dataTransfer.types)) return;
				if (Array.from(event.dataTransfer.types).includes("application/x-dsh-workspace-groups-category")) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				const last = topLevel.length > 0 ? topLevel[topLevel.length - 1] : void 0;
				if (last !== void 0) setDragIndicator((prev) => prev?.mode === "line" && prev.row.kind === "topLevel" && prev.row.key === last.workspaceId && prev.before === false ? prev : {
					mode: "line",
					row: {
						kind: "topLevel",
						key: last.workspaceId
					},
					before: false
				});
				else setDragIndicator((prev) => prev?.mode === "line" && prev.row.kind === "topLevel" && prev.row.key === topLevelRef.key && prev.before === false ? prev : {
					mode: "line",
					row: topLevelRef,
					before: false
				});
			};
			const onDragStartWorkspace = (_workspaceId) => () => {
				setDragging("workspace");
				expansionSnapshot.current = {
					categories: { ...categoryExpansion },
					workspaces: { ...workspaceExpansion }
				};
				for (const key of Object.keys(workspaceExpansion)) if (workspaceExpansion[key]) actions.setWorkspaceExpanded(key, false);
			};
			const onDragStartCategory = (categoryKey) => (event) => {
				event.dataTransfer.setData(DND_CATEGORY_TYPE, categoryKey);
				event.dataTransfer.effectAllowed = "move";
				setDragging("category");
				expansionSnapshot.current = {
					categories: { ...categoryExpansion },
					workspaces: { ...workspaceExpansion }
				};
				for (const key of Object.keys(categoryExpansion)) if (categoryExpansion[key]) actions.setCategoryExpanded(key, false);
			};
			const now = Date.now();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `wgRoot${wide ? "" : " wgRail"}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wgSectionHeader",
						children: [
							wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wgSectionLabel",
								children: t("section.workspaces")
							}),
							wide && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `wgSearch${searchExpanded ? " wgSearchExpanded" : ""}`,
								ref: searchRoot,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wgIconButton",
										"aria-label": t("search"),
										onClick: () => {
											setSearchExpanded(true);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, { size: searchExpanded ? 11 : 14 })
									}),
									searchExpanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										ref: searchInput,
										className: "wgSearchInput",
										type: "text",
										placeholder: t("search.placeholder"),
										maxLength: SEARCH_QUERY_MAX_CODE_UNITS,
										value: query,
										autoFocus: true,
										onChange: (e) => {
											setQuery(sanitizeSearchQuery(e.target.value));
										},
										onKeyDown: (e) => {
											if (e.key !== "Escape") return;
											setQuery("");
											setSearchExpanded(false);
										}
									}),
									searchExpanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wgIconButton",
										"aria-label": t("search.clear"),
										onClick: (e) => {
											e.stopPropagation();
											setQuery("");
											setSearchExpanded(false);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseFillRegular, { size: 14 })
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: t("group.create"),
								side: "bottom",
								delayMs: 500,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wgIconButton",
									"aria-label": t("group.create"),
									onClick: () => {
										setGroupDraft("");
										setGroupError(null);
										setGroupDialog({ mode: "create" });
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutlineRegular, { size: wide ? 16 : 18 })
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: t("workspace.add"),
								side: "bottom",
								delayMs: 500,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wgIconButton",
									"aria-label": t("workspace.add"),
									disabled: adding,
									onClick: addWorkspace,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutlineRegular, { size: wide ? 16 : 18 })
								})
							})
						]
					}),
					!wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wgSectionHeader",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t("search"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wgIconButton",
								"aria-label": t("search"),
								onClick: () => {
									setSearchExpanded(true);
									expandSidebar();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, { size: 18 })
							})
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wgTreeBody",
						children: [
							configError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wgSearchStatus",
								role: "status",
								children: t("configUnavailable")
							}),
							manualError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wgSearchStatus wgManualError",
								role: "alert",
								children: [
									t("manual.saveError"),
									": ",
									manualError
								]
							}),
							wide && normalizedQuery !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchBody, {
								list,
								workspaces,
								config,
								archivedSessionIds,
								query: normalizedQuery,
								remote: remoteSearch,
								resultLimit: searchResultLimit,
								current,
								now,
								open,
								manual,
								t
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wgList",
								role: "tree",
								"aria-label": t("section.workspaces"),
								children: [
									groups.length === 0 && topLevel.length === 0 && !topLevelDropActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wgEmpty",
										children: workspacePhase === "ready" ? t("empty.noWorkspaces") : t("empty.none")
									}),
									groups.map((category) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CategorySection, {
										category,
										current,
										now,
										t,
										dragIndicator,
										onDragOverRow,
										onDragLeaveRow,
										onDropRow,
										onDragStartCategory: onDragStartCategory(category.key),
										onDragStartWorkspace,
										onToggleCategory: () => {
											actions.setCategoryExpanded(category.key, !category.expanded);
										},
										onToggleWorkspace: (key) => {
											actions.setWorkspaceExpanded(key, !workspaceExpansion[key]);
										},
										onNewSession: startSession,
										onOpen: open,
										onRenameRequest: (workspaceId, title) => {
											setRenameTarget({
												workspaceId,
												currentTitle: title
											});
											setRenameDraft(title);
											setRenameError(null);
										},
										onDeleteRequest: (workspaceId, title) => {
											setDeleteTarget({
												workspaceId,
												title
											});
											setDeleteError(null);
										},
										onSessionRename,
										onSessionArchive,
										onFork: forkSession,
										onGroupRename: () => {
											setGroupDraft(category.key);
											setGroupError(null);
											setGroupDialog({
												mode: "rename",
												from: category.key
											});
										},
										onGroupDelete: () => {
											setGroupDeleteTarget(category.key);
											setGroupDeleteError(null);
										},
										onMoveOut: (workspaceId) => {
											moveWorkspaceTo(workspaceId, UNCATEGORIZED_KEY);
										},
										canMoveOut: (workspaceId) => {
											const workspace = workspaces.find((w) => w.workspaceId === workspaceId);
											return workspace !== void 0 && resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title) !== void 0;
										}
									}, category.key)),
									(topLevel.length > 0 || topLevelDropActive) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TopLevelSection, {
										topLevel,
										current,
										now,
										t,
										dragging: dragging === "workspace",
										dragIndicator,
										topLevelRef,
										onDragOverRow,
										onDragOverTopLevelArea,
										onDragLeaveRow,
										onDropRow,
										onDragStartWorkspace,
										onToggleWorkspace: (key) => {
											actions.setWorkspaceExpanded(key, !workspaceExpansion[key]);
										},
										onNewSession: startSession,
										onOpen: open,
										onRenameRequest: (workspaceId, title) => {
											setRenameTarget({
												workspaceId,
												currentTitle: title
											});
											setRenameDraft(title);
											setRenameError(null);
										},
										onDeleteRequest: (workspaceId, title) => {
											setDeleteTarget({
												workspaceId,
												title
											});
											setDeleteError(null);
										},
										onSessionRename,
										onSessionArchive,
										onFork: forkSession
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: groupDialog !== null,
						onClose: () => {
							setGroupDialog(null);
						},
						closeLabel: t("close"),
						title: groupDialog?.mode === "rename" ? t("group.renameTitle") : t("group.createTitle"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								setGroupDialog(null);
							},
							children: t("group.createCancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: groupBlocked,
							onClick: confirmGroupDialog,
							children: groupDialog?.mode === "rename" ? t("group.renameConfirm") : t("group.createConfirm")
						})] }),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "wgRenameInput",
								value: groupDraft,
								"aria-label": t("group.createPlaceholder"),
								placeholder: t("group.createPlaceholder"),
								autoFocus: true,
								onChange: (e) => {
									setGroupDraft(e.target.value);
									setGroupError(null);
								},
								onKeyDown: (e) => {
									if (e.key === "Enter") confirmGroupDialog();
								}
							}),
							groupNameIssue !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wgAddError",
								role: "alert",
								children: groupNameIssue
							}),
							groupError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wgAddError",
								role: "alert",
								children: groupError
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: groupDeleteTarget !== null,
						onClose: () => {
							setGroupDeleteTarget(null);
						},
						closeLabel: t("close"),
						title: t("group.deleteTitle"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								setGroupDeleteTarget(null);
							},
							children: t("group.deleteCancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: groupDeleting,
							onClick: confirmGroupDelete,
							children: t("group.delete")
						})] }),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wgAddError",
							children: t("group.deleteConfirm")
						}), groupDeleteError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wgAddError",
							role: "alert",
							children: groupDeleteError
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: renameTarget !== null,
						onClose: () => {
							setRenameTarget(null);
						},
						closeLabel: t("close"),
						title: t("workspace.renameTitle"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								setRenameTarget(null);
							},
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: renameBlocked,
							onClick: confirmRename,
							children: t("workspace.renameConfirm")
						})] }),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "wgRenameInput",
							value: renameDraft,
							"aria-label": t("workspace.renamePlaceholder"),
							autoFocus: true,
							onChange: (e) => {
								setRenameDraft(e.target.value);
							},
							onKeyDown: (e) => {
								if (e.key === "Enter") confirmRename();
							}
						}), renameError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wgAddError",
							role: "alert",
							children: renameError
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: deleteTarget !== null,
						onClose: () => {
							setDeleteTarget(null);
						},
						closeLabel: t("close"),
						title: t("workspace.deleteTitle"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								setDeleteTarget(null);
							},
							children: t("workspace.deleteCancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: deleting,
							onClick: confirmDelete,
							children: t("workspace.delete")
						})] }),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wgAddError",
							children: t("workspace.deleteConfirm")
						}), deleteError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wgAddError",
							role: "alert",
							children: deleteError
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: sessionRenameTarget !== null,
						onClose: () => {
							setSessionRenameTarget(null);
						},
						closeLabel: t("close"),
						title: t("session.renameTitle"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								setSessionRenameTarget(null);
							},
							children: t("session.renameCancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: sessionRenameBlocked,
							onClick: confirmSessionRename,
							children: t("session.renameConfirm")
						})] }),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "wgRenameInput",
							value: sessionRenameDraft,
							"aria-label": t("session.renamePlaceholder"),
							autoFocus: true,
							onChange: (e) => {
								setSessionRenameDraft(e.target.value);
							},
							onKeyDown: (e) => {
								if (e.key === "Enter") confirmSessionRename();
							}
						}), sessionRenameError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wgAddError",
							role: "alert",
							children: sessionRenameError
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: addErrorOpen,
						onClose: () => {
							setAddErrorOpen(false);
						},
						closeLabel: t("close"),
						title: t("workspace.addErrorTitle"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								setAddErrorOpen(false);
							},
							children: t("close")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							onClick: addWorkspace,
							children: t("retry")
						})] }),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wgAddError",
							role: "alert",
							children: addError
						})
					})
				]
			});
		}
		/** Resolve the category label containing the current session (auto-expand helper). */
		function categoriesForCurrent(config, workspaces, current, manual) {
			const workspace = workspaces.find((w) => w.sessionIds.includes(current));
			if (workspace === void 0) return void 0;
			return resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title);
		}
		/** One category section: header row + expanded workspace folders. */
		function CategorySection({ category, current, now, t, dragIndicator, onDragOverRow, onDragLeaveRow, onDropRow, onDragStartCategory, onDragStartWorkspace, onToggleCategory, onToggleWorkspace, onNewSession, onOpen, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, onFork, onGroupRename, onGroupDelete, onMoveOut, canMoveOut }) {
			const categoryLine = dragIndicator?.mode === "line" && dragIndicator.row.kind === "category" && dragIndicator.row.key === category.key ? dragIndicator.before ? "before" : "after" : void 0;
			const categoryInto = dragIndicator?.mode === "into" && dragIndicator.categoryKey === category.key;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "group",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CategoryRow, {
					node: category,
					t,
					onToggle: onToggleCategory,
					onRename: onGroupRename,
					onDelete: onGroupDelete,
					onDragStartCategory,
					dropActive: categoryInto,
					...categoryLine !== void 0 ? { insertLine: categoryLine } : {},
					onRowDragOver: onDragOverRow({
						kind: "category",
						key: category.key
					}),
					onRowDragLeave: onDragLeaveRow,
					onRowDrop: onDropRow(category.key, {
						kind: "category",
						key: category.key
					})
				}), category.expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					role: "group",
					children: category.workspaces.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceRow, {
							node: workspace,
							t,
							onToggle: () => {
								onToggleWorkspace(workspace.workspaceId);
							},
							onNewSession: () => {
								onNewSession(workspace.workspaceId);
							},
							onRename: () => {
								onRenameRequest(workspace.workspaceId, workspace.label);
							},
							onDelete: () => {
								onDeleteRequest(workspace.workspaceId, workspace.label);
							},
							canMoveOut: canMoveOut(workspace.workspaceId),
							onMoveOut: () => {
								onMoveOut(workspace.workspaceId);
							},
							dropActive: false,
							...dragIndicator?.mode === "line" && dragIndicator.row.kind === "workspace" && dragIndicator.row.key === workspace.workspaceId ? { insertLine: dragIndicator.before ? "before" : "after" } : {},
							onRowDragOver: onDragOverRow({
								kind: "workspace",
								key: workspace.workspaceId
							}),
							onRowDragLeave: onDragLeaveRow,
							onRowDrop: onDropRow(category.key, {
								kind: "workspace",
								key: workspace.workspaceId
							}),
							onDragStartExtra: onDragStartWorkspace(workspace.workspaceId)
						}), workspace.expanded && workspace.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionRow, {
							node: session,
							currentId: current,
							now,
							t,
							onOpen,
							onRename: onSessionRename,
							onFork,
							onArchive: onSessionArchive
						}, session.id))]
					}, workspace.workspaceId))
				})]
			});
		}
		/**
		* Top-level (ungrouped) workspace rows rendered after the group folders. While
		* a project drag is in progress the WHOLE top-level area is the move-out
		* landing spot, shown with an insertion LINE (not a highlight box):
		* - a top-level row reorders before/after it (line above/below, like a group);
		* - the blank space below the last row appends to the end (line below the
		*   last row);
		* - an empty top level shows a standalone line under the last group folder.
		*/
		function TopLevelSection({ topLevel, current, now, t, dragging, dragIndicator, topLevelRef, onDragOverRow, onDragOverTopLevelArea, onDragLeaveRow, onDropRow, onDragStartWorkspace, onToggleWorkspace, onNewSession, onOpen, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, onFork }) {
			const emptyLineActive = dragIndicator?.mode === "line" && dragIndicator.row.kind === "topLevel" && dragIndicator.row.key === topLevelRef.key;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "group",
				"aria-label": t("section.topLevel"),
				className: "wgTopLevelArea",
				onDragOver: onDragOverTopLevelArea,
				onDragLeave: onDragLeaveRow,
				onDrop: onDropRow(UNCATEGORIZED_KEY, topLevelRef),
				children: [topLevel.length === 0 && dragging && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: `wgTopLevelEmpty${emptyLineActive ? " wgTopLevelEmptyActive" : ""}`,
					role: "treeitem",
					onDragOver: onDragOverRow(topLevelRef),
					onDragLeave: onDragLeaveRow,
					onDrop: onDropRow(UNCATEGORIZED_KEY, topLevelRef),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wgTopLevelEmptyLine" })
				}), topLevel.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "group",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceRow, {
						node: workspace,
						t,
						flat: true,
						onToggle: () => {
							onToggleWorkspace(workspace.workspaceId);
						},
						onNewSession: () => {
							onNewSession(workspace.workspaceId);
						},
						onRename: () => {
							onRenameRequest(workspace.workspaceId, workspace.label);
						},
						onDelete: () => {
							onDeleteRequest(workspace.workspaceId, workspace.label);
						},
						...dragIndicator?.mode === "line" && dragIndicator.row.kind === "topLevel" && dragIndicator.row.key === workspace.workspaceId ? { insertLine: dragIndicator.before ? "before" : "after" } : {},
						onRowDragOver: onDragOverRow({
							kind: "topLevel",
							key: workspace.workspaceId
						}),
						onRowDragLeave: onDragLeaveRow,
						onRowDrop: onDropRow(UNCATEGORIZED_KEY, {
							kind: "topLevel",
							key: workspace.workspaceId
						}),
						onDragStartExtra: onDragStartWorkspace(workspace.workspaceId)
					}), workspace.expanded && workspace.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionRow, {
						node: session,
						currentId: current,
						now,
						t,
						onOpen,
						onRename: onSessionRename,
						onFork,
						onArchive: onSessionArchive
					}, session.id))]
				}, workspace.workspaceId))]
			});
		}
		/**
		* Search body rendered as a three-level tree pruned to matched branches:
		* 分类文件夹 → 项目文件夹 → 命中会话行. Reuses the same row components as
		* the idle tree, so search keeps the same folder hierarchy the user is used to.
		*/
		function SearchBody({ list, workspaces, config, archivedSessionIds, query, remote, resultLimit, current, now, open, manual, t }) {
			const currentRemote = remote.query === query ? remote : {
				query,
				status: "loading",
				items: [],
				hasMore: false
			};
			const matches = (0, react.useMemo)(() => deriveSearchMatches(list, workspaces, config, query, archivedSessionIds, currentRemote, resultLimit), [
				list,
				workspaces,
				config,
				query,
				archivedSessionIds,
				currentRemote,
				resultLimit
			]);
			const searchTree = (0, react.useMemo)(() => deriveSearchGroups(list, workspaces, config, matches.matchedIds, archivedSessionIds, manual, matches.snippetsBySession), [
				list,
				workspaces,
				config,
				matches,
				archivedSessionIds,
				manual
			]);
			const groups = searchTree.categories;
			const searchTopLevel = searchTree.topLevel;
			const pending = currentRemote.status === "loading";
			const failed = currentRemote.status === "error";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wgList",
				role: "tree",
				"aria-label": t("search.results.aria"),
				children: [
					groups.map((category) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CategoryRow, {
							node: category,
							t,
							onToggle: () => {}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							role: "group",
							children: category.workspaces.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								role: "group",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceRow, {
									node: workspace,
									t,
									onToggle: () => {},
									onNewSession: () => {},
									onRename: () => {},
									onDelete: () => {}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									role: "group",
									children: workspace.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionRow, {
										node: session,
										currentId: current,
										now,
										t,
										onOpen: open,
										onRename: () => {},
										onFork: () => {},
										onArchive: () => {}
									}, session.id))
								})]
							}, workspace.workspaceId))
						})]
					}, category.key)),
					searchTopLevel.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceRow, {
							node: workspace,
							t,
							flat: true,
							onToggle: () => {},
							onNewSession: () => {},
							onRename: () => {},
							onDelete: () => {}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							role: "group",
							children: workspace.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionRow, {
								node: session,
								currentId: current,
								now,
								t,
								onOpen: open,
								onRename: () => {},
								onFork: () => {},
								onArchive: () => {}
							}, session.id))
						})]
					}, workspace.workspaceId)),
					pending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wgSearchStatus",
						role: "status",
						children: t("search.pending")
					}),
					failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wgSearchStatus",
						role: "status",
						children: t("search.unavailable")
					}),
					!pending && groups.length === 0 && searchTopLevel.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wgEmpty",
						children: t("search.noMatches")
					}),
					matches.hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wgSearchStatus",
						children: t("search.hasMore")
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Simplified Chinese dictionary. */
		const zh = {
			"section.workspaces": "工作区",
			"section.sessions": "会话",
			search: "搜索",
			"search.placeholder": "搜索会话…",
			"search.clear": "清除",
			"search.noMatches": "没有匹配的会话",
			"search.unavailable": "搜索不可用",
			"search.pending": "搜索中…",
			"search.hasMore": "结果过多，请细化关键词",
			"search.results.aria": "搜索结果",
			"workspace.add": "添加工作区",
			"workspace.addBusy": "正在添加…",
			"workspace.addError": "添加失败",
			"workspace.addErrorTitle": "无法添加工作区",
			"workspace.rename": "重命名",
			"workspace.delete": "删除",
			"workspace.deleteTitle": "删除工作区",
			"workspace.deleteConfirm": "仅删除注册信息，目录与会话日志保留。确定删除？",
			"workspace.deleteCancel": "取消删除",
			"workspace.renaming": "重命名中…",
			"workspace.deleting": "删除中…",
			"workspace.renameTitle": "重命名工作区",
			"workspace.renamePlaceholder": "工作区名称",
			"workspace.renameConfirm": "重命名",
			"workspace.renameCancel": "取消",
			"workspace.moveOutOfGroup": "移出分组",
			"group.create": "新建分组",
			"group.createTitle": "新建分组",
			"group.createPlaceholder": "分组名称",
			"group.createConfirm": "创建",
			"group.createCancel": "取消",
			"group.rename": "重命名分组",
			"group.renameTitle": "重命名分组",
			"group.renameConfirm": "重命名",
			"group.delete": "删除分组",
			"group.deleteTitle": "删除分组",
			"group.deleteConfirm": "删除后，该分组内的所有项目将移到顶层（不归组）。确定删除？",
			"group.deleteCancel": "取消删除",
			"group.nameDuplicate": "已存在同名分组",
			"group.nameReserved": "该名称不可用",
			"section.topLevel": "顶层项目",
			"manual.saveError": "分组变更保存失败",
			"session.new": "新建会话",
			"session.rename": "重命名会话",
			"session.archive": "归档",
			"session.fork": "派生",
			"session.renameTitle": "重命名会话",
			"session.renamePlaceholder": "会话名称",
			"session.renameConfirm": "重命名",
			"session.renameCancel": "取消",
			"session.renaming": "重命名中…",
			uncategorized: "未分类",
			"empty.none": "暂无内容",
			"empty.noWorkspaces": "还没有工作区",
			close: "关闭",
			cancel: "取消",
			confirm: "确定",
			retry: "重试",
			configUnavailable: "分组配置不可用",
			collapse: "折叠",
			expandMore: "展开全部",
			newSession: "新建会话"
		};
		/** English dictionary. */
		const en = {
			"section.workspaces": "Workspaces",
			"section.sessions": "Sessions",
			search: "Search",
			"search.placeholder": "Search sessions…",
			"search.clear": "Clear",
			"search.noMatches": "No matching sessions",
			"search.unavailable": "Search unavailable",
			"search.pending": "Searching…",
			"search.hasMore": "Too many results — refine the query",
			"search.results.aria": "Search results",
			"workspace.add": "Add workspace",
			"workspace.addBusy": "Adding…",
			"workspace.addError": "Add failed",
			"workspace.addErrorTitle": "Could not add workspace",
			"workspace.rename": "Rename",
			"workspace.delete": "Delete",
			"workspace.deleteTitle": "Delete workspace",
			"workspace.deleteConfirm": "Only the registration is removed; the directory and session logs stay. Delete?",
			"workspace.deleteCancel": "Cancel delete",
			"workspace.renaming": "Renaming…",
			"workspace.deleting": "Deleting…",
			"workspace.renameTitle": "Rename workspace",
			"workspace.renamePlaceholder": "Workspace name",
			"workspace.renameConfirm": "Rename",
			"workspace.renameCancel": "Cancel",
			"workspace.moveOutOfGroup": "Move out of group",
			"group.create": "New group",
			"group.createTitle": "New group",
			"group.createPlaceholder": "Group name",
			"group.createConfirm": "Create",
			"group.createCancel": "Cancel",
			"group.rename": "Rename group",
			"group.renameTitle": "Rename group",
			"group.renameConfirm": "Rename",
			"group.delete": "Delete group",
			"group.deleteTitle": "Delete group",
			"group.deleteConfirm": "Deleting removes this group; every project inside it moves to the top level (ungrouped). Delete?",
			"group.deleteCancel": "Cancel delete",
			"group.nameDuplicate": "A group with this name already exists",
			"group.nameReserved": "This name is not available",
			"section.topLevel": "Top-level projects",
			"manual.saveError": "Could not save group changes",
			"session.new": "New Session",
			"session.rename": "Rename session",
			"session.archive": "Archive",
			"session.fork": "Fork",
			"session.renameTitle": "Rename session",
			"session.renamePlaceholder": "Session name",
			"session.renameConfirm": "Rename",
			"session.renameCancel": "Cancel",
			"session.renaming": "Renaming…",
			uncategorized: "Uncategorized",
			"empty.none": "Nothing here",
			"empty.noWorkspaces": "No workspaces yet",
			close: "Close",
			cancel: "Cancel",
			confirm: "Confirm",
			retry: "Retry",
			configUnavailable: "Grouping config unavailable",
			collapse: "Collapse",
			expandMore: "Show all",
			newSession: "New Session"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "workspaceGroups";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"locale",
			"uiWorkspace"
		];
		/**
		* Register the grouped browser once the sidebar slot declaration is on the
		* ledger. Inject factory returns plain callbacks; data reads use the
		* framework's global hooks.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "DSH session sorts: dictionaries");
			const searchSessions = async (query, signal) => {
				const result = await ctx.sessions.search(query, signal);
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			};
			const browserInjected = () => ({
				startSession: (workspaceId) => {
					ctx.uiWorkspace.startSession(workspaceId);
				},
				open: (sessionId) => {
					ctx.uiWorkspace.openSession(sessionId);
				},
				searchSessions,
				searchResultLimit: ctx.sessions.searchResultLimit,
				renameSession: async (sessionId, title) => {
					const result = await ctx.sessions.using(sessionId, { source: "workspaceOperation" }, (reference) => reference.binding.session.rename(title));
					if (!result.ok) throw new Error(result.error.message);
				},
				forkSession: (sessionId) => {
					ctx.sessions.fork({
						sessionId,
						increaseTitle: true
					}).then((childId) => {
						ctx.uiWorkspace.openSession(childId);
					}).catch(() => {});
				},
				renameWorkspace: async (workspaceId, title) => {
					await ctx.workspaces.rename(workspaceId, title);
				},
				deleteWorkspace: async (workspaceId) => {
					await ctx.workspaces.delete(workspaceId);
				},
				insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
					await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId);
				},
				archiveSession: async (sessionId) => {
					await ctx.uiWorkspace.archiveSession(sessionId);
				},
				insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
					await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
				},
				createWorkspace: (input) => ctx.workspaces.create(input),
				pickDirectory: () => ctx.uiWorkspace.pickDirectory()
			});
			ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
				name: "sidebar.workspaces",
				priority: -1,
				store: createGroupsViewStore(),
				inject: browserInjected,
				locale: NS,
				registrant: "dsh-session-sorts"
			}, GroupsBrowser));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
