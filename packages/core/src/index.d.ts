import type { AgentBrowser } from "@aldurion/browser";
export type Msg = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
};
export type ToolCall = {
    id: string;
    name: string;
    args: Record<string, unknown>;
};
export type ToolDef = {
    name: string;
    description: string;
    parameters: object;
    sensitive?: boolean;
    run: (args: any) => Promise<string>;
};
export interface Provider {
    chat(messages: Msg[], tools: ToolDef[]): Promise<{
        content: string;
        toolCalls: ToolCall[];
    }>;
}
export declare class OpenAICompatible implements Provider {
    private o;
    constructor(o: {
        baseURL: string;
        apiKey: string;
        model: string;
    });
    chat(messages: Msg[], tools: ToolDef[]): Promise<{
        content: any;
        toolCalls: any;
    }>;
}
export declare function browserTools(b: AgentBrowser): ToolDef[];
export type RunOptions = {
    provider: Provider;
    tools: ToolDef[];
    task: string;
    maxSteps?: number;
    confirm?: (call: ToolCall) => Promise<boolean>;
};
export declare function runAgent({ provider, tools, task, maxSteps, confirm }: RunOptions): Promise<string>;
