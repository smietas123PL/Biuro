import { Bot } from 'lucide-react';

type AgentDetailHeaderProps = {
  agent: {
    name: string;
    role?: string | null;
    status?: string | null;
  };
};

export function AgentDetailHeader({ agent }: AgentDetailHeaderProps) {
  return (
    <div className="flex justify-between items-start">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Bot className="w-8 h-8 text-primary" />
          <h2 className="text-3xl font-bold tracking-tight">{agent.name}</h2>
          <span
            className={`px-2 py-1 rounded-md text-xs font-medium ${
              agent.status === 'active'
                ? 'bg-green-500/10 text-green-500'
                : 'bg-yellow-500/10 text-yellow-500'
            }`}
          >
            {(agent.status || 'idle').toUpperCase()}
          </span>
        </div>
        <p className="text-muted-foreground">{agent.role}</p>
      </div>
    </div>
  );
}
