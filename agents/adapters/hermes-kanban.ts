import { spawn } from "node:child_process";
import type { KanbanPort, KanbanTask, KanbanTaskStatus, CreateTaskOpts } from "@ports/kanban-port";

export class HermesKanbanAdapter implements KanbanPort {
  constructor(private board?: string) {}

  private async runKanban(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const fullArgs = this.board ? ["--board", this.board, ...args] : args;
      const proc = spawn("hermes", ["kanban", ...fullArgs], {
        cwd: process.cwd(),
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    });
  }

  async createTask(title: string, opts?: CreateTaskOpts): Promise<KanbanTask> {
    console.log(`[HermesKanban] creating task: ${title}`);
    const args = ["create", "--json", title];
    if (opts?.body) args.push("--body", opts.body);
    if (opts?.assignee) args.push("--assignee", opts.assignee);
    if (opts?.priority !== undefined) args.push("--priority", String(opts.priority));
    if (opts?.parent) args.push("--parent", opts.parent);
    if (opts?.project) args.push("--project", opts.project);
    if (opts?.workspace) args.push("--workspace", opts.workspace);
    if (opts?.skill) for (const s of opts.skill) args.push("--skill", s);
    if (opts?.maxRuntime) args.push("--max-runtime", opts.maxRuntime);
    if (opts?.model) args.push("--model", opts.model);
    if (opts?.provider) args.push("--provider", opts.provider);

    const { stdout, code } = await this.runKanban(args);
    if (code !== 0) throw new Error(`hermes kanban create failed: ${stdout}`);
    return JSON.parse(stdout) as KanbanTask;
  }

  async listTasks(status?: KanbanTaskStatus): Promise<KanbanTask[]> {
    const args = ["list", "--json"];
    if (status) args.push("--status", status);
    const { stdout, code } = await this.runKanban(args);
    if (code !== 0) throw new Error(`hermes kanban list failed: ${stdout}`);
    return JSON.parse(stdout) as KanbanTask[];
  }

  async getTask(taskId: string): Promise<KanbanTask | null> {
    const { stdout, code } = await this.runKanban(["show", "--json", taskId]);
    if (code !== 0) return null;
    return JSON.parse(stdout) as KanbanTask;
  }

  async updateStatus(taskId: string, status: KanbanTaskStatus): Promise<void> {
    const cmd = status === "blocked" ? "block" : status === "ready" ? "promote" : "schedule";
    const { code } = await this.runKanban([cmd, taskId]);
    if (code !== 0) throw new Error(`hermes kanban ${cmd} failed`);
  }

  async complete(taskId: string, result?: string): Promise<void> {
    const args = ["complete", taskId];
    if (result) args.push("--result", result);
    const { code } = await this.runKanban(args);
    if (code !== 0) throw new Error(`hermes kanban complete failed`);
  }

  async comment(taskId: string, text: string): Promise<void> {
    const { code } = await this.runKanban(["comment", taskId, text]);
    if (code !== 0) throw new Error(`hermes kanban comment failed`);
  }

  async block(taskId: string, reason: string): Promise<void> {
    const { code } = await this.runKanban(["block", taskId, reason]);
    if (code !== 0) throw new Error(`hermes kanban block failed`);
  }

  async unblock(taskId: string): Promise<void> {
    const { code } = await this.runKanban(["unblock", taskId]);
    if (code !== 0) throw new Error(`hermes kanban unblock failed`);
  }
}
