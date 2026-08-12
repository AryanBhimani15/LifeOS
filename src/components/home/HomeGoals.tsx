import Link from "next/link";
import { ChevronRight, Target } from "lucide-react";
import { deadlineLabel } from "@/lib/goals";
import { GoalIcon } from "@/components/goals/GoalIcon";
import { GoalProgressBar } from "@/components/goals/GoalProgress";

/**
 * Goals on the Home screen.
 *
 * Deliberately three rows and nothing else: the nearest deadlines, the same bar
 * component the Goals page uses, and a way through. Home is not a second goals
 * page, and reproducing the toolbar and the summary cards here would make it one.
 */

export interface HomeGoal {
  id: string;
  title: string;
  targetDate: string | null;
  icon: string | null;
  percent: number;
  detail: string;
}

export function HomeGoals({ goals, today }: { goals: HomeGoal[]; today: string }) {
  return (
    <section className="home-goals">
      <header>
        <span>
          <Target size={12} /> GOALS
        </span>
        <Link href="/goals">
          All goals <ChevronRight size={14} />
        </Link>
      </header>
      <h2>What this is all for</h2>

      {goals.length === 0 ? (
        <p className="home-goals-empty">
          No goals yet. <Link href="/goals">Set one</Link> and the work you already do starts
          adding up to something.
        </p>
      ) : (
        <ul>
          {goals.map((goal) => {
            const due = deadlineLabel(goal.targetDate ? new Date(goal.targetDate) : null, today);
            return (
              <li key={goal.id}>
                <Link href={`/goals/${goal.id}`}>
                  <span className="home-goal-icon">
                    <GoalIcon name={goal.icon} size={15} />
                  </span>
                  <div>
                    <b>{goal.title}</b>
                    <GoalProgressBar percent={goal.percent} detail={due ?? goal.detail} compact />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
