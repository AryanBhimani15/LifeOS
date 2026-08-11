import { NotBuiltYet } from "@/components/NotBuiltYet";

export const metadata = { title: "LifeOS — Goals" };

export default function GoalsPage() {
  return (
    <NotBuiltYet
      title="Goals"
      what="Long-term goals with milestones and progress history"
      schemaReady="the goals, milestones and goal_progress tables — goal progress already feeds the Today view"
    />
  );
}
