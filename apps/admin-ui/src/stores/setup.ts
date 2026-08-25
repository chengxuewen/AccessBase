import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CheckItem {
  name: string;
  label: string;
  status: 'pending' | 'checking' | 'success' | 'error';
  message?: string;
  recovery?: string;
}

interface AdminFormData {
  name: string;
  email: string;
  password: string;
}

interface ConfigFormData {
  siteName: string;
  siteUrl?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
}

interface SetupState {
  currentStep: number;
  formData: {
    admin?: AdminFormData;
    config?: ConfigFormData;
  };
  systemChecks: CheckItem[];
  error: string | null;
  isLoading: boolean;

  setCurrentStep: (step: number) => void;
  setAdminData: (data: AdminFormData) => void;
  setConfigData: (data: ConfigFormData) => void;
  setSystemChecks: (checks: CheckItem[]) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      currentStep: 0,
      formData: {},
      systemChecks: [],
      error: null,
      isLoading: false,

      setCurrentStep: (step) => set({ currentStep: step }),
      setAdminData: (data) => set((state) => ({ formData: { ...state.formData, admin: data } })),
      setConfigData: (data) => set((state) => ({ formData: { ...state.formData, config: data } })),
      setSystemChecks: (checks) => set({ systemChecks: checks }),
      setError: (error) => set({ error }),
      setLoading: (loading) => set({ isLoading: loading }),
      reset: () => {
        localStorage.removeItem('accessbase-setup-store');
        set({
          currentStep: 0,
          formData: {},
          systemChecks: [],
          error: null,
          isLoading: false,
        });
      },
    }),
    {
      name: 'accessbase-setup-store',
      partialize: (state) => ({
        currentStep: state.currentStep,
        formData: state.formData,
      }),
    },
  ),
);
