import { useEffect, useState } from 'react';
import { Check, X, ShieldAlert } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

export default function ApprovalsPage() {
  const { request } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [approvals, setApprovals] = useState<any[]>([]);

  const fetchApprovals = async () => {
    if (!selectedCompanyId) {
      setApprovals([]);
      return;
    }

    const data = await request(`/companies/${selectedCompanyId}/approvals`);
    setApprovals(data);
  };

  useEffect(() => {
    void fetchApprovals();
  }, [selectedCompanyId]);

  const handleResolve = async (id: string, status: 'approved' | 'rejected') => {
    await request(`/approvals/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ status, notes: 'Resolved via Dashboard' }),
    });
    await fetchApprovals();
  };

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to review approvals.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight italic">Governance Approvals</h2>
        <p className="text-sm text-muted-foreground">Pending approvals for {selectedCompany.name}</p>
      </div>
      
      <div className="space-y-4">
        {approvals.filter((approval) => approval.status === 'pending').map((approval) => (
          <div key={approval.id} className="p-6 bg-yellow-50 border-2 border-yellow-200 rounded-xl shadow-sm flex items-start justify-between gap-6 hover:shadow-md transition-shadow">
            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-2 text-yellow-700 font-bold">
                <ShieldAlert className="w-5 h-5" />
                Attention Required
              </div>
              <div>
                <span className="font-semibold">Reason: </span>
                <span className="text-yellow-900">{approval.reason}</span>
              </div>
              <div className="text-sm bg-white/50 p-2 rounded font-mono overflow-auto max-h-32">
                {JSON.stringify(approval.payload, null, 2)}
              </div>
              <div className="text-xs text-yellow-600">
                Requested by: {approval.requested_by_agent || 'System'}
              </div>
            </div>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={() => void handleResolve(approval.id, 'approved')}
                className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-green-700 transition-colors shadow-sm"
              >
                <Check className="w-4 h-4" />
                Approve
              </button>
              <button
                onClick={() => void handleResolve(approval.id, 'rejected')}
                className="flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-700 transition-colors shadow-sm"
              >
                <X className="w-4 h-4" />
                Reject
              </button>
            </div>
          </div>
        ))}
        {approvals.filter((approval) => approval.status === 'pending').length === 0 && (
          <div className="p-12 bg-muted/20 border rounded-lg flex flex-col items-center justify-center text-muted-foreground">
            <Check className="w-8 h-8 mb-2 opacity-20 text-green-600" />
            <p>No pending approvals. Governance is silent.</p>
          </div>
        )}
      </div>
    </div>
  );
}
