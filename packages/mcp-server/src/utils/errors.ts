export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
    Object.setPrototypeOf(this, BridgeError.prototype);
  }
}

export class BridgeTimeoutError extends BridgeError {
  constructor(method: string) {
    super(
      `Bridge request timed out for method: ${method}. The bridge is connected, but the operation took too long.`
    );
    this.name = "BridgeTimeoutError";
    Object.setPrototypeOf(this, BridgeTimeoutError.prototype);
  }
}

export class BridgeValidationError extends BridgeError {
  constructor(message: string = "Data connection unauthorized or malformed.") {
    super(message);
    this.name = "BridgeValidationError";
    Object.setPrototypeOf(this, BridgeValidationError.prototype);
  }
}
