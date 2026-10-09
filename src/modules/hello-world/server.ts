/**
 * Server entry point of the reference module (Adendo §4): services and
 * server components. Never imported by browser code.
 */
import "server-only";

export {
  createHelloWorldRecord,
  getHelloWorldRecord,
  listHelloWorldRecords,
  type HelloWorldRecordDto,
} from "./server/services/records";
export {
  resolveHelloWorldGreeting,
  type ResolvedGreeting,
} from "./server/services/greeting";
export {
  HelloWorldAdminSettings,
  HelloWorldWorkspaceSettings,
} from "./components/settings";
