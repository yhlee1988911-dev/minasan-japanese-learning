import { BookOpenText, ChevronDown, House, KeyRound, Library, LogOut, Moon, ShieldCheck, Sun, UserRound } from 'lucide-react';
import { type FormEvent, type PropsWithChildren, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { changePassword, logout, type AuthUser } from '../services/api';

export function AppShell({ children, user }: PropsWithChildren<{ user?: AuthUser | null }>) {
  const location = useLocation();
  const isPractice = location.pathname === '/practice';
  const [eyeCare, setEyeCare] = useState(() => localStorage.getItem('minasan:eye-care') === 'true');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordWorking, setPasswordWorking] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('minasan:eye-care', String(eyeCare));
    document.documentElement.classList.toggle('eye-care', eyeCare);
  }, [eyeCare]);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const closeMenu = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [accountMenuOpen]);

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
      setPasswordOpen(false);
      window.alert('密码修改成功');
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

  const openPasswordDialog = () => {
    setAccountMenuOpen(false);
    setPasswordOpen(true);
    setPasswordMessage('');
    setPasswordError('');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/" aria-label="nihongo 首页"><span>に</span><strong>nihongo</strong></NavLink>
        <div className="topbar-right">
          {!isPractice && (
            <nav aria-label="主导航">
              <NavLink to="/"><House size={18} />首页</NavLink>
              <NavLink to="/course"><BookOpenText size={18} />课程</NavLink>
              <NavLink to="/library"><Library size={18} />词库</NavLink>
              {user?.username === 'root' && <NavLink to="/admin"><ShieldCheck size={18} />后台</NavLink>}
            </nav>
          )}
          {user && (
            <div className="account-menu" ref={accountMenuRef}>
              <button
                className="account-menu__trigger"
                type="button"
                onClick={() => setAccountMenuOpen(value => !value)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
              >
                <UserRound size={16} />
                <span>{user.username}</span>
                <ChevronDown size={15} />
              </button>
              {accountMenuOpen && (
                <div className="account-menu__panel" role="menu">
                  <button type="button" onClick={openPasswordDialog} role="menuitem"><KeyRound size={16} />修改密码</button>
                  <button type="button" className="danger" onClick={() => void signOut()} role="menuitem"><LogOut size={16} />退出登录</button>
                </div>
              )}
            </div>
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
      {!isPractice && (
        <footer className="copyright-notice" aria-label="版权说明">
          <strong>日语词汇记忆引擎</strong>
          <span>本系统仅提供学习流程、记忆训练和个人词库管理工具。公共词库应使用开源或已授权内容；用户上传的课件与词条由上传者自行确认来源和使用权，不内置或分发第三方商业课程。</span>
        </footer>
      )}
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
