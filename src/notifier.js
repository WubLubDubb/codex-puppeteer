function now() {
  return new Date().toISOString();
}

export class InMemoryNotifier {
  constructor() {
    this.messages = [];
  }

  async send(notification) {
    const record = {
      ...notification,
      sentAt: now()
    };

    this.messages.push(record);
    return structuredClone(record);
  }

  list() {
    return structuredClone(this.messages);
  }
}

export class FanOutNotifier {
  constructor(notifiers = []) {
    this.notifiers = notifiers;
  }

  async send(notification) {
    let firstResult = null;

    for (const notifier of this.notifiers) {
      const result = await notifier.send(notification);
      if (!firstResult) {
        firstResult = result;
      }
    }

    return firstResult ?? structuredClone(notification);
  }

  list() {
    const primaryNotifier = this.notifiers.find((notifier) => typeof notifier.list === "function");
    return primaryNotifier ? primaryNotifier.list() : [];
  }
}
