import { NotBuiltYet } from "@/components/NotBuiltYet";

export const metadata = { title: "LifeOS — Projects" };

export default function ProjectsPage() {
  return (
    <NotBuiltYet
      title="Projects"
      what="Project dashboards, milestones and activity history"
      schemaReady="the projects, milestones and project_activities tables, with cascade rules and indexes"
    />
  );
}
