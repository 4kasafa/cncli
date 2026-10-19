import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.js";
import { T } from "./theme.js";

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useMouse: true,
  backgroundColor: T.bg,
  targetFps: 30,
});

const root = createRoot(renderer);
root.render(<App renderer={renderer} />);
