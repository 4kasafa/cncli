import { jsx as _jsx } from "@opentui/react/jsx-runtime";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.js";
import { T } from "./theme.js";
const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: false,
    backgroundColor: T.bg,
    targetFps: 30,
});
const root = createRoot(renderer);
root.render(_jsx(App, { renderer: renderer }));
