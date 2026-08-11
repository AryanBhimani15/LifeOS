import { NotBuiltYet } from "@/components/NotBuiltYet";

export const metadata = { title: "LifeOS — Notes" };

export default function NotesPage() {
  return (
    <NotBuiltYet
      title="Notes"
      what="Markdown notes with folders, tags and full-text search"
      schemaReady="the notes, note_folders and note_links tables, with pg_trgm search indexes"
    />
  );
}
