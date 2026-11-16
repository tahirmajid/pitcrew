import { z } from 'zod';
import {
  createReview, getReview, listReviews, addFindings, getFinding, dispositionFinding,
  listFindings, setReviewState, computeDecision, deleteReview,
} from './db.js';
import { runCodexReview } from './codex.js';

/** Registers the adversarial review ledger tools and review_codex_run. */
export function registerReviewTools(server, { db, embedder }) {
  const embedDoc = async t => (await embedder.embedDocs([t]))[0];
  const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

  server.tool(
    "review_start",
    "Start an adversarial review loop for any work product. Returns a review_id to pass to the other review_* tools.",
    {
      subject: z.string().describe("What's under review, e.g. 'PR #42 auth refactor' or a file path"),
      focus:   z.string().optional().describe("What to focus the review on, verbatim - never paraphrase this"),
      cap:     z.number().int().min(1).max(5).optional().describe("Max review rounds. Default: 3"),
    },
    async ({ subject, focus, cap = 3 }) => {
      const review = createReview(db, { subject, focus, cap });
      return {
        content: [{
          type: "text",
          text: `Review started: ${review.id}\nSubject: ${subject}${focus ? `\nFocus: ${focus}` : ""}\nCap: ${cap} round(s)\n\nSubmit round ${review.round} findings with review_submit_findings.`,
        }],
      };
    }
  );

  server.tool(
    "review_submit_findings",
    "Record this round's findings for a review. Call once per round, even with an empty array (no findings ⇒ approved).",
    {
      review_id: z.string(),
      findings: z.array(z.object({
        title:    z.string(),
        body:     z.string(),
        severity: z.enum(["critical", "high", "medium", "low"]),
      })).describe("Every finding from this round's adversarial pass"),
    },
    async ({ review_id, findings }) => {
      const review = getReview(db, review_id);
      if (!review) return { content: [{ type: "text", text: `Unknown review_id: ${review_id}` }] };
      if (review.status !== "in_progress") {
        return { content: [{ type: "text", text: `Review is already closed (${review.status}${review.exit_reason ? `: ${review.exit_reason}` : ""})` }] };
      }

      if (findings.length === 0) {
        setReviewState(db, review_id, { status: "approved", exitReason: "approved" });
        return { content: [{ type: "text", text: `No findings in round ${review.round} - EXIT approved.` }] };
      }

      const recorded = await addFindings(db, embedDoc, review_id, review.round, findings);
      const lines = recorded.map(f => {
        const flag = f.possible_repeat_of ? ` possible repeat of ${f.possible_repeat_of} (sim ${f.repeat_similarity})` : "";
        return `- [${f.severity}] ${f.id}: ${f.title}${flag}`;
      });
      return {
        content: [{
          type: "text",
          text: `Round ${review.round} - ${recorded.length} finding(s) recorded:\n${lines.join("\n")}\n\nDisposition each with review_disposition, then call review_decide.`,
        }],
      };
    }
  );

  server.tool(
    "review_disposition",
    "Record exactly one disposition (fix/rebut/defer) for a finding, with evidence.",
    {
      finding_id:     z.string(),
      disposition:    z.enum(["fix", "rebut", "defer"]),
      evidence:       z.string().describe("A file:line you read, a committed test, or the DEFER trigger that fired"),
      repeat_of:      z.string().optional().describe("Set if this finding is a reworded repeat of an earlier finding_id"),
      change_applied: z.boolean().optional().describe("For disposition=fix only: did the fix actually change anything? false ⇒ reclassified defer (a no-op fix doesn't count as handled). Default: true"),
    },
    async ({ finding_id, disposition, evidence, repeat_of, change_applied = true }) => {
      const finding = getFinding(db, finding_id);
      if (!finding) return { content: [{ type: "text", text: `Unknown finding_id: ${finding_id}` }] };

      let final = disposition;
      if (disposition === "fix" && !change_applied) {
        final = "defer";
        evidence = `${evidence} (reclassified: fix produced no actual change)`;
      }

      if (repeat_of) {
        const repeated = getFinding(db, repeat_of);
        if (!repeated) return { content: [{ type: "text", text: `Unknown repeat_of finding_id: ${repeat_of}` }] };
      }

      dispositionFinding(db, finding_id, { disposition: final, evidence, repeatOf: repeat_of ?? null });

      let note = "";
      if (repeat_of) {
        const repeated = getFinding(db, repeat_of);
        if (repeated.disposition === "fix") note = " repeat of a FIX - review_decide will force needs-arbitration.";
      }
      if (final === "rebut" && (finding.severity === "critical" || finding.severity === "high")) {
        note += " rebutting a critical/high finding - review_decide will force needs-arbitration.";
      }
      return { content: [{ type: "text", text: `${finding_id} → ${final}.${note}` }] };
    }
  );

  server.tool(
    "review_decide",
    "Compute this round's exit decision from all dispositioned findings. Call once per round after every finding has a disposition.",
    {
      review_id:       z.string(),
      changes_applied: z.boolean().describe("Did any FIX actually land this round? Ignored if there were no FIX dispositions."),
      lenient:         z.boolean().optional().describe("Exit after a round whose fixes were all medium/low, instead of continuing. Default: false"),
    },
    async ({ review_id, changes_applied, lenient = false }) => {
      const review = getReview(db, review_id);
      if (!review) return { content: [{ type: "text", text: `Unknown review_id: ${review_id}` }] };
      if (review.status !== "in_progress") {
        return { content: [{ type: "text", text: `Review is already closed (${review.status}${review.exit_reason ? `: ${review.exit_reason}` : ""})` }] };
      }

      const decision = computeDecision(db, review_id, { changesApplied: changes_applied, lenient });
      if (decision.error === "undisposed") {
        return { content: [{ type: "text", text: `${decision.undisposed.length} finding(s) still lack a disposition: ${decision.undisposed.join(", ")}` }] };
      }

      if (decision.exit) {
        setReviewState(db, review_id, { status: "closed", exitReason: decision.exit });
        return { content: [{ type: "text", text: `EXIT ${decision.exit} (after round ${decision.round})` }] };
      }

      setReviewState(db, review_id, { round: decision.nextRound });
      return { content: [{ type: "text", text: `Continue to round ${decision.nextRound} (of ${review.cap}).` }] };
    }
  );

  server.tool(
    "review_status",
    "Get the full ledger for a review: every finding, its disposition and evidence, and the current/exit status.",
    { review_id: z.string() },
    async ({ review_id }) => {
      const review = getReview(db, review_id);
      if (!review) return { content: [{ type: "text", text: `Unknown review_id: ${review_id}` }] };
      const findings = listFindings(db, review_id)
        .sort((a, b) => a.round - b.round || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

      const lines = findings.map(f =>
        `Round ${f.round} [${f.severity}] ${f.id}: ${f.title}\n  disposition: ${f.disposition ?? "(pending)"}${f.repeat_of ? ` (repeat of ${f.repeat_of})` : ""}${f.evidence ? `\n  evidence: ${f.evidence}` : ""}`
      );

      return {
        content: [{
          type: "text",
          text: [
            `Review ${review.id} - ${review.subject}`,
            review.focus ? `Focus: ${review.focus}` : null,
            `Status: ${review.status}${review.exit_reason ? ` (${review.exit_reason})` : ""} - round ${review.round}/${review.cap}`,
            "",
            findings.length ? lines.join("\n\n") : "(no findings recorded yet)",
          ].filter(Boolean).join("\n"),
        }],
      };
    }
  );

  server.tool(
    "review_list",
    "List review loops, most recently updated first.",
    { status: z.enum(["in_progress", "approved", "closed"]).optional() },
    async ({ status }) => {
      const reviews = listReviews(db, { status });
      if (reviews.length === 0) return { content: [{ type: "text", text: "No reviews yet." }] };
      const lines = reviews.map(r =>
        `- ${r.id}: ${r.subject} - ${r.status}${r.exit_reason ? ` (${r.exit_reason})` : ""}, round ${r.round}/${r.cap}`
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "review_delete",
    "Discard a review and all its findings.",
    { review_id: z.string() },
    async ({ review_id }) => {
      const review = getReview(db, review_id);
      if (!review) return { content: [{ type: "text", text: `Unknown review_id: ${review_id}` }] };
      deleteReview(db, review_id);
      return { content: [{ type: "text", text: `Deleted review ${review_id}` }] };
    }
  );

  server.tool(
    "review_codex_run",
    "Run a REAL adversarial review with the local `codex` CLI (OpenAI, already authenticated) over a diff or arbitrary text - the actual model call review_submit_findings doesn't make on its own. Returns a verdict + findings; feed them into review_submit_findings/review_disposition/review_decide to record them in a review_id's ledger.",
    {
      subject:     z.string().describe("What's under review, for context in the prompt"),
      focus:       z.string().optional().describe("Reviewer instructions/focus - passed to Codex verbatim, never paraphrase it"),
      content:     z.string().optional().describe("Raw text or diff to review directly. Wins over cwd/diff_base/uncommitted."),
      cwd:         z.string().optional().describe("Repo directory for git diff and Codex's working root. Defaults to this server process's cwd."),
      diff_base:   z.string().optional().describe("Git ref to diff HEAD against ('git diff <ref>...HEAD' in cwd). Ignored if 'content' is set."),
      uncommitted: z.boolean().optional().describe("Review 'git diff HEAD' (staged+unstaged, not untracked) in cwd. Ignored if 'content' or 'diff_base' is set."),
      model:       z.string().optional().describe("Override the Codex model."),
      timeout_ms:  z.number().int().optional().describe("Kill the review after this many ms. Default 480000 (8 min)."),
    },
    async ({ subject, focus, content, cwd, diff_base, uncommitted, model, timeout_ms }) => {
      const result = await runCodexReview({
        subject, focus, content, cwd, diffBase: diff_base, uncommitted, model,
        timeoutMs: timeout_ms,
      });

      if (!result.ok) {
        const messages = {
          "nothing-to-review": "Nothing to review - pass 'content', or 'diff_base'/'uncommitted' with a 'cwd' that actually has a diff.",
          "codex-not-found":   "'codex' not found on PATH. Install with 'npm install -g @openai/codex' and run 'codex login'.",
          "timeout":           `Codex review timed out after ${result.timeoutMs}ms.`,
          "git-diff-failed":   `git diff failed: ${result.error}`,
          "codex-failed":      `Codex review failed (exit ${result.code}).${result.stderr ? `\nstderr: ${result.stderr.slice(-2000)}` : ""}${result.raw ? `\nraw output: ${result.raw.slice(0, 2000)}` : "\n(no output produced)"}`,
        };
        return { content: [{ type: "text", text: `${messages[result.reason] || result.reason}` }] };
      }

      const lines = (result.findings || []).map(f =>
        `- [${f.severity}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}\n  ${f.body}`
      );
      return {
        content: [{
          type: "text",
          text: [
            `Codex verdict: ${result.verdict}`,
            `Summary: ${result.summary}`,
            result.findings?.length ? `\nFindings:\n${lines.join("\n")}` : "\n(no findings)",
            `\nRaw JSON (paste findings into review_submit_findings - title/severity/body):\n${JSON.stringify({ verdict: result.verdict, summary: result.summary, findings: result.findings })}`,
          ].join("\n"),
        }],
      };
    }
  );
}
