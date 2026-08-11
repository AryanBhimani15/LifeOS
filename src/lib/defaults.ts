/** Seeded for every new account so the expense UI is usable immediately. */
export const DEFAULT_CATEGORIES = [
  { name: "Food & Drink", color: "#f97316", icon: "utensils" },
  { name: "Transport", color: "#0ea5e9", icon: "bus" },
  { name: "Housing", color: "#8b5cf6", icon: "home" },
  { name: "Utilities", color: "#14b8a6", icon: "plug" },
  { name: "Education", color: "#6366f1", icon: "graduation-cap" },
  { name: "Health", color: "#ef4444", icon: "heart-pulse" },
  { name: "Entertainment", color: "#ec4899", icon: "clapperboard" },
  { name: "Shopping", color: "#f59e0b", icon: "shopping-bag" },
  { name: "Savings", color: "#22c55e", icon: "piggy-bank" },
  { name: "Other", color: "#64748b", icon: "circle-dashed" },
] as const;
