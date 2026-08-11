import { requireUserId } from "@/lib/session";
import { listTasks } from "@/lib/repositories/tasks";
import { taskQuerySchema } from "@/lib/validation/task";
import { TaskBoard } from "@/components/TaskBoard";

export const metadata = { title: "LifeOS — Tasks" };

export default async function TasksPage() {
  const userId = await requireUserId();

  // Board view: top-level tasks only, ordered by their fractional rank.
  const query = taskQuerySchema.parse({ limit: "200", sort: "boardOrder", dir: "asc" });
  const { items } = await listTasks(userId, query);

  const tasks = items.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    boardOrder: task.boardOrder,
    subtaskCount: task._count.subtasks,
    doneSubtasks: task.subtasks.filter((s) => s.status === "DONE").length,
    project: task.project ? { name: task.project.name, color: task.project.color } : null,
    tags: task.tags.map((t) => t.tag),
  }));

  return <TaskBoard initialTasks={tasks} />;
}
