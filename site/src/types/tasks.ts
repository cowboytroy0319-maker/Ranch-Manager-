// ============================================================================
// Ranch Manager Pro — Tasks & Projects module types (shared client + server)
// All values are JSON-safe (dates are strings, numerics are JS numbers) so
// they cross the server/client boundary without React refusing to render.
// ============================================================================

export const TASK_STATUSES = ["to_do", "in_progress", "completed", "canceled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  "livestock",
  "feed/hay",
  "pasture",
  "fencing/water",
  "equipment",
  "crops/farm",
  "paperwork",
  "general",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  to_do: "To do",
  in_progress: "In progress",
  completed: "Completed",
  canceled: "Canceled",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const CATEGORY_LABEL: Record<TaskCategory, string> = {
  livestock: "Livestock",
  "feed/hay": "Feed & Hay",
  pasture: "Pasture",
  "fencing/water": "Fencing & Water",
  equipment: "Equipment",
  "crops/farm": "Crops & Farm",
  paperwork: "Paperwork",
  general: "General",
};

export type Task = {
  id: number;
  operation_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null; // YYYY-MM-DD
  category: TaskCategory;
  project_id: number | null;
  pasture_id: number | null;
  equipment_id: number | null;
  animal_id: number | null;
  pasture_name: string | null;
  equipment_name: string | null;
  animal_name: string | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
};

export type TasksData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  tasks: Task[];
  projects: Project[];
  pastures: { id: number; name: string }[];
  equipment: { id: number; name: string }[];
  animals: { id: number; name: string }[];
};

/** A single task surfaced on the Daily Operations board: overdue / due today /
 * high-priority open work for THIS operation. */
export type DashboardTask = {
  id: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  category: TaskCategory;
  project_name: string | null;
  /** why this task is on the board: "overdue" | "today" | "high priority" */
  reason: string;
};