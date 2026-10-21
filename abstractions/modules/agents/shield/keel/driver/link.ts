/**
 * The driver's side of the keel contract: records to the model on stdout, instructions from
 * it on stdin. Operations on the model's state are correlated with their results; every other
 * instruction goes to the handler the driver installs. Each instruction is validated against
 * the contract before it is handled, and one that does not conform ends the driver.
 *
 * The link reads instructions from the start, before extensions are bound, so an extension
 * that awaits the model while it loads is answered, and handlers run without waiting for each
 * other, so a long action or a request waiting for its answer never holds back the rest.
 */
import { firstError, validator } from "../protocol/contract";
import type {
  DriverRecord,
  DriverResult,
  Instruction,
  Operation,
  OperationValue,
} from "../protocol/wire";
import { CodedError } from "./outcome";

/** The model refused an operation; its notice is already in the timeline. */
export class Refused extends CodedError {}

export interface Handlers {
  instruction(instruction: Exclude<Instruction, { type: "operation_result" }>): void;
}

export class ModelLink {
  readonly #write: (record: DriverRecord) => void;
  readonly #pending = new Map<
    string,
    {
      resolve: (value: OperationValue) => void;
      reject: (error: Error) => void;
      settled?: (value: OperationValue) => void;
    }
  >();
  #next = 0;
  #handlers: Handlers | undefined;
  /** Instructions that arrived before the driver installed its handlers. */
  readonly #early: Exclude<Instruction, { type: "operation_result" }>[] = [];
  #ended: string | undefined;
  /** Called before a record goes out, so changes the driver batched precede it. */
  beforeWrite: () => void = () => {};

  constructor(
    write: (record: DriverRecord) => void,
    readonly fail: (code: string, message: string) => never,
  ) {
    this.#write = write;
  }

  /** Writes a record; batched changes go first. */
  send(record: DriverRecord): void {
    if (this.#ended) return;
    if (record.type !== "entries" && record.type !== "status") this.beforeWrite();
    this.#write(record);
  }

  /**
   * Runs an operation on the model's state; rejects with `Refused` when the model refuses.
   * `settled` receives the value as its result is read, before any later instruction.
   */
  operation(
    operation: Operation,
    settled?: (value: OperationValue) => void,
  ): Promise<OperationValue> {
    if (this.#ended) return Promise.reject(new Error(`the driver is ending (${this.#ended})`));
    const id = `d${this.#next++}`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, settled });
      this.send({ type: "operation", id, operation });
    });
  }

  result(id: string, result: DriverResult): void {
    this.send({ type: "result", id, result });
  }

  install(handlers: Handlers): void {
    this.#handlers = handlers;
    for (const instruction of this.#early.splice(0)) handlers.instruction(instruction);
  }

  /**
   * Handles one line of stdin. Once the driver is ending, nothing more is handled: an answer
   * to an operation that was pending is expected then, and nothing may start.
   */
  receive(line: string): void {
    if (this.#ended) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.fail("invalid_instruction", "a stdin record is not JSON");
    }
    if (!validator("Instruction").Check(value))
      this.fail(
        "invalid_instruction",
        `an instruction does not conform: ${firstError("Instruction", value)}`,
      );
    const instruction = value as Instruction;
    if (instruction.type === "operation_result") {
      const pending = this.#pending.get(instruction.id);
      if (!pending) this.fail("invalid_instruction", `no operation ${instruction.id}`);
      this.#pending.delete(instruction.id);
      if (instruction.outcome === "ok") {
        pending.settled?.(instruction.value);
        pending.resolve(instruction.value);
      } else pending.reject(new Refused(instruction.code, instruction.message));
      return;
    }
    if (this.#handlers) this.#handlers.instruction(instruction);
    else this.#early.push(instruction);
  }

  /** The driver is ending: nothing more is written, and pending operations reject. */
  end(reason: string): void {
    if (this.#ended) return;
    this.#ended = reason;
    for (const pending of this.#pending.values())
      pending.reject(new Error(`the driver is ending (${reason})`));
    this.#pending.clear();
  }
}
