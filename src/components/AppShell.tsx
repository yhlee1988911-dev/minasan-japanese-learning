import { BookOpenText, House, Moon, ShieldCheck, Sun } from 'lucide-react';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { AuthUser } from '../services/api';

export function AppShell({ children, user }: PropsWithChildren<{ user?: AuthUser | null }>) {
  const location = useLocation();
  const isPractice = location.pathname === '/practice';
  const [eyeCare, setEyeCare] = useState(() => localStorage.getItem('minasan:eye-care') === 'true');

  useEffect(() => {
    localStorage.setItem('minasan:eye-care', String(eyeCare));
    document.documentElement.classList.toggle('eye-care', eyeCare);
  }, [eyeCare]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/" aria-label="Minasan 首页"><span>み</span><strong>Minasan</strong></NavLink>
        <div className="topbar-right">
          {!isPractice && (
            <nav aria-label="主导航">
              <NavLink to="/"><House size={18} />首页</NavLink>
              <NavLink to="/course"><BookOpenText size={18} />课程</NavLink>
              {user?.username === 'root' && <NavLink to="/admin"><ShieldCheck size={18} />后台</NavLink>}
            </nav>
          )}
          <button
            className="eye-care-toggle"
            onClick={() => setEyeCare(v => !v)}
            aria-label={eyeCare ? '关闭护眼模式' : '开启护眼模式'}
            title={eyeCare ? '关闭护眼模式' : '开启护眼模式'}
          >
            {eyeCare ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
