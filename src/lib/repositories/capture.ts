import { db } from "@/lib/db";
import { toMinorUnits, assertSafeMinorUnits } from "@/lib/money";
import { todayDateInZone } from "@/lib/dates";
import { badRequest } from "@/lib/errors";
import { extractAmount, tidyTitle, type CaptureInput } from "@/lib/validation/capture";
import { captureTask } from "@/lib/repositories/tasks";

/**
 * Direct capture, no AI in the path.
 *
 * The user has already told us the type by tapping a button, so there is
 * nothing to interpret. That makes capture free, instant, and immune to the AI
 * being rate limited — which is exactly the failure that motivated it.
 */

export interface CaptureResult {
  type: CaptureInput["type"];
  id: string;
  label: string;
  /** Shown back to the user so an imperfect guess is visible, not hidden. */
  detail?: string;
}

export async function capture(userId: string, input: CaptureInput): Promise<CaptureResult> {
  const title = tidyTitle(input.text);

  switch (input.type) {
    case "task": {
      // Goes through the shared pipeline rather than writing a task directly.
      // The local version here used `Date.now() % 1_000_000` as a board rank,
      // which put every captured task in a different place on the board than
      // one created anywhere else, and it never parsed a date out of what was
      // said — so "call mom tomorrow" arrived undated.
      const settings = await db.userSettings.findUnique({
        where: { userId },
        select: { timezone: true, weekStartsOn: true },
      });

      const { task, matchedText } = await captureTask(
        userId,
        // A date from the client's picker wins; otherwise the sentence is read.
        input.dueAt ? { text: input.text, dueAt: input.dueAt, dueHasTime: true } : { text: input.text },
        {
          timeZone: settings?.timezone ?? "UTC",
          weekStartsOn: settings?.weekStartsOn ?? 1,
        },
      );

      return {
        type: "task",
        id: task.id,
        label: task.title,
        detail: task.dueAt
          ? `due ${matchedText ?? task.dueAt.toISOString().slice(0, 10)}`
          : undefined,
      };
    }

    case "goal": {
      const goal = await db.goal.create({
        data: {
          userId,
          title: title.slice(0, 200),
          targetDate: input.dueAt ?? null,
        },
        select: { id: true, title: true },
      });
      return { type: "goal", id: goal.id, label: goal.title };
    }

    case "project": {
      const project = await db.project.create({
        data: { userId, name: title.slice(0, 150), dueDate: input.dueAt ?? null },
        select: { id: true, name: true },
      });
      return { type: "project", id: project.id, label: project.name };
    }

    case "note": {
      // The first line becomes the title, the whole text stays as the body, so
      // nothing spoken is lost to truncation.
      const firstLine = title.split(/[.\n]/)[0]!.trim() || title;
      const note = await db.note.create({
        data: {
          userId,
          title: firstLine.slice(0, 200),
          content: input.text.trim(),
        },
        select: { id: true, title: true },
      });
      return { type: "note", id: note.id, label: note.title };
    }

    case "expense": {
      const settings = await db.userSettings.findUnique({
        where: { userId },
        select: { currency: true, timezone: true },
      });
      const parsed = extractAmount(input.text);
      const currency = parsed?.currency ?? settings?.currency ?? "USD";
      const amountMinor = parsed ? toMinorUnits(parsed.amountMajor, currency) : 0;

      try {
        assertSafeMinorUnits(amountMinor);
      } catch {
        throw badRequest("That amount is too large to record.");
      }

      const expense = await db.expense.create({
        data: {
          userId,
          description: title.slice(0, 200),
          amountMinor,
          currency,
          spentOn: todayDateInZone(settings?.timezone ?? "UTC"),
        },
        select: { id: true, description: true },
      });

      return {
        type: "expense",
        id: expense.id,
        label: expense.description,
        // Said plainly so a missing amount is obvious rather than silently zero.
        detail: parsed
          ? `${currency} ${parsed.amountMajor}`
          : "no amount detected — edit it on the web app",
      };
    }
  }
}
