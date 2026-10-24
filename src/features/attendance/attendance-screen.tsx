import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { NoPermission } from "@/components/modules/empty-state";
import { TabScreen } from "@/components/modules/layout";
import { ListPageSkeleton } from "@/components/modules/skeleton";
import { Text } from "@/components/modules/typography";
import { fetchOpenAttendance } from "@/lib/api/attendance";
import { fetchIsOrgOwner } from "@/lib/api/attendance-roster";
import { useAuthSession } from "@/lib/auth/session";
import { useViewer } from "@/lib/auth/viewer";
import { haptic } from "@/lib/haptics";

import { CompanyAttendance } from "./company-attendance";
import { OwnAttendance } from "./own-attendance";

type AttendanceView = "company" | "own";

const TABS: { label: string; value: AttendanceView }[] = [
  { label: "Company", value: "company" },
  { label: "Own", value: "own" },
];

type Access = {
  /** Owns the organisation; with a superadmin, the people who get its roster. */
  owner: boolean;
  /** Checks in themselves; false for a superadmin while Superadmin Attendance is off. */
  selfAttendance: boolean;
};

function ViewTabs({
  onChange,
  value,
}: {
  onChange: (next: AttendanceView) => void;
  value: AttendanceView;
}) {
  return (
    <View
      accessibilityRole="tablist"
      className="mt-4 flex-row gap-1.5 border border-border bg-card p-1"
    >
      {TABS.map((tab) => {
        const active = tab.value === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className={`h-9 flex-1 items-center justify-center ${active ? "bg-primary active:bg-primary" : "active:bg-[#F7F8FF]"}`}
            key={tab.value}
            onPress={() => {
              if (active) return;
              haptic("selection");
              onChange(tab.value);
            }}
          >
            <Text
              className={`text-sm font-medium ${active ? "text-primary-foreground" : "text-foreground"}`}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** What the member's Attendance tab shows; null until known. */
function useAccess(token: string | null) {
  const [access, setAccess] = useState<Access | null>(null);
  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([
      // Unknown ownership falls back to the member's own attendance.
      fetchIsOrgOwner(token).catch(() => false),
      fetchOpenAttendance(token)
        // Older servers don't send it; everyone checked in before the module existed.
        .then((status) => status.selfAttendance !== false)
        .catch(() => true),
    ]).then(([owner, selfAttendance]) => {
      if (active) setAccess({ owner, selfAttendance });
    });
    return () => {
      active = false;
    };
  }, [token]);
  return access;
}

/** The organisation's superadmin role, however its slug is spelled. */
function isSuperadminRole(slug: string | null | undefined) {
  return (
    slug
      ?.trim()
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() === "superadmin"
  );
}

/**
 * The Attendance tab. The organisation's owner and every superadmin of it get its roster
 * (Company); when they also check in themselves (Superadmin Attendance on) they get Company / Own
 * tabs to see their own attendance too, and without it only the roster. Every other member sees
 * only their own. Without the Attendance menu the tab is hidden and a link goes Home; with it but
 * without attendance view, the tab says so.
 */
export function AttendanceScreen() {
  const { token } = useAuthSession();
  const viewer = useViewer();
  const allowed = viewer.isLoaded && viewer.canViewAttendance;
  const access = useAccess(allowed ? token : null);
  const [view, setView] = useState<AttendanceView>("company");

  if (viewer.isLoaded && !viewer.tabs.attendance) return <Redirect href="/" />;
  if (viewer.isLoaded && !viewer.canViewAttendance)
    return (
      <NoPermission description="Your role needs Attendance view access, with Attendance on for this organization." />
    );
  if (!access)
    return (
      <TabScreen>
        <ListPageSkeleton chips={false} />
      </TabScreen>
    );
  if (!(access.owner || isSuperadminRole(viewer.viewer?.roleSlug))) return <OwnAttendance />;
  if (!access.selfAttendance) return <CompanyAttendance />;
  const tabs = <ViewTabs onChange={setView} value={view} />;
  return view === "company" ? <CompanyAttendance tabs={tabs} /> : <OwnAttendance tabs={tabs} />;
}
