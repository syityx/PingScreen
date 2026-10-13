/** Invalidates captures and model callbacks as soon as a session is closed or replaced. */
export class SessionGate {
  private generation = 0;
  next(): number { return ++this.generation; }
  current(token: number): boolean { return token === this.generation; }
}
