"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function toStatusLabel(status: string) {
  if (status === "transcribing") {
    return "文字起こし中";
  }
  if (status === "generating") {
    return "議事録生成中";
  }
  return status;
}

export function MeetingProcessingIndicator({
  status,
}: {
  status: "pending" | "transcribing" | "generating" | "completed" | "failed";
}) {
  const router = useRouter();
  const active = status === "transcribing" || status === "generating";
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedSeconds(0);
      return;
    }

    const tick = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);

    const refresh = window.setInterval(() => {
      router.refresh();
    }, 5000);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(refresh);
    };
  }, [active, router]);

  const hint = useMemo(() => {
    if (!active) {
      return "";
    }

    const statusLabel = toStatusLabel(status);
    return `AI実行中: ${statusLabel}（${elapsedSeconds}秒経過 / 5秒ごとに状態更新）`;
  }, [active, elapsedSeconds, status]);

  if (!active) {
    return null;
  }

  return (
    <p className="rounded-md border border-blue-300/50 bg-blue-50 px-3 py-2 text-sm text-blue-700">
      {hint}
    </p>
  );
}
