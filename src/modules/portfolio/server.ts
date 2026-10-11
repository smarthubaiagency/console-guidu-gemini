/**
 * Server entry point of the Portfolio module (F5a): services and the admin
 * settings component. Never imported by browser code.
 */
import "server-only";

export { PortfolioAdminSettings } from "./components/admin-settings";
export {
  type AccommodationTypeView,
  addVariant,
  createItem,
  getItem,
  handleFromTitle,
  itemToUcp,
  type ItemView,
  listItems,
  type LodgingView,
  lodgingProblem,
  type RatePlanView,
  removeVariant,
  updateItem,
  updateVariant,
  type VariantView,
} from "./server/services/items";
export {
  addAccommodationType,
  addRatePlan,
  removeAccommodationType,
  removeRatePlan,
  updateAccommodationType,
  updateRatePlan,
} from "./server/services/lodging";
