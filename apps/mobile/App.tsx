import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";

type Human = { id: string; runId: number; kind: string; reason: string };
type Run = { id: number; task: string; status: string; result?: string };
type Job = { id: number; name: string; cron: string; task: string };

export default function App() {
  const [cfg, setCfg] = useState<{ url: string; token: string } | null>(null);
  const [draft, setDraft] = useState({ url: "http://", token: "" });
  const [runs, setRuns] = useState<Run[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [task, setTask] = useState("");
  const [human, setHuman] = useState<Human | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [size, setSize] = useState({ w: 1, h: 1 });
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => { SecureStore.getItemAsync("cfg").then((v) => v && setCfg(JSON.parse(v))); }, []);

  const api = useCallback(async (method: string, path: string, body?: unknown) => {
    const r = await fetch(cfg!.url + path, { method, headers: { authorization: `Bearer ${cfg!.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  }, [cfg]);

  const refresh = useCallback(async () => {
    if (!cfg) return;
    setRuns(await api("GET", "/runs"));
    setJobs(await api("GET", "/jobs"));
    const pending: Human[] = await api("GET", "/humans");
    if (pending[0]) setHuman(pending[0]);
  }, [api, cfg]);

  useEffect(() => {
    if (!cfg) return;
    refresh();
    const sock = new WebSocket(`${cfg.url.replace(/^http/, "ws")}/ws?token=${cfg.token}`);
    ws.current = sock;
    sock.onmessage = (m) => {
      const e = JSON.parse(String(m.data));
      if (e.type === "frame") setFrame(e.data);
      else if (e.type === "human") setHuman({ id: e.id, runId: e.runId, kind: e.kind, reason: e.reason });
      else if (e.type === "human_done" || e.type === "finished") { setHuman(null); setFrame(null); refresh(); }
    };
    return () => sock.close();
  }, [cfg, refresh]);

  const tap = (x: number, y: number) => ws.current?.send(JSON.stringify({ type: "input", runId: human!.runId, event: { type: "tap", x: x / size.w, y: y / size.h } }));
  const send = (event: object) => ws.current?.send(JSON.stringify({ type: "input", runId: human!.runId, event }));
  const finish = async (resolved: boolean) => { await api("POST", `/humans/${human!.id}`, { resolved }); setHuman(null); setFrame(null); refresh(); };

  if (!cfg)
    return (
      <SafeAreaView style={{ flex: 1, padding: 24, gap: 12, justifyContent: "center" }}>
        <Text style={{ fontSize: 28, fontWeight: "700" }}>Aldurion</Text>
        <TextInput value={draft.url} onChangeText={(url) => setDraft({ ...draft, url })} autoCapitalize="none" placeholder="Gateway URL" style={{ borderWidth: 1, padding: 12 }} />
        <TextInput value={draft.token} onChangeText={(token) => setDraft({ ...draft, token })} autoCapitalize="none" secureTextEntry placeholder="Token" style={{ borderWidth: 1, padding: 12 }} />
        <Pressable onPress={async () => { await SecureStore.setItemAsync("cfg", JSON.stringify(draft)); setCfg(draft); }} style={{ backgroundColor: "#111", padding: 14 }}><Text style={{ color: "#fff", textAlign: "center" }}>Connect</Text></Pressable>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 8 }}>
        <TextInput value={task} onChangeText={setTask} placeholder="Tell the agent what to do" multiline style={{ borderWidth: 1, padding: 12, minHeight: 60 }} />
        <Pressable onPress={async () => { if (task.trim()) { await api("POST", "/runs", { task }); setTask(""); refresh(); } }} style={{ backgroundColor: "#111", padding: 14 }}><Text style={{ color: "#fff", textAlign: "center" }}>Run</Text></Pressable>
      </View>
      <ScrollView onTouchStart={refresh} contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Text style={{ fontWeight: "700" }}>Jobs</Text>
        {jobs.map((j) => <Text key={j.id}>{j.name} · {j.cron}</Text>)}
        <Text style={{ fontWeight: "700", marginTop: 12 }}>Runs</Text>
        {runs.map((r) => <Text key={r.id}>#{r.id} [{r.status}] {r.task}{r.result ? `\n   ${r.result.slice(0, 160)}` : ""}</Text>)}
      </ScrollView>
      <Modal visible={!!human} animationType="slide">
        <SafeAreaView style={{ flex: 1, padding: 12, gap: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: "700" }}>{human?.kind}: {human?.reason}</Text>
          <Pressable style={{ flex: 1, backgroundColor: "#222" }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} onPress={(e) => tap(e.nativeEvent.locationX, e.nativeEvent.locationY)}>
            {frame && <Image source={{ uri: `data:image/jpeg;base64,${frame}` }} style={{ flex: 1 }} resizeMode="stretch" />}
          </Pressable>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput value={typed} onChangeText={setTyped} placeholder="Type into the page" autoCapitalize="none" style={{ flex: 1, borderWidth: 1, padding: 10 }} />
            <Pressable onPress={() => { send({ type: "text", text: typed }); setTyped(""); }} style={{ padding: 12, backgroundColor: "#ddd" }}><Text>Type</Text></Pressable>
            <Pressable onPress={() => send({ type: "key", key: "Enter" })} style={{ padding: 12, backgroundColor: "#ddd" }}><Text>Enter</Text></Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => finish(false)} style={{ flex: 1, padding: 14, backgroundColor: "#c33" }}><Text style={{ color: "#fff", textAlign: "center" }}>Decline</Text></Pressable>
            <Pressable onPress={() => finish(true)} style={{ flex: 1, padding: 14, backgroundColor: "#2a7" }}><Text style={{ color: "#fff", textAlign: "center" }}>Done, continue</Text></Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
