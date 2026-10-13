/**
 * Server entry point of the AI agents module: services of the GUIDS (A1)
 * and of their test conversation (A2b), used by the screens from A4 on.
 * Never imported by browser code.
 */
import "server-only";

export {
  createGuid,
  GuidCreateInput,
  listGuids,
  listGuidTemplates,
  type GuidDto,
  type GuidTemplateDto,
} from "./server/services/agents";
export {
  GuidTestMessageInput,
  sendGuidTestMessage,
  type GuidTestMessageResult,
} from "./server/services/conversations";
