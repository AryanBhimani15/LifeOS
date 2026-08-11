/**
 * Demo account seed.
 *
 *   npm run db:seed
 *
 * Creates one account with coherent, *relative* data — everything is positioned
 * against "now", so the dashboard looks alive whenever you run it rather than
 * showing a frozen week from whenever the seed was written.
 *
 * Idempotent: the demo user is deleted and rebuilt on every run. The cascade
 * rules mean that one delete removes every owned row.
 */

// tsx does not read .env on its own, and the seed needs DATABASE_URL.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@lifeos.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "lifeos-demo-2026";
const TIMEZONE = process.env.DEMO_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Midnight UTC for a @db.Date column, offset by whole days from today. */
function dateOnly(daysFromToday = 0): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d;
}

/** An instant, relative to now, in hours. */
function at(hoursFromNow: number): Date {
  return new Date(Date.now() + hoursFromNow * 3_600_000);
}

/** Today at a given local hour, expressed as an instant. */
function todayAtLocalHour(hour: number): Date {
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // Build the local wall-clock time, then let the runtime resolve the offset.
  const guess = new Date(`${local}T${String(hour).padStart(2, "0")}:00:00`);
  return guess;
}

async function main() {
  console.log(`Seeding demo account (timezone: ${TIMEZONE})…`);

  await db.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Aryan",
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      settings: { create: { timezone: TIMEZONE, currency: "INR", weekStartsOn: 1 } },
    },
  });
  const userId = user.id;

  // ---- Tags ---------------------------------------------------------------
  const tagNames = ["uni", "azure", "health", "deep-work", "admin", "reading"];
  const tags = await Promise.all(
    tagNames.map((name, i) =>
      db.tag.create({
        data: {
          userId,
          name,
          color: ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#64748b", "#ec4899"][i]!,
        },
      }),
    ),
  );
  const tag = (name: string) => tags.find((t) => t.name === name)!.id;

  // ---- Projects -----------------------------------------------------------
  const azure = await db.project.create({
    data: {
      userId,
      name: "Azure Migration Assignment",
      description:
        "Final-year coursework: migrate the sample workload to Azure App Service and document the architecture.",
      status: "ACTIVE",
      priority: "URGENT",
      color: "#0ea5e9",
      dueDate: dateOnly(2),
      tags: { create: [{ tagId: tag("uni") }, { tagId: tag("azure") }] },
      milestones: {
        create: [
          { title: "Research and architecture", completedAt: at(-72), sortOrder: 1024 },
          { title: "Implementation", sortOrder: 2048, targetDate: dateOnly(1) },
          { title: "Testing", sortOrder: 3072, targetDate: dateOnly(2) },
          { title: "Submission", sortOrder: 4096, targetDate: dateOnly(2) },
        ],
      },
    },
  });

  const thesis = await db.project.create({
    data: {
      userId,
      name: "BTech Final Year Project",
      description: "Machine learning pipeline for time-series anomaly detection.",
      status: "ACTIVE",
      priority: "HIGH",
      color: "#6366f1",
      dueDate: dateOnly(45),
      tags: { create: [{ tagId: tag("uni") }] },
      milestones: {
        create: [
          { title: "Literature review", completedAt: at(-400), sortOrder: 1024 },
          { title: "Dataset preparation", completedAt: at(-120), sortOrder: 2048 },
          { title: "Model training", sortOrder: 3072, targetDate: dateOnly(20) },
          { title: "Evaluation and write-up", sortOrder: 4096, targetDate: dateOnly(40) },
        ],
      },
    },
  });

  const home = await db.project.create({
    data: {
      userId,
      name: "Life admin",
      status: "ACTIVE",
      priority: "LOW",
      color: "#64748b",
      tags: { create: [{ tagId: tag("admin") }] },
    },
  });

  // ---- Tasks --------------------------------------------------------------
  // A deliberate mix: overdue, due today, upcoming, blocked, in progress, done.
  const tasks: {
    title: string;
    status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueAt?: Date | null;
    projectId?: string;
    order: number;
    completedAt?: Date;
    tagIds?: string[];
    subtasks?: string[];
  }[] = [
    {
      title: "Write the Azure deployment section",
      status: "IN_PROGRESS",
      priority: "URGENT",
      dueAt: at(-6), // overdue — should top the Now list
      projectId: azure.id,
      order: 1024,
      tagIds: [tag("uni"), tag("azure")],
      subtasks: ["Diagram the resource group", "Document App Service config", "Add cost estimate"],
    },
    {
      title: "Run the migration test suite",
      status: "TODO",
      priority: "HIGH",
      dueAt: at(5), // due later today
      projectId: azure.id,
      order: 2048,
      tagIds: [tag("azure")],
    },
    {
      title: "Submit assignment on the portal",
      status: "BLOCKED",
      priority: "URGENT",
      dueAt: at(46),
      projectId: azure.id,
      order: 3072,
      tagIds: [tag("uni")],
    },
    {
      title: "Retrain model with the cleaned dataset",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueAt: at(96),
      projectId: thesis.id,
      order: 1024,
      tagIds: [tag("uni"), tag("deep-work")],
      subtasks: ["Rerun preprocessing", "Tune hyperparameters", "Log results"],
    },
    {
      title: "Read the anomaly detection survey paper",
      status: "TODO",
      priority: "MEDIUM",
      dueAt: at(120),
      projectId: thesis.id,
      order: 2048,
      tagIds: [tag("reading")],
    },
    {
      title: "Book the gym induction",
      status: "TODO",
      priority: "LOW",
      dueAt: at(30),
      projectId: home.id,
      order: 1024,
      tagIds: [tag("health")],
    },
    {
      title: "Renew the domain",
      status: "TODO",
      priority: "MEDIUM",
      dueAt: at(-30), // quietly overdue
      projectId: home.id,
      order: 2048,
      tagIds: [tag("admin")],
    },
    {
      title: "Set up the Azure resource group",
      status: "DONE",
      priority: "HIGH",
      projectId: azure.id,
      order: 4096,
      completedAt: at(-70),
      tagIds: [tag("azure")],
    },
    {
      title: "Clean the training dataset",
      status: "DONE",
      priority: "MEDIUM",
      projectId: thesis.id,
      order: 3072,
      completedAt: at(-115),
    },
    {
      title: "Plan next week",
      status: "TODO",
      priority: "MEDIUM",
      dueAt: at(70),
      order: 3072,
    },
  ];

  for (const t of tasks) {
    await db.task.create({
      data: {
        userId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt ?? null,
        completedAt: t.completedAt ?? null,
        projectId: t.projectId ?? null,
        boardOrder: t.order,
        tags: t.tagIds?.length ? { create: t.tagIds.map((tagId) => ({ tagId })) } : undefined,
        subtasks: t.subtasks?.length
          ? {
              create: t.subtasks.map((title, i) => ({
                userId,
                title,
                boardOrder: (i + 1) * 1024,
                status: i === 0 ? "DONE" : "TODO",
                completedAt: i === 0 ? at(-20) : null,
              })),
            }
          : undefined,
      },
    });
  }

  // ---- Calendar events for today -----------------------------------------
  const events = [
    { title: "Project standup", hour: 9, duration: 0.5 },
    { title: "Deep work — Azure docs", hour: 10, duration: 2 },
    { title: "Supervisor call", hour: 14, duration: 1 },
    { title: "Gym", hour: 18, duration: 1 },
  ];
  for (const e of events) {
    const start = todayAtLocalHour(e.hour);
    await db.event.create({
      data: {
        userId,
        title: e.title,
        startAt: start,
        endAt: new Date(start.getTime() + e.duration * 3_600_000),
        projectId: e.title.includes("Azure") ? azure.id : null,
      },
    });
  }

  // ---- Habits with real completion history --------------------------------
  const habits: { name: string; color: string; streak: number; doneToday: boolean }[] = [
    { name: "Workout", color: "#10b981", streak: 12, doneToday: false }, // at risk
    { name: "Read 20 pages", color: "#ec4899", streak: 7, doneToday: true },
    { name: "Meditate", color: "#6366f1", streak: 4, doneToday: true },
    { name: "No late-night snacks", color: "#f59e0b", streak: 2, doneToday: false },
    { name: "Journal", color: "#0ea5e9", streak: 9, doneToday: true },
  ];

  for (const h of habits) {
    const habit = await db.habit.create({
      data: { userId, name: h.name, color: h.color, cadence: "DAILY", targetPerWeek: 7 },
    });

    // Build a contiguous run ending today (or yesterday, if not done today), so
    // the streak the UI computes matches the number written here.
    const start = h.doneToday ? 0 : 1;
    const days = Array.from({ length: h.streak }, (_, i) => dateOnly(-(start + i)));
    await db.habitCompletion.createMany({
      data: days.map((completedOn) => ({ habitId: habit.id, userId, completedOn })),
    });
  }

  // ---- Goals --------------------------------------------------------------
  const marathon = await db.goal.create({
    data: {
      userId,
      title: "Run a half marathon",
      description: "Build to 21km by the end of the year.",
      status: "ACTIVE",
      targetDate: dateOnly(120),
      tags: { create: [{ tagId: tag("health") }] },
      milestones: {
        create: [
          { title: "Run 5km without stopping", completedAt: at(-800), sortOrder: 1024 },
          { title: "Run 10km", completedAt: at(-300), sortOrder: 2048 },
          { title: "Run 15km", sortOrder: 3072, targetDate: dateOnly(45) },
          { title: "Run 21km", sortOrder: 4096, targetDate: dateOnly(115) },
        ],
      },
    },
  });
  await db.goalProgress.createMany({
    data: [
      { goalId: marathon.id, percent: 20, recordedAt: at(-800), note: "First 5km" },
      { goalId: marathon.id, percent: 45, recordedAt: at(-300), note: "10km done" },
      { goalId: marathon.id, percent: 52, recordedAt: at(-48), note: "12km long run" },
    ],
  });

  await db.goal.create({
    data: {
      userId,
      title: "Graduate with distinction",
      status: "ACTIVE",
      targetDate: dateOnly(200),
      projectId: thesis.id,
      milestones: {
        create: [
          { title: "Semester 7 above 80%", completedAt: at(-1200), sortOrder: 1024 },
          { title: "Final project accepted", sortOrder: 2048, targetDate: dateOnly(50) },
          { title: "Semester 8 above 80%", sortOrder: 3072, targetDate: dateOnly(180) },
        ],
      },
    },
  });

  await db.goal.create({
    data: {
      userId,
      title: "Ship LifeOS v1",
      status: "ACTIVE",
      targetDate: dateOnly(60),
      milestones: {
        create: [
          { title: "Data model", completedAt: at(-10), sortOrder: 1024 },
          { title: "Auth and API", completedAt: at(-5), sortOrder: 2048 },
          { title: "Web UI", sortOrder: 3072, targetDate: dateOnly(14) },
          { title: "Deploy", sortOrder: 4096, targetDate: dateOnly(55) },
        ],
      },
    },
  });

  // ---- Expenses over the last 30 days ------------------------------------
  const categories = await db.expenseCategory.createManyAndReturn({
    data: [
      { userId, name: "Food & Drink", color: "#f97316" },
      { userId, name: "Transport", color: "#0ea5e9" },
      { userId, name: "Education", color: "#6366f1" },
      { userId, name: "Health", color: "#ef4444" },
      { userId, name: "Entertainment", color: "#ec4899" },
    ],
  });
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;

  const expenseTemplates: [string, string, number][] = [
    ["Campus canteen lunch", "Food & Drink", 18000],
    ["Metro card top-up", "Transport", 50000],
    ["Coffee", "Food & Drink", 25000],
    ["Azure credits", "Education", 120000],
    ["Textbook — ML systems", "Education", 89900],
    ["Gym membership", "Health", 250000],
    ["Groceries", "Food & Drink", 142500],
    ["Cab home", "Transport", 32000],
    ["Cinema", "Entertainment", 45000],
    ["Protein powder", "Health", 189900],
    ["Dinner with friends", "Food & Drink", 96000],
    ["Notebook and pens", "Education", 21000],
  ];

  await db.expense.createMany({
    data: expenseTemplates.map(([description, category, amountMinor], i) => ({
      userId,
      description,
      // Amounts are integer minor units (paise) — never floats.
      amountMinor,
      currency: "INR",
      categoryId: cat(category),
      spentOn: dateOnly(-Math.floor((i * 29) / expenseTemplates.length) - 1),
    })),
  });

  await db.budget.createMany({
    data: [
      {
        userId,
        name: "Monthly food",
        limitMinor: 600000,
        currency: "INR",
        categoryId: cat("Food & Drink"),
        periodStart: dateOnly(-30),
        periodEnd: dateOnly(0),
      },
      {
        userId,
        name: "Monthly transport",
        limitMinor: 200000,
        currency: "INR",
        categoryId: cat("Transport"),
        periodStart: dateOnly(-30),
        periodEnd: dateOnly(0),
      },
    ],
  });

  // ---- Notes --------------------------------------------------------------
  const folder = await db.noteFolder.create({ data: { userId, name: "University" } });

  await db.note.create({
    data: {
      userId,
      folderId: folder.id,
      projectId: azure.id,
      title: "Azure architecture decisions",
      pinned: true,
      content: `# Azure architecture

## Chosen shape
- App Service (Linux, B1) behind the default domain
- Postgres Flexible Server, private endpoint
- Blob storage for uploaded documents

## Why not AKS
Overkill for a single workload and the cluster cost alone blows the budget.

## Open question
Whether to pin the runtime or track the latest LTS.`,
      tags: { create: [{ tagId: tag("azure") }, { tagId: tag("uni") }] },
    },
  });

  await db.note.create({
    data: {
      userId,
      folderId: folder.id,
      projectId: thesis.id,
      title: "Anomaly detection — paper notes",
      content: `# Reading notes

- Isolation Forest is the strongest baseline so far.
- Seasonal decomposition helps a lot on the energy dataset.
- **Next:** compare against an LSTM autoencoder.`,
      tags: { create: [{ tagId: tag("reading") }, { tagId: tag("uni") }] },
    },
  });

  await db.note.create({
    data: {
      userId,
      title: "Weekly review template",
      content: `## What moved
## What stalled
## What I am changing next week`,
    },
  });

  // ---- Journal ------------------------------------------------------------
  const journal: [number, string, number, number][] = [
    [-1, "Good deep work block in the morning. Azure docs are finally taking shape.", 4, 4],
    [-2, "Distracted day. Too much context switching between the thesis and coursework.", 2, 2],
    [-3, "Long run felt easy. Reading is compounding — the survey paper made sense this time.", 5, 4],
    [-4, "Blocked on the portal submission. Emailed the coordinator.", 3, 3],
    [-6, "Quiet Sunday. Planned the week and cleared admin.", 4, 3],
  ];

  for (const [days, content, mood, productivity] of journal) {
    await db.journalEntry.create({
      data: {
        userId,
        entryDate: dateOnly(days),
        content,
        mood,
        productivity,
        projectId: days === -1 ? azure.id : null,
      },
    });
  }

  // ---- Project activity ---------------------------------------------------
  await db.projectActivity.createMany({
    data: [
      {
        projectId: azure.id,
        userId,
        kind: "task.completed",
        summary: "“Set up the Azure resource group” completed",
        createdAt: at(-70),
      },
      {
        projectId: azure.id,
        userId,
        kind: "milestone.completed",
        summary: "Milestone “Research and architecture” completed",
        createdAt: at(-72),
      },
      {
        projectId: thesis.id,
        userId,
        kind: "task.completed",
        summary: "“Clean the training dataset” completed",
        createdAt: at(-115),
      },
    ],
  });

  // ---- Summary ------------------------------------------------------------
  const [taskCount, habitCount, expenseCount] = await Promise.all([
    db.task.count({ where: { userId } }),
    db.habit.count({ where: { userId } }),
    db.expense.count({ where: { userId } }),
  ]);

  console.log(`
Demo account ready.

  email:    ${DEMO_EMAIL}
  password: ${DEMO_PASSWORD}
  timezone: ${TIMEZONE}

  ${taskCount} tasks (2 overdue, 1 due today), 3 projects, 3 goals,
  ${habitCount} habits with streaks, 4 events today, ${expenseCount} expenses, 3 notes, 5 journal entries.
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
