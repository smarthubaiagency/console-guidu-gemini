/**
 * Server entry point of the AI agents module: services of the GUIDS (A1 and
 * A4a) and of their test conversation (A2b), used by the screens of A4.
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
  createReferral,
  customizeGuid,
  deleteGuid,
  deleteReferral,
  getGuid,
  GuidUpdateInput,
  updateGuid,
  updateReferral,
  type GuidDetailDto,
} from "./server/services/guid-config";
export {
  GuidTestMessageInput,
  sendGuidTestMessage,
  type GuidTestMessageResult,
} from "./server/services/conversations";
