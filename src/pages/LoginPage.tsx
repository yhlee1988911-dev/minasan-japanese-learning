import { LockKeyhole } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { getDeviceId, getDeviceName, login, type AuthUser } from '../services/api';

export function LoginPage({ admin = false, onLogin }: { admin?: boolean; onLogin: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
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
        <p className="eyebrow">{admin ? 'ROOT ADMIN' : 'MINASAN LOGIN'}</p>
        <h1>{admin ? '登录后台管理' : '登录学习档案'}</h1>
        <label>
          <span>用户名</span>
          <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          <span>密码</span>
          <input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="current-password" autoFocus />
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
