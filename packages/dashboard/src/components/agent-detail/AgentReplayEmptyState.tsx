type AgentReplayEmptyStateProps = {
  hasReplayFilters: boolean;
};

export function AgentReplayEmptyState({
  hasReplayFilters,
}: AgentReplayEmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
      {hasReplayFilters
        ? 'No events match the current replay filters. Try another task or re-enable more event types.'
        : 'No replay events yet. The timeline will populate as this agent works.'}
    </div>
  );
}
