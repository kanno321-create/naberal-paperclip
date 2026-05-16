import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { WorkspaceDiffQueryOptions } from "@paperclipai/plugin-sdk";
import { workspaceDiffService } from "./workspace-diff.js";

const PLUGIN_NAME = "workspace-diff";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  });
}

function readDiffOptions(params: Record<string, unknown>): WorkspaceDiffQueryOptions {
  const view = params.view === "head" ? "head" : "working-tree";
  const baseRef = readString(params.baseRef) || null;
  const includeUntracked = typeof params.includeUntracked === "boolean"
    ? params.includeUntracked
    : true;
  return {
    view,
    baseRef,
    includeUntracked,
    paths: readPaths(params.paths),
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`${PLUGIN_NAME} plugin setup`);
    const workspaceDiff = workspaceDiffService();

    ctx.data.register("workspace-diff", async (params: Record<string, unknown>) => {
      const workspaceId = readString(params.workspaceId);
      const companyId = readString(params.companyId);
      if (!workspaceId || !companyId) {
        throw new Error("workspaceId and companyId are required");
      }

      if (params.entityType === "project_workspace") {
        const projectId = readString(params.projectId);
        if (!projectId) {
          throw new Error("projectId is required for project workspace diffs");
        }
        const workspaces = await ctx.projects.listWorkspaces(projectId, companyId);
        const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
        if (!workspace) {
          throw new Error("Workspace not found");
        }
        return workspaceDiff.getDiff({
          id: workspace.id,
          companyId,
          cwd: workspace.path,
          baseRef: null,
        }, readDiffOptions(params));
      }

      const workspace = await ctx.executionWorkspaces.get(workspaceId, companyId);
      if (!workspace) {
        throw new Error("Workspace not found");
      }
      return workspaceDiff.getDiff(workspace, readDiffOptions(params));
    });
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_NAME} ready` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
