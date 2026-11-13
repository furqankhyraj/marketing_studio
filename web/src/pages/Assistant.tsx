import { useEffect, useState } from "react";
import { MessageCirclePlus, MessagesSquare, Sparkles, Trash2 } from "lucide-react";
import { chatApi } from "../lib/chat";
import { cx, relTime } from "../lib/format";
import type { ChatSession } from "../lib/types";
import { useToast } from "../state/toast";
import { AssistantPanel, storedSession, storeSession } from "../components/chat/Assistant";
import { Button, Card, PageHeader } from "../components/ui";

export default function AssistantPage() {
  const { fail } = useToast();
  const [sessionId, setSessionId] = useState<string | undefined>(storedSession);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const reload = () => chatApi.sessions().then(setSessions, () => {});
  useEffect(() => {
    reload();
  }, [sessionId]);
  const pick = (id: string | undefined) => {
    setSessionId(id);
    storeSession(id);
  };
  const remove = async (id: string) => {
    try {
      await chatApi.deleteSession(id);
      if (id === sessionId) pick(undefined);
      reload();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div>
      <PageHeader
        icon={<Sparkles className="size-5" />}
        title="Assistant"
        subtitle="Ask in plain words — plan posts, change a reel, approve and schedule. It asks before approving, publishing or deleting."
        actions={<Button size="sm" icon={<MessageCirclePlus className="size-4" />} onClick={() => pick(undefined)}>New chat</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="hidden max-h-[calc(100dvh-14rem)] overflow-y-auto p-2 lg:block">
          <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Conversations</div>
          {sessions.length === 0 && <p className="px-2 py-4 text-sm text-zinc-500">No conversations yet.</p>}
          {sessions.map((s) => (
            <div key={s.id} className={cx("group flex items-center gap-1 rounded-xl", s.id === sessionId ? "bg-violet-50 dark:bg-violet-950/50" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60")}>
              <button onClick={() => pick(s.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
                <MessagesSquare className="size-4 shrink-0 text-zinc-400" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.title || "New chat"}</div>
                  <div className="text-[11px] text-zinc-500">{relTime(s.updatedAt)}</div>
                </div>
              </button>
              <button onClick={() => remove(s.id)} className="mr-1 rounded-lg p-1.5 text-zinc-400 opacity-0 hover:text-rose-500 group-hover:opacity-100" aria-label="Delete conversation">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </Card>
        <Card className="flex h-[calc(100dvh-14rem)] min-h-[28rem] flex-col p-3 sm:p-4">
          <AssistantPanel sessionId={sessionId} onSession={(id) => { pick(id); reload(); }} className="min-h-0 flex-1" />
        </Card>
      </div>
    </div>
  );
}
