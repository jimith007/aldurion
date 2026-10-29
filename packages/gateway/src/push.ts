export interface Notifier { notify(title: string, body: string, opts?: { urgent?: boolean }): Promise<void> }

/** ntfy.sh or a self-hosted ntfy server: free, open source, has iOS and Android apps. */
export class Ntfy implements Notifier {
  constructor(private topicUrl: string) {}
  async notify(title: string, body: string, opts: { urgent?: boolean } = {}) {
    await fetch(this.topicUrl, { method: "POST", body, headers: { Title: title, Priority: opts.urgent ? "high" : "default" } }).catch(() => {});
  }
}

export class NoopNotifier implements Notifier {
  async notify() {}
}
