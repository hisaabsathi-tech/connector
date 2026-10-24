export type Coordinates = { latitude: number; longitude: number };

export const INDIA_CENTER: Coordinates = { latitude: 22.9734, longitude: 78.6569 };

const RADIANS = Math.PI / 180;
const EARTH_DIAMETER_METRES = 12_742_000;

/** Great-circle (haversine) distance in metres. */
export function distanceInMetres(a: Coordinates, b: Coordinates) {
  const lat = (b.latitude - a.latitude) * RADIANS;
  const lng = (b.longitude - a.longitude) * RADIANS;
  const sinLat = Math.sin(lat / 2);
  const sinLng = Math.sin(lng / 2);
  return (
    EARTH_DIAMETER_METRES *
    Math.asin(
      Math.sqrt(
        sinLat * sinLat +
          Math.cos(a.latitude * RADIANS) * Math.cos(b.latitude * RADIANS) * sinLng * sinLng,
      ),
    )
  );
}

/** Compass bearing (degrees from north, 0–360) from `a` to `b`. */
export function bearingBetween(a: Coordinates, b: Coordinates) {
  const dLng = (b.longitude - a.longitude) * RADIANS;
  const lat1 = a.latitude * RADIANS;
  const lat2 = b.latitude * RADIANS;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// How far ahead along the road the vehicle faces: far enough that GPS jitter of a few metres
// barely turns it, near enough that it turns into each bend as it reaches it.
const ROUTE_LOOKAHEAD_METRES = 30;
// Farther than this from the road it was given, the vehicle has left that route (a detour, or a
// route planned from an older position), so it faces the delivery itself instead.
const OFF_ROUTE_METRES = 75;

type FlatPoint = { x: number; y: number };

/**
 * Where `from` meets `route` (`[longitude, latitude][]`) and the point `lookaheadMetres` further
 * along it, or null when `from` is off the route or already at its end. Distances use a flat
 * projection around `from`, accurate over the short stretch involved.
 */
function stretchAheadOnRoute(
  from: Coordinates,
  route: [number, number][],
  lookaheadMetres: number,
): { on: Coordinates; ahead: Coordinates } | null {
  const metresPerDegree = (EARTH_DIAMETER_METRES / 2) * RADIANS;
  const cosLat = Math.cos(from.latitude * RADIANS);
  const toFlat = ([longitude, latitude]: [number, number]): FlatPoint => ({
    x: (longitude - from.longitude) * metresPerDegree * cosLat,
    y: (latitude - from.latitude) * metresPerDegree,
  });
  const toCoordinates = ({ x, y }: FlatPoint): Coordinates => ({
    latitude: from.latitude + y / metresPerDegree,
    longitude: from.longitude + x / (metresPerDegree * cosLat),
  });
  const points = route.map(toFlat);

  // Where the vehicle meets the road: the nearest point on any segment, not the nearest vertex,
  // so a vertex just behind the vehicle never wins.
  let segment = -1;
  let along: FlatPoint = { x: 0, y: 0 };
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i] as FlatPoint;
    const b = points[i + 1] as FlatPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / lengthSquared)) : 0;
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(point.x, point.y);
    if (distance < nearest) {
      nearest = distance;
      segment = i;
      along = point;
    }
  }
  if (segment < 0 || nearest > OFF_ROUTE_METRES) return null;

  // Walk forward along the road from there.
  let remaining = lookaheadMetres;
  let current = along;
  for (let i = segment + 1; i < points.length; i += 1) {
    const next = points[i] as FlatPoint;
    const length = Math.hypot(next.x - current.x, next.y - current.y);
    if (length >= remaining) {
      const share = remaining / length;
      const ahead = {
        x: current.x + (next.x - current.x) * share,
        y: current.y + (next.y - current.y) * share,
      };
      return { ahead: toCoordinates(ahead), on: toCoordinates(along) };
    }
    remaining -= length;
    current = next;
  }
  // Less road left than the look-ahead: face where it ends, unless the vehicle is already there.
  return Math.hypot(current.x - along.x, current.y - along.y) > 3
    ? { ahead: toCoordinates(current), on: toCoordinates(along) }
    : null;
}

/**
 * The way the road (`[longitude, latitude][]`) runs where the vehicle at `from` is on it: from its
 * spot on the road to a point a little ahead. Null while it is off that road or at its end.
 */
export function bearingAlongRoute(
  from: Coordinates,
  routeCoords: [number, number][] | null | undefined,
  lookaheadMetres = ROUTE_LOOKAHEAD_METRES,
): number | null {
  if (!routeCoords || routeCoords.length < 2) return null;
  const stretch = stretchAheadOnRoute(from, routeCoords, lookaheadMetres);
  return stretch ? bearingBetween(stretch.on, stretch.ahead) : null;
}

/**
 * Compass bearing (0–360°) for a vehicle at `from` on its way to `target`. With the road route
 * (`[longitude, latitude][]`), it faces the way that road goes from the vehicle's spot on it to a
 * point a little ahead, so GPS drift to either side of the road doesn't tilt it. It depends only on
 * positions, never on the phone's compass, so it stays right while parked, turning, or between
 * location updates. Off the route, or without one, it faces `target` directly.
 */
export function bearingTowardsTarget(
  from: Coordinates,
  target: Coordinates,
  routeCoords?: [number, number][] | null,
  lookaheadMetres = ROUTE_LOOKAHEAD_METRES,
): number {
  return bearingAlongRoute(from, routeCoords, lookaheadMetres) ?? bearingBetween(from, target);
}

/**
 * Fewer points for drawing a long driven line (Douglas–Peucker, `toleranceMetres` off the line at
 * most). The first and last points always stay. Short lines are returned as they are; the raw
 * history is never changed, only what the map is handed.
 */
export function simplifyForDisplay<T extends Coordinates>(
  points: readonly T[],
  toleranceMetres = 4,
  minPoints = 300,
): T[] {
  if (points.length <= minPoints) return [...points];
  const first = points[0] as T;
  // Local flat projection in metres: accurate enough over a city-sized trip.
  const cos = Math.cos(first.latitude * RADIANS);
  const metresPerDegree = (EARTH_DIAMETER_METRES / 2) * RADIANS;
  const xy = points.map((point) => ({
    x: (point.longitude - first.longitude) * metresPerDegree * cos,
    y: (point.latitude - first.latitude) * metresPerDegree,
  }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop() as [number, number];
    const a = xy[from] as { x: number; y: number };
    const b = xy[to] as { x: number; y: number };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    let worst = -1;
    let worstAt = -1;
    for (let i = from + 1; i < to; i += 1) {
      const p = xy[i] as { x: number; y: number };
      const off =
        length === 0
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
      if (off > worst) {
        worst = off;
        worstAt = i;
      }
    }
    if (worstAt !== -1 && worst > toleranceMetres) {
      keep[worstAt] = 1;
      stack.push([from, worstAt], [worstAt, to]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

/**
 * A driven line with every stop drawn as one point. Standing still, GPS drifts tens of metres from
 * fix to fix, and joined up in order the fixes draw a star of lines round one place. So a lone fix
 * that jumps out and straight back is dropped, and a run that stays within `radiusMetres` of where
 * it began for `minStopMs` or more is drawn as its middlemost fix. Only for drawing: the raw
 * history is never changed.
 */
export function collapseStops<T extends Coordinates & { recordedAt: string }>(
  points: readonly T[],
  radiusMetres = 60,
  minStopMs = 120_000,
): T[] {
  const steady: T[] = [];
  points.forEach((point, index) => {
    const before = steady.at(-1);
    const after = points[index + 1];
    const spike =
      before &&
      after &&
      distanceInMetres(before, after) <= radiusMetres &&
      distanceInMetres(before, point) > radiusMetres &&
      distanceInMetres(point, after) > radiusMetres;
    if (!spike) steady.push(point);
  });
  const shown: T[] = [];
  let from = 0;
  while (from < steady.length) {
    const anchor = steady[from] as T;
    // Measured from the run's middle so far, not its first fix: that may sit at the drift's edge.
    let middle: Coordinates = anchor;
    let to = from + 1;
    for (; to < steady.length; to += 1) {
      const next = steady[to] as T;
      if (distanceInMetres(middle, next) > radiusMetres) break;
      const size = to - from + 1;
      middle = {
        latitude: middle.latitude + (next.latitude - middle.latitude) / size,
        longitude: middle.longitude + (next.longitude - middle.longitude) / size,
      };
    }
    const run = steady.slice(from, to);
    const lasted = Date.parse((run.at(-1) as T).recordedAt) - Date.parse(anchor.recordedAt);
    if (run.length > 2 && lasted >= minStopMs) {
      const centre = middle;
      shown.push(
        run.reduce((best, point) =>
          distanceInMetres(point, centre) < distanceInMetres(best, centre) ? point : best,
        ),
      );
      from = to;
    } else {
      shown.push(anchor);
      from += 1;
    }
  }
  return shown;
}

export function centerOf(points: Coordinates[]): Coordinates {
  if (!points.length) return INDIA_CENTER;
  return points.reduce(
    (sum, point) => ({
      latitude: sum.latitude + point.latitude / points.length,
      longitude: sum.longitude + point.longitude / points.length,
    }),
    { latitude: 0, longitude: 0 },
  );
}

/** Web-mercator zoom that keeps every point in a phone-sized static map. */
export function zoomToFit(points: Coordinates[]) {
  if (points.length < 2) return 15;
  let widest = 0;
  for (const point of points)
    for (const other of points) widest = Math.max(widest, distanceInMetres(point, other));
  return Math.max(10, Math.min(16, 15 - Math.log2(Math.max(1, widest) / 500)));
}

function toWorld(point: Coordinates, scale: number) {
  const sinLat = Math.sin(point.latitude * RADIANS);
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

/** Pixel offset of `point` inside a map of `size` centred on `center` at `zoom`. */
export function projectToMap(
  point: Coordinates,
  center: Coordinates,
  zoom: number,
  size: { width: number; height: number },
) {
  const scale = 256 * 2 ** zoom;
  const p = toWorld(point, scale);
  const c = toWorld(center, scale);
  return { left: size.width / 2 + p.x - c.x, top: size.height / 2 + p.y - c.y };
}
