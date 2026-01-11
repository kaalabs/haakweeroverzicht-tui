import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { App } from "./ui/App";

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
});

createRoot(renderer).render(<App />);
