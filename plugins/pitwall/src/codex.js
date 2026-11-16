// ════════════════════════════════════════════════════════════════════════════
//  CODEX ADVERSARIAL REVIEW
//  The actual model call the review_* ledger in index.js/db.js deliberately
//  doesn't make (see the comment above review_start). This shells out to the
//  local `codex` CLI (https://github.com/openai/codex), already authenticated
//  via `codex login` on this machine, and returns a structured verdict +
//  findings. No ledger writes here — the caller (an MCP tool, or a human)
//  decides what to do with the result, e.g. feeding it into review_submit_findings.
// ════════════════════════════════════════════════════════════════════════════
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

export const CODEX_BIN = process.env.LOCAL_KNOWLEDGE_CODEX_BIN || "codex";

// OpenAI structured outputs (--output-schema) require additionalProperties:false
// and every property listed in `required` at every object level — verified
// against the real CLI: omitting either produces a 400 invalid_json_schema.
export const CODEX_FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["approve", "needs-attention"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title:    { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          body:     { type: "string" },
          file:     { type: ["string", "null"] },
          line:     { type: ["number", "null"] },
        },
        required: ["title", "severity", "body", "file", "line"],
      },
    },
  },
  required: ["verdict", "summary", "findings"],
};

/**
 * Pure: the prompt sent to Codex. Focus text is passed through untouched — the
 * adversarial-review-loop skill's rule ("never synthesize a focus, it biases
 * the reviewer") applies here too.
 */
export function buildReviewPrompt({ subject, focus, target }) {
  return [
    `You are an adversarial reviewer. Subject: ${subject}`,
    focus ? `Focus (verbatim from the caller — do not reinterpret it): ${focus}` : null,
    `Review ONLY the material below. Be concrete: cite the exact line/clause, name the concrete failure scenario, don't pad with generic advice.`,
    `Respond with ONLY a JSON object matching the given output schema.`,
    ``,
    `--- MATERIAL UNDER REVIEW ---`,
    target,
    `--- END MATERIAL ---`,
  ].filter(Boolean).join("\n");
}

/**
 * Pure: picks the review target, highest priority first. `fetchDiff(range)` is
 * injected so this is testable without a real git repo.
 */
export async function resolveTarget({ content, diffBase, uncommitted }, fetchDiff) {
  if (content) return content;
  if (diffBase) return fetchDiff(`${diffBase}...HEAD`);
  if (uncommitted) return fetchDiff("HEAD");
  return null;
}

export function runCommand(cmd, args, { cwd, stdinIgnore = true, timeoutMs = 480000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      // stdin MUST be closed (never "pipe" left open) — codex exec reads
      // stdin for extra context even when a prompt is given as an argument,
      // and hangs forever on an open, silent stdin.
      child = spawn(cmd, args, { cwd, stdio: [stdinIgnore ? "ignore" : "pipe", "pipe", "pipe"] });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: String(err), error: err });
      return;
    }
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || String(err), error: err, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Runs a real Codex adversarial review over `content`, or a git diff computed
 * from `diffBase`/`uncommitted` in `cwd`.
 */
export async function runCodexReview({
  subject, focus, content, cwd = process.cwd(), diffBase, uncommitted, model, timeoutMs = 480000,
}) {
  const workDir = path.resolve(cwd);

  let target;
  try {
    target = await resolveTarget({ content, diffBase, uncommitted }, async (range) => {
      const diff = await runCommand("git", ["diff", range], { cwd: workDir });
      if (diff.code !== 0) throw new Error(diff.stderr || diff.stdout || `git diff ${range} failed`);
      return diff.stdout;
    });
  } catch (err) {
    return { ok: false, reason: "git-diff-failed", error: String(err.message || err) };
  }

  if (!target || !target.trim()) {
    return { ok: false, reason: "nothing-to-review" };
  }

  const prompt = buildReviewPrompt({ subject, focus, target });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lk-codex-"));
  const schemaPath = path.join(tmpDir, "schema.json");
  const outPath = path.join(tmpDir, "last-message.json");
  await fs.writeFile(schemaPath, JSON.stringify(CODEX_FINDINGS_SCHEMA));

  const args = [
    "exec", prompt,
    "--skip-git-repo-check",
    "--sandbox", "read-only",
    "--output-schema", schemaPath,
    "-o", outPath,
    "--json",
  ];
  if (model) args.push("--model", model);

  const run = await runCommand(CODEX_BIN, args, { cwd: workDir, timeoutMs });

  if (run.error?.code === "ENOENT") {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, reason: "codex-not-found" };
  }
  if (run.timedOut) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, reason: "timeout", timeoutMs };
  }

  let raw = null, parsed = null;
  try {
    raw = await fs.readFile(outPath, "utf8");
    parsed = JSON.parse(raw);
  } catch { /* handled below */ }
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  if (run.code !== 0 || !parsed) {
    return { ok: false, reason: "codex-failed", code: run.code, stderr: run.stderr, raw };
  }

  return { ok: true, ...parsed };
}
