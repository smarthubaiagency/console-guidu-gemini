/**
 * Every Zernio endpoint the adapter calls, in one place (GB1a). Read from
 * Zernio's public API reference as generated in its Go SDK
 * (`zernio-dev/zernio-go` v0.1.999, OpenAPI): docs.zernio.com was not
 * reachable from the build environment. To confirm with the real account
 * before the first production use (docs/pendencias.md).
 *
 * Authentication: `Authorization: Bearer <ZERNIO_API_KEY>`.
 */
export const ZERNIO_BASE_URL = "https://zernio.com/api";

export const ZERNIO_ENDPOINTS = {
  /** GET ?profileId&redirect_url&headless=true → { authUrl, state }. */
  connectUrl: "/v1/connect/googlebusiness",
  /**
   * GET ?profileId&pendingDataToken → { locations: [{ id, name, accountId,
   * accountName, address, category, storeCode }], hasMore }.
   */
  listLocations: "/v1/connect/googlebusiness/locations",
  /**
   * POST { profileId, pendingDataToken, locationId, accountId } →
   * { account: { accountId, selectedLocationId, ... } }.
   */
  selectLocation: "/v1/connect/googlebusiness/select-location",
  /**
   * GET ?readMask → { title, regularHours.periods, specialHours, profile,
   * websiteUri, phoneNumbers, categories, location: { placeId, ... } }.
   */
  locationDetails: (accountId: string) =>
    `/v1/accounts/${encodeURIComponent(accountId)}/gmb-location-details`,
  /**
   * GET ?pageSize → { reviews: [{ id, reviewer, rating, comment, createTime,
   * reviewReply }], averageRating, totalReviewCount, nextPageToken }.
   */
  reviews: (accountId: string) =>
    `/v1/accounts/${encodeURIComponent(accountId)}/gmb-reviews`,
} as const;

/** Fields asked of the location details (Google's readMask names). */
export const ZERNIO_DETAILS_READ_MASK =
  "title,regularHours,specialHours,profile,websiteUri,phoneNumbers,categories";

/** Error of the headless redirect when Google permissions were unchecked. */
export const ZERNIO_MISSING_PERMISSIONS_ERROR = "missing_google_permissions";
