import type {
  DialogueBranchKey,
  DialogueBranchNode,
  DialogueLineNode,
  DialogueNode,
  DialogueScript,
} from "../../shared/types.js";

export interface DialogueSequencerCallbacks {
  /**
   * Called whenever the active line changes, with the line node about to
   * play. Use this to render the subtitle/speaker/direction text and to
   * start the audio element.
   */
  onLineStart: (node: DialogueLineNode) => void;
  /** Called when the script reaches a node with no `next` (i.e. ends). */
  onScriptEnd: (lastNode: DialogueLineNode) => void;
  /**
   * Called when entering or leaving a safe-window line, with the
   * multiplier to apply (1 = restore to normal). Wire this directly to
   * SuspicionMetric.update()'s `suspicionMultiplier` input — the
   * sequencer does not touch SuspicionMetric directly.
   */
  onSuspicionMultiplierChange: (multiplier: number) => void;
  /**
   * Called at a branch node to resolve which path to take. Typically
   * backed by a gameplay metric such as `OverallSuspicionMetric.isLowSuspicion()`. The sequencer does not
   * read suspicion state itself, keeping it decoupled from the spy
   * module's specific metric implementation.
   */
  resolveBranch: () => DialogueBranchKey;
}

/**
 * Plays a DialogueScript: a sequential chain of audio+subtitle lines
 * that advances when the current line's audio element fires `ended`,
 * with optional branch nodes that consult suspicion state.
 *
 * Script-agnostic: this class has no Vane-specific or any other
 * scenario-specific logic. Swapping scripts means authoring a new
 * DialogueScript JSON; this file does not change.
 *
 * Caller (ConversationStepController) owns:
 * - the actual HTMLAudioElement and attaching the `ended` listener
 * - rendering subtitle text from onLineStart
 * - feeding the resolved suspicion multiplier into SuspicionMetric.update()
 */
export class DialogueSequencer {
  private readonly nodesById: Map<string, DialogueNode>;
  private readonly script: DialogueScript;
  private readonly callbacks: DialogueSequencerCallbacks;

  private currentNodeId: string | null = null;
  private activeSafeWindow = false;
  private started = false;

  constructor(script: DialogueScript, callbacks: DialogueSequencerCallbacks) {
    this.script = script;
    this.callbacks = callbacks;
    this.nodesById = new Map(script.nodes.map((n) => [n.id, n]));

    if (!this.nodesById.has(script.start)) {
      throw new Error(
        `[DialogueSequencer] script "${script.id}" start node "${script.start}" not found`,
      );
    }
  }

  /** Begin playback from the script's start node. Call once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.enterNode(this.script.start);
  }

  /**
   * Advance past the current line. Call this when the current line's
   * audio element fires its `ended` event.
   *
   * No-op if called with no active line (e.g. after the script has
   * already ended), so it's safe to wire directly to an `ended`
   * listener without extra guards at the call site.
   */
  advance(): void {
    const current = this.currentNode();
    if (!current || current.kind !== "line") return;

    this.exitLineIfSafeWindow(current);

    if (!current.next) {
      this.currentNodeId = null;
      this.callbacks.onScriptEnd(current);
      return;
    }
    this.enterNode(current.next);
  }

  /** The line node currently playing, or null if none/ended. */
  get currentLine(): DialogueLineNode | null {
    const node = this.currentNode();
    return node?.kind === "line" ? node : null;
  }

  /** True once the script has reached a node with no `next`. */
  get isFinished(): boolean {
    return this.started && this.currentNodeId === null;
  }

  private currentNode(): DialogueNode | null {
    if (this.currentNodeId === null) return null;
    return this.nodesById.get(this.currentNodeId) ?? null;
  }

  /**
   * Enter a node by id. Branch nodes resolve immediately and recurse
   * into whichever line they point to — branch nodes never themselves
   * become "current" or get rendered, so onLineStart always receives an
   * actual line.
   */
  private enterNode(nodeId: string): void {
    const node = this.nodesById.get(nodeId);
    if (!node) {
      throw new Error(
        `[DialogueSequencer] script "${this.script.id}" references missing node "${nodeId}"`,
      );
    }

    if (node.kind === "branch") {
      this.enterBranch(node);
      return;
    }

    this.currentNodeId = node.id;
    if (node.safe_window) {
      this.activeSafeWindow = true;
      this.callbacks.onSuspicionMultiplierChange(node.safe_window.suspicion_multiplier);
    }
    this.callbacks.onLineStart(node);
  }

  private enterBranch(node: DialogueBranchNode): void {
    const key = this.callbacks.resolveBranch();
    const targetId = node.branch[key];
    if (!targetId) {
      throw new Error(
        `[DialogueSequencer] branch node "${node.id}" has no target for key "${key}"`,
      );
    }
    this.enterNode(targetId);
  }

  private exitLineIfSafeWindow(node: DialogueLineNode): void {
    if (node.safe_window && this.activeSafeWindow) {
      this.activeSafeWindow = false;
      this.callbacks.onSuspicionMultiplierChange(1);
    }
  }
}
