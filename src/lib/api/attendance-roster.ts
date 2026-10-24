import { apiRequest } from "@/lib/api/client";
import { graphqlRequest } from "@/lib/api/graphql";

import type { AttendanceSubStatus } from "./attendance";

/**
 * Whether the signed-in user owns the active organisation. The owner gets its attendance (Company
 * tab) even when their member role there isn't superadmin.
 */
export async function fetchIsOrgOwner(token: string): Promise<boolean> {
  const payload = await graphqlRequest<{
    me: { organization?: { ownerUserId?: string | null } | null; user: { id: string } };
  }>({ query: "query ConnectorOwner { me { organization { ownerUserId } user { id } } }", token });
  const owner = payload.me.organization?.ownerUserId;
  return Boolean(owner && owner === payload.me.user.id);
}

export type RosterStatus = "ABSENT" | "HOLIDAY" | "PRESENT";

/** One employee on one day of the organisation's roster. */
export type RosterRow = {
  /** The session's id, or a made-up one for absent and holiday rows. */
  id: string;
  date: string;
  memberId: string;
  name: string;
  role: string;
  status: RosterStatus;
  /** The holiday's name (or weekday for a weekly off) on HOLIDAY rows. */
  holidayName: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkOutKind: string | null;
  /** Check-in place. */
  address: string | null;
  shortAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  checkOutAddress: string | null;
  checkOutShortAddress: string | null;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
  hasCheckInPhoto: boolean;
  hasCheckOutPhoto: boolean;
  subStatuses: AttendanceSubStatus[];
};

export type Roster = {
  items: RosterRow[];
  /** Rows matching the search, across all pages. */
  total: number;
  totalEmployees: number;
  /** Employee-days with a check-in in the range (not narrowed by the search). */
  present: number;
  absent: number;
};

const ROSTER_QUERY = `
query ConnectorRoster($from: String!, $to: String!, $search: String, $page: Int, $limit: Int) {
  attendanceDay(from: $from, to: $to, search: $search, page: $page, limit: $limit) {
    items {
      id date memberId name role status holidayName
      checkInAt checkOutAt checkOutKind subStatuses hasCheckInPhoto hasCheckOutPhoto
      address shortAddress latitude longitude
      checkOutAddress checkOutShortAddress checkOutLatitude checkOutLongitude
    }
    pagination { total }
    totalEmployees present absent
  }
}`;

/**
 * Every employee's attendance between two `YYYY-MM-DD` days, absent and holiday rows included,
 * oldest day first. `limit: 0` returns every row at once.
 */
export async function fetchRoster(
  token: string,
  input: { from: string; to: string; search?: string; page?: number; limit?: number },
): Promise<Roster> {
  const payload = await graphqlRequest<{
    attendanceDay: Omit<Roster, "total"> & { pagination: { total: number } };
  }>({
    query: ROSTER_QUERY,
    token,
    variables: { ...input, search: input.search?.trim() || null },
  });
  const { pagination, ...roster } = payload.attendanceDay;
  return { ...roster, total: pagination.total };
}

/** Fresh signed URLs for one roster row's photos; null where none was taken. */
export async function fetchRosterPhotos(token: string, id: string, date: string) {
  const { photos } = await apiRequest<{
    photos: { checkIn: string | null; checkOut: string | null };
  }>(
    `/organizations/me/attendance/${encodeURIComponent(id)}/photos?date=${encodeURIComponent(date)}`,
    token,
  );
  return photos;
}

/** The organisation's working hours (`HH:mm`) for a year, for the attendance register. */
export async function fetchWorkHours(token: string, year: number) {
  const payload = await graphqlRequest<{
    attendanceConfig: { workStartTime: string; workEndTime: string };
  }>({
    query:
      "query ConnectorWorkHours($year: Int!) { attendanceConfig(year: $year) { workStartTime workEndTime } }",
    token,
    variables: { year },
  });
  return payload.attendanceConfig;
}
