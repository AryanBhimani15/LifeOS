import { redirect } from "next/navigation";
import { getUserId } from "@/lib/session";

/**
 * Root route. Signed-in users go straight to Today; everyone else to login.
 * There is no marketing landing page — this is a personal tool, not a product
 * someone needs convincing about.
 */
export default async function RootPage() {
  const userId = await getUserId();
  redirect(userId ? "/today" : "/login");
}
