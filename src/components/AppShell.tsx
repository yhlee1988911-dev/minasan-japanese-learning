import { BookOpenText, House, KeyRound, LogOut, Moon, ShieldCheck, Sun } from 'lucide-react';
import { type FormEvent, type PropsWithChildren, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { changePassword, logout, type AuthUser } from '../services/api';

export function AppShell({ children, user }: PropsWithChildren<{ user?: AuthUser | null }>) {
  const location = useLocation();
  const isPractice = location.pathname === '/practice';
  const [eyeCare, setEyeCare] = useState(() => localStorage.getItem('minasan:eye-care') === 'true');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordWorking, setPasswordWorking] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    localStorage.setItem('minasan:eye-care', String(eyeCare));
    document.documentElement.classList.toggle('eye-care', eyeCare);
  }, [eyeCare]);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordMessage('');
    setPasswordError('');
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致');
      return;
    }
    setPasswordWorking(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('密码已修改');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setPasswordWorking(false);
    }
  };

  const signOut = async () => {
    await logout();
    window.location.reload();
  };

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
          {user && (
            <>
              <button
                className="topbar-icon-button"
                onClick={() => {
                  setPasswordOpen(true);
                  setPasswordMessage('');
                  setPasswordError('');
                }}
                aria-label="修改密码"
                title="修改密码"
              >
                <KeyRound size={16} />
              </button>
              <button
                className="topbar-icon-button topbar-icon-button--danger"
                onClick={() => void signOut()}
                aria-label="退出登录"
                title="退出登录"
              >
                <LogOut size={16} />
              </button>
            </>
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
      {passwordOpen && (
        <div className="password-modal" role="presentation">
          <form className="password-dialog" onSubmit={submitPassword}>
            <div className="password-dialog__heading">
              <div>
                <p className="eyebrow">ACCOUNT</p>
                <h2>修改密码</h2>
              </div>
              <button type="button" className="password-dialog__close" onClick={() => setPasswordOpen(false)}>关闭</button>
            </div>
            <label>
              <span>当前密码</span>
              <input value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} type="password" autoComplete="current-password" />
            </label>
            <label>
              <span>新密码</span>
              <input value={newPassword} onChange={event => setNewPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="至少 8 位" />
            </label>
            <label>
              <span>确认新密码</span>
              <input value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" />
            </label>
            {(passwordMessage || passwordError) && <p className={passwordError ? 'password-dialog__feedback is-error' : 'password-dialog__feedback'}>{passwordError || passwordMessage}</p>}
            <button type="submit" disabled={passwordWorking || !currentPassword || !newPassword || !confirmPassword}>保存密码</button>
          </form>
        </div>
      )}
    </div>
  );
}
