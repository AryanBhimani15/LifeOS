import { invitesRequired } from "@/lib/signup";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata = { title: "LifeOS — Create your account" };

/**
 * Whether this deployment is invite-only is a server fact, so it is read here
 * and handed to the form rather than guessed in the browser.
 */
export default function RegisterPage() {
  return <RegisterForm inviteRequired={invitesRequired()} />;
}
