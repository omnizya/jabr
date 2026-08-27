import { randomUUID } from "crypto";

export interface Subscription {
  id: string;
  uri: string;
  createdAt: string;
}

export class SubscriptionManager {
  private subscriptions = new Map<string, Subscription>();
  private uriListeners = new Map<string, Set<string>>();

  subscribe(uri: string): Subscription {
    const sub: Subscription = {
      id: randomUUID(),
      uri,
      createdAt: new Date().toISOString(),
    };
    this.subscriptions.set(sub.id, sub);

    if (!this.uriListeners.has(uri)) {
      this.uriListeners.set(uri, new Set());
    }
    this.uriListeners.get(uri)!.add(sub.id);

    return sub;
  }

  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    this.subscriptions.delete(subscriptionId);
    const listeners = this.uriListeners.get(sub.uri);
    if (listeners) {
      listeners.delete(subscriptionId);
      if (listeners.size === 0) this.uriListeners.delete(sub.uri);
    }
    return true;
  }

  hasSubscribers(uri: string): boolean {
    const listeners = this.uriListeners.get(uri);
    return !!listeners && listeners.size > 0;
  }

  getSubscriberIds(uri: string): string[] {
    const listeners = this.uriListeners.get(uri);
    return listeners ? Array.from(listeners) : [];
  }

  listSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values());
  }

  get size(): number {
    return this.subscriptions.size;
  }
}
