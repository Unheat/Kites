/**
 * Predicts whether a WebLLM model can run on this device, before the weights are downloaded.
 *
 * Why this exists: `@mlc-ai/web-llm` enforces `required_features` itself, but only after fetching
 * the wasm and the config; the storage-buffer requirement is checked even later, inside the pipeline
 * constructor, once the weights are on disk. Both are readable from the adapter for free, so the
 * difference is between a clear "this model is not for this GPU" and a multi-gigabyte download that
 * ends in a stack trace.
 *
 * Deliberately absent: a VRAM gate. `vram_required_MB` is a catalogue literal that the runtime never
 * reads, and no WebGPU API reports device memory — adapter limits are quantised for fingerprinting
 * resistance — so blocking on it would reject capable machines. This module answers only questions
 * the device can actually be asked.
 *
 * @module
 */

/** The subset of a `ModelRecord` that decides loadability. */
export interface ModelLoadRequirements {
  /** Model id, used only for messages. */
  model_id?: string;
  /** Device features the record requires, e.g. `['shader-f16']`. */
  required_features?: string[];
  /** Smallest `maxStorageBufferBindingSize` the record needs, in bytes. */
  buffer_size_required_bytes?: number;
}

/** What the device reports about itself. */
export interface AdapterCapabilities {
  /** Features the adapter advertises; absent when the probe could not read them. */
  features?: ReadonlySet<string>;
  /** Largest storage buffer binding the device allows, in bytes. */
  maxStorageBufferBindingSize?: number;
}

/** Outcome of a loadability check. */
export type LoadabilityVerdict =
  | {
      /** The device satisfies everything the record asks for. */
      ok: true;
    }
  | {
      /** The device cannot load this record. */
      ok: false;
      /** User-facing explanation naming the unmet requirement and a way out. */
      reason: string;
    };

/**
 * Decides whether a model record can load on the described device.
 *
 * Unverifiable is treated as loadable on purpose: a device that does not expose `features` is not a
 * device that lacks them, and the library's own check still runs. Refusing here would break working
 * hardware, which is the failure mode this module must never introduce.
 *
 * @param record - Model record fields that gate loading.
 * @param capabilities - Adapter features and buffer limit, as probed.
 * @returns `{ ok: true }`, or a reason string naming what the device cannot satisfy.
 */
export function checkModelLoadability(
  record: ModelLoadRequirements,
  capabilities: AdapterCapabilities
): LoadabilityVerdict {
  const features = capabilities.features;
  if (features) {
    const missing = (record.required_features ?? []).filter((feature) => !features.has(feature));
    if (missing.length > 0) {
      return {
        ok: false,
        reason:
          `This GPU lacks ${missing.join(', ')}, which ${record.model_id ?? 'the model'} requires. ` +
          `Pick the q4f32 variant of the same model, or a smaller one.`,
      };
    }
  }

  const needed = record.buffer_size_required_bytes;
  const limit = capabilities.maxStorageBufferBindingSize;
  if (needed !== undefined && limit !== undefined && needed > limit) {
    const neededMb = Math.ceil(needed / (1024 * 1024));
    const limitMb = Math.floor(limit / (1024 * 1024));
    return {
      ok: false,
      reason:
        `This GPU allows a ${limitMb} MB storage buffer but ${record.model_id ?? 'the model'} needs ` +
        `${neededMb} MB. Pick a model without a manifest, or a smaller one.`,
    };
  }

  return { ok: true };
}
