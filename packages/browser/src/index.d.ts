export declare class AgentBrowser {
    private browser;
    private page;
    private cdp;
    private refs;
    private constructor();
    static connect(browserURL?: string): Promise<AgentBrowser>;
    static launch(executablePath: string, headless?: boolean): Promise<AgentBrowser>;
    navigate(url: string): Promise<string>;
    snapshot(): Promise<string>;
    private center;
    click(ref: number): Promise<void>;
    type(ref: number, text: string): Promise<void>;
    screenshot(): Promise<string>;
    close(): Promise<void>;
}
