/**
 * Server entry point of the AI agents module (A1): services of the GUIDS
 * used by the screens from A4 on. Never imported by browser code.
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
