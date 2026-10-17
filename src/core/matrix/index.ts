/**
 * Matrix core of the Inbox (IN3, ADR 0023). What other parts of the core
 * call; the route handlers and the job registry import the files directly.
 */
export { matrixEnabled } from "./config";
export {
  requestAccountSync,
  requestDeviceLogout,
  requestWorkspaceSync,
} from "./jobs";
export { matrixWorkspaceLifecycle } from "./lifecycle";
