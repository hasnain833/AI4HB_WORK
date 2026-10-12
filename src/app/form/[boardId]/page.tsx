import { BrandLogo } from "@/components/BrandLogo";
import { getFormBoard } from "@/lib/actions";
import { RequestForm } from "./RequestForm";

export const dynamic = "force-dynamic";

// Public intake form: anyone with the link can add an item to a board.
export default async function BoardFormPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const board = await getFormBoard(boardId);
  return (
    <div className="min-h-screen bg-linear-to-b from-muted/60 to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <BrandLogo className="h-8 w-auto" />
          <span className="text-sm text-muted-foreground">Request form</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">
        {board ? <RequestForm board={board} /> : <p className="text-center text-muted-foreground">This form doesn&apos;t exist (the board may have been deleted).</p>}
      </main>
    </div>
  );
}
