// One shape for every backend. The rest of the extension never learns which vendor answered.

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  args: string; // raw JSON, parsed by the caller so a malformed call is a tool error, not a crash
}

/**
 * An image travelling with a question.
 *
 * Kept beside the text rather than folded into `content` as a multimodal array, and that is a
 * deliberate narrowing. Every other part of this extension treats a message's content as a string —
 * the pseudonymiser, the budget, the transcript, the compaction — and turning it into a union would
 * put a `typeof` in each of them, which is how the one place that forgot to check becomes the place
 * a credential leaves unredacted. Here the text stays text, and the image is an explicit extra that
 * each provider assembles at the last moment.
 */
export interface ImagePart {
  /** `image/png`, `image/jpeg`, `image/webp`, `image/gif`. */
  mediaType: string;
  /** Base64, without the `data:` prefix. */
  data: string;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /**
   * Images the user attached to this message.
   *
   * The honest warning that belongs with this field: an image CANNOT be pseudonymised. The whole
   * privacy architecture here works on text — names, hosts, credentials, all found and replaced —
   * and none of it can touch a screenshot, which may carry a whole desktop. So an image leaving the
   * machine is a decision the user makes with that said plainly, never a side effect of pasting.
   */
  images?: ImagePart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  /** Marks a prefix that is worth caching remotely (system prompt + repo map). */
  cacheable?: boolean;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** Tokens served from the provider's prompt cache — the cheap ones. */
  cachedTokens: number;
  /** Real cost in USD when the provider reports it; otherwise the router estimates. */
  costUsd?: number;
}

/**
 * How much thinking to buy before answering. Every provider spells this differently — OpenRouter
 * takes an effort word, Anthropic takes a token budget, DeepSeek decides on its own — so the shape
 * the extension speaks is the intent, and each provider translates it.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolSchema[];
  reasoning?: ReasoningEffort;
  signal?: AbortSignal;
}

/** Token budgets for the providers that price thinking by the token rather than by the word. */
export const THINKING_BUDGET: Record<ReasoningEffort, number> = {
  none: 0,
  low: 2048,
  medium: 8192,
  high: 24576,
};

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatDelta {
  text?: string;
  reasoning?: string;
}

export interface ChatResult {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: "stop" | "length" | "tool_calls" | "error";
}

export interface CompletionRequest {
  model: string;
  prefix: string;
  suffix: string;
  maxTokens: number;
  stop: string[];
  signal?: AbortSignal;
}

export interface Provider {
  readonly id: string;
  readonly baseUrl: string;
  /** True when nothing sent to this endpoint leaves the operator's network. */
  readonly isLocal: boolean;
  chat(req: ChatRequest, onDelta?: (d: ChatDelta) => void): Promise<ChatResult>;
  /** Fill-in-the-middle. Absent on providers whose models cannot do it. */
  complete?(req: CompletionRequest): Promise<string>;
  listModels(): Promise<string[]>;
}

export const EMPTY_USAGE: Usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
