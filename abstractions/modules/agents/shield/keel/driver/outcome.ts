/** What a driver action's `run` may return or throw besides its detail. */

/** An operation the driver took; its effects follow as changes. */
export class Accepted {
  constructor(readonly detail?: unknown) {}
}

/** An error with a code; its subclasses say who refused. */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

/** A refusal with the code a screen sees. */
export class Rejection extends CodedError {}
