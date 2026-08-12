/**
 * The activity catalogue, as reference data.
 *
 * The database gets these rows from a migration, because a fresh deployment
 * must have a working calculator without anyone remembering to run a seed
 * script — and a migration is static SQL, which cannot import this file.
 *
 * So the same twelve rows are written twice, and `tests/fitness.test.ts`
 * asserts that this list and the migration's INSERT still agree. Tests restore
 * the catalogue from here after truncating, which is what makes a test that
 * deliberately mutates an activity safe to run before any other.
 */

export interface CatalogueActivity {
  id: string;
  slug: string;
  name: string;
  icon: string;
  caloriesPerHour: number;
  sortOrder: number;
}

export const ACTIVITY_CATALOGUE: readonly CatalogueActivity[] = [
  { id: "act_walking", slug: "walking", name: "Walking", icon: "walk", caloriesPerHour: 250, sortOrder: 10 },
  { id: "act_yoga", slug: "yoga", name: "Yoga", icon: "yoga", caloriesPerHour: 200, sortOrder: 20 },
  { id: "act_weight_training", slug: "weight-training", name: "Weight Training", icon: "weights", caloriesPerHour: 350, sortOrder: 30 },
  { id: "act_dancing", slug: "dancing", name: "Dancing", icon: "dance", caloriesPerHour: 400, sortOrder: 40 },
  { id: "act_hiking", slug: "hiking", name: "Hiking", icon: "hike", caloriesPerHour: 400, sortOrder: 50 },
  { id: "act_jogging", slug: "jogging", name: "Jogging", icon: "jog", caloriesPerHour: 450, sortOrder: 60 },
  { id: "act_cycling", slug: "cycling", name: "Cycling", icon: "bike", caloriesPerHour: 500, sortOrder: 70 },
  { id: "act_basketball", slug: "basketball", name: "Basketball", icon: "ball", caloriesPerHour: 500, sortOrder: 80 },
  { id: "act_swimming", slug: "swimming", name: "Swimming", icon: "swim", caloriesPerHour: 550, sortOrder: 90 },
  { id: "act_running", slug: "running", name: "Running", icon: "run", caloriesPerHour: 600, sortOrder: 100 },
  { id: "act_football", slug: "football", name: "Football", icon: "football", caloriesPerHour: 600, sortOrder: 110 },
  { id: "act_jump_rope", slug: "jump-rope", name: "Jump Rope", icon: "rope", caloriesPerHour: 700, sortOrder: 120 },
];
