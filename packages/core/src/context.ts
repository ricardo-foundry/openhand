export class ContextManager {
  private contexts: Map<string, Record<string, any>> = new Map();

  get(sessionId: string): Record<string, any> {
    if (!this.contexts.has(sessionId)) {
      this.contexts.set(sessionId, {});
    }
    return this.contexts.get(sessionId)!;
  }

  set(sessionId: string, key: string, value: any): void {
    const context = this.get(sessionId);
    context[key] = value;
  }

  update(sessionId: string, updates: Record<string, any>): void {
    const context = this.get(sessionId);
    Object.assign(context, updates);
  }

  clear(sessionId: string): void {
    this.contexts.delete(sessionId);
  }

  getAll(): Map<string, Record<string, any>> {
    return new Map(this.contexts);
  }
}