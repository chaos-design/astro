import { resolve } from "node:path";
import {
  installClients,
  openInstalledDashboard,
} from "./install-plugins.mjs";

const targetDir = resolve(process.argv[2] || process.cwd());
const [configFile] = installClients({
  targetDir,
  clients: ["trae"],
});

console.log(`Installed ASTRO hooks in ${configFile}`);
console.log(
  openInstalledDashboard({
    clients: ["trae"],
    targetDir,
  })
    ? "Started or opened the ASTRO dashboard."
    : "The ASTRO dashboard is installed; automatic opening is disabled.",
);
