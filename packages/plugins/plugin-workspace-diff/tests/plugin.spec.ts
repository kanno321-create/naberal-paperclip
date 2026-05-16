import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", ["-C", cwd, ...args], { cwd });
}

async function createGitWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-workspace-diff-plugin-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "paperclip@example.com"]);
  await git(root, ["config", "user.name", "Paperclip Test"]);
  await fs.writeFile(path.join(root, "src/app.ts"), "export const value = 1;\n");
  await git(root, ["add", "src/app.ts"]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}

describe("workspace diff plugin", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it("declares workspace Changes tabs and workspace read capabilities", () => {
    expect(manifest.capabilities).toContain("ui.detailTab.register");
    expect(manifest.capabilities).toContain("execution.workspaces.read");
    expect(manifest.capabilities).toContain("project.workspaces.read");
    expect(manifest.ui?.slots).toContainEqual(expect.objectContaining({
      type: "detailTab",
      displayName: "Changes",
      entityTypes: ["execution_workspace", "project_workspace"],
    }));
  });

  it("fetches changed execution workspace diffs from host metadata", async () => {
    const root = await createGitWorkspace();
    await fs.writeFile(path.join(root, "src/app.ts"), "export const value = 2;\n");
    const harness = createTestHarness({ manifest });
    harness.seed({
      executionWorkspaces: [{
        id: "workspace-1",
        companyId: "company-1",
        projectId: "project-1",
        projectWorkspaceId: null,
        path: root,
        cwd: root,
        repoUrl: null,
        baseRef: "HEAD",
        branchName: "main",
        providerType: "git_worktree",
        providerMetadata: null,
      }],
    });
    await plugin.definition.setup(harness.ctx);

    const result = await harness.getData("workspace-diff", {
      workspaceId: "workspace-1",
      companyId: "company-1",
      view: "working-tree",
      includeUntracked: false,
      paths: ["src/app.ts"],
    });

    expect(result).toMatchObject({
      stats: { fileCount: 1 },
      files: [expect.objectContaining({ path: "src/app.ts" })],
    });
  });

  it("returns an empty diff when the workspace has no changes", async () => {
    const root = await createGitWorkspace();
    const harness = createTestHarness({ manifest });
    harness.seed({
      executionWorkspaces: [{
        id: "workspace-1",
        companyId: "company-1",
        projectId: "project-1",
        projectWorkspaceId: null,
        path: root,
        cwd: root,
        repoUrl: null,
        baseRef: "HEAD",
        branchName: "main",
        providerType: "git_worktree",
        providerMetadata: null,
      }],
    });
    await plugin.definition.setup(harness.ctx);

    await expect(harness.getData("workspace-diff", {
      workspaceId: "workspace-1",
      companyId: "company-1",
    })).resolves.toMatchObject({ files: [], truncated: false });
  });

  it("returns a clear bridge error when required context is missing", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);

    await expect(harness.getData("workspace-diff", {
      workspaceId: "workspace-1",
    })).rejects.toThrow("workspaceId and companyId are required");
  });
});
