import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata: Metadata = { title: "Inbox" };

export default function AtendimentoPage() {
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  );
}
