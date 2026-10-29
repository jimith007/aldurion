import puppeteer from "puppeteer-core";
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "menuitem", "tab", "switch", "option"]);
export class AgentBrowser {
    browser;
    page;
    cdp;
    refs;
    constructor(browser, page, cdp, refs = new Map()) {
        this.browser = browser;
        this.page = page;
        this.cdp = cdp;
        this.refs = refs;
    }
    static async connect(browserURL = "http://127.0.0.1:9222") {
        const browser = await puppeteer.connect({ browserURL });
        const page = (await browser.pages())[0] ?? (await browser.newPage());
        return new AgentBrowser(browser, page, await page.createCDPSession());
    }
    static async launch(executablePath, headless = true) {
        const browser = await puppeteer.launch({ executablePath, headless, args: ["--no-sandbox"] });
        const page = await browser.newPage();
        return new AgentBrowser(browser, page, await page.createCDPSession());
    }
    async navigate(url) {
        await this.page.goto(url, { waitUntil: "domcontentloaded" });
        return this.page.url();
    }
    async snapshot() {
        const { nodes } = (await this.cdp.send("Accessibility.getFullAXTree"));
        this.refs.clear();
        const lines = [`url: ${this.page.url()}`];
        for (const n of nodes) {
            const role = n.role?.value, name = n.name?.value;
            if (n.ignored || !role || !name)
                continue;
            if (INTERACTIVE.has(role) && n.backendDOMNodeId) {
                const ref = this.refs.size + 1;
                this.refs.set(ref, n.backendDOMNodeId);
                lines.push(`[${ref}] ${role} "${name}"`);
            }
            else if (role === "heading" || role === "StaticText")
                lines.push(`${role === "heading" ? "#" : "-"} ${name}`);
        }
        return lines.join("\n");
    }
    async center(ref) {
        const backendNodeId = this.refs.get(ref);
        if (!backendNodeId)
            throw new Error(`unknown ref ${ref}, call snapshot first`);
        await this.cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
        const { model } = (await this.cdp.send("DOM.getBoxModel", { backendNodeId }));
        const q = model.content;
        return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
    }
    async click(ref) {
        const { x, y } = await this.center(ref);
        await this.page.mouse.click(x, y);
    }
    async type(ref, text) {
        await this.click(ref);
        await this.page.keyboard.type(text);
    }
    async screenshot() {
        return (await this.page.screenshot({ type: "png", encoding: "base64" }));
    }
    async close() {
        await this.browser.close();
    }
}
