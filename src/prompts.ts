import { styleText } from "node:util";
import type { Interactions } from "./interactions.js";
import type {
  CommandExecutionApprovalDecision,
  FileChangeApprovalDecision,
  FileUpdateChange,
  McpServerElicitationRequestResponse,
  ToolRequestUserInputAnswer,
} from "./protocol/v2/index.js";
import { diffStats, displayCommand, openBrowser, tildify } from "./util.js";

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);
const warn = (s: string) => styleText("yellow", s);
const ANSWER_PROMPT = styleText("yellow", "answer › ");

/** What the prompts need from the REPL: a way to read one line, and to get the reply renderer out of the way. */
export interface Asker {
  /** Resolves with the typed line, or null if cancelled (Ctrl+C) or input closed. */
  ask(prompt: string): Promise<string | null>;
  pauseRender(): void;
  resumeRender(): void;
}

interface Option<T> {
  key: string;
  label: string;
  value: T;
}

/** Terminal implementation of every mid-turn request. `onCancel` aborts the running turn. */
export function terminalInteractions(asker: Asker, onCancel: () => void): Interactions {
  async function withPrompt<T>(fn: () => Promise<T>): Promise<T> {
    asker.pauseRender();
    try {
      return await fn();
    } finally {
      asker.resumeRender();
    }
  }

  async function choose<T>(options: Option<T>[]): Promise<T | null> {
    console.log("  " + options.map((o) => `[${bold(o.key)}] ${o.label}`).join("  "));
    for (;;) {
      const ans = await asker.ask(ANSWER_PROMPT);
      if (ans === null) return null;
      const hit = options.find((o) => o.key === ans.trim().toLowerCase());
      if (hit) return hit.value;
      console.log(dim(`  choose one of: ${options.map((o) => o.key).join(", ")}`));
    }
  }

  return {
    approveCommand: (req) =>
      withPrompt(async () => {
        console.log(warn("⚠ Run command?"));
        console.log(`  ${bold("$ " + displayCommand(req.command ?? "(unknown)"))}`);
        const ctx = [req.cwd && `in ${tildify(req.cwd)}`, req.reason && `reason: ${req.reason}`].filter(Boolean);
        if (ctx.length) console.log(dim(`  ${ctx.join(" · ")}`));
        if (req.networkApprovalContext) {
          console.log(warn(`  network access: ${req.networkApprovalContext.protocol}://${req.networkApprovalContext.host}`));
        }
        const options: Option<CommandExecutionApprovalDecision>[] = [
          { key: "y", label: "yes", value: "accept" },
          { key: "a", label: "always (this command, this session)", value: "acceptForSession" },
        ];
        const prefix = req.proposedExecpolicyAmendment;
        if (prefix?.length) {
          options.push({
            key: "p",
            label: `always allow \`${prefix.join(" ")}\``,
            value: { acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix } },
          });
        }
        options.push({ key: "n", label: "no", value: "decline" }, { key: "c", label: "cancel turn", value: "cancel" });
        const decision = await choose(options);
        if (decision === null || decision === "cancel") {
          onCancel();
          return "cancel";
        }
        return decision;
      }),

    approveFileChange: (req, changes) =>
      withPrompt(async () => {
        console.log(warn("⚠ Apply file changes?"));
        for (const c of changes) console.log(`  ${describeChange(c)}`);
        if (!changes.length) console.log(dim("  (no diff available)"));
        const ctx = [req.grantRoot && `grants write access to ${tildify(req.grantRoot)}`, req.reason && `reason: ${req.reason}`];
        if (ctx.some(Boolean)) console.log(dim(`  ${ctx.filter(Boolean).join(" · ")}`));
        for (;;) {
          const decision = await choose<FileChangeApprovalDecision | "diff">([
            { key: "y", label: "yes", value: "accept" },
            { key: "a", label: "always (this session)", value: "acceptForSession" },
            ...(changes.length ? [{ key: "d", label: "show diff", value: "diff" as const }] : []),
            { key: "n", label: "no", value: "decline" },
            { key: "c", label: "cancel turn", value: "cancel" },
          ]);
          if (decision === "diff") {
            for (const c of changes) printDiff(c);
            continue;
          }
          if (decision === null || decision === "cancel") {
            onCancel();
            return "cancel";
          }
          return decision;
        }
      }),

    approvePermissions: (req) =>
      withPrompt(async () => {
        console.log(warn("⚠ Grant extra permissions?"));
        const { network, fileSystem } = req.permissions;
        if (network?.enabled) console.log("  network access");
        for (const p of fileSystem?.read ?? []) console.log(`  read  ${tildify(p)}`);
        for (const p of fileSystem?.write ?? []) console.log(`  write ${tildify(p)}`);
        if (req.reason) console.log(dim(`  reason: ${req.reason}`));
        const scope = await choose<"turn" | "session" | "deny">([
          { key: "y", label: "yes (this turn)", value: "turn" },
          { key: "a", label: "always (this session)", value: "session" },
          { key: "n", label: "no", value: "deny" },
        ]);
        if (scope === null || scope === "deny") return { permissions: {}, scope: "turn" as const };
        return {
          permissions: {
            ...(network ? { network } : {}),
            ...(fileSystem ? { fileSystem } : {}),
          },
          scope,
        };
      }),

    askUser: (req) =>
      withPrompt(async () => {
        const answers: Record<string, ToolRequestUserInputAnswer> = {};
        for (const q of req.questions) {
          console.log(`${warn("?")} ${q.header ? bold(q.header) + " · " : ""}${q.question}`);
          const opts = q.options ?? [];
          opts.forEach((o, i) => console.log(`  ${bold(String(i + 1))}. ${o.label}${o.description ? dim(" — " + o.description) : ""}`));
          if (q.isSecret) console.log(dim("  (input will be visible)"));
          const hint = opts.length ? (q.isOther ? "number or your own answer" : "number") : "your answer";
          for (;;) {
            const ans = await asker.ask(styleText("yellow", `${hint} › `));
            if (ans === null) {
              onCancel();
              return { answers };
            }
            const n = Number(ans.trim());
            if (opts.length && Number.isInteger(n) && n >= 1 && n <= opts.length) {
              answers[q.id] = { answers: [opts[n - 1]!.label] };
              break;
            }
            if (!opts.length || q.isOther) {
              answers[q.id] = { answers: [ans.trim()] };
              break;
            }
            console.log(dim(`  enter 1–${opts.length}`));
          }
        }
        return { answers };
      }),

    elicit: (req) =>
      withPrompt(async (): Promise<McpServerElicitationRequestResponse> => {
        const decline = { action: "decline" as const, content: null, _meta: null };
        console.log(`${warn("?")} ${bold(req.serverName)} · ${req.message}`);
        if (req.mode === "url") {
          console.log(`  ${req.url}`);
          openBrowser(req.url);
          const ok = await choose([
            { key: "y", label: "done", value: true },
            { key: "n", label: "decline", value: false },
          ]);
          return ok ? { action: "accept", content: null, _meta: null } : decline;
        }
        const schema = req.requestedSchema as { properties?: Record<string, any>; required?: string[] };
        const content: Record<string, unknown> = {};
        for (const [key, prop] of Object.entries(schema.properties ?? {})) {
          const label = prop.title ?? key;
          const required = schema.required?.includes(key);
          if (prop.description) console.log(dim(`  ${prop.description}`));
          const choices: string[] | undefined = prop.enum ?? prop.oneOf?.map((o: any) => o.const);
          if (choices) choices.forEach((c, i) => console.log(`  ${bold(String(i + 1))}. ${c}`));
          for (;;) {
            const ans = await asker.ask(styleText("yellow", `${label}${required ? "" : " (optional)"} › `));
            if (ans === null) return { action: "cancel", content: null, _meta: null };
            const v = ans.trim();
            if (!v && !required) break;
            const parsed = parseField(v, prop.type, choices);
            if (parsed !== undefined) {
              content[key] = parsed;
              break;
            }
            console.log(dim(`  expected ${choices ? `1–${choices.length}` : prop.type}`));
          }
        }
        const ok = await choose([
          { key: "y", label: "send", value: true },
          { key: "n", label: "decline", value: false },
        ]);
        return ok ? { action: "accept", content: content as any, _meta: null } : decline;
      }),
  };
}

function parseField(v: string, type: string, choices?: string[]): unknown {
  if (choices) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1];
    return choices.includes(v) ? v : undefined;
  }
  if (type === "number" || type === "integer") {
    const n = Number(v);
    return v !== "" && Number.isFinite(n) && (type === "number" || Number.isInteger(n)) ? n : undefined;
  }
  if (type === "boolean") {
    if (/^(y|yes|true)$/i.test(v)) return true;
    if (/^(n|no|false)$/i.test(v)) return false;
    return undefined;
  }
  return v;
}

// For added files `diff` holds the raw new content rather than a unified diff.
const contentLines = (s: string) => s.replace(/\n$/, "").split("\n");

export function describeChange(c: FileUpdateChange): string {
  const { added, removed } = c.kind.type === "add" ? { added: contentLines(c.diff).length, removed: 0 } : diffStats(c.diff);
  const stats = dim(`(+${added} −${removed})`);
  switch (c.kind.type) {
    case "add":
      return `${styleText("green", "+")} ${tildify(c.path)} ${stats}`;
    case "delete":
      return `${styleText("red", "−")} ${tildify(c.path)}`;
    case "update":
      return `${styleText("yellow", "~")} ${tildify(c.path)}${c.kind.move_path ? ` → ${tildify(c.kind.move_path)}` : ""} ${stats}`;
  }
}

function printDiff(c: FileUpdateChange) {
  console.log(bold(`  ${tildify(c.path)}`));
  const lines = c.kind.type === "add" ? contentLines(c.diff).map((l) => "+" + l) : c.diff.split("\n");
  for (const line of lines) {
    const color = line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : line.startsWith("@@") ? "cyan" : "dim";
    console.log("  " + styleText(color, line));
  }
}
