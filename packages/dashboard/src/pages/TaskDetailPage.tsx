import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { ClipboardList, MessageSquare, Send } from 'lucide-react';

export default function TaskDetailPage() {
  const { id } = useParams();
  const { request } = useApi();
  const [task, setTask] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMsg, setNewMsg] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      const t = await request(`/tasks/${id}`);
      setTask(t);
      const msgs = await request(`/tasks/${id}/messages`);
      setMessages(msgs);
    };
    void fetchData();
  }, [id]);

  const handleSend = async () => {
    if (!newMsg.trim()) return;
    await request(`/tasks/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: newMsg,
      })
    });
    setNewMsg('');
    const msgs = await request(`/tasks/${id}/messages`);
    setMessages(msgs);
  };

  if (!task) return <div className="p-8">Loading...</div>;

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-primary" />
          <h2 className="text-3xl font-bold tracking-tight">{task.title}</h2>
          <span className="px-2 py-1 bg-accent rounded text-xs border">
            {task.status.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-hidden">
        <div className="md:col-span-2 flex flex-col border rounded-xl bg-card overflow-hidden">
          <div className="p-4 border-b bg-muted/30 font-semibold flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Conversation Thread
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.from_agent ? 'items-start' : 'items-end'}`}>
                <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                  m.from_agent ? 'bg-accent rounded-tl-none' : 'bg-primary text-primary-foreground rounded-tr-none'
                }`}>
                  <p className="font-bold text-[10px] mb-1 opacity-70">
                    {m.from_agent ? `Agent ${String(m.from_agent).slice(0, 8)}` : 'Supervisor'}
                  </p>
                  {m.content}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t bg-card flex gap-2">
            <input 
              id="task-message"
              name="taskMessage"
              className="flex-1 bg-muted rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Send instruction to agent..."
              value={newMsg}
              onChange={(e) => setNewMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
            <button 
              onClick={handleSend}
              className="p-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-6">
           <div className="border rounded-xl bg-card p-6 space-y-4">
              <h3 className="font-semibold text-sm">Description</h3>
              <p className="text-sm text-muted-foreground">{task.description || 'No description provided.'}</p>
           </div>
           
           <div className="border rounded-xl bg-card p-6 space-y-4">
              <h3 className="font-semibold text-sm">Assigned To</h3>
              <div className="text-sm">
                {task.assigned_to_name || 'Unassigned'}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
