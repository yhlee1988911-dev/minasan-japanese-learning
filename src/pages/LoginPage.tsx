import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { getDeviceId, getDeviceName, getLastUsername, login, type AuthUser } from '../services/api';

export function LoginPage({ admin = false, onLogin }: { admin?: boolean; onLogin: (user: AuthUser) => void }) {
  const [username, setUsername] = useState(() => getLastUsername() || (admin ? 'root' : ''));
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const user = await login(username, password);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-card__icon"><LockKeyhole size={26} /></div>
        <p className="eyebrow">{admin ? 'ROOT ADMIN' : 'VOCABULARY MEMORY ENGINE'}</p>
        <h1>{admin ? '登录后台管理' : '日语词汇记忆引擎'}</h1>
        <p className="login-copyright-note">系统仅提供词汇记忆训练与个人词库管理；公共词库使用开源或已授权内容，用户自定义课件由上传者自行确认版权来源。</p>
        <label>
          <span>用户名</span>
          <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          <span>密码</span>
          <div className="login-password-field">
            <input value={password} onChange={event => setPassword(event.target.value)} type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" autoFocus />
            <button
              type="button"
              className="login-password-field__toggle"
              onClick={() => setPasswordVisible(value => !value)}
              aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
              title={passwordVisible ? '隐藏密码' : '显示密码'}
            >
              {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        <div className="login-device">
          <span>当前设备</span>
          <strong>{deviceName}</strong>
          <small>{deviceId.slice(0, 8)} · 最多允许 3 台设备</small>
        </div>
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? '登录中' : '登录'}</button>
      </form>
    </main>
  );
}
