import fs from "fs/promises";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { fileURLToPath } from "url";

import "dotenv/config";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_PATH = path.join(__dirname, "language_state.json");
const SCHEMA_PATH = path.join(__dirname, "schema.json");
const PROMPTS_PATH = path.join(__dirname, "prompts.json");

function renderProblem(problem) {
  if (!problem || problem.enabled !== 1 || !problem.problem_type) return;

  output.write("\n=== Proposed Exercise ===\n");
  output.write(`Type: ${problem.problem_type}\n`);

  if (problem.problem_type === "translation" && problem.translation) {
    output.write(`Translate (${problem.translation.direction}):\n`);
    output.write(`${problem.translation.text}\n`);
    return;
  }

  if (problem.problem_type === "fill_in_blank" && problem.fill_in_blank) {
    output.write(`${problem.fill_in_blank.prompt}\n\n`);
    for (const blank of problem.fill_in_blank.blanks) {
      output.write(`- ${blank.text_with_placeholder}\n`);
    }
    return;
  }

  if (problem.problem_type === "multiple_choice" && problem.multiple_choice) {
    output.write(`${problem.multiple_choice.prompt}\n\n`);
    for (const opt of problem.multiple_choice.options) {
      output.write(`- ${opt.text}\n`);
    }
    return;
  }

  if (problem.problem_type === "free_response" && problem.free_response) {
    output.write(`${problem.free_response.prompt}\n`);
    return;
  }

  output.write("(Unrecognized or missing payload for problem_type)\n");
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      config: null,
      messages: [],
      problem: null,
    };
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
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

async function ensureConfig(rl, state) {
  if (state.config?.targetLanguage && state.config?.nativeLanguage) return state;

  const targetLanguage = (await rl.question("Target language (e.g., Spanish): ")).trim();
  const nativeLanguage = (await rl.question("Native language (e.g., English): ")).trim();

  state.config = {
    targetLanguage: targetLanguage || "Spanish",
    nativeLanguage: nativeLanguage || "English",
  };

  await saveState(state);
  return state;
}

async function callModel({ client, model, schema, systemPrompt, messages }) {
  const resp = await client.responses.create({
    model,
    input: [{ role: "system", content: systemPrompt }, ...messages],
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
    throw new Error(`Incomplete model response: ${reason}`);
  }

  const raw = getOutputText(resp);
  if (!raw) throw new Error("No output_text returned by model");

  return JSON.parse(raw);
}

function normalizeProblem(problem) {
  if (!problem || typeof problem !== "object") return null;
  return problem;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    output.write("Missing OPENAI_API_KEY environment variable\n");
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  const schema = await loadJson(SCHEMA_PATH);
  const prompts = await loadJson(PROMPTS_PATH);
  const rl = readline.createInterface({ input, output });

  let state = await loadState();
  state = await ensureConfig(rl, state);

  output.write("\nCommands:\n");
  output.write("- /new: start a new conversation\n");
  output.write("- /exit: quit\n\n");

  while (true) {
    const line = (await rl.question("> ")).trim();
    if (!line) continue;

    if (line === "/exit") break;

    if (line === "/new") {
      state.messages = [];
      state.problem = null;
      await saveState(state);
      output.write("(new conversation)\n");
      continue;
    }

    if (line.startsWith("/answer")) {
      output.write("This CLI is legacy. Use the web GUI for exercises.\n");
      output.write("Run: cd web && npm install && npm run dev\n");
      continue;
    }

    if (line === "/help") {
      output.write("This CLI is legacy. Use the web GUI for exercise help.\n");
      output.write("Run: cd web && npm install && npm run dev\n");
      continue;
    }

    const systemPrompt = buildSystemPrompt(state.config, prompts);

    const messages = [
      ...state.messages,
      {
        role: "user",
        content: line,
      },
    ];

    try {
      const parsed = await callModel({ client, model, schema, systemPrompt, messages });

      output.write(`\n${parsed.response}\n`);

      state.messages.push({ role: "user", content: line });
      state.messages.push({ role: "assistant", content: parsed.response });
      await saveState(state);

      if (parsed?.proposal?.enabled === 1) {
        renderProblem(normalizeProblem(parsed.proposal));
      }
      output.write("\n");
    } catch (e) {
      output.write(`Error: ${e.message}\n`);
    }
  }

  rl.close();
}

main().catch((e) => {
  output.write(`Fatal: ${e.message}\n`);
  process.exit(1);
});
