import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { BrandLogo } from "@/components/BrandLogo";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-b from-muted/60 to-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card ring-1 ring-foreground/10 p-8 shadow-sm">
        <BrandLogo className="mx-auto h-10 w-auto" />
        <h1 className="mt-6 text-center text-xl font-semibold">Sign in to AI4Home Work</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">Boards, tasks and automations for the team.</p>
        <LoginForm />
      </div>
    </div>
  );
}
