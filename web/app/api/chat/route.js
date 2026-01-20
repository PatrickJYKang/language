import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";
import OpenAI from "openai";

export const runtime = "nodejs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const SCHEMA_PATH = path.join(REPO_ROOT, "schema.json");
const PROMPTS_PATH = path.join(REPO_ROOT, "prompts.json");

let schemaCache = null;
let promptsCache = null;

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function getSchema() {
  if (process.env.NODE_ENV !== "production") return loadJson(SCHEMA_PATH);
  if (!schemaCache) schemaCache = await loadJson(SCHEMA_PATH);
  return schemaCache;
}

async function getPrompts() {
  if (process.env.NODE_ENV !== "production") return loadJson(PROMPTS_PATH);
  if (!promptsCache) promptsCache = await loadJson(PROMPTS_PATH);
  return promptsCache;
}

function renderTemplate(template, vars) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return "";
    return String(vars[key]);
  });
}

function buildSystemPrompt(config, prompts) {
  const lines = prompts?.system_lines;
  if (!Array.isArray(lines)) throw new Error("prompts.json is missing system_lines[]");

  return lines
    .map((line) =>
      renderTemplate(String(line), {
        nativeLanguage: config.nativeLanguage,
        targetLanguage: config.targetLanguage,
      })
    )
    .join("\n");
}

function getOutputText(resp) {
  if (typeof resp.output_text === "string" && resp.output_text.trim().length > 0) return resp.output_text;

  if (Array.isArray(resp.output)) {
    for (const item of resp.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === "output_text" && typeof c.text === "string") return c.text;
        }
      }
    }
  }

  return "";
}

function redactActiveForModel(active) {
  if (!active || typeof active !== "object") return null;

  const cloned = JSON.parse(JSON.stringify(active));

  if (cloned.problem_type === "fill_in_blank" && cloned.fill_in_blank?.blanks) {
    for (const blank of cloned.fill_in_blank.blanks) {
      if (blank && typeof blank === "object") {
        delete blank.expected_answers;
      }
    }
  }

  if (cloned.problem_type === "multiple_choice" && cloned.multiple_choice) {
    delete cloned.multiple_choice.correct_option_ids;
  }

  return cloned;
}

function disabledProposal() {
  return {
    enabled: 0,
    proposal_id: null,
    problem_type: null,
    translation: null,
    fill_in_blank: null,
    multiple_choice: null,
    free_response: null,
  };
}

function disabledPoll() {
  return {
    enabled: 0,
    poll_id: null,
    question: null,
    options: null,
  };
}

function normalizeModelOutput(parsed, { effectiveMode }) {
  const out = parsed && typeof parsed === "object" ? parsed : {};

  if (!out.proposal || typeof out.proposal !== "object") out.proposal = disabledProposal();
  if (!out.poll || typeof out.poll !== "object") out.poll = disabledPoll();

  if (out.proposal?.enabled !== 1) out.proposal = disabledProposal();
  if (out.poll?.enabled !== 1) out.poll = disabledPoll();
  if (out.clear_active !== 1) out.clear_active = 0;

  if (effectiveMode === "help") {
    out.poll = disabledPoll();
    return out;
  }

  const pollEnabled = out.poll?.enabled === 1;
  const proposalEnabled = out.proposal?.enabled === 1;
  const clearActive = out.clear_active === 1;

  if (pollEnabled && clearActive) {
    out.poll = disabledPoll();
    return out;
  }

  if (pollEnabled && proposalEnabled) {
    out.proposal = disabledProposal();
  }

  if (pollEnabled) {
    out.clear_active = 0;
  }

  return out;
}

export async function POST(req) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const model = process.env.OPENAI_MODEL || "gpt-5.2";

    const body = await req.json();
    const requestedMode = body?.mode;
    const mode = requestedMode === "help" ? "help" : requestedMode === "post_clear" ? "post_clear" : "chat";

    const config = {
      nativeLanguage: typeof body?.config?.nativeLanguage === "string" ? body.config.nativeLanguage : "English",
      targetLanguage: typeof body?.config?.targetLanguage === "string" ? body.config.targetLanguage : "Spanish",
    };

    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    const messages = rawMessages
      .filter((m) => m && typeof m === "object")
      .map((m) => ({ role: m.role, content: m.content }))
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");

    const active = body?.active && typeof body.active === "object" ? body.active : null;
    const attempt = body?.attempt ?? null;
    const cleared = body?.cleared ?? null;
    const clearedOutcome = body?.clearedOutcome ?? null;

    const schema = await getSchema();
    const prompts = await getPrompts();

    const systemPrompt = buildSystemPrompt(config, prompts);

    let userContent = "";

    const userText = typeof body?.userText === "string" ? body.userText : "";
    const hasUserText = userText.trim().length > 0;

    const effectiveMode = mode !== "post_clear" && active && active.enabled === 1 && active.problem_type ? "help" : mode;

    if (effectiveMode === "post_clear") {
      const template = String(prompts?.post_clear_user_message ?? "");
      if (!template) {
        return Response.json({ error: "prompts.json is missing post_clear_user_message" }, { status: 500 });
      }

      userContent = renderTemplate(template, {
        clearedJson: JSON.stringify(cleared),
        clearedOutcomeJson: JSON.stringify(clearedOutcome),
      });
    } else if (effectiveMode === "help") {
      if (!active || active.enabled !== 1 || !active.problem_type) {
        return Response.json({ error: "No active exercise to help with." }, { status: 400 });
      }
      if (!hasUserText) {
        return Response.json({ error: "Missing userText" }, { status: 400 });
      }

      const redactedActive = redactActiveForModel(active);
      userContent = renderTemplate(String(prompts?.help_user_message_with_active ?? prompts?.help_user_message ?? ""), {
        userText,
        activeContextJson: JSON.stringify(redactedActive),
        attemptJson: JSON.stringify(attempt),
        helpContextJson: JSON.stringify({ problem: redactedActive }),
      });
    } else {
      if (!hasUserText) {
        return Response.json({ error: "Missing userText" }, { status: 400 });
      }
      userContent = userText;
    }

    const client = new OpenAI({ apiKey });

    const resp = await client.responses.create({
      model,
      input: [{ role: "system", content: systemPrompt }, ...messages, { role: "user", content: userContent }],
      text: {
        format: {
          type: "json_schema",
          name: "language_response",
          strict: true,
          schema,
        },
      },
    });

    if (resp.status === "incomplete") {
      const reason = resp.incomplete_details?.reason ?? "unknown";
      return Response.json({ error: `Incomplete model response: ${reason}` }, { status: 500 });
    }

    const raw = getOutputText(resp);
    if (!raw) return Response.json({ error: "No output_text returned by model" }, { status: 500 });

    const parsed = JSON.parse(raw);

    const normalized = normalizeModelOutput(parsed, { effectiveMode });
    return Response.json(normalized, { status: 200 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
