import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getState } from "@/lib/actions";
import { WorkApp } from "@/components/work/WorkApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await getSessionUser())) redirect("/login");
  return <WorkApp initial={await getState()} />;
}
