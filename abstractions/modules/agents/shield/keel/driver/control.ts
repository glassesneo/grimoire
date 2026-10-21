/**
 * keel's control of a Pi session: when a prompt counts as accepted, pausing
 * between steps, stopping, and taking the queued instructions out again. The
 * run's phase and the queue are the driver's; it reports them to the model.
 *
 * Accepting. Pi's `prompt()` resolves only when the run it starts ends, so
 * acceptance is read from its `preflightResult` callback, which pi-coding-agent
 * 1.1.0 documents as internal (AgentSession.prompt, dist/core/agent-session.js).
 * A prompt that resolves without reporting is "acceptance unknown" instead of
 * being taken as accepted; a prompt Pi refuses before reporting is refused. Pi defers a prompt made while it emits
 * `agent_settled`, which would also resolve without reporting, so prompts wait
 * until that emission is over.
 *
 * Pausing. A pause lets the model finish its response and every started tool
 * finish, a codemode script with all its nested calls included, and then
 * waits before the next step: before a top-level tool starts (Pi's
 * `tool_call`), after a turn and before the queues are read for the next
 * request (`turn_end`), before a continuation such as a retry or the run after
 * compaction starts (`agent_start`), before an automatic compaction
 * (`session_before_compact`), and before a request that follows compaction
 * between turns (`turn_start`). Pi awaits each of these handlers, so the run
 * stays the same run and its queue is kept. At `turn_start` Pi may already
 * have read steering or follow-up messages for the next request, and at a
 * continuation's `agent_start` the messages it continues with; what it read is
 * in flight and is delivered after the pause, not taken by the queue
 * operations. Nested calls are never held: their parent is running and waits
 * for them. A paused run is still active in Pi. `global.resume` ends a pause
 * or a pending one; a sent prompt or an answered request resumes a run that
 * is paused, and leaves a pending pause in place.
 *
 * Queue. Pi exposes the queued messages only through the Agent's public
 * queue methods. Taking them out happens in one synchronous step, so Pi
 * cannot drain the queues halfway through it; messages Pi already drained are
 * in flight and are not taken. Only user instructions are taken; messages
 * extensions queued are put back in their order. The prompt draft is the
 * model's: a taken instruction reaches it through an operation the queue
 * operation waits for.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { contentText, type ImageContent, imagesOf, isContentBlock } from "./content";
import type { NoticeLevel } from "../protocol/items";
import { type DriverResult, PROMPT, type QueueInfo, type RunInfo } from "../protocol/wire";
import { Rejection } from "./outcome";

type Disposition = "started" | "queued" | "handled";

/** What the control needs from the rest of the driver. */
export interface ControlHost {
  /** The run or the queue changed. */
  changed(): void;
  setDraft(destination: string, text: string): Promise<void>;
  appendDraft(destination: string, text: string): Promise<void>;
  notice(level: NoticeLevel, text: string): void;
  /** Cancels the open requests extensions made. */
  cancelRequests(): Promise<void>;
}

type Lane = <T>(operation: () => Promise<T>) => Promise<T>;

interface Taken {
  /** The queued message as Pi held it. */
  message: any;
  text: string;
  images: ImageContent[];
}

export class Control {
  readonly #session: AgentSession;
  readonly #host: ControlHost;
  run: RunInfo = { phase: "idle", compacting: false, retrying: false };
  queue: QueueInfo = { steering: [], followUp: [] };
  #lane: Promise<unknown> = Promise.resolve();
  #waiters: ((proceed: boolean) => void)[] = [];
  /** A run started and its `agent_settled` has not been emitted yet. */
  #unsettled = false;
  #settled: (() => void)[] = [];

  constructor(session: AgentSession, host: ControlHost) {
    this.#session = session;
    this.#host = host;
  }

  get phase() {
    return this.run.phase;
  }

  #setRun(changes: Partial<RunInfo>): void {
    const next = { ...this.run, ...changes };
    if (JSON.stringify(next) === JSON.stringify(this.run)) return;
    this.run = next;
    this.#host.changed();
  }

  #setQueue(queue: QueueInfo): void {
    if (JSON.stringify(queue) === JSON.stringify(this.queue)) return;
    this.queue = { steering: [...queue.steering], followUp: [...queue.followUp] };
    this.#host.changed();
  }

  /** Follows the session's events for the run state. */
  observe(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case "agent_start":
        this.#unsettled = true;
        if (this.phase === "idle") this.#setRun({ phase: "running" });
        break;
      case "agent_settled":
        this.#unsettled = false;
        for (const resume of this.#settled.splice(0)) queueMicrotask(resume);
        if (this.phase !== "stopping") {
          this.#release(true);
          this.#setRun({ phase: "idle", retrying: false });
        }
        break;
      case "compaction_start":
        this.#setRun({ compacting: true });
        break;
      case "compaction_end":
        this.#setRun({ compacting: false });
        break;
      case "auto_retry_start":
        this.#setRun({ retrying: true });
        break;
      case "auto_retry_end":
        this.#setRun({ retrying: false });
        break;
      case "queue_update":
        this.#setQueue({
          steering: [...(event.steering as string[])],
          followUp: [...(event.followUp as string[])],
        });
        break;
    }
  }

  /** Runs input operations one at a time, so acceptance and queue changes never interleave. */
  #serial: Lane = (operation) => {
    const result = this.#lane.then(operation);
    this.#lane = result.catch(() => {});
    return result;
  };

  /** Waits while Pi emits `agent_settled`, when it would defer a prompt. */
  async #outsideSettle(): Promise<void> {
    while (this.#unsettled && !this.#session.isStreaming)
      await new Promise<void>((resolve) => this.#settled.push(resolve));
  }

  /**
   * Submits text the way the prompt does: a new run when idle, otherwise a
   * queued follow-up or steering instruction. Resolves once Pi accepted it.
   */
  async #submit(
    text: string,
    behavior: "followUp" | "steer",
    images?: ImageContent[],
  ): Promise<Disposition> {
    await this.#outsideSettle();
    return new Promise<Disposition>((resolve, reject) => {
      let reported = false;
      this.#session
        .prompt(text, {
          streamingBehavior: behavior,
          source: "interactive",
          ...(images?.length ? { images } : {}),
          preflightResult: (disposition) => {
            reported = true;
            resolve(disposition);
          },
        })
        .then(
          () => {
            if (!reported)
              reject(
                new Rejection(
                  "acceptance_unknown",
                  "Pi finished the prompt without reporting whether it accepted it",
                ),
              );
          },
          (error: unknown) => {
            if (!reported) reject(error);
            else process.stderr.write(`keel: run failed after acceptance: ${String(error)}\n`);
          },
        );
    });
  }

  #requireActive(): void {
    if (this.phase === "stopping") throw new Rejection("stopping");
  }

  /**
   * Sends text as the prompt, in input order with the queue operations, and
   * reports whether Pi accepted it: it did, it refused it before reporting
   * (or the run is stopping), or it ended the prompt without reporting. The
   * model owns the draft and its claim; this only sends what it was given.
   */
  submit(text: string): Promise<DriverResult> {
    if (this.phase === "stopping")
      return Promise.resolve({ outcome: "rejected", code: "stopping" });
    return this.#serial(async (): Promise<DriverResult> => {
      try {
        this.#requireActive();
        const disposition = await this.#submit(text, "followUp");
        // A sent prompt resumes a paused run, once it is queued.
        this.resumePaused();
        return { outcome: "submitted", disposition };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof Rejection && error.code === "acceptance_unknown")
          return { outcome: "unknown", code: error.code, message };
        if (error instanceof Rejection) return { outcome: "rejected", code: error.code };
        return { outcome: "rejected", code: "refused", message };
      }
    });
  }

  /** Compaction runs only while idle; Pi would otherwise abort the run to compact. */
  compact(instructions?: string): void {
    if (this.phase !== "idle" || !this.#session.isIdle) throw new Rejection("not_idle");
    void this.#session
      .compact(instructions)
      .catch((error: unknown) =>
        this.#host.notice(
          "error",
          `compaction failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  // -------------------------------------------------------------------------
  // Pause
  // -------------------------------------------------------------------------

  pause(): void {
    if (this.phase === "paused" || this.phase === "pausing") return;
    if (this.phase !== "running") throw new Rejection(this.phase === "idle" ? "idle" : this.phase);
    this.#setRun({ phase: "pausing" });
  }

  /** Ends a pause, or a pause still waiting for its step. */
  resume(): void {
    if (this.phase !== "paused" && this.phase !== "pausing") return;
    this.#setRun({ phase: "running" });
    this.#release(true);
  }

  /** Resumes a run that is held; a pause still waiting for its step stays. */
  resumePaused(): void {
    if (this.phase === "paused") this.resume();
  }

  /**
   * Holds the run here while a pause is asked for. Resolves true to go on and
   * false when the run is being stopped or was aborted.
   */
  async gate(signal: AbortSignal | undefined): Promise<boolean> {
    if (this.phase === "stopping" || signal?.aborted) return false;
    if (this.phase !== "pausing" && this.phase !== "paused") return true;
    this.#setRun({ phase: "paused" });
    return new Promise<boolean>((resolve) => {
      const onAbort = () => finish(false);
      const finish = (proceed: boolean) => {
        signal?.removeEventListener("abort", onAbort);
        const index = this.#waiters.indexOf(finish);
        if (index !== -1) this.#waiters.splice(index, 1);
        resolve(proceed);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(finish);
    });
  }

  #release(proceed: boolean): void {
    for (const waiter of this.#waiters.splice(0)) waiter(proceed);
  }

  // -------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------

  /**
   * Stops the run: no new input is taken, requests are cancelled, the queue
   * is cleared, Pi is aborted, and held steps are released. Input that was
   * being accepted may itself wait for the run, as an extension command can,
   * so it is waited for only after the abort; whatever it queued or started
   * meanwhile is cleared and aborted too. The phase returns to idle only once
   * Pi is idle.
   */
  async stop(): Promise<void> {
    if (this.phase === "stopping") return;
    this.#setRun({ phase: "stopping" });
    // The model answers the cancellation; the abort never waits for it.
    const cancel = () =>
      void this.#host
        .cancelRequests()
        .catch((error) =>
          this.#host.notice("error", `cancelling requests failed: ${String(error)}`),
        );
    try {
      cancel();
      this.#session.clearQueue();
      const aborted = this.#session.abort();
      this.#release(false);
      await aborted;
      await this.#lane;
      cancel();
      this.#session.clearQueue();
      if (!this.#session.isIdle) await this.#session.abort();
    } finally {
      this.#setRun({ phase: "idle", retrying: false });
    }
  }

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  /**
   * Takes the queued user instructions, in order, steering first. Messages of
   * other roles stay queued. With `keepImages` false, nothing is taken when an
   * instruction has an image, since an editor cannot hold one.
   */
  #take(keepImages: boolean): Taken[] {
    const agent = this.#session.agent;
    const modes = { steering: agent.steeringMode, followUp: agent.followUpMode };
    agent.steeringMode = "all";
    agent.followUpMode = "all";
    let steering: any[];
    let followUp: any[];
    try {
      // `peekQueuedMessages` shows steering, or follow-ups when no steering is queued.
      const first = agent.peekQueuedMessages();
      agent.clearSteeringQueue();
      followUp = agent.peekQueuedMessages();
      steering = first.length > 0 && first[0] !== followUp[0] ? first : [];
    } finally {
      agent.steeringMode = modes.steering;
      agent.followUpMode = modes.followUp;
    }
    const isUser = (message: any) => message?.role === "user";
    const imagesIn = (message: any) =>
      imagesOf(Array.isArray(message.content) ? message.content.filter(isContentBlock) : []);
    if (!keepImages && [...steering, ...followUp].some((m) => isUser(m) && imagesIn(m).length)) {
      for (const message of steering) agent.steer(message);
      throw new Rejection(
        "queued_images",
        "a queued instruction has an image the editor cannot hold",
      );
    }
    // Clears Pi's displayed queue and its follow-ups in the same step.
    this.#session.clearQueue();
    for (const message of steering) if (!isUser(message)) agent.steer(message);
    for (const message of followUp) if (!isUser(message)) agent.followUp(message);
    return [...steering, ...followUp].filter(isUser).map((message) => ({
      message,
      text:
        typeof message.content === "string"
          ? message.content
          : contentText(message.content.filter(isContentBlock)),
      images: imagesIn(message),
    }));
  }

  /**
   * Sends every queued instruction again as steering. It is sent anew, so Pi
   * applies input handlers and templates again. When sending fails, nothing
   * not accepted is lost: an instruction of text alone goes to the end of the
   * prompt draft, and one with an image, which a draft cannot hold, is queued
   * again as the follow-up it was, without running input handlers again. Pi
   * does not list a message queued that way among its queued instructions,
   * so a notice says how many there are. The error is then raised.
   */
  steerAll(): Promise<{ resent: number }> {
    this.#requireActive();
    return this.#serial(async () => {
      this.#requireActive();
      const taken = this.#take(true);
      for (const [index, instruction] of taken.entries()) {
        try {
          await this.#submit(instruction.text, "steer", instruction.images);
        } catch (error) {
          const rest = taken.slice(index);
          const texts = rest
            .filter((entry) => entry.images.length === 0)
            .map((entry) => entry.text);
          if (texts.length) await this.#host.appendDraft(PROMPT, texts.join("\n\n"));
          const withImages = rest.filter((entry) => entry.images.length > 0);
          for (const entry of withImages) this.#session.agent.followUp(entry.message);
          if (withImages.length)
            this.#host.notice(
              "warning",
              `${withImages.length} instruction${withImages.length === 1 ? "" : "s"} with images could not be sent again and wait as follow-ups`,
            );
          throw error;
        }
      }
      return { resent: taken.length };
    });
  }

  /** Moves every queued instruction into the prompt draft, replacing it. */
  editAll(): Promise<{ taken: number }> {
    this.#requireActive();
    return this.#serial(async () => {
      this.#requireActive();
      const taken = this.#take(false);
      if (taken.length)
        await this.#host.setDraft(PROMPT, taken.map((entry) => entry.text).join("\n\n"));
      return { taken: taken.length };
    });
  }
}
