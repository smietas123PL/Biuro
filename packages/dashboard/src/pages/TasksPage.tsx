import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Play, AlertCircle, Plus, X } from 'lucide-react';
import { useApi, useWebSocket } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';
import { useOnboarding } from '../context/OnboardingContext';

const initialForm = {
  title: '',
  description: '',
  assigned_to: '',
  priority: '10',
};

export default function TasksPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { currentStep, status } = useOnboarding();
  const [tasks, setTasks] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(initialForm);
  const wasTutorialCreateStepOpen = useRef(false);
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as
    | {
        event: string;
        data?: {
          task_id?: string;
          status?: string;
          assigned_to?: string | null;
        };
      }
    | null;

  const tutorialWantsCreateModal =
    status === 'active' && currentStep?.id === 'tasks-create-modal';

  const fetchTasks = async () => {
    if (!selectedCompanyId) {
      setTasks([]);
      return;
    }

    const data = await request(`/companies/${selectedCompanyId}/tasks`);
    setTasks(data);
  };

  const fetchAgents = async () => {
    if (!selectedCompanyId) {
      setAgents([]);
      return;
    }

    const data = await request(`/companies/${selectedCompanyId}/agents`);
    setAgents(data.filter((agent: any) => agent.status !== 'terminated'));
  };

  useEffect(() => {
    void fetchTasks();
    void fetchAgents();
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!lastEvent || lastEvent.event !== 'task.updated') {
      return;
    }

    void fetchTasks();
  }, [lastEvent, selectedCompanyId]);

  useEffect(() => {
    if (tutorialWantsCreateModal) {
      setShowCreateModal(true);
      wasTutorialCreateStepOpen.current = true;
      return;
    }

    if (wasTutorialCreateStepOpen.current) {
      setShowCreateModal(false);
      wasTutorialCreateStepOpen.current = false;
    }
  }, [tutorialWantsCreateModal]);

  const handleCreateTask = async () => {
    if (!selectedCompanyId || !form.title.trim()) return;

    setSubmitting(true);
    try {
      await request(`/companies/${selectedCompanyId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          assigned_to: form.assigned_to || undefined,
          priority: Number(form.priority) || 0,
        }),
      });
      setForm(initialForm);
      setShowCreateModal(false);
      await fetchTasks();
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'done':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'in_progress':
        return <Play className="w-4 h-4 text-blue-500" />;
      case 'blocked':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  if (!selectedCompany) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Choose a company to manage tasks.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className="flex items-center justify-between"
        data-onboarding-target="tasks-primary-actions"
      >
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Backlog and execution for {selectedCompany.name}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Task
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div
        className="grid grid-cols-1 gap-4"
        data-onboarding-target="tasks-list"
      >
        {tasks.map((task) => (
          <div
            key={task.id}
            className="p-4 bg-card border rounded-lg shadow-sm hover:border-primary/50 transition-all flex items-start justify-between"
            data-testid={`task-card-${task.id}`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {getStatusIcon(task.status)}
                <h4 className="font-semibold text-lg">{task.title}</h4>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 max-w-2xl">
                {task.description}
              </p>
              <div className="flex items-center gap-4 pt-2">
                <div
                  className="text-xs font-mono bg-muted px-2 py-0.5 rounded uppercase"
                  data-testid={`task-status-${task.id}`}
                >
                  {task.status}
                </div>
                <div className="text-xs text-muted-foreground">
                  Priority: {task.priority}
                </div>
                <div className="text-xs text-muted-foreground">
                  Assigned:{' '}
                  {agents.find((agent) => agent.id === task.assigned_to)
                    ?.name || 'Unassigned'}
                </div>
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {new Date(task.created_at).toLocaleDateString()}
            </div>
          </div>
        ))}
        {tasks.length === 0 && !loading && (
          <div className="p-12 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-muted-foreground italic">
            No tasks in the backlog.
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="w-full max-w-2xl rounded-2xl border bg-card p-6 shadow-xl"
            data-onboarding-target="tasks-create-modal"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold">Create Task</h3>
                <p className="text-sm text-muted-foreground">
                  Add a new task for {selectedCompany.name}
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-md p-2 hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4">
              <input
                id="task-title"
                name="taskTitle"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Task title"
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
              <textarea
                id="task-description"
                name="taskDescription"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Description"
                rows={5}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <select
                  id="task-assigned-to"
                  name="taskAssignedTo"
                  value={form.assigned_to}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      assigned_to: event.target.value,
                    }))
                  }
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <input
                  id="task-priority"
                  name="taskPriority"
                  value={form.priority}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                  placeholder="Priority"
                  type="number"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateTask()}
                disabled={submitting || !form.title.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
