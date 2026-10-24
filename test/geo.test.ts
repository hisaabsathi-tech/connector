import { describe, expect, it } from "bun:test";
import { bearingAlongRoute, bearingTowardsTarget } from "@/lib/maps/geo";

describe("bearingTowardsTarget", () => {
  const origin = { latitude: 22.88, longitude: 87.78 };
  const targetEast = { latitude: 22.88, longitude: 87.98 }; // Directly East
  const targetNorth = { latitude: 23.08, longitude: 87.78 }; // Directly North

  it("calculates direct bearing when no route coordinates are given", () => {
    const bearingEast = bearingTowardsTarget(origin, targetEast, null);
    expect(Math.round(bearingEast)).toBe(90);

    const bearingNorth = bearingTowardsTarget(origin, targetNorth, null);
    expect(Math.round(bearingNorth)).toBe(0);
  });

  it("follows the road route leaving the origin towards the delivery address", () => {
    // Road leaves origin heading East, then turns North
    const routeCoords: [number, number][] = [
      [87.78, 22.88], // Origin
      [87.8, 22.88], // 2km East
      [87.8, 22.95], // turns North
    ];
    const bearing = bearingTowardsTarget(origin, targetNorth, routeCoords);
    // Even though destination is North, the road leaves origin towards East
    expect(Math.round(bearing)).toBe(90);
  });

  it("advances along the route when the vehicle moves forward", () => {
    const routeCoords: [number, number][] = [
      [87.78, 22.88], // Start
      [87.8, 22.88], // Corner
      [87.8, 22.95], // North to destination
    ];
    // Vehicle is now at the corner heading North
    const atCorner = { latitude: 22.88, longitude: 87.8 };
    const bearing = bearingTowardsTarget(atCorner, targetNorth, routeCoords);
    expect(Math.round(bearing)).toBe(0); // Heading North
  });

  it("falls back to target when route coordinates have only 1 point", () => {
    const routeCoords: [number, number][] = [[87.78, 22.88]];
    const bearing = bearingTowardsTarget(origin, targetEast, routeCoords);
    expect(Math.round(bearing)).toBe(90);
  });

  // A straight road east with a vertex every ~40 m, the delivery far to the north.
  const roadEast: [number, number][] = [
    [87.78, 22.88],
    [87.7804, 22.88],
    [87.7808, 22.88],
    [87.7812, 22.88],
  ];

  it("faces forward just past a bend point, not back at the point it passed", () => {
    // 15 m past the second vertex, which is still the nearest one.
    const justPast = { latitude: 22.88, longitude: 87.78055 };
    expect(Math.round(bearingTowardsTarget(justPast, targetNorth, roadEast))).toBe(90);
  });

  it("keeps facing along the road when GPS drifts a few metres to one side", () => {
    const beside = { latitude: 22.88007, longitude: 87.7806 }; // ~8 m north of the road
    expect(Math.round(bearingTowardsTarget(beside, targetNorth, roadEast))).toBe(90);
  });

  it("turns into a bend as it reaches it", () => {
    const withBend: [number, number][] = [
      [87.78, 22.88],
      [87.7804, 22.88],
      [87.7804, 22.8804], // turns north
    ];
    const atBend = { latitude: 22.88, longitude: 87.78039 }; // ~1 m before the bend
    const bearing = bearingTowardsTarget(atBend, targetEast, withBend);
    expect(bearing).toBeGreaterThan(-1);
    expect(bearing).toBeLessThan(10);
  });

  it("faces the delivery directly once well off the route it was given", () => {
    const detour = { latitude: 22.882, longitude: 87.7806 }; // ~220 m north of the road
    expect(Math.round(bearingTowardsTarget(detour, targetEast, roadEast))).toBe(
      Math.round(bearingTowardsTarget(detour, targetEast, null)),
    );
  });

  it("gives the road's own direction on it, and none off it, so the driven direction can take over", () => {
    const onRoad = { latitude: 22.88, longitude: 87.7806 };
    expect(Math.round(bearingAlongRoute(onRoad, roadEast) ?? -1)).toBe(90);
    const otherRoad = { latitude: 22.882, longitude: 87.7806 };
    expect(bearingAlongRoute(otherRoad, roadEast)).toBeNull();
    expect(bearingAlongRoute(onRoad, null)).toBeNull();
  });
});
