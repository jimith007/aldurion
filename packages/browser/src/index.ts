import { AD_COSMETIC_CSS, AD_HOSTS } from "./adblock.js";
import puppeteer, { type Browser, type CDPSession, type Page } from "puppeteer-core";

const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "menuitem", "tab", "switch", "option"]);

export { AD_HOSTS, loadHostsList } from "./adblock.js";

export class AgentBrowser {
  private constructor(private browser: Browser, private page: Page, private cdp: CDPSession, private refs = new Map<number, number>()) {}

  static async connect(browserURL = "http://127.0.0.1:9222") {
    const browser = await puppeteer.connect({ browserURL });
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    return new AgentBrowser(browser, page, await page.createCDPSession());
  }

  static async launch(executablePath: string, headless = true) {
    const browser = await puppeteer.launch({ executablePath, headless, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    return new AgentBrowser(browser, page, await page.createCDPSession());
  }

  async navigate(url: string) {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    return this.page.url();
  }

  async snapshot() {
    const { nodes } = (await this.cdp.send("Accessibility.getFullAXTree")) as { nodes: any[] };
    this.refs.clear();
    const lines: string[] = [`url: ${this.page.url()}`];
    for (const n of nodes) {
      const role = n.role?.value, name = n.name?.value;
      if (n.ignored || !role || !name) continue;
      if (INTERACTIVE.has(role) && n.backendDOMNodeId) {
        const ref = this.refs.size + 1;
        this.refs.set(ref, n.backendDOMNodeId);
        lines.push(`[${ref}] ${role} "${name}"`);
      } else if (role === "heading" || role === "StaticText") lines.push(`${role === "heading" ? "#" : "-"} ${name}`);
    }
    return lines.join("\n");
  }

  private async center(ref: number) {
    const backendNodeId = this.refs.get(ref);
    if (!backendNodeId) throw new Error(`unknown ref ${ref}, call snapshot first`);
    await this.cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { model } = (await this.cdp.send("DOM.getBoxModel", { backendNodeId })) as any;
    const q = model.content as number[];
    return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
  }

  async click(ref: number) {
    const { x, y } = await this.center(ref);
    await this.page.mouse.click(x, y);
  }

  async type(ref: number, text: string) {
    await this.click(ref);
    await this.page.keyboard.type(text);
  }

  async screenshot() {
    return (await this.page.screenshot({ type: "png", encoding: "base64" })) as string;
  }

  /** Block ad/tracker network requests and hide leftover ad slots. */
  async blockAds(hosts: string[] = AD_HOSTS) {
    await this.cdp.send("Network.enable");
    await this.cdp.send("Network.setBlockedURLs", { urls: hosts.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]) });
    await this.page.evaluateOnNewDocument((css: string) => {
      const add = () => { const s = document.createElement("style"); s.textContent = css; (document.head ?? document.documentElement).append(s); };
      document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", add) : add();
    }, AD_COSMETIC_CSS);
  }

  /** Full-page MHTML (HTML plus subresources) for offline reading. */
  async mhtml() {
    return ((await this.cdp.send("Page.captureSnapshot", { format: "mhtml" })) as { data: string }).data;
  }

  title() {
    return this.page.title();
  }

  url() {
    return this.page.url();
  }

  async text() {
    return this.page.evaluate(() => document.body.innerText);
  }

  async links() {
    return this.page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ text: (a as HTMLAnchorElement).innerText.trim(), href: (a as HTMLAnchorElement).href })));
  }

  async startScreencast(onFrame: (jpegBase64: string) => void) {
    this.cdp.on("Page.screencastFrame", async (f: any) => {
      onFrame(f.data);
      await this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: 900, maxHeight: 1600 });
  }

  async stopScreencast() {
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    this.cdp.removeAllListeners("Page.screencastFrame");
  }

  /** x and y are fractions (0 to 1) of the viewport so a phone screen of any size maps correctly. */
  async input(e: { type: "tap" | "key" | "text" | "scroll"; x?: number; y?: number; key?: string; text?: string; dy?: number }) {
    const { w, h } = await this.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    if (e.type === "tap") await this.page.mouse.click((e.x ?? 0) * w, (e.y ?? 0) * h);
    else if (e.type === "text") await this.page.keyboard.type(e.text ?? "");
    else if (e.type === "key") await this.page.keyboard.press((e.key ?? "Enter") as any);
    else if (e.type === "scroll") await this.page.mouse.wheel({ deltaY: e.dy ?? 400 });
  }

  async close() {
    await this.browser.close();
  }
}
