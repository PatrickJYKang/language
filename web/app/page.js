"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STORAGE_KEY = "language_web_state_v2";

const MARKDOWN_COMPONENTS = {
  p: ({ children }) => <p className="m-0 whitespace-pre-wrap">{children}</p>,
  a: ({ children, href }) => (
    <a href={href} className="text-indigo-300 underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-1">{children}</li>,
  code: ({ inline, children }) => {
    if (inline) {
      return <code className="rounded bg-zinc-900 px-1 py-0.5 text-[0.9em]">{children}</code>;
    }
    return <code className="text-[0.9em]">{children}</code>;
  },
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-xl bg-zinc-900 p-3">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-zinc-600 pl-3 text-zinc-200">{children}</blockquote>,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold">{children}</h3>,
};

function MarkdownContent({ text }) {
  return (
    <div className="prose max-w-none prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {String(text ?? "")}
      </ReactMarkdown>
    </div>
  );

}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function renderExercise(exercise) {
  if (!exercise || exercise.enabled !== 1 || !exercise.problem_type) return null;

  if (exercise.problem_type === "translation" && exercise.translation) {
    return {
      title: "Translation",
      lines: [exercise.translation.text],
    };
  }

  if (exercise.problem_type === "fill_in_blank" && exercise.fill_in_blank) {
    return {
      title: "Fill in the blank",
      lines: [exercise.fill_in_blank.prompt, ...exercise.fill_in_blank.blanks.map((b) => b.text_with_placeholder)],
    };
  }

  if (exercise.problem_type === "multiple_choice" && exercise.multiple_choice) {
    return {
      title: "Multiple choice",
      lines: [exercise.multiple_choice.prompt, ...exercise.multiple_choice.options.map((o) => o.text)],
    };
  }

  if (exercise.problem_type === "free_response" && exercise.free_response) {
    return {
      title: "Free response",
      lines: [exercise.free_response.prompt],
    };
  }

  return { title: "Exercise", lines: ["Unrecognized or missing payload for problem_type"] };
}

export default function Page() {
  const [nativeLanguage, setNativeLanguage] = useState("English");
  const [targetLanguage, setTargetLanguage] = useState("Spanish");
  const [messages, setMessages] = useState([]);
  const [conversationMode, setConversationMode] = useState("onboarding");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [placement, setPlacement] = useState({ levelText: "", focusText: "" });
  const [active, setActive] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [pendingProposal, setPendingProposal] = useState(null);
  const [grade, setGrade] = useState(null);
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const bottomRef = useRef(null);

  function renderMessageContent(m) {
    if (m?.role !== "assistant") return m?.content;

    return <MarkdownContent text={m?.content} />;
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.languageDebug = {
      storageKey: STORAGE_KEY,
      dumpRaw: () => localStorage.getItem(STORAGE_KEY),
      dump: () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = safeJsonParse(raw);
        console.log(parsed);
        return parsed;
      },
      print: () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = safeJsonParse(raw);
        console.log(JSON.stringify(parsed, null, 2));
        return parsed;
      },
      clear: () => {
        localStorage.removeItem(STORAGE_KEY);
        console.log(`Cleared ${STORAGE_KEY}`);
      },
      set: (nextState) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        console.log(`Set ${STORAGE_KEY}`);
      },
    };
  }, []);

  function startOnboarding({ nextNativeLanguage, nextTargetLanguage } = {}) {
    const nl = typeof nextNativeLanguage === "string" ? nextNativeLanguage : nativeLanguage;
    const tl = typeof nextTargetLanguage === "string" ? nextTargetLanguage : targetLanguage;

    setConversationMode("onboarding");
    setOnboardingStep(0);
    setPlacement({ levelText: "", focusText: "" });
    setInputText("");
    setActive(null);
    setAttempt(null);
    setPendingProposal(null);
    setGrade(null);
    setError("");

    setMessages([
      {
        role: "assistant",
        content: `Hi — I'm your ${tl} practice coach.`,
      },
      {
        role: "assistant",
        content: `Before we start, I have two quick questions to estimate your current level.`,
      },
      {
        role: "assistant",
        content: `1) Roughly what level are you in ${tl}? (beginner / intermediate / advanced, or A1–C2)`,
      },
    ]);
  }

  function inferApproxLevel(levelText) {
    const t = String(levelText ?? "").toLowerCase();
    const m = t.match(/\b(a1|a2|b1|b2|c1|c2)\b/i);
    if (m && m[1]) return m[1].toUpperCase();

    if (t.includes("beginner")) return "A1";
    if (t.includes("intermediate")) return "B1";
    if (t.includes("advanced")) return "C1";

    return "B1";
  }

  function placementFreeResponseProposal({ level, focusText }) {
    const tl = targetLanguage;
    const id = `placement_${Date.now()}`;
    const focus = String(focusText ?? "").trim();

    let prompt = "";
    let rubric = "";

    if (level === "A1" || level === "A2") {
      prompt = `In ${tl}, write 2–4 short sentences introducing yourself (name, where you're from, and one hobby).`;
      rubric = "Short, simple sentences; correct basic word order; understandable meaning.";
    } else if (level === "B2" || level === "C1" || level === "C2") {
      prompt = `In ${tl}, write a short paragraph (5–8 sentences) giving an opinion on a topic you care about. Include one example. ${focus ? `Try to relate it to: ${focus}.` : ""}`.trim();
      rubric = "Clear opinion; cohesive paragraph; varied vocabulary; mostly correct grammar.";
    } else {
      prompt = `In ${tl}, write 4–6 sentences about your last weekend (what you did, where you went, and how you felt). ${focus ? `Try to include vocabulary related to: ${focus}.` : ""}`.trim();
      rubric = "Past tense narration; clear sequence; understandable meaning; some variety in vocabulary.";
    }

    return {
      enabled: 1,
      proposal_id: id,
      problem_type: "free_response",
      translation: null,
      fill_in_blank: null,
      multiple_choice: null,
      free_response: {
        language: tl,
        prompt,
        rubric,
      },
    };
  }

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      startOnboarding();
      setHydrated(true);
      return;
    }

    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object") {
      startOnboarding();
      setHydrated(true);
      return;
    }

    const nextNativeLanguage = typeof parsed.nativeLanguage === "string" ? parsed.nativeLanguage : nativeLanguage;
    const nextTargetLanguage = typeof parsed.targetLanguage === "string" ? parsed.targetLanguage : targetLanguage;

    if (typeof parsed.nativeLanguage === "string") setNativeLanguage(parsed.nativeLanguage);
    if (typeof parsed.targetLanguage === "string") setTargetLanguage(parsed.targetLanguage);

    const hasMessages = Array.isArray(parsed.messages) && parsed.messages.length > 0;
    if (hasMessages) {
      setMessages(parsed.messages);
      if (typeof parsed.conversationMode === "string") setConversationMode(parsed.conversationMode);
      else setConversationMode("chat");

      if (typeof parsed.onboardingStep === "number") setOnboardingStep(parsed.onboardingStep);
      else setOnboardingStep(2);

      if (parsed.placement && typeof parsed.placement === "object") {
        setPlacement({
          levelText: typeof parsed.placement.levelText === "string" ? parsed.placement.levelText : "",
          focusText: typeof parsed.placement.focusText === "string" ? parsed.placement.focusText : "",
        });
      }
    } else {
      startOnboarding({ nextNativeLanguage, nextTargetLanguage });
    }

    if (parsed.active && typeof parsed.active === "object") setActive(parsed.active);
    if (parsed.attempt !== undefined) setAttempt(parsed.attempt);
    if (parsed.pendingProposal && typeof parsed.pendingProposal === "object") setPendingProposal(parsed.pendingProposal);

    if (!parsed.active && parsed.problem && typeof parsed.problem === "object") {
      setActive(parsed.problem);
    }

    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const state = {
      nativeLanguage,
      targetLanguage,
      messages,
      conversationMode,
      onboardingStep,
      placement,
      active,
      attempt,
      pendingProposal,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, nativeLanguage, targetLanguage, messages, conversationMode, onboardingStep, placement, active, attempt, pendingProposal]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  const exercise = useMemo(() => renderExercise(active), [active]);

  const showExercisePanel = !!exercise;
  const exerciseColClass = (() => {
    if (!showExercisePanel) return "";
    const t = active?.problem_type;
    if (t === "fill_in_blank") return "md:col-span-6";
    return "md:col-span-5";
  })();
  const chatColClass = (() => {
    if (!showExercisePanel) return "md:col-span-12";
    if (exerciseColClass === "md:col-span-6") return "md:col-span-6";
    return "md:col-span-7";
  })();

  function makeActiveFromProposal(proposal) {
    if (!proposal || proposal.enabled !== 1 || !proposal.problem_type) return null;
    return {
      enabled: 1,
      exercise_id: proposal.proposal_id ?? null,
      problem_type: proposal.problem_type,
      translation: proposal.translation ?? null,
      fill_in_blank: proposal.fill_in_blank ?? null,
      multiple_choice: proposal.multiple_choice ?? null,
      free_response: proposal.free_response ?? null,
    };
  }

  function defaultAttemptForActive(nextActive) {
    if (!nextActive || nextActive.enabled !== 1 || !nextActive.problem_type) return null;
    if (nextActive.problem_type === "fill_in_blank" && nextActive.fill_in_blank?.blanks) {
      const obj = {};
      for (const b of nextActive.fill_in_blank.blanks) {
        if (b?.id) obj[b.id] = "";
      }
      return obj;
    }
    if (nextActive.problem_type === "multiple_choice") {
      return [];
    }
    return "";
  }

  function normalizeText(s) {
    return String(s ?? "")
      .trim()
      .toLowerCase();
  }

  function gradeObjective(nextActive, nextAttempt) {
    if (!nextActive || nextActive.enabled !== 1 || !nextActive.problem_type) return null;

    if (nextActive.problem_type === "fill_in_blank" && nextActive.fill_in_blank?.blanks) {
      const results = [];
      let allCorrect = true;
      for (const b of nextActive.fill_in_blank.blanks) {
        const userVal = normalizeText(nextAttempt?.[b.id] ?? "");
        const expected = Array.isArray(b.expected_answers) ? b.expected_answers : [];
        const ok = expected.map(normalizeText).includes(userVal);
        results.push({ id: b.id, correct: ok });
        if (!ok) allCorrect = false;
      }
      return { kind: "fill_in_blank", allCorrect, results };
    }

    if (nextActive.problem_type === "multiple_choice" && nextActive.multiple_choice) {
      const selected = Array.isArray(nextAttempt) ? nextAttempt.map(String) : [];
      const correct = Array.isArray(nextActive.multiple_choice.correct_option_ids)
        ? nextActive.multiple_choice.correct_option_ids.map(String)
        : [];

      const setEq = (a, b) => {
        if (a.length !== b.length) return false;
        const sa = new Set(a);
        for (const x of b) if (!sa.has(x)) return false;
        return true;
      };

      const allCorrect = setEq([...new Set(selected)].sort(), [...new Set(correct)].sort());
      return { kind: "multiple_choice", allCorrect };
    }

    return null;
  }

  async function callApi({ mode, userText, messagesOverride, cleared, clearedOutcome }) {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        userText,
        messages: Array.isArray(messagesOverride) ? messagesOverride : messages,
        config: { nativeLanguage, targetLanguage },
        active,
        attempt,
        cleared,
        clearedOutcome,
      }),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = typeof json?.error === "string" ? json.error : `Request failed (${resp.status})`;
      throw new Error(msg);
    }

    return json;
  }

  async function triggerPostClear({ cleared, clearedOutcome, messagesOverride }) {
    setError("");
    setLoading(true);
    try {
      const result = await callApi({
        mode: "post_clear",
        userText: "post_clear",
        messagesOverride,
        cleared,
        clearedOutcome,
      });

      if (typeof result?.response === "string") {
        setMessages((prev) => {
          const msg = { role: "assistant", content: result.response, flags: result.flags };
          if (result?.proposal?.enabled === 1) msg.proposal = result.proposal;
          if (result?.poll?.enabled === 1) msg.poll = result.poll;
          return [...prev, msg];
        });
      }

      if (result?.proposal?.enabled === 1) {
        setPendingProposal(result.proposal);
      }
    } catch (e) {
      setError(e.message);
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function onSend() {
    const text = inputText.trim();
    if (!text || loading) return;
    setInputText("");
    await sendText(text);
  }

  function markPollAnswered({ idx, optionId }) {
    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        if (!m?.poll || m.poll?.enabled !== 1) return m;
        return { ...m, poll_answer: { option_id: optionId } };
      })
    );
  }

  async function onPollOption(idx, poll, option) {
    if (loading) return;
    if (!poll || poll.enabled !== 1) return;
    if (typeof option?.id !== "string") return;

    markPollAnswered({ idx, optionId: option.id });

    const idLooksGood = /^[a-z0-9_\-]{1,32}$/i.test(option.id);
    const reply = idLooksGood ? option.id : String(option?.text ?? option.id);
    await sendText(reply);
  }

  async function sendText(text) {
    const cleaned = String(text ?? "").trim();
    if (!cleaned || loading) return;

    setError("");

    const history = messages;
    const nextMessages = [...history, { role: "user", content: cleaned }];
    setMessages(nextMessages);

    if (conversationMode === "onboarding") {
      if (onboardingStep === 0) {
        setPlacement((prev) => ({ ...prev, levelText: cleaned }));
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `2) What do you want to focus on right now? (speaking, writing, grammar, vocab, travel, work, etc.)`,
          },
        ]);
        setOnboardingStep(1);
        return;
      }

      if (onboardingStep === 1) {
        const reportedLevel = placement?.levelText ?? "";
        const approxLevel = inferApproxLevel(reportedLevel);
        setPlacement((prev) => ({ ...prev, focusText: cleaned }));

        setLoading(true);
        try {
          const placementRequest = [
            "We are starting a new conversation and need a placement exercise.",
            `User self-reported level: ${reportedLevel}`,
            `Approx level (coarse): ${approxLevel}`,
            `User focus: ${cleaned}`,
            "Task: Propose exactly one placement exercise as proposal.enabled=1 with proposal.problem_type=free_response.",
            "Do not propose any other exercise types.",
            "In response, briefly acknowledge the info and instruct the user to click Start exercise.",
          ].join("\n");

          const result = await callApi({ mode: "chat", userText: placementRequest, messagesOverride: nextMessages });

          setConversationMode("chat");
          setOnboardingStep(2);

          if (typeof result?.response === "string") {
            setMessages((prev) => {
              const msg = { role: "assistant", content: result.response, flags: result.flags };
              if (result?.proposal?.enabled === 1) msg.proposal = result.proposal;
              if (result?.poll?.enabled === 1) msg.poll = result.poll;
              return [...prev, msg];
            });
          }

          if (result?.proposal?.enabled === 1) {
            setPendingProposal(result.proposal);
          }

          if (result?.clear_active === 1) {
            setActive(null);
            setAttempt(null);
            setGrade(null);
          }
        } catch (e) {
          setError(e.message);
          setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
        } finally {
          setLoading(false);
        }

        return;
      }
    }

    const requestMode = active && active.enabled === 1 && active.problem_type ? "help" : "chat";

    setLoading(true);
    try {
      const result = await callApi({ mode: requestMode, userText: cleaned, messagesOverride: nextMessages });

      if (typeof result?.response === "string") {
        setMessages((prev) => {
          const msg = { role: "assistant", content: result.response, flags: result.flags };
          if (result?.proposal?.enabled === 1) msg.proposal = result.proposal;
          if (result?.poll?.enabled === 1) msg.poll = result.poll;
          return [...prev, msg];
        });
      }

      if (result?.clear_active === 1 && active && active.enabled === 1) {
        const cleared = active;
        const clearedOutcome = { kind: "model_clear" };
        setActive(null);
        setAttempt(null);
        setGrade(null);

        const postClearMessages = [...nextMessages, { role: "assistant", content: result.response }];
        await triggerPostClear({ cleared, clearedOutcome, messagesOverride: postClearMessages });
      }

      if (result?.proposal?.enabled === 1) {
        setPendingProposal(result.proposal);
      }
    } catch (e) {
      setError(e.message);
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitExercise() {
    if (!active || active.enabled !== 1 || loading) return;

    if (active.problem_type === "fill_in_blank" || active.problem_type === "multiple_choice") {
      onSubmitObjective();
      return;
    }

    const userText = "Please review my attempt and help me improve.";

    setError("");
    setLoading(true);
    try {
      const result = await callApi({ mode: "help", userText, messagesOverride: messages });

      if (typeof result?.response === "string") {
        setMessages((prev) => {
          const msg = { role: "assistant", content: result.response, flags: result.flags };
          if (result?.proposal?.enabled === 1) msg.proposal = result.proposal;
          if (result?.poll?.enabled === 1) msg.poll = result.poll;
          return [...prev, msg];
        });
      }

      if (result?.clear_active === 1) {
        const cleared = active;
        const clearedOutcome = { kind: "model_clear" };
        setActive(null);
        setAttempt(null);
        setGrade(null);

        const postClearMessages = [...messages, { role: "assistant", content: result.response }];
        await triggerPostClear({ cleared, clearedOutcome, messagesOverride: postClearMessages });
      }

      if (result?.proposal?.enabled === 1) {
        setPendingProposal(result.proposal);
      }
    } catch (e) {
      setError(e.message);
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function onNewConversation() {
    if (loading) return;
    startOnboarding();
  }

  function onStartProposal(proposal) {
    if (loading) return;
    const nextActive = makeActiveFromProposal(proposal);
    if (!nextActive) return;
    setActive(nextActive);
    setAttempt(defaultAttemptForActive(nextActive));
    setGrade(null);
    if (proposal?.proposal_id && pendingProposal?.proposal_id === proposal.proposal_id) {
      setPendingProposal(null);
    }
  }

  function onClearActive() {
    if (loading) return;
    if (!active || active.enabled !== 1) return;
    const cleared = active;
    const clearedOutcome = { kind: "user_cleared" };
    setActive(null);
    setAttempt(null);
    setGrade(null);
    triggerPostClear({ cleared, clearedOutcome });
  }

  function onSubmitObjective() {
    if (!active || active.enabled !== 1) return;
    const g = gradeObjective(active, attempt);
    if (!g) return;
    setGrade(g);
    if (g.allCorrect) {
      const cleared = active;
      const clearedOutcome = { kind: "objective_correct" };
      setActive(null);
      setAttempt(null);
      triggerPostClear({ cleared, clearedOutcome });
    } else {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.help_offer?.enabled === 1 && last?.help_offer?.exercise_id === active?.exercise_id) return prev;
        return [
          ...prev,
          {
            role: "assistant",
            content: "It looks like that answer isn't fully correct. Want help?",
            help_offer: { enabled: 1, exercise_id: active?.exercise_id ?? null },
          },
        ];
      });
    }
  }

  async function onAcceptHelpOffer(idx) {
    if (loading) return;
    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        if (m?.help_offer?.enabled !== 1) return m;
        if (m?.help_offer_accepted === 1) return m;
        return { ...m, help_offer_accepted: 1 };
      })
    );
    await sendText("Yes — please help me with this exercise.");
  }

  function toggleMcOption(id) {
    if (!active?.multiple_choice) return;

    const allowMultiple = !!active.multiple_choice.allow_multiple;
    const selected = Array.isArray(attempt) ? attempt.map(String) : [];

    if (!allowMultiple) {
      setAttempt([String(id)]);
      return;
    }

    const set = new Set(selected);
    if (set.has(String(id))) set.delete(String(id));
    else set.add(String(id));
    setAttempt([...set]);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-lg font-semibold">Language</div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onNewConversation}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                New
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">Native language</div>
              <input
                value={nativeLanguage}
                onChange={(e) => setNativeLanguage(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">Target language</div>
              <input
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {error ? <div className="text-sm text-red-300">{error}</div> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className={chatColClass}>
            <div className="flex h-[60vh] flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40">
              <div className="flex-1 overflow-y-auto p-4">
                {messages.length === 0 ? (
                  <div className="text-sm text-zinc-400">
                    Type a message to start. The assistant may propose an exercise.
                  </div>
                ) : null}

                <div className="flex flex-col gap-3">
                  {messages.map((m, idx) => (
                    <div key={idx} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                      <div
                        className={
                          m.role === "user"
                            ? "max-w-[85%] rounded-2xl bg-indigo-600 px-4 py-2 text-sm text-white"
                            : "max-w-[85%] rounded-2xl bg-zinc-800 px-4 py-2 text-sm text-zinc-100"
                        }
                      >
                        {renderMessageContent(m)}

                        {m.role === "assistant" && m.proposal?.enabled === 1 ? (
                          <div className="mt-3 rounded-xl border border-zinc-700 bg-zinc-900/60 p-3">
                            <div className="text-xs text-zinc-300">Proposed exercise</div>
                            <div className="mt-1 text-sm text-zinc-100">
                              {m.proposal.problem_type}
                            </div>
                            <div className="mt-3">
                              <button
                                onClick={() => onStartProposal(m.proposal)}
                                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                              >
                                Start exercise
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {m.role === "assistant" && m.poll?.enabled === 1 ? (
                          <div className="mt-3 rounded-xl border border-zinc-700 bg-zinc-900/60 p-3">
                            <div className="text-xs text-zinc-300">Quick choice</div>
                            <div className="mt-1 text-sm text-zinc-100">
                              <MarkdownContent text={m.poll.question} />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {Array.isArray(m.poll.options)
                                ? m.poll.options.map((o) => {
                                    const answered = m?.poll_answer?.option_id != null;
                                    const chosen = String(m?.poll_answer?.option_id ?? "") === String(o.id);
                                    return (
                                      <button
                                        key={o.id}
                                        onClick={() => onPollOption(idx, m.poll, o)}
                                        disabled={loading || answered}
                                        className={
                                          chosen
                                            ? "rounded-lg border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                                            : "rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
                                        }
                                      >
                                        {o.text}
                                      </button>
                                    );
                                  })
                                : null}
                            </div>
                          </div>
                        ) : null}

                        {m.role === "assistant" && m.help_offer?.enabled === 1 ? (
                          <div className="mt-3 rounded-xl border border-zinc-700 bg-zinc-900/60 p-3">
                            <div className="text-xs text-zinc-300">Need a hint?</div>
                            <div className="mt-3">
                              <button
                                onClick={() => onAcceptHelpOffer(idx)}
                                disabled={loading || m?.help_offer_accepted === 1}
                                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                              >
                                Yes
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  {loading ? (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl bg-zinc-800 px-4 py-2 text-sm text-zinc-300">
                        Thinking...
                      </div>
                    </div>
                  ) : null}

                  <div ref={bottomRef} />
                </div>
              </div>

              <div className="border-t border-zinc-800 p-3">
                <div className="flex gap-2">
                  <input
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                      }
                    }}
                    placeholder="Message..."
                    className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  />
                  <button
                    onClick={onSend}
                    disabled={loading}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>

          {showExercisePanel ? (
            <div className={exerciseColClass}>
              <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-sm font-semibold">Exercise</div>

                <div className="flex flex-col gap-3">
                  <div className="text-sm text-zinc-200">{exercise.title}</div>
                  <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <MarkdownContent text={exercise.lines.join("\n\n")} />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-zinc-400">Your attempt</div>
                      <button
                        onClick={onClearActive}
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs hover:bg-zinc-800"
                      >
                        Clear
                      </button>
                    </div>

                    {active?.problem_type === "fill_in_blank" && active.fill_in_blank?.blanks ? (
                      <div className="flex flex-col gap-2">
                        {active.fill_in_blank.blanks.map((b) => (
                          <div key={b.id} className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-200">
                              {(() => {
                                const raw = String(b.text_with_placeholder ?? "");
                                const parts = raw.split(/_{2,}/);
                                const val = typeof attempt?.[b.id] === "string" ? attempt[b.id] : "";
                                if (parts.length < 2) {
                                  return (
                                    <>
                                      <span>{raw}</span>
                                      <input
                                        value={val}
                                        onChange={(e) => setAttempt((prev) => ({ ...(prev || {}), [b.id]: e.target.value }))}
                                        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                                      />
                                    </>
                                  );
                                }

                                const after = parts.slice(1).join("____");
                                return (
                                  <>
                                    <span>{parts[0]}</span>
                                    <input
                                      value={val}
                                      onChange={(e) => setAttempt((prev) => ({ ...(prev || {}), [b.id]: e.target.value }))}
                                      className="w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-zinc-500"
                                    />
                                    <span>{after}</span>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        ))}

                        {grade?.kind === "fill_in_blank" ? (
                          <div className={grade.allCorrect ? "text-sm text-green-300" : "text-sm text-yellow-200"}>
                            {grade.allCorrect ? "All correct." : "Some blanks are incorrect."}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {active?.problem_type === "multiple_choice" && active.multiple_choice ? (
                      <div className="flex flex-col gap-2">
                        {active.multiple_choice.options.map((o) => {
                          const selected = Array.isArray(attempt) ? attempt.map(String) : [];
                          const checked = selected.includes(String(o.id));

                          return (
                            <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                              <input
                                type={active.multiple_choice.allow_multiple ? "checkbox" : "radio"}
                                checked={checked}
                                onChange={() => toggleMcOption(o.id)}
                                className="mt-1"
                              />
                              <div className="text-sm text-zinc-200">{o.text}</div>
                            </label>
                          );
                        })}

                        {grade?.kind === "multiple_choice" ? (
                          <div className={grade.allCorrect ? "text-sm text-green-300" : "text-sm text-yellow-200"}>
                            {grade.allCorrect ? "Correct." : "Not quite."}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {active?.problem_type === "translation" || active?.problem_type === "free_response" ? (
                      <div className="flex flex-col gap-1">
                        <textarea
                          value={typeof attempt === "string" ? attempt : ""}
                          onChange={(e) => setAttempt(e.target.value)}
                          className="min-h-[110px] w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        />
                        <div className="text-xs text-zinc-500">Saved locally. Click Submit for feedback.</div>
                      </div>
                    ) : null}

                    <button
                      onClick={onSubmitExercise}
                      disabled={loading || !active || active.enabled !== 1}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      Submit
                    </button>
                  </div>
                </div>
                <div className="mt-4 text-xs text-zinc-500">
                  Prompts come from the repo-level prompts.json. Schema comes from schema.json.
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

}
