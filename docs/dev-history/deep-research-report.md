# Optimal Architecture and Prompting Strategy for In-Browser WebLLM Manga/Comic Bubble Translation

## Executive conclusion

For a manga/comic translator whose primary correctness requirement is **“bubble *i* must never receive bubble *j*’s text”**, I would not ship positional delimited text as the primary protocol. I would use **XGrammar-backed JSON Schema with fixed per-batch keys**, for example:

```json
{
  "b0": "Let's go!",
  "b1": "...",
  "b2": "What?!"
}
```

rather than:

```text
[1] Let's go!
[2] ...
[3] What?!
```

The important change is not merely “JSON instead of text”. It is **addressing translations by stable keys rather than by output position**. Each schema declares every `bN` property required and disallows extra properties. The renderer then maps `b0 → polygon A`, `b1 → polygon B` itself. Reordering JSON properties is harmless, and there is no cascading shift if a semantic validation step rejects one translation. WebLLM implements schema-constrained JSON generation in its WASM portion and describes schema output as strictly adhering to the supplied schema; current WebLLM's API uses `response_format: {type: "json_object", schema: JSON.stringify(schema)}`. citeturn26view1turn25view3

This is an unusually good use case for constrained decoding. XGrammar's authors report that more than 99% of token-mask validity can usually be precomputed and that grammar work is overlapped with GPU inference; the XGrammar paper reports near-zero end-to-end structured-generation overhead in its serving evaluation. That does **not** establish that the penalty is literally zero on a 1.5B model in Chrome, where WASM work is relatively larger compared with GPU inference, but it makes regex output parsing an unattractive trade simply to avoid an assumed grammar bottleneck. citeturn26view2turn26view3turn28view3

There is an additional WebLLM-specific reason to implement this carefully: its current source warns that JSON mode without a prompt explicitly telling the model to generate JSON according to the schema can produce an unending stream of whitespace until `max_tokens`. Your system prompt therefore still matters even when XGrammar is enabled. citeturn25view3

For the model hierarchy I would ship:

| Deployment tier | Recommendation | Current WebLLM q4f16 VRAM estimate | Why |
|---|---:|---:|---|
| **Default** | **Qwen2.5-3B-Instruct-q4f16_1** | **2,504.76 MB** | Best balance of CJK coverage, structured-output aptitude, instruction following and memory |
| **Low-memory** | **Qwen2.5-1.5B-Instruct-q4f16_1** | **1,629.75 MB** | Sub-2 GB and same CJK-oriented family; use smaller batches |
| **Alternative under 4 GB** | Phi-3.5-mini-instruct-q4f16_1-MLC-1k | 2,520.07 MB | Stronger general multilingual evidence than Llama/Gemma/Mistral, but less compelling than Qwen for this exact task |
| **High-spec** | **Qwen2.5-7B-Instruct-q4f16_1** | **5,106.67 MB** | Quality tier for machines with roughly 6 GB available; it does **not** meet the <4 GB criterion |

The current WebLLM catalogue puts Qwen2.5-3B at 2.50 GB, Qwen2.5-1.5B at 1.63 GB and Qwen2.5-7B at 5.11 GB for q4f16_1. Phi-3.5 Mini is 3.67 GB at the catalogue's 4K context or 2.52 GB in its 1K configuration. Mistral-7B-Instruct-v0.3 is about 4.57 GB q4f16 and therefore also fails a strict 4 GB ceiling. citeturn25view2turn26view4turn26view5

My production starting point would be **four to six LLM-translated bubbles per request**, with punctuation-only bubbles removed from the LLM path entirely, no previous assistant responses carried between sub-batches, greedy decoding, no request-level model-family special-token stop strings, a dynamic hard token ceiling, streaming, and a watchdog using WebLLM's `interruptGenerate()`. WebLLM explicitly resets the KV cache when a new request is not recognised as the same multi-round conversation; retaining previous user/assistant turns is what enables KV reuse, but for this application that reuse also creates exactly the historical-output contamination you want to avoid. citeturn22view0turn22view1turn22view2

## Structure and constrained decoding

### JSON Schema should be the production contract

The output schema should be an **object keyed by local slot ID**, not an array:

```json
{
  "type": "object",
  "properties": {
    "b0": { "type": "string" },
    "b1": { "type": "string" },
    "b2": { "type": "string" }
  },
  "required": ["b0", "b1", "b2"],
  "additionalProperties": false
}
```

An array such as:

```json
{"translations":["...", "...", "..."]}
```

is already much safer than unconstrained text, but positional correspondence remains implicit. A keyed object makes correspondence explicit: your application owns the mapping

```text
page bubble ID 91ca... → batch slot b0
page bubble ID 3e02... → batch slot b1
```

and never relies on whatever ordering the decoder happens to serialise. WebLLM's documented schema mode is specifically intended to constrain generated JSON to a supplied schema. citeturn26view1turn25view3

There is one limit worth making explicit: grammar constraints can guarantee **structure**, not semantic correctness. XGrammar can require the `b1` field to exist and contain a JSON string; it cannot prove that the words inside `b1` translate the source assigned to `b1`. Small batches, matching IDs in input and output, semantic validation, and per-slot retries remain necessary.

### XGrammar overhead is not the bottleneck I would optimise first

Constrained decoding works by masking tokens that cannot legally continue the current grammar. XGrammar attacks the cost of that process by precomputing context-independent validity, reducing runtime context-dependent checks, and overlapping grammar work with the model's GPU execution. The project reports more than 99% of mask entries as typically precomputable; its paper reports up to 100× acceleration versus earlier structured-generation implementations and near-zero end-to-end structured-generation overhead in its tested serving setting. citeturn26view2turn28view3

WebLLM itself executes model kernels through WebGPU while implementing structured JSON generation in the WASM portion of the model library. Its published M3 Max comparison found WebGPU preserving up to 85% of the corresponding native-Metal performance for the tested four-bit models, although that result was a general WebLLM performance comparison rather than a JSON-vs-unconstrained benchmark. citeturn26view0turn26view1

Crucially, current WebLLM exposes exactly the metrics needed to measure the question on your own workload:

```text
e2e_latency_s
time_to_first_token_s
prefill_tokens_per_s
decode_tokens_per_s
time_per_output_token_s
grammar_init_s
grammar_per_token_s
```

`grammar_init_s` and `grammar_per_token_s` are populated when `response_format` uses JSON/grammar constraints. citeturn22view3turn21view0

I did **not** find a credible primary-source benchmark that measures “Qwen2.5-1.5B/3B, Chrome WebGPU, identical manga translation prompts, schema constrained versus unconstrained” across Apple, NVIDIA and AMD hardware. Consequently, attaching a fabricated “JSON costs 3%” number would be misleading. The production decision should instead be based on the catastrophic-error cost: even if grammar masking cost several percentage points on a low-end machine, eliminating an entire class of canvas-corrupting format failures is worth considerably more.

The A/B benchmark I would run is:

| Metric | Schema run | Plain-text run |
|---|---|---|
| exact slot-set rate | JSON parse + exact `b0..bN` set | anchored-ID parse |
| missing-slot rate | rejected completion | count missing IDs |
| wrong/extra-ID rate | rejected completion | count |
| first-pass success | no retry required | no retry required |
| TTFT | WebLLM usage | WebLLM usage |
| decode tok/s | WebLLM usage | WebLLM usage |
| e2e latency | WebLLM usage | WebLLM usage |
| grammar init | WebLLM usage | N/A |
| grammar/token | WebLLM usage | N/A |
| output-token count | WebLLM usage | WebLLM usage |
| page-level recovery rate | after targeted retries | after targeted retries |

Run the same deterministic requests in alternating order after warm-up. At least several hundred real OCR pages are preferable because **exact-format failure rate**, not mean BLEU or mean tok/s, is your tail-risk metric.

### There is no mathematically perfect textual delimiter

The requested property of a text delimiter having “zero collision probability with BPE/SentencePiece control tokens” is not attainable as a universal delimiter-only statement. Ordinary text must itself be tokenised; tokenizer vocabularies and added-special-token sets differ by model revision. Zero ambiguity can only be obtained **at the application protocol level**, for example by escaping payloads or using structured parsing.

Your `<|1|>` observation is especially well founded for Qwen. Qwen2.5's tokenizer explicitly defines tokens such as `<|endoftext|>`, `<|im_start|>`, `<|im_end|>`, `<|object_ref_start|>` and `<|box_start|>`, and its chat template itself is built around `<|im_start|>...<|im_end|>`. Therefore I would ban the entire `<|...|>` namespace from application delimiters, not merely particular known names. citeturn28view2

If XGrammar has to be disabled, my ranking is:

| Text protocol | Recommendation | Failure characteristics |
|---|---|---|
| `b0<TAB>translation` | **Best fallback** | Short, ASCII, easy anchored parsing, no opening/closing pair |
| `[0] translation` | Acceptable | Very familiar but model may renumber or treat it as a list |
| `0. translation` | Avoid for strict mapping | Natural list continuation encourages auto-numbering |
| `<b0>…</b0>` | Avoid | Doubles tag burden; malformed/missing closing tags introduce failure modes |
| `§0§ …` | Avoid | Exotic marker gives no behavioural advantage and may tokenise inefficiently |
| `<|0|> …` | **Never use** | Deliberately resembles control-token syntax in Qwen and related chat templates |

For the fallback, parse identifiers, **never line positions**:

```text
b0<TAB>Let's go!
b1<TAB>...
b2<TAB>What?!
END_OF_BATCH
```

with an anchored parser conceptually equivalent to:

```regex
^b([0-9]+)\t(.*)$
```

A missing `b1` then leaves only `b1` unresolved. It can never shift the `b2` result into bubble 1.

## Batching, context and KV-cache

### “Batching bubbles” is not vLLM-style serving batching

Putting five bubbles into one user message does not create five independent GPU sequences comparable to continuous batching in vLLM. It creates **one autoregressive request containing a longer prompt and a longer structured completion**. WebLLM's engine keeps a lock per loaded model and processes its generation through a prefill followed by autoregressive decode; its source explicitly describes a request in terms of prefill and decode operations. citeturn21view0turn22view0

That changes the optimisation target. You are trading:

\[
\text{fewer repeated prefills}
\quad\text{against}\quad
\text{higher formatting/cross-bubble error probability}
\]

rather than exploiting server-class request concurrency.

For a 1:1 visual contract, my initial policy would be:

| Model class | Initial max translated slots/request | Additional cap |
|---|---:|---:|
| ~1–1.5B | **4** | ≈120–150 meaningful source code points |
| ~2–4B | **5–6** | ≈160–200 code points |
| ~7B | **6–8** | ≈220–260 code points |

Those are **engineering starting points, not published WebLLM optima**. Your own observation that >10 slots becomes unreliable is stronger evidence for your workload than generic server batching numbers. The policy should ultimately be selected by p99 exact-slot success, not mean throughput.

For a normal 20-bubble page I would therefore prefer:

```text
page
 ├─ deterministic passthrough: punctuation-only bubbles
 ├─ batch A: ~5 neighbouring dialogue bubbles
 ├─ batch B: ~5 neighbouring dialogue bubbles
 ├─ batch C: ~5 neighbouring dialogue bubbles
 └─ batch D: remaining dialogue/SFX
```

Group bubbles in reading order and preserve nearby exchanges in the same sub-batch. That retains most pronoun and speaker context without asking a 1.5B model to maintain a 20-entry bookkeeping structure.

### Do not carry previous translations as chat history

WebLLM reuses its KV cache for multi-round conversation only when the newly constructed conversation matches the currently loaded conversation; when it does not match, the engine calls `resetChat()` and resets the KV cache. The source explicitly logs “Multiround chatting, reuse KVCache” on the matching path. citeturn22view1turn22view2

For chatbot use that is desirable. For your translator it is a bad bargain.

Suppose batch B is sent as:

```text
system
user: batch A
assistant: translations A
user: batch B
```

You gain KV reuse, but you also put the model's earlier generated translations directly into the conditioning context. For a small model already showing demonstration leakage, this creates an obvious route for old phrases, IDs and stylistic patterns to leak into the next batch.

I would instead make every translation sub-batch **stateless**:

```ts
await engine.resetChat();
```

before the next independent batch. This preserves the expensive loaded weights and GPU engine while discarding conversational state. WebLLM exposes `resetChat()` specifically for resetting the pipeline state. citeturn22view2

Context should be transferred as **data**, not as previous assistant turns. For instance:

```json
{
  "scene": "school corridor; A is speaking to B",
  "names": {
    "美咲": "Misaki",
    "高橋": "Takahashi"
  }
}
```

Keep that context short and identical across the page, and state explicitly that it is context only and must not appear in output.

For pronouns, your highest-value context is usually local. Put adjacent dialogue in the same five-slot batch rather than carrying all previous translations.

### Prompt length, TTFT and memory

Autoregressive generation separates prompt prefill from output-token decode, and WebLLM reports its prefill time directly as `time_to_first_token_s`; longer prompts therefore increase the amount of prefill work to be performed. citeturn21view0turn22view3

Peak browser memory needs more nuance. WebLLM's engine comments that most device-loss errors occur during `reload()` because memory is allocated ahead of time, and its model catalogue's VRAM requirements are associated with configured context sizes. Thus shortening an individual request is useful for prefill latency and cache occupancy, but **reducing the configured context window** is the more relevant lever when the goal is reducing the engine's reserved KV-cache footprint. The engine accepts chat-option overrides, including KV-cache settings, and advises using a smaller model or smaller context on OOM. citeturn21view0turn23search0

Manga translation almost never requires 4K context for a five-bubble batch. A 1K–2K runtime context target is therefore sensible, provided the chosen prebuilt model/configuration supports it. Current WebLLM already publishes explicit 1K variants for Phi-3.5 Mini and Gemma 2 that substantially reduce their listed VRAM requirement. citeturn26view4turn28view1

## Prompt and generation contract

### Production system message

For Qwen2.5-1.5B/3B and similarly small instruction models, I would start with this exact system prompt:

```text
You translate manga/comic OCR text into natural English.

Return only one JSON object matching the required schema.

Rules:
- Translate only the values in SOURCE.
- Keep every output key exactly as required.
- Never omit, add, merge, split, rename, or renumber a key.
- Use neighbouring SOURCE values only for dialogue context.
- If a value is empty, punctuation-only, an ellipsis, or cannot be usefully translated, copy it unchanged.
- Do not add explanations, labels, markdown, apologies, or introductory text.
- Do not add quotation marks around a translation. JSON string quotes are syntax only.
- Do not output CONTEXT.
```

Qwen2.5 is particularly suitable for this instruction style because its own model card highlights improved instruction following, structured-data understanding, structured output—especially JSON—and greater resilience to system-prompt diversity. It also explicitly lists Chinese and Japanese among more than 29 supported languages. citeturn25view4

The prompt deliberately does **not** say things like:

```text
You are an expert award-winning professional manga translator...
```

Small models do not need a paragraph of persona conditioning to perform this mechanical task. Every extra behavioural clause is another instruction to reconcile. The desired policy is narrow enough to state directly.

### Production user message

I would encode the **input itself as JSON**, eliminating application delimiters altogether:

```text
Translate SOURCE from Japanese to English.

CONTEXT:
{"names":{"美咲":"Misaki"}}

SOURCE:
{"b0":"行こう！","b1":"...","b2":"えっ！？"}
```

For Chinese:

```text
Translate SOURCE from Chinese to English.

SOURCE:
{"b0":"我们走吧！","b1":"……","b2":"什么？！"}
```

This has several useful properties:

* escaping of embedded quotation marks/newlines can be delegated to `JSON.stringify`;
* each input value already carries the exact key expected in output;
* no `<|...|>` sentinel is involved;
* Qwen2.5 was explicitly trained/improved for understanding structured data and generating JSON. citeturn25view4

The expected completion is simply:

```json
{"b0":"Let's go!","b1":"...","b2":"What?!"}
```

### Bypass trivial bubbles before inference

Do not ask an LLM to “remember not to drop” information you can handle deterministically.

Before batching, detect strings containing no meaningful letters/digits, for example:

```text
...
……
!?
?!
—
ーー
…
```

and immediately set:

```ts
translation = source;
```

This directly removes a major category of the reported short-slot failures and saves both prompt and completion tokens.

Be conservative: `ドン`, `ガーン`, `啪`, `轰` and similar actual SFX are linguistic content, not punctuation, and can remain in the translation path. If their translation fails, retaining the original is always safer than placing another bubble's translation in the slot.

### Zero-shot beats demonstrations for this deployment

There is no few-shot formatting trick that can **guarantee** zero demonstration leakage. JSON Schema constrains syntax and keys; it cannot prohibit a model from putting `"Let's go!"` into the wrong value because that phrase appeared in an example.

Given the observed 1B–3B poisoning failure, I would therefore use **zero-shot role conditioning in production**.

If a later evaluation proves that examples materially improve naturalness on a 7B model, keep that as an optional high-tier configuration and make examples linguistically disjoint from production inputs. But do not use examples to teach the output protocol: the schema already teaches the protocol more reliably.

A safer way to control style is a brief abstract condition:

```text
Style: concise, natural spoken English suitable for speech bubbles.
Preserve character tone; do not over-explain.
```

rather than a user/assistant translation example.

### Generation settings

My baseline is:

```text
temperature          = 0
top_p                = 1
frequency_penalty    = 0
presence_penalty     = 0
repetition_penalty   = 1
ignore_eos           = false
n                    = 1
```

WebLLM currently accepts temperature ≥0, `top_p` in `(0,1]`, frequency/presence penalties from −2 to 2, positive repetition penalty, `max_tokens`, and one or more request-level stop strings. citeturn23search0

For this task, greedy decoding is preferable because diversity is actively undesirable: the goal is the most likely faithful translation under a rigid contract.

I would **not** start with `repetition_penalty: 1.1`. Repetition penalties can alter legitimate repetition such as:

```text
No, no, no!
Ha ha ha!
Go! Go! Go!
```

or repeated punctuation/SFX. Structured stopping and application-level interruption address runaway loops without perturbing linguistic content.

If you later find a model-specific loop not solved by the hard cap/watchdog, test approximately `1.02–1.05` on that model only.

### Do not hard-code Qwen/Llama/Gemma special tokens into `stop`

There is no portable request-level array such as:

```ts
stop: [
  "<|im_end|>",
  "<|eot_id|>",
  "<end_of_turn>"
]
```

that I recommend across Qwen, Llama and Gemma.

WebLLM's conversation configuration contains model-specific `stop_str` and `stop_token_ids`; the model package/chat template therefore already owns its native end-of-turn semantics. Request-level `stop` is a separate string/string-array generation option. citeturn23search0

Manually inserting another model's control syntax creates exactly the tokenizer coupling you are trying to eliminate. Qwen, for example, uses `<|im_end|>` as a special token in its own tokenizer. citeturn28view2

For **schema mode**, use no custom stop string:

```ts
stop: []
```

and rely on:

1. schema completion,
2. model-native EOS/turn-stop handling,
3. `max_tokens`,
4. the streaming watchdog.

For the unconstrained **text fallback only**, a normal application string such as:

```text
END_OF_BATCH
```

can be used:

```ts
stop: ["\nEND_OF_BATCH"]
```

Do not put it in a special-token-looking namespace.

### Dynamic token cap

No character-count formula can promise a wall-clock abort in under one second: token-generation speed varies enormously by GPU, and WebLLM only observes `interruptGenerate()` between decode work units. `max_tokens` is therefore a **token safety bound**, while a watchdog supplies the wall-clock bound. WebLLM exposes `interruptGenerate()`, and its generation loop checks the interrupt signal between decode iterations and triggers a stop. citeturn22view0

For an initial CJK-to-English deployment I would bootstrap with:

\[
M = \min\left(384,\;
\max\left(64,\;
24 + 10N + \lceil2.5C\rceil
\right)\right)
\]

where:

* \(N\) = number of LLM-translated bubbles in the sub-batch;
* \(C\) = number of Unicode code points in their source strings, excluding deterministic punctuation-only slots.

This is a **deployment heuristic**, not a tokenizer theorem. It intentionally allows English expansion while putting a low ceiling on a five-bubble request.

More importantly, replace the constant `2.5` after collecting telemetry. For each `{model, source language}` profile, calculate:

\[
r_{99} =
P_{99}\left(
\frac{\text{completion tokens}-\text{JSON/key overhead}}
{\max(1,C)}
\right)
\]

and use:

\[
M =
\min\left(
M_{\text{hard}},
\left\lceil
1.2 \, r_{99}C + H(N)
\right\rceil
\right)
\]

with a small safety margin. That gives you a cap based on your actual manga corpus rather than generic tokenisation assumptions.

## Engine configuration

The following is the production pattern I would use with current WebLLM v0.2.x-style APIs. Current WebLLM's response-format type is `json_object` with the schema supplied as a **JSON-encoded string**; it is not the separate OpenAI-style `type: "json_schema"` shape. citeturn25view3

```ts
import * as webllm from "@mlc-ai/web-llm";

type Bubble = {
  id: string;       // Your permanent polygon/bbox ID
  source: string;
};

type TranslationResult = {
  byId: Map<string, string>;
  finishReason: string | null;
  usage?: unknown;
};

const MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

const SYSTEM_PROMPT = `You translate manga/comic OCR text into natural English.

Return only one JSON object matching the required schema.

Rules:
- Translate only the values in SOURCE.
- Keep every output key exactly as required.
- Never omit, add, merge, split, rename, or renumber a key.
- Use neighbouring SOURCE values only for dialogue context.
- If a value is empty, punctuation-only, an ellipsis, or cannot be usefully translated, copy it unchanged.
- Do not add explanations, labels, markdown, apologies, or introductory text.
- Do not add quotation marks around a translation. JSON string quotes are syntax only.
- Do not output CONTEXT.`;

export const engine = await webllm.CreateMLCEngine(
  MODEL_ID,
  {
    logLevel: "WARN",
    initProgressCallback: (progress) => {
      console.debug("WebLLM load:", progress);
    },
  },
  // A smaller runtime context is adequate for small manga batches.
  // Test the chosen model/build on target devices before changing this.
  {
    context_window_size: 2048,
  },
);

function isDeterministicPassthrough(text: string): boolean {
  const s = text.trim();

  if (s === "") return true;

  // Keep only genuinely content-free punctuation/symbol strings out of the LLM.
  // Unicode property escapes require modern JS, available in current Chrome.
  return !/[\p{L}\p{N}]/u.test(s);
}

function countCodePoints(text: string): number {
  return [...text].length;
}

function maxTokensForBatch(sources: string[]): number {
  const n = sources.length;
  const c = sources.reduce(
    (sum, source) => sum + countCodePoints(source.trim()),
    0,
  );

  return Math.min(
    384,
    Math.max(64, 24 + 10 * n + Math.ceil(2.5 * c)),
  );
}

function buildSchema(slotCount: number) {
  const properties: Record<string, { type: "string" }> = {};
  const required: string[] = [];

  for (let i = 0; i < slotCount; i++) {
    const key = `b${i}`;
    properties[key] = { type: "string" };
    required.push(key);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  } as const;
}

function buildSourceObject(bubbles: Bubble[]) {
  return Object.fromEntries(
    bubbles.map((bubble, i) => [`b${i}`, bubble.source]),
  );
}

function buildUserPrompt(
  sourceLanguage: "Japanese" | "Chinese",
  bubbles: Bubble[],
  context?: Record<string, unknown>,
): string {
  const parts = [
    `Translate SOURCE from ${sourceLanguage} to English.`,
  ];

  if (context && Object.keys(context).length > 0) {
    parts.push(`CONTEXT:\n${JSON.stringify(context)}`);
  }

  parts.push(`SOURCE:\n${JSON.stringify(buildSourceObject(bubbles))}`);

  return parts.join("\n\n");
}

function validateExactObject(
  value: unknown,
  slotCount: number,
): Record<string, string> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Completion is not a JSON object.");
  }

  const obj = value as Record<string, unknown>;
  const expected = Array.from({ length: slotCount }, (_, i) => `b${i}`);
  const actual = Object.keys(obj);

  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(obj, key))
  ) {
    throw new Error(
      `Wrong key set. Expected ${expected.join(", ")}, got ${actual.join(", ")}`,
    );
  }

  const result: Record<string, string> = {};

  for (const key of expected) {
    if (typeof obj[key] !== "string") {
      throw new Error(`${key} is not a string.`);
    }

    result[key] = obj[key] as string;
  }

  return result;
}
```

For generation I favour streaming even though you do not render partial translations. Streaming gives the extension an opportunity to kill whitespace/repetition failures rather than waiting for `max_tokens`. WebLLM's source exposes streaming completion chunks and checks its interrupt flag during the autoregressive generation loop. citeturn21view0turn22view0

```ts
export async function translateLLMBatch(
  sourceLanguage: "Japanese" | "Chinese",
  bubbles: Bubble[],
  context?: Record<string, unknown>,
): Promise<TranslationResult> {
  if (bubbles.length < 1 || bubbles.length > 6) {
    throw new Error("Expected an LLM batch containing 1-6 bubbles.");
  }

  const schema = buildSchema(bubbles.length);
  const maxTokens = maxTokensForBatch(
    bubbles.map((bubble) => bubble.source),
  );

  // Make this a fresh translation transaction.
  // Do not condition batch B on assistant output from batch A.
  await engine.resetChat();

  let output = "";
  let finishReason: string | null = null;
  let usage: unknown;

  // Safety state.
  let seenOpeningBrace = false;
  let leadingWhitespace = 0;
  let repeatedTailCount = 0;
  let previousTail = "";

  const stream = await engine.chat.completions.create({
    model: MODEL_ID,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildUserPrompt(
          sourceLanguage,
          bubbles,
          context,
        ),
      },
    ],

    response_format: {
      type: "json_object",
      schema: JSON.stringify(schema),
    },

    // Deterministic translation.
    temperature: 0,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    repetition_penalty: 1,

    // Native conversation-template EOS/stop tokens remain responsible
    // for model-family-specific termination.
    stop: [],

    max_tokens: maxTokens,
    n: 1,

    stream: true,
    stream_options: {
      include_usage: true,
    },

    // Useful while establishing production thresholds.
    extra_body: {
      enable_latency_breakdown: true,
    },
  });

  /*
   * A hard wall-clock timer is a second line of defence.
   *
   * Do not blindly use 750 ms as total request timeout: many GPUs legitimately
   * need longer than this. In production derive an expected deadline from
   * device/model telemetry. This timer represents the "runaway" deadline after
   * whatever normal-generation allowance you choose.
   */
  const runawayTimer = setTimeout(() => {
    void engine.interruptGenerate();
  }, 15_000);

  try {
    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = chunk.usage;
      }

      const choice = chunk.choices?.[0];

      if (!choice) continue;

      if (choice.finish_reason !== null) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta?.content ?? "";
      if (!delta) continue;

      output += delta;

      /*
       * WebLLM explicitly documents the possibility of JSON-mode whitespace
       * runaway when the model is not properly instructed. This should almost
       * never fire with the prompt above, but it is a cheap defence.
       */
      if (!seenOpeningBrace) {
        const braceIndex = output.indexOf("{");

        if (braceIndex >= 0) {
          seenOpeningBrace = true;
        } else {
          leadingWhitespace += [...delta].filter(
            (c) => /\s/u.test(c),
          ).length;

          if (leadingWhitespace > 64) {
            await engine.interruptGenerate();
            throw new Error("JSON whitespace runaway detected.");
          }
        }
      }

      /*
       * Coarse character-level repetition tripwire.
       * Use token/logprob-based logic if you later expose it in telemetry.
       */
      if (output.length >= 96) {
        const tail = output.slice(-48);

        if (tail === previousTail) {
          repeatedTailCount += 1;
        } else {
          previousTail = tail;
          repeatedTailCount = 0;
        }

        if (repeatedTailCount >= 2) {
          await engine.interruptGenerate();
          throw new Error("Repeated-generation loop detected.");
        }
      }

      /*
       * Optional optimisation:
       * once a complete, valid object with the exact key set has appeared,
       * the grammar/native stop normally terminates by itself. You can parse
       * here and interrupt only after confirming there is no need for another
       * decode token.
       */
    }
  } finally {
    clearTimeout(runawayTimer);
  }

  if (finishReason === "length" || finishReason === "abort") {
    throw new Error(`Incomplete generation: ${finishReason}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`Invalid final JSON: ${output}`);
  }

  const slotTranslations = validateExactObject(
    parsed,
    bubbles.length,
  );

  const byId = new Map<string, string>();

  bubbles.forEach((bubble, i) => {
    byId.set(bubble.id, slotTranslations[`b${i}`]);
  });

  return {
    byId,
    finishReason,
    usage,
  };
}
```

WebLLM's completion protocol distinguishes `stop`, `length` and `abort` finish reasons, so `length` should always be treated as an invalid transaction rather than attempting to salvage a truncated JSON object. citeturn25view3

The `15_000` ms value above is deliberately not presented as universal. Once you have real device measurements, a better watchdog is approximately:

\[
T_{\rm deadline}
=
T_{{\rm TTFT},99}
+
\frac{M_{\rm expected}}{\operatorname{decodeTPS}_{05}}
+
\text{safety margin}.
\]

Then add a **runaway-specific detector with a sub-second reaction window**: once repeated output, endless whitespace, or structurally impossible progress is detected, call `interruptGenerate()` immediately. WebLLM checks that signal between decode operations; no JavaScript API can guarantee a sub-second stop if an individual GPU dispatch itself stalls for longer. citeturn22view0

## Defensive parsing and recovery

The most important architectural rule is:

> **A malformed model response must be able to damage at most the slot that failed, never the positional mapping of later slots.**

That means the canvas layer should never consume `string[]` directly. The only type that crosses the translation/rendering boundary should effectively be:

```ts
Map<BubbleId, ResolvedTranslation>
```

where each value has explicit provenance:

```ts
type ResolvedTranslation = {
  text: string;
  source: string;
  method:
    | "passthrough"
    | "batch-llm"
    | "single-retry"
    | "source-fallback";
};
```

### Transactional page algorithm

A robust page pipeline is:

```text
OCR polygons
    │
    ▼
stable BubbleId assignment
    │
    ├── punctuation-only ──► source passthrough
    │
    ▼
reading-order grouping
    │
    ▼
4–6-bubble translation transaction
    │
    ▼
schema parse + exact-key validation
    │
    ├── valid ─────────────► per-slot semantic checks
    │
    └── invalid ───────────► targeted retry path
                                │
                                ▼
                          unresolved slot only
                                │
                      ┌─────────┴─────────┐
                      ▼                   ▼
                 retry succeeds      retry fails
                      │                   │
                      ▼                   ▼
                 translation        original source
                      └─────────┬─────────┘
                                ▼
                       Map<BubbleId,text>
                                │
                                ▼
                     atomic canvas render
```

Specifically:

**First**, assign an immutable bubble ID as soon as PaddleOCR produces a box/polygon. Sorting for reading order may change array positions, but it must never change that ID.

**Second**, remove punctuation-only strings from the LLM workload and mark them resolved immediately.

**Third**, translate the remaining local group under a fixed-key schema.

**Fourth**, reject the entire completion structurally if JSON parsing fails, the finish reason is `length`/`abort`, a required key is missing, any unknown key appears, or a value is not a string. Schema mode should make most of these impossible in normal operation, but application validation should still exist because WebLLM warns that output can be truncated by the maximum-token/context limit. citeturn25view3

**Fifth**, never repair a missing slot by indexing into the remaining values. This is forbidden:

```ts
// DON'T
for (let i = 0; i < bubbles.length; i++) {
  bubble[i].translation = generatedLines[i];
}
```

The safe version is always explicit:

```ts
bubbleById.get(batchMap.b0)!.translation = result.b0;
```

**Sixth**, retry only unresolved slots. A failed `b3` becomes a one-item request with schema:

```json
{
  "type": "object",
  "properties": {
    "b0": {"type":"string"}
  },
  "required":["b0"],
  "additionalProperties":false
}
```

and the original source for `b3`. You may include one neighbouring source line as non-output context if pronoun interpretation demands it; do **not** include the previous failed assistant completion.

**Seventh**, put a small retry budget on each bubble—one strict retry is a reasonable default. A model that fails twice is not allowed to hold the page hostage.

**Eighth**, when all retries fail:

```ts
translation = originalSource;
```

Never use a neighbour, empty string or shifted output as fallback. The visibly untranslated bubble is recoverable and honest; a fluent translation rendered into the wrong bubble is much worse.

### Semantic validation should be conservative

Useful hard checks include:

```ts
function basicSlotCheck(source: string, translation: string): boolean {
  // Non-empty source must not silently disappear.
  if (source.trim() !== "" && translation.trim() === "") {
    return false;
  }

  // Exact passthrough expected for content-free punctuation.
  if (isDeterministicPassthrough(source)) {
    return translation === source;
  }

  // Clearly pathological model chatter.
  if (
    /^(sure[,!:]?\s+|here(?:'s| is) (?:the )?translation|translated:)/iu
      .test(translation.trim())
  ) {
    return false;
  }

  return true;
}
```

Avoid over-aggressive “target must contain no Japanese/Chinese characters” validation. Character names, signs, deliberate untranslated terminology and sound effects can legitimately remain in the source script.

Likewise, do not reject duplicate translations merely because two slots produce the same phrase. Manga legitimately contains repeated cries, names, laughter and back-channel utterances.

### Fallback text parser

If grammar mode has to be disabled because of a model/runtime defect, keep the same keyed architecture:

```ts
const LINE_RE = /^b([0-9]+)\t(.*)$/u;

function parseFallbackText(
  output: string,
  expectedCount: number,
): Map<number, string> {
  const result = new Map<number, string>();

  for (const rawLine of output.split(/\r?\n/u)) {
    const match = LINE_RE.exec(rawLine);

    if (!match) continue;

    const index = Number(match[1]);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= expectedCount ||
      result.has(index)
    ) {
      continue;
    }

    result.set(index, match[2]);
  }

  return result;
}
```

If output is:

```text
b0	Let's go!
b2	What?!
END_OF_BATCH
```

the result is:

```text
b0 = valid
b1 = unresolved
b2 = valid
```

**not**:

```text
bubble 0 = Let's go!
bubble 1 = What?!     ← catastrophic positional drift
bubble 2 = undefined
```

That single design choice neutralises your most dangerous failure mode even when constrained decoding is unavailable.

## Model hierarchy and benchmark plan

### Qwen2.5-3B-Instruct is the strongest default among the requested models

Qwen2.5-3B has a particularly strong prior for this workload. Its official model card explicitly advertises improved instruction following, structured-data understanding and structured JSON generation, and lists both Chinese and Japanese among its supported languages. The model has 3.09B parameters with GQA. citeturn25view4

The current WebLLM catalogue lists:

```text
Qwen2.5-3B-Instruct-q4f16_1   2504.76 MB
Qwen2.5-3B-Instruct-q4f32_1   2893.64 MB
```

both with a 4096 context-window override. citeturn25view2

For your target, **q4f16_1 Qwen2.5-3B is my default** wherever it is stable on the user's GPU. It leaves meaningfully more headroom within a nominal 4 GB budget than Phi-3.5 Mini's full configuration while retaining substantially more capacity than 1.5B.

### Qwen2.5-1.5B is the lightweight tier

The WebLLM catalogue puts the 1.5B q4f16_1 model at about 1.63 GB and q4f32_1 at about 1.89 GB. citeturn25view2

Because it belongs to the same Qwen2.5 multilingual/instruction family, it is the logical low-memory option, but I would lower its batch ceiling to **four translated bubbles** initially. Its speed advantage is especially valuable when targeted one-slot retries occur.

Do not compensate for its lower capacity by making its prompt much longer or by adding demonstrations. The opposite policy is preferable: smaller batch, shorter rules, stronger schema.

### Phi-3.5 Mini is the most interesting under-4-GB challenger

Current WebLLM lists Phi-3.5-mini-instruct q4f16_1 at 3,672.07 MB with its 4K setup and a 1K variant at 2,520.07 MB; the 1K q4f32 variant is 3,179.12 MB. citeturn26view4

Microsoft's own multilingual evaluation is encouraging. On the model card's language-specific multilingual-MMLU results, Phi-3.5 Mini scores 50.0 for Japanese and 60.0 for Chinese, compared with 22.8 and 42.4 respectively for Mistral-7B-Instruct-v0.3 in the same table. Those are **knowledge/instruction benchmark scores, not manga translation scores**, so they should only inform candidate selection, not be mistaken for translation quality. citeturn22view5

I would put Phi in your A/B test suite, particularly if its formatting adherence proves higher than Qwen's on your data. I would not replace Qwen2.5-3B as the default solely from those generic multilingual results.

### Llama-3.2-3B is not a first-choice CJK translator

Llama-3.2-3B is attractive operationally—WebLLM's q4f16 variant is around 2.26 GB—but Meta's model card lists the eight **officially supported** languages as English, German, French, Italian, Portuguese, Hindi, Spanish and Thai. It says training contains a broader language collection, but Chinese and Japanese are not among the officially supported eight. citeturn22view4

That does not mean Llama cannot translate CJK. It means that, absent contrary task-specific benchmarking, I would not choose it ahead of a Qwen release whose own documentation explicitly targets Japanese and Chinese. citeturn22view4turn25view4

### Gemma-2-2B-it is a poor fit in its generic form

The generic Gemma-2-2B-it model card describes Gemma as available in English and describes its training corpus as primarily English-language content; its documented output is English-language text. citeturn22view6

WebLLM lists generic Gemma-2-2B-it at 1,895.3 MB q4f16 and 2,508.75 MB q4f32, so the memory footprint is attractive, but multilingual source comprehension is a more fundamental constraint for Japanese/Chinese translation. citeturn26view6

There is, however, a highly relevant model that was not in your comparison list: current WebLLM also includes **`gemma-2-2b-jpn-it`**, at the same approximately 1,895 MB q4f16 / 2,509 MB q4f32 footprints. For a Japanese-only deployment, that model absolutely deserves inclusion in your empirical benchmark even though I would not assume it beats Qwen without testing. citeturn28view1

### Mistral-7B-Instruct-v0.3 does not make sense under your stated constraint

Current WebLLM reports:

```text
Mistral-7B-Instruct-v0.3-q4f16_1   4573.39 MB
Mistral-7B-Instruct-v0.3-q4f32_1   5619.27 MB
```

and marks the q4f16 build as requiring `shader-f16`. citeturn26view5

So it does not qualify for a strict `<4.0 GB` comparison in the standard current WebLLM configuration. Furthermore, Microsoft's multilingual benchmark table gives Mistral-7B-v0.3 substantially weaker Japanese and Chinese multilingual-MMLU results than Phi-3.5 Mini despite Mistral's larger parameter count. Again, that benchmark is not translation-specific, but it gives little reason to pay the 7B memory/latency cost for this CJK workload. citeturn22view5

### Qwen2.5-7B is the genuine high-spec tier, not a <4-GB model

Current WebLLM gives Qwen2.5-7B q4f16_1 a VRAM requirement of 5,106.67 MB and q4f32_1 5,900.09 MB. citeturn25view2

Therefore your product UI should not advertise it as the “<4 GB high-quality option”. Treat it as an opt-in high-spec model for machines where WebGPU reports suitable capabilities and you have comfortable headroom beyond the catalogue estimate.

The hierarchy becomes:

```text
< ~2 GB practical tier
    Qwen2.5-1.5B q4f16

~2.5–3 GB practical tier
    Qwen2.5-3B q4f16      ← DEFAULT
    Phi-3.5-mini 1k       ← challenger
    gemma-2-2b-jpn        ← Japanese-specific challenger

~5–6 GB practical tier
    Qwen2.5-7B q4f16      ← HIGH-SPEC
```

### Overall candidate ranking

Because there is no published apples-to-apples manga-dialogue benchmark for precisely these WebLLM quantisations, the following is an **engineering ranking to seed your benchmark**, not a claim of measured translation scores:

| Rank | Model | CJK translation prior | Format prior | Relative browser cost | Verdict |
|---|---|---|---|---|---|
| **1** | **Qwen2.5-3B-Instruct** | Excellent for size | Excellent | Medium | **Default** |
| **2** | **Qwen2.5-1.5B-Instruct** | Very good for size | Good, but capacity-limited | Low | **Lightweight** |
| **3** | **Phi-3.5-mini-instruct-1k** | Good multilingual evidence | Good | Medium-high | Strong challenger |
| **4** | Llama-3.2-3B-Instruct | CJK not officially supported | Good | Medium | Secondary fallback |
| **5** | gemma-2-2b-it | Generic model English-centric | Reasonable | Low-medium | Do not use generic model as CJK default |
| **6** | Mistral-7B-Instruct-v0.3 | Weak CJK evidence relative to cost | Reasonable | Very high | Poor fit |
| Outside <4 GB | **Qwen2.5-7B-Instruct** | Strongest Qwen capacity here | Strong | Very high | **High-spec tier** |

Qwen2.5's documentation directly supports the CJK and structured-output priors; Meta explicitly omits Japanese/Chinese from Llama 3.2's officially supported languages; Google's generic Gemma-2 card is English-oriented; and Microsoft's multilingual table favours Phi over Mistral on Japanese/Chinese multilingual evaluations. citeturn25view4turn22view4turn22view6turn22view5

### What to measure before freezing the hierarchy

For translation quality, construct a real manga/comic test set rather than relying on MMLU. It should deliberately over-sample the cases that break your product:

```text
very short utterances        え？ / 啊？ / ん？
punctuation                  … / !? / ——
SFX                          ドン / ガーン / 啪
speaker-dependent pronouns
sentence fragments
vertical OCR fragments
repeated dialogue            いや、いや！
proper names
honorifics
slang
multiple bubbles with same source
20–25-bubble pages
OCR errors
```

Score three axes independently.

For **translation**, use blinded human preference for naturalness and faithfulness, with automatic metrics only as supplementary evidence. Comic dialogue has many valid colloquial English renderings, so reference-overlap alone is a weak measure of naturalness.

For **contract reliability**, measure:

\[
\text{ExactBatchContractRate}
=
\frac{\text{batches with all expected IDs and valid strings}}
{\text{all batches}}
\]

and, more importantly,

\[
\text{WrongBubbleRate}
=
\frac{\text{translations ultimately associated with wrong BubbleId}}
{\text{all bubbles}}.
\]

With the keyed transactional architecture, your design target for `WrongBubbleRate` should be **zero by construction**: a failure becomes an unresolved ID, never a shifted array.

For **performance**, record WebLLM's own `time_to_first_token_s`, `prefill_tokens_per_s`, `decode_tokens_per_s`, `e2e_latency_s`, plus XGrammar's `grammar_init_s` and `grammar_per_token_s`; current WebLLM exposes these specifically in completion usage, including grammar-specific timings. citeturn21view0turn22view3

The benchmark matrix I would actually deploy is:

```text
models:
  Qwen2.5-1.5B q4f16
  Qwen2.5-3B   q4f16
  Phi-3.5-mini 1k q4f16
  gemma-2-2b-jpn q4f16      [Japanese track]
  Llama-3.2-3B q4f16
  Qwen2.5-7B q4f16          [high-spec track]

batch sizes:
  1, 3, 4, 5, 6, 8, 10

formats:
  keyed JSON Schema
  bN<TAB>text fallback

languages:
  Japanese → English
  Chinese → English

hardware buckets:
  Apple Silicon integrated GPU
  Intel/AMD integrated GPU
  modest NVIDIA discrete GPU
  modest AMD discrete GPU

metrics:
  human naturalness
  human faithfulness
  exact schema/key rate
  blank-slot rate
  value-cross-assignment rate
  first-pass success rate
  retry count
  page completion latency
  TTFT
  decode tok/s
  grammar_init_s
  grammar_per_token_s
  peak observed memory/device-loss rate
```

WebLLM's published general WebGPU benchmark demonstrates that browser inference can approach its native backend—up to 85% of native Metal performance in MLC's cited M3 Max experiment—but there is no defensible single tokens-per-second figure that can be assigned to these six models across “Apple Silicon and mid-range NVIDIA/AMD” without fixing the exact GPU, Chrome/Dawn version, model quantisation and context configuration. Reporting relative tiers plus telemetry from the actual extension is therefore more reliable than hard-coding synthetic tok/s claims. citeturn26view1

The resulting production architecture is consequently:

```text
PaddleOCR
   │
   ▼
stable polygon IDs
   │
   ├── punctuation-only ──────────────────────────┐
   │                                               │
   ▼                                               │
reading-order/local-context groups                 │
   │                                               │
   ▼                                               │
4–6 items                                         │
   │                                               │
   ▼                                               │
SOURCE JSON {b0:..., b1:...}                       │
   │                                               │
   ▼                                               │
Qwen2.5-3B q4f16 + XGrammar JSON Schema            │
   │                                               │
   ▼                                               │
exact keyed object {b0:..., b1:...}                │
   │                                               │
   ▼                                               │
structural + per-slot validation                   │
   │                                               │
   ├── valid ────────────────────────────────┐      │
   │                                         │      │
   └── failed slot → 1-item schema retry     │      │
                   │                         │      │
                   └── failure → source copy │      │
                                             │      │
                                             ▼      ▼
                                      Map<BubbleId,text>
                                             │
                                             ▼
                                  transactional canvas render
```

That architecture treats an LLM as an **untrusted translator behind a typed protocol**, rather than as a text generator whose formatting you hope to recover afterwards. XGrammar supplies the syntax-level contract; stable IDs remove positional failure; micro-batching limits small-model bookkeeping load; stateless sub-batches prevent history/demo leakage; deterministic passthrough protects punctuation; streaming plus `max_tokens` and `interruptGenerate()` bounds runaways; and targeted per-slot retries ensure that an inference error degrades to an untranslated bubble instead of corrupting the rest of the page. WebLLM already provides the structured generation, model-specific conversation stops, KV-reset behaviour, interrupt API and detailed latency telemetry needed to implement that design entirely client-side. citeturn26view1turn23search0turn22view0turn22view2