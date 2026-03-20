import { MessageSquareText, Send } from 'lucide-react';

type TaskForceComposerProps = {
  newMsg: string;
  onMessageChange: (value: string) => void;
  onSend: () => void | Promise<void>;
};

export function TaskForceComposer({
  newMsg,
  onMessageChange,
  onSend,
}: TaskForceComposerProps) {
  return (
    <div className="mt-5 rounded-[24px] border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <MessageSquareText className="h-4 w-4 text-emerald-600" />
        Join the room
      </div>
      <div className="mt-3 flex gap-3">
        <input
          id="task-message"
          name="taskMessage"
          aria-label="taskMessage"
          className="flex-1 rounded-2xl border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Drop guidance into the task force..."
          value={newMsg}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void onSend();
            }
          }}
        />
        <button
          onClick={() => void onSend()}
          className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Send className="h-4 w-4" />
          Send
        </button>
      </div>
    </div>
  );
}
