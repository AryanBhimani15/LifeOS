import { NotBuiltYet } from "@/components/NotBuiltYet";

export const metadata = { title: "LifeOS — Calendar" };

export default function CalendarPage() {
  return (
    <NotBuiltYet
      title="Calendar"
      what="Month, week and day views with recurring events"
      schemaReady="the events and recurrence_rules tables, plus timezone-correct expansion helpers in src/lib/dates.ts"
    />
  );
}
