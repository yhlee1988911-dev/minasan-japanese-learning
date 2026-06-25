import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CoursePage } from './pages/CoursePage';
import { HomePage } from './pages/HomePage';
import { LessonPage } from './pages/LessonPage';
import { MasteryPage } from './pages/MasteryPage';
import { PracticePage } from './pages/PracticePage';
import { ReviewPage } from './pages/ReviewPage';

export default function App() {
  return <BrowserRouter><AppShell><Routes><Route path="/" element={<HomePage />} /><Route path="/course" element={<CoursePage />} /><Route path="/lesson/:lessonId" element={<LessonPage />} /><Route path="/practice" element={<PracticePage />} /><Route path="/review" element={<ReviewPage />} /><Route path="/mastery/:view" element={<MasteryPage />} /></Routes></AppShell></BrowserRouter>;
}
