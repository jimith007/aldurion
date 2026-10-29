import puppeteer, { type Browser, type CDPSession, type Page } from "puppeteer-core";

const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "menuitem", "tab", "switch", "option"]);

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

  async close() {
    await this.browser.close();
  }
}
