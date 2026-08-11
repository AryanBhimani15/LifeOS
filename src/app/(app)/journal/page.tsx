import { NotBuiltYet } from "@/components/NotBuiltYet";

export const metadata = { title: "LifeOS — Journal" };

export default function JournalPage() {
  return (
    <NotBuiltYet
      title="Journal"
      what="Daily entries with mood and productivity tracking"
      schemaReady="the journal_entries table, with mood and productivity range constraints"
    />
  );
}
