import { NoObjectGeneratedError, generateObject, type LanguageModel } from "ai";
import type { z } from "zod";
import { log } from "../util/logger.js";

/**
 * Every agent is the same four things: instructions, a model, an input it
 * knows how to render, and a Zod schema it must fill. No agent calls another
 * agent and no agent performs side effects — the orchestrator owns ordering,
 * collectors own the outside world.
 */
export interface AgentDefinition<I, O> {
  name: string;
  instructions: string;
  schema: z.ZodType<O>;
  run(input: I): Promise<O>;
}

export type AgentContext = {
  model: LanguageModel;
  signal?: AbortSignal;
  /** Called after every model round trip; used for verbose logging only. */
  onUsage?: (event: AgentUsage) => void;
};

export type AgentUsage = {
  agent: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type AgentSpec<I, O> = {
  name: string;
  instructions: string;
  schema: z.ZodType<O>;
  /** Turns the typed input into the user message for this call. */
  buildPrompt(input: I): string;
  /** Low by default: these agents summarise evidence, they do not brainstorm. */
  temperature?: number;
  maxOutputTokens?: number;
};

export class AgentError extends Error {
  constructor(
    readonly agent: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export function defineAgent<I, O>(spec: AgentSpec<I, O>, ctx: AgentContext): AgentDefinition<I, O> {
  return {
    name: spec.name,
    instructions: spec.instructions,
    schema: spec.schema,
    async run(input: I): Promise<O> {
      const prompt = spec.buildPrompt(input);
      const startedAt = Date.now();
      log.debug(spec.name, `prompt ${prompt.length} chars`);
      try {
        const result = await generateObject({
          model: ctx.model,
          instructions: spec.instructions,
          prompt,
          schema: spec.schema as z.ZodType<O>,
          schemaName: spec.name,
          temperature: spec.temperature ?? 0.2,
          maxOutputTokens: spec.maxOutputTokens ?? 8000,
          maxRetries: 2,
          ...(ctx.signal ? { abortSignal: ctx.signal } : {}),
        });
        const durationMs = Date.now() - startedAt;
        log.debug(
          spec.name,
          `ok in ${durationMs}ms`,
          { in: result.usage?.inputTokens, out: result.usage?.outputTokens },
        );
        ctx.onUsage?.({
          agent: spec.name,
          durationMs,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        });
        return result.object as O;
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error)) {
          log.debug(spec.name, `model returned unusable output: ${String(error.text).slice(0, 400)}`);
          throw new AgentError(
            spec.name,
            `${spec.name} agent could not produce a valid result (the model returned output that did not match the schema)`,
            error,
          );
        }
        throw new AgentError(spec.name, `${spec.name} agent failed: ${errorText(error)}`, error);
      }
    },
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
