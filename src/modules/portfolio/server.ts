/**
 * Server entry point of the Portfolio module (F5a): services and the admin
 * settings component. Never imported by browser code.
 */
import "server-only";

export { PortfolioAdminSettings } from "./components/admin-settings";
export {
  addVariant,
  createItem,
  getItem,
  handleFromTitle,
  itemToUcp,
  type ItemView,
  listItems,
  removeVariant,
  updateItem,
  updateVariant,
  type VariantView,
} from "./server/services/items";
