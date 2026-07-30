import { cp, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/.openai/", import.meta.url), { recursive: true });
await cp(
  new URL("../.openai/hosting.json", import.meta.url),
  new URL("../dist/.openai/hosting.json", import.meta.url),
);
