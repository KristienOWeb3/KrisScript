"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ActivatePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/chat");
  }, [router]);

  return <div className="center-page muted">Redirecting to chat...</div>;
}
