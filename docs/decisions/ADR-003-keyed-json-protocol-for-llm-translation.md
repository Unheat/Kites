# ADR-003: Keyed JSON Protocol for Dialogue Translation

## Status
Accepted

## Context
When sending multiple speech bubbles to Large Language Models (LLMs) or translation APIs, the translation system must preserve exact 1:1 positional alignment between the source text and translated output.

Historically, comic translation tools used delimiter-tagged prompts:
```
⟦0⟧ What was that sound?
⟦1⟧ I don't know, stay back!
```

In production, delimiter-tagged prompting exhibited severe failure modes:
1. **Delimiter Hallucination & Mutation:** Small local models (1B–3B parameters) and even cloud APIs frequently mutated delimiters into `[0]`, `(1)`, `0:`, or dropped them entirely.
2. **Line Count Mismatches:** If the model merged two dialogue lines into one sentence, downstream array mapping broke, shifting all remaining speech bubbles onto the wrong comic characters.
3. **Delimiter Collisions:** Comics with brackets, sound effect brackets, or mathematical symbols confused delimiter regex parsers.

## Decision
Adopt the **Keyed JSON Protocol** for all LLM and remote translation engines:
1. Source segments are packed into a strictly keyed JSON object:
   ```json
   {
     "b0": "What was that sound?",
     "b1": "I don't know, stay back!"
   }
   ```
2. The system prompt instructs the model to output a single JSON object with identical keys (`b0`, `b1`, ..., `bN`).
3. The parser reads `parsedChunk[index]` using the exact key lookup `b${index}`.
4. If a key is missing or echoed verbatim, the system falls back gracefully to the original source text for that slot without shifting other bubbles.
5. Deterministic passthroughs (empty strings, ellipses, isolated punctuation) are filtered before prompt assembly and bypass LLM dispatch.

## Consequences
### Positive
- **100% Positional Immunity:** A dropped or merged line cannot shift subsequent dialogue onto wrong comic panels.
- **Natural Surrounding Context:** The LLM sees the complete conversation in one prompt, allowing it to accurately infer pronouns, tone, and character dynamics.
- **Structured Schema Validation:** Subclasses can enforce JSON schema output via structured decoding features (OpenAI JSON Schema, WebLLM grammar).

### Trade-offs
- Slight token overhead from JSON syntax (`"b0": "..."`) compared to raw line breaks.
- Requires JSON repair heuristics for models that output markdown code fences (` ```json `) or trailing commas.

## Alternatives Considered
- **Translating Bubbles One-by-One:** Rejected because isolated single-sentence translation destroys dialogue context, causing misgendered pronouns and disjointed conversation flow.
- **Custom XML/HTML Tags (`<bubble id="0">`):** Rejected because LLMs often omit closing tags or hallucinate attributes.
