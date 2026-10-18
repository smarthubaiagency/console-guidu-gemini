/**
 * Server entry point of the CRM module (F4c): services used by the
 * screens, the REST API and the MCP. Never imported by browser code.
 */
import "server-only";

export {
  ContactCreateInput,
  ContactUpdateInput,
  createContact,
  findContactByPhone,
  getContactCard,
  getContact,
  listContacts,
  ListContactsQuery,
  updateContact,
  type ContactCard,
  type ContactDto,
} from "./server/services/contacts";
