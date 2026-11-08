export {
  dialogFileText,
  spokenSegments,
  ttsRequests,
} from "@asset-studio/formats";

// Library functions the studio calls (S7). The studio never writes the work
// folder itself; it goes through these.
export { CliError } from "./config/errors.js";
export {
  type Env,
  resolveWorkFolder,
  savedWorkFolder,
  settingsPath,
  setWorkFolder,
} from "./config/settings.js";
export { approve, loadJob, reject } from "./needs/needs.js";
export {
  readIndex,
  readNotes,
  type WorkPaths,
  workPaths,
} from "./store/store.js";
