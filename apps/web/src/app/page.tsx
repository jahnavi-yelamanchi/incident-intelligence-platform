import { CommandCenter } from "@/components/command-center";
import { auth0, isAuthConfigured } from "@/lib/auth0";
import { redirect } from "next/navigation";

export default async function Home() {
  if (!isAuthConfigured || !auth0) {
    return <CommandCenter userName="Alex Morgan" />;
  }

  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  return <CommandCenter userName={session.user.name ?? session.user.email ?? "Operator"} />;
}
