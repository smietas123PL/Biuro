import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useApi } from '../hooks/useApi';

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

const STORAGE_KEY = 'biuro.selectedCompanyId';

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { request, error } = useApi();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const syncSelectedCompany = (nextCompanies: Company[], preferredId?: string | null) => {
    const requestedId = preferredId ?? selectedCompanyId ?? localStorage.getItem(STORAGE_KEY);
    const matchingCompany = requestedId
      ? nextCompanies.find((company) => company.id === requestedId) ?? null
      : null;
    const nextSelectedId = matchingCompany?.id ?? nextCompanies[0]?.id ?? null;

    setSelectedCompanyIdState(nextSelectedId);
    if (nextSelectedId) {
      localStorage.setItem(STORAGE_KEY, nextSelectedId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const refreshCompanies = async () => {
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
    const storedCompanyId = localStorage.getItem(STORAGE_KEY);
    if (storedCompanyId) {
      setSelectedCompanyIdState(storedCompanyId);
    }
    void refreshCompanies();
  }, []);

  const setSelectedCompanyId = (companyId: string) => {
    setSelectedCompanyIdState(companyId);
    localStorage.setItem(STORAGE_KEY, companyId);
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
