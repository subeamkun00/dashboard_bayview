import { BAYVIEW_CATALOG } from "./bayview-catalog";
import { catalogDepartments } from "./organization";
import type { Employee } from "./types";

export type EmployeeCreationInput = {
  first_name: string;
  last_name: string;
  employee_id: string;
  phone: string;
  department_id: string;
  position_id: string;
};
export type EmployeeCreationOptions = {
  departments: { id: string; name: string }[];
  positions: { id: string; name: string; department_id: string }[];
};
export type EmployeeCreationField = keyof EmployeeCreationInput;
export type EmployeeCreationErrors = Partial<
  Record<EmployeeCreationField, string>
>;

// Every [department, position] pair of the organization chart.
export const CATALOG_POSITIONS: readonly (readonly [string, string])[] =
  BAYVIEW_CATALOG.flatMap((group) =>
    group.positions.map((name) => [group.department, name] as const),
  );

export const PHONE_ERROR = "Enter a valid phone number (9–15 digits).";
export function isValidPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return (
    /^\+?[0-9][0-9 ()-]*$/.test(value.trim()) &&
    digits.length >= 9 &&
    digits.length <= 15
  );
}

export const emptyEmployeeInput: EmployeeCreationInput = {
  first_name: "",
  last_name: "",
  employee_id: "",
  phone: "",
  department_id: "",
  position_id: "",
};

// These are frontend selection keys, not database IDs. Replace this adapter
// with the real department/position catalog when the backend is connected.
export function frontendEmployeeOptions(
  // Kept for the existing call sites: new employees always use the list below.
  _users: Employee[] = [],
): EmployeeCreationOptions {
  void _users;
  return {
    departments: catalogDepartments.map((name) => ({ id: name, name })),
    positions: CATALOG_POSITIONS.map(([department, name]) => ({
      id: JSON.stringify([department, name]),
      name,
      department_id: department,
    })),
  };
}

// Any language is allowed (Thai, English, ...). Letters plus combining marks
// (Thai vowels and tone marks are marks), spaces, hyphens, apostrophes and
// periods. Digits, symbols and control characters are rejected.
export const NAME_ERROR =
  "Use letters, spaces, hyphens, apostrophes or periods only (no numbers or symbols).";
export const isValidPersonName = (value: string) =>
  /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(value);

export function validateEmployeeCreation(
  input: EmployeeCreationInput,
  options?: EmployeeCreationOptions,
): EmployeeCreationErrors {
  const errors: EmployeeCreationErrors = {};
  for (const [field, label] of [
    ["first_name", "First name"],
    ["last_name", "Last name"],
  ] as const) {
    const value = input[field];
    if (typeof value !== "string" || !value.trim())
      errors[field] = `${label} is required.`;
    else if (!isValidPersonName(value.trim()))
      errors[field] = NAME_ERROR;
    else if (value.trim().length > 100)
      errors[field] = `${label} must be 100 characters or fewer.`;
  }
  if (typeof input.employee_id !== "string" || !input.employee_id.trim())
    errors.employee_id = "Employee ID is required.";
  else if (
    input.employee_id.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(input.employee_id)
  )
    errors.employee_id = "Enter a valid employee ID (100 characters or fewer).";
  if (input.phone.trim() && !isValidPhone(input.phone))
    errors.phone = PHONE_ERROR;
  if (typeof input.department_id !== "string" || !input.department_id)
    errors.department_id = "Select a department.";
  else if (
    options &&
    !options.departments.some(({ id }) => id === input.department_id)
  )
    errors.department_id = "This department is no longer available.";
  if (typeof input.position_id !== "string" || !input.position_id)
    errors.position_id = "Select a position.";
  else if (
    options &&
    !options.positions.some(
      ({ id, department_id }) =>
        id === input.position_id && department_id === input.department_id,
    )
  )
    errors.position_id = "Select a position belonging to this department.";
  return errors;
}
