// Erori normalizate ale driverelor de stocare la distanță.
//  code: 'auth' (401/token lipsă) | 'insufficientPermissions' | 'quota' | 'rate' | 'notFound' | 'offline' | 'server' | 'integrity' | 'unknown'
export class DriverError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.name = 'DriverError';
    this.code = code;
    this.status = status;
  }
}
