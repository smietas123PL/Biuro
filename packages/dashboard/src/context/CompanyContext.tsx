import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useApi } from '../hooks/useApi';
import { useAuth } from './AuthContext';
import { COMPANY_STORAGE_KEY } from '../lib/session';

type Company = {
  id: string;
  name: string;
  mission?: string;
};

type CreateCompanyInput = {
  name: string;
  mission?: string;
};

type CompanyContextValue = {
  companies: Company[];
  selectedCompany: Company | null;
  selectedCompanyId: string | null;
  loading: boolean;
  error: string | null;
  setSelectedCompanyId: (companyId: string) => void;
  refreshCompanies: () => Promise<void>;
  createCompany: (input: CreateCompanyInput) => Promise<Company>;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { request, error } = useApi();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const syncSelectedCompany = (nextCompanies: Company[], preferredId?: string | null) => {
    const requestedId = preferredId ?? selectedCompanyId ?? localStorage.getItem(COMPANY_STORAGE_KEY);
    const matchingCompany = requestedId
      ? nextCompanies.find((company) => company.id === requestedId) ?? null
      : null;
    const nextSelectedId = matchingCompany?.id ?? nextCompanies[0]?.id ?? null;

    setSelectedCompanyIdState(nextSelectedId);
    if (nextSelectedId) {
      localStorage.setItem(COMPANY_STORAGE_KEY, nextSelectedId);
    } else {
      localStorage.removeItem(COMPANY_STORAGE_KEY);
    }
  };

  const refreshCompanies = async () => {
    if (!isAuthenticated) {
      setCompanies([]);
      setSelectedCompanyIdState(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = (await request('/companies')) as Company[];
      setCompanies(data);
      syncSelectedCompany(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) {
      return;
    }

    const storedCompanyId = localStorage.getItem(COMPANY_STORAGE_KEY);
    if (isAuthenticated && storedCompanyId) {
      setSelectedCompanyIdState(storedCompanyId);
    }

    void refreshCompanies();
  }, [authLoading, isAuthenticated]);

  const setSelectedCompanyId = (companyId: string) => {
    setSelectedCompanyIdState(companyId);
    localStorage.setItem(COMPANY_STORAGE_KEY, companyId);
  };

  const createCompany = async (input: CreateCompanyInput) => {
    const company = (await request('/companies', {
      method: 'POST',
      body: JSON.stringify(input),
    })) as Company;

    const nextCompanies = [company, ...companies];
    setCompanies(nextCompanies);
    setSelectedCompanyId(company.id);
    return company;
  };

  const selectedCompany =
    companies.find((company) => company.id === selectedCompanyId) ?? null;

  return (
    <CompanyContext.Provider
      value={{
        companies,
        selectedCompany,
        selectedCompanyId,
        loading,
        error,
        setSelectedCompanyId,
        refreshCompanies,
        createCompany,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompany must be used within CompanyProvider');
  }
  return context;
}
