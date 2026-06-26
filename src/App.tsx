import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { AdminPage } from './pages/AdminPage';
import { BasicPracticePage } from './pages/BasicPracticePage';
import { CoursePage } from './pages/CoursePage';
import { HomePage } from './pages/HomePage';
import { LessonPage } from './pages/LessonPage';
import { LoginPage } from './pages/LoginPage';
import { MasteryPage } from './pages/MasteryPage';
import { PracticePage } from './pages/PracticePage';
import { ReviewPage } from './pages/ReviewPage';
import { getAuthToken, getMe, type AuthUser } from './services/api';
import { replaceMastery } from './storage/mastery';
import { loadRemoteProgress } from './services/api';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(Boolean(getAuthToken()));
  const isAdminPath = window.location.pathname === '/admin';

  const hydrateProgress = async () => {
    try {
      const progress = await loadRemoteProgress();
      replaceMastery(progress.records);
    } catch {
      // Keep local fallback if remote progress is unavailable.
    }
  };

  useEffect(() => {
    if (!getAuthToken()) return;
    getMe()
      .then(({ user: activeUser }) => {
        setUser(activeUser);
        void hydrateProgress();
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <main className="login-page"><section className="login-card"><h1>正在读取学习档案</h1></section></main>;
  if (!user) return <LoginPage admin={isAdminPath} onLogin={(activeUser) => { setUser(activeUser); void hydrateProgress(); }} />;
  if (isAdminPath && user.username !== 'root') return <main className="login-page"><section className="login-card"><h1>需要 root 管理员权限</h1></section></main>;

  return <BrowserRouter><AppShell user={user}><Routes><Route path="/" element={<HomePage />} /><Route path="/course" element={<CoursePage />} /><Route path="/lesson/:lessonId" element={<LessonPage />} /><Route path="/practice" element={<PracticePage />} /><Route path="/basic" element={<BasicPracticePage />} /><Route path="/review" element={<ReviewPage />} /><Route path="/mastery/:view" element={<MasteryPage />} /><Route path="/admin" element={<AdminPage />} /></Routes></AppShell></BrowserRouter>;
}
