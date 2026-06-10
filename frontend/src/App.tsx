import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useEffect, lazy, Suspense } from 'react';
import { useAuthStore } from '@/store/authStore';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute, AdminRoute } from '@/components/layout/ProtectedRoute';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Skeleton } from '@/components/ui/Skeleton';

const Landing = lazy(() => import('@/features/landing/Landing'));
const Login = lazy(() => import('@/features/auth/Login'));
const Register = lazy(() => import('@/features/auth/Register'));
const ForgotPassword = lazy(() => import('@/features/auth/ForgotPassword'));
const VerifyOtp = lazy(() => import('@/features/auth/VerifyOtp'));
const Dashboard = lazy(() => import('@/features/dashboard/Dashboard'));
const SearchPage = lazy(() => import('@/features/search/SearchPage'));
const SearchResults = lazy(() => import('@/features/search/SearchResults'));
const TrainDetails = lazy(() => import('@/features/train/TrainDetails'));
const CoachSelection = lazy(() => import('@/features/train/CoachSelection'));
const BookingFlow = lazy(() => import('@/features/booking/BookingFlow'));
const QueuePage = lazy(() => import('@/features/queue/QueuePage'));
const PaymentPage = lazy(() => import('@/features/payment/PaymentPage'));
const BookingSuccess = lazy(() => import('@/features/booking/BookingSuccess'));
const MyTrips = lazy(() => import('@/features/trips/MyTrips'));
const History = lazy(() => import('@/features/trips/History'));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'));
const WalletPage = lazy(() => import('@/features/wallet/WalletPage'));
const Profile = lazy(() => import('@/features/profile/Profile'));
const LoyaltyPage = lazy(() => import('@/features/loyalty/LoyaltyPage'));
const ChatbotPage = lazy(() => import('@/features/chatbot/ChatbotPage'));
const Recommendations = lazy(() => import('@/features/recommendations/Recommendations'));
const AdminDashboard = lazy(() => import('@/features/admin/AdminDashboard'));
const QueueMonitoring = lazy(() => import('@/features/admin/QueueMonitoring'));
const ServiceMonitoring = lazy(() => import('@/features/admin/ServiceMonitoring'));
const AnalyticsPage = lazy(() => import('@/features/admin/AnalyticsPage'));
const RefundManagement = lazy(() => import('@/features/admin/RefundManagement'));
const UserManagement = lazy(() => import('@/features/admin/UserManagement'));
const AuditLogs = lazy(() => import('@/features/admin/AuditLogs'));
const About = lazy(() => import('@/features/landing/About'));
const Contact = lazy(() => import('@/features/landing/Contact'));
const Features = lazy(() => import('@/features/landing/Features'));
const Pricing = lazy(() => import('@/features/landing/Pricing'));
const Faq = lazy(() => import('@/features/landing/Faq'));
const Support = lazy(() => import('@/features/landing/Support'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

function PageLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-md space-y-4 p-8">
        <Skeleton className="h-8 w-3/4 mx-auto" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

function AppContent() {
  const theme = useAuthStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Suspense fallback={<PageLoader />}><Landing /></Suspense>} />
            <Route path="/about" element={<Suspense fallback={<PageLoader />}><About /></Suspense>} />
            <Route path="/contact" element={<Suspense fallback={<PageLoader />}><Contact /></Suspense>} />
            <Route path="/features" element={<Suspense fallback={<PageLoader />}><Features /></Suspense>} />
            <Route path="/pricing" element={<Suspense fallback={<PageLoader />}><Pricing /></Suspense>} />
            <Route path="/faq" element={<Suspense fallback={<PageLoader />}><Faq /></Suspense>} />
            <Route path="/support" element={<Suspense fallback={<PageLoader />}><Support /></Suspense>} />

            <Route path="/login" element={<Suspense fallback={<PageLoader />}><Login /></Suspense>} />
            <Route path="/register" element={<Suspense fallback={<PageLoader />}><Register /></Suspense>} />
            <Route path="/forgot-password" element={<Suspense fallback={<PageLoader />}><ForgotPassword /></Suspense>} />
            <Route path="/verify-otp" element={<Suspense fallback={<PageLoader />}><VerifyOtp /></Suspense>} />

            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
              <Route path="/search" element={<Suspense fallback={<PageLoader />}><SearchPage /></Suspense>} />
              <Route path="/search/results" element={<Suspense fallback={<PageLoader />}><SearchResults /></Suspense>} />
              <Route path="/train/:id" element={<Suspense fallback={<PageLoader />}><TrainDetails /></Suspense>} />
              <Route path="/train/:id/coach" element={<Suspense fallback={<PageLoader />}><CoachSelection /></Suspense>} />
              <Route path="/booking" element={<Suspense fallback={<PageLoader />}><BookingFlow /></Suspense>} />
              <Route path="/queue" element={<Suspense fallback={<PageLoader />}><QueuePage /></Suspense>} />
              <Route path="/payment" element={<Suspense fallback={<PageLoader />}><PaymentPage /></Suspense>} />
              <Route path="/booking/success" element={<Suspense fallback={<PageLoader />}><BookingSuccess /></Suspense>} />
              <Route path="/my-trips" element={<Suspense fallback={<PageLoader />}><MyTrips /></Suspense>} />
              <Route path="/history" element={<Suspense fallback={<PageLoader />}><History /></Suspense>} />
              <Route path="/notifications" element={<Suspense fallback={<PageLoader />}><NotificationsPage /></Suspense>} />
              <Route path="/wallet" element={<Suspense fallback={<PageLoader />}><WalletPage /></Suspense>} />
              <Route path="/profile" element={<Suspense fallback={<PageLoader />}><Profile /></Suspense>} />
              <Route path="/loyalty" element={<Suspense fallback={<PageLoader />}><LoyaltyPage /></Suspense>} />
              <Route path="/chatbot" element={<Suspense fallback={<PageLoader />}><ChatbotPage /></Suspense>} />
              <Route path="/recommendations" element={<Suspense fallback={<PageLoader />}><Recommendations /></Suspense>} />
            </Route>

            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<Suspense fallback={<PageLoader />}><AdminDashboard /></Suspense>} />
              <Route path="/admin/queue" element={<Suspense fallback={<PageLoader />}><QueueMonitoring /></Suspense>} />
              <Route path="/admin/services" element={<Suspense fallback={<PageLoader />}><ServiceMonitoring /></Suspense>} />
              <Route path="/admin/analytics" element={<Suspense fallback={<PageLoader />}><AnalyticsPage /></Suspense>} />
              <Route path="/admin/refunds" element={<Suspense fallback={<PageLoader />}><RefundManagement /></Suspense>} />
              <Route path="/admin/users" element={<Suspense fallback={<PageLoader />}><UserManagement /></Suspense>} />
              <Route path="/admin/audit-logs" element={<Suspense fallback={<PageLoader />}><AuditLogs /></Suspense>} />
            </Route>
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
        }}
      />
    </QueryClientProvider>
  );
}
