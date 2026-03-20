import { TimerReset } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  getStatusTone,
  type CollaborationParticipant,
} from './taskDetailShared';

type TeamReadoutPanelProps = {
  participants: CollaborationParticipant[];
};

export function TeamReadoutPanel({ participants }: TeamReadoutPanelProps) {
  return (
    <section className="rounded-[28px] border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <TimerReset className="h-5 w-5 text-amber-600" />
        Team Readout
      </div>
      <div className="mt-5 space-y-3">
        {participants.map((participant) => (
          <div
            key={participant.agent_id}
            className="rounded-[22px] border bg-muted/10 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-foreground">
                  {participant.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {participant.role || 'Task force member'}
                </div>
              </div>
              <span
                className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(participant.status || 'idle')}`}
              >
                {participant.status || 'idle'}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>
                {participant.assigned_task_count} workstream
                {participant.assigned_task_count === 1 ? '' : 's'}
              </span>
              <span>{participant.contribution_count} visible moves</span>
              {participant.latest_activity_at ? (
                <span>
                  {new Date(participant.latest_activity_at).toLocaleTimeString()}
                </span>
              ) : null}
            </div>
            <Link
              to={`/agents/${participant.agent_id}`}
              className="mt-3 inline-flex text-xs font-medium text-foreground underline-offset-2 hover:underline"
            >
              Open collaborator profile
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
