/**
 * Geometry of the map grid (GB1b, especificação §6.2).
 *
 * Adapted from the geo-grid algorithm of `AgriciDaniel/claude-seo`
 * (MIT, `skills/seo/references/maps-geo-grid.md`): a square grid of
 * `size × size` points centred on the unit, `radius` from the centre to the
 * middle of each edge, spacing `2 × radius / (size − 1)`. Instead of the
 * flat 111.32 km-per-degree offset of the reference, each point is placed
 * with the great-circle destination formula and checked with Haversine, so
 * the spacing stays right far from the equator.
 */

export const EARTH_RADIUS_KM = 6371.0088;

export type LatLng = Readonly<{ latitude: number; longitude: number }>;

export type GridPoint = LatLng &
  Readonly<{
    /** Row 0 is the northernmost; column 0 the westernmost. */
    row: number;
    column: number;
  }>;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** Great-circle distance in km between two points (Haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) *
      Math.cos(toRadians(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The point at `distanceKm` from `origin` along `bearingDegrees`
 * (0 = north, 90 = east), on the sphere.
 */
export function destinationPoint(
  origin: LatLng,
  bearingDegrees: number,
  distanceKm: number,
): LatLng {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.latitude);
  const lng1 = toRadians(origin.longitude);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    latitude: toDegrees(lat2),
    // Normalised to [-180, 180).
    longitude: ((toDegrees(lng2) + 540) % 360) - 180,
  };
}

export function isValidGridSize(size: number): boolean {
  return Number.isInteger(size) && size >= 3 && size <= 13 && size % 2 === 1;
}

/** Distance in km between neighbouring points of the grid. */
export function gridStepKm(size: number, radiusKm: number): number {
  return (2 * radiusKm) / (size - 1);
}

/**
 * The grid around `center`, row by row from north-west to south-east
 * (the same order as the `ranks` matrix of a measurement). The centre
 * point is exactly `center`.
 */
export function buildGrid(
  center: LatLng,
  size: number,
  radiusKm: number,
): GridPoint[] {
  if (!isValidGridSize(size)) {
    throw new Error(`Invalid grid size: ${size}`);
  }
  if (!(radiusKm > 0 && radiusKm <= 50)) {
    throw new Error(`Invalid grid radius: ${radiusKm}`);
  }
  const middle = (size - 1) / 2;
  const step = gridStepKm(size, radiusKm);
  const points: GridPoint[] = [];
  for (let row = 0; row < size; row += 1) {
    // North (row 0) to south.
    const north = (middle - row) * step;
    const onMeridian =
      north === 0
        ? center
        : destinationPoint(center, north > 0 ? 0 : 180, Math.abs(north));
    for (let column = 0; column < size; column += 1) {
      const east = (column - middle) * step;
      const point =
        east === 0
          ? onMeridian
          : destinationPoint(onMeridian, east > 0 ? 90 : 270, Math.abs(east));
      points.push({
        row,
        column,
        latitude: round7(point.latitude),
        longitude: round7(point.longitude),
      });
    }
  }
  return points;
}

/** DataForSEO accepts at most 7 decimals in a coordinate. */
function round7(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}
