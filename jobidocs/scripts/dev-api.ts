/**
 * API bez Electronu pro vývoj UI (npm run api:dev). PDF a tisk nejsou
 * dostupné (503), náhled v editoru se renderuje v prohlížeči.
 * Port 3848, aby nekolidoval s nainstalovaným JobiDocs.
 */
import dns from "node:dns";
import path from "node:path";
import os from "node:os";
import { startApiServer } from "../api/server.js";

dns.setDefaultResultOrder("ipv4first");

const port = Number(process.env.PORT || 3848);
const dataDir = process.env.JOBIDOCS_DATA || path.join(os.tmpdir(), "jobidocs-dev-data");
startApiServer(port, dataDir, { appVersion: "dev" }).then(() => console.log(`JobiDocs dev API na http://127.0.0.1:${port}, data v ${dataDir}`));
