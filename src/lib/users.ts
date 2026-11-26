import { catalogDepartments, catalogPositionNames } from "./organization";
import type { Employee } from "./types";

export function assistantAccess(user: Employee) {
  // Activity is not authorization. The migration preserves existing access by
  // default and stores explicit decisions in a separate boolean.
  return user.access_enabled !== false;
}
export function hasCompletedLineSignup(
  user: Pick<Employee, "claimed_at" | "line_user_id">,
) {
  // claim_employee sets claimed_at only after the employee completes sign-up.
  // A LINE sender ID alone can belong to a legacy/anonymous chat participant.
  return Boolean(
    user.line_user_id?.trim() &&
    user.claimed_at?.trim() &&
    Number.isFinite(Date.parse(user.claimed_at)),
  );
}
export function employeeAccessStatus(user: Employee) {
  if (!assistantAccess(user)) return "disabled";
  if (!hasCompletedLineSignup(user)) return "unverified";
  return "enabled";
}
export function employeeDepartment(user: Pick<Employee, "department">) {
  const value = user.department?.trim();
  return value && value !== "Team member" ? value : "";
}
export function employeeOptions(
  users: Pick<Employee, "department" | "position">[],
) {
  return {
    departments: [
      ...new Set([...catalogDepartments, ...users.map(employeeDepartment)]),
    ]
      .filter(Boolean)
      .sort(),
    // The organization-chart positions, plus any position already recorded for
    // an employee so existing data stays valid until it is moved to the list.
    positions: [
      ...new Set([
        ...catalogPositionNames,
        ...users.map((user) => user.position?.trim() || ""),
      ]),
    ]
      .filter(Boolean)
      .sort(),
  };
}
