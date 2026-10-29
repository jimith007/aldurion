import assert from "node:assert";
import { Sandbox, sandboxTools } from "../packages/sandbox/dist/index.js";
const sb = await Sandbox.create("node");
try {
  const [sh, write, read] = sandboxTools(sb);
  await write.run({ path: "src/hello.js", content: "console.log([0,1,2,3,4,5,6,7,8,9].reduce((a,b)=>a+b))" });
  assert.equal(await read.run({ path: "src/hello.js" }), "console.log([0,1,2,3,4,5,6,7,8,9].reduce((a,b)=>a+b))");
  const r = await sh.run({ cmd: "node src/hello.js" });
  assert.match(r, /exit 0\n45/);
  const bad = await sh.run({ cmd: "node -e 'process.exit(3)'" });
  assert.match(bad, /exit 3/);
  console.log("sandbox ok");
} finally { await sb.destroy(); }
