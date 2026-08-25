# LearnAI

**Your teacher, available after class.**

LearnAI lets a real teacher record themselves once, then turns that recording into an AI tutor that keeps teaching in *their* voice, *their* explaining style, and *their* syllabus — so a student who didn't follow the lesson at 10am can still get help at 10pm from the same teacher they trust.

It is not a generic chatbot with a school skin. Every answer a student receives is shaped by a specific teacher's detected teaching style, spoken with a voice matched to that teacher, bounded to that student's board and grade curriculum, and logged back to the teacher as a private insight so they know what their class actually struggled with.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Architecture](#architecture)
- [Feature tour — student](#feature-tour--student)
- [Feature tour — teacher](#feature-tour--teacher)
- [The AI layer](#the-ai-layer)
- [Voice, audio and video pipeline](#voice-audio-and-video-pipeline)
- [The quiz engine](#the-quiz-engine)
- [Privacy model](#privacy-model)
- [Design system: Split-Flap Concourse](#design-system-split-flap-concourse)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database and seeding](#database-and-seeding)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Known issues and limitations](#known-issues-and-limitations)

---

## Why this exists

A good teacher explains one concept five different ways until it lands. But the teacher goes home at 4pm, and the student gets stuck at 9pm. Generic AI tutors fill that gap with a *different* voice, a *different* method, and often the wrong syllabus — which contradicts the classroom instead of extending it.

LearnAI's bet is that **continuity of teaching identity** matters more than raw model quality:

| Problem | LearnAI's answer |
| --- | --- |
| AI explains differently from the class teacher | Teacher's style is auto-detected from a 35s voice sample and injected into every system prompt |
| AI sounds like a robot, not a person | Voice cloning at onboarding, plus per-teacher neural voice assignment for playback |
| AI answers off-syllabus | Every request carries a context block: board, grade, subject, lesson, and the lesson's exact topic list |
| AI does the homework for the student | Socratic-by-default prompts, hint-only homework photo mode, and reveal-gating in quizzes |
| Teachers have no idea what students didn't understand | Every Learn turn is logged and turned into private, subject-scoped teacher insights |
| Teachers can't correct the AI's behaviour | The Tune Lab lets teachers preview and adjust how their AI self explains, then publish those preferences to students |

---

## Architecture

![LearnAI architecture](docs/learnai-architecture.png)

One Next.js 16 application contains both the React UI and the entire backend. There is no separate API server.

```
Browser (React 19)
  │  axios → /api/*
  ▼
web/src/app/api/[...slug]/route.js     ← single catch-all route (nodejs runtime, maxDuration 300s)
  │
  ▼
web/src/lib/api.js                     ← hand-rolled router: `slug + method` → handler
  ├── auth.js          HMAC tokens, role guards
  ├── openai.js        Azure OpenAI model router (chat)
  ├── azureSpeech.js   Azure fast transcription (STT)
  ├── azureTts.js      Azure neural TTS + SSML + voice assignment
  ├── gemini.js        Gemini vision (homework photos)
  ├── elevenlabs.js    Voice cloning
  ├── did.js           D-ID talking avatar video
  ├── cloudinary.js    Avatar uploads
  ├── learnTurns.js    Learn logging + teacher insights
  ├── quizApi.js       Quiz sub-router → quizzes.js + quizStore.js
  └── prisma.js        PostgreSQL
```

**Why a catch-all instead of file-per-route:** all API surface lives in one readable dispatch table (`handleApi`), so adding an endpoint is one line and the whole contract is visible in a single screen. `maxDuration = 300` gives long AI calls (quiz generation, D-ID rendering) room to finish.

---

## Feature tour — student

The student app is a three-mode board: **Home**, **Learn**, **Quiz**.

### Home

- Two large entry cards — **Learn through Chat** ("Departures") and **Quiz** ("Arrivals").
- **Recommended next** banner: if the student has an open learning recommendation generated from a past quiz, it surfaces here with the reason ("Struggled with: unlike denominators. Review these in Learn through Chat…"). Dismissible.

### Learn through Chat

A deliberately gated flow — the student must pick a **teacher → subject → lesson** before chatting, so the AI never answers without curriculum context.

**Teacher marketplace.** A live list of every teacher on the platform showing name, detected teaching style, and aggregated star rating with review count. Search by name/school/style, filter by teaching style, sort by rating (both directions) or name. `has_cloned_voice` is exposed per teacher.

**Teacher-scoped curriculum.** This is a key design decision: after choosing a teacher, the student only sees subjects **that teacher actually teaches**, intersected with the student's own board + grade curriculum. Matching is fuzzy and alias-aware (`maths`/`math` → `mathematics`, `sst` → `socialscience`, prefix matching for words ≥4 chars) so "Mathematics" on a profile matches "Maths" in a syllabus.

**Progressive disclosure panels.** Subject → Lesson → Progress panels auto-collapse as you make each selection, so the column never gets stolen by a long syllabus list. A blocking overlay ("Before you click Learn") lists exactly which of the three prerequisites is still missing, with jump buttons.

**Three response modes:**

| Mode | What happens |
| --- | --- |
| **Text** | Markdown-rendered answer with LaTeX stripped to readable prose |
| **Audio** | Answer synthesised through the teacher's assigned neural voice, with an animated waveform, Play/Pause, Replay, 1×–2× speed control, and a **Text Form** toggle to read instead |
| **Video** | Answer text *plus* a D-ID talking-avatar clip driven by the teacher's profile photo and a gender-matched Microsoft neural voice |

**Four difficulty levels** — Beginner, Intermediate, Exam Preparation, Deep Understanding — each mapping to a distinct instruction block (sentence length limits, jargon policy, whether to connect to bigger ideas).

**Voice questions.** Mic button records via `MediaRecorder` (prefers `audio/webm`), posts the blob to `/api/chat/voice`, which transcribes with Azure and answers in one round trip. The thread row shows "Voice message" as a placeholder and is rewritten in place with the real transcript when it returns. The system prompt is augmented with a note that the last turn came from transcription, so the model resolves ambiguity conservatively.

**Homework Photo Help — hints only.** Camera or gallery upload, with an optional "What are you stuck on?" note.

- Images are downscaled client-side to a 1600px max edge and re-encoded as JPEG q0.85 before upload (files under 1.5MB that are already JPEG pass through untouched).
- Server accepts JPG/PNG/WEBP up to 8MB, rejects empty files.
- Routed to **Gemini** (vision) rather than the chat model, with a prompt that requires restating what it can read from the photo first, refuses to invent a problem from a blurry image, and never writes the final answer or completed working.
- **Sticky photo context:** once a photo is in the thread, subsequent typed messages automatically re-attach the same image with a "this is a follow-up, hints only" marker — so "why is step 2 wrong?" still sees the problem.
- The uploader is available both as a full panel and as a compact inline attachment in the chat composer.

**Know more (Story mode).** Every answer gets a "Know more" button that generates a curiosity layer — a short narrative opener plus 5–8 factual bullets about the topic. It runs at **temperature 0** with an aggressive anti-hallucination prompt: no invented numbers, dates, names, statistics or quotes; omit anything uncertain, disputed, or beyond grade level; never contradict the answer it's expanding on.

**Summarize.** Collapses the whole session into bullet points covering every topic discussed, explicitly forbidden from adding new information.

**Automatic progress tracking.** No manual checkboxes. After each answer, the app tokenises every topic title in the current lesson and marks a topic complete when ≥40% of its keywords (words longer than 2 characters) appear in the answer text. The Progress panel shows `n/m topics checked`.

**Past conversations.** The last 10 questions asked in the session, kept for quick reuse.

**Exit review.** Logging out *after* a real exchange opens a review modal: pick which teacher you talked to (auto-selected when there's only one), rate 1–5 stars, optionally leave a comment (255 chars). "Quit without review" always remains available. Submitting recomputes that teacher's rating aggregate immediately.

### Quiz mode

See [The quiz engine](#the-quiz-engine).

---

## Feature tour — teacher

### Onboarding: two steps to an AI teaching identity

**Step 1 — Teaching Content Setup**

- What you want to upload: *Syllabus Only* / *Study Materials* / *Both* (radio cards)
- Grades you handle (multi-select, Grade 1–12)
- Subjects you handle (comma-separated)
- Number of syllabi and/or reference materials, shown conditionally based on the upload preference

**Step 2 — Teach a topic, by voice**

Record (or upload) yourself explaining any topic as you would in class.

| Constraint | Value |
| --- | --- |
| Minimum length | 35 seconds |
| Maximum length | 5 minutes (recorder auto-stops) |
| Max upload size | ~24 MB |
| Accepted uploads | webm, wav, mp3, m4a, ogg |
| Recorder | `MediaRecorder`, 250ms timeslice, prefers `audio/webm` |

Duration detection is deliberately layered, because WebM blobs from `MediaRecorder` frequently ship without duration metadata: Web Audio API decode → HTML `<audio>` metadata → the live recording timer. Errors are specific ("Could not read audio length. If you uploaded a file, try MP3 or WAV…") rather than generic.

**What happens on submit** — a single request kicks off three things:

1. **Transcription** via Azure fast transcription. Transcripts under 100 characters are rejected with a request to speak longer.
2. **Voice cloning** via ElevenLabs (`POST /v1/voices/add`), stored as `elevenlabs_voice_id`.
3. **Teaching style detection** — the transcript is classified by the LLM into one of *Socratic, Storytelling, Concept-first, Exam-oriented, Visual explanation, Structured/Conceptual, General* (or a new ≤3-word Title Case label), returning a confidence score and reason. If the model call or JSON parse fails, a keyword-frequency heuristic takes over, so onboarding never dies on a flaky API call.

The detected style then drives every student-facing answer from that teacher for the rest of the product's life.

### Dashboard

Five tabs: **Overview · Insights · Quizzes · Tune · Profile**. The active tab survives navigation via `sessionStorage` (but resets on a genuine browser reload), so returning from a voice re-record lands you back on Tune.

#### Overview

Rating (`x.x / 5`, highlighted amber at ≥4.5) with total review count, detected teaching style with an explanatory blurb of what that style gives learners, unique learners helped, and a scrollable feed of student comments (rating ≥3 with text, newest first, up to 50).

#### Insights — "what my class actually didn't understand"

Built from `learn_turns`, the log of every student question answered in this teacher's subjects.

Per subject tab (with question counts): today's question count, **self-learned topics today** as chips, **frequent lessons** ranked by volume, **insights from questions** (AI bullets), and the 12 most recent questions with student name, lesson and timestamp.

The insight bullets are LLM-generated from up to 24 sampled questions, asked to focus on recurring doubts, likely misconceptions and what to reteach — and explicitly told not to invent student names. Two safety nets make this reliable:

- **Heuristic fallback:** if the LLM call or JSON parse fails, deterministic bullets are computed from lesson-frequency counts, unique student counts and today's activity.
- **Bounded LRU + TTL cache:** 48 entries, 10-minute TTL, keyed by teacher + subject + newest turn id + turn count — so repeat dashboard loads are free, and the cache self-invalidates the moment a new question arrives.

#### Quizzes

Full authoring lifecycle — see [The quiz engine](#the-quiz-engine).

#### Tune Lab — teach the AI how you'd say it

A private sandbox. Nothing here is scored, and nothing reaches students until explicitly saved.

1. Type a topic → **Generate Preview** produces an explanation in the teacher's own style (120–220 words, written as speech, with rules against condescension and apologetic openers).
2. **Quick tune** — three toggles: *Simplify explanation*, *Make it exam-focused*, *Add real-life example*. Tapping one runs a genuine **multi-turn** follow-up ("rewrite your previous explanation to…") against the existing draft, so you see a real revision rather than a fresh generation.
3. **Compare versions** — optional before/after side-by-side so you can judge whether the tune actually helped.
4. **Play / Replay** the preview in the teacher's assigned voice, and optionally generate a **talking-avatar clip** of it.
5. **Save preferences** — only this step publishes. Saved tune preferences are injected as extra instruction lines into the student-facing system prompt for every future answer from this teacher.

An unsaved-changes banner and rotating coaching hints ("There is no single 'right' version — pick what matches your classroom voice") keep the experience non-judgmental.

#### Profile / Account settings

- Avatar upload (modal, Escape-to-close, scroll lock; Cloudinary 512×512 fill transform)
- Display name and school
- **Password change** with a live 4-rule strength meter (8+ chars, upper+lower, digit, symbol) — no OTP needed since you're already signed in
- **Email change: a four-step, two-inbox verification.** Enter new address → verify a 6-digit code sent to your **current** inbox → verify a second code sent to your **new** inbox → done. Codes expire in 15 minutes and the flow is tracked server-side as `awaiting_old_otp` / `awaiting_new_otp`, so steps can't be skipped. Attempting to use an address already registered resets you to step 1.
- Password / email last-changed timestamps rendered as "Today" / "n days ago"
- Log out from all other devices

---

## The AI layer

### Prompt architecture: instructions are stable, context is per-message

The single most important structural decision in the codebase. System prompts contain only *stable* behaviour (who you are, how you teach, how deep to go, what format to reply in). All *volatile* session facts travel on the user message inside a context block:

```
Context (use this; do not ask the student to confirm it)
- Grade: 7
- Board: CBSE
- Subject: Science
- Current lesson / syllabus topic: Magnetism
- Topics in this lesson:
- Magnetic poles
- Magnetic field
- Electromagnets
- Difficulty: beginner
- Reply format: text

Student message:
Why does a compass point north?
```

The instructions explicitly say: *"Do not ask the student for grade, board, chapter, or syllabus. Do not stall with profile questions."* This removes the single most annoying failure mode of school chatbots — being interrogated about your class before getting an answer.

### The system prompt is composed, not written

`buildTeacherSystemPrompt()` assembles five independent blocks:

| Block | Source |
| --- | --- |
| Base tutor charter | `LEARN_AI_INSTRUCTIONS` — Socratic default, refuse answer-dumping, escalate hints only after two genuine attempts |
| Teacher persona | `"You are speaking as {name}, teaching at {school}"` — reply only as this teacher, never break character |
| Teaching style | One of 5 detailed style scripts (Socratic / Storytelling / Concept-first / Exam-oriented / Visual explanation), each with concrete phrasing patterns |
| Tune preferences | Extra lines derived from what the teacher saved in the Tune Lab |
| Difficulty + format | One of 4 difficulty blocks × one of 3 response-format blocks |

So a Storytelling teacher at Exam difficulty in Audio mode produces a materially different prompt from a Socratic teacher at Beginner in Text mode — from the same code path.

### Pedagogical guardrails, enforced in prompt *and* in code

- **Learn chat:** never the full solution or final numeric answer on the first reply; refuse "just give me the answer"; on a wrong attempt say what's wrong in 1–2 sentences then give direction, not working.
- **Homework photos:** hints only, one step at a time, never solve every sub-part, and say so honestly when the image is unreadable.
- **Quizzes:** the correct answer and explanation are withheld *server-side* — not merely "please don't tell them" — until the student answers correctly or has two incorrect attempts. The tutor prompt receives `Correct answer is hidden. Do not reveal it.` instead of the answer.
- **Story mode:** temperature 0 and an explicit "omit rather than guess" rule.

### Model routing and resilience

`chatCompletion()` targets Azure OpenAI / Microsoft Foundry and tries **four** URL shapes in order, breaking early only on 401/403:

1. `/openai/v1/chat/completions` with the configured deployment as `model` in the body
2. `/openai/deployments/{deployment}/chat/completions?api-version=…` (classic)
3. and 4. the same two against the `model-router` deployment

This means the same env config works against the new v1 surface, classic deployment routing, and the Foundry model router without code changes. Every AI feature degrades rather than fails: insights fall back to heuristics, style detection falls back to keywords, quiz insights fall back to raw narrative text, Azure TTS falls back to browser speech synthesis.

### Where each model is used

| Feature | Provider |
| --- | --- |
| Learn chat, summarize, story mode, tune preview, style detection, insights, quiz generation, quiz tutor, quiz analytics | Azure OpenAI (model router) |
| Homework photo hints (vision) | Google Gemini (`gemini-2.0-flash`, temperature 0.6) |
| Speech to text | Azure Speech fast transcription |
| Text to speech | Azure Speech neural voices |
| Voice cloning | ElevenLabs |
| Talking avatar video | D-ID (Microsoft neural voice provider) |
| Image hosting | Cloudinary |

---

## Voice, audio and video pipeline

### Speech to text

Azure fast transcription (`/speechtotext/transcriptions:transcribe?api-version=2024-11-15`) with locale mapping for **en, hi, ta, te, kn, ml, mr, bn, gu, pa, ur** — Indian-language input is a first-class path, not an afterthought. Transcript extraction handles three different response shapes (`combinedPhrases`, `phrases[]`, `text`/`DisplayText`).

### Text to speech: making each teacher sound like a different person

Naive per-teacher TTS gives everyone the same voice. LearnAI does three things instead:

1. **Gender inference** from the teacher's name — honorifics (`Mr`/`Mrs`/`Ms`/`Miss`), a curated first-name list spanning Indian and Western names, `Dr`/`Prof` prefix skipping, and a demo-teacher override table.
2. **Peer-ranked voice assignment** — teachers of the same inferred gender are sorted by id and assigned *different* voices from a 3-voice pool (overflow shares the last slot). Two female teachers get Ava and Emma, not Ava twice.
3. **Multilingual neural voices with fallbacks** — e.g. `en-US-AvaMultilingualNeural` → `en-US-AvaNeural`, chosen over Indic neural voices because they sound markedly less robotic on mixed English/Hindi text.

Synthesis is tuned for classroom listening: SSML with `<mstts:express-as style="friendly" styledegree="1.15">`, `pitch="+1%"`, and rate deliberately scaled to **0.94×** the requested speed because raw 1.0× reads too fast for explanation. Output is 24kHz 160kbit mono MP3. The request retries across two endpoint shapes × styled/unstyled SSML × primary/fallback voice, and rejects sub-32-byte responses as empty audio.

### Browser fallback chain

If Azure TTS is unavailable, the client falls back to `window.speechSynthesis` — with its own voice-picking logic that solves a real cross-platform annoyance: `"Google US English Male"` must not be matched as female just because it contains `"google us english"`. Male/female detection uses negative lookaheads, curated needles (zira, irina, samantha, hazel, …), and a final guarantee that the two selected voices are actually distinct when the engine exposes more than one.

### LaTeX sanitisation for speech and display

Models emit LaTeX. Speech engines read it aloud as "backslash frac". Two related utilities handle this:

- `sanitizeMathForSpeech()` — converts math to spoken English (`\frac{a}{b}` → `"a over b"`, `\leq` → `"is less than or equal to"`, `\sqrt{x}` → `"square root of x"`) and strips remaining commands. Applied before TTS and before D-ID scripts.
- `formatAnswerForDisplay()` — same stripping, but preserves newlines and additionally promotes inline teaching labels (`Definition:`, `Example:`, `Key Takeaway:`, `Step 3:`) to bold markdown headings on their own lines, then normalises unicode asterisk variants and `**bold**` spacing. This is why answers render as structured, scannable steps instead of a wall of text.

### Talking-avatar video

`POST /api/chat/video` creates a D-ID talk from the teacher's Cloudinary avatar (rewritten to `f_jpg` for D-ID compatibility) and polls up to 80 times at 2s intervals (~160s). Still rendering → HTTP 202 with a "try again shortly" payload rather than a hang. The UI distinguishes billing/quota failures (HTTP 402), missing avatars, pending renders, and playback errors, each with its own actionable message.

---

## The quiz engine

### Teacher side: generate → review → publish

**Cascading curriculum picker:** Grade → Board/class → Subject → Lesson → Topic (optional, defaults to "Entire lesson"), plus question count (1–20, default 6) and difficulty (Beginner / Intermediate / Exam). Only subjects the teacher actually teaches are listed, and the endpoint enforces this server-side too. Where a grade has no seeded syllabus, the picker falls back to the closest matching curriculum and says so explicitly.

**Generation** asks for strict JSON and supports three question types:

| Type | Options | Correct answer |
| --- | --- | --- |
| `mcq` | Exactly 4 (A–D), plausible distractors | Option id |
| `true_false` | Normalised server-side to True/False | `"true"` / `"false"` |
| `short` | none | Concise expected answer |

Every question also carries an `explanation` and a `misconception_hint` (the likely wrong idea students hold).

**Output is never trusted.** `extractJson()` strips markdown fences, tries a whole-body parse, then falls back to first-`{`-to-last-`}` slicing. `validateQuestion()` then enforces per-type invariants — MCQs need 4 non-empty options with the correct answer actually present among ids or texts, true/false answers must be boolean-ish — and silently drops anything malformed. A partial-but-valid set is accepted; zero valid questions returns a clean 502 rather than an empty quiz.

**Review before publish.** Each question can be edited in place (prompt, every option, correct answer, explanation), **regenerated** by AI on the same lesson and topic ("do not copy the old prompt wording"), or removed. Publishing stamps `published_at`, flips status to `published`, and recomputes the question count.

### Student side: the tutor that won't just tell you

Quizzes appear bucketed as **In progress / Available / Completed** for the student's grade, with Continue / Start / Review actions. Resume opens the first unanswered question automatically.

The screen is split: question on the left, **Quiz companion** on the right.

**Answer grading is forgiving where it should be.** MCQ answers match by option id *or* option text. True/false accepts `true/t/yes/1` and `false/f/no/0`. Short answers try exact match, then alphanumeric-compacted match, then substring containment for expected answers longer than 3 characters — so "photosynthesis." and "Photosynthesis" both count.

**The reveal gate.** This is the pedagogical core:

- Wrong answers can be resubmitted without limit; each attempt increments `incorrect_attempts` and `hint_count`.
- `correct_answer` and `explanation` are `null` in the API response until the student is correct **or** has two incorrect attempts.
- Every submission automatically triggers the Socratic tutor with a different instruction depending on correctness — confirm and explain *why* when right, name the likely mistake and hint when wrong.
- Students can also chat freely with the tutor at any time. Asking for the answer before attempting is refused by prompt design.
- Tutor exchanges are persisted per question as a `tutor_thread`, so hints survive reload and are visible in the resumed attempt.

**Scoring rewards first-try understanding.** The score counts only `first_is_correct` answers, so retrying until correct teaches you the concept but doesn't inflate the grade. `time_ms` accumulates across attempts per question.

**On completion**, a summary is computed (`weak_topics`, up to 8 `missed` items) and — automatically — a **learning recommendation** row is written linking the student back to Learn mode: *"Struggled with: X, Y. Review these in Learn through Chat, then try a short practice quiz."* Strong performances get an encouragement variant instead. That recommendation is what the student sees on their Home screen the next time they log in, closing the loop between assessment and tutoring.

### Teacher analytics

Deterministic statistics, computed not guessed: average / highest / lowest / median score, a 5-bucket score distribution (0–20 … 80–100), completion rate, average time, attempted and completed counts.

Per question: percent correct (first attempt), most commonly selected wrong answer, an auto-assigned difficulty label (`hard` <40%, `medium` <70%, else `easy`), average time, and how many students needed hints.

On top of that, **Generate AI insights** produces a structured teacher briefing — headline, difficult topics, misunderstood concepts, high-failure questions, students needing support, revision topics, strengths, and a narrative — cached on the quiz row so it isn't regenerated on every page view. Clicking any student opens an AI-written per-student summary (strong/weak topics, repeated mistakes, pacing pattern, improvement trend, recommendation) built from their full history on that teacher's quizzes.

---

## Privacy model

Teacher insights are scoped by construction, not by filtering after the fact.

- A Learn turn is only recorded **if the subject the student asked about matches a subject on that teacher's profile** (`matchTeacherSubject`). Ask a Physics teacher about History and nothing is logged.
- `GET /api/teacher/insights` reads only rows where `teacher_id` is the requesting teacher. The UI states it plainly: *"Other teachers cannot see this."*
- Only a 400-character `answer_preview` is stored, not the full answer body.
- Topic arrays are capped at 12 entries of 120 chars; questions at 8000 chars.
- Quiz ownership is checked on every teacher quiz route; attempt ownership on every student attempt route.
- Student quiz insights are restricted to quizzes owned by the requesting teacher.

---

## Design system: Split-Flap Concourse

The UI is themed as an airport departure board — matte black flap faces, brushed steel rails, white condensed caps, amber delay lamps. Students browse teacher rows the way travellers scan departures; teachers scan impact rows the same way.

- **Tokens** (`globals.css`): `--board-steel #1a1a1a`, `--board-steel-deep #0c0c0c`, `--board-rule #2e2e2e`, `--flap-face #141414`, `--flap-ink #f5f5f0`, `--flap-mute #8a8a82`, `--flap-amber #d97706`, `--flap-cancel #b91c1c`. Always dark (`color-scheme: dark`).
- **Type:** Barlow Condensed for chrome, labels and buttons (uppercase, wide tracking); Source Sans 3 for body copy.
- **Primitives** (`components/ui/Board.jsx`): `BoardShell`, `BoardHeader`, `FlapTab`, `FlapPanel`, `FlapPanelHead`, `FlapRow`, `FlapButton`, `FlapInput`.
- **Motion, used sparingly:** `flap-flip` (a 220ms perspective rotate when a row becomes selected), `auth-fade-in`, and a pulsing 7-bar audio waveform during playback.
- **Texture:** tiled `flap-face.png` in soft-light blend on panels and cells, `steel-frame.png` on the top/bottom rails. Both PNGs ship with their generation prompt alongside them (`*.png.prompt.txt`) so the assets carry their own provenance.
- `/board-preview` renders the primitives with static data for craft review without auth.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.3.1 (App Router) |
| UI | React 19.2.8, Tailwind CSS v4 (`@tailwindcss/postcss`) |
| Markdown | `react-markdown` + `remark-gfm` |
| HTTP client | axios (per-call timeouts) |
| Database | PostgreSQL via Prisma 6 |
| Auth | HMAC-SHA256 signed tokens, bcrypt (cost 12) |
| Mail | nodemailer (optional; console fallback) |
| Language | JavaScript (JSX), no TypeScript |
| Lint | ESLint 9 + `eslint-config-next` |

---

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- API keys for the features you want to exercise (see below — the app runs without them, those features return clear configuration errors)

### Install and run

```bash
cd web
npm install
cp .env.example .env      # then fill in DATABASE_URL and any keys you have
npm run db:setup          # prisma generate + db push + seed
npm run dev               # http://localhost:3000
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | `prisma generate && next build --webpack` |
| `npm start` | Production server |
| `npm run lint` | ESLint |
| `npm run db:push` | Push the Prisma schema to the database |
| `npm run db:seed` | Seed boards, grades and the sample syllabus |
| `npm run db:setup` | generate + push + seed, in one go |
| `npm run db:import` | Import a legacy MySQL dump into PostgreSQL |
| `npm run db:setup:pg` | generate + push + import |

Two standalone connectivity checks live in `web/scripts/`: `test-azure-tts.mjs` and `test-azure-stt.mjs` — useful for verifying Speech credentials without booting the app.

---

## Environment variables

Copy `web/.env.example` to `web/.env`.

### Core

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | HMAC signing key for tokens — **change this in production** |
| `APP_DEBUG` | `true` returns OTP codes in API responses for local development |
| `NEXT_PUBLIC_APP_NAME` | Display name |

### AI and media

| Variable | Powers |
| --- | --- |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | All chat, insights, quiz generation and tutoring. `API_VERSION` is only needed for classic deployment routing |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Homework photo hints (vision). Defaults to `gemini-2.0-flash` |
| `AZURE_SPEECH_TO_TEXT_ENDPOINT`, `AZURE_SPEECH_TO_TEXT_API_KEY` | Teacher onboarding transcription and student voice questions |
| `AZURE_TEXT_TO_SPEECH_ENDPOINT`, `AZURE_TEXT_TO_SPEECH_API_KEY` | Audio-mode answers and Tune Lab playback |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_BASE_URL`, `ELEVENLABS_TTS_MODEL` | Teacher voice cloning at onboarding |
| `D_ID_API_KEY` | Talking-avatar video |
| `CLOUDINARY_URL` | Teacher avatar uploads |
| `OPENAI_API_KEY` | Legacy fallback key lookup |

### Mail (optional)

`MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`.

If `MAIL_HOST` is unset, OTP codes are logged to the server console instead of being emailed — so the email-change flow is fully testable locally with no SMTP server.

---

## Database and seeding

`npm run db:seed` creates five boards, each with a Grade-7-equivalent grade mapping:

| Board | Grade label |
| --- | --- |
| Central Board of Secondary Education (CBSE – India) | Class 7 |
| College Board (US Curriculum / Advanced Placement) | Grade 7 |
| International Baccalaureate (IB – Global) | MYP Year 2 (Grade 7) |
| Cambridge Assessment International Education | Lower Secondary (Stage 8) |
| Pearson Edexcel (UK / International) | Lower Secondary (Year 8) |

The `canonical_level` column is what makes cross-board signup work: a student says "Grade 7" and the system resolves it to whatever that board calls it. Signup fails with a clear message if a board has no equivalent mapping.

It then imports `prisma/sample_syllabus.json` — real Grade-7 curriculum data: 55 syllabus units and 352 topics across 5 boards and 24 board/subject pairs. Units and topics containing "diagram" are skipped (unrenderable in a text tutor), and everything is upserted idempotently, so re-running the seed is safe.

`npm run db:import` runs `scripts/import-v2holoroid.js`, a self-contained MySQL→PostgreSQL migrator that parses `INSERT` statements out of a dump with a hand-written string-aware tokeniser (correctly handling escaped and doubled quotes), converts MySQL `0/1` booleans to Postgres `true/false`, casts JSON columns to `::jsonb`, drops removed columns, then truncates, imports in FK-safe order, resets serial sequences and verifies row counts against expected values — all inside one transaction. The dump itself is gitignored (`*.sql`).

---

## API reference

All routes are served under `/api` by the catch-all. Authenticated routes expect `Authorization: Bearer <token>`. Errors return `{ message }` with an appropriate status; validation errors may include a Laravel-style `errors` object which the client flattens into per-field messages.

### Public

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/boards` | Boards that have at least one grade mapping (cached 120s) |
| `GET` | `/subjects?query=` | Subject typeahead (max 8) |
| `POST` | `/subjects` | Upsert a subject by slug key |
| `GET` | `/institutions?query=` | Institution typeahead (max 8) |
| `POST` | `/institutions` | Upsert an institution |
| `POST` | `/teacher/register` | Register a teacher, issue OTP |
| `POST` | `/student/register` | Register a student (resolves board + canonical grade, creates profile) |
| `POST` | `/login` | Log in; 403 with the correct role if the role toggle is wrong |
| `POST` | `/otp/verify` | Verify a 6-digit OTP (10-minute expiry) |
| `POST` | `/otp/resend` | Reissue an OTP (180s cooldown, 429 with `retry_after`) |

### Student

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/student/dashboard` | Profile, board, grade, institution and the full curriculum tree (cached 180s) |
| `GET` | `/teachers` | Paginated teacher directory with ratings, styles, tune preferences |
| `POST` | `/student/session-feedback` | Rate a teacher 1–5 with optional feedback; re-syncs their average |
| `GET` | `/student/quizzes` | Published quizzes for the student's grade, bucketed |
| `POST` | `/student/quizzes/:quizId/start` | Create or resume an attempt |
| `GET` | `/student/quiz-attempts/:id` | Full attempt state for resume |
| `POST` | `/student/quiz-attempts/:id/submit-answer` | Grade, run the tutor, apply the reveal gate |
| `POST` | `/student/quiz-attempts/:id/tutor` | Free-form Socratic tutor chat on the current question |
| `POST` | `/student/quiz-attempts/:id/complete` | Score, summarise, create a learning recommendation |
| `GET` | `/student/learning-recs` | Up to 8 open recommendations |
| `PATCH` | `/student/learning-recs` | Dismiss all |
| `PATCH` | `/student/learning-recs/:recId` | Dismiss one |

### Shared AI

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/chat` | Chat completion; optionally logs a Learn turn |
| `POST` | `/chat/voice` | Multipart audio → transcript + answer in one round trip |
| `POST` | `/chat/video` | D-ID talking avatar; `202` while still rendering |
| `POST` | `/speech-to-text` | Transcribe an audio file |
| `POST` | `/tts/speak` | Teacher-voiced MP3 (`audio/mpeg`, no-store) |
| `POST` | `/homework-hint` | Gemini vision hint from a photo, with conversation history |

### Teacher — profile and account

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/teacher/profile` | Profile, live rating aggregate, unique students helped, comment feed |
| `POST` | `/teacher/profile` | Partial update (school, grades, subjects, counts, tune preferences) |
| `POST` | `/teacher/avatar` | Multipart avatar upload → Cloudinary |
| `POST` | `/teacher/onboarding` | Transcribe + clone voice + detect style + persist |
| `GET` | `/teacher/onboarding-status` | Onboarding completion flag |
| `PATCH` | `/teacher/account/profile` | Update display name |
| `POST` | `/teacher/account/password` | Change password (min 8 chars) |
| `POST` | `/teacher/account/email/start` | Begin email change; OTP to current inbox |
| `POST` | `/teacher/account/email/verify-old` | Verify current inbox; OTP to new inbox |
| `POST` | `/teacher/account/email/verify-new` | Commit the new email |
| `POST` | `/teacher/account/logout-all-sessions` | Rotate the remember token |
| `GET` | `/teacher/insights` | Private, subject-scoped Learn-mode insights |

### Teacher — quizzes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/teacher/curriculum` | Grade → board → subject → lesson → topic tree, filtered to taught subjects |
| `GET` | `/teacher/quizzes` | Quiz list with attempted / completed counts |
| `POST` | `/teacher/quizzes/generate` | AI-generate a draft quiz |
| `GET` | `/teacher/quizzes/:id` | Quiz with answers revealed |
| `PATCH` | `/teacher/quizzes/:id` | Update title / difficulty |
| `DELETE` | `/teacher/quizzes/:id` | Delete quiz and cascade attempts, answers, questions |
| `POST` | `/teacher/quizzes/:id/publish` | Publish to the class |
| `PATCH` | `/teacher/quizzes/:quizId/questions/:questionId` | Edit a question |
| `DELETE` | `/teacher/quizzes/:quizId/questions/:questionId` | Remove a question |
| `POST` | `/teacher/quizzes/:quizId/questions/:questionId/regenerate` | AI-rewrite one question |
| `GET` | `/teacher/quizzes/:id/analytics` | Aggregate, per-question and per-student statistics |
| `POST` | `/teacher/quizzes/:id/insights` | Generate and cache AI class insights |
| `GET` | `/teacher/students/:studentId/quiz-insights` | AI per-student learning summary |

---

## Data model

15 Prisma models on PostgreSQL, snake_case tables.

**Identity** — `User` (role, OTP state, board/grade/institution, email-change state machine), `TeacherProfile` (style, voice id, grades, subjects, tune preferences, onboarding flag), `StudentProfile`.

**Curriculum** — `Board` → `BoardGrade` (with `canonical_level` for cross-board grade equivalence) → `Curriculum` → `CurriculumUnit` → `CurriculumUnitTopic`, plus `Subject` and `Institution` as shared lookups.

**Teaching signals** — `TeacherRating` (per-session student reviews, indexed by teacher and date) and `LearnTurn` (every logged Learn question with subject, lesson, topic array, answer preview and response mode).

**Assessment** — `Quiz` → `QuizQuestion`, `QuizAttempt` (unique per quiz+student) → `QuizAttemptAnswer` (first vs latest answer, hint count, incorrect attempts, reveal flag, tutor thread), and `StudentLearningRec` closing the loop back to Learn mode.

Note that the quiz subsystem also bootstraps its tables through raw SQL (`CREATE TABLE IF NOT EXISTS` in `quizStore.js`) so it can run against a database that hasn't had `prisma db push` applied yet; `learn_turns` does the same.

---

## Project structure

```
LearnAI/
├── docs/learnai-architecture.png
├── .github/workflows/                 Azure Static Web Apps CI/CD
└── web/
    ├── prisma/
    │   ├── schema.prisma
    │   ├── seed.js
    │   └── sample_syllabus.json       Grade-7 curriculum, 5 boards
    ├── scripts/
    │   ├── import-v2holoroid.js       MySQL dump → PostgreSQL migrator
    │   ├── test-azure-tts.mjs
    │   └── test-azure-stt.mjs
    ├── public/board/                  Flap + steel textures (with prompt provenance)
    └── src/
        ├── app/
        │   ├── api/[...slug]/route.js  The only API route
        │   ├── layout.js               Fonts + design thesis
        │   ├── globals.css             Split-flap tokens
        │   ├── login|signup|student|teacher|teacher-onboarding|onboarding-complete|board-preview/
        ├── components/                Quiz hub, teacher tabs, uploaders, form inputs
        │   └── ui/Board.jsx            Split-flap primitives
        ├── context/                    AuthContext (+ localStorage persistence)
        ├── legacy-pages/               Page bodies: Student/Teacher dashboards, auth, onboarding steps
        ├── lib/                        The entire backend
        ├── prompts/                    All prompt engineering, isolated and reviewable
        ├── services/api.js             Typed axios client for every endpoint
        └── utils/                      LaTeX/speech sanitisation
```

Two conventions worth knowing:

- **`legacy-pages/` are not legacy in the deprecated sense** — they are the real page bodies, kept out of `app/` so route files stay as five-line `'use client'` wrappers. It's a migration artefact from a Vite SPA that turned out to be a clean separation.
- **`prompts/` is a first-class module.** All prompt text lives in one reviewable directory rather than being scattered as inline template literals, which is what makes the prompt architecture auditable.

---

## Deployment

GitHub Actions deploys to **Azure Static Web Apps** on push to `main` and on pull request open/sync/reopen, with an automatic teardown job when a PR closes. `app_location` is `web`; the deployment token lives in the `AZURE_STATIC_WEB_APPS_API_TOKEN_GENTLE_BAY_0F71D4700` secret.

Production builds use Webpack (`next build --webpack`) rather than Turbopack: Turbopack emits hashed symlinks in `.next/node_modules` for externalized server packages (like `@prisma/client`), and Azure's packaging step cannot follow them.

Production checklist:

- Set a strong `AUTH_SECRET`
- Set `APP_DEBUG=false` so OTP codes stop appearing in API responses
- Configure SMTP so OTPs are emailed rather than logged
- Point `DATABASE_URL` at a managed PostgreSQL instance and run `prisma db push` (or a proper migration) before first boot

---

## Known issues and limitations

Documented honestly, because knowing where the edges are is part of knowing the system.

- **`POST /api/tts/speak` is broken by a missing import.** `lib/api.js` calls `sanitizeMathForSpeech()` without importing it, so the endpoint throws and returns 500. Audio mode still works because the client silently falls back to browser speech synthesis — which is exactly why this went unnoticed. One-line fix: import it from `./sanitize.js`.
- **Registration OTPs are not emailed.** `POST /teacher/register` and `POST /student/register` return `otp_code` in the response body and the signup UI displays it under a "Developing Period" banner. Only the email-change flow actually sends mail. Wire `sendOtpEmail` into registration before production.
- **`otp_verified` is not enforced for routing.** `ProtectedRoute` and `resolveRoute` gate on role and teacher onboarding, but an unverified account that has a token can still reach its dashboard.
- **`logout-all-sessions` does not invalidate tokens.** It rotates `remember_token`, but token verification compares against `tokenVersion`, which does not exist on the `User` model — so every signed token is effectively version 0 and stays valid.
- **`QuizAttemptAnswer.misconception` is never written.** The column, the analytics aggregation (`common_misconceptions`) and the teacher-facing field all exist, but nothing populates it — so misconception reporting is always empty. The per-question `misconception_hint` from generation *is* stored and is the working half of this feature.
- **No quiz retakes.** `UNIQUE (quiz_id, student_id)` means one attempt per quiz; completed quizzes are review-only.
- **Quiz creation is not transactional.** Questions are inserted in a loop, so a mid-loop failure can leave a partially populated draft.
- **Caches are process-local.** The TTL cache and insight LRU live in memory, so they do not share state across serverless instances. Correct but less effective at scale; a Redis backend would be the natural upgrade.
- **`OtpVerification.jsx` and `Dashboard.jsx` are unrouted.** The former is a complete 6-box OTP screen with paste and backspace handling, ready for when registration email goes live; the latter is a stub.
- **`ErrorBoundary` is implemented but not mounted** in `providers.jsx` or `layout.js`.
- **`data/studentDashboardMock.js` still holds mock teachers and syllabi.** Only its `RESPONSE_MODES` and `DIFFICULTY_LEVELS` exports are actually used; the rest is dead data.
- **Some form inputs still carry light-theme colours** (`InstitutionInput`, `SubjectChips`) which clash with the dark split-flap palette used everywhere else.
- **Teacher signup collects subjects, grade and institution but the server discards them** — `registerTeacher` persists only name, email, password and role. Those fields are collected again during onboarding, which is where they actually stick.
