/** Error de dominio con un mensaje que puede mostrarse a la persona usuaria. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code = "domain_error"
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class AuthorizationError extends DomainError {
  constructor(message = "No tienes acceso a esta operación.") {
    super(message, "forbidden");
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "No encontramos el registro solicitado.") {
    super(message, "not_found");
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, "conflict");
    this.name = "ConflictError";
  }
}
